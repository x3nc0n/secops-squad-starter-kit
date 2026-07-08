'use strict';

/**
 * @module cloud/groups
 * PingOne group management via the Platform API.
 * Read-oriented: list, get, members. HAL _links.next pagination.
 *
 * All functions return {ok, data?, error?, status?, nextLink?} — never throw.
 *
 * PingOne group types: DIRECT (static assignment) and INDIRECT (dynamic via population).
 * Group membership is managed through the /groups/{id}/members endpoint.
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-groups
 */

const { pingRequest, paginatedGet } = require('../utils');

/**
 * List groups in a PingOne environment.
 *
 * @param {object} client                  — client.cloud sub-client: { baseUrl, getAuthHeader }
 * @param {string} envId                   — PingOne environment UUID
 * @param {object} [options]
 * @param {string} [options.filter]        — SCIM filter (e.g. 'name sw "Engineering"')
 * @param {number} [options.limit=100]     — Page size
 * @param {string} [options.nextLink]      — HAL cursor from a previous response
 * @param {boolean} [options.fetchAll]     — Auto-paginate all pages
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroups(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.groups || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  if (options.filter) params.set('filter', options.filter);
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/groups?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'groups' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.groups || [], nextLink: result.nextLink };
}

/**
 * Get a single group by ID.
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} groupId  — PingOne group UUID
 * @returns {Promise<{ok: true, data: object} | {ok: false, error: string, status?: number}>}
 */
async function getGroup(client, envId, groupId) {
  if (!client)  return { ok: false, error: 'client is required' };
  if (!envId)   return { ok: false, error: 'envId is required' };
  if (!groupId || typeof groupId !== 'string') {
    return { ok: false, error: 'groupId is required and must be a non-empty string' };
  }

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/groups/${encodeURIComponent(groupId)}`;
  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

/**
 * List members of a group.
 * Returns user objects embedded in the response (_embedded.groupMemberships or _embedded.users).
 *
 * @param {object} client
 * @param {string} envId
 * @param {string} groupId
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {string} [options.nextLink]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listGroupMembers(client, envId, groupId, options = {}) {
  if (!client)  return { ok: false, error: 'client is required' };
  if (!envId)   return { ok: false, error: 'envId is required' };
  if (!groupId || typeof groupId !== 'string') {
    return { ok: false, error: 'groupId is required and must be a non-empty string' };
  }

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    const members = result.data?._embedded?.groupMemberships
      || result.data?._embedded?.users
      || [];
    return { ok: true, data: members, nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/groups/${encodeURIComponent(groupId)}/members?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'groupMemberships' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  const members = result.data?._embedded?.groupMemberships
    || result.data?._embedded?.users
    || [];
  return { ok: true, data: members, nextLink: result.nextLink };
}

module.exports = {
  listGroups,
  getGroup,
  listGroupMembers,
};
