/**
 * lib/ping/onprem.test.js — Surface module tests for lib/ping/onprem/*.js
 *
 * Covers: pingfederate.js, pingdirectory.js, pingaccess.js
 * Mock strategy: globalThis.fetch override (no live network)
 * Key assertions: fetchOpenApiSpec dual-probe, pingaccess login shape,
 *                 XSRF header behavior, SCIM pagination
 *
 * Run: node --test lib/ping/onprem.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const pingfederate = require('./onprem/pingfederate');
const pingdirectory = require('./onprem/pingdirectory');
const pingaccess    = require('./onprem/pingaccess');

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
    headers: { get: (key) => headerMap.get(key.toLowerCase()) ?? null },
    json: () => Promise.resolve(body),
  };
}

function mockFetch(urlMap) {
  globalThis.fetch = async (url, options) => {
    for (const [pattern, response] of Object.entries(urlMap)) {
      if (url.includes(pattern)) {
        return makeResponse(
          response.status,
          response.body ?? null,
          response.headers ?? {}
        );
      }
    }
    const err = new Error(`No mock for URL: ${url}`);
    err.code = 'ECONNREFUSED';
    throw err;
  };
}

/** Capture what fetch was called with (for header inspection). */
function captureFetch(urlMap) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    for (const [pattern, response] of Object.entries(urlMap)) {
      if (url.includes(pattern)) {
        return makeResponse(response.status, response.body ?? null, response.headers ?? {});
      }
    }
    const err = new Error(`No mock for URL: ${url}`);
    throw err;
  };
  return calls;
}

// ---------------------------------------------------------------------------
// Minimal valid clients
// ---------------------------------------------------------------------------

function pfClient() {
  return {
    adminUrl: 'https://pf.corp.example.com:9999',
    getAuthHeader: () => 'Basic dXNlcjpwYXNz',
    xsrfHeader: 'PingFederate',
  };
}

function pdClient() {
  return {
    scimUrl: 'https://pd.corp.example.com/scim/v2',
    getAuthHeader: () => 'Basic dXNlcjpwYXNz',
  };
}

function paClient() {
  return {
    adminUrl: 'https://pa.corp.example.com:9000',
    username: 'admin',
    password: 'secret',
  };
}

// ============================================================================
// pingfederate.js — listSpConnections
// ============================================================================

