/**
 * lib/ping/config.test.js — Full config coverage suite for Ping
 *
 * Mirrors lib/okta/config.test.js structure exactly.
 * Covers: loadMigrationProfile with fixture files, every invalid-enum
 * combination, missing required sections, per_attribute_authority edge cases,
 * Ping-specific fields (federation_source, nameid_strategy, saml_sp_connections),
 * and contract (never throws).
 *
 * Run: node --test lib/ping/config.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadMigrationProfile, validateProfile, VALID, OWNERSHIP_CLASSES } = require('./config.js');

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fully-valid hybrid profile object — mutate per test. */
function base() {
  return {
    source_of_truth: {
      identity_authority: 'pingfederate',
      federation_source: 'pingfederate',
      hris_system: null,
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
      cutover_shape: 'big_bang',
      group_strategy: 'lift_and_shift',
      federation_direction: 'ping_idp_into_entra',
      mfa_strategy: 'pingid_reenroll',
      nameid_strategy: 'map_to_persistent',
    },
    execution: {
      dry_run: true,
      entra_write_tooling: 'microsoft_graph',
    },
  };
}

// ============================================================================
// 1. loadMigrationProfile — fixture files
// ============================================================================

describe('config — loadMigrationProfile — fixtures', () => {
  it('loads valid-hybrid-profile.yaml → {ok:true}', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.equal(result.ok, true, `Expected ok:true; got error: ${result.error}`);
    assert.ok(result.data, 'data should be present');
  });

  it('loads valid-cloud-profile.yaml → {ok:true}', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-cloud-profile.yaml'));
    assert.equal(result.ok, true, `Expected ok:true; got error: ${result.error}`);
  });

  it('loads valid-onprem-profile.yaml → {ok:true}', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-onprem-profile.yaml'));
    assert.equal(result.ok, true, `Expected ok:true; got error: ${result.error}`);
  });

  it('loads entra-owned-profile.yaml → {ok:true}', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(result.ok, true, `Expected ok:true; got error: ${result.error}`);
  });

  it('valid-hybrid-profile has pingfederate as identity_authority', () => {
    const { data } = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.equal(data.source_of_truth.identity_authority, 'pingfederate');
  });

  it('valid-hybrid-profile has all 6 per_class_ownership keys with valid values', () => {
    const { data } = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    for (const cls of OWNERSHIP_CLASSES) {
      assert.ok(
        VALID.ownership.has(data.source_of_truth.per_class_ownership[cls]),
        `${cls} has invalid value: ${data.source_of_truth.per_class_ownership[cls]}`
      );
    }
  });

  it('valid-hybrid-profile has nameid_strategy field', () => {
    const { data } = loadMigrationProfile(resolve(FIXTURES, 'valid-hybrid-profile.yaml'));
    assert.ok(VALID.nameid_strategy.has(data.strategy.nameid_strategy));
  });

  it('entra-owned-profile has all classes set to entra', () => {
    const { data } = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    for (const cls of OWNERSHIP_CLASSES) {
      assert.equal(data.source_of_truth.per_class_ownership[cls], 'entra');
    }
  });

  it('never throws when called with no argument (cwd default path)', () => {
    assert.doesNotThrow(() => {
      const result = loadMigrationProfile();
      assert.equal(typeof result.ok, 'boolean');
    });
  });
});

// ============================================================================
// 2. loadMigrationProfile — error cases
// ============================================================================

describe('config — loadMigrationProfile — error cases', () => {
  it('returns {ok:false} for a missing file', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'does-not-exist.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('not found'), `Expected "not found"; got: ${result.error}`);
  });

  it('missing-file error contains the filename', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'does-not-exist.yaml'));
    assert.ok(result.error.includes('does-not-exist.yaml'));
  });

  it('missing-file error includes actionable guidance (decision guide reference)', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'does-not-exist.yaml'));
    assert.ok(
      result.error.includes('decision') || result.error.includes('skills') || result.error.includes('migration_profile'),
      `Expected guidance text; got: ${result.error}`
    );
  });

  it('returns {ok:false} when migration_profile block is absent', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'no-migration-profile.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('migration_profile'), `Expected "migration_profile"; got: ${result.error}`);
  });

  it('returns {ok:false} for invalid profile with "validation failed" in error', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('validation failed'), `Expected "validation failed"; got: ${result.error}`);
  });

  it('invalid-profile.yaml triggers at least 6 distinct validation errors', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.equal(result.ok, false);
    // Count error lines by matching numbered list items
    const matches = result.error.match(/^\s+\d+\./gm) || [];
    assert.ok(matches.length >= 6, `Expected ≥6 errors, got ${matches.length}:\n${result.error}`);
  });

  it('validation error names specific invalid fields', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.ok(result.error.includes('identity_authority'), `expected field name; got: ${result.error}`);
  });

  it('never throws on a completely invalid path', () => {
    assert.doesNotThrow(() => loadMigrationProfile('/no/such/path/anywhere.yaml'));
  });

  it('returns {ok:false} on invalid path (not null/undefined)', () => {
    const result = loadMigrationProfile('/no/such/path/anywhere.yaml');
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
    assert.ok(result.error.length > 0);
  });
});

// ============================================================================
// 3. validateProfile — valid Ping-specific enum values
// ============================================================================

