/**
 * Okta API Client — Comprehensive Test Suite
 *
 * Written by Carver (Tester/QA). Tests Sydnor's lib/okta implementation.
 * Covers: createClient config validation (ssws / clientCredentials /
 * privateKeyJwt), auth module (token acquisition, caching, header shapes),
 * Link-header cursor pagination (extractNextLink + listUsers traversal),
 * HTTP 429 rate-limit handling, and all four API modules (users, groups,
 * apps, policies).
 *
 * Run: node --test lib/okta/okta.test.js
 *
 * CONTRACT GAPS (see .squad/decisions/inbox/carver-okta-review.md):
 *   GAP-1: normalizeOrgUrl() does not add https:// when scheme is omitted —
 *          schemeless URLs cause silent fetch failures at runtime.
 *   GAP-2: No write operations (createUser, addGroupMember, etc.) — Sydnor's
 *          "READ-FIRST" design choice needs explicit coordinator sign-off.
 */

import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Module imports — graceful fallback when lib/okta isn't committed yet
// ---------------------------------------------------------------------------
const STUB = async () => ({ ok: false, error: 'module not yet implemented' });

let okta, auth, users, groups, apps, policies, utils;

try { okta = require('./index.js'); } catch {
  okta = {
    createClient: () => { throw new Error('okta index.js not yet implemented'); },
  };
}
try { auth = require('./auth.js'); } catch {
  auth = {
    getSswsAuthHeader: () => ({ ok: false, error: 'not implemented' }),
    getTokenClientCredentials: STUB,
    getTokenPrivateKeyJwt: STUB,
    buildPrivateKeyJwt: () => ({ ok: false, error: 'not implemented' }),
    clearTokenCache: () => {},
  };
}
try { users = require('./users.js'); } catch {
  users = { listUsers: STUB, getUser: STUB, searchUsers: STUB, listUserGroups: STUB, listUserFactors: STUB };
}
try { groups = require('./groups.js'); } catch {
  groups = { listGroups: STUB, getGroup: STUB, listGroupMembers: STUB, listGroupRules: STUB };
}
try { apps = require('./apps.js'); } catch {
  apps = {
    listApps: STUB, getApp: STUB, getAppSamlSettings: STUB,
    getAppOidcSettings: STUB, listAppUsers: STUB, listAppGroups: STUB,
  };
}
try { policies = require('./policies.js'); } catch {
  policies = { listPolicies: STUB, getPolicy: STUB, getPolicyRules: STUB, listAuthenticators: STUB };
}
try { utils = require('./utils.js'); } catch {
  utils = {
    normalizeOrgUrl: (u) => u,
    extractNextLink: () => null,
    oktaGet: STUB, oktaPost: STUB, oktaPut: STUB, oktaRequest: STUB,
    paginatedGet: STUB,
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
const TEST_ORG_URL = 'https://dev-123456.okta.com';
const TEST_API_TOKEN = 'ssws-test-token-abc123';

/**
 * SSWS mock client — mirrors the shape returned by createClient() for ssws mode.
 * The OktaClient contract is { orgUrl, getAuthHeader() }.
 */
function mockSswsClient(token = TEST_API_TOKEN) {
  return {
    orgUrl: TEST_ORG_URL,
    getAuthHeader: async () => `SSWS ${token}`,
  };
}

/** OAuth mock client — getAuthHeader returns a Bearer token. */
function mockOAuthClient(token = 'mock-bearer-token-xyz') {
  return {
    orgUrl: TEST_ORG_URL,
    getAuthHeader: async () => `Bearer ${token}`,
  };
}

/** Client whose getAuthHeader always returns null — simulates auth failure. */
function failingAuthClient() {
  return {
    orgUrl: TEST_ORG_URL,
    getAuthHeader: async () => null,
  };
}

/**
 * Installs a mock globalThis.fetch returning one preset response.
 * Automatically adds `content-type: application/json` when body is a non-null
 * object/array — matches real Okta API behaviour and ensures oktaRequest's
 * content-type guard triggers JSON parsing.
 *
 * @param {number} status  HTTP status code
 * @param {*}      body    JSON-serialisable body (or null for 204-style responses)
 * @param {string} [link]  Value of the HTTP Link response header (Okta pagination)
 * @param {object} [extra] Additional response headers (key→value)
 */
function mockFetch(status, body, link = null, extra = {}) {
  const rawHeaders = { ...extra };
  if (link) rawHeaders['link'] = link;
  // Supply default content-type so oktaRequest's guard fires and JSON is parsed.
  if (body !== null && body !== undefined &&
      !rawHeaders['content-type'] && !rawHeaders['Content-Type']) {
    rawHeaders['content-type'] = 'application/json';
  }
  const headerMap = new Map(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]));

  const fn = mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headerMap.get(name.toLowerCase()) ?? null,
    },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }));
  globalThis.fetch = fn;
  return fn;
}

/** Installs a mock fetch that throws a network error on every call. */
function mockFetchError(message = 'connect ECONNREFUSED') {
  const fn = mock.fn(async () => { throw new Error(message); });
  globalThis.fetch = fn;
  return fn;
}

/**
 * Installs a mock fetch that cycles through an array of preset responses.
 * Repeats the last entry indefinitely once the array is exhausted.
 * Each response auto-gets content-type: application/json when body is non-null.
 */
function mockFetchSequence(responses) {
  let idx = 0;
  const fn = mock.fn(async () => {
    const r = responses[Math.min(idx++, responses.length - 1)];
    const rawHeaders = { ...r.headers } || {};
    // Auto-inject content-type so oktaRequest parses JSON on success responses
    if (r.body !== null && r.body !== undefined &&
        !rawHeaders['content-type'] && !rawHeaders['Content-Type']) {
      rawHeaders['content-type'] = 'application/json';
    }
    const hmap = new Map(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n) => hmap.get(n.toLowerCase()) ?? null },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  });
  globalThis.fetch = fn;
  return fn;
}

let originalFetch;

// ===========================================================================
// 1. createClient — SSWS mode
// ===========================================================================

