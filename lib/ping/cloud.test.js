/**
 * lib/ping/cloud.test.js — Surface module tests for lib/ping/cloud/*.js
 *
 * Covers: apps, users, groups, environments, policies, auth
 * Mock strategy: globalThis.fetch override (no live network)
 * Includes end-to-end NameID chain: listSamlApps → assertNameIdPortable gate
 *
 * Run: node --test lib/ping/cloud.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const apps         = require('./cloud/apps');
const users        = require('./cloud/users');
const groups       = require('./cloud/groups');
const environments = require('./cloud/environments');
const policies     = require('./cloud/policies');
const auth         = require('./cloud/auth');
const { assertNameIdPortable } = require('./gate');

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

let _savedFetch;
beforeEach(() => { _savedFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = _savedFetch; });

function makeResponse(status, body, extraHeaders = {}) {
  const headerMap = new Map(
    Object.entries({ 'content-type': 'application/json', ...extraHeaders })
      .map(([k, v]) => [k.toLowerCase(), v])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => headerMap.get(key.toLowerCase()) ?? null,
    },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

/**
 * Install a fetch mock that maps URL substrings to { status, body }.
 * Falls through to a connection-refused error if no pattern matches.
 */
function mockFetch(urlMap) {
  globalThis.fetch = async (url) => {
    for (const [pattern, response] of Object.entries(urlMap)) {
      if (url.includes(pattern)) {
        return makeResponse(
          response.status,
          response.body ?? null,
          response.headers ?? {}
        );
      }
    }
    const err = new Error(`No mock registered for URL: ${url}`);
    err.code = 'ECONNREFUSED';
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Minimal valid clients
// ---------------------------------------------------------------------------

function cloudClient() {
  return {
    baseUrl: 'https://api.pingone.com/v1',
    getAuthHeader: async () => 'Bearer test-token',
  };
}

const ENV_ID = 'env-abc123';

// ---------------------------------------------------------------------------
// NameID gate profile (for end-to-end tests)
// ---------------------------------------------------------------------------

function pingProfile() {
  return {
    source_of_truth: {
      per_class_ownership: {
        users: 'ping', credentials_mfa: 'ping', groups: 'ping',
        app_assignments: 'ping', policies: 'ping', saml_sp_connections: 'ping',
      },
    },
    strategy: {
      cutover_shape: 'phased_by_app',
      group_strategy: 'lift_and_shift',
      federation_direction: 'ping_idp_into_entra',
      mfa_strategy: 'pingid_reenroll',
      nameid_strategy: 'map_to_persistent',
    },
    execution: { dry_run: true, entra_write_tooling: 'none' },
  };
}

// ============================================================================
// apps.js
// ============================================================================

describe('cloud/apps — listApplications', () => {
  it('returns {ok:true, data:[]} when _embedded.applications is empty', async () => {
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [] } } } });
    const result = await apps.listApplications(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns data array from _embedded.applications', async () => {
    const appData = [{ id: 'app1', name: 'MyApp', protocol: 'SAML' }];
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: appData } } } });
    const result = await apps.listApplications(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].id, 'app1');
  });

  it('returns {ok:false} on 401', async () => {
    mockFetch({ '/applications': { status: 401, body: { message: 'Unauthorized' } } });
    const result = await apps.listApplications(cloudClient(), ENV_ID);
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.equal(result.status, 401);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await apps.listApplications(null, ENV_ID);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('client'));
  });

  it('returns {ok:false} when envId is missing', async () => {
    const result = await apps.listApplications(cloudClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('envId'));
  });

  it('follows nextLink cursor for pagination', async () => {
    const page2Url = 'https://api.pingone.com/v1/environments/env-abc123/applications?cursor=page2';
    mockFetch({ [page2Url]: { status: 200, body: { _embedded: { applications: [{ id: 'app2' }] } } } });
    const result = await apps.listApplications(cloudClient(), ENV_ID, { nextLink: page2Url });
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'app2');
  });

  it('includes nextLink when HAL _links.next is present', async () => {
    mockFetch({
      '/applications': {
        status: 200,
        body: {
          _embedded: { applications: [{ id: 'app1' }] },
          _links: { next: { href: 'https://api.pingone.com/v1/environments/env-abc123/applications?cursor=page2' } },
        },
      },
    });
    const result = await apps.listApplications(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.ok(result.nextLink, 'nextLink should be present');
  });
});

