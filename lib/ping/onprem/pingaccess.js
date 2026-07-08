'use strict';

/**
 * @module onprem/pingaccess
 * PingAccess Admin API — read-only discovery module.
 * Covers resources, applications, and server version.
 *
 * All functions return {ok, data?, error?, status?} — never throw.
 *
 * Auth: Session-cookie via POST /pa-admin-api/v3/login.
 * Call login() once; cookie is carried on subsequent requests.
 *
 * XSRF protection (confirmed pattern per spec Section 1.4):
 *   - Login response sets XSRF-TOKEN cookie.
 *   - Mutative requests (POST/PUT/DELETE) must echo XSRF-TOKEN cookie value
 *     as the X-XSRF-TOKEN request header (cookie-echo pattern).
 *   - GET requests do NOT require XSRF header.
 *
 * ⚠️  UNCONFIRMED FALLBACK: Some PingAccess versions may use a static header
 *     'X-XSRF-Header: PingAccess' (mirroring PingFederate's static model).
 *     If the cookie-echo pattern fails on a live instance, add the static
 *     header as a fallback. Verify against a live PA instance before Phase 2.
 *
 * Base path: /pa-admin-api/v3/  (port 9000 by default — confirm per deployment)
 *
 * @see https://docs.pingidentity.com/r/en-us/pingaccess-72/pa_admin_api_ref
 */

const { shapeError } = require('../utils');

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Log in to PingAccess admin API and obtain session cookie + XSRF token.
 * Returns a session object that is passed to all other module functions.
 *
 * @param {object} client    — client.onprem.pingaccess sub-client: { adminUrl, username, password }
 * @returns {Promise<{ok: true, data: {cookie: string, xsrfToken: string}} | {ok: false, error: string, status?: number}>}
 */
async function login(client) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!client.adminUrl) return { ok: false, error: 'client.adminUrl is required' };
  if (!client.username) return { ok: false, error: 'client.username is required' };
  if (!client.password) return { ok: false, error: 'client.password is required' };

  const url = `${client.adminUrl}/pa-admin-api/v3/login`;
  const credentials = Buffer.from(`${client.username}:${client.password}`).toString('base64');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/json',
        'X-XSRF-Header': 'PingAccess', // static fallback per original research claim
      },
      body: JSON.stringify({ username: client.username, password: client.password }),
    });
  } catch (err) {
    return { ok: false, error: `PingAccess login network error: ${err.message}` };
  }

  if (!res.ok) {
    return { ok: false, error: `PingAccess login failed (HTTP ${res.status})`, status: res.status };
  }

  // Extract session cookie from Set-Cookie headers
  const setCookieHeader = res.headers.get('set-cookie') || '';
  const sessionCookie = _extractSessionCookie(setCookieHeader);
  const xsrfToken = _extractXsrfToken(setCookieHeader);

  if (!sessionCookie) {
    return { ok: false, error: 'PingAccess login succeeded but no session cookie was returned' };
  }

  return {
    ok: true,
    data: {
      cookie: sessionCookie,
      xsrfToken: xsrfToken || '',
    },
  };
}

// ---------------------------------------------------------------------------
// Read functions
// ---------------------------------------------------------------------------

/**
 * List resources (protected URLs/paths managed by PingAccess).
 *
 * @param {object} client
 * @param {object} session   — from login().data: { cookie, xsrfToken }
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=25]  — PA default is 25
 * @param {string} [options.filter]
 * @param {boolean} [options.fetchAll=false]
 * @returns {Promise<{ok: true, data: object[], totalCount?: number} | {ok: false, error: string, status?: number}>}
 */
