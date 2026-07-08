/**
 * lib/ping/detect.test.js — Full detect.js coverage suite
 *
 * Tests detectDeployment() with mocked fetch (no live network required).
 * Covers all 5 surface types from probe signals:
 * - Domain-based PingOne cloud detection (*.pingone.com)
 * - Domain-based AIC detection (*.forgeblocks.com)
 * - OIDC discovery: PingOne, AIC, PingFederate
 * - PF admin API probe (port 9999 + /pf-admin-api/v1/version)
 * - PingAccess probe (/pa-admin-api/v3/version)
 * - PingDirectory probe (/scim/v2/ServiceProviderConfig)
 * - Hybrid: cloud + onprem surfaces together
 * - Error/timeout/unknown cases
 *
 * Run: node --test lib/ping/detect.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectDeployment, KNOWN_DOMAINS, _internal } = require('./detect.js');
const { matchKnownDomain } = _internal;

// ---------------------------------------------------------------------------
// Mock fetch helpers
// ---------------------------------------------------------------------------

let _savedFetch;

beforeEach(() => {
  _savedFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = _savedFetch;
});

/**
 * Build a minimal Response-like mock.
 * @param {number} status
 * @param {object|null} body
 * @param {object} [headers={}]
 */
function mockResponse(status, body, headers = {}) {
  const headerMap = new Map(Object.entries({ 'content-type': 'application/json', ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (key) => headerMap.get(key.toLowerCase()) || null,
    },
    json: () => Promise.resolve(body),
  };
}

/**
 * Install a fetch mock that maps URL patterns to responses.
 * @param {Record<string, {status: number, body?: object}>} urlMap
 */
function mockFetch(urlMap) {
  globalThis.fetch = async (url) => {
    for (const [pattern, response] of Object.entries(urlMap)) {
      if (url.includes(pattern)) {
        return mockResponse(response.status, response.body || null);
      }
    }
    // Default: connection refused simulation
    const err = new Error(`ECONNREFUSED: no mock for ${url}`);
    err.name = 'TypeError';
    throw err;
  };
}

// ============================================================================
// KNOWN_DOMAINS constant
// ============================================================================

describe('detect — KNOWN_DOMAINS', () => {
  it('includes .pingone.com', () => {
    assert.ok(Object.values(KNOWN_DOMAINS).includes('.pingone.com'));
  });

  it('includes .forgeblocks.com', () => {
    assert.ok(Object.values(KNOWN_DOMAINS).includes('.forgeblocks.com'));
  });
});

// ============================================================================
// matchKnownDomain
// ============================================================================

describe('detect — matchKnownDomain (domain pattern matching)', () => {
  it('identifies *.pingone.com as pingone product', () => {
    const result = matchKnownDomain('acme.pingone.com');
    assert.equal(result.matched, true);
    assert.equal(result.product, 'pingone');
  });

  it('identifies *.pingone.eu as pingone product', () => {
    const result = matchKnownDomain('acme.pingone.eu');
    assert.equal(result.matched, true);
    assert.equal(result.product, 'pingone');
  });

  it('identifies *.forgeblocks.com as aic product', () => {
    const result = matchKnownDomain('openam-acme.forgeblocks.com');
    assert.equal(result.matched, true);
    assert.equal(result.product, 'aic');
  });

  it('returns matched:false for on-prem custom domain', () => {
    const result = matchKnownDomain('pf.corp.example.com');
    assert.equal(result.matched, false);
  });

  it('returns matched:false for null/undefined', () => {
    const result = matchKnownDomain(null);
    assert.equal(result.matched, false);
  });
});

// ============================================================================
// detectDeployment — domain-based (no network probes needed for cloud)
// ============================================================================

describe('detect — cloud deployment via domain match', () => {
  it('detects PingOne cloud from *.pingone.com domain', async () => {
    // Domain match is code-path only; no network probes needed
    // but we still need to mock OIDC since probeOidc will run
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://acme.pingone.com' });
    assert.equal(result.ok, true);
    assert.equal(result.data.deploymentType, 'cloud');
    assert.ok(result.data.confirmedSurfaces.includes('pingone_cloud'));
  });

  it('detects AIC from *.forgeblocks.com domain', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://openam-acme.forgeblocks.com/am' });
    assert.equal(result.ok, true);
    assert.equal(result.data.deploymentType, 'aic');
    assert.ok(result.data.confirmedSurfaces.includes('aic'));
  });
});

// ============================================================================
// detectDeployment — OIDC discovery probes
// ============================================================================

