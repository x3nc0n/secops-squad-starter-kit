'use strict';

/**
 * @module lib/ping/utils
 * Shared HTTP helpers for the Ping Identity API clients.
 *
 * Handles authenticated requests for both PingOne cloud (Bearer token) and
 * on-prem PingFederate/PingDirectory/PingAccess (Basic Auth), XSRF header
 * injection for PF writes, Link/HAL pagination, rate-limit back-off, and
 * consistent error shaping.
 *
 * Internal module — not exported from the public API directly.
 * Zero npm dependencies beyond js-yaml (which is not used here).
 */

/** Maximum automatic retries on HTTP 429. */
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Error shaping
// ---------------------------------------------------------------------------

/**
 * Shapes a non-OK response into the standard error result object.
 *
 * @param {number} status - HTTP status code
 * @param {object|null} body - Parsed response body (or null)
 * @returns {{ok: false, error: string, status: number}}
 */
function shapeError(status, body) {
  const message =
    body?.message ||
    body?.detail ||
    body?.error_description ||
    body?.errorSummary ||
    friendlyStatus(status);
  const result = { ok: false, error: message, status };
  if (body?.code) result.errorCode = body.code;
  return result;
}

/**
 * Human-readable fallback messages for common HTTP status codes.
 * @param {number} status
 * @returns {string}
 */
function friendlyStatus(status) {
  const map = {
    400: 'Bad request — check query parameters and request body',
    401: 'Unauthorized — credentials or token is missing, expired, or invalid',
    403: 'Forbidden — insufficient permissions for this operation',
    404: 'Resource not found',
    405: 'Method not allowed',
    409: 'Conflict — resource already exists or was modified by another request',
    429: 'Rate limited — too many requests. Retry after the suggested interval.',
    500: 'Internal server error — retry the request',
    502: 'Bad gateway — the service is temporarily unavailable',
    503: 'Service unavailable — retry after a short delay',
  };
  return map[status] || `Request failed with status ${status}`;
}

// ---------------------------------------------------------------------------
// Sleep helper
// ---------------------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// PingOne cloud request (Bearer token)
// ---------------------------------------------------------------------------

/**
 * Performs an authenticated PingOne API request with automatic retry on 429.
 *
 * PingOne uses Bearer tokens obtained via client_credentials (Worker App).
 * The `client.getAuthHeader()` function is expected to return a valid
 * `Authorization: Bearer <token>` string.
 *
 * @param {object} client - PingOne client with { getAuthHeader: async () => string|null, baseUrl: string }
 * @param {string} method - HTTP method
 * @param {string} url - Full URL to request
 * @param {object} [body] - JSON request body (for POST/PUT/PATCH)
 * @param {number} [retryCount=0]
 * @returns {Promise<{ok: true, data: any, nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function pingRequest(client, method, url, body, retryCount = 0) {
  const authHeader = await client.getAuthHeader();
  if (!authHeader) {
    return { ok: false, error: 'Failed to acquire PingOne authentication header' };
  }

  const headers = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const fetchOptions = { method, headers };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOptions);

    if (res.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfterSecs = parseInt(res.headers.get('Retry-After') || '1', 10);
      const delayMs = retryAfterSecs * 1000 * Math.pow(2, retryCount) + Math.random() * 500;
      await sleep(delayMs);
      return pingRequest(client, method, url, body, retryCount + 1);
    }

    if (res.status === 204) {
      return { ok: true };
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    }

    if (!res.ok) {
      return shapeError(res.status, data);
    }

    const result = { ok: true, data };

    // PingOne uses HAL _links.next for pagination
    if (data?._links?.next?.href) {
      result.nextLink = data._links.next.href;
    }

    // Also handle standard Link header for any endpoint that uses it
    const linkHeader = res.headers.get('link');
    if (linkHeader && !result.nextLink) {
      const nextLink = extractNextLink(linkHeader);
      if (nextLink) result.nextLink = nextLink;
    }

    return result;
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// PingFederate admin request (Basic Auth + XSRF on non-GET)
// ---------------------------------------------------------------------------

/**
 * Performs an authenticated PingFederate Admin API request.
 *
 * Auth: HTTP Basic (username:password base64-encoded).
 * XSRF: non-GET requests include `X-XSRF-Header: PingFederate` header.
 * Phase 1 is read-only (GET only), but pfRequest handles all methods
 * so write operations can be added in Phase 2 without changing the helper.
 *
 * @param {object} pfClient - PF client with { adminUrl, getAuthHeader: () => string }
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g. '/pf-admin-api/v1/sp/connections')
 * @param {object} [body] - JSON request body
 * @param {number} [retryCount=0]
 * @returns {Promise<{ok: true, data: any} | {ok: false, error: string, status?: number}>}
 */
