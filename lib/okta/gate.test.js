/**
 * lib/okta/gate.test.js — Full gate coverage suite
 *
 * Written by Carver (Tester/QA). Comprehensive tests for lib/okta/gate.js.
 * Covers: assertEntraOwned (all 5 classes × 2 ownership states), isDryRun
 * (all boolean/truthy/falsy variants), dryRunGuard (composability + proof
 * that no fetch is called), cutoverWorkflow (all 3 shapes + workflow-switch
 * pattern), integration (loadMigrationProfile → gate chain), and contract
 * (non-throwing on malformed/partial profiles).
 *
 * Complements Sydnor's 19-test smoke layer in config.gate.test.js.
 * Run: node --test lib/okta/gate.test.js
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { assertEntraOwned, isDryRun, dryRunGuard, cutoverWorkflow, OBJECT_CLASSES } = require('./gate.js');
const { loadMigrationProfile } = require('./config.js');

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const REAL_OKTA_YAML = resolve(import.meta.dirname, '..', '..', '.secops', 'identity', 'okta.yaml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Profile where every class is okta-owned, dry_run:true */
function allOktaProfile() {
  return {
    source_of_truth: {
      per_class_ownership: {
        users: 'okta',
        credentials_mfa: 'okta',
        groups: 'okta',
        app_assignments: 'okta',
        policies: 'okta',
      },
    },
    strategy: {
      cutover_shape: 'phased_by_population',
      group_strategy: 'lift_and_shift',
      federation_direction: 'okta_idp_into_entra',
      mfa_strategy: 'reenroll_campaign',
    },
    execution: { dry_run: true, entra_write_tooling: 'none' },
  };
}

