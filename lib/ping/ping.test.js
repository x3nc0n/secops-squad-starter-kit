/**
 * lib/ping/ping.test.js — createClient + surface routing tests
 *
 * Tests: createClient config validation (throws synchronously on bad config),
 * deployment discriminator (cloud/onprem/hybrid), sub-client shapes,
 * surface module routing (graceful skip when Keymaker modules not yet present).
 *
 * Mirrors lib/okta/okta.test.js patterns.
 * Run: node --test lib/ping/ping.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Module imports — graceful fallback when surface modules aren't landed yet
// ---------------------------------------------------------------------------
let ping;
try {
  ping = require('./index.js');
} catch (e) {
  ping = { createClient: () => { throw new Error('ping index.js not yet implemented'); } };
}

const { createClient, REGION, IDENTITY_AUTHORITY, FEDERATION_DIRECTION, MFA_STRATEGY, NAMEID_STRATEGY, OWNERSHIP_CLASSES } = ping;

// ---------------------------------------------------------------------------
// Minimal valid configs
// ---------------------------------------------------------------------------

function cloudConfig() {
  return {
    deployment: 'cloud',
    cloud: {
      environmentId: 'env-abc123',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      region: 'com',
    },
  };
}

function onpremConfig() {
  return {
    deployment: 'onprem',
    onprem: {
      pingfederate: {
        adminUrl: 'https://pf.corp.example.com:9999',
        username: 'Administrator',
        password: 'secret',
      },
    },
  };
}

function hybridConfig() {
  return {
    deployment: 'hybrid',
    cloud: {
      environmentId: 'env-abc123',
      clientId: 'client-abc',
      clientSecret: 'secret-xyz',
      region: 'com',
    },
    onprem: {
      pingfederate: {
        adminUrl: 'https://pf.corp.example.com:9999',
        username: 'Administrator',
        password: 'secret',
      },
    },
  };
}

// ============================================================================
// createClient — config validation (synchronous throws)
// ============================================================================

describe('createClient — config validation throws', () => {
  it('throws when config is null', () => {
    assert.throws(() => createClient(null), /config object/);
  });

  it('throws when config is not an object', () => {
    assert.throws(() => createClient('bad'), /config object/);
  });

  it('throws when deployment is missing', () => {
    assert.throws(() => createClient({}), /deployment/);
  });

  it('throws when deployment is unknown value', () => {
    assert.throws(() => createClient({ deployment: 'serverless' }), /deployment/);
  });

  it('throws when cloud deployment is missing cloud block', () => {
    assert.throws(() => createClient({ deployment: 'cloud' }), /cloud/i);
  });

  it('throws when cloud block is missing environmentId', () => {
    assert.throws(() => createClient({
      deployment: 'cloud',
      cloud: { clientId: 'x', clientSecret: 'y' },
    }), /environmentId/);
  });

  it('throws when cloud block is missing clientId', () => {
    assert.throws(() => createClient({
      deployment: 'cloud',
      cloud: { environmentId: 'e', clientSecret: 'y' },
    }), /clientId/);
  });

  it('throws when cloud block is missing clientSecret', () => {
    assert.throws(() => createClient({
      deployment: 'cloud',
      cloud: { environmentId: 'e', clientId: 'c' },
    }), /clientSecret/);
  });

  it('throws when cloud.region is invalid', () => {
    assert.throws(() => createClient({
      deployment: 'cloud',
      cloud: { environmentId: 'e', clientId: 'c', clientSecret: 's', region: 'us-east-1' },
    }), /region/);
  });

  it('throws when onprem deployment is missing onprem block', () => {
    assert.throws(() => createClient({ deployment: 'onprem' }), /onprem/i);
  });

  it('throws when onprem block has no configured surfaces', () => {
    assert.throws(() => createClient({ deployment: 'onprem', onprem: {} }), /at least one/);
  });

  it('throws when hybrid is missing both cloud and onprem', () => {
    assert.throws(() => createClient({ deployment: 'hybrid' }), /cloud|onprem/);
  });

  it('throws when PF block is missing adminUrl', () => {
    assert.throws(() => createClient({
      deployment: 'onprem',
      onprem: { pingfederate: { username: 'admin', password: 'pass' } },
    }), /adminUrl/);
  });
});

// ============================================================================
// createClient — cloud deployment
// ============================================================================

describe('createClient — cloud deployment', () => {
  it('returns a client object for valid cloud config', () => {
    const client = createClient(cloudConfig());
    assert.equal(typeof client, 'object');
    assert.ok(client !== null);
  });

  it('client.deployment is "cloud"', () => {
    const client = createClient(cloudConfig());
    assert.equal(client.deployment, 'cloud');
  });

  it('client.cloud is present with baseUrl', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud, 'cloud sub-client should be present');
    assert.ok(client.cloud.baseUrl.includes('pingone.com'), `baseUrl: ${client.cloud.baseUrl}`);
  });

  it('client.cloud.baseUrl uses com region by default', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.baseUrl.includes('.com'), `baseUrl: ${client.cloud.baseUrl}`);
  });

  it('client.cloud.baseUrl reflects au region when specified', () => {
    const cfg = cloudConfig();
    cfg.cloud.region = 'au';
    const client = createClient(cfg);
    assert.ok(client.cloud.baseUrl.includes('.au'), `baseUrl: ${client.cloud.baseUrl}`);
  });

  it('client.cloud.getAuthHeader is an async function', () => {
    const client = createClient(cloudConfig());
    assert.equal(typeof client.cloud.getAuthHeader, 'function');
  });

  it('client.onprem is undefined for cloud-only config', () => {
    const client = createClient(cloudConfig());
    assert.equal(client.onprem, undefined);
  });
});

// ============================================================================
// createClient — onprem deployment
// ============================================================================

describe('createClient — onprem deployment', () => {
  it('returns a client object for valid onprem config', () => {
    const client = createClient(onpremConfig());
    assert.ok(client !== null);
    assert.equal(client.deployment, 'onprem');
  });

  it('client.onprem.pingfederate is present', () => {
    const client = createClient(onpremConfig());
    assert.ok(client.onprem, 'onprem sub-client should be present');
    assert.ok(client.onprem.pingfederate, 'pingfederate sub-client should be present');
  });

  it('pingfederate sub-client has adminUrl', () => {
    const client = createClient(onpremConfig());
    assert.equal(client.onprem.pingfederate.adminUrl, 'https://pf.corp.example.com:9999');
  });

  it('pingfederate sub-client has getAuthHeader function', () => {
    const client = createClient(onpremConfig());
    assert.equal(typeof client.onprem.pingfederate.getAuthHeader, 'function');
  });

  it('pingfederate getAuthHeader returns Basic scheme', () => {
    const client = createClient(onpremConfig());
    const header = client.onprem.pingfederate.getAuthHeader();
    assert.ok(header.startsWith('Basic '), `header: ${header}`);
  });

  it('pingfederate sub-client has xsrfHeader value', () => {
    const client = createClient(onpremConfig());
    assert.equal(client.onprem.pingfederate.xsrfHeader, 'PingFederate');
  });

  it('client.cloud is undefined for onprem-only config', () => {
    const client = createClient(onpremConfig());
    assert.equal(client.cloud, undefined);
  });
});

// ============================================================================
// createClient — hybrid deployment
// ============================================================================

describe('createClient — hybrid deployment', () => {
  it('returns a client with both cloud and onprem sub-clients', () => {
    const client = createClient(hybridConfig());
    assert.equal(client.deployment, 'hybrid');
    assert.ok(client.cloud, 'cloud should be present');
    assert.ok(client.onprem, 'onprem should be present');
  });

  it('aic sub-client is built when aic config is provided', () => {
    const cfg = hybridConfig();
    cfg.aic = { baseUrl: 'https://acme.forgeblocks.com/am', accessToken: 'token123' };
    const client = createClient(cfg);
    assert.ok(client.aic, 'aic sub-client should be present');
    assert.equal(client.aic.baseUrl, 'https://acme.forgeblocks.com/am');
  });

  it('aic getAuthHeader returns Bearer scheme', () => {
    const cfg = hybridConfig();
    cfg.aic = { baseUrl: 'https://acme.forgeblocks.com/am', accessToken: 'mytoken' };
    const client = createClient(cfg);
    assert.equal(client.aic.getAuthHeader(), 'Bearer mytoken');
  });
});

// ============================================================================
// Named constants
// ============================================================================

describe('named constants', () => {
  it('REGION includes au', () => {
    assert.equal(REGION.AU, 'au');
  });

  it('REGION includes all 5 regions', () => {
    assert.equal(Object.values(REGION).length, 5);
  });

  it('MFA_STRATEGY includes pingid_reenroll', () => {
    assert.equal(MFA_STRATEGY.PINGID_REENROLL, 'pingid_reenroll');
  });

  it('NAMEID_STRATEGY includes map_to_persistent', () => {
    assert.equal(NAMEID_STRATEGY.MAP_TO_PERSISTENT, 'map_to_persistent');
  });

  it('FEDERATION_DIRECTION includes ping_idp_into_entra', () => {
    assert.equal(FEDERATION_DIRECTION.PING_IDP_INTO_ENTRA, 'ping_idp_into_entra');
  });

  it('OWNERSHIP_CLASSES has 6 classes including saml_sp_connections', () => {
    assert.equal(OWNERSHIP_CLASSES.length, 6);
    assert.ok(OWNERSHIP_CLASSES.includes('saml_sp_connections'));
  });
});

// ============================================================================
// Surface module routing — graceful skip if Keymaker modules absent
// ============================================================================

describe('createClient — surface module routing (Keymaker modules landed)', () => {
  it('cloud sub-client exposes users module (Keymaker cloud/users.js present)', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.users, 'cloud.users module should be present after Keymaker landed');
    assert.equal(typeof client.cloud.users, 'object');
    assert.equal(typeof client.cloud.users.listUsers, 'function');
  });

  it('cloud sub-client exposes groups module', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.groups, 'cloud.groups module should be present');
    assert.equal(typeof client.cloud.groups.listGroups, 'function');
  });

  it('cloud sub-client exposes apps module with listSamlApps', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.apps, 'cloud.apps module should be present');
    assert.equal(typeof client.cloud.apps.listSamlApps, 'function');
  });

  it('cloud sub-client exposes policies module', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.policies, 'cloud.policies module should be present');
    assert.equal(typeof client.cloud.policies.listSignOnPolicies, 'function');
  });

  it('cloud sub-client exposes environments module', () => {
    const client = createClient(cloudConfig());
    assert.ok(client.cloud.environments, 'cloud.environments module should be present');
    assert.equal(typeof client.cloud.environments.listEnvironments, 'function');
  });

  it('onprem.pingfederate has all required module methods (Keymaker onprem/pingfederate.js present)', () => {
    const client = createClient(onpremConfig());
    assert.ok(client.onprem.pingfederate.adminUrl);
    assert.ok(typeof client.onprem.pingfederate.getAuthHeader === 'function');
    assert.ok(typeof client.onprem.pingfederate.listSpConnections === 'function', 'listSpConnections should be present');
    assert.ok(typeof client.onprem.pingfederate.fetchOpenApiSpec === 'function', 'fetchOpenApiSpec should be present');
  });

  it('onprem.pingaccess has login method when configured', () => {
    const cfg = onpremConfig();
    cfg.onprem.pingaccess = { adminUrl: 'https://pa.corp.example.com:9000', username: 'admin', password: 'secret' };
    const client = createClient(cfg);
    assert.ok(client.onprem.pingaccess, 'pingaccess sub-client should be present');
    assert.ok(typeof client.onprem.pingaccess.login === 'function', 'login should be present');
  });
});
