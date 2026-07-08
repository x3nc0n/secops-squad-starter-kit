/**
 * lib/okta/config.test.js — Full config coverage suite
 *
 * Written by Carver (Tester/QA). Comprehensive tests for lib/okta/config.js.
 * Covers: loadMigrationProfile with the real operator yaml, every invalid-enum
 * combination, missing required sections, per_attribute_authority edge cases,
 * and contract (never throws).
 *
 * Complements Sydnor's 19-test smoke layer in config.gate.test.js.
 * Run: node --test lib/okta/config.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadMigrationProfile, validateProfile, VALID, OWNERSHIP_CLASSES } = require('./config.js');

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const REAL_OKTA_YAML = resolve(import.meta.dirname, '..', '..', '.secops', 'identity', 'okta.yaml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fully-valid profile object — mutate per test. */
function base() {
  return {
    source_of_truth: {
      identity_authority: 'okta',
      hris_system: null,
      per_class_ownership: {
        users: 'okta',
        credentials_mfa: 'okta',
        groups: 'okta',
        app_assignments: 'okta',
        policies: 'okta',
      },
    },
    strategy: {
      cutover_shape: 'big_bang',
      group_strategy: 'lift_and_shift',
      federation_direction: 'okta_idp_into_entra',
      mfa_strategy: 'reenroll_campaign',
    },
    execution: {
      dry_run: true,
      entra_write_tooling: 'microsoft_graph',
    },
  };
}

// ============================================================================
// 1. loadMigrationProfile — real operator file
// ============================================================================

