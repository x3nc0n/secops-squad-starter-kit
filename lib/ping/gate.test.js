/**
 * lib/ping/gate.test.js — Full gate coverage suite for Ping
 *
 * Mirrors lib/okta/gate.test.js structure. Covers all Ping gates:
 * - assertEntraOwned (6 classes × surface param × ownership states)
 * - assertNameIdPortable (hard-block formats, valid formats, missing strategy)
 * - assertHybridCoverage (missing surfaces, all surfaces confirmed, profile edge cases)
 * - isDryRun / dryRunGuard
 * - cutoverWorkflow (includes Ping-specific fields: nameIdStrategy, federationSource)
 *
 * Run: node --test lib/ping/gate.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertEntraOwned,
  assertNameIdPortable,
  assertHybridCoverage,
  isDryRun,
  dryRunGuard,
  cutoverWorkflow,
  OBJECT_CLASSES,
  SURFACE_CLASSES,
  NAMEID_HARD_BLOCK,
} = require('./gate.js');
const { loadMigrationProfile } = require('./config.js');

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Profile where every class is ping-owned, dry_run:true */
function allPingProfile() {
  return {
    source_of_truth: {
      identity_authority: 'pingfederate',
      federation_source: 'pingfederate',
      per_class_ownership: {
        users: 'ping',
        credentials_mfa: 'ping',
        groups: 'ping',
        app_assignments: 'ping',
        policies: 'ping',
        saml_sp_connections: 'ping',
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

/** Profile where every class is entra-owned, dry_run:false */
function allEntraProfile() {
  return {
    source_of_truth: {
      identity_authority: 'pingfederate',
      federation_source: 'pingfederate',
      per_class_ownership: {
        users: 'entra',
        credentials_mfa: 'entra',
        groups: 'entra',
        app_assignments: 'entra',
        policies: 'entra',
        saml_sp_connections: 'entra',
      },
    },
    strategy: {
      cutover_shape: 'big_bang',
      group_strategy: 'rationalize',
      federation_direction: 'entra_idp',
      mfa_strategy: 'passkey_bootstrap',
      nameid_strategy: 'map_to_persistent',
    },
    execution: { dry_run: false, entra_write_tooling: 'microsoft_graph' },
  };
}

let _savedFetch;
afterEach(() => {
  if (_savedFetch !== undefined) {
    globalThis.fetch = _savedFetch;
    _savedFetch = undefined;
  }
});

// ============================================================================
// OBJECT_CLASSES / SURFACE_CLASSES constants
// ============================================================================

describe('gate — constants', () => {
  it('OBJECT_CLASSES includes saml_sp_connections', () => {
    assert.ok(OBJECT_CLASSES.includes('saml_sp_connections'));
  });

  it('OBJECT_CLASSES has 6 entries', () => {
    assert.equal(OBJECT_CLASSES.length, 6);
  });

  it('SURFACE_CLASSES includes pingfederate', () => {
    assert.ok(SURFACE_CLASSES.includes('pingfederate'));
  });

  it('NAMEID_HARD_BLOCK contains transient format', () => {
    assert.ok(NAMEID_HARD_BLOCK.has('urn:oasis:names:tc:SAML:2.0:nameid-format:transient'));
  });

  it('NAMEID_HARD_BLOCK contains kerberos format', () => {
    assert.ok(NAMEID_HARD_BLOCK.has('urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos'));
  });

  it('NAMEID_HARD_BLOCK contains X509SubjectName format', () => {
    assert.ok(NAMEID_HARD_BLOCK.has('urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName'));
  });
});

// ============================================================================
// assertEntraOwned
// ============================================================================

describe('gate — assertEntraOwned', () => {
  it('returns {ok:true} when class is entra-owned', () => {
    const profile = allEntraProfile();
    assert.deepEqual(assertEntraOwned(profile, 'users'), { ok: true });
  });

  it('returns {ok:true} for saml_sp_connections when entra-owned', () => {
    const profile = allEntraProfile();
    assert.deepEqual(assertEntraOwned(profile, 'saml_sp_connections'), { ok: true });
  });

  it('returns {ok:false} when class is ping-owned', () => {
    const profile = allPingProfile();
    const result = assertEntraOwned(profile, 'users');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('blocked'), `expected "blocked" in: ${result.error}`);
    assert.ok(result.error.includes('users'), `expected class name in: ${result.error}`);
  });

  it('returns {ok:false} for saml_sp_connections when ping-owned', () => {
    const profile = allPingProfile();
    const result = assertEntraOwned(profile, 'saml_sp_connections');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('saml_sp_connections'));
  });

  it('error message includes the surface when provided', () => {
    const profile = allPingProfile();
    const result = assertEntraOwned(profile, 'users', 'pingfederate');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('pingfederate'), `expected surface in error: ${result.error}`);
  });

  it('returns {ok:true} when surface is valid and class is entra-owned', () => {
    const profile = allEntraProfile();
    assert.deepEqual(assertEntraOwned(profile, 'groups', 'pingone_cloud'), { ok: true });
  });

  it('returns {ok:false} for unknown object class', () => {
    const profile = allPingProfile();
    const result = assertEntraOwned(profile, 'rockets');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('unknown object class'));
  });

  it('returns {ok:false} for unknown surface', () => {
    const profile = allEntraProfile();
    const result = assertEntraOwned(profile, 'users', 'unknown_surface');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('unknown surface'));
  });

  it('returns {ok:false} when profile is null', () => {
    const result = assertEntraOwned(null, 'users');
    assert.equal(result.ok, false);
  });

  it('blocks all 6 ping-owned classes individually', () => {
    const profile = allPingProfile();
    for (const cls of OBJECT_CLASSES) {
      const result = assertEntraOwned(profile, cls);
      assert.equal(result.ok, false, `Expected block for ${cls}`);
      assert.ok(result.error.includes(cls), `Error should name class ${cls}`);
    }
  });

  it('allows all 6 entra-owned classes individually', () => {
    const profile = allEntraProfile();
    for (const cls of OBJECT_CLASSES) {
      const result = assertEntraOwned(profile, cls);
      assert.equal(result.ok, true, `Expected allow for ${cls}; got: ${result.error}`);
    }
  });
});

