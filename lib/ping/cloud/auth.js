'use strict';

/**
 * @module cloud/auth
 * PingOne OAuth2 client_credentials token fetch with in-memory token cache.
 * Region-aware base URL and token-endpoint construction for all five PingOne regions.
 *
 * All exported functions return {ok, data?, error?, status?} — never throw.
 *
 * Auth flow: Worker Application → client_credentials grant → Bearer token.
 * Token endpoint: https://auth.pingone.{region}/{envId}/as/token
 * API base URL:   https://api.pingone.{region}/v1
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-token
 */

// Region → API hostname (confirmed via PingOne developer docs + Keymaker research log)
const API_HOSTS = Object.freeze({
  com:  'api.pingone.com',
  eu:   'api.eu.pingone.com',
  ca:   'api.ca.pingone.com',
  asia: 'api.asia.pingone.com',
  au:   'api.au.pingone.com',
});

// Region → Auth hostname (mirrors API host subdomain pattern)
const AUTH_HOSTS = Object.freeze({
  com:  'auth.pingone.com',
  eu:   'auth.eu.pingone.com',
  ca:   'auth.ca.pingone.com',
  asia: 'auth.asia.pingone.com',
  au:   'auth.au.pingone.com',
});

/**
 * Build the PingOne REST API base URL for a given region.
 * @param {string} [region='com']  — com | eu | ca | asia | au
 * @returns {string}  e.g. 'https://api.pingone.com/v1'
 */
function buildApiBaseUrl(region = 'com') {
  const host = API_HOSTS[region] || API_HOSTS.com;
  return `https://${host}/v1`;
}

/**
 * Build the PingOne token endpoint URL for a given region + environment ID.
 * @param {string} region    — com | eu | ca | asia | au
 * @param {string} envId     — PingOne environment UUID
 * @returns {string}  e.g. 'https://auth.pingone.com/{envId}/as/token'
 */
function buildTokenUrl(region, envId) {
  const host = AUTH_HOSTS[region] || AUTH_HOSTS.com;
  return `https://${host}/${envId}/as/token`;
}

// In-memory token cache: Map<cacheKey, {accessToken, expiresIn, expiresAt}>
const _tokenCache = new Map();

/**
 * Fetch a client_credentials access token from PingOne.
 * Caches the token in memory and reuses it until 60 seconds before expiry.
 *
 * @param {object} config
 * @param {string} config.environmentId   — PingOne environment UUID
 * @param {string} config.clientId        — Worker Application client ID
 * @param {string} config.clientSecret    — Worker Application client secret
 * @param {string} [config.region='com']  — com | eu | ca | asia | au
 * @returns {Promise<{ok: true, data: {accessToken: string, expiresIn: number, tokenType: string}} | {ok: false, error: string, status?: number}>}
 */
async function fetchToken(config) {
  const { environmentId, clientId, clientSecret, region = 'com' } = config || {};
  if (!environmentId) return { ok: false, error: 'environmentId is required' };
  if (!clientId)      return { ok: false, error: 'clientId is required' };
  if (!clientSecret)  return { ok: false, error: 'clientSecret is required' };

  const cacheKey = `${region}::${environmentId}::${clientId}`;
  const cached = _tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { ok: true, data: { accessToken: cached.accessToken, expiresIn: cached.expiresIn, tokenType: 'Bearer' } };
  }

  const tokenUrl = buildTokenUrl(region, environmentId);
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  let res;
  try {
    res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
  } catch (err) {
    return { ok: false, error: `Token fetch network error: ${err.message}` };
  }

  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `Token endpoint returned non-JSON (HTTP ${res.status})`, status: res.status };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: body.error_description || body.error || `Token fetch failed (HTTP ${res.status})`,
      status: res.status,
    };
  }

  const expiresIn = body.expires_in || 3600;
  _tokenCache.set(cacheKey, {
    accessToken: body.access_token,
    expiresIn,
    expiresAt: Date.now() + (expiresIn - 60) * 1000, // 60s buffer before actual expiry
  });

  return {
    ok: true,
    data: {
      accessToken: body.access_token,
      expiresIn,
      tokenType: body.token_type || 'Bearer',
    },
  };
}

/**
 * Returns a bound async function that resolves to "Bearer <token>".
 * Store this on the client object: `client.cloud.getAuthHeader = getAuthHeader(config)`.
 * Cloud modules call `await client.getAuthHeader()` to get a fresh (or cached) header.
 *
 * Throws (does not return {ok: false}) if token fetch fails — callers in utils.js
 * catch this and convert to a shapeError response.
 *
 * @param {object} config   — same shape as fetchToken config
 * @returns {() => Promise<string>}  async function that resolves to "Bearer <token>"
 */
function getAuthHeader(config) {
  return async function resolveAuthHeader() {
    const result = await fetchToken(config);
    if (!result.ok) throw new Error(`PingOne auth failed: ${result.error}`);
    return `Bearer ${result.data.accessToken}`;
  };
}

/**
 * Clear the in-memory token cache.
 * Useful in tests and when rotating credentials.
 */
function clearTokenCache() {
  _tokenCache.clear();
}

module.exports = {
  buildApiBaseUrl,
  buildTokenUrl,
  fetchToken,
  getAuthHeader,
  clearTokenCache,
  API_HOSTS,
  AUTH_HOSTS,
};