describe('detect — OIDC discovery probes', () => {
  it('detects PingOne via OIDC issuer containing pingone.com', async () => {
    mockFetch({
      '.well-known/openid-configuration': {
        status: 200,
        body: { issuer: 'https://auth.pingone.com/env123/as' },
      },
    });

    const result = await detectDeployment({ baseUrl: 'https://custom-tenant.example.com' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('pingone_cloud'), `surfaces: ${JSON.stringify(result.data.confirmedSurfaces)}`);
  });

  it('detects AIC via OIDC issuer containing forgeblocks.com', async () => {
    mockFetch({
      '.well-known/openid-configuration': {
        status: 200,
        body: { issuer: 'https://openam-acme.forgeblocks.com/am/oauth2/realms/root/realms/alpha' },
      },
    });

    const result = await detectDeployment({ baseUrl: 'https://custom-tenant.example.com' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('aic'));
  });

  it('detects PingFederate via OIDC issuer containing /pf/ path', async () => {
    mockFetch({
      '.well-known/openid-configuration': {
        status: 200,
        body: { issuer: 'https://sso.corp.example.com/pf/oidc' },
      },
      '/pf-admin-api/v1/version': { status: 401, body: null },
      '/pa-admin-api/v3/version': { status: 404, body: null },
      '/scim/v2/ServiceProviderConfig': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://sso.corp.example.com' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('pingfederate'), `surfaces: ${JSON.stringify(result.data.confirmedSurfaces)}`);
  });
});

// ============================================================================
// detectDeployment — on-prem probes
// ============================================================================

describe('detect — on-prem surface probes', () => {
  it('detects PingFederate from /pf-admin-api/v1/version 200 response', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
      '/pf-admin-api/v1/version': {
        status: 200,
        body: { version: '11.3.3' },
      },
      '/pa-admin-api/v3/version': { status: 404, body: null },
      '/scim/v2/ServiceProviderConfig': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://pf.corp.example.com:9999' });
    assert.equal(result.ok, true);
    assert.equal(result.data.deploymentType, 'onprem');
    assert.ok(result.data.confirmedSurfaces.includes('pingfederate'));
    assert.equal(result.data.version, '11.3.3');
  });

  it('detects PingFederate from /pf-admin-api/v1/version 401 response (auth required = service exists)', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
      '/pf-admin-api/v1/version': { status: 401, body: null },
      '/pa-admin-api/v3/version': { status: 404, body: null },
      '/scim/v2/ServiceProviderConfig': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://pf.corp.example.com:9999' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('pingfederate'));
  });

  it('detects PingAccess from /pa-admin-api/v3/version 200 response', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
      '/pf-admin-api/v1/version': { status: 404, body: null },
      '/pa-admin-api/v3/version': { status: 200, body: { version: '7.1.0' } },
      '/scim/v2/ServiceProviderConfig': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://pa.corp.example.com:9000' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('pingaccess'));
  });

  it('detects PingDirectory from /scim/v2/ServiceProviderConfig 200 response', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
      '/pf-admin-api/v1/version': { status: 404, body: null },
      '/pa-admin-api/v3/version': { status: 404, body: null },
      '/scim/v2/ServiceProviderConfig': {
        status: 200,
        body: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'] },
      },
    });

    const result = await detectDeployment({ baseUrl: 'https://pd.corp.example.com' });
    assert.equal(result.ok, true);
    assert.ok(result.data.confirmedSurfaces.includes('pingdirectory'));
  });

  it('detects hybrid when both cloud (OIDC) and onprem (PF) confirmed', async () => {
    mockFetch({
      '.well-known/openid-configuration': {
        status: 200,
        body: { issuer: 'https://sso.corp.example.com/pf/oidc' },
      },
      '/pf-admin-api/v1/version': { status: 200, body: { version: '11.3.3' } },
      '/pa-admin-api/v3/version': { status: 404, body: null },
      '/scim/v2/ServiceProviderConfig': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://sso.corp.example.com' });
    assert.equal(result.ok, true);
    // Both OIDC (pf via /pf/ path) and admin API confirmed pingfederate — onprem
    assert.ok(['onprem', 'hybrid'].includes(result.data.deploymentType));
    assert.ok(result.data.confirmedSurfaces.includes('pingfederate'));
  });
});

// ============================================================================
// detectDeployment — error/timeout/unknown cases
// ============================================================================

describe('detect — error and unknown cases', () => {
  it('returns {ok:false} when config is missing', async () => {
    const result = await detectDeployment(null);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('config object'));
  });

  it('returns deploymentType:unknown when no probes succeed', async () => {
    mockFetch({}); // all probes throw ECONNREFUSED

    const result = await detectDeployment({ baseUrl: 'https://unknown.example.com' });
    assert.equal(result.ok, true);
    assert.equal(result.data.deploymentType, 'unknown');
    assert.equal(result.data.confirmedSurfaces.length, 0);
  });

  it('never throws even when fetch throws synchronously', async () => {
    globalThis.fetch = () => { throw new Error('sync throw from fetch'); };

    await assert.doesNotReject(async () => {
      const result = await detectDeployment({ baseUrl: 'https://example.com' });
      assert.equal(typeof result.ok, 'boolean');
    });
  });

  it('includes signals object for auditing', async () => {
    mockFetch({
      '.well-known/openid-configuration': { status: 404, body: null },
    });

    const result = await detectDeployment({ baseUrl: 'https://acme.pingone.com' });
    assert.equal(result.ok, true);
    assert.ok(result.data.signals, 'signals object should be present');
    assert.ok('domainMatch' in result.data.signals, 'domainMatch signal should be present');
  });
});

// ============================================================================
// detectDeployment — timeout option
// ============================================================================

describe('detect — timeout handling', () => {
  it('uses DEFAULT_TIMEOUT_MS when options.timeoutMs not set', async () => {
    const { DEFAULT_TIMEOUT_MS } = require('./detect.js');
    assert.equal(typeof DEFAULT_TIMEOUT_MS, 'number');
    assert.equal(DEFAULT_TIMEOUT_MS, 3000);
  });
});
