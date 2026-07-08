'use strict';

/**
 * @module cloud/environments
 * PingOne environment and population discovery via the Platform API.
 * This is the tenant-level entry point: enumerate environments, then
 * call per-environment modules to drill into users/groups/apps/policies.
 *
 * All functions return {ok, data?, error?, status?} — never throw.
 *
 * PingOne hierarchy:
 *   Organization (tenant)
 *     └── Environments (SANDBOX | PRODUCTION | DEVELOPER)
 *           └── Populations (sub-segments of users within an environment)
 *
 * Populations are the primary segmentation unit for phased migrations.
 * An environment may have one default population or many named populations.
 *
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-environments
 * @see https://apidocs.pingidentity.com/pingone/platform/v1/api/#get-read-all-populations
 */

const { pingRequest, paginatedGet } = require('../utils');

/**
 * List all PingOne environments the configured Worker Application has access to.
 * For most operators this is 1–5 environments (sandbox, staging, production variants).
 *
 * @param {object} client                  — client.cloud sub-client: { baseUrl, getAuthHeader }
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {string} [options.nextLink]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listEnvironments(client, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.environments || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'environments' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.environments || [], nextLink: result.nextLink };
}

/**
 * List populations within a PingOne environment.
 * Populations group users and drive policy scoping.
 * Use populations as the unit of segmentation for phased_by_population migrations.
 *
 * @param {object} client
 * @param {string} envId                   — PingOne environment UUID
 * @param {object} [options]
 * @param {number} [options.limit=100]
 * @param {string} [options.nextLink]
 * @param {boolean} [options.fetchAll]
 * @returns {Promise<{ok: true, data: object[], nextLink?: string} | {ok: false, error: string, status?: number}>}
 */
async function listPopulations(client, envId, options = {}) {
  if (!client) return { ok: false, error: 'client is required' };
  if (!envId)  return { ok: false, error: 'envId is required' };

  if (options.nextLink) {
    const result = await pingRequest(client, 'GET', options.nextLink);
    if (!result.ok) return result;
    return { ok: true, data: result.data?._embedded?.populations || [], nextLink: result.nextLink };
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit || 100));

  const url = `${client.baseUrl}/environments/${encodeURIComponent(envId)}/populations?${params.toString()}`;

  if (options.fetchAll) {
    return paginatedGet(client, url, { embeddedKey: 'populations' });
  }

  const result = await pingRequest(client, 'GET', url);
  if (!result.ok) return result;
  return { ok: true, data: result.data?._embedded?.populations || [], nextLink: result.nextLink };
}

module.exports = {
  listEnvironments,
  listPopulations,
};
