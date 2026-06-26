'use strict';

/**
 * @module lib/foundry/auth
 * Token acquisition for Azure AI Foundry. Mirrors the tokenCache pattern
 * from lib/graph-security/auth.js (Map-based, 5-min early-refresh buffer).
 *
 * No external dependencies — uses only Node 18+ built-ins (child_process).
 */

const { execSync } = require('child_process');

const CACHE_KEY = 'foundry:cognitiveservices';

// API key entries have no real expiry — use a far-future TTL (1 year).
const FAR_FUTURE_EXPIRY_SECONDS = 365 * 24 * 60 * 60;

/** @type {Map<string, {token: string, expiresAt: number}>} */
const tokenCache = new Map();

/**
 * Checks whether a cached token exists and is still valid (with 5-min buffer).
 * Mirrors getCachedToken() from lib/graph-security/auth.js.
 *
 * @param {string} cacheKey
 * @returns {{token: string} | null}
 */
function getCachedToken(cacheKey) {
  const entry = tokenCache.get(cacheKey);
  if (!entry) return null;
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry
  if (Date.now() >= entry.expiresAt - bufferMs) {
    tokenCache.delete(cacheKey);
    return null;
  }
  return { token: entry.token };
}

/**
 * Stores a token in the in-memory cache.
 * Mirrors cacheToken() from lib/graph-security/auth.js.
 *
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
 * Clears the token cache. Useful for testing or forced re-auth.
 */
function clearTokenCache() {
  tokenCache.clear();
}

/**
 * Acquire a Foundry bearer token. Resolution order:
 *
 *   1. In-memory cache (5-min buffer before expiry)
 *   2. FOUNDRY_API_KEY env var — if set and non-empty, cached with far-future expiry
 *   3. Azure CLI: `az account get-access-token --resource https://cognitiveservices.azure.com`
 *
 * NEVER throws. Returns {ok: true, token} or {ok: false, error: string}.
 *
 * @param {object} [opts]
 * @param {Function} [opts.execFn] Injectable exec function for testing.
 *   Defaults to child_process.execSync.
 *   Signature: (cmd: string, options: object) => Buffer | string
 *   Pass a fake to avoid real az CLI calls in unit tests:
 *     getFoundryToken({ execFn: (cmd) => '{"token":"fake","expiry":"2099-01-01 00:00:00.000000"}' })
 *
 * @returns {{ok: true, token: string} | {ok: false, error: string}}
 */
function getFoundryToken({ execFn } = {}) {
  try {
    // 1. Check in-memory cache
    const cached = getCachedToken(CACHE_KEY);
    if (cached) return { ok: true, token: cached.token };

    // 2. FOUNDRY_API_KEY env var
    const apiKey = process.env.FOUNDRY_API_KEY;
    if (apiKey && apiKey.trim()) {
      cacheToken(CACHE_KEY, apiKey.trim(), FAR_FUTURE_EXPIRY_SECONDS);
      return { ok: true, token: apiKey.trim() };
    }

    // 3. Azure CLI
    const exec = execFn || execSync;
    const cmd =
      'az account get-access-token' +
      ' --resource https://cognitiveservices.azure.com' +
      ' --query "{token:accessToken,expiry:expiresOn}"' +
      ' -o json';

    let raw;
    try {
      raw = exec(cmd, { timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (msg.includes('az: command not found') || msg.includes('is not recognized')) {
        return {
          ok: false,
          error:
            'Azure CLI (az) not found. Install from https://aka.ms/installazurecli or set FOUNDRY_API_KEY.',
        };
      }
      if (msg.includes('AADSTS') || msg.includes('not logged') || msg.includes('az login')) {
        return { ok: false, error: 'Not logged in to Azure. Run: az login' };
      }
      return { ok: false, error: `az account get-access-token failed: ${msg}` };
    }

    const output = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);

    let parsed;
    try {
      parsed = JSON.parse(output.trim());
    } catch {
      return { ok: false, error: `Could not parse az token output: ${output.slice(0, 200)}` };
    }

    if (!parsed || !parsed.token) {
      return { ok: false, error: 'az token output missing "token" field' };
    }

    // Parse expiry — az may return "YYYY-MM-DD HH:MM:SS.ffffff" or ISO8601
    let expiresInSeconds = 3600; // fallback: 1 hour
    if (parsed.expiry) {
      const expiryMs = Date.parse(parsed.expiry);
      if (!isNaN(expiryMs)) {
        expiresInSeconds = Math.max(60, Math.floor((expiryMs - Date.now()) / 1000));
      }
    }

    cacheToken(CACHE_KEY, parsed.token, expiresInSeconds);
    return { ok: true, token: parsed.token };
  } catch (err) {
    return {
      ok: false,
      error: `Unexpected error in getFoundryToken: ${err && err.message ? err.message : String(err)}`,
    };
  }
}

module.exports = {
  getFoundryToken,
  clearTokenCache,
  // exported for testing
  getCachedToken,
  cacheToken,
};
