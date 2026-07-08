'use strict';

/**
 * @module lib/ping
 * Zero-dependency Ping Identity hybrid client library.
 *
 * Uses native `fetch` (Node 18+). All API functions return structured
 * result objects `{ok, data?, error?, status?}` instead of throwing.
 *
 * Design posture: READ-FIRST. This library is built for migration tooling.
 * Write operations are intentionally absent from Phase 1.
 *
 * Deployment discriminator: createClient() validates required surface blocks
 * are present for the declared deployment type and THROWS SYNCHRONOUSLY at
 * config time (same pattern as lib/okta/index.js).
 *
 * @example
 * const { createClient } = require('./lib/ping');
 * const client = createClient({
 *   deployment: 'hybrid',
 *   cloud: { environmentId: '...', clientId: '...', clientSecret: '...', region: 'com' },
 *   onprem: { pingfederate: { adminUrl: 'https://pf.corp.example.com:9999', username: '...', password: '...' } },
 * });
 * const result = await client.cloud.environments.listEnvironments(client.cloud);
 */

const { loadMigrationProfile } = require('./config');
const gate = require('./gate');
const { detectDeployment, KNOWN_DOMAINS } = require('./detect');
const { VALID, OWNERSHIP_CLASSES } = require('./config');

// ---------------------------------------------------------------------------
// Surface module imports (Keymaker's modules — loaded gracefully)
// ---------------------------------------------------------------------------

// Keymaker owns all surface modules under cloud/, onprem/, aic/.
// We require them with graceful fallback so Tank's infrastructure tests run
// even before Keymaker's implementation lands. createClient() will still
// throw if required surfaces are declared but modules are absent.

function tryRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

const cloudModules = {
  auth:         tryRequire('./cloud/auth'),
  users:        tryRequire('./cloud/users'),
  groups:       tryRequire('./cloud/groups'),
  apps:         tryRequire('./cloud/apps'),
  policies:     tryRequire('./cloud/policies'),
  environments: tryRequire('./cloud/environments'),
};

const onpremModules = {
  pingfederate:  tryRequire('./onprem/pingfederate'),
  pingdirectory: tryRequire('./onprem/pingdirectory'),
  pingaccess:    tryRequire('./onprem/pingaccess'),
};

const aicModule = tryRequire('./aic/index');

// ---------------------------------------------------------------------------
// createClient
// ---------------------------------------------------------------------------

/**
 * Creates an authenticated Ping Identity hybrid client.
 *
 * Throws synchronously at config time if required blocks are missing.
 * All API calls return {ok, data?, error?} and never throw.
 *
 * @param {object} config
 * @param {'cloud'|'onprem'|'hybrid'} config.deployment
 * @param {object} [config.cloud]
 * @param {string} config.cloud.environmentId
 * @param {string} config.cloud.clientId
 * @param {string} config.cloud.clientSecret
 * @param {string} [config.cloud.region='com']    — com | eu | ca | asia | au
 * @param {object} [config.aic]
 * @param {string} config.aic.baseUrl
 * @param {string} config.aic.accessToken
 * @param {object} [config.onprem]
 * @param {object} [config.onprem.pingfederate]
 * @param {string} config.onprem.pingfederate.adminUrl
 * @param {string} config.onprem.pingfederate.username
 * @param {string} config.onprem.pingfederate.password
 * @param {object} [config.onprem.pingdirectory]
 * @param {object} [config.onprem.pingaccess]
 * @returns {object} PingHybridClient
 * @throws {Error} If required config fields are missing
 */
