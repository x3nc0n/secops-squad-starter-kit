'use strict';

/**
 * @module policies
 * Policy and authenticator management via the Okta Core API.
 *
 * Covers the policy types most relevant to Entra ID migration:
 * - OKTA_SIGN_ON: Sign-on policies (Okta's "conditional access" equivalent)
 * - MFA_ENROLL: MFA enrollment policies
 * - PASSWORD: Password policies
 * - ACCESS_POLICY: Application-level authentication policies (OIE)
 * - PROFILE_ENROLLMENT: Profile enrollment policies
 * - IDP_DISCOVERY: IdP discovery (routing) policies
 *
 * Also covers authenticators (factors) available in the org.
 *
 * All functions return `{ok, data?, error?, status?}` — never throw.
 *
 * @see https://developer.okta.com/docs/reference/api/policy/
 * @see https://developer.okta.com/docs/reference/api/authenticators-admin/
 */

const { oktaGet, paginatedGet } = require('./utils');

/** Supported Okta policy types for migration analysis. */
const POLICY_TYPES = Object.freeze([
  'OKTA_SIGN_ON',
  'MFA_ENROLL',
  'PASSWORD',
  'ACCESS_POLICY',
  'PROFILE_ENROLLMENT',
  'IDP_DISCOVERY',
]);

/**
 * Lists policies of a specific type.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} policyType - Okta policy type (see POLICY_TYPES)
 * @param {object} [options]
 * @param {string} [options.status] - Filter by status: 'ACTIVE' or 'INACTIVE'
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listPolicies(client, policyType, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!policyType || typeof policyType !== 'string') {
    return { ok: false, error: 'policyType is required and must be a non-empty string' };
  }

  const params = new URLSearchParams();
  params.set('type', policyType);
  if (options.status) params.set('status', options.status);

  const url = `${client.orgUrl}/api/v1/policies?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves a single policy by ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} policyId - Okta policy ID (00p...)
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getPolicy(client, policyId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!policyId || typeof policyId !== 'string') {
    return { ok: false, error: 'policyId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/policies/${encodeURIComponent(policyId)}`;
  return oktaGet(client, url);
}

/**
 * Lists all rules for a policy (e.g. sign-on rules, MFA enrollment rules).
 * Rules define the conditions under which the policy applies and what actions are taken.
 * Equivalent to Conditional Access policy conditions + grant controls in Entra ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} policyId - Okta policy ID
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function getPolicyRules(client, policyId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!policyId || typeof policyId !== 'string') {
    return { ok: false, error: 'policyId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/policies/${encodeURIComponent(policyId)}/rules`;
  return oktaGet(client, url);
}

/**
 * Retrieves a single policy rule by policy ID and rule ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} policyId - Okta policy ID
 * @param {string} ruleId - Okta rule ID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getPolicyRule(client, policyId, ruleId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!policyId || typeof policyId !== 'string') {
    return { ok: false, error: 'policyId is required and must be a non-empty string' };
  }
  if (!ruleId || typeof ruleId !== 'string') {
    return { ok: false, error: 'ruleId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/policies/${encodeURIComponent(policyId)}/rules/${encodeURIComponent(ruleId)}`;
  return oktaGet(client, url);
}

/**
 * Lists all authenticators available in the org (Okta Identity Engine orgs only).
 * Authenticators are the building blocks of MFA enrollment and authentication policies.
 * Includes: password, email, phone, WebAuthn, Okta Verify, Google Authenticator, etc.
 *
 * @param {import('./index').OktaClient} client
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function listAuthenticators(client) {
  if (!client) return { ok: false, error: 'client is required' };

  const url = `${client.orgUrl}/api/v1/authenticators`;
  return oktaGet(client, url);
}

/**
 * Retrieves a single authenticator by ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} authenticatorId - Okta authenticator ID (aut...)
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getAuthenticator(client, authenticatorId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!authenticatorId || typeof authenticatorId !== 'string') {
    return { ok: false, error: 'authenticatorId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/authenticators/${encodeURIComponent(authenticatorId)}`;
  return oktaGet(client, url);
}

/**
 * Lists all policies of all migration-relevant types in one call.
 * Convenience wrapper for migration tooling — returns a map of policyType → policies[].
 *
 * @param {import('./index').OktaClient} client
 * @param {object} [options]
 * @param {string[]} [options.types] - Override which policy types to include (defaults to all POLICY_TYPES)
 * @returns {Promise<{ok: true, data: Record<string, object[]>} | {ok: false, error: string, status?: number}>}
 */
async function listAllMigrationPolicies(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  const types = options.types || POLICY_TYPES;
  const results = {};

  for (const policyType of types) {
    const result = await listPolicies(client, policyType, { fetchAll: true });
    if (!result.ok) {
      // Some policy types may not be available in all org editions (e.g. ACCESS_POLICY requires OIE)
      // Return partial results with a note rather than failing the whole call
      results[policyType] = { error: result.error, status: result.status };
    } else {
      results[policyType] = result.data;
    }
  }

  return { ok: true, data: results };
}

module.exports = {
  listPolicies,
  getPolicy,
  getPolicyRules,
  getPolicyRule,
  listAuthenticators,
  getAuthenticator,
  listAllMigrationPolicies,
  POLICY_TYPES,
};
