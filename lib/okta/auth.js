'use strict';

/**
 * @module auth
 * Authentication helpers for the Okta API.
 * Uses native fetch and Node.js crypto — zero external dependencies.
 *
 * Supported auth models:
 * - SSWS API token: `Authorization: SSWS {token}` (simplest, for service accounts)
 * - OAuth 2.0 client_credentials: clientId + clientSecret → scoped access token
 * - OAuth 2.0 private_key_jwt: clientId + RSA private key → JWT assertion → scoped token
 */

const crypto = require('crypto');

/** In-memory token cache. Keys are scope-partitioned per client. */
const tokenCache = new Map();

// ---------------------------------------------------------------------------
// Token cache helpers (mirrors graph-security/auth.js pattern)
// ---------------------------------------------------------------------------

/**
 * Returns a cached token if still valid (5-min early-refresh buffer).
 * @param {string} cacheKey
 * @returns {{token: string} | null}
 */
function getCachedToken(cacheKey) {
  const entry = tokenCache.get(cacheKey);
  if (!entry) return null;
  const bufferMs = 5 * 60 * 1000;
  if (Date.now() >= entry.expiresAt - bufferMs) {
    tokenCache.delete(cacheKey);
    return null;
  }
  return { token: entry.token };
}

/**
 * Stores a token in the in-memory cache.
 * @param {string} cacheKey
 * @param {string} token
 * @param {number} expiresInSeconds
 */
function cacheToken(cacheKey, token, expiresInSeconds) {
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
  });
}

/**
 * Clears all cached tokens. Useful in tests or after credential rotation.
 */
function clearTokenCache() {
  tokenCache.clear();
}

// ---------------------------------------------------------------------------
// SSWS — API Token
// ---------------------------------------------------------------------------

/**
 * Returns an SSWS authorization header value for a given API token.
 * No network call — this is a direct header construction.
 *
 * @param {string} apiToken - Okta SSWS API token (from OKTA_API_TOKEN env var)
 * @returns {{ok: true, authHeader: string} | {ok: false, error: string}}
 */
function getSswsAuthHeader(apiToken) {
  if (!apiToken || typeof apiToken !== 'string') {
    return { ok: false, error: 'apiToken is required and must be a non-empty string' };
  }
  return { ok: true, authHeader: `SSWS ${apiToken}` };
}

// ---------------------------------------------------------------------------
// OAuth 2.0 — client_credentials (clientId + clientSecret)
// ---------------------------------------------------------------------------

/**
 * Acquires an Okta OAuth 2.0 access token via the client_credentials grant.
 * Uses Basic authentication (clientId:clientSecret).
 *
 * @param {string} tokenEndpoint - Full token endpoint URL (e.g. https://acme.okta.com/oauth2/v1/token)
 * @param {string} clientId - Okta OAuth2 client ID
 * @param {string} clientSecret - Okta OAuth2 client secret
 * @param {string[]} scopes - Requested OAuth2 scopes (e.g. ['okta.users.read'])
 * @returns {Promise<{ok: true, token: string, expiresIn: number} | {ok: false, error: string, status?: number}>}
 */
