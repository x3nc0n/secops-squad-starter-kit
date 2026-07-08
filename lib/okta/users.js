'use strict';

/**
 * @module users
 * User management via the Okta Core API.
 * Read-oriented: list, get, search, group membership, factor enrollments.
 *
 * All functions return `{ok, data?, error?, status?}` — never throw.
 *
 * Pagination: functions that return lists support a `nextLink` cursor.
 * Pass `options.nextLink` to continue from a previous page, or use
 * `options.fetchAll: true` to auto-collect all pages (use with care on large orgs).
 *
 * @see https://developer.okta.com/docs/reference/api/users/
 */

const { oktaGet, paginatedGet } = require('./utils');

/**
 * Lists users in the Okta org.
 *
 * @param {import('./index').OktaClient} client
 * @param {object} [options]
 * @param {string} [options.filter] - Okta filter expression (e.g. 'status eq "ACTIVE"')
 * @param {string} [options.search] - Okta search expression (e.g. 'profile.department eq "Engineering"')
 * @param {string} [options.q] - Simple startsWith match on firstName, lastName, email
 * @param {number} [options.limit=200] - Page size (max 200)
 * @param {string} [options.nextLink] - Pagination cursor from a previous response
 * @param {boolean} [options.fetchAll=false] - Fetch all pages automatically
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listUsers(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  if (options.nextLink) {
    return oktaGet(client, options.nextLink);
  }

  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  if (options.search) params.set('search', options.search);
  if (options.q) params.set('q', options.q);
  params.set('limit', String(options.limit || 200));

  const url = `${client.orgUrl}/api/v1/users?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url);
  }

  return oktaGet(client, url);
}

/**
 * Retrieves a single user by Okta user ID, login (email), or shortname.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} userId - Okta user ID (00u...), login email, or shortname
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getUser(client, userId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/users/${encodeURIComponent(userId)}`;
  return oktaGet(client, url);
}

/**
 * Searches users using Okta's search API (SCIM-like attribute search).
 * More powerful than `q` — supports complex expressions on profile attributes.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} searchExpr - Okta search expression
 *   Examples:
 *   - 'profile.email eq "alice@example.com"'
 *   - 'profile.department eq "Engineering" and status eq "ACTIVE"'
 *   - 'profile.lastName sw "Smith"'
 * @param {object} [options]
 * @param {number} [options.limit=200] - Page size
 * @param {boolean} [options.fetchAll=false] - Auto-paginate
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function searchUsers(client, searchExpr, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!searchExpr || typeof searchExpr !== 'string') {
    return { ok: false, error: 'searchExpr is required and must be a non-empty string' };
  }

  return listUsers(client, { search: searchExpr, ...options });
}

/**
 * Lists all groups a user is a member of.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} userId - Okta user ID or login
 * @param {object} [options]
 * @param {boolean} [options.fetchAll=true] - Auto-paginate (default true — most users have < a few hundred groups)
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function listUserGroups(client, userId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/users/${encodeURIComponent(userId)}/groups`;
  const fetchAll = options.fetchAll !== false; // default true

  if (fetchAll) {
    return paginatedGet(client, url);
  }
  return oktaGet(client, url);
}

/**
 * Lists all enrolled factors (authenticators) for a user.
 * Returns the factor type, provider, status, and enrollment details.
 *
 * @param {import('./index').OktaClient} client
 * @param {string} userId - Okta user ID
 * @returns {Promise<{ok: true, data: object[]} | {ok: false, error: string, status?: number}>}
 */
async function listUserFactors(client, userId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId is required and must be a non-empty string' };
  }

  const url = `${client.orgUrl}/api/v1/users/${encodeURIComponent(userId)}/factors`;
  return oktaGet(client, url);
}

/**
 * Returns a user's lifecycle status and last-login information.
 * This is a convenience wrapper that extracts the status fields from getUser().
 *
 * @param {import('./index').OktaClient} client
 * @param {string} userId - Okta user ID or login
 * @returns {Promise<{ok: true, data: {status: string, statusChanged: string, lastLogin: string, created: string}} | {ok: false, error: string, status?: number}>}
 */
async function getUserLifecycle(client, userId) {
  const result = await getUser(client, userId);
  if (!result.ok) return result;

  const { status, statusChanged, lastLogin, created, activated, passwordChanged } = result.data;
  return {
    ok: true,
    data: { status, statusChanged, lastLogin, created, activated, passwordChanged },
  };
}

module.exports = {
  listUsers,
  getUser,
  searchUsers,
  listUserGroups,
  listUserFactors,
  getUserLifecycle,
};
