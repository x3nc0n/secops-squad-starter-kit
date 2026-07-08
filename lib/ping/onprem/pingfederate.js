'use strict';

/**
 * @module onprem/pingfederate
 * PingFederate Admin API — read-only discovery module.
 * Covers SP connections (SAML), OAuth clients, server settings, and
 * password credential validators. GET only — no writes in Phase 1.
 *
 * All functions return {ok, data?, error?, status?} — never throw.
 *
 * Auth: HTTP Basic Auth (Authorization: Basic base64(user:pass))
 * XSRF: NOT required for GET requests (confirmed via PingFederate docs)
 * Base path: /pf-admin-api/v1/  (port 9999 by default)
 *
 * Pagination: PingFederate uses ?page=N&numberPerPage=N (1-based).
 * Functions with fetchAll: true auto-page until items.length < numberPerPage.
 *
 * @see https://docs.pingidentity.com/r/en-us/pingfederate-112/pf_pf_admin_api_ref
 */

const { pfRequest, shapeError } = require('../utils');

const DEFAULT_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// SP Connections (SAML IdP → SP federation)
// ---------------------------------------------------------------------------

/**
 * List all SP connections (SAML service provider connections).
 * These are the SAML integrations PingFederate issues assertions for.
 * Each connection has a NameID format and attribute mapping — critical for migration.
 *
 * @param {object} client                    — client.onprem.pingfederate sub-client: { adminUrl, getAuthHeader }
 * @param {object} [options]
 * @param {number} [options.page=1]           — 1-based page number
 * @param {number} [options.numberPerPage=100]
 * @param {string} [options.filter]           — Optional filter string (by entityId, name, etc.)
 * @param {boolean} [options.fetchAll=false]  — Auto-page through all connections
 * @returns {Promise<{ok: true, data: object[], totalCount?: number} | {ok: false, error: string, status?: number}>}
 */