describe('cloud/apps — getApplication', () => {
  it('returns {ok:true, data} for a known appId', async () => {
    const appData = { id: 'app1', name: 'MyApp' };
    mockFetch({ '/applications/app1': { status: 200, body: appData } });
    const result = await apps.getApplication(cloudClient(), ENV_ID, 'app1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'app1');
  });

  it('returns {ok:false} when appId is missing', async () => {
    const result = await apps.getApplication(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('appId'));
  });

  it('returns {ok:false} on 404', async () => {
    mockFetch({ '/applications/notfound': { status: 404, body: { message: 'Not found' } } });
    const result = await apps.getApplication(cloudClient(), ENV_ID, 'notfound');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
});

describe('cloud/apps — listSamlApps (NameID enrichment)', () => {
  it('enriches each SAML app with top-level nameIdFormat field', async () => {
    const samlApp = {
      id: 'saml1',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });
    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].nameIdFormat, 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
  });

  it('sets nameIdFormat to null when spSaml.nameIdFormat is absent', async () => {
    const samlApp = { id: 'saml2', protocol: 'SAML', spSaml: {} };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });
    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].nameIdFormat, null);
  });

  it('sets nameIdFormat to null when spSaml block is entirely absent', async () => {
    const samlApp = { id: 'saml3', protocol: 'SAML' };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });
    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].nameIdFormat, null);
  });

  it('preserves all original app fields alongside nameIdFormat', async () => {
    const samlApp = {
      id: 'saml4',
      name: 'Salesforce',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });
    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'saml4');
    assert.equal(result.data[0].name, 'Salesforce');
    assert.equal(result.data[0].nameIdFormat, 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
  });

  it('returns {ok:false} when API call fails', async () => {
    mockFetch({ '/applications': { status: 403, body: { message: 'Forbidden' } } });
    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

describe('cloud/apps — listSamlApps → gate.assertNameIdPortable (end-to-end)', () => {
  it('transient NameID from listSamlApps hard-blocks via assertNameIdPortable', async () => {
    const samlApp = {
      id: 'blocker-app',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });

    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);

    const nameIdFormat = result.data[0].nameIdFormat;
    assert.equal(nameIdFormat, 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient');

    const gateResult = assertNameIdPortable(pingProfile(), nameIdFormat);
    assert.equal(gateResult.ok, false);
    assert.equal(gateResult.blocker, 'nameid_incompatible');
    assert.ok(gateResult.error.includes('BLOCKED'));
  });

  it('kerberos NameID from listSamlApps hard-blocks via gate', async () => {
    const samlApp = {
      id: 'kerberos-app',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });

    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    const gateResult = assertNameIdPortable(pingProfile(), result.data[0].nameIdFormat);
    assert.equal(gateResult.ok, false);
    assert.equal(gateResult.blocker, 'nameid_incompatible');
  });

  it('X509SubjectName NameID from listSamlApps hard-blocks via gate', async () => {
    const samlApp = {
      id: 'x509-app',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });

    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    const gateResult = assertNameIdPortable(pingProfile(), result.data[0].nameIdFormat);
    assert.equal(gateResult.ok, false);
    assert.equal(gateResult.blocker, 'nameid_incompatible');
  });

  it('persistent NameID from listSamlApps passes gate', async () => {
    const samlApp = {
      id: 'ok-app',
      protocol: 'SAML',
      spSaml: { nameIdFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent' },
    };
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [samlApp] } } } });

    const result = await apps.listSamlApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    const gateResult = assertNameIdPortable(pingProfile(), result.data[0].nameIdFormat);
    assert.equal(gateResult.ok, true);
  });
});

