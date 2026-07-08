'use strict';

/**
 * @module onprem/pingdirectory
 * PingDirectory SCIM v2 read module.
 * Covers user and group discovery via the SCIM 2.0 API.
 *
 * All functions return {ok, data?, error?, status?} — never throw.
 *
 * Auth: HTTP Basic Auth (Authorization: Basic base64(user:pass))
 * Protocol: SCIM 2.0 — RFC 7644
 * Base path: /scim/v2/  (port varies by deployment — confirm with customer)
 *
 * SCIM pagination: startIndex (1-based), count, totalResults.
 * Functions with fetchAll: true auto-page until all resources collected.
 *
 * Note: PingDirectory SCIM port is deployment-specific (no confirmed default).
 * The scimUrl on the client object must include the correct scheme, host, and port,
 * e.g. 'https://pd.corp.example.com:8443/scim/v2' or 'https://pd.corp.example.com/scim/v2'.
 * Confirm with the customer's PingDirectory configuration before running discovery.
 *
 * @see https://docs.pingidentity.com/r/en-us/pingdirectory-93/pd_ds_overview_scim
 */

const { pingRequest, shapeError } = require('../utils');

const DEFAULT_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Users (SCIM /Users)
// ---------------------------------------------------------------------------

/**
 * List users via SCIM v2.
 * Returns the `Resources` array from the SCIM ListResponse.
 *
 * @param {object} client                    — client.onprem.pingdirectory sub-client: { scimUrl, getAuthHeader }
 * @param {object} [options]
 * @param {number} [options.startIndex=1]    — 1-based start index for pagination
 * @param {number} [options.count=100]       — Page size
 * @param {string} [options.filter]          — SCIM filter expression (e.g. 'userName eq "alice"')
 * @param {string} [options.attributes]      — Comma-separated attribute list to return
 * @param {boolean} [options.fetchAll=false] — Auto-page until all users collected
 * @returns {Promise<{ok: true, data: object[], totalResults?: number} | {ok: false, error: string, status?: number}>}
 */
async function listUsers(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const count = options.count || DEFAULT_PAGE_SIZE;

  if (options.fetchAll) {
    return _scimPaginateAll(client, 'Users', count, options.filter, options.attributes);
  }

  const params = new URLSearchParams();
  params.set('startIndex', String(options.startIndex || 1));
  params.set('count', String(count));
  if (options.filter)     params.set('filter', options.filter);
  if (options.attributes) params.set('attributes', options.attributes);

  const url = `${client.scimUrl}/Users?${params.toString()}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;

  return {
    ok: true,
    data: result.data?.Resources || [],
    totalResults: result.data?.totalResults,
  };
}

/**
 * Get a single SCIM user by ID.
 *
 * @param {object} client
 * @param {string} userId  — SCIM user ID (the `id` field from a listUsers result)
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getUser(client, userId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId is required and must be a non-empty string' };
  }

  const url = `${client.scimUrl}/Users/${encodeURIComponent(userId)}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Groups (SCIM /Groups)
// ---------------------------------------------------------------------------

/**
 * List groups via SCIM v2.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.startIndex=1]
 * @param {number} [options.count=100]
 * @param {string} [options.filter]
 * @param {string} [options.attributes]      — Comma-separated; use 'id,displayName' for lightweight inventory
 * @param {boolean} [options.fetchAll=false]
 * @returns {Promise<{ok: true, data: object[], totalResults?: number} | {ok: false, error: string, status?: number}>}
 */
async function listGroups(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const count = options.count || DEFAULT_PAGE_SIZE;

  if (options.fetchAll) {
    return _scimPaginateAll(client, 'Groups', count, options.filter, options.attributes);
  }

  const params = new URLSearchParams();
  params.set('startIndex', String(options.startIndex || 1));
  params.set('count', String(count));
  if (options.filter)     params.set('filter', options.filter);
  if (options.attributes) params.set('attributes', options.attributes);

  const url = `${client.scimUrl}/Groups?${params.toString()}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;

  return {
    ok: true,
    data: result.data?.Resources || [],
    totalResults: result.data?.totalResults,
  };
}

// ---------------------------------------------------------------------------
// Internal pagination helper (SCIM startIndex/count)
// ---------------------------------------------------------------------------

/**
 * Auto-paginate a SCIM list endpoint until totalResults are collected.
 * SCIM response shape: { totalResults, startIndex, itemsPerPage, Resources: [...] }
 *
 * @param {object} client
 * @param {string} resource     — 'Users' | 'Groups'
 * @param {number} pageSize
 * @param {string} [filter]
 * @param {string} [attributes]
 * @returns {Promise<{ok: true, data: object[], totalResults: number} | {ok: false, error: string, status?: number}>}
 */
async function _scimPaginateAll(client, resource, pageSize, filter, attributes) {
  const all = [];
  let startIndex = 1;
  let totalResults = null;

  while (true) {
    const params = new URLSearchParams();
    params.set('startIndex', String(startIndex));
    params.set('count', String(pageSize));
    if (filter)     params.set('filter', filter);
    if (attributes) params.set('attributes', attributes);

    const url = `${client.scimUrl}/${resource}?${params.toString()}`;
    const result = await pingRequest(client, 'GET', url);
    if (!result.ok) return result;

    const resources = result.data?.Resources || [];
    if (totalResults === null) totalResults = result.data?.totalResults ?? null;

    all.push(...resources);

    // Stop when we've collected everything or this page is empty
    if (resources.length < pageSize) break;
    if (totalResults !== null && all.length >= totalResults) break;

    startIndex += pageSize;
  }

  return { ok: true, data: all, totalResults: totalResults ?? all.length };
}

module.exports = {
  listUsers,
  getUser,
  listGroups,
};