/** Profile where every class is entra-owned, dry_run:false */
function allEntraProfile() {
  return {
    source_of_truth: {
      per_class_ownership: {
        users: 'entra',
        credentials_mfa: 'entra',
        groups: 'entra',
        app_assignments: 'entra',
        policies: 'entra',
      },
    },
    strategy: {
      cutover_shape: 'big_bang',
      group_strategy: 'rationalize',
      federation_direction: 'entra_idp',
      mfa_strategy: 'passkey_bootstrap',
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
// 1. assertEntraOwned — all 5 classes × 2 ownership states
// ============================================================================

describe('gate — assertEntraOwned — all 5 classes × 2 ownership states', () => {
  for (const cls of OBJECT_CLASSES) {
    it(`returns {ok:true} when ${cls} is entra-owned`, () => {
      assert.deepEqual(assertEntraOwned(allEntraProfile(), cls), { ok: true });
    });

    it(`returns {ok:false} when ${cls} is okta-owned`, () => {
      const result = assertEntraOwned(allOktaProfile(), cls);
      assert.equal(result.ok, false);
      assert.ok(result.error, 'error message must be present');
      assert.ok(result.error.includes(cls), `error should name the blocked class; got: ${result.error}`);
    });
  }

  it('okta-owned error explains the single-writer rule', () => {
    const result = assertEntraOwned(allOktaProfile(), 'users');
    assert.equal(result.ok, false);
    assert.ok(
      result.error.includes('blocked') || result.error.includes('Write'),
      `error should explain blockage; got: ${result.error}`
    );
  });

  it('okta-owned error tells operator how to declare readiness', () => {
    const result = assertEntraOwned(allOktaProfile(), 'groups');
    assert.equal(result.ok, false);
    assert.ok(
      result.error.includes('entra') || result.error.includes('migration_profile'),
      `error should reference how to fix; got: ${result.error}`
    );
  });
});

// ============================================================================
// 2. assertEntraOwned — edge cases and malformed profiles
// ============================================================================

describe('gate — assertEntraOwned — edge cases', () => {
  it('returns {ok:false} for an unknown object class', () => {
    const result = assertEntraOwned(allEntraProfile(), 'rockets');
    assert.equal(result.ok, false);
    assert.ok(
      result.error.includes('unknown object class') || result.error.includes('rockets'),
      `Got: ${result.error}`
    );
  });

  it('error for unknown class lists valid class names', () => {
    const result = assertEntraOwned(allEntraProfile(), 'unknown_class');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('users'), `expected valid class names listed; got: ${result.error}`);
  });

  it('returns {ok:false} when profile is null', () => {
    const result = assertEntraOwned(null, 'users');
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  it('returns {ok:false} when profile is undefined', () => {
    assert.equal(assertEntraOwned(undefined, 'users').ok, false);
  });

  it('does not throw when profile has no source_of_truth', () => {
    assert.doesNotThrow(() => {
      const result = assertEntraOwned({}, 'users');
      assert.equal(result.ok, false);
    });
  });

  it('does not throw when per_class_ownership is missing', () => {
    assert.doesNotThrow(() => {
      const result = assertEntraOwned({ source_of_truth: {} }, 'users');
      assert.equal(result.ok, false);
    });
  });

  it('returns {ok:false} when per_class_ownership[class] is undefined (reports "unset")', () => {
    const profile = { source_of_truth: { per_class_ownership: {} } };
    const result = assertEntraOwned(profile, 'users');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('unset') || result.error.includes('undefined'));
  });

  it('OBJECT_CLASSES constant has exactly the 5 expected classes', () => {
    const expected = ['users', 'credentials_mfa', 'groups', 'app_assignments', 'policies'];
    assert.deepEqual([...OBJECT_CLASSES].sort(), expected.sort());
  });
});

// ============================================================================
// 3. isDryRun — all states
// ============================================================================

describe('gate — isDryRun', () => {
  it('returns true when execution.dry_run is true', () => {
    assert.equal(isDryRun({ execution: { dry_run: true } }), true);
  });

  it('returns false when execution.dry_run is false', () => {
    assert.equal(isDryRun({ execution: { dry_run: false } }), false);
  });

  it('returns false for null profile (does not throw)', () => {
    assert.doesNotThrow(() => assert.equal(isDryRun(null), false));
  });

  it('returns false for undefined profile', () => {
    assert.equal(isDryRun(undefined), false);
  });

  it('returns false when execution block is missing', () => {
    assert.equal(isDryRun({}), false);
  });

  it('returns false when dry_run is the string "true" (only boolean true counts)', () => {
    assert.equal(isDryRun({ execution: { dry_run: 'true' } }), false);
  });

  it('returns false when dry_run is number 1', () => {
    assert.equal(isDryRun({ execution: { dry_run: 1 } }), false);
  });

  it('fixture profile dry_run value is true (valid-profile.yaml — default-safe)', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(r.ok, true);
    assert.equal(isDryRun(r.data), true, 'valid-profile.yaml has dry_run: true');
  });
});

// ============================================================================
// 4. dryRunGuard — composability + no fetch side-effects
// ============================================================================

describe('gate — dryRunGuard', () => {
  it('returns a result object (not null) when dry_run is true', () => {
    const result = dryRunGuard({ execution: { dry_run: true } }, 'deactivate user abc123');
    assert.notEqual(result, null);
  });

  it('result has ok: true', () => {
    const result = dryRunGuard({ execution: { dry_run: true } }, 'create group marketing');
    assert.equal(result.ok, true);
  });

  it('result.data.dryRun is true', () => {
    const result = dryRunGuard({ execution: { dry_run: true } }, 'sync groups');
    assert.equal(result.data.dryRun, true);
  });

  it('result.data.would carries the operation description verbatim', () => {
    const op = 'remove app assignment for user xyz@acme.com';
    const result = dryRunGuard({ execution: { dry_run: true } }, op);
    assert.equal(result.data.would, op);
  });

  it('returns null when dry_run is false (caller proceeds live)', () => {
    assert.equal(dryRunGuard({ execution: { dry_run: false } }, 'deactivate user abc123'), null);
  });

  it('returns null for null profile (does not throw; caller proceeds live)', () => {
    assert.doesNotThrow(() => assert.equal(dryRunGuard(null, 'some op'), null));
  });

  it('result shape is {ok:true, data:{dryRun:true, would:string}} — no extra fields required', () => {
    const result = dryRunGuard({ execution: { dry_run: true } }, 'test op');
    assert.equal(result.ok, true);
    assert.equal(typeof result.data, 'object');
    assert.equal(result.data.dryRun, true);
    assert.equal(typeof result.data.would, 'string');
  });

  it('DOES NOT invoke fetch when dry_run is true — install throw-fetch to prove it', () => {
    _savedFetch = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('fetch must NOT be called during dry run'); };

    assert.doesNotThrow(() => {
      const result = dryRunGuard({ execution: { dry_run: true } }, 'write group membership');
      assert.equal(result.ok, true);
      assert.equal(result.data.dryRun, true);
    });
  });

  it('composability: guard short-circuits BEFORE live call when dry_run:true', () => {
    const profile = { execution: { dry_run: true } };
    let liveCallMade = false;

    function simulatedOp() {
      const guard = dryRunGuard(profile, 'add user to group');
      if (guard) return guard;      // short-circuit — no live call
      liveCallMade = true;
      return { ok: true, data: { live: true } };
    }

    const result = simulatedOp();
    assert.equal(result.ok, true);
    assert.equal(result.data.dryRun, true);
    assert.equal(liveCallMade, false, 'live call must NOT be made when dry_run:true');
  });

  it('composability: guard returns null and caller proceeds live when dry_run:false', () => {
    const profile = { execution: { dry_run: false } };
    let liveCallMade = false;

    function simulatedOp() {
      const guard = dryRunGuard(profile, 'add user to group');
      if (guard) return guard;
      liveCallMade = true;
      return { ok: true, data: { live: true } };
    }

    const result = simulatedOp();
    assert.equal(liveCallMade, true, 'live call MUST be made when dry_run:false');
    assert.equal(result.data.live, true);
  });
});

// ============================================================================
// 5. cutoverWorkflow — all 3 cutover shapes + all 4 data fields
// ============================================================================

describe('gate — cutoverWorkflow', () => {
  it('returns {ok:true} for a valid profile', () => {
    assert.equal(cutoverWorkflow(allOktaProfile()).ok, true);
  });

  it('data contains all 4 declared keys', () => {
    const { data } = cutoverWorkflow(allOktaProfile());
    assert.ok('cutoverShape' in data);
    assert.ok('groupStrategy' in data);
    assert.ok('federationDirection' in data);
    assert.ok('mfaStrategy' in data);
  });

  it('returns cutoverShape: big_bang', () => {
    const p = allEntraProfile(); p.strategy.cutover_shape = 'big_bang';
    assert.equal(cutoverWorkflow(p).data.cutoverShape, 'big_bang');
  });

  it('returns cutoverShape: phased_by_app', () => {
    const p = allOktaProfile(); p.strategy.cutover_shape = 'phased_by_app';
    assert.equal(cutoverWorkflow(p).data.cutoverShape, 'phased_by_app');
  });

  it('returns cutoverShape: phased_by_population', () => {
    const p = allOktaProfile(); p.strategy.cutover_shape = 'phased_by_population';
    assert.equal(cutoverWorkflow(p).data.cutoverShape, 'phased_by_population');
  });

  it('returns groupStrategy: rationalize', () => {
    const p = allEntraProfile(); p.strategy.group_strategy = 'rationalize';
    assert.equal(cutoverWorkflow(p).data.groupStrategy, 'rationalize');
  });

  it('returns groupStrategy: lift_and_shift', () => {
    const p = allOktaProfile(); p.strategy.group_strategy = 'lift_and_shift';
    assert.equal(cutoverWorkflow(p).data.groupStrategy, 'lift_and_shift');
  });

  it('returns federationDirection: per_app', () => {
    const p = allOktaProfile(); p.strategy.federation_direction = 'per_app';
    assert.equal(cutoverWorkflow(p).data.federationDirection, 'per_app');
  });

  it('returns mfaStrategy: per_population', () => {
    const p = allOktaProfile(); p.strategy.mfa_strategy = 'per_population';
    assert.equal(cutoverWorkflow(p).data.mfaStrategy, 'per_population');
  });

  it('returns {ok:false} when strategy block is missing', () => {
    const result = cutoverWorkflow({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('strategy'));
  });

  it('returns {ok:false} for null profile (does not throw)', () => {
    assert.doesNotThrow(() => {
      const result = cutoverWorkflow(null);
      assert.equal(result.ok, false);
    });
  });

  it('workflow selection switch — big_bang maps to single-window', () => {
    const p = allEntraProfile(); p.strategy.cutover_shape = 'big_bang';
    const { data } = cutoverWorkflow(p);
    const workflow = { big_bang: 'single-window', phased_by_app: 'app-iterator', phased_by_population: 'cohort-waves' }[data.cutoverShape] ?? 'unknown';
    assert.equal(workflow, 'single-window');
  });

  it('workflow selection switch — phased_by_app maps to app-iterator', () => {
    const p = allOktaProfile(); p.strategy.cutover_shape = 'phased_by_app';
    const { data } = cutoverWorkflow(p);
    const workflow = { big_bang: 'single-window', phased_by_app: 'app-iterator', phased_by_population: 'cohort-waves' }[data.cutoverShape] ?? 'unknown';
    assert.equal(workflow, 'app-iterator');
  });

  it('workflow selection switch — phased_by_population maps to cohort-waves', () => {
    const p = allOktaProfile(); p.strategy.cutover_shape = 'phased_by_population';
    const { data } = cutoverWorkflow(p);
    const workflow = { big_bang: 'single-window', phased_by_app: 'app-iterator', phased_by_population: 'cohort-waves' }[data.cutoverShape] ?? 'unknown';
    assert.equal(workflow, 'cohort-waves');
  });
});

// ============================================================================
// 6. Integration — loadMigrationProfile → gate chain
// ============================================================================

describe('gate — integration: loadMigrationProfile → gate chain', () => {
  it('valid-profile fixture: assertEntraOwned blocks ALL 5 classes (all declared okta-owned)', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(r.ok, true);
    for (const cls of OBJECT_CLASSES) {
      const gate = assertEntraOwned(r.data, cls);
      assert.equal(gate.ok, false, `Expected ${cls} blocked (okta-owned); got ok:true`);
      assert.ok(gate.error.includes(cls));
    }
  });

  it('valid-profile fixture: dryRunGuard short-circuits (dry_run:true)', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(r.ok, true);
    const guard = dryRunGuard(r.data, 'migrate user batch 1');
    assert.notEqual(guard, null);
    assert.equal(guard.ok, true);
    assert.equal(guard.data.dryRun, true);
  });

  it('valid-profile fixture: cutoverWorkflow returns a valid declared shape', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(r.ok, true);
    const w = cutoverWorkflow(r.data);
    assert.equal(w.ok, true);
    assert.ok(
      ['big_bang', 'phased_by_app', 'phased_by_population'].includes(w.data.cutoverShape),
      `Unexpected cutoverShape: ${w.data.cutoverShape}`
    );
  });

  it('entra-owned fixture: assertEntraOwned passes for users, groups, app_assignments', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(r.ok, true);
    assert.deepEqual(assertEntraOwned(r.data, 'users'), { ok: true });
    assert.deepEqual(assertEntraOwned(r.data, 'groups'), { ok: true });
    assert.deepEqual(assertEntraOwned(r.data, 'app_assignments'), { ok: true });
  });

  it('entra-owned fixture: assertEntraOwned blocks credentials_mfa and policies', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(r.ok, true);
    assert.equal(assertEntraOwned(r.data, 'credentials_mfa').ok, false);
    assert.equal(assertEntraOwned(r.data, 'policies').ok, false);
  });

  it('entra-owned fixture: dry_run:false → dryRunGuard returns null (caller proceeds live)', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(r.ok, true);
    assert.equal(dryRunGuard(r.data, 'sync users'), null);
  });

  it('entra-owned fixture: ownership check + dry-run guard — full gate chain', () => {
    const r = loadMigrationProfile(resolve(FIXTURES, 'entra-owned-profile.yaml'));
    assert.equal(r.ok, true);

    // Gate 1: ownership check passes for entra-owned class
    const ownershipGate = assertEntraOwned(r.data, 'users');
    assert.deepEqual(ownershipGate, { ok: true });

    // Gate 2: dry-run guard returns null → caller would proceed live
    const dryGate = dryRunGuard(r.data, 'create user in Entra');
    assert.equal(dryGate, null, 'dry_run:false → null → caller proceeds live');
  });
});

