/**
 * lib/okta/config.gate.test.js — Minimal smoke tests for config.js and gate.js
 *
 * Written by Sydnor. Carver will add the full config-gating suite.
 * Purpose: verify new modules load cleanly and their core contracts hold.
 *
 * Run: node --test lib/okta/config.gate.test.js
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
  it('returns {ok:true, data} for a valid profile', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(result.ok, true);
    assert.ok(result.data, 'data should be present');
    assert.equal(result.data.source_of_truth.identity_authority, 'okta');
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
        identity_authority: 'okta',
        hris_system: null,
        per_class_ownership: {
          users: 'entra',
          credentials_mfa: 'okta',
          groups: 'entra',
          app_assignments: 'entra',
          policies: 'okta',
        },
      },
      strategy: {
        cutover_shape: 'phased_by_app',
        group_strategy: 'lift_and_shift',
        federation_direction: 'okta_idp_into_entra',
        mfa_strategy: 'reenroll_campaign',
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
        identity_authority: 'okta',
        per_class_ownership: {
          users: 'okta',
          credentials_mfa: 'okta',
          groups: 'okta',
          app_assignments: 'okta',
          policies: 'okta',
        },
      },
      strategy: {
        cutover_shape: 'explode_everything',
        group_strategy: 'lift_and_shift',
        federation_direction: 'entra_idp',
        mfa_strategy: 'passkey_bootstrap',
      },
      execution: { dry_run: true, entra_write_tooling: 'none' },
    };
    const errors = validateProfile(profile);
    assert.ok(errors.length > 0);
    assert.ok(errors.some((e) => e.includes('cutover_shape')));
  });

  it('validates optional per_attribute_authority entries', () => {
    const profile = {
      source_of_truth: {
        identity_authority: 'mixed',
        hris_system: 'workday',
        per_class_ownership: {
          users: 'entra',
          credentials_mfa: 'okta',
          groups: 'entra',
          app_assignments: 'okta',
          policies: 'okta',
        },
        per_attribute_authority: [
          { attribute: 'manager', authority: 'hris' },
          { attribute: 'department', authority: 'hris' },
        ],
      },
      strategy: {
        cutover_shape: 'phased_by_population',
        group_strategy: 'rationalize',
        federation_direction: 'per_app',
        mfa_strategy: 'per_population',
      },
      execution: { dry_run: true, entra_write_tooling: 'none' },
    };
    const errors = validateProfile(profile);
    assert.deepEqual(errors, []);
  });
});

// ---------------------------------------------------------------------------
// gate — assertEntraOwned
// ---------------------------------------------------------------------------

describe('gate — assertEntraOwned', () => {
  it('returns {ok:true} when class is entra-owned', () => {
    const profile = {
      source_of_truth: {
        per_class_ownership: { users: 'entra', credentials_mfa: 'okta', groups: 'entra', app_assignments: 'entra', policies: 'okta' },
      },
    };
    assert.deepEqual(assertEntraOwned(profile, 'users'), { ok: true });
  });

  it('returns {ok:false} when class is okta-owned', () => {
    const profile = {
      source_of_truth: {
        per_class_ownership: { users: 'okta', credentials_mfa: 'okta', groups: 'okta', app_assignments: 'okta', policies: 'okta' },
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
    const result = dryRunGuard(profile, 'deactivate user abc123');
    assert.ok(result !== null);
    assert.equal(result.ok, true);
    assert.equal(result.data.dryRun, true);
    assert.equal(result.data.would, 'deactivate user abc123');
  });

  it('returns null when dry_run is false (caller proceeds live)', () => {
    const profile = { execution: { dry_run: false } };
    assert.equal(dryRunGuard(profile, 'deactivate user abc123'), null);
  });
});

// ---------------------------------------------------------------------------
// gate — cutoverWorkflow
// ---------------------------------------------------------------------------

describe('gate — cutoverWorkflow', () => {
  it('returns workflow shape from a valid profile', () => {
    const profile = {
      strategy: {
        cutover_shape: 'phased_by_app',
        group_strategy: 'lift_and_shift',
        federation_direction: 'okta_idp_into_entra',
        mfa_strategy: 'reenroll_campaign',
      },
    };
    const result = cutoverWorkflow(profile);
    assert.equal(result.ok, true);
    assert.equal(result.data.cutoverShape, 'phased_by_app');
    assert.equal(result.data.groupStrategy, 'lift_and_shift');
  });

  it('returns {ok:false} when strategy block is missing', () => {
    const result = cutoverWorkflow({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('strategy block is missing'));
  });
});