async function pfRequest(pfClient, method, path, body, retryCount = 0) {
  const authHeader = pfClient.getAuthHeader();
  if (!authHeader) {
    return { ok: false, error: 'Failed to acquire PingFederate authentication header' };
  }

  const url = `${pfClient.adminUrl.replace(/\/+$/, '')}${path}`;

  const headers = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // XSRF required on all non-GET requests (PingFederate static-value model)
  if (method !== 'GET') {
    headers['X-XSRF-Header'] = 'PingFederate';
  }

  const fetchOptions = { method, headers };
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, fetchOptions);

    if (res.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfterSecs = parseInt(res.headers.get('Retry-After') || '1', 10);
      const delayMs = retryAfterSecs * 1000 * Math.pow(2, retryCount) + Math.random() * 500;
      await sleep(delayMs);
      return pfRequest(pfClient, method, path, body, retryCount + 1);
    }

    if (res.status === 204) {
      return { ok: true };
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    }

    if (!res.ok) {
      return shapeError(res.status, data);
    }

    const result = { ok: true, data };

    // PF uses startIndex/count pagination (not Link headers); callers handle it
    return result;
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Link-header cursor pagination (RFC 5988)
// ---------------------------------------------------------------------------

/**
 * Extracts the `next` cursor URL from the HTTP Link header.
 * @param {string|null} linkHeader
 * @returns {string|null}
 */
function extractNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(/,\s*(?=<)/);
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paginated GET (HAL _links or Link header)
// ---------------------------------------------------------------------------

/**
 * Fetches all pages of a paginated list endpoint and collects all items.
 *
 * Handles both:
 * - HAL `_links.next` (PingOne Platform API)
 * - Link header rel="next" (RFC 5988)
 *
 * Items are extracted from the `_embedded` HAL envelope or the top-level array.
 *
 * @param {object} client - Any client with getAuthHeader (uses pingRequest internally)
 * @param {string} startUrl - Initial URL (with query params)
 * @param {object} [options]
 * @param {number} [options.maxPages=100]
 * @param {string} [options.embeddedKey] - HAL _embedded key to unwrap (e.g. 'users')
 * @returns {Promise<{ok: true, data: any[]} | {ok: false, error: string, status?: number}>}
 */
async function paginatedGet(client, startUrl, options = {}) {
  const maxPages = options.maxPages || 100;
  const embeddedKey = options.embeddedKey;
  const allItems = [];
  let url = startUrl;
  let page = 0;

  while (url && page < maxPages) {
    const result = await pingRequest(client, 'GET', url);
    if (!result.ok) return result;

    const d = result.data;
    if (embeddedKey && d?._embedded?.[embeddedKey]) {
      // HAL envelope unwrap
      const items = d._embedded[embeddedKey];
      allItems.push(...(Array.isArray(items) ? items : [items]));
    } else if (Array.isArray(d)) {
      allItems.push(...d);
    } else if (d) {
      allItems.push(d);
    }

    url = result.nextLink || null;
    page++;
  }

  return { ok: true, data: allItems };
}

module.exports = {
  pingRequest,
  pfRequest,
  paginatedGet,
  shapeError,
  extractNextLink,
  sleep,
  MAX_RETRIES,
};