describe('createClient — SSWS mode', () => {
  it('throws when config is missing entirely', () => {
    assert.throws(() => okta.createClient(), /config/i);
  });

  it('throws when config is not an object', () => {
    assert.throws(() => okta.createClient('token'), /config/i);
  });

  it('throws when config is null', () => {
    assert.throws(() => okta.createClient(null), /config/i);
  });

  it('throws when orgUrl is missing', () => {
    assert.throws(
      () => okta.createClient({ apiToken: TEST_API_TOKEN }),
      /orgUrl/i,
    );
  });

  it('throws when apiToken is missing in ssws mode', () => {
    assert.throws(
      () => okta.createClient({ orgUrl: TEST_ORG_URL, authMethod: 'ssws' }),
      /apiToken/i,
    );
  });

  it('creates client with valid SSWS config (explicit authMethod)', () => {
    const client = okta.createClient({
      orgUrl: TEST_ORG_URL,
      authMethod: 'ssws',
      apiToken: TEST_API_TOKEN,
    });
    assert.equal(typeof client, 'object');
    assert.equal(typeof client.getAuthHeader, 'function');
    assert.equal(client.orgUrl, TEST_ORG_URL);
  });

  it('defaults to ssws when apiToken present and authMethod omitted', () => {
    const client = okta.createClient({ orgUrl: TEST_ORG_URL, apiToken: TEST_API_TOKEN });
    assert.equal(typeof client.getAuthHeader, 'function');
  });

  it('client.orgUrl strips trailing slash', () => {
    const client = okta.createClient({
      orgUrl: 'https://dev-123456.okta.com/',
      authMethod: 'ssws',
      apiToken: TEST_API_TOKEN,
    });
    assert.equal(client.orgUrl, TEST_ORG_URL);
  });

  it('getAuthHeader() returns "SSWS {token}" — no network call needed', async () => {
    const client = okta.createClient({
      orgUrl: TEST_ORG_URL,
      authMethod: 'ssws',
      apiToken: 'my-secret-token',
    });
    const header = await client.getAuthHeader();
    assert.equal(header, 'SSWS my-secret-token');
  });

  it('throws for unknown authMethod', () => {
    assert.throws(
      () => okta.createClient({ orgUrl: TEST_ORG_URL, authMethod: 'magic', apiToken: 'x' }),
      /authMethod|Unknown/i,
    );
  });
});

// ===========================================================================
// 2. createClient — OAuth client_credentials mode
// ===========================================================================

describe('createClient — OAuth clientCredentials mode', () => {
  it('throws when clientId is missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'clientCredentials',
        clientSecret: 'sec',
        scopes: ['okta.users.read'],
      }),
      /clientId/i,
    );
  });

  it('throws when clientSecret is missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'clientCredentials',
        clientId: 'cid',
        scopes: ['okta.users.read'],
      }),
      /clientSecret/i,
    );
  });

  it('throws when scopes array is missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'clientCredentials',
        clientId: 'cid',
        clientSecret: 'sec',
      }),
      /scopes/i,
    );
  });

  it('throws when scopes is an empty array', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'clientCredentials',
        clientId: 'cid',
        clientSecret: 'sec',
        scopes: [],
      }),
      /scopes/i,
    );
  });

  it('creates client with valid clientCredentials config', () => {
    const client = okta.createClient({
      orgUrl: TEST_ORG_URL,
      authMethod: 'clientCredentials',
      clientId: 'cid',
      clientSecret: 'sec',
      scopes: ['okta.users.read'],
    });
    assert.equal(typeof client.getAuthHeader, 'function');
    assert.equal(client.orgUrl, TEST_ORG_URL);
  });

  it('client.orgUrl strips trailing slash in OAuth mode', () => {
    const client = okta.createClient({
      orgUrl: TEST_ORG_URL + '/',
      authMethod: 'clientCredentials',
      clientId: 'cid',
      clientSecret: 'sec',
      scopes: ['okta.users.read'],
    });
    assert.equal(client.orgUrl, TEST_ORG_URL);
  });
});

// ===========================================================================
// 3. createClient — OAuth private_key_jwt mode
// ===========================================================================

describe('createClient — OAuth privateKeyJwt mode', () => {
  it('throws when clientId is missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'privateKeyJwt',
        privateKey: 'pem',
        scopes: ['okta.users.read'],
      }),
      /clientId/i,
    );
  });

  it('throws when privateKey is missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'privateKeyJwt',
        clientId: 'cid',
        scopes: ['okta.users.read'],
      }),
      /privateKey/i,
    );
  });

  it('throws when scopes are missing', () => {
    assert.throws(
      () => okta.createClient({
        orgUrl: TEST_ORG_URL,
        authMethod: 'privateKeyJwt',
        clientId: 'cid',
        privateKey: 'pem',
      }),
      /scopes/i,
    );
  });

  it('creates client with valid privateKeyJwt config', () => {
    const client = okta.createClient({
      orgUrl: TEST_ORG_URL,
      authMethod: 'privateKeyJwt',
      clientId: 'cid',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
      scopes: ['okta.users.read', 'okta.groups.read'],
    });
    assert.equal(typeof client.getAuthHeader, 'function');
  });
});

// ===========================================================================
// 4. utils — normalizeOrgUrl
// ===========================================================================

describe('utils — normalizeOrgUrl', () => {
  it('strips trailing slash', () => {
    const result = utils.normalizeOrgUrl('https://dev-123456.okta.com/');
    assert.equal(result, 'https://dev-123456.okta.com');
  });

  it('[BUG] strips multiple trailing slashes — currently only strips one', () => {
    // Sydnor's regex /\/$/ strips exactly ONE trailing slash.
    // 'https://…///' → 'https://…//' (not 'https://…').
    // This is a minor bug: callers who pass triple-slash URLs get a wrong orgUrl.
    // Leaving as a failing test to track the fix.
    const result = utils.normalizeOrgUrl('https://dev-123456.okta.com///');
    assert.equal(result, 'https://dev-123456.okta.com',
      'BUG: /\\/$/ only removes one slash; use /\\/+$/ to remove all trailing slashes');
  });

  it('preserves URL with no trailing slash', () => {
    const result = utils.normalizeOrgUrl(TEST_ORG_URL);
    assert.equal(result, TEST_ORG_URL);
  });

  it('trims surrounding whitespace', () => {
    const result = utils.normalizeOrgUrl('  https://dev-123456.okta.com  ');
    assert.equal(result, 'https://dev-123456.okta.com');
  });

  // CONTRACT GAP — GAP-1: normalizeOrgUrl does not add https:// when scheme absent.
  // This test documents the MISSING behaviour; it will pass only when Sydnor fixes it.
  it('[GAP-1] schemeless orgUrl should gain https:// prefix — currently broken', () => {
    const result = utils.normalizeOrgUrl('dev-123456.okta.com');
    // The correct behaviour is to prepend https://
    // Currently normalizeOrgUrl just strips trailing slash — this assert WILL FAIL
    // until Sydnor adds: if (!url.match(/^https?:\/\//)) url = 'https://' + url;
    assert.match(
      result,
      /^https:\/\//,
      'GAP-1: normalizeOrgUrl must add https:// when scheme is absent — schemeless URLs cause silent runtime failures',
    );
  });
});