describe('config — validateProfile — Ping-specific valid enums', () => {
  it('accepts identity_authority: pingone', () => {
    const p = base(); p.source_of_truth.identity_authority = 'pingone';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts identity_authority: aic', () => {
    const p = base(); p.source_of_truth.identity_authority = 'aic';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts identity_authority: hris', () => {
    const p = base(); p.source_of_truth.identity_authority = 'hris';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts identity_authority: mixed', () => {
    const p = base(); p.source_of_truth.identity_authority = 'mixed';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts federation_source: pingone', () => {
    const p = base(); p.source_of_truth.federation_source = 'pingone';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts federation_source: aic', () => {
    const p = base(); p.source_of_truth.federation_source = 'aic';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts mfa_strategy: pingid_reenroll', () => {
    const p = base(); p.strategy.mfa_strategy = 'pingid_reenroll';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts mfa_strategy: passkey_bootstrap', () => {
    const p = base(); p.strategy.mfa_strategy = 'passkey_bootstrap';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts mfa_strategy: per_population', () => {
    const p = base(); p.strategy.mfa_strategy = 'per_population';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts nameid_strategy: use_email', () => {
    const p = base(); p.strategy.nameid_strategy = 'use_email';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts nameid_strategy: manual_per_app', () => {
    const p = base(); p.strategy.nameid_strategy = 'manual_per_app';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts federation_direction: entra_idp', () => {
    const p = base(); p.strategy.federation_direction = 'entra_idp';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts federation_direction: per_app', () => {
    const p = base(); p.strategy.federation_direction = 'per_app';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts all per_class_ownership values as entra (including saml_sp_connections)', () => {
    const p = base();
    for (const cls of OWNERSHIP_CLASSES) p.source_of_truth.per_class_ownership[cls] = 'entra';
    assert.deepEqual(validateProfile(p), []);
  });

  it('OWNERSHIP_CLASSES includes saml_sp_connections', () => {
    assert.ok(OWNERSHIP_CLASSES.includes('saml_sp_connections'), 'saml_sp_connections must be in OWNERSHIP_CLASSES');
  });

  it('accepts per_attribute_authority with ping authority', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [{ attribute: 'customAttr', authority: 'ping' }];
    assert.deepEqual(validateProfile(p), []);
  });
});

// ============================================================================
// 4. validateProfile — invalid enum values
// ============================================================================

describe('config — validateProfile — invalid enum values', () => {
  it('rejects identity_authority: okta (Okta value should not be valid for Ping)', () => {
    const p = base(); p.source_of_truth.identity_authority = 'okta';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('identity_authority'));
    assert.ok(msg, `No error for identity_authority; errors: ${JSON.stringify(errors)}`);
    assert.ok(msg.includes('okta'), 'should echo the invalid value');
  });

  it('rejects federation_source: invalid_source — names field + echoes value', () => {
    const p = base(); p.source_of_truth.federation_source = 'bad_source';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('federation_source'));
    assert.ok(msg, `No error for federation_source; errors: ${JSON.stringify(errors)}`);
    assert.ok(msg.includes('bad_source'));
  });

  it('rejects nameid_strategy: unknown value', () => {
    const p = base(); p.strategy.nameid_strategy = 'bad_nameid';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('nameid_strategy'));
    assert.ok(msg);
    assert.ok(msg.includes('bad_nameid'));
  });

  it('rejects mfa_strategy: reenroll_campaign (Okta value)', () => {
    const p = base(); p.strategy.mfa_strategy = 'reenroll_campaign';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('mfa_strategy'));
    assert.ok(msg, `No error for mfa_strategy; errors: ${JSON.stringify(errors)}`);
  });

  it('rejects unknown ownership value for saml_sp_connections', () => {
    const p = base(); p.source_of_truth.per_class_ownership.saml_sp_connections = 'okta';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('saml_sp_connections'));
    assert.ok(msg, `Expected error for saml_sp_connections; errors: ${JSON.stringify(errors)}`);
  });

  it('rejects dry_run as a string', () => {
    const p = base(); p.execution.dry_run = 'yes';
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('dry_run')));
  });

  it('collects multiple field errors in a single pass', () => {
    const p = base();
    p.source_of_truth.identity_authority = 'bad_authority';
    p.strategy.cutover_shape = 'bad_shape';
    p.strategy.nameid_strategy = 'bad_nameid';
    const errors = validateProfile(p);
    assert.ok(errors.length >= 3, `Expected ≥3 errors, got ${errors.length}: ${JSON.stringify(errors)}`);
  });
});

// ============================================================================
// 5. validateProfile — missing required sections
// ============================================================================

describe('config — validateProfile — missing required sections', () => {
  it('returns error when profile is null', () => {
    const errors = validateProfile(null);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('migration_profile'));
  });

  it('returns error when source_of_truth is missing', () => {
    const p = base(); delete p.source_of_truth;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('source_of_truth')));
  });

  it('returns error when strategy is missing', () => {
    const p = base(); delete p.strategy;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('strategy')));
  });

  it('returns error when execution is missing', () => {
    const p = base(); delete p.execution;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('execution')));
  });

  it('returns error when per_class_ownership is missing', () => {
    const p = base(); delete p.source_of_truth.per_class_ownership;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('per_class_ownership')));
  });

  it('returns one error per missing ownership class when per_class_ownership is empty', () => {
    const p = base(); p.source_of_truth.per_class_ownership = {};
    const errors = validateProfile(p);
    assert.ok(
      errors.length >= OWNERSHIP_CLASSES.length,
      `Expected ≥${OWNERSHIP_CLASSES.length} errors, got ${errors.length}`
    );
  });

  it('returns error when nameid_strategy is missing from strategy', () => {
    const p = base(); delete p.strategy.nameid_strategy;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('nameid_strategy')));
  });
});