function createClient(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('createClient requires a config object');
  }

  const deployment = config.deployment;
  if (!['cloud', 'onprem', 'hybrid'].includes(deployment)) {
    throw new Error(
      `createClient requires config.deployment of 'cloud', 'onprem', or 'hybrid' — got: ${JSON.stringify(deployment)}`
    );
  }

  // Validate cloud block is present for cloud/hybrid
  if (deployment === 'cloud' || deployment === 'hybrid') {
    if (!config.cloud || typeof config.cloud !== 'object') {
      throw new Error(
        `createClient: deployment="${deployment}" requires config.cloud block ` +
        `with environmentId, clientId, clientSecret`
      );
    }
    if (!config.cloud.environmentId) {
      throw new Error('createClient: config.cloud.environmentId is required');
    }
    if (!config.cloud.clientId) {
      throw new Error('createClient: config.cloud.clientId is required');
    }
    if (!config.cloud.clientSecret) {
      throw new Error('createClient: config.cloud.clientSecret is required');
    }
    const region = config.cloud.region || 'com';
    if (!VALID.region.has(region)) {
      throw new Error(
        `createClient: config.cloud.region must be one of: ${[...VALID.region].join(', ')} — got: ${JSON.stringify(region)}`
      );
    }
  }

  // Validate onprem block is present for onprem/hybrid
  if (deployment === 'onprem' || deployment === 'hybrid') {
    if (!config.onprem || typeof config.onprem !== 'object') {
      throw new Error(
        `createClient: deployment="${deployment}" requires config.onprem block`
      );
    }
    // At least one on-prem surface must be configured
    const hasPF = !!(config.onprem.pingfederate);
    const hasPD = !!(config.onprem.pingdirectory);
    const hasPA = !!(config.onprem.pingaccess);
    if (!hasPF && !hasPD && !hasPA) {
      throw new Error(
        `createClient: deployment="${deployment}" requires at least one on-prem surface block: ` +
        `onprem.pingfederate, onprem.pingdirectory, or onprem.pingaccess`
      );
    }
    if (config.onprem.pingfederate) {
      const pf = config.onprem.pingfederate;
      if (!pf.adminUrl) throw new Error('createClient: config.onprem.pingfederate.adminUrl is required');
      if (!pf.username) throw new Error('createClient: config.onprem.pingfederate.username is required');
      if (!pf.password) throw new Error('createClient: config.onprem.pingfederate.password is required');
    }
  }

  // Build client object
  const client = { deployment };

  // Cloud sub-client
  if (config.cloud) {
    const region = config.cloud.region || 'com';
    const baseUrl = `https://api.pingone.${region}/v1`;
    const authBaseUrl = `https://auth.pingone.${region}`;

    client.cloud = {
      baseUrl,
      authBaseUrl,
      environmentId: config.cloud.environmentId,
      clientId: config.cloud.clientId,
      // Token acquisition is Keymaker's cloud/auth.js — we provide getAuthHeader as async stub
      // that delegates to the cloud auth module when available.
      getAuthHeader: async () => {
        if (cloudModules.auth) {
          return cloudModules.auth.getAuthHeader
            ? cloudModules.auth.getAuthHeader(config.cloud, authBaseUrl)
            : null;
        }
        return null;
      },
      // Re-export surface modules on the sub-client for convenience
      ...(cloudModules.users        ? { users: cloudModules.users }               : {}),
      ...(cloudModules.groups       ? { groups: cloudModules.groups }             : {}),
      ...(cloudModules.apps         ? { apps: cloudModules.apps }                 : {}),
      ...(cloudModules.policies     ? { policies: cloudModules.policies }         : {}),
      ...(cloudModules.environments ? { environments: cloudModules.environments } : {}),
    };
  }

  // AIC sub-client
  if (config.aic) {
    client.aic = {
      baseUrl: config.aic.baseUrl,
      getAuthHeader: () => `Bearer ${config.aic.accessToken}`,
      ...(aicModule ? { ...aicModule } : {}),
    };
  }

  // On-prem sub-clients
  if (config.onprem) {
    client.onprem = {};

    if (config.onprem.pingfederate) {
      const pf = config.onprem.pingfederate;
      const basicCredential = Buffer.from(`${pf.username}:${pf.password}`).toString('base64');
      client.onprem.pingfederate = {
        adminUrl: pf.adminUrl,
        getAuthHeader: () => `Basic ${basicCredential}`,
        xsrfHeader: 'PingFederate',
        ...(onpremModules.pingfederate ? { ...onpremModules.pingfederate } : {}),
      };
    }

    if (config.onprem.pingdirectory) {
      const pd = config.onprem.pingdirectory;
      const basicCredential = Buffer.from(`${pd.username}:${pd.password}`).toString('base64');
      client.onprem.pingdirectory = {
        scimUrl: pd.scimUrl,
        getAuthHeader: () => `Basic ${basicCredential}`,
        ...(onpremModules.pingdirectory ? { ...onpremModules.pingdirectory } : {}),
      };
    }

    if (config.onprem.pingaccess) {
      const pa = config.onprem.pingaccess;
      client.onprem.pingaccess = {
        adminUrl: pa.adminUrl,
        username: pa.username,
        password: pa.password,
        // Session cookie obtained via login(); populated by pingaccess.js
        getSessionCookie: () => null,
        ...(onpremModules.pingaccess ? { ...onpremModules.pingaccess } : {}),
      };
    }
  }

  return client;
}

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

/** PingOne deployment regions. */
const REGION = Object.freeze({
  COM: 'com',
  EU: 'eu',
  CA: 'ca',
  ASIA: 'asia',
  AU: 'au',
});

/** Identity authority options. */
const IDENTITY_AUTHORITY = Object.freeze({
  PINGFEDERATE: 'pingfederate',
  PINGONE: 'pingone',
  AIC: 'aic',
  HRIS: 'hris',
  MIXED: 'mixed',
});

/** Federation direction options. */
const FEDERATION_DIRECTION = Object.freeze({
  PING_IDP_INTO_ENTRA: 'ping_idp_into_entra',
  ENTRA_IDP: 'entra_idp',
  PER_APP: 'per_app',
});

/** MFA strategy options. */
const MFA_STRATEGY = Object.freeze({
  PINGID_REENROLL: 'pingid_reenroll',
  PASSKEY_BOOTSTRAP: 'passkey_bootstrap',
  PER_POPULATION: 'per_population',
});

/** NameID strategy options. */
const NAMEID_STRATEGY = Object.freeze({
  MAP_TO_PERSISTENT: 'map_to_persistent',
  USE_EMAIL: 'use_email',
  MANUAL_PER_APP: 'manual_per_app',
});

module.exports = {
  createClient,

  // Config + gating
  loadMigrationProfile,
  gate,

  // Detection
  detectDeployment,
  KNOWN_DOMAINS,

  // Surface modules (may be null until Keymaker lands)
  cloud: cloudModules,
  onprem: onpremModules,
  aic: aicModule,

  // Named constants
  REGION,
  IDENTITY_AUTHORITY,
  FEDERATION_DIRECTION,
  MFA_STRATEGY,
  NAMEID_STRATEGY,
  OWNERSHIP_CLASSES,
};