// ============================================================================
// 6b. Integration — operator file (guarded, optional — Issue #10)
//
// Validates the real .secops/identity/okta.yaml ONLY when it exists on disk.
// Fresh clones and CI skip gracefully. Do NOT remove the guard.
// ============================================================================

describe('gate — integration: operator file (guarded, optional — Issue #10)', () => {
  const operatorFileExists = existsSync(REAL_OKTA_YAML);

  (operatorFileExists ? it : it.skip)('operator file: assertEntraOwned blocks ALL 5 classes', () => {
    const r = loadMigrationProfile(REAL_OKTA_YAML);
    assert.equal(r.ok, true);
    for (const cls of OBJECT_CLASSES) {
      const gate = assertEntraOwned(r.data, cls);
      assert.equal(gate.ok, false, `Expected ${cls} blocked; got ok:true`);
    }
  });

  (operatorFileExists ? it : it.skip)('operator file: dryRunGuard short-circuits (dry_run:true)', () => {
    const r = loadMigrationProfile(REAL_OKTA_YAML);
    assert.equal(r.ok, true);
    const guard = dryRunGuard(r.data, 'migrate user batch 1');
    assert.notEqual(guard, null);
    assert.equal(guard.ok, true);
    assert.equal(guard.data.dryRun, true);
  });

  (operatorFileExists ? it : it.skip)('operator file: cutoverWorkflow returns a valid declared shape', () => {
    const r = loadMigrationProfile(REAL_OKTA_YAML);
    assert.equal(r.ok, true);
    const w = cutoverWorkflow(r.data);
    assert.equal(w.ok, true);
    assert.ok(
      ['big_bang', 'phased_by_app', 'phased_by_population'].includes(w.data.cutoverShape),
      `Unexpected cutoverShape: ${w.data.cutoverShape}`
    );
  });
});