// ============================================================================
// assertNameIdPortable
// ============================================================================

describe('gate — assertNameIdPortable', () => {
  it('hard-blocks transient NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient');
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'nameid_incompatible');
    assert.ok(result.error.includes('BLOCKED'), `expected BLOCKED in: ${result.error}`);
  });

  it('hard-blocks kerberos NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos');
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'nameid_incompatible');
  });

  it('hard-blocks X509SubjectName NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName');
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'nameid_incompatible');
  });

  it('allows persistent NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
    assert.equal(result.ok, true);
  });

  it('allows emailAddress NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress');
    assert.equal(result.ok, true);
  });

  it('allows unspecified NameID format', () => {
    const profile = allPingProfile();
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified');
    assert.equal(result.ok, true);
  });

  it('blocks when nameid_strategy is not declared', () => {
    const profile = allPingProfile();
    delete profile.strategy.nameid_strategy;
    const result = assertNameIdPortable(profile, 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'nameid_incompatible');
    assert.ok(result.error.includes('nameid_strategy'), `expected field name: ${result.error}`);
  });

  it('returns {ok:false} when profile is null', () => {
    const result = assertNameIdPortable(null, 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent');
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'nameid_incompatible');
  });
});

// ============================================================================
// assertHybridCoverage
// ============================================================================

describe('gate — assertHybridCoverage', () => {
  it('returns {ok:true} when all inferred surfaces are confirmed', () => {
    const profile = allPingProfile(); // pingfederate authority
    const result = assertHybridCoverage(profile, ['pingfederate']);
    assert.equal(result.ok, true, `Expected ok:true; got: ${result.error}`);
  });

  it('returns {ok:true} for cloud-only profile when pingone_cloud confirmed', () => {
    const profile = allPingProfile();
    profile.source_of_truth.identity_authority = 'pingone';
    profile.source_of_truth.federation_source = 'pingone';
    const result = assertHybridCoverage(profile, ['pingone_cloud']);
    assert.equal(result.ok, true);
  });

  it('returns {ok:false} when declared surface not confirmed', () => {
    const profile = allPingProfile(); // pingfederate
    const result = assertHybridCoverage(profile, []); // nothing confirmed
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('pingfederate'));
    assert.ok(Array.isArray(result.missingSurfaces));
    assert.ok(result.missingSurfaces.includes('pingfederate'));
  });

  it('returns {ok:false} when confirmedSurfaces is not an array', () => {
    const profile = allPingProfile();
    const result = assertHybridCoverage(profile, null);
    assert.equal(result.ok, false);
  });

  it('returns {ok:false} when profile is null', () => {
    const result = assertHybridCoverage(null, ['pingfederate']);
    assert.equal(result.ok, false);
  });

  it('missingSurfaces array lists all unconfirmed required surfaces', () => {
    const profile = allPingProfile();
    profile.source_of_truth.identity_authority = 'pingfederate';
    profile.source_of_truth.federation_source = 'pingone'; // two surfaces required
    const result = assertHybridCoverage(profile, []); // none confirmed
    assert.equal(result.ok, false);
    assert.ok(result.missingSurfaces.length >= 1);
  });
});

