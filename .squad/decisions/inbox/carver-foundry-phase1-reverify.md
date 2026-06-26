# Carver Foundry Phase 1 Re-Verification

**Date:** 2026-06-25T22:30:00-05:00  
**Reviewer:** Carver (QA/Test)  
**Branch:** foundry-integration  
**Scope:** Re-verify F-002 fix and Phase 1 P0 merge gates after Sydnor commit `faa913b`.

## Secret-scan fail-closed catch path

Reviewed `lib/foundry/gates/secret-scan.js` directly. Verdict: **PASS**.

- Fails closed on scanner exception: `catch` returns `{ ok: false, reason: ... }`.
- Returned reason is generic: `secret-scan failed closed (<redacted>)`.
- Returned reason does **not** interpolate `err.message` or payload content.
- Logging uses error type only: `scan-error:${errorTypeOf(err)}`.
- `errorTypeOf(err)` returns `err.name` or `Error`; it does **not** log raw exception text.

## Test re-run evidence

Commands were run locally on `foundry-integration`; I did not trust the report.

| Command | Tests | Suites | Pass | Fail | Skipped | Todo | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| `node --test lib/foundry/gates/secret-scan.test.js` | 7 | 1 | 7 | 0 | 0 | 0 | PASS |
| `node --test lib/foundry/**/*.test.js` | 96 | 22 | 96 | 0 | 0 | 0 | PASS |
| `npm test` | 322 | 59 | 322 | 0 | 0 | 0 | PASS |

F-002 regression test status: **RESOLVED**. The test `fails closed if scanning throws and does not leak the payload secret` now passes and asserts `Bearer scanthrowsecretvalue1234567890` is absent from `result.reason` and warning logs.

## Coverage evidence

Command: `node --experimental-test-coverage --test lib/foundry/**/*.test.js`

- Tests: 96
- Suites: 22
- Pass: 96
- Fail: 0
- Reported line coverage: **82.36% all files**
- This clears the Phase 1 merge bar requiring `lib/foundry` coverage >=80%. Barely, but it clears. Coverage is a floor, not a trophy.

## Six P0 merge-gate verdict

| Gate | Requirement | Verdict | Evidence |
|---:|---|---|---|
| 1 | `lib/foundry/` exists as Node.js/CommonJS; zero Python in `lib/` | PASS | `lib/foundry` implementation is Node.js/CommonJS; `lib/**/*.py` search found no files. |
| 2 | `npm test` passes with >=80% line coverage on `lib/foundry/**` | PASS | `npm test`: 322/322 pass. Coverage run: 82.36% line coverage. |
| 3 | Config schema reconciled to snake_case; schema-alignment test asserts field names | PASS | Foundry suite includes schema-alignment regression tests; `node --test lib/foundry/**/*.test.js`: 96/96 pass. |
| 4 | Safety gate test blocks private key / AWS key payloads before HTTP dispatch | PASS | Secret-scan suite: 7/7 pass, including AWS key and private-key blocking/redaction. Route tests confirm pre-dispatch hooks block before egress. F-002 regression also passes. |
| 5 | Fallback contract test: 401/404/429/timeout/ECONNREFUSED-style network rejection returns `{ok:false,error}`; no throw/crash | PASS | Provider fallback tests for Anthropic and OpenAI pass in the Foundry suite: HTTP 401/403/404/429, network rejection, and timeout. |
| 6 | Deploy script API version is verified/current (`2025-04-01-preview`) | PASS | `scripts/deploy-foundry-fable5.ps1` and `.sh` use `2025-04-01-preview`; no `2026-05-15-preview` remains in those scripts. |

## Findings

No new findings. F-002 is resolved.

## Overall verdict

**Phase 1: PASS. CLEARED FOR MERGE.**

Carver note: the coverage bar is met, not generous. Do not let future Foundry code land without keeping this above the floor.
