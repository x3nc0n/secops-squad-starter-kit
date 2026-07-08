/**
 * lib/ping/config.gate.test.js — Smoke tests for config.js + gate.js
 *
 * Mirrors lib/okta/config.gate.test.js. Verifies new modules load cleanly
 * and their core contracts hold. Full coverage is in config.test.js and gate.test.js.
 *
 * Run: node --test lib/ping/config.gate.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadMigrationProfile, validateProfile } = require('./config.js');
const { assertEntraOwned, isDryRun, dryRunGuard, cutoverWorkflow } = require('./gate.js');

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// config — loadMigrationProfile
// ---------------------------------------------------------------------------

describe('config — loadMigrationProfile', () => {
  it('returns {ok:true, data} for a valid hybrid profile', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.equal(result.ok, true);
    assert.ok(result.data, 'data should be present');
    assert.equal(result.data.source_of_truth.identity_authority, 'pingfederate');
    assert.equal(result.data.execution.dry_run, true);
  });

  it('returns {ok:false} when file is absent', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'does-not-exist.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'), `expected "not found" in: ${result.error}`);
  });

  it('returns {ok:false} when migration_profile block is missing', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'no-migration-profile.yaml'));
    assert.equal(result.ok, false);
    assert.ok(
      result.error.includes('migration_profile block not found'),
      `expected block-not-found message, got: ${result.error}`
    );
  });

  it('returns {ok:false} with field-level errors for invalid enum values', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('validation failed'), `expected validation error: ${result.error}`);
    assert.ok(result.error.includes('identity_authority'), `expected field name in error: ${result.error}`);
  });

  it('never throws on a non-existent path', () => {
    assert.doesNotThrow(() => loadMigrationProfile('/totally/nonexistent/path.yaml'));
  });
});

// ---------------------------------------------------------------------------
// config — validateProfile
// ---------------------------------------------------------------------------

describe('config — validateProfile', () => {
  it('returns no errors for a fully valid profile object', () => {
    const profile = {
      source_of_truth: {
        identity_authority: 'pingfederate',
        federation_source: 'pingfederate',
        hris_system: null,
        per_class_ownership: {
          users: 'entra',
          credentials_mfa: 'ping',
          groups: 'entra',
          app_assignments: 'entra',
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
      execution: {
        dry_run: false,
        entra_write_tooling: 'microsoft_graph',
      },
    };
    const errors = validateProfile(profile);
    assert.deepEqual(errors, []);
  });

  it('returns an error for an unknown cutover_shape', () => {
    const profile = {
      source_of_truth: {
        identity_authority: 'pingfederate',
        federation_source: 'pingfederate',
        per_class_ownership: {
          users: 'ping', credentials_mfa: 'ping', groups: 'ping',
          app_assignments: 'ping', policies: 'ping', saml_sp_connections: 'ping',
        },
      },
      strategy: {
        cutover_shape: 'explode_everything',
        group_strategy: 'lift_and_shift',
        federation_direction: 'ping_idp_into_entra',
        mfa_strategy: 'pingid_reenroll',
        nameid_strategy: 'map_to_persistent',
      },
      execution: { dry_run: true, entra_write_tooling: 'none' },
    };
    const errors = validateProfile(profile);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes('cutover_shape')));
  });
});

// ---------------------------------------------------------------------------
// gate — assertEntraOwned (with Ping-specific ownership values)
// ---------------------------------------------------------------------------

describe('gate — assertEntraOwned', () => {
  it('returns {ok:true} when class is entra-owned', () => {
    const profile = {
      source_of_truth: {
        per_class_ownership: {
          users: 'entra', credentials_mfa: 'ping', groups: 'entra',
          app_assignments: 'entra', policies: 'ping', saml_sp_connections: 'ping',
        },
      },
    };
    assert.deepEqual(assertEntraOwned(profile, 'users'), { ok: true });
  });

  it('returns {ok:false} when class is ping-owned', () => {
    const profile = {
      source_of_truth: {
        per_class_ownership: {
          users: 'ping', credentials_mfa: 'ping', groups: 'ping',
          app_assignments: 'ping', policies: 'ping', saml_sp_connections: 'ping',
        },
      },
    };
    const result = assertEntraOwned(profile, 'users');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('blocked'), `expected "blocked" in: ${result.error}`);
    assert.ok(result.error.includes('users'), `expected class name in: ${result.error}`);
  });

  it('returns {ok:false} for an unknown object class', () => {
    const profile = { source_of_truth: { per_class_ownership: {} } };
    const result = assertEntraOwned(profile, 'rockets');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('unknown object class'));
  });

  it('returns {ok:false} when profile is null', () => {
    const result = assertEntraOwned(null, 'users');
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// gate — isDryRun + dryRunGuard
// ---------------------------------------------------------------------------

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

  it('returns null when dry_run is false', () => {
    const profile = { execution: { dry_run: false } };
    assert.equal(dryRunGuard(profile, 'migrate user abc123'), null);
  });
});

// ---------------------------------------------------------------------------
// gate — cutoverWorkflow
// ---------------------------------------------------------------------------

describe('gate — cutoverWorkflow', () => {
  it('returns workflow shape from a valid Ping profile', () => {
    const profile = {
      source_of_truth: { federation_source: 'pingfederate' },
      strategy: {
        cutover_shape: 'phased_by_app',
        group_strategy: 'lift_and_shift',
        federation_direction: 'ping_idp_into_entra',
        mfa_strategy: 'pingid_reenroll',
        nameid_strategy: 'map_to_persistent',
      },
    };
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.cutoverShape, 'phased_by_app');
    assert.equal(result.data.nameIdStrategy, 'map_to_persistent');
    assert.equal(result.data.federationSource, 'pingfederate');
  });

  it('returns {ok:false} when strategy block is missing', () => {
    const result = cutoverWorkflow({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('strategy block is missing'));
  });
});