// ===========================================================================
// 5. utils — extractNextLink (Link-header parser)
// ===========================================================================

describe('utils — extractNextLink', () => {
  it('returns null for null input', () => {
    assert.equal(utils.extractNextLink(null), null);
  });

  it('returns null for empty string', () => {
    assert.equal(utils.extractNextLink(''), null);
  });

  it('returns null for undefined', () => {
    assert.equal(utils.extractNextLink(undefined), null);
  });

  it('extracts rel="next" URL from a single-relation header', () => {
    const hdr = '<https://dev-123456.okta.com/api/v1/users?after=cursor1>; rel="next"';
    assert.equal(
      utils.extractNextLink(hdr),
      'https://dev-123456.okta.com/api/v1/users?after=cursor1',
    );
  });

  it('extracts rel="next" from a multi-relation header (next + self)', () => {
    const hdr =
      '<https://dev-123456.okta.com/api/v1/users?after=cursor2>; rel="next",' +
      ' <https://dev-123456.okta.com/api/v1/users>; rel="self"';
    assert.equal(
      utils.extractNextLink(hdr),
      'https://dev-123456.okta.com/api/v1/users?after=cursor2',
    );
  });

  it('returns null when only rel="self" is present (last page)', () => {
    const hdr = '<https://dev-123456.okta.com/api/v1/users>; rel="self"';
    assert.equal(utils.extractNextLink(hdr), null);
  });

  it('handles self appearing before next in the header', () => {
    const hdr =
      '<https://dev-123456.okta.com/api/v1/users>; rel="self",' +
      ' <https://dev-123456.okta.com/api/v1/users?after=c3>; rel="next"';
    assert.equal(
      utils.extractNextLink(hdr),
      'https://dev-123456.okta.com/api/v1/users?after=c3',
    );
  });
});

// ===========================================================================
// 6. auth — SSWS header shape
// ===========================================================================

describe('auth — getSswsAuthHeader', () => {
  it('returns SSWS header string for valid token', () => {
    const result = auth.getSswsAuthHeader('my-api-token');
    assert.equal(result.ok, true);
    assert.equal(result.authHeader, 'SSWS my-api-token');
  });

  it('returns {ok:false} when apiToken is empty', () => {
    const result = auth.getSswsAuthHeader('');
    assert.equal(result.ok, false);
    assert.match(result.error, /apiToken/i);
  });

  it('returns {ok:false} when apiToken is null', () => {
    const result = auth.getSswsAuthHeader(null);
    assert.equal(result.ok, false);
    assert.match(result.error, /apiToken/i);
  });

  it('returns {ok:false} when apiToken is a number', () => {
    const result = auth.getSswsAuthHeader(42);
    assert.equal(result.ok, false);
  });

  it('header prefix is exactly "SSWS " (not Bearer)', () => {
    const result = auth.getSswsAuthHeader('tok');
    assert.ok(result.authHeader.startsWith('SSWS '), 'must use SSWS not Bearer');
  });
});

// ===========================================================================
// 7. auth — OAuth client_credentials token acquisition
// ===========================================================================

describe('auth — getTokenClientCredentials', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    auth.clearTokenCache();
  });

  const TOKEN_ENDPOINT = `${TEST_ORG_URL}/oauth2/default/v1/token`;

  it('returns error when tokenEndpoint is missing', async () => {
    const result = await auth.getTokenClientCredentials('', 'cid', 'sec', ['okta.users.read']);
    assert.equal(result.ok, false);
    assert.match(result.error, /tokenEndpoint/i);
  });

  it('returns error when clientId is missing', async () => {
    const result = await auth.getTokenClientCredentials(TOKEN_ENDPOINT, '', 'sec', ['okta.users.read']);
    assert.equal(result.ok, false);
    assert.match(result.error, /clientId/i);
  });

  it('returns error when clientSecret is missing', async () => {
    const result = await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', '', ['okta.users.read']);
    assert.equal(result.ok, false);
    assert.match(result.error, /clientSecret/i);
  });

  it('returns error when scopes array is empty', async () => {
    const result = await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', []);
    assert.equal(result.ok, false);
    assert.match(result.error, /scopes/i);
  });

  it('acquires bearer token successfully', async () => {
    mockFetch(200, { access_token: 'bearer-tok-123', expires_in: 3600, token_type: 'Bearer' });
    const result = await auth.getTokenClientCredentials(
      TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read'],
    );
    assert.equal(result.ok, true);
    assert.equal(result.token, 'bearer-tok-123');
    assert.equal(result.expiresIn, 3600);
  });

  it('POSTs to the tokenEndpoint with grant_type=client_credentials', async () => {
    const fn = mockFetch(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });
    await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    assert.equal(fn.mock.callCount(), 1);
    const [url, opts] = fn.mock.calls[0].arguments;
    assert.equal(url, TOKEN_ENDPOINT);
    assert.equal(opts.method, 'POST');
    assert.match(opts.body, /grant_type=client_credentials/);
  });

  it('uses Basic auth header (Base64 clientId:clientSecret)', async () => {
    const fn = mockFetch(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });
    await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    const opts = fn.mock.calls[0].arguments[1];
    const expected = Buffer.from('cid:sec').toString('base64');
    assert.match(opts.headers.Authorization, new RegExp(`Basic ${expected}`));
  });

  it('handles 401 auth failure → {ok:false, status:401}', async () => {
    mockFetch(401, { error: 'invalid_client', error_description: 'Bad client credentials' });
    const result = await auth.getTokenClientCredentials(
      TOKEN_ENDPOINT, 'cid', 'wrong', ['okta.users.read'],
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.match(result.error, /Bad client credentials|invalid_client/i);
  });

  it('handles network error → {ok:false, error}', async () => {
    mockFetchError('ECONNREFUSED');
    const result = await auth.getTokenClientCredentials(
      TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read'],
    );
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('caches token on second call (only one fetch)', async () => {
    const fn = mockFetch(200, { access_token: 'cached-tok', expires_in: 3600, token_type: 'Bearer' });
    await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    const r2 = await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    assert.equal(r2.ok, true);
    assert.equal(fn.mock.callCount(), 1, 'should fetch only once — cache hit on second call');
  });

  it('clearTokenCache() forces a re-fetch', async () => {
    const fn = mockFetch(200, { access_token: 'tok', expires_in: 3600, token_type: 'Bearer' });
    await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    auth.clearTokenCache();
    await auth.getTokenClientCredentials(TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read']);
    assert.equal(fn.mock.callCount(), 2, 'should fetch twice after cache clear');
  });

  it('defaults expiresIn to 3600 when missing from response', async () => {
    mockFetch(200, { access_token: 'tok', token_type: 'Bearer' });
    const result = await auth.getTokenClientCredentials(
      TOKEN_ENDPOINT, 'cid', 'sec', ['okta.users.read'],
    );
    assert.equal(result.ok, true);
    assert.equal(result.expiresIn, 3600);
  });
});

// ===========================================================================
// 8. auth — Authorization header is "SSWS {token}" vs "Bearer {token}"
// ===========================================================================

describe('auth — Authorization header format in HTTP requests', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    auth.clearTokenCache();
  });

  it('SSWS client sends Authorization: SSWS {token}', async () => {
    const fn = mockFetch(200, [{ id: 'u1', profile: { login: 'alice@corp.com' } }]);
    await users.listUsers(mockSswsClient('ssws-test-tok'));
    assert.equal(fn.mock.callCount(), 1);
    const authHeader = fn.mock.calls[0].arguments[1].headers.Authorization;
    assert.match(authHeader, /^SSWS /);
    assert.match(authHeader, /ssws-test-tok/);
  });

  it('OAuth client sends Authorization: Bearer {token}', async () => {
    const fn = mockFetch(200, [{ id: 'u1', profile: { login: 'bob@corp.com' } }]);
    await users.listUsers(mockOAuthClient('oauth-bearer-tok'));
    assert.equal(fn.mock.callCount(), 1);
    const authHeader = fn.mock.calls[0].arguments[1].headers.Authorization;
    assert.match(authHeader, /^Bearer /);
    assert.match(authHeader, /oauth-bearer-tok/);
  });
});

