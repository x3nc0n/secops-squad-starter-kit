'use strict';

/**
 * @module cloud/policies
 * PingOne sign-on policy management via the Platform API.
 * Read-oriented: list, get, list actions. HAL _links.next pagination.
 *
 * All functions return {ok, data?, error?, status?} — never throw.
 *
 * PingOne sign-on policies govern authentication flows for users in an environment.
 * Each policy has one or more "actions" (authentication steps) that can include:
 *   - LOGIN (username/password)
 *   - MFA (push, TOTP, etc.)
 *   - IDENTIFIER_FIRST (DaVinci-like step-up)
 *   - PROGRESSIVE_PROFILING
 *   - AGREEMENT (terms acceptance)
 *
 * Entra equivalent: Conditional Access policies + Authentication Strength policies.
 * Mapping quality: Transform-required (see ping-to-entra-migration-map.md).
 *
 * DaVinci-backed policies (type === 'DAVINCI') have no direct Entra equivalent —
 * flag for manual architecture review.
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-sign-on-policies
 */

const { pingRequest, paginatedGet } = require('../utils');

/**
 * List sign-on policies in a PingOne environment.
 *
 * @param {object} client                  — client.cloud sub-client: { baseUrl, getAuthHeader }
 * @param {string} envId                   — PingOne environment UUID
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {string} [options.nextLink]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listSignOnPolicies(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.signOnPolicies || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/signOnPolicies?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'signOnPolicies' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.signOnPolicies || [], nextLink: result.nextLink };
}

/**
 * Get a single sign-on policy by ID.
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} policyId  — PingOne sign-on policy UUID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getSignOnPolicy(client, envId, policyId) {
  if (!client)   return { ok: false, error: 'client is required' };
  if (!envId)    return { ok: false, error: 'envId is required' };
  if (!policyId || typeof policyId !== 'string') {
    return { ok: false, error: 'policyId is required and must be a non-empty string' };
  }

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/signOnPolicies/${encodeURIComponent(policyId)}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

/**
 * List actions for a sign-on policy.
 * Actions define the ordered authentication steps (LOGIN, MFA, etc.).
 * Used to assess migration complexity — DaVinci actions require manual redesign.
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} policyId
 * @param {object} [options]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listSignOnPolicyActions(client, envId, policyId, options = {}) {
  if (!client)   return { ok: false, error: 'client is required' };
  if (!envId)    return { ok: false, error: 'envId is required' };
  if (!policyId || typeof policyId !== 'string') {
    return { ok: false, error: 'policyId is required and must be a non-empty string' };
  }

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/signOnPolicies/${encodeURIComponent(policyId)}/actions`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'actions' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.actions || [], nextLink: result.nextLink };
}

module.exports = {
  listSignOnPolicies,
  getSignOnPolicy,
  listSignOnPolicyActions,
};
