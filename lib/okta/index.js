'use strict';

/**
 * @module okta
 * Zero-dependency Okta API client library.
 *
 * Uses native `fetch` (Node 18+). All API functions return structured
 * result objects `{ok, data?, error?, status?}` instead of throwing.
 *
 * Design posture: READ-FIRST. This library is built for migration tooling
 * and MCP-based analysis. Write operations (create/update/delete) are
 * intentionally absent from this module — they must be explicit and rare.
 *
 * @example
 * const { createClient, users, groups, apps, policies } = require('./lib/okta');
 *
 * const client = createClient({
 *   orgUrl: process.env.OKTA_ORG_URL,
 *   apiToken: process.env.OKTA_API_TOKEN,
 * });
 *
 * const result = await users.listUsers(client);
 * if (result.ok) console.log(result.data);
 */

const auth = require('./auth');
const users = require('./users');
const groups = require('./groups');
const apps = require('./apps');
const policies = require('./policies');
const { normalizeOrgUrl } = require('./utils');
const { loadMigrationProfile } = require('./config');
const gate = require('./gate');

/**
 * @typedef {object} OktaClient
 * @property {() => Promise<string|null>} getAuthHeader - Returns a valid `Authorization` header value
 * @property {string} orgUrl - Normalized Okta org URL (no trailing slash)
 */

/**
 * @typedef {object} OktaClientConfig
 * @property {string} orgUrl - Okta org URL (e.g. https://acme.okta.com)
 * @property {string} [apiToken] - SSWS API token (OKTA_API_TOKEN). Use for SSWS auth.
 * @property {string} [clientId] - OAuth2 client ID (OKTA_CLIENT_ID)
 * @property {string[]} [scopes] - OAuth2 scopes (e.g. ['okta.users.read', 'okta.groups.read'])
 * @property {string} [clientSecret] - OAuth2 client secret (OKTA_CLIENT_SECRET). Required for clientCredentials.
 * @property {string} [privateKey] - PEM-encoded RSA private key (OKTA_PRIVATE_KEY). Required for privateKeyJwt.
 * @property {'ssws'|'clientCredentials'|'privateKeyJwt'} [authMethod='ssws'] - Authentication method
 * @property {string} [authServerId='default'] - OAuth2 authorization server ID (default: 'default' = org AS)
 */

/**
 * Creates an authenticated Okta API client.
 *
 * Auth methods:
 * - **ssws** (default): API token via `Authorization: SSWS {token}`. Simplest; requires
 *   an admin-created token. Source from `OKTA_API_TOKEN` env var.
 * - **clientCredentials**: OAuth 2.0 service app using clientId + clientSecret.
 *   Source from `OKTA_CLIENT_ID` + `OKTA_CLIENT_SECRET`.
 * - **privateKeyJwt**: OAuth 2.0 service app using clientId + RSA private key (JWT assertion).
 *   Source from `OKTA_CLIENT_ID` + `OKTA_PRIVATE_KEY` (PEM).
 *
 * @param {OktaClientConfig} config
 * @returns {OktaClient}
 * @throws {Error} If required config fields are missing (config validation only — not API calls)
 */