// ===========================================================================
// 9. utils — HTTP 429 rate-limit handling
// ===========================================================================

describe('utils — HTTP 429 rate-limit handling', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('retries after 429 and succeeds on next attempt', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 1;
    mockFetchSequence([
      {
        status: 429,
        body: { errorCode: 'E0000047', errorSummary: 'API call rate limit exceeded' },
        headers: { 'x-rate-limit-reset': String(resetEpoch), 'x-rate-limit-remaining': '0' },
      },
      { status: 200, body: [{ id: 'u1' }], headers: { 'content-type': 'application/json' } },
    ]);
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, true, 'must succeed after one retry on 429');
  });

  it('gives up gracefully after max retries — returns {ok:false, status:429}', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 1;
    const always429 = {
      status: 429,
      body: { errorCode: 'E0000047', errorSummary: 'Rate limited' },
      headers: { 'x-rate-limit-reset': String(resetEpoch), 'x-rate-limit-remaining': '0' },
    };
    // 4 × 429 exhausts MAX_RETRIES = 3 (initial + 3 retries = 4 total calls)
    mockFetchSequence([always429, always429, always429, always429]);
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, false, 'must return {ok:false} after exhausting retries — must NOT throw');
    assert.equal(result.status, 429);
  });

  it('reads X-Rate-Limit-Reset header on 429', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 1;
    const fn = mockFetchSequence([
      {
        status: 429,
        body: { errorCode: 'E0000047', errorSummary: 'Rate limited' },
        headers: { 'x-rate-limit-reset': String(resetEpoch), 'x-rate-limit-remaining': '0' },
      },
      { status: 200, body: [], headers: { 'content-type': 'application/json' } },
    ]);
    await users.listUsers(mockSswsClient());
    // Two fetches means the 429 was encountered and a retry occurred
    assert.ok(fn.mock.callCount() >= 2, 'implementation must retry on 429');
  });

  it('does NOT retry 500 errors', async () => {
    const fn = mockFetch(500, { errorCode: 'E0000009', errorSummary: 'Internal Server Error' });
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.equal(fn.mock.callCount(), 1, '500 must not be retried');
  });

  it('does NOT retry 404 errors', async () => {
    const fn = mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await users.getUser(mockSswsClient(), 'ghost');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(fn.mock.callCount(), 1, '404 must not be retried');
  });
});

// ===========================================================================
// 10. users — listUsers
// ===========================================================================

