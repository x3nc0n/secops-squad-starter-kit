'use strict';

/**
 * @module utils
 * Shared HTTP helpers for the Okta API client.
 * Handles org-URL normalization, authenticated requests, Link-header
 * cursor pagination, rate-limit back-off (X-Rate-Limit-* headers / HTTP 429),
 * and consistent error shaping.
 *
 * Internal module — not exported from the public API.
 */

/** Maximum automatic retries on HTTP 429. */
const MAX_RETRIES = 3;

/**
 * Normalizes an Okta org URL: trims whitespace, strips ALL trailing slashes,
 * and prepends https:// when no scheme is present.
 * Does NOT validate domain format — callers should validate at config time.
 *
 * @param {string} orgUrl - Raw org URL (e.g. https://acme.okta.com/ or dev-123456.okta.com)
 * @returns {string} Normalized URL with https:// scheme and no trailing slashes
 * @throws {Error} If orgUrl is missing or not a string
 */
function normalizeOrgUrl(orgUrl) {
  if (!orgUrl || typeof orgUrl !== 'string') {
    throw new Error('orgUrl is required and must be a non-empty string');
  }
  let url = orgUrl.trim().replace(/\/+$/, '');
  if (!url.match(/^https?:\/\//)) url = 'https://' + url;
  return url;
}

/**
 * Extracts the `next` cursor URL from the HTTP Link header.
 * Okta uses: Link: <url>; rel="next", <url>; rel="self"
 *
 * @param {string|null} linkHeader - Value of the Link response header
 * @returns {string|null} The "next" URL or null if absent
 */
function extractNextLink(linkHeader) {
  if (!linkHeader) return null;
  // Split on comma but only when followed by a space and angle-bracket (to avoid splitting inside URLs)
  const parts = linkHeader.split(/,\s*(?=<)/);
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Shapes a non-OK response into the standard error result object.
 *
 * @param {number} status - HTTP status code
 * @param {object|null} body - Parsed response body (Okta error format or null)
 * @returns {{ok: false, error: string, status: number, errorCode?: string, errorSummary?: string}}
 */
function shapeError(status, body) {
  const errorCode = body?.errorCode;
  const errorSummary = body?.errorSummary || body?.message || friendlyStatus(status);
  const result = { ok: false, error: errorSummary, status };
  if (errorCode) result.errorCode = errorCode;
  if (body?.errorCauses?.length) result.errorCauses = body.errorCauses;
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
    401: 'Unauthorized — API token or OAuth token is missing, expired, or invalid',
    403: 'Forbidden — insufficient scopes or permissions for this operation',
    404: 'Resource not found',
    405: 'Method not allowed',
    409: 'Conflict — resource already exists or was modified by another request',
    429: 'Rate limited — too many requests. Retry after the X-Rate-Limit-Reset interval.',
    500: 'Internal server error — retry the request',
    502: 'Bad gateway — the Okta service is temporarily unavailable',
    503: 'Service unavailable — retry after a short delay',
  };
  return map[status] || `Request failed with status ${status}`;
}

/**
 * Performs an authenticated Okta API request with automatic retry on 429.
 *
 * Respects:
 * - `X-Rate-Limit-Remaining`: warns if approaching limit (≤10 remaining)
 * - `X-Rate-Limit-Reset`: Unix epoch at which the rate-limit window resets
 * - Exponential back-off with `Retry-After` or `X-Rate-Limit-Reset` guidance
 *
 * @param {import('./index').OktaClient} client - Authenticated Okta client
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {string} url - Full URL to request
 * @param {object} [body] - JSON request body (for POST/PUT)
 * @param {number} [retryCount=0] - Current retry depth (internal use)
 * @returns {Promise<{ok: true, data: any, nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function oktaRequest(client, method, url, body, retryCount = 0) {
  const authHeader = await client.getAuthHeader();
  if (!authHeader) {
    return { ok: false, error: 'Failed to acquire Okta authentication header' };
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

    // Rate limited — back off and retry
    if (res.status === 429 && retryCount < MAX_RETRIES) {
      const resetEpoch = parseInt(res.headers.get('X-Rate-Limit-Reset') || '0', 10);
      const retryAfterSecs = parseInt(res.headers.get('Retry-After') || '1', 10);

      let delayMs;
      if (resetEpoch > 0) {
        // Wait until the rate-limit window resets, plus a small jitter
        const nowSecs = Math.floor(Date.now() / 1000);
        const waitSecs = Math.max(resetEpoch - nowSecs, 1);
        delayMs = waitSecs * 1000 + Math.random() * 500;
      } else {
        // Exponential back-off using Retry-After as the base
        delayMs = retryAfterSecs * 1000 * Math.pow(2, retryCount);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return oktaRequest(client, method, url, body, retryCount + 1);
    }

    // 204 No Content (e.g., lifecycle transitions)
    if (res.status === 204) {
      return { ok: true };
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        data = await res.json();
      } catch {
        data = null;
      }
    }

    if (!res.ok) {
      return shapeError(res.status, data);
    }

    const result = { ok: true, data };

    // Attach pagination cursor if present
    const linkHeader = res.headers.get('link');
    const nextLink = extractNextLink(linkHeader);
    if (nextLink) result.nextLink = nextLink;

    return result;
  } catch (err) {
    return { ok: false, error: `Network error: ${err.message}` };
  }
}

/**
 * Performs an authenticated Okta GET request.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} url - Full URL (including query string)
 * @returns {Promise<{ok: true, data: any, nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function oktaGet(client, url) {
  return oktaRequest(client, 'GET', url);
}

/**
 * Performs an authenticated Okta POST request.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ok: true, data: any} | {ok: false, error: string, status?: number}>}
 */
async function oktaPost(client, url, body) {
  return oktaRequest(client, 'POST', url, body);
}

/**
 * Performs an authenticated Okta PUT request.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} url
 * @param {object} body
 * @returns {Promise<{ok: true, data: any} | {ok: false, error: string, status?: number}>}
 */
async function oktaPut(client, url, body) {
  return oktaRequest(client, 'PUT', url, body);
}

/**
 * Fetches all pages of a paginated Okta list endpoint and collects all items.
 *
 * Uses Link-header rel="next" cursor navigation. Stops when no nextLink is
 * returned or when `options.maxPages` is reached (default: 100).
 *
 * @param {import('./index').OktaClient} client
 * @param {string} startUrl - Initial URL (with query params)
 * @param {object} [options]
 * @param {number} [options.maxPages=100] - Safety limit on pages fetched
 * @returns {Promise<{ok: true, data: any[]} | {ok: false, error: string, status?: number}>}
 */
async function paginatedGet(client, startUrl, options = {}) {
  const maxPages = options.maxPages || 100;
  const allItems = [];
  let url = startUrl;
  let page = 0;

  while (url && page < maxPages) {
    const result = await oktaGet(client, url);
    if (!result.ok) return result;

    if (Array.isArray(result.data)) {
      allItems.push(...result.data);
    } else if (result.data) {
      allItems.push(result.data);
    }

    url = result.nextLink || null;
    page++;
  }

  return { ok: true, data: allItems };
}

module.exports = {
  normalizeOrgUrl,
  extractNextLink,
  shapeError,
  oktaGet,
  oktaPost,
  oktaPut,
  oktaRequest,
  paginatedGet,
};