describe('onprem/pingfederate — listSpConnections', () => {
  it('returns {ok:true, data:[]} when items is empty', async () => {
    mockFetch({ '/pf-admin-api/v1/idp/spConnections': { status: 200, body: { items: [], totalCount: 0 } } });
    const result = await pingfederate.listSpConnections(pfClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns items array from response', async () => {
    const sp = [{ id: 'sp1', name: 'Salesforce', entityId: 'urn:salesforce' }];
    mockFetch({ '/pf-admin-api/v1/idp/spConnections': { status: 200, body: { items: sp, totalCount: 1 } } });
    const result = await pingfederate.listSpConnections(pfClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].entityId, 'urn:salesforce');
    assert.equal(result.totalCount, 1);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingfederate.listSpConnections(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('client'));
  });

  it('returns {ok:false} on 401', async () => {
    mockFetch({ '/pf-admin-api/v1/idp/spConnections': { status: 401, body: null } });
    const result = await pingfederate.listSpConnections(pfClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

describe('onprem/pingfederate — getSpConnection', () => {
  it('returns full connection object', async () => {
    mockFetch({ '/pf-admin-api/v1/idp/spConnections/sp1': { status: 200, body: { id: 'sp1', spBrowserSso: {} } } });
    const result = await pingfederate.getSpConnection(pfClient(), 'sp1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'sp1');
  });

  it('returns {ok:false} when connectionId is missing', async () => {
    const result = await pingfederate.getSpConnection(pfClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('connectionId'));
  });
});

// ============================================================================
// pingfederate.js — fetchOpenApiSpec (CRITICAL — dual-probe)
// ============================================================================

describe('onprem/pingfederate — fetchOpenApiSpec', () => {
  it('returns spec when first probe path (/pf-admin-api/api-docs) succeeds', async () => {
    const specData = { swagger: '2.0', info: { title: 'PF Admin API' } };
    mockFetch({ '/pf-admin-api/api-docs': { status: 200, body: specData } });
    const result = await pingfederate.fetchOpenApiSpec(pfClient());
    assert.equal(result.ok, true);
    assert.equal(result.data.swagger, '2.0');
  });

  it('falls through to second probe (/pf-admin-api/v1/swagger.json) when first fails', async () => {
    const specData = { swagger: '2.0', info: { title: 'PF Admin API v1' } };
    let callCount = 0;
    globalThis.fetch = async (url) => {
      callCount++;
      if (url.includes('/pf-admin-api/api-docs')) {
        return makeResponse(404, null);
      }
      if (url.includes('/pf-admin-api/v1/swagger.json')) {
        return makeResponse(200, specData);
      }
      throw new Error(`Unexpected URL: ${url}`);
    };
    const result = await pingfederate.fetchOpenApiSpec(pfClient());
    assert.equal(result.ok, true);
    assert.equal(result.data.info.title, 'PF Admin API v1');
    assert.ok(callCount >= 2, 'Expected at least 2 probe attempts');
  });

  it('returns {ok:false} when BOTH probe paths fail', async () => {
    mockFetch({
      '/pf-admin-api/api-docs': { status: 404, body: null },
      '/pf-admin-api/v1/swagger.json': { status: 404, body: null },
    });
    const result = await pingfederate.fetchOpenApiSpec(pfClient());
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string');
    assert.ok(result.error.length > 0, 'error message should be non-empty');
  });

  it('returns {ok:false} when both probes throw network errors', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await pingfederate.fetchOpenApiSpec(pfClient());
    assert.equal(result.ok, false);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingfederate.fetchOpenApiSpec(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('client'));
  });
});

// ============================================================================
// pingfederate.js — XSRF header behavior
// ============================================================================

describe('onprem/pingfederate — XSRF header on non-GET requests', () => {
  it('does NOT inject X-XSRF-Header on GET requests', async () => {
    const calls = captureFetch({
      '/pf-admin-api/v1/serverSettings': { status: 200, body: {} },
    });
    await pingfederate.getServerSettings(pfClient());
    assert.equal(calls.length, 1);
    const headers = calls[0].options?.headers ?? {};
    assert.ok(!headers['X-XSRF-Header'], 'GET must not have X-XSRF-Header');
  });
});

// ============================================================================
// pingfederate.js — listOauthClients, getServerSettings, listPasswordCredentialValidators
// ============================================================================

describe('onprem/pingfederate — listOauthClients', () => {
  it('returns items from response', async () => {
    mockFetch({ '/pf-admin-api/v1/oauth/clients': { status: 200, body: { items: [{ clientId: 'cli1' }], totalCount: 1 } } });
    const result = await pingfederate.listOauthClients(pfClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].clientId, 'cli1');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingfederate.listOauthClients(null);
    assert.equal(result.ok, false);
  });
});

describe('onprem/pingfederate — getServerSettings', () => {
  it('returns server settings object', async () => {
    mockFetch({ '/pf-admin-api/v1/serverSettings': { status: 200, body: { rolesAndProtocols: {} } } });
    const result = await pingfederate.getServerSettings(pfClient());
    assert.equal(result.ok, true);
    assert.ok(result.data !== null);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingfederate.getServerSettings(null);
    assert.equal(result.ok, false);
  });
});

describe('onprem/pingfederate — listPasswordCredentialValidators', () => {
  it('returns validators list', async () => {
    mockFetch({
      '/pf-admin-api/v1/passwordCredentialValidators': {
        status: 200,
        body: { items: [{ id: 'pcv1', name: 'LDAP Validator' }], totalCount: 1 },
      },
    });
    const result = await pingfederate.listPasswordCredentialValidators(pfClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].id, 'pcv1');
  });
});

// ============================================================================
// pingfederate.js — fetchAll pagination
// ============================================================================

describe('onprem/pingfederate — fetchAll pagination', () => {
  it('auto-paginates listSpConnections when fetchAll is true', async () => {
    let page = 0;
    globalThis.fetch = async (url) => {
      page++;
      if (page === 1) {
        // First page: full (100 items — use smaller for test)
        const items = Array.from({ length: 2 }, (_, i) => ({ id: `sp${i}` }));
        return makeResponse(200, { items, totalCount: 3 });
      }
      // Second page: partial (1 item) — signals last page
      return makeResponse(200, { items: [{ id: 'sp2' }], totalCount: 3 });
    };

    // Use a small numberPerPage so we don't need 100 items
    const result = await pingfederate.listSpConnections(pfClient(), { fetchAll: true, numberPerPage: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 3);
  });
});

// ============================================================================
// pingdirectory.js — SCIM Users/Groups
// ============================================================================

describe('onprem/pingdirectory — listUsers', () => {
  it('returns Resources from SCIM response', async () => {
    const scimBody = { schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'], totalResults: 1, Resources: [{ id: 'user1', userName: 'alice' }] };
    mockFetch({ '/scim/v2/Users': { status: 200, body: scimBody } });
    const result = await pingdirectory.listUsers(pdClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].userName, 'alice');
    assert.equal(result.totalResults, 1);
  });

  it('returns empty array when Resources is absent', async () => {
    mockFetch({ '/scim/v2/Users': { status: 200, body: { totalResults: 0 } } });
    const result = await pingdirectory.listUsers(pdClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingdirectory.listUsers(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('client'));
  });

  it('returns {ok:false} on 401', async () => {
    mockFetch({ '/scim/v2/Users': { status: 401, body: null } });
    const result = await pingdirectory.listUsers(pdClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });
});

describe('onprem/pingdirectory — getUser', () => {
  it('returns a single user by ID', async () => {
    mockFetch({ '/scim/v2/Users/user1': { status: 200, body: { id: 'user1', userName: 'alice' } } });
    const result = await pingdirectory.getUser(pdClient(), 'user1');
    assert.equal(result.ok, true);
    assert.equal(result.data.userName, 'alice');
  });

  it('returns {ok:false} when userId is missing', async () => {
    const result = await pingdirectory.getUser(pdClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('userId'));
  });
});

describe('onprem/pingdirectory — listGroups', () => {
  it('returns groups from Resources array', async () => {
    mockFetch({ '/scim/v2/Groups': { status: 200, body: { totalResults: 1, Resources: [{ id: 'grp1', displayName: 'Engineering' }] } } });
    const result = await pingdirectory.listGroups(pdClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].displayName, 'Engineering');
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingdirectory.listGroups(null);
    assert.equal(result.ok, false);
  });
});

describe('onprem/pingdirectory — SCIM fetchAll pagination', () => {
  it('auto-paginates until Resources.length < pageSize', async () => {
    let page = 0;
    globalThis.fetch = async (url) => {
      page++;
      if (page === 1) {
        return makeResponse(200, { totalResults: 3, Resources: [{ id: 'u1' }, { id: 'u2' }] });
      }
      return makeResponse(200, { totalResults: 3, Resources: [{ id: 'u3' }] });
    };

    const result = await pingdirectory.listUsers(pdClient(), { fetchAll: true, count: 2 });
    assert.equal(result.ok, true);
    assert.equal(result.data.length, 3);
  });
});

// ============================================================================
// pingaccess.js — login (CRITICAL — session shape)
// ============================================================================

describe('onprem/pingaccess — login', () => {
  it('returns {ok:true, data:{cookie, xsrfToken}} on success', async () => {
    globalThis.fetch = async () =>
      makeResponse(200, {}, {
        'set-cookie': 'PA_TOKEN=abc123; HttpOnly; Secure, XSRF-TOKEN=xsrf456; Path=/',
      });

    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, true);
    assert.ok(result.data, 'data should be present');
    assert.ok(result.data.cookie, 'cookie should be present');
    assert.ok(typeof result.data.xsrfToken === 'string', 'xsrfToken should be a string');
  });

  it('data.cookie contains the session token value', async () => {
    globalThis.fetch = async () =>
      makeResponse(200, {}, { 'set-cookie': 'PA_TOKEN=mysession42; HttpOnly; Secure' });

    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, true);
    assert.ok(result.data.cookie.includes('PA_TOKEN'), `cookie: ${result.data.cookie}`);
  });

  it('data.xsrfToken contains the XSRF-TOKEN cookie value', async () => {
    globalThis.fetch = async () =>
      makeResponse(200, {}, {
        'set-cookie': 'PA_TOKEN=sess; HttpOnly, XSRF-TOKEN=csrf-value-99; Path=/',
      });

    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, true);
    assert.equal(result.data.xsrfToken, 'csrf-value-99');
  });

  it('returns {ok:false} when login returns non-200', async () => {
    globalThis.fetch = async () => makeResponse(401, { message: 'Invalid credentials' });
    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('returns {ok:false} when no session cookie in response', async () => {
    globalThis.fetch = async () => makeResponse(200, {}, {}); // no set-cookie header
    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('cookie'), `error: ${result.error}`);
  });

  it('returns {ok:false} on network error', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const result = await pingaccess.login(paClient());
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('network') || result.error.includes('error'), `error: ${result.error}`);
  });

  it('returns {ok:false} when client is missing', async () => {
    const result = await pingaccess.login(null);
    assert.equal(result.ok, false);
  });

  it('returns {ok:false} when client.adminUrl is missing', async () => {
    const result = await pingaccess.login({ username: 'admin', password: 'secret' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('adminUrl'));
  });

  it('returns {ok:false} when client.username is missing', async () => {
    const result = await pingaccess.login({ adminUrl: 'https://pa.corp.example.com:9000', password: 'secret' });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('username'));
  });
});

// ============================================================================
// pingaccess.js — GET requests (do NOT require XSRF)
// ============================================================================

describe('onprem/pingaccess — GET requests do not send XSRF header', () => {
  it('listResources GET does not include X-XSRF-TOKEN header', async () => {
    const calls = [];
    const session = { cookie: 'PA_TOKEN=sess42', xsrfToken: 'csrf-abc' };

    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      return makeResponse(200, { items: [], totalCount: 0 });
    };

    await pingaccess.listResources(paClient(), session);
    assert.equal(calls.length, 1);
    const headers = calls[0].options?.headers ?? {};
    assert.ok(!headers['X-XSRF-TOKEN'], 'GET must not include X-XSRF-TOKEN header');
  });
});

