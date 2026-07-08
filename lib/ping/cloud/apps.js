'use strict';

/**
 * @module cloud/apps
 * PingOne application management via the Platform API.
 * Read-oriented: list all, list by type (SAML / OIDC), get full config.
 *
 * All functions return {ok, data?, error?, status?, nextLink?} — never throw.
 *
 * PingOne application protocol types:
 *   SAML   — SAML 2.0 SP-initiated or IdP-initiated (spSaml block)
 *   OIDC   — OpenID Connect / OAuth 2.0 (oidcOptions block)
 *   WS_FED — WS-Federation (legacy; not common in new deployments)
 *   EXTERNAL_LINK — link-only, no protocol
 *
 * NameID extraction:
 *   SAML apps carry their NameID format in spSaml.idpSigningKeyPairId context and
 *   spSaml.sloBinding / spSaml.assertionDuration. The NameID format itself lives at
 *   spSaml.spEntityId-adjacent fields depending on PingOne API version. Keymaker note:
 *   pull spSaml.nameIdFormat (or equivalent) — check live response shape per version.
 *   The gate (gate.js assertNameIdPortable) consumes this field.
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-applications
 */

const { pingRequest, paginatedGet } = require('../utils');

/**
 * List all applications in a PingOne environment.
 *
 * @param {object} client                  — client.cloud sub-client: { baseUrl, getAuthHeader }
 * @param {string} envId                   — PingOne environment UUID
 * @param {object} [options]
 * @param {string} [options.filter]        — SCIM filter (e.g. 'enabled eq true')
 * @param {number} [options.limit=100]
 * @param {string} [options.nextLink]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listApplications(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.applications || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/applications?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'applications' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.applications || [], nextLink: result.nextLink };
}

/**
 * Get a single application by ID.
 * Full config object including spSaml (SAML) or oidcOptions (OIDC) block.
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} appId  — PingOne application UUID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getApplication(client, envId, appId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };
  if (!appId || typeof appId !== 'string') {
    return { ok: false, error: 'appId is required and must be a non-empty string' };
  }

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/applications/${encodeURIComponent(appId)}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

/**
 * List SAML applications only (protocol === 'SAML').
 * Extracts the NameID format from each app's spSaml config for gate consumption.
 *
 * Returned objects are augmented with a top-level `nameIdFormat` field
 * extracted from `spSaml.nameIdFormat` (or null if absent).
 *
 * @param {object} client
 * @param {string} envId
 * @param {object} [options]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: Array<object & {nameIdFormat: string|null}>} | {ok: false, error: string, status?: number}>}
 */
async function listSamlApps(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  const result = await listApplications(client, envId, {
    filter: 'protocol eq "SAML"',
    ...options,
  });
  if (!result.ok) return result;

  const enriched = result.data.map((app) => ({
    ...app,
    nameIdFormat: _extractNameIdFormat(app),
  }));

  return { ok: true, data: enriched, nextLink: result.nextLink };
}

/**
 * List OIDC applications only (protocol === 'OPENID_CONNECT').
 *
 * @param {object} client
 * @param {string} envId
 * @param {object} [options]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listOidcApps(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  return listApplications(client, envId, {
    filter: 'protocol eq "OPENID_CONNECT"',
    ...options,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the NameID format string from a PingOne SAML application object.
 * PingOne stores this in spSaml.nameIdFormat; older API versions may differ.
 * Returns null when absent — callers should treat null as "unspecified".
 *
 * Used by gate.js assertNameIdPortable() to check Entra compatibility.
 * Hard-blocked formats: transient, kerberos, X509SubjectName.
 *
 * @param {object} app  — raw PingOne application object
 * @returns {string|null}
 */
function _extractNameIdFormat(app) {
  // Primary location in current PingOne Platform API
  if (app?.spSaml?.nameIdFormat) return app.spSaml.nameIdFormat;
  // Fallback: some versions nest under samlOptions
  if (app?.samlOptions?.nameIdFormat) return app.samlOptions.nameIdFormat;
  return null;
}

module.exports = {
  listApplications,
  getApplication,
  listSamlApps,
  listOidcApps,
};