// ============================================================================
// 7. Contract — all gates are non-throwing on malformed/partial profiles
// ============================================================================

describe('gate — contract: never throws on malformed/partial profiles', () => {
  const MALFORMED = [
    null, undefined, {}, [], 42, 'string', true,
    { source_of_truth: null },
    { strategy: null },
    { execution: null },
    { source_of_truth: { per_class_ownership: null } },
  ];

  it('assertEntraOwned never throws on any malformed profile (all 5 classes)', () => {
    for (const input of MALFORMED) {
      for (const cls of OBJECT_CLASSES) {
        assert.doesNotThrow(
          () => assertEntraOwned(input, cls),
          `assertEntraOwned(${JSON.stringify(input)}, '${cls}') threw`
        );
      }
    }
  });

  it('isDryRun never throws on malformed input', () => {
    for (const input of MALFORMED) {
      assert.doesNotThrow(() => isDryRun(input), `isDryRun(${JSON.stringify(input)}) threw`);
    }
  });

  it('dryRunGuard never throws on malformed input', () => {
    for (const input of MALFORMED) {
      assert.doesNotThrow(() => dryRunGuard(input, 'test op'), `dryRunGuard(${JSON.stringify(input)}) threw`);
    }
  });

  it('cutoverWorkflow never throws on malformed input', () => {
    for (const input of MALFORMED) {
      assert.doesNotThrow(() => cutoverWorkflow(input), `cutoverWorkflow(${JSON.stringify(input)}) threw`);
    }
  });

  it('every gate returns a structured {ok,...} or boolean — never undefined/null (except dryRunGuard)', () => {
    for (const input of MALFORMED) {
      const ownership = assertEntraOwned(input, 'users');
      const dryBool = isDryRun(input);
      const dryGuard = dryRunGuard(input, 'op');
      const workflow = cutoverWorkflow(input);

      assert.equal(typeof ownership, 'object', 'assertEntraOwned must return an object');
      assert.notEqual(ownership, null, 'assertEntraOwned must not return null');
      assert.equal('ok' in ownership, true, 'assertEntraOwned result must have ok key');

      assert.equal(typeof dryBool, 'boolean', 'isDryRun must return a boolean');

      // dryRunGuard returns null (live) or {ok:true,...} (dry)
      assert.ok(
        dryGuard === null || (typeof dryGuard === 'object' && dryGuard.ok === true),
        `dryRunGuard must return null or {ok:true,...}; got ${JSON.stringify(dryGuard)}`
      );

      assert.equal(typeof workflow, 'object', 'cutoverWorkflow must return an object');
      assert.notEqual(workflow, null, 'cutoverWorkflow must not return null');
      assert.equal('ok' in workflow, true, 'cutoverWorkflow result must have ok key');
    }
  });
});
