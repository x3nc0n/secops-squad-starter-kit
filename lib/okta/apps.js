'use strict';

/**
 * @module apps
 * Application management via the Okta Core API.
 *
 * Critical for SAML and OIDC migration analysis. Covers listing/getting
 * applications, reading SAML and OIDC settings, and enumerating app
 * user/group assignments.
 *
 * All functions return `{ok, data?, error?, status?}` — never throw.
 *
 * @see https://developer.okta.com/docs/reference/api/apps/
 */

const { oktaGet, paginatedGet } = require('./utils');

/**
 * Lists applications in the Okta org.
 *
 * @param {import('./index').OktaClient} client
 * @param {object} [options]
 * @param {string} [options.filter] - Okta filter expression (e.g. 'status eq "ACTIVE"')
 * @param {string} [options.q] - Query string for name startsWith search
 * @param {string} [options.expand] - Comma-separated list of linked objects to expand (e.g. 'app,retention')
 * @param {number} [options.limit=200] - Page size (max 200)
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listApps(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  if (options.q) params.set('q', options.q);
  if (options.expand) params.set('expand', options.expand);
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/apps?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves a single application by ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID (0oa...)
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getApp(client, appId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/apps/${encodeURIComponent(appId)}`;
  return oktaGet(client, url);
}

/**
 * Returns the SAML 2.0 settings for an application.
 * Extracts the `settings.signOn` object from the app response, which contains
 * the ACS URL, Entity ID, attribute statements, and certificate details.
 *
 * Returns `{ok: false, error: '...'}` if the app does not use SAML_2_0 sign-on mode.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID
 * @returns {Promise<{ok: true, data: {signOnMode: string, settings: object, credentials: object}} | {ok: false, error: string, status?: number}>}
 */
async function getAppSamlSettings(client, appId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  const result = await getApp(client, appId);
  if (!result.ok) return result;

  const app = result.data;
  if (app.signOnMode !== 'SAML_2_0') {
    return {
      ok: false,
      error: `App "${app.label}" uses signOnMode "${app.signOnMode}", not SAML_2_0`,
      status: 422,
    };
  }

  return {
    ok: true,
    data: {
      id: app.id,
      label: app.label,
      status: app.status,
      signOnMode: app.signOnMode,
      settings: app.settings?.signOn || {},
      credentials: app.credentials?.signing || {},
      visibility: app.visibility,
    },
  };
}

/**
 * Returns the OIDC/OAuth 2.0 settings for an application.
 * Extracts grant types, redirect URIs, post-logout URIs, and token settings
 * from `settings.oauthClient`.
 *
 * Returns `{ok: false, error: '...'}` if the app does not use OPENID_CONNECT sign-on mode.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getAppOidcSettings(client, appId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  const result = await getApp(client, appId);
  if (!result.ok) return result;

  const app = result.data;
  if (app.signOnMode !== 'OPENID_CONNECT') {
    return {
      ok: false,
      error: `App "${app.label}" uses signOnMode "${app.signOnMode}", not OPENID_CONNECT`,
      status: 422,
    };
  }

  return {
    ok: true,
    data: {
      id: app.id,
      label: app.label,
      status: app.status,
      signOnMode: app.signOnMode,
      clientId: app.credentials?.oauthClient?.client_id,
      tokenEndpointAuthMethod: app.credentials?.oauthClient?.token_endpoint_auth_method,
      oauthClient: app.settings?.oauthClient || {},
      visibility: app.visibility,
    },
  };
}

/**
 * Lists users assigned directly to an application.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID
 * @param {object} [options]
 * @param {number} [options.limit=200] - Page size
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listAppUsers(client, appId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/apps/${encodeURIComponent(appId)}/users?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Lists groups assigned to an application.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID
 * @param {object} [options]
 * @param {number} [options.limit=200] - Page size
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listAppGroups(client, appId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/apps/${encodeURIComponent(appId)}/groups?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves metadata for an application's SAML certificate.
 * Fetches the app's key credentials used for SAML signing.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} appId - Okta application ID
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function listAppKeys(client, appId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/apps/${encodeURIComponent(appId)}/credentials/keys`;
  return oktaGet(client, url);
}

module.exports = {
  listApps,
  getApp,
  getAppSamlSettings,
  getAppOidcSettings,
  listAppUsers,
  listAppGroups,
  listAppKeys,
};