// ============================================================================
// pingaccess.js — listResources, listApplications, getServerVersion
// ============================================================================

describe('onprem/pingaccess — listResources', () => {
  const session = { cookie: 'PA_TOKEN=sess', xsrfToken: 'xsrf' };

  it('returns resources from response items', async () => {
    mockFetch({ '/pa-admin-api/v3/resources': { status: 200, body: { items: [{ id: 'res1', name: '/api' }], totalCount: 1 } } });
    const result = await pingaccess.listResources(paClient(), session);
    assert.equal(result.ok, true);
    assert.equal(result.data.items[0].id, 'res1');
  });

  it('returns {ok:false} when session is missing', async () => {
    const result = await pingaccess.listResources(paClient(), null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('session'));
  });

  it('returns {ok:false} when session expired (401)', async () => {
    mockFetch({ '/pa-admin-api/v3/resources': { status: 401, body: null } });
    const result = await pingaccess.listResources(paClient(), session);
    assert.equal(result.ok, false);
    assert.ok(result.error.toLowerCase().includes('session') || result.error.includes('401'), `error: ${result.error}`);
  });
});

describe('onprem/pingaccess — listApplications', () => {
  const session = { cookie: 'PA_TOKEN=sess', xsrfToken: 'xsrf' };

  it('returns applications from response items', async () => {
    mockFetch({ '/pa-admin-api/v3/applications': { status: 200, body: { items: [{ id: 'a1', name: 'Portal' }], totalCount: 1 } } });
    const result = await pingaccess.listApplications(paClient(), session);
    assert.equal(result.ok, true);
    assert.equal(result.data.items[0].name, 'Portal');
  });

  it('returns {ok:false} when session is missing', async () => {
    const result = await pingaccess.listApplications(paClient(), null);
    assert.equal(result.ok, false);
  });
});

describe('onprem/pingaccess — getServerVersion', () => {
  const session = { cookie: 'PA_TOKEN=sess', xsrfToken: 'xsrf' };

  it('returns version object', async () => {
    mockFetch({ '/pa-admin-api/v3/version': { status: 200, body: { version: '7.1.0' } } });
    const result = await pingaccess.getServerVersion(paClient(), session);
    assert.equal(result.ok, true);
    assert.equal(result.data.version, '7.1.0');
  });

  it('returns {ok:false} when session is missing', async () => {
    const result = await pingaccess.getServerVersion(paClient(), null);
    assert.equal(result.ok, false);
  });
});
