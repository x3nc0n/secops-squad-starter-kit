'use strict';

/**
 * @module cloud/users
 * PingOne user management via the Platform API.
 * Read-oriented: list, get, search. Uses HAL _links.next cursor pagination.
 *
 * All functions return {ok, data?, error?, status?, nextLink?} — never throw.
 *
 * Pagination: PingOne uses HAL _links.next (not HTTP Link headers).
 * Pass options.nextLink to continue from a previous page, or
 * options.fetchAll: true to auto-collect all pages (large orgs: use with care).
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-users
 */

const { pingRequest, paginatedGet } = require('../utils');

/**
 * List users in a PingOne environment.
 *
 * @param {object} client                  — client.cloud sub-client: { baseUrl, getAuthHeader }
 * @param {string} envId                   — PingOne environment UUID
 * @param {object} [options]
 * @param {string} [options.filter]        — SCIM filter expression (e.g. 'memberOfGroups[id eq "..."]')
 * @param {number} [options.limit=100]     — Page size (PingOne default 100, max 1000)
 * @param {string} [options.nextLink]      — HAL cursor from a previous response
 * @param {boolean} [options.fetchAll]     — Auto-paginate through all pages
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listUsers(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.users || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/users?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'users' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.users || [], nextLink: result.nextLink };
}

/**
 * Get a single user by ID.
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} userId  — PingOne user UUID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getUser(client, envId, userId) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };
  if (!userId || typeof userId !== 'string') {
    return { ok: false, error: 'userId is required and must be a non-empty string' };
  }

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/users/${encodeURIComponent(userId)}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

/**
 * Search users using a SCIM filter expression.
 * Convenience wrapper around listUsers with filter param.
 *
 * Example filters:
 *   'name.given eq "Alice"'
 *   'email eq "alice@example.com"'
 *   'memberOfGroups[id eq "{groupId}"]'
 *   'population.id eq "{populationId}"'
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} filter   — SCIM filter expression
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function searchUsers(client, envId, filter, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };
  if (!filter || typeof filter !== 'string') {
    return { ok: false, error: 'filter is required and must be a non-empty string' };
  }

  return listUsers(client, envId, { filter, ...options });
}

module.exports = {
  listUsers,
  getUser,
  searchUsers,
};