describe('config — loadMigrationProfile — real okta.yaml', () => {
  it('loads and validates .secops/identity/okta.yaml → {ok:true}', () => {
    const result = loadMigrationProfile(REAL_OKTA_YAML);
    assert.equal(result.ok, true, `Expected ok:true; got error: ${result.error}`);
    assert.ok(result.data, 'data should be present');
  });

  it('real profile has a valid identity_authority enum value', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    assert.ok(
      VALID.identity_authority.has(data.source_of_truth.identity_authority),
      `Got: ${data.source_of_truth.identity_authority}`
    );
  });

  it('real profile has all 5 per_class_ownership keys with valid values', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    for (const cls of OWNERSHIP_CLASSES) {
      assert.ok(
        VALID.ownership.has(data.source_of_truth.per_class_ownership[cls]),
        `${cls} has invalid value: ${data.source_of_truth.per_class_ownership[cls]}`
      );
    }
  });

  it('real profile per_attribute_authority: [] is valid (empty array accepted)', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    const paa = data.source_of_truth.per_attribute_authority;
    if (paa !== undefined) {
      assert.ok(Array.isArray(paa), 'per_attribute_authority must be an array');
      assert.equal(paa.length, 0, 'real file has per_attribute_authority: []');
    }
    // undefined is also acceptable (optional field)
  });

  it('real profile has a valid strategy block', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    const s = data.strategy;
    assert.ok(VALID.cutover_shape.has(s.cutover_shape), `cutover_shape: ${s.cutover_shape}`);
    assert.ok(VALID.group_strategy.has(s.group_strategy), `group_strategy: ${s.group_strategy}`);
    assert.ok(VALID.federation_direction.has(s.federation_direction), `federation_direction: ${s.federation_direction}`);
    assert.ok(VALID.mfa_strategy.has(s.mfa_strategy), `mfa_strategy: ${s.mfa_strategy}`);
  });

  it('real profile execution.dry_run is a boolean', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    assert.equal(typeof data.execution.dry_run, 'boolean');
  });

  it('real profile execution.entra_write_tooling is a valid enum', () => {
    const { data } = loadMigrationProfile(REAL_OKTA_YAML);
    assert.ok(
      VALID.entra_write_tooling.has(data.execution.entra_write_tooling),
      `Got: ${data.execution.entra_write_tooling}`
    );
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

  it('missing-block error includes actionable guidance', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'no-migration-profile.yaml'));
    assert.ok(
      result.error.includes('decision') || result.error.includes('skills') || result.error.includes('migration_profile'),
      `Expected guidance text; got: ${result.error}`
    );
  });

  it('returns {ok:false} for invalid profile with "validation failed" in error', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('validation failed'), `Expected "validation failed"; got: ${result.error}`);
  });

  it('validation error message lists the count of errors', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'invalid-profile.yaml'));
    assert.match(result.error, /\d+\s+error/);
  });

  it('validation error names the specific invalid fields', () => {
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
// 3. validateProfile — valid enum combinations (positive tests)
// ============================================================================

describe('config — validateProfile — valid enum values', () => {
  it('accepts identity_authority: hris', () => {
    const p = base(); p.source_of_truth.identity_authority = 'hris';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts identity_authority: mixed', () => {
    const p = base(); p.source_of_truth.identity_authority = 'mixed';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts all per_class_ownership values as entra', () => {
    const p = base();
    for (const cls of OWNERSHIP_CLASSES) p.source_of_truth.per_class_ownership[cls] = 'entra';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts cutover_shape: phased_by_app', () => {
    const p = base(); p.strategy.cutover_shape = 'phased_by_app';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts cutover_shape: phased_by_population', () => {
    const p = base(); p.strategy.cutover_shape = 'phased_by_population';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts group_strategy: rationalize', () => {
    const p = base(); p.strategy.group_strategy = 'rationalize';
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

  it('accepts mfa_strategy: passkey_bootstrap', () => {
    const p = base(); p.strategy.mfa_strategy = 'passkey_bootstrap';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts mfa_strategy: per_population', () => {
    const p = base(); p.strategy.mfa_strategy = 'per_population';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts entra_write_tooling: entra_native', () => {
    const p = base(); p.execution.entra_write_tooling = 'entra_native';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts entra_write_tooling: none', () => {
    const p = base(); p.execution.entra_write_tooling = 'none';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts dry_run: false', () => {
    const p = base(); p.execution.dry_run = false;
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts hris_system as a string', () => {
    const p = base(); p.source_of_truth.hris_system = 'Workday';
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts per_attribute_authority: [] (empty is valid)', () => {
    const p = base(); p.source_of_truth.per_attribute_authority = [];
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts per_attribute_authority with okta authority', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [{ attribute: 'customAttr', authority: 'okta' }];
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts per_attribute_authority with entra authority', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [{ attribute: 'department', authority: 'entra' }];
    assert.deepEqual(validateProfile(p), []);
  });

  it('accepts per_attribute_authority with multiple valid entries', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [
      { attribute: 'manager', authority: 'hris' },
      { attribute: 'costCenter', authority: 'hris' },
      { attribute: 'department', authority: 'okta' },
    ];
    assert.deepEqual(validateProfile(p), []);
  });
});

// ============================================================================
// 4. validateProfile — invalid enum values (each field named + echoed)
// ============================================================================

describe('config — validateProfile — invalid enum values', () => {
  it('rejects unknown identity_authority — names the field + echoes the value + lists options', () => {
    const p = base(); p.source_of_truth.identity_authority = 'ldap';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('identity_authority'));
    assert.ok(msg, `No error for identity_authority; errors: ${JSON.stringify(errors)}`);
    assert.ok(msg.includes('ldap'), 'should echo the invalid value');
    assert.ok(msg.includes('okta'), 'should list valid options');
  });

  it('rejects unknown per_class_ownership value — names the class', () => {
    const p = base(); p.source_of_truth.per_class_ownership.users = 'saml';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('users'));
    assert.ok(msg, 'error should name the class');
    assert.ok(msg.includes('saml'));
  });

  it('rejects invalid value for each ownership class individually', () => {
    for (const cls of OWNERSHIP_CLASSES) {
      const p = base(); p.source_of_truth.per_class_ownership[cls] = 'invalid';
      const errors = validateProfile(p);
      const msg = errors.find(e => e.includes(cls));
      assert.ok(msg, `Expected error for ${cls}; errors: ${JSON.stringify(errors)}`);
    }
  });

  it('rejects unknown cutover_shape — names field + value + options', () => {
    const p = base(); p.strategy.cutover_shape = 'nuclear_option';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('cutover_shape'));
    assert.ok(msg);
    assert.ok(msg.includes('nuclear_option'));
    assert.ok(msg.includes('big_bang'), 'should list valid options');
  });

  it('rejects unknown group_strategy — names field + value', () => {
    const p = base(); p.strategy.group_strategy = 'delete_all';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('group_strategy'));
    assert.ok(msg);
    assert.ok(msg.includes('delete_all'));
  });

  it('rejects unknown federation_direction — names field + value', () => {
    const p = base(); p.strategy.federation_direction = 'bidirectional';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('federation_direction'));
    assert.ok(msg);
    assert.ok(msg.includes('bidirectional'));
  });

  it('rejects unknown mfa_strategy — names field + value', () => {
    const p = base(); p.strategy.mfa_strategy = 'hope_for_the_best';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('mfa_strategy'));
    assert.ok(msg);
    assert.ok(msg.includes('hope_for_the_best'));
  });

  it('rejects unknown entra_write_tooling — names field + value + options', () => {
    const p = base(); p.execution.entra_write_tooling = 'powershell_direct';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('entra_write_tooling'));
    assert.ok(msg);
    assert.ok(msg.includes('powershell_direct'));
    assert.ok(msg.includes('microsoft_graph'), 'should list valid options');
  });

  it('rejects dry_run as a string', () => {
    const p = base(); p.execution.dry_run = 'yes';
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('dry_run'));
    assert.ok(msg, `Expected error for dry_run string; errors: ${JSON.stringify(errors)}`);
  });

  it('rejects dry_run as a number', () => {
    const p = base(); p.execution.dry_run = 1;
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('dry_run')));
  });

  it('rejects per_attribute_authority entry with unknown authority', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [{ attribute: 'manager', authority: 'workday' }];
    const errors = validateProfile(p);
    const msg = errors.find(e => e.includes('authority'));
    assert.ok(msg);
    assert.ok(msg.includes('workday'));
  });

  it('rejects per_attribute_authority entry missing the attribute field', () => {
    const p = base();
    p.source_of_truth.per_attribute_authority = [{ authority: 'hris' }];
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('attribute')));
  });

  it('collects multiple field errors in a single pass', () => {
    const p = base();
    p.source_of_truth.identity_authority = 'bad_authority';
    p.strategy.cutover_shape = 'bad_shape';
    p.strategy.group_strategy = 'bad_strategy';
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

  it('returns error when profile is a string', () => {
    const errors = validateProfile('not-an-object');
    assert.ok(errors.length > 0);
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

  it('returns error when per_attribute_authority is not an array', () => {
    const p = base(); p.source_of_truth.per_attribute_authority = 'manager:hris';
    const errors = validateProfile(p);
    assert.ok(errors.some(e => e.includes('per_attribute_authority')));
  });
});