describe('users — listUsers', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await users.listUsers(null);
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('happy path — returns user array', async () => {
    mockFetch(200, [{ id: 'u1', profile: { login: 'alice@corp.com' } }]);
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data[0].id, 'u1');
  });

  it('edge case — empty result set', async () => {
    mockFetch(200, []);
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 403 forbidden → {ok:false, status:403}', async () => {
    mockFetch(403, { errorCode: 'E0000006', errorSummary: 'You do not have permission' });
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it('negative — auth failure (getAuthHeader returns null) → {ok:false}', async () => {
    mockFetch(200, []);
    const result = await users.listUsers(failingAuthClient());
    assert.equal(result.ok, false);
    assert.match(result.error, /auth|header/i);
  });

  it('negative — network error → {ok:false, error}', async () => {
    mockFetchError('socket hang up');
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, false);
    assert.match(result.error, /Network error/i);
  });

  it('applies search parameter in query string', async () => {
    const fn = mockFetch(200, []);
    await users.listUsers(mockSswsClient(), { search: 'profile.login eq "alice@corp.com"' });
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /search/);
  });

  it('applies limit parameter', async () => {
    const fn = mockFetch(200, []);
    await users.listUsers(mockSswsClient(), { limit: 10 });
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /limit=10/);
  });

  it('pagination — returns nextLink when Link rel="next" header present', async () => {
    const nextUrl = `${TEST_ORG_URL}/api/v1/users?after=page2cursor`;
    mockFetch(200, [{ id: 'u1' }], `<${nextUrl}>; rel="next"`,
      { 'content-type': 'application/json' });
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, true);
    assert.equal(result.nextLink, nextUrl);
  });

  it('pagination — uses options.nextLink as the full URL (cursor)', async () => {
    const nextUrl = `${TEST_ORG_URL}/api/v1/users?after=page2cursor`;
    const fn = mockFetch(200, [{ id: 'u2' }]);
    await users.listUsers(mockSswsClient(), { nextLink: nextUrl });
    const url = fn.mock.calls[0].arguments[0];
    assert.equal(url, nextUrl);
  });

  it('pagination — last page has no rel="next" → nextLink absent', async () => {
    mockFetch(200, [{ id: 'u5' }], `<${TEST_ORG_URL}/api/v1/users>; rel="self"`,
      { 'content-type': 'application/json' });
    const result = await users.listUsers(mockSswsClient());
    assert.equal(result.ok, true);
    assert.ok(!result.nextLink, 'nextLink must be falsy on last page');
  });

  it('multi-page traversal accumulates records across three pages', async () => {
    const page2Url = `${TEST_ORG_URL}/api/v1/users?after=p2`;
    const page3Url = `${TEST_ORG_URL}/api/v1/users?after=p3`;
    mockFetchSequence([
      {
        status: 200,
        body: [{ id: 'u1' }],
        headers: { link: `<${page2Url}>; rel="next"`, 'content-type': 'application/json' },
      },
      {
        status: 200,
        body: [{ id: 'u2' }],
        headers: { link: `<${page3Url}>; rel="next"`, 'content-type': 'application/json' },
      },
      {
        status: 200,
        body: [{ id: 'u3' }],
        headers: { 'content-type': 'application/json' },
      },
    ]);
    const allUsers = [];
    let result = await users.listUsers(mockSswsClient());
    if (result.ok) allUsers.push(...(result.data || []));
    while (result.ok && result.nextLink) {
      result = await users.listUsers(mockSswsClient(), { nextLink: result.nextLink });
      if (result.ok) allUsers.push(...(result.data || []));
    }
    assert.equal(allUsers.length, 3, 'must accumulate records across all 3 pages');
  });

  it('edge case — malformed JSON with ok:true response → data is null, no throw', async () => {
    // oktaRequest catches json() parse errors and sets data = null.
    // With a 200 and content-type application/json, a parse failure yields
    // {ok:true, data:null} — the function does NOT re-throw or return {ok:false}.
    // This tests the "never throws" contract; data being null is the implementation's choice.
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (n) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
      json: async () => { throw new SyntaxError('Unexpected token'); },
      text: async () => '{{bad json',
    }));
    let result;
    let threw = false;
    try {
      result = await users.listUsers(mockSswsClient());
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'must never throw — must return a result object');
    assert.equal(typeof result.ok, 'boolean', 'result must have a boolean ok field');
  });
});

// ===========================================================================
// 11. users — getUser
// ===========================================================================

describe('users — getUser', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await users.getUser(null, 'u1');
    assert.equal(result.ok, false);
  });

  it('returns error when userId is missing', async () => {
    const result = await users.getUser(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /userId/i);
  });

  it('returns error when userId is not a string', async () => {
    const result = await users.getUser(mockSswsClient(), 42);
    assert.equal(result.ok, false);
    assert.match(result.error, /userId/i);
  });

  it('happy path — retrieves user by ID', async () => {
    mockFetch(200, { id: 'u1', profile: { login: 'alice@corp.com', firstName: 'Alice' } });
    const result = await users.getUser(mockSswsClient(), 'u1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'u1');
  });

  it('negative — 404 not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await users.getUser(mockSswsClient(), 'nonexistent');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  it('edge case — user with sparse profile (only login, no optional fields)', async () => {
    mockFetch(200, { id: 'u2', profile: { login: 'sparse@corp.com' } });
    const result = await users.getUser(mockSswsClient(), 'u2');
    assert.equal(result.ok, true);
    assert.equal(result.data.profile.login, 'sparse@corp.com');
    // Optional fields absent must not throw
    assert.equal(result.data.profile.firstName, undefined);
  });

  it('encodes userId (login email) in the URL', async () => {
    const fn = mockFetch(200, { id: 'u3' });
    await users.getUser(mockSswsClient(), 'user@corp.com');
    const url = fn.mock.calls[0].arguments[0];
    // @ should be encoded as %40
    assert.match(url, /user(%40|@)corp\.com/);
  });
});

// ===========================================================================
// 12. users — listUserGroups
// ===========================================================================

describe('users — listUserGroups', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await users.listUserGroups(null, 'u1');
    assert.equal(result.ok, false);
  });

  it('returns error when userId is missing', async () => {
    const result = await users.listUserGroups(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /userId/i);
  });

  it('happy path — returns groups for user', async () => {
    mockFetch(200, [{ id: 'g1', profile: { name: 'Engineering' } }]);
    const result = await users.listUserGroups(mockSswsClient(), 'u1');
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
  });

  it('edge case — user with no groups (empty array)', async () => {
    mockFetch(200, []);
    const result = await users.listUserGroups(mockSswsClient(), 'u1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });
});

// ===========================================================================
// 13. groups — listGroups
// ===========================================================================

describe('groups — listGroups', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await groups.listGroups(null);
    assert.equal(result.ok, false);
  });

  it('happy path — returns group array', async () => {
    mockFetch(200, [{ id: 'g1', profile: { name: 'Engineering' } }]);
    const result = await groups.listGroups(mockSswsClient());
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data[0].id, 'g1');
  });

  it('edge case — empty result set', async () => {
    mockFetch(200, []);
    const result = await groups.listGroups(mockSswsClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 401 unauthorized', async () => {
    mockFetch(401, { errorCode: 'E0000011', errorSummary: 'Invalid token' });
    const result = await groups.listGroups(mockSswsClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
  });

  it('pagination — returns nextLink when Link rel="next" present', async () => {
    const nextUrl = `${TEST_ORG_URL}/api/v1/groups?after=g-cursor`;
    mockFetch(200, [{ id: 'g1' }], `<${nextUrl}>; rel="next"`,
      { 'content-type': 'application/json' });
    const result = await groups.listGroups(mockSswsClient());
    assert.equal(result.ok, true);
    assert.equal(result.nextLink, nextUrl);
  });

  it('edge case — group with missing optional description field', async () => {
    mockFetch(200, [{ id: 'g2', profile: { name: 'Sparse Group' } }]);
    const result = await groups.listGroups(mockSswsClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].profile.description, undefined);
  });

  it('applies q (fuzzy name search) parameter', async () => {
    const fn = mockFetch(200, []);
    await groups.listGroups(mockSswsClient(), { q: 'Eng' });
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /q=Eng/);
  });
});

