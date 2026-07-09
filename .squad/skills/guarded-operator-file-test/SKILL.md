# Skill: Guarded Operator File Test

**Category:** Test patterns / QA hygiene  
**Author:** Seraph  
**First applied:** Issue #10 — okta config test fixture hygiene (2026-07-08)

---

## Problem

Tests that validate personal/operator config files (gitignored, never committed) fail on fresh clones and CI because the files are absent. The test behavior is correct when the operator has the file, but breaks every other environment.

## Solution

Two-part pattern:

1. **Default suite uses committed fixtures** — covers the same validation paths with representative, committed YAML files.
2. **Operator-file validation is guarded by `existsSync`** — runs locally for operators who have the file; skips gracefully everywhere else.

## Implementation

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');
const OPERATOR_FILE = resolve(import.meta.dirname, '..', '..', '.secops', 'identity', 'okta.yaml');

// ── Default suite: committed fixture (always runs) ──────────────────────────
describe('loadMigrationProfile — committed fixture (valid-profile.yaml)', () => {
  it('loads and validates → {ok:true}', () => {
    const result = loadMigrationProfile(resolve(FIXTURES, 'valid-profile.yaml'));
    assert.equal(result.ok, true);
  });
  // ... additional assertions reconciled against actual fixture values
});

// ── Operator-file suite: guarded, optional ───────────────────────────────────
// Runs ONLY when the personal file exists on disk (gitignored).
// Fresh clones and CI skip all tests in this block gracefully.
// Do NOT remove the existsSync guard — see .squad/decisions.md.
describe('loadMigrationProfile — operator file (guarded, optional)', () => {
  const fileExists = existsSync(OPERATOR_FILE);

  (fileExists ? it : it.skip)('operator file loads with ok:true', () => {
    const result = loadMigrationProfile(OPERATOR_FILE);
    assert.equal(result.ok, true);
  });

  (fileExists ? it : it.skip)('operator file has valid enum values', () => {
    const { data } = loadMigrationProfile(OPERATOR_FILE);
    assert.ok(VALID.identity_authority.has(data.source_of_truth.identity_authority));
  });
});
```

## Key Rules

- **`existsSync` is called at describe-body scope** (not inside `it`), so all tests in the block share the same gate result.
- **Each `it` uses the ternary pattern** `(fileExists ? it : it.skip)(...)` — this means skipped tests still appear in the output as `# SKIP`, making it visible that they were intentionally skipped.
- **Fixture values must be verified** — don't copy assertions from old "real file" tests without checking the fixture's actual content. A wrong expected value is a test that always passes for the wrong reason.
- **Comment the guarded block clearly** — future maintainers must understand why the guard exists and must not remove it.

## When to Apply

- Any test that previously read from `.secops/`, `.squad/` personal paths, or any gitignored path.
- When adding new tests for functionality that reads user-specific config files.
- When porting tests from a personal dev environment to CI.

## Files Where This Pattern Is Already Applied

- `lib/okta/config.test.js` — Section 1b
- `lib/okta/gate.test.js` — Section 6b