async function getTokenClientCredentials(tokenEndpoint, clientId, clientSecret, scopes) {
  if (!tokenEndpoint || typeof tokenEndpoint !== 'string') {
    return { ok: false, error: 'tokenEndpoint is required' };
  }
  if (!clientId || typeof clientId !== 'string') {
    return { ok: false, error: 'clientId is required' };
  }
  if (!clientSecret || typeof clientSecret !== 'string') {
    return { ok: false, error: 'clientSecret is required' };
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { ok: false, error: 'scopes must be a non-empty array' };
  }

  const scopeStr = scopes.join(' ');
  const cacheKey = `cc:${tokenEndpoint}:${clientId}:${scopeStr}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return { ok: true, token: cached.token, expiresIn: 0 };

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: scopeStr,
  });

  try {
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        error: data.error_description || data.error || 'client_credentials token request failed',
        status: res.status,
      };
    }

    const expiresIn = data.expires_in || 3600;
    cacheToken(cacheKey, data.access_token, expiresIn);
    return { ok: true, token: data.access_token, expiresIn };
  } catch (err) {
    return { ok: false, error: `Network error during client_credentials auth: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// OAuth 2.0 — private_key_jwt (clientId + RSA private key)
// ---------------------------------------------------------------------------

/**
 * Base64url-encodes a string.
 * @param {string} str
 * @returns {string}
 */
function base64urlEncode(str) {
  return Buffer.from(str).toString('base64url');
}

/**
 * Builds and signs an RS256 JWT for the private_key_jwt assertion.
 *
 * @param {string} clientId - Okta OAuth2 client ID (iss + sub)
 * @param {string} audience - Token endpoint URL (aud claim)
 * @param {string} privateKey - PEM-encoded RSA private key
 * @returns {{ok: true, jwt: string} | {ok: false, error: string}}
 */
function buildPrivateKeyJwt(clientId, audience, privateKey) {
  try {
    const header = base64urlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const nowSecs = Math.floor(Date.now() / 1000);
    const payload = base64urlEncode(JSON.stringify({
      iss: clientId,
      sub: clientId,
      aud: audience,
      iat: nowSecs,
      exp: nowSecs + 300, // 5-minute assertion lifetime
      jti: crypto.randomUUID(),
    }));

    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(signingInput);
    const signature = sign.sign(privateKey, 'base64url');

    return { ok: true, jwt: `${signingInput}.${signature}` };
  } catch (err) {
    return { ok: false, error: `Failed to build private_key_jwt: ${err.message}` };
  }
}

/**
 * Acquires an Okta OAuth 2.0 access token via the private_key_jwt client assertion.
 *
 * The private key must be a PEM-encoded RSA private key (typically sourced from
 * an environment variable or a secrets manager — never hardcoded).
 *
 * @param {string} tokenEndpoint - Full token endpoint URL
 * @param {string} clientId - Okta OAuth2 client ID
 * @param {string} privateKey - PEM-encoded RSA private key
 * @param {string[]} scopes - Requested OAuth2 scopes
 * @returns {Promise<{ok: true, token: string, expiresIn: number} | {ok: false, error: string, status?: number}>}
 */
async function getTokenPrivateKeyJwt(tokenEndpoint, clientId, privateKey, scopes) {
  if (!tokenEndpoint || typeof tokenEndpoint !== 'string') {
    return { ok: false, error: 'tokenEndpoint is required' };
  }
  if (!clientId || typeof clientId !== 'string') {
    return { ok: false, error: 'clientId is required' };
  }
  if (!privateKey || typeof privateKey !== 'string') {
    return { ok: false, error: 'privateKey is required (PEM-encoded RSA private key)' };
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return { ok: false, error: 'scopes must be a non-empty array' };
  }

  const scopeStr = scopes.join(' ');
  // private_key_jwt JWTs are short-lived (5 min), so we cache the resulting access token
  const cacheKey = `pkj:${tokenEndpoint}:${clientId}:${scopeStr}`;
  const cached = getCachedToken(cacheKey);
  if (cached) return { ok: true, token: cached.token, expiresIn: 0 };

  const jwtResult = buildPrivateKeyJwt(clientId, tokenEndpoint, privateKey);
  if (!jwtResult.ok) return jwtResult;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: jwtResult.jwt,
    scope: scopeStr,
  });

  try {
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });

    const data = await res.json();

    if (!res.ok) {
      return {
        ok: false,
        error: data.error_description || data.error || 'private_key_jwt token request failed',
        status: res.status,
      };
    }

    const expiresIn = data.expires_in || 3600;
    cacheToken(cacheKey, data.access_token, expiresIn);
    return { ok: true, token: data.access_token, expiresIn };
  } catch (err) {
    return { ok: false, error: `Network error during private_key_jwt auth: ${err.message}` };
  }
}

module.exports = {
  getSswsAuthHeader,
  getTokenClientCredentials,
  getTokenPrivateKeyJwt,
  buildPrivateKeyJwt,
  getCachedToken,
  cacheToken,
  clearTokenCache,
};