function createClient(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('createClient requires a config object');
  }
  if (!config.orgUrl) {
    throw new Error('createClient requires config.orgUrl (e.g. https://acme.okta.com)');
  }

  const orgUrl = normalizeOrgUrl(config.orgUrl);
  const method = config.authMethod || 'ssws';

  // --- SSWS API Token ---
  if (method === 'ssws') {
    if (!config.apiToken) {
      throw new Error(
        'ssws auth requires config.apiToken — set OKTA_API_TOKEN env var and pass it as apiToken'
      );
    }
    const token = config.apiToken;
    return {
      orgUrl,
      getAuthHeader: async () => {
        const result = auth.getSswsAuthHeader(token);
        return result.ok ? result.authHeader : null;
      },
    };
  }

  // --- OAuth 2.0 (both grant types) ---
  if (method === 'clientCredentials' || method === 'privateKeyJwt') {
    if (!config.clientId) {
      throw new Error(`${method} auth requires config.clientId`);
    }
    if (!Array.isArray(config.scopes) || config.scopes.length === 0) {
      throw new Error(`${method} auth requires config.scopes (non-empty array)`);
    }

    const authServerId = config.authServerId || 'default';
    const tokenEndpoint = `${orgUrl}/oauth2/${authServerId}/v1/token`;

    if (method === 'clientCredentials') {
      if (!config.clientSecret) {
        throw new Error(
          'clientCredentials auth requires config.clientSecret — set OKTA_CLIENT_SECRET'
        );
      }
      const { clientId, clientSecret, scopes } = config;
      return {
        orgUrl,
        getAuthHeader: async () => {
          const result = await auth.getTokenClientCredentials(
            tokenEndpoint, clientId, clientSecret, scopes
          );
          return result.ok ? `Bearer ${result.token}` : null;
        },
      };
    }

    // privateKeyJwt
    if (!config.privateKey) {
      throw new Error(
        'privateKeyJwt auth requires config.privateKey (PEM) — set OKTA_PRIVATE_KEY'
      );
    }
    const { clientId, privateKey, scopes } = config;
    return {
      orgUrl,
      getAuthHeader: async () => {
        const result = await auth.getTokenPrivateKeyJwt(
          tokenEndpoint, clientId, privateKey, scopes
        );
        return result.ok ? `Bearer ${result.token}` : null;
      },
    };
  }

  throw new Error(
    `Unknown authMethod: "${method}". Must be one of: ssws, clientCredentials, privateKeyJwt`
  );
}

// ---------------------------------------------------------------------------
// Constants — re-exported for convenience
// ---------------------------------------------------------------------------

/** Okta group type identifiers. */
const GROUP_TYPE = Object.freeze({
  OKTA_GROUP: 'OKTA_GROUP',
  APP_GROUP: 'APP_GROUP',
  BUILT_IN: 'BUILT_IN',
});

/** Okta user lifecycle status values. */
const USER_STATUS = Object.freeze({
  STAGED: 'STAGED',
  PROVISIONED: 'PROVISIONED',
  ACTIVE: 'ACTIVE',
  RECOVERY: 'RECOVERY',
  LOCKED_OUT: 'LOCKED_OUT',
  PASSWORD_EXPIRED: 'PASSWORD_EXPIRED',
  SUSPENDED: 'SUSPENDED',
  DEPROVISIONED: 'DEPROVISIONED',
});

/** Okta application sign-on modes relevant to migration. */
const SIGN_ON_MODE = Object.freeze({
  SAML_2_0: 'SAML_2_0',
  OPENID_CONNECT: 'OPENID_CONNECT',
  WS_FEDERATION: 'WS_FEDERATION',
  BASIC_AUTH: 'BASIC_AUTH',
  BOOKMARK: 'BOOKMARK',
  AUTO_LOGIN: 'AUTO_LOGIN',
  SECURE_PASSWORD_STORE: 'SECURE_PASSWORD_STORE',
});

/** Okta policy type identifiers relevant to Entra migration. */
const POLICY_TYPE = Object.freeze({
  OKTA_SIGN_ON: 'OKTA_SIGN_ON',
  MFA_ENROLL: 'MFA_ENROLL',
  PASSWORD: 'PASSWORD',
  ACCESS_POLICY: 'ACCESS_POLICY',
  PROFILE_ENROLLMENT: 'PROFILE_ENROLLMENT',
  IDP_DISCOVERY: 'IDP_DISCOVERY',
});

/** Okta factor (authenticator) types. */
const FACTOR_TYPE = Object.freeze({
  TOKEN: 'token',
  TOKEN_SOFTWARE_TOTP: 'token:software:totp',
  TOKEN_HARDWARE: 'token:hardware',
  QUESTION: 'question',
  SMS: 'sms',
  CALL: 'call',
  EMAIL: 'email',
  PUSH: 'push',
  WEB: 'web',
  WEBAUTHN: 'webauthn',
  SIGNED_NONCE: 'signed_nonce',
});

module.exports = {
  createClient,

  // Auth module (exported for direct use if needed)
  auth,

  // API modules
  users,
  groups,
  apps,
  policies,

  // Config + gating
  loadMigrationProfile,
  gate,

  // Constants
  GROUP_TYPE,
  USER_STATUS,
  SIGN_ON_MODE,
  POLICY_TYPE,
  FACTOR_TYPE,
};
