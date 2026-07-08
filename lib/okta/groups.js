'use strict';

/**
 * @module groups
 * Group management via the Okta Core API.
 * Covers OKTA_GROUP, APP_GROUP, and BUILT_IN groups, group members,
 * and group rules (dynamic group expressions).
 *
 * All functions return `{ok, data?, error?, status?}` — never throw.
 *
 * @see https://developer.okta.com/docs/reference/api/groups/
 */

const { oktaGet, paginatedGet } = require('./utils');

/**
 * Lists groups in the Okta org with optional filtering.
 *
 * @param {import('./index').OktaClient} client
 * @param {object} [options]
 * @param {string} [options.q] - Fuzzy search on group name
 * @param {string} [options.filter] - Okta filter expression (e.g. 'type eq "OKTA_GROUP"')
 * @param {string} [options.search] - Okta search expression
 * @param {number} [options.limit=200] - Page size (max 200)
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate all pages
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroups(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  if (options.q) params.set('q', options.q);
  if (options.filter) params.set('filter', options.filter);
  if (options.search) params.set('search', options.search);
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/groups?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves a single group by ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} groupId - Okta group ID (00g...)
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getGroup(client, groupId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!groupId || typeof groupId !== 'string') {
    return { ok: false, error: 'groupId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/groups/${encodeURIComponent(groupId)}`;
  return oktaGet(client, url);
}

/**
 * Lists all members of a group (returns User objects).
 *
 * @param {import('./index').OktaClient} client
 * @param {string} groupId - Okta group ID
 * @param {object} [options]
 * @param {number} [options.limit=200] - Page size
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroupMembers(client, groupId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!groupId || typeof groupId !== 'string') {
    return { ok: false, error: 'groupId is required and must be a non-empty string' };
  }

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/groups/${encodeURIComponent(groupId)}/users?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Lists all group rules (dynamic group membership expressions).
 * Group rules define which users are automatically added to groups.
 * Equivalent to dynamic group membership rules in Entra ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {object} [options]
 * @param {number} [options.limit=200] - Page size
 * @param {string} [options.nextLink] - Pagination cursor
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroupRules(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/groups/rules?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves a single group rule by ID.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} ruleId - Okta group rule ID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getGroupRule(client, ruleId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!ruleId || typeof ruleId !== 'string') {
    return { ok: false, error: 'ruleId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/groups/rules/${encodeURIComponent(ruleId)}`;
  return oktaGet(client, url);
}

/**
 * Lists all applications assigned to a group.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} groupId - Okta group ID
 * @param {object} [options]
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroupApps(client, groupId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!groupId || typeof groupId !== 'string') {
    return { ok: false, error: 'groupId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/groups/${encodeURIComponent(groupId)}/apps`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

module.exports = {
  listGroups,
  getGroup,
  listGroupMembers,
  listGroupRules,
  getGroupRule,
  listGroupApps,
};