// ===========================================================================
// 14. groups — getGroup
// ===========================================================================

describe('groups — getGroup', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await groups.getGroup(null, 'g1');
    assert.equal(result.ok, false);
  });

  it('returns error when groupId is missing', async () => {
    const result = await groups.getGroup(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /groupId/i);
  });

  it('happy path — retrieves group by ID', async () => {
    mockFetch(200, { id: 'g1', type: 'OKTA_GROUP', profile: { name: 'Security' } });
    const result = await groups.getGroup(mockSswsClient(), 'g1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'g1');
  });

  it('negative — 404 not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await groups.getGroup(mockSswsClient(), 'ghost');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
});

// ===========================================================================
// 15. groups — listGroupMembers
// ===========================================================================

describe('groups — listGroupMembers', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await groups.listGroupMembers(null, 'g1');
    assert.equal(result.ok, false);
  });

  it('returns error when groupId is missing', async () => {
    const result = await groups.listGroupMembers(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /groupId/i);
  });

  it('happy path — returns member array', async () => {
    mockFetch(200, [{ id: 'u1', profile: { login: 'alice@corp.com' } }]);
    const result = await groups.listGroupMembers(mockSswsClient(), 'g1');
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
  });

  it('edge case — group with no members (empty array)', async () => {
    mockFetch(200, []);
    const result = await groups.listGroupMembers(mockSswsClient(), 'g1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 404 group not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await groups.listGroupMembers(mockSswsClient(), 'ghost-group');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  it('includes groupId in the request URL', async () => {
    const fn = mockFetch(200, []);
    await groups.listGroupMembers(mockSswsClient(), 'g-abc123');
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /groups\/g-abc123\/users/);
  });
});

// ===========================================================================
// 16. apps — listApps
// ===========================================================================

describe('apps — listApps', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await apps.listApps(null);
    assert.equal(result.ok, false);
  });

  it('happy path — returns app array', async () => {
    mockFetch(200, [{ id: 'app1', label: 'Salesforce', status: 'ACTIVE' }]);
    const result = await apps.listApps(mockSswsClient());
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data[0].id, 'app1');
  });

  it('edge case — empty app list', async () => {
    mockFetch(200, []);
    const result = await apps.listApps(mockSswsClient());
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 403 forbidden', async () => {
    mockFetch(403, { errorCode: 'E0000006', errorSummary: 'Forbidden' });
    const result = await apps.listApps(mockSswsClient());
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it('applies filter parameter in URL', async () => {
    const fn = mockFetch(200, []);
    await apps.listApps(mockSswsClient(), { filter: 'status eq "ACTIVE"' });
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /filter/);
  });

  it('edge case — app with no signOnMode (optional field absent)', async () => {
    mockFetch(200, [{ id: 'app2', label: 'Sparse App', status: 'ACTIVE' }]);
    const result = await apps.listApps(mockSswsClient());
    assert.equal(result.ok, true);
    assert.equal(result.data[0].signOnMode, undefined);
  });
});

// ===========================================================================
// 17. apps — getApp
// ===========================================================================

describe('apps — getApp', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await apps.getApp(null, 'app1');
    assert.equal(result.ok, false);
  });

  it('returns error when appId is missing', async () => {
    const result = await apps.getApp(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /appId/i);
  });

  it('happy path — retrieves app by ID', async () => {
    mockFetch(200, { id: 'app1', label: 'Salesforce', status: 'ACTIVE', signOnMode: 'SAML_2_0' });
    const result = await apps.getApp(mockSswsClient(), 'app1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'app1');
  });

  it('negative — 404 not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await apps.getApp(mockSswsClient(), 'ghost-app');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  it('edge case — app with no settings object (minimal record)', async () => {
    mockFetch(200, { id: 'app3', label: 'Minimal App', status: 'INACTIVE' });
    const result = await apps.getApp(mockSswsClient(), 'app3');
    assert.equal(result.ok, true);
    assert.equal(result.data.settings, undefined);
  });
});

// ===========================================================================
// 18. apps — getAppSamlSettings (edge case: wrong signOnMode)
// ===========================================================================

describe('apps — getAppSamlSettings', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await apps.getAppSamlSettings(null, 'app1');
    assert.equal(result.ok, false);
  });

  it('happy path — returns SAML settings for SAML_2_0 app', async () => {
    mockFetch(200, {
      id: 'app1',
      label: 'MySamlApp',
      status: 'ACTIVE',
      signOnMode: 'SAML_2_0',
      settings: { signOn: { ssoAcsUrl: 'https://sp.example.com/acs', audience: 'urn:sp:example' } },
      credentials: { signing: { kid: 'abc123' } },
    });
    const result = await apps.getAppSamlSettings(mockSswsClient(), 'app1');
    assert.equal(result.ok, true);
    assert.equal(result.data.signOnMode, 'SAML_2_0');
    assert.ok(result.data.settings);
  });

  it('negative — returns {ok:false} when app is OIDC not SAML', async () => {
    mockFetch(200, { id: 'app2', label: 'MyOidcApp', status: 'ACTIVE', signOnMode: 'OPENID_CONNECT' });
    const result = await apps.getAppSamlSettings(mockSswsClient(), 'app2');
    assert.equal(result.ok, false);
    assert.match(result.error, /SAML_2_0|signOnMode/i);
  });

  it('edge case — 404 from getApp propagates', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await apps.getAppSamlSettings(mockSswsClient(), 'ghost');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
});

// ===========================================================================
// 19. apps — listAppUsers
// ===========================================================================

describe('apps — listAppUsers', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await apps.listAppUsers(null, 'app1');
    assert.equal(result.ok, false);
  });

  it('returns error when appId is missing', async () => {
    const result = await apps.listAppUsers(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /appId/i);
  });

  it('happy path — returns assigned users', async () => {
    mockFetch(200, [{ id: 'au1', scope: 'USER', status: 'ACTIVE' }]);
    const result = await apps.listAppUsers(mockSswsClient(), 'app1');
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
  });

  it('edge case — app with no assigned users (empty array)', async () => {
    mockFetch(200, []);
    const result = await apps.listAppUsers(mockSswsClient(), 'app1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 403 forbidden', async () => {
    mockFetch(403, { errorCode: 'E0000006', errorSummary: 'Forbidden' });
    const result = await apps.listAppUsers(mockSswsClient(), 'app1');
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });
});