async function listResources(client, session, options = {}) {
  if (!client)  return { ok: false, error: 'client is required' };
  if (!session) return { ok: false, error: 'session is required (call login() first)' };

  const numberPerPage = options.numberPerPage || 25;

  if (options.fetchAll) {
    return _paPaginateAll(client, session, '/pa-admin-api/v3/resources', numberPerPage, options.filter);
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('numberPerPage', String(numberPerPage));
  if (options.filter) params.set('filter', options.filter);

  const url = `${client.adminUrl}/pa-admin-api/v3/resources?${params.toString()}`;
  return _paGet(client, session, url);
}

/**
 * List applications registered in PingAccess.
 *
 * @param {object} client
 * @param {object} session
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=25]
 * @param {string} [options.filter]
 * @param {boolean} [options.fetchAll=false]
 * @returns {Promise<{ok: true, data: object[], totalCount?: number} | {ok: false, error: string, status?: number}>}
 */
async function listApplications(client, session, options = {}) {
  if (!client)  return { ok: false, error: 'client is required' };
  if (!session) return { ok: false, error: 'session is required (call login() first)' };

  const numberPerPage = options.numberPerPage || 25;

  if (options.fetchAll) {
    return _paPaginateAll(client, session, '/pa-admin-api/v3/applications', numberPerPage, options.filter);
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('numberPerPage', String(numberPerPage));
  if (options.filter) params.set('filter', options.filter);

  const url = `${client.adminUrl}/pa-admin-api/v3/applications?${params.toString()}`;
  return _paGet(client, session, url);
}

/**
 * Get PingAccess server version.
 * Use this to determine the PA API version before running discovery.
 *
 * @param {object} client
 * @param {object} session
 * @returns {Promise<{ok: true, data: {version: string}} | {ok: false, error: string, status?: number}>}
 */
async function getServerVersion(client, session) {
  if (!client)  return { ok: false, error: 'client is required' };
  if (!session) return { ok: false, error: 'session is required (call login() first)' };

  const url = `${client.adminUrl}/pa-admin-api/v3/version`;
  return _paGet(client, session, url);
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

/**
 * Perform a GET request to the PingAccess admin API using a session cookie.
 * GET requests do NOT require the XSRF token per spec Section 1.4.
 */
async function _paGet(client, session, url) {
  let res;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: {
        Cookie: session.cookie,
        Accept: 'application/json',
      },
    });
  } catch (err) {
    return { ok: false, error: `PingAccess request error: ${err.message}` };
  }

  if (res.status === 401) {
    return { ok: false, error: 'PingAccess session expired — call login() again', status: 401 };
  }

  if (!res.ok) {
    let body;
    try { body = await res.json(); } catch { body = null; }
    return shapeError(res.status, body?.message || `HTTP ${res.status}`, url);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: `PingAccess returned non-JSON (HTTP ${res.status})`, status: res.status };
  }

  return { ok: true, data };
}

/**
 * Auto-paginate a PingAccess list endpoint (page/numberPerPage style).
 * PA response shape: { items: [...], totalCount: N }
 */
async function _paPaginateAll(client, session, basePath, pageSize, filter) {
  const all = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('numberPerPage', String(pageSize));
    if (filter) params.set('filter', filter);

    const url = `${client.adminUrl}${basePath}?${params.toString()}`;
    const result = await _paGet(client, session, url);
    if (!result.ok) return result;

    const items = result.data?.items || [];
    all.push(...items);

    if (items.length < pageSize) break;
    page += 1;
  }

  return { ok: true, data: all };
}

/**
 * Extract the session cookie string from a Set-Cookie header value.
 * Returns the full cookie name=value pair(s) needed for subsequent requests.
 */
function _extractSessionCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // Set-Cookie may contain multiple cookies; grab everything before the first ';' per cookie
  const cookies = setCookieHeader
    .split(/,(?=[^;]+=[^;])/) // split on comma-separated cookies (rough heuristic)
    .map((c) => c.trim().split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  return cookies || null;
}

/**
 * Extract the XSRF-TOKEN value from a Set-Cookie header.
 * Used for the cookie-echo pattern: XSRF-TOKEN cookie value → X-XSRF-TOKEN header.
 */
function _extractXsrfToken(setCookieHeader) {
  if (!setCookieHeader) return null;
  const match = setCookieHeader.match(/XSRF-TOKEN=([^;,\s]+)/i);
  return match ? match[1] : null;
}

module.exports = {
  login,
  listResources,
  listApplications,
  getServerVersion,
};