describe('cloud/apps — listOidcApps', () => {
  it('returns {ok:true, data:[]} for empty results', async () => {
    mockFetch({ '/applications': { status: 200, body: { _embedded: { applications: [] } } } });
    const result = await apps.listOidcApps(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await apps.listOidcApps(null, ENV_ID);
    assert.equal(result.ok, false);
  });
});

// ============================================================================
// users.js
// ============================================================================

describe('cloud/users — listUsers', () => {
  it('returns {ok:true, data:[]} when _embedded.users is empty', async () => {
    mockFetch({ '/users': { status: 200, body: { _embedded: { users: [] } } } });
    const result = await users.listUsers(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns users array from _embedded.users', async () => {
    const userData = [{ id: 'u1', username: 'alice' }];
    mockFetch({ '/users': { status: 200, body: { _embedded: { users: userData } } } });
    const result = await users.listUsers(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].username, 'alice');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await users.listUsers(null, ENV_ID);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('client'));
  });

  it('returns {ok:false} when envId is missing', async () => {
    const result = await users.listUsers(cloudClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('envId'));
  });

  it('follows nextLink cursor', async () => {
    const cursor = 'https://api.pingone.com/v1/environments/env-abc123/users?cursor=page2';
    mockFetch({ [cursor]: { status: 200, body: { _embedded: { users: [{ id: 'u2' }] } } } });
    const result = await users.listUsers(cloudClient(), ENV_ID, { nextLink: cursor });
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'u2');
  });

  it('returns {ok:false} on 401', async () => {
    mockFetch({ '/users': { status: 401, body: { message: 'Unauthorized' } } });
    const result = await users.listUsers(cloudClient(), ENV_ID);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

describe('cloud/users — getUser', () => {
  it('returns {ok:true, data} for a known userId', async () => {
    mockFetch({ '/users/u1': { status: 200, body: { id: 'u1', username: 'alice' } } });
    const result = await users.getUser(cloudClient(), ENV_ID, 'u1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'u1');
  });

  it('returns {ok:false} when userId is missing', async () => {
    const result = await users.getUser(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('userId'));
  });
});

describe('cloud/users — searchUsers', () => {
  it('returns {ok:false} when filter is missing', async () => {
    const result = await users.searchUsers(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('filter'));
  });

  it('delegates to listUsers with the filter param', async () => {
    mockFetch({ '/users': { status: 200, body: { _embedded: { users: [{ id: 'alice' }] } } } });
    const result = await users.searchUsers(cloudClient(), ENV_ID, 'username eq "alice"');
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'alice');
  });
});

// ============================================================================
// groups.js
// ============================================================================

describe('cloud/groups — listGroups', () => {
  it('returns {ok:true, data:[]} when empty', async () => {
    mockFetch({ '/groups': { status: 200, body: { _embedded: { groups: [] } } } });
    const result = await groups.listGroups(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns groups from _embedded.groups', async () => {
    mockFetch({ '/groups': { status: 200, body: { _embedded: { groups: [{ id: 'g1', name: 'Engineering' }] } } } });
    const result = await groups.listGroups(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].name, 'Engineering');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await groups.listGroups(null, ENV_ID);
    assert.equal(result.ok, false);
  });
});

describe('cloud/groups — getGroup', () => {
  it('returns {ok:true, data} for a known groupId', async () => {
    mockFetch({ '/groups/g1': { status: 200, body: { id: 'g1' } } });
    const result = await groups.getGroup(cloudClient(), ENV_ID, 'g1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'g1');
  });

  it('returns {ok:false} when groupId is missing', async () => {
    const result = await groups.getGroup(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('groupId'));
  });
});

describe('cloud/groups — listGroupMembers', () => {
  it('returns members from _embedded.groupMemberships', async () => {
    mockFetch({ '/members': { status: 200, body: { _embedded: { groupMemberships: [{ id: 'u1' }] } } } });
    const result = await groups.listGroupMembers(cloudClient(), ENV_ID, 'g1');
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'u1');
  });

  it('returns {ok:false} when groupId is missing', async () => {
    const result = await groups.listGroupMembers(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('groupId'));
  });
});

// ============================================================================
// environments.js
// ============================================================================

describe('cloud/environments — listEnvironments', () => {
  it('returns {ok:true, data:[]} when empty', async () => {
    mockFetch({ '/environments': { status: 200, body: { _embedded: { environments: [] } } } });
    const result = await environments.listEnvironments(cloudClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns environments from _embedded.environments', async () => {
    mockFetch({ '/environments': { status: 200, body: { _embedded: { environments: [{ id: 'env1', name: 'Production' }] } } } });
    const result = await environments.listEnvironments(cloudClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].name, 'Production');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await environments.listEnvironments(null);
    assert.equal(result.ok, false);
  });
});

describe('cloud/environments — listPopulations', () => {
  it('returns populations from _embedded.populations', async () => {
    mockFetch({ '/populations': { status: 200, body: { _embedded: { populations: [{ id: 'pop1', name: 'Default' }] } } } });
    const result = await environments.listPopulations(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].name, 'Default');
  });

  it('returns {ok:false} when envId is missing', async () => {
    const result = await environments.listPopulations(cloudClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('envId'));
  });
});

// ============================================================================
// policies.js
// ============================================================================

describe('cloud/policies — listSignOnPolicies', () => {
  it('returns policies from _embedded.signOnPolicies', async () => {
    mockFetch({ '/signOnPolicies': { status: 200, body: { _embedded: { signOnPolicies: [{ id: 'pol1' }] } } } });
    const result = await policies.listSignOnPolicies(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'pol1');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await policies.listSignOnPolicies(null, ENV_ID);
    assert.equal(result.ok, false);
  });

  it('returns {ok:false} on error response', async () => {
    mockFetch({ '/signOnPolicies': { status: 403, body: { message: 'Forbidden' } } });
    const result = await policies.listSignOnPolicies(cloudClient(), ENV_ID);
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

describe('cloud/policies — getSignOnPolicy', () => {
  it('returns policy data for a known policyId', async () => {
    mockFetch({ '/signOnPolicies/pol1': { status: 200, body: { id: 'pol1', name: 'Default Policy' } } });
    const result = await policies.getSignOnPolicy(cloudClient(), ENV_ID, 'pol1');
    assert.equal(result.ok, true);
    assert.equal(result.data.name, 'Default Policy');
  });

  it('returns {ok:false} when policyId is missing', async () => {
    const result = await policies.getSignOnPolicy(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('policyId'));
  });
});

describe('cloud/policies — listSignOnPolicyActions', () => {
  it('returns actions from _embedded.actions', async () => {
    mockFetch({ '/actions': { status: 200, body: { _embedded: { actions: [{ type: 'LOGIN' }] } } } });
    const result = await policies.listSignOnPolicyActions(cloudClient(), ENV_ID, 'pol1');
    assert.equal(result.ok, true);
    assert.equal(result.data[0].type, 'LOGIN');
  });

  it('returns {ok:false} when policyId is missing', async () => {
    const result = await policies.listSignOnPolicyActions(cloudClient(), ENV_ID, null);
    assert.equal(result.ok, false);
  });
});

// ============================================================================
// auth.js
// ============================================================================

describe('cloud/auth — buildApiBaseUrl', () => {
  it('returns pingone.com base for region=com', () => {
    assert.ok(auth.buildApiBaseUrl('com').includes('pingone.com'));
  });

  it('returns eu base for region=eu', () => {
    assert.ok(auth.buildApiBaseUrl('eu').includes('eu'));
    assert.ok(auth.buildApiBaseUrl('eu').includes('pingone'));
  });

  it('returns au base for region=au', () => {
    assert.ok(auth.buildApiBaseUrl('au').includes('au'));
  });

  it('defaults to com when region is not provided', () => {
    assert.ok(auth.buildApiBaseUrl().includes('pingone.com'));
  });
});

describe('cloud/auth — buildTokenUrl', () => {
  it('includes the envId in the token URL', () => {
    const url = auth.buildTokenUrl('com', 'env-123');
    assert.ok(url.includes('env-123'));
    assert.ok(url.includes('/as/token'));
  });

  it('uses auth.pingone.com for com region', () => {
    const url = auth.buildTokenUrl('com', 'env-123');
    assert.ok(url.includes('auth.pingone.com'));
  });
});

describe('cloud/auth — fetchToken', () => {
  beforeEach(() => { auth.clearTokenCache(); });

  it('returns {ok:true, data} with accessToken on success', async () => {
    mockFetch({
      '/as/token': { status: 200, body: { access_token: 'tok123', expires_in: 3600, token_type: 'Bearer' } },
    });
    const result = await auth.fetchToken({ environmentId: 'env1', clientId: 'c1', clientSecret: 's1', region: 'com' });
    assert.equal(result.ok, true);
    assert.equal(result.data.accessToken, 'tok123');
    assert.equal(result.data.tokenType, 'Bearer');
  });

  it('returns {ok:false} when environmentId is missing', async () => {
    const result = await auth.fetchToken({ clientId: 'c1', clientSecret: 's1' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('environmentId'));
  });

  it('returns {ok:false} on 401 from token endpoint', async () => {
    mockFetch({ '/as/token': { status: 401, body: { error: 'invalid_client', error_description: 'Bad credentials' } } });
    const result = await auth.fetchToken({ environmentId: 'env1', clientId: 'bad', clientSecret: 'bad', region: 'com' });
    assert.equal(result.ok, false);
    assert.ok(result.error.length > 0);
  });

  it('caches token and reuses on second call (no second fetch)', async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount++;
      return makeResponse(200, { access_token: 'cached-tok', expires_in: 3600, token_type: 'Bearer' });
    };

    const config = { environmentId: 'env2', clientId: 'c2', clientSecret: 's2', region: 'com' };
    await auth.fetchToken(config);
    await auth.fetchToken(config);
    assert.equal(callCount, 1, 'fetch should only be called once (cache hit on second call)');
  });

  it('returns {ok:false} when fetch throws a network error', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await auth.fetchToken({ environmentId: 'env1', clientId: 'c1', clientSecret: 's1', region: 'com' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('network') || result.error.includes('error'), `error: ${result.error}`);
  });
});

// ============================================================================
// utils.js — 429 back-off retry via pingRequest
// ============================================================================

describe('utils — 429 retry (via pingRequest through listUsers)', () => {
  it('MAX_RETRIES is 3', () => {
    const { MAX_RETRIES } = require('./utils');
    assert.equal(MAX_RETRIES, 3);
  });

  it('retries up to MAX_RETRIES on 429 then succeeds', async () => {
    let callCount = 0;
    const userData = [{ id: 'u1' }];
    globalThis.fetch = async () => {
      callCount++;
      if (callCount <= 1) {
        // First call: 429
        return {
          ok: false,
          status: 429,
          headers: {
            get: (key) => key.toLowerCase() === 'retry-after' ? '0' : null,
          },
          json: async () => ({ message: 'Too Many Requests' }),
        };
      }
      // Second call: success
      return makeResponse(200, { _embedded: { users: userData } });
    };

    const result = await users.listUsers(cloudClient(), ENV_ID);
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'u1');
    assert.ok(callCount >= 2, `Expected at least 2 calls (429 then success), got ${callCount}`);
  });
});