// ============================================================================
// isDryRun + dryRunGuard
// ============================================================================

describe('gate — isDryRun', () => {
  it('returns true when dry_run is true', () => {
    assert.equal(isDryRun({ execution: { dry_run: true } }), true);
  });

  it('returns false when dry_run is false', () => {
    assert.equal(isDryRun({ execution: { dry_run: false } }), false);
  });

  it('returns false for null profile', () => {
    assert.equal(isDryRun(null), false);
  });

  it('returns false for profile without execution block', () => {
    assert.equal(isDryRun({}), false);
  });
});

describe('gate — dryRunGuard', () => {
  it('returns a simulated result when dry_run is true', () => {
    const profile = { execution: { dry_run: true } };
    const result = dryRunGuard(profile, 'migrate user abc123');
    assert.ok(result !== null);
    assert.equal(result.ok, true);
    assert.equal(result.data.dryRun, true);
    assert.equal(result.data.would, 'migrate user abc123');
  });

  it('returns null when dry_run is false (caller proceeds live)', () => {
    const profile = { execution: { dry_run: false } };
    assert.equal(dryRunGuard(profile, 'migrate user abc123'), null);
  });

  it('no fetch is called when guard short-circuits', () => {
    _savedFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = () => { fetchCalled = true; return Promise.resolve({}); };

    const profile = { execution: { dry_run: true } };
    const guard = dryRunGuard(profile, 'migrate user abc123');
    if (guard) {
      // short-circuited — no fetch
    }
    assert.equal(fetchCalled, false, 'fetch must not be called when dry-run guard fires');
  });
});

// ============================================================================
// cutoverWorkflow
// ============================================================================

describe('gate — cutoverWorkflow', () => {
  it('returns workflow shape from a valid profile', () => {
    const profile = allPingProfile();
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.cutoverShape, 'phased_by_app');
    assert.equal(result.data.groupStrategy, 'lift_and_shift');
  });

  it('returns Ping-specific nameIdStrategy field', () => {
    const profile = allPingProfile();
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.nameIdStrategy, 'map_to_persistent');
  });

  it('returns federationSource field', () => {
    const profile = allPingProfile();
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.federationSource, 'pingfederate');
  });

  it('returns {ok:false} when strategy block is missing', () => {
    const result = cutoverWorkflow({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('strategy block is missing'));
  });

  it('returns null federationSource when source_of_truth is absent', () => {
    const profile = { strategy: allPingProfile().strategy };
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.federationSource, null);
  });
});

// ============================================================================
// Integration — loadMigrationProfile → gate chain
// ============================================================================

describe('gate — integration with loadMigrationProfile', () => {
  it('entra-owned fixture: all classes pass assertEntraOwned', () => {
    const { ok, data } = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(ok, true, 'fixture must load successfully');
    for (const cls of OBJECT_CLASSES) {
      const result = assertEntraOwned(data, cls);
      assert.equal(result.ok, true, `Expected entra-owned for ${cls}`);
    }
  });

  it('valid-hybrid-profile fixture: all classes are ping-owned (blocked)', () => {
    const { ok, data } = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.equal(ok, true, 'fixture must load successfully');
    for (const cls of OBJECT_CLASSES) {
      const result = assertEntraOwned(data, cls);
      assert.equal(result.ok, false, `Expected ping-owned block for ${cls}`);
    }
  });

  it('valid-hybrid-profile fixture: cutoverWorkflow returns expected shape', () => {
    const { ok, data } = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.equal(ok, true);
    const wf = cutoverWorkflow(data);
    assert.equal(wf.ok, true);
    assert.ok(wf.data.nameIdStrategy, 'nameIdStrategy should be present');
  });
});