// ===========================================================================
// 20. policies — listPolicies
// ===========================================================================

describe('policies — listPolicies', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await policies.listPolicies(null, 'OKTA_SIGN_ON');
    assert.equal(result.ok, false);
  });

  it('returns error when policyType is missing', async () => {
    const result = await policies.listPolicies(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /policyType/i);
  });

  it('returns error when policyType is null', async () => {
    const result = await policies.listPolicies(mockSswsClient(), null);
    assert.equal(result.ok, false);
    assert.match(result.error, /policyType/i);
  });

  it('happy path — returns policy array for OKTA_SIGN_ON', async () => {
    mockFetch(200, [{ id: 'pol1', name: 'Default Policy', type: 'OKTA_SIGN_ON', status: 'ACTIVE' }]);
    const result = await policies.listPolicies(mockSswsClient(), 'OKTA_SIGN_ON');
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.equal(result.data[0].id, 'pol1');
  });

  it('edge case — empty policy list', async () => {
    mockFetch(200, []);
    const result = await policies.listPolicies(mockSswsClient(), 'PASSWORD');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 403 forbidden', async () => {
    mockFetch(403, { errorCode: 'E0000006', errorSummary: 'Forbidden' });
    const result = await policies.listPolicies(mockSswsClient(), 'MFA_ENROLL');
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
  });

  it('puts policyType in the query string', async () => {
    const fn = mockFetch(200, []);
    await policies.listPolicies(mockSswsClient(), 'MFA_ENROLL');
    const url = fn.mock.calls[0].arguments[0];
    assert.match(url, /type=MFA_ENROLL/);
  });

  it('edge case — policy with no conditions field (optional field absent)', async () => {
    mockFetch(200, [{ id: 'pol2', name: 'Sparse', type: 'PASSWORD', status: 'INACTIVE' }]);
    const result = await policies.listPolicies(mockSswsClient(), 'PASSWORD');
    assert.equal(result.ok, true);
    assert.equal(result.data[0].conditions, undefined);
  });
});

// ===========================================================================
// 21. policies — getPolicy
// ===========================================================================

describe('policies — getPolicy', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await policies.getPolicy(null, 'pol1');
    assert.equal(result.ok, false);
  });

  it('returns error when policyId is missing', async () => {
    const result = await policies.getPolicy(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /policyId/i);
  });

  it('happy path — retrieves policy by ID', async () => {
    mockFetch(200, { id: 'pol1', name: 'Default', type: 'OKTA_SIGN_ON', status: 'ACTIVE' });
    const result = await policies.getPolicy(mockSswsClient(), 'pol1');
    assert.equal(result.ok, true);
    assert.equal(result.data.id, 'pol1');
  });

  it('negative — 404 not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await policies.getPolicy(mockSswsClient(), 'ghost-pol');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });

  it('edge case — policy with empty rules array', async () => {
    mockFetch(200, { id: 'pol3', name: 'Ruleless', type: 'PASSWORD', status: 'ACTIVE', rules: [] });
    const result = await policies.getPolicy(mockSswsClient(), 'pol3');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data.rules, []);
  });
});

// ===========================================================================
// 22. policies — getPolicyRules
// ===========================================================================

describe('policies — getPolicyRules', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('returns error when client is null', async () => {
    const result = await policies.getPolicyRules(null, 'pol1');
    assert.equal(result.ok, false);
  });

  it('returns error when policyId is missing', async () => {
    const result = await policies.getPolicyRules(mockSswsClient(), '');
    assert.equal(result.ok, false);
    assert.match(result.error, /policyId/i);
  });

  it('happy path — returns rules array', async () => {
    mockFetch(200, [{ id: 'rule1', name: 'Default Rule', priority: 1, status: 'ACTIVE' }]);
    const result = await policies.getPolicyRules(mockSswsClient(), 'pol1');
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data));
  });

  it('edge case — policy with no rules (empty array)', async () => {
    mockFetch(200, []);
    const result = await policies.getPolicyRules(mockSswsClient(), 'pol1');
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, []);
  });

  it('negative — 404 when policy not found', async () => {
    mockFetch(404, { errorCode: 'E0000007', errorSummary: 'Not found' });
    const result = await policies.getPolicyRules(mockSswsClient(), 'ghost');
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
  });
});

// ===========================================================================
// 23. index — module exports and constants
// ===========================================================================

describe('index — module exports', () => {
  it('exports createClient function', () => {
    assert.equal(typeof okta.createClient, 'function');
  });

  it('exports auth module with getSswsAuthHeader', () => {
    assert.ok(okta.auth, 'auth module must be exported');
    assert.equal(typeof okta.auth.getSswsAuthHeader, 'function');
    assert.equal(typeof okta.auth.getTokenClientCredentials, 'function');
    assert.equal(typeof okta.auth.getTokenPrivateKeyJwt, 'function');
  });

  it('exports users module with listUsers and getUser', () => {
    assert.ok(okta.users, 'users module must be exported');
    assert.equal(typeof okta.users.listUsers, 'function');
    assert.equal(typeof okta.users.getUser, 'function');
  });

  it('exports groups module with listGroups and getGroup', () => {
    assert.ok(okta.groups, 'groups module must be exported');
    assert.equal(typeof okta.groups.listGroups, 'function');
    assert.equal(typeof okta.groups.getGroup, 'function');
  });

  it('exports apps module with listApps and getApp', () => {
    assert.ok(okta.apps, 'apps module must be exported');
    assert.equal(typeof okta.apps.listApps, 'function');
    assert.equal(typeof okta.apps.getApp, 'function');
  });

  it('exports policies module with listPolicies and getPolicy', () => {
    assert.ok(okta.policies, 'policies module must be exported');
    assert.equal(typeof okta.policies.listPolicies, 'function');
    assert.equal(typeof okta.policies.getPolicy, 'function');
  });

  it('exports GROUP_TYPE frozen constant', () => {
    assert.ok(Object.isFrozen(okta.GROUP_TYPE));
    assert.equal(okta.GROUP_TYPE.OKTA_GROUP, 'OKTA_GROUP');
    assert.equal(okta.GROUP_TYPE.APP_GROUP, 'APP_GROUP');
  });

  it('exports USER_STATUS frozen constant', () => {
    assert.ok(Object.isFrozen(okta.USER_STATUS));
    assert.equal(okta.USER_STATUS.ACTIVE, 'ACTIVE');
    assert.equal(okta.USER_STATUS.DEPROVISIONED, 'DEPROVISIONED');
  });

  it('exports SIGN_ON_MODE frozen constant', () => {
    assert.ok(Object.isFrozen(okta.SIGN_ON_MODE));
    assert.equal(okta.SIGN_ON_MODE.SAML_2_0, 'SAML_2_0');
    assert.equal(okta.SIGN_ON_MODE.OPENID_CONNECT, 'OPENID_CONNECT');
  });

  it('exports POLICY_TYPE frozen constant', () => {
    assert.ok(Object.isFrozen(okta.POLICY_TYPE));
    assert.equal(okta.POLICY_TYPE.OKTA_SIGN_ON, 'OKTA_SIGN_ON');
    assert.equal(okta.POLICY_TYPE.MFA_ENROLL, 'MFA_ENROLL');
  });

  it('exports FACTOR_TYPE frozen constant', () => {
    assert.ok(Object.isFrozen(okta.FACTOR_TYPE));
    assert.equal(okta.FACTOR_TYPE.PUSH, 'push');
    assert.equal(okta.FACTOR_TYPE.WEBAUTHN, 'webauthn');
  });
});