async function listSpConnections(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const numberPerPage = options.numberPerPage || DEFAULT_PAGE_SIZE;

  if (options.fetchAll) {
    return _pfPaginateAll(client, '/pf-admin-api/v1/idp/spConnections', numberPerPage, options.filter);
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('numberPerPage', String(numberPerPage));
  if (options.filter) params.set('filter', options.filter);

  const path = `/pf-admin-api/v1/idp/spConnections?${params.toString()}`;
  const result = await pfRequest(client, 'GET', path);
  if (!result.ok) return result;
  return { ok: true, data: result.data?.items || [], totalCount: result.data?.totalCount };
}

/**
 * Get a single SP connection by ID.
 * Returns full connection config including spBrowserSso, nameIdFormat, attributeSources.
 * The NameID format lives at: spBrowserSso.ssoServiceEndpoints[0].nameIdFormat or
 * spBrowserSso.nameIdPolicyConfig.format — check live instance.
 *
 * @param {object} client
 * @param {string} connectionId  — SP connection ID (e.g. "salesforce-prod")
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getSpConnection(client, connectionId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!connectionId || typeof connectionId !== 'string') {
    return { ok: false, error: 'connectionId is required and must be a non-empty string' };
  }

  const path = `/pf-admin-api/v1/idp/spConnections/${encodeURIComponent(connectionId)}`;
  const result = await pfRequest(client, 'GET', path);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// OAuth Clients
// ---------------------------------------------------------------------------

/**
 * List all OAuth/OIDC clients registered in PingFederate.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=100]
 * @param {boolean} [options.fetchAll=false]
 * @returns {Promise<{ok: true, data: object[], totalCount?: number} | {ok: false, error: string, status?: number}>}
 */
async function listOauthClients(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const numberPerPage = options.numberPerPage || DEFAULT_PAGE_SIZE;

  if (options.fetchAll) {
    return _pfPaginateAll(client, '/pf-admin-api/v1/oauth/clients', numberPerPage);
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('numberPerPage', String(numberPerPage));

  const path = `/pf-admin-api/v1/oauth/clients?${params.toString()}`;
  const result = await pfRequest(client, 'GET', path);
  if (!result.ok) return result;
  return { ok: true, data: result.data?.items || [], totalCount: result.data?.totalCount };
}

/**
 * Get a single OAuth client by client ID.
 *
 * @param {object} client
 * @param {string} oauthClientId
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getOauthClient(client, oauthClientId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!oauthClientId || typeof oauthClientId !== 'string') {
    return { ok: false, error: 'oauthClientId is required and must be a non-empty string' };
  }

  const path = `/pf-admin-api/v1/oauth/clients/${encodeURIComponent(oauthClientId)}`;
  const result = await pfRequest(client, 'GET', path);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Server Settings
// ---------------------------------------------------------------------------

/**
 * Get PingFederate server settings (global configuration).
 * Includes roles (IdP, SP, AA enabled/disabled), contact info, notification settings.
 * Use to determine which capabilities are active before planning migration.
 *
 * @param {object} client
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getServerSettings(client) {
  if (!client) return { ok: false, error: 'client is required' };

  const result = await pfRequest(client, 'GET', '/pf-admin-api/v1/serverSettings');
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ---------------------------------------------------------------------------
// Password Credential Validators
// ---------------------------------------------------------------------------

/**
 * List all password credential validators configured in PingFederate.
 * Validators define how PF authenticates user credentials (LDAP, JDBC, etc.).
 * Enumerate these to understand the authentication backend before migration.
 *
 * @param {object} client
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=100]
 * @param {boolean} [options.fetchAll=false]
 * @returns {Promise<{ok: true, data: object[], totalCount?: number} | {ok: false, error: string, status?: number}>}
 */
async function listPasswordCredentialValidators(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const numberPerPage = options.numberPerPage || DEFAULT_PAGE_SIZE;

  if (options.fetchAll) {
    return _pfPaginateAll(client, '/pf-admin-api/v1/passwordCredentialValidators', numberPerPage);
  }

  const params = new URLSearchParams();
  params.set('page', String(options.page || 1));
  params.set('numberPerPage', String(numberPerPage));

  const path = `/pf-admin-api/v1/passwordCredentialValidators?${params.toString()}`;
  const result = await pfRequest(client, 'GET', path);
  if (!result.ok) return result;
  return { ok: true, data: result.data?.items || [], totalCount: result.data?.totalCount };
}

// ---------------------------------------------------------------------------
// OpenAPI Spec (live fetch from instance)
// ---------------------------------------------------------------------------

/**
 * Fetch the live OpenAPI/Swagger spec from the PingFederate instance.
 * Returns parsed JSON. Probes two known paths in order:
 *   1. /pf-admin-api/api-docs  (confirmed path per docs)
 *   2. /pf-admin-api/v1/swagger.json  (fallback — some versions)
 *
 * NEVER vendor a static spec copy. PF API surface varies per version and
 * may include customer-specific extensions. Always fetch live.
 *
 * @param {object} client  — client.onprem.pingfederate sub-client
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function fetchOpenApiSpec(client) {
  if (!client) return { ok: false, error: 'client is required' };

  const candidates = [
    '/pf-admin-api/api-docs',
    '/pf-admin-api/v1/swagger.json',
  ];

  let lastError;
  for (const path of candidates) {
    const result = await pfRequest(client, 'GET', path);
    if (result.ok) return { ok: true, data: result.data };
    lastError = result;
  }

  return {
    ok: false,
    error: `fetchOpenApiSpec: could not retrieve spec from either candidate path. ` +
      `Confirm adminUrl is reachable and credentials are valid. ` +
      `Last error: ${lastError?.error || 'unknown'}`,
    status: lastError?.status,
  };
}

// ---------------------------------------------------------------------------
// Internal pagination helper (PF page/numberPerPage style)
// ---------------------------------------------------------------------------

/**
 * Auto-paginate a PingFederate list endpoint until all items are collected.
 * PF response shape: { items: [...], totalCount: N }
 * Stops when a page returns fewer items than numberPerPage (last page).
 *
 * @param {object} client
 * @param {string} basePath   — path without adminUrl and without query params
 * @param {number} pageSize
 * @param {string} [filter]
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function _pfPaginateAll(client, basePath, pageSize, filter) {
  const all = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('numberPerPage', String(pageSize));
    if (filter) params.set('filter', filter);

    const path = `${basePath}?${params.toString()}`;
    const result = await pfRequest(client, 'GET', path);
    if (!result.ok) return result;

    const items = result.data?.items || [];
    all.push(...items);

    if (items.length < pageSize) break; // last page
    page += 1;
  }

  return { ok: true, data: all };
}

module.exports = {
  listSpConnections,
  getSpConnection,
  listOauthClients,
  getOauthClient,
  getServerSettings,
  listPasswordCredentialValidators,
  fetchOpenApiSpec,
};