// ===========================================================================
// 24. Contract enforcement — NO function may throw; every path → {ok,...}
// ===========================================================================

describe('contract — no function throws (every path resolves to {ok,...})', () => {
  before(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  /**
   * Runs fn() and asserts it resolves to an {ok} object — never throws.
   * A thrown error is a P0 contract violation.
   */
  async function assertNoThrow(label, fn) {
    let result;
    try {
      result = await fn();
    } catch (err) {
      assert.fail(
        `CONTRACT VIOLATION: ${label} THREW instead of returning {ok:false}: ${err.message}`,
      );
    }
    assert.ok(
      result !== undefined && result !== null && typeof result.ok === 'boolean',
      `${label} must return an object with boolean "ok" field; got: ${JSON.stringify(result)}`,
    );
  }

  it('users.listUsers(null) does not throw', async () => {
    await assertNoThrow('users.listUsers(null)', () => users.listUsers(null));
  });

  it('users.getUser(null, "") does not throw', async () => {
    await assertNoThrow('users.getUser(null,"")', () => users.getUser(null, ''));
  });

  it('users.listUserGroups(null, "") does not throw', async () => {
    await assertNoThrow('users.listUserGroups(null,"")', () => users.listUserGroups(null, ''));
  });

  it('groups.listGroups(null) does not throw', async () => {
    await assertNoThrow('groups.listGroups(null)', () => groups.listGroups(null));
  });

  it('groups.getGroup(null, "") does not throw', async () => {
    await assertNoThrow('groups.getGroup(null,"")', () => groups.getGroup(null, ''));
  });

  it('groups.listGroupMembers(null, "") does not throw', async () => {
    await assertNoThrow('groups.listGroupMembers(null,"")', () => groups.listGroupMembers(null, ''));
  });

  it('apps.listApps(null) does not throw', async () => {
    await assertNoThrow('apps.listApps(null)', () => apps.listApps(null));
  });

  it('apps.getApp(null, "") does not throw', async () => {
    await assertNoThrow('apps.getApp(null,"")', () => apps.getApp(null, ''));
  });

  it('apps.listAppUsers(null, "") does not throw', async () => {
    await assertNoThrow('apps.listAppUsers(null,"")', () => apps.listAppUsers(null, ''));
  });

  it('apps.getAppSamlSettings(null, "") does not throw', async () => {
    await assertNoThrow('apps.getAppSamlSettings(null,"")', () => apps.getAppSamlSettings(null, ''));
  });

  it('policies.listPolicies(null, "") does not throw', async () => {
    await assertNoThrow('policies.listPolicies(null,"")', () => policies.listPolicies(null, ''));
  });

  it('policies.getPolicy(null, "") does not throw', async () => {
    await assertNoThrow('policies.getPolicy(null,"")', () => policies.getPolicy(null, ''));
  });

  it('policies.getPolicyRules(null, "") does not throw', async () => {
    await assertNoThrow('policies.getPolicyRules(null,"")', () => policies.getPolicyRules(null, ''));
  });

  it('auth.getTokenClientCredentials with network error does not throw', async () => {
    mockFetchError('forced network error');
    await assertNoThrow('auth.getTokenClientCredentials(network error)', () =>
      auth.getTokenClientCredentials(
        `${TEST_ORG_URL}/oauth2/default/v1/token`,
        'cid', 'sec', ['okta.users.read'],
      ),
    );
  });

  it('users.listUsers with network error does not throw', async () => {
    mockFetchError('forced network error');
    await assertNoThrow('users.listUsers(network error)', () =>
      users.listUsers(mockSswsClient()),
    );
  });

  it('users.listUsers after exhausted 429 retries does not throw', async () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 1;
    const r429 = {
      status: 429,
      body: { errorCode: 'E0000047' },
      headers: { 'x-rate-limit-reset': String(resetEpoch), 'x-rate-limit-remaining': '0' },
    };
    mockFetchSequence([r429, r429, r429, r429]);
    await assertNoThrow('users.listUsers(429 exhausted)', () =>
      users.listUsers(mockSswsClient()),
    );
  });

  it('groups.listGroups with malformed JSON does not throw', async () => {
    globalThis.fetch = mock.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: (n) => n.toLowerCase() === 'content-type' ? 'application/json' : null },
      json: async () => { throw new SyntaxError('Unexpected token'); },
      text: async () => '{{bad',
    }));
    let threw = false;
    let result;
    try {
      result = await groups.listGroups(mockSswsClient());
    } catch {
      threw = true;
    }
    assert.ok(!threw, 'must never throw regardless of JSON parse failure');
    assert.equal(typeof result.ok, 'boolean');
  });

  it('auth.getSswsAuthHeader with invalid input does not throw', () => {
    const result = auth.getSswsAuthHeader(null);
    assert.equal(typeof result.ok, 'boolean',
      'getSswsAuthHeader(null) must return {ok,...} not throw');
  });
});
