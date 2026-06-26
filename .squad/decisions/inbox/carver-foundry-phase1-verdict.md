# Carver — Foundry Phase 1 Verdict

**Date:** 2026-06-25T22:10:00-05:00  
**Branch:** foundry-integration  
**Reviewer:** Carver (QA/Test, reviewer authority)

## Test Runs

- `node --test lib/foundry/**/*.test.js`: **96 tests**, 22 suites, **95 pass**, **1 fail**, 0 skipped, duration 458.0621ms.
- `npm test`: **322 tests**, 59 suites, **321 pass**, **1 fail**, 0 skipped, duration 482.6075ms.
- Coverage: `node --experimental-test-coverage --test lib/foundry/**/*.test.js` reported **82.37% line coverage** across the Foundry test target (branch 66.67%, funcs 79.59%). Coverage clears the 80% line bar, but the suite is red.

## Six P0 Merge Gates

1. **Node.js implementation, no Python in `lib/`: PASS**  
   No `lib/**/*.py`; no Python implementation patterns found in `lib/foundry`.
2. **`npm test` + >=80% coverage on `lib/foundry`: FAIL**  
   Coverage is 82.37%, but `npm test` fails. Red tests do not merge.
3. **Schema reconciled and tested: PASS**  
   Existing schema regression tests cover canonical `.secops/foundry.yaml` snake_case and F-001 partial config behavior.
4. **Secret-scan gate test: FAIL**  
   Secret classes block, but scan-exception redaction fails. See F-002.
5. **Fallback contract test: PASS**  
   Anthropic and OpenAI provider matrices cover 200, 401, 403, 404, 429, network rejection, timeout, request URL/header shape, and bearer vs API-key auth. Non-200 paths assert `{ok:false}` with no thrown exception.
6. **F-001 fail-closed regression test: PASS**  
   Missing endpoint returns `loadFoundryConfig() === null`; `routeToFoundry()` returns `{ok:false,error:'foundry-not-configured'}` before fetch.

## Findings

### F-002 — P0 blocker — Secret-scan fail-closed path leaks exception text into returned reason

**Owner to fix:** Sydnor (Platform Dev), not Kima, because Kima authored the safety gate and reviewer lockout requires a different fixer.

**Repro:**

```powershell
node --test lib/foundry/gates/secret-scan.test.js
```

**Failure:** `createSecretScanGate().run()` catches scanner exceptions and returns:

```js
{ ok:false, reason:`secret-scan failed closed: ${message}` }
```

If scanner/serialization exception text contains a secret-shaped value, the returned route reason leaks it to the caller/CLI. The test injects a throwing rule whose error message contains `Bearer scanthrowsecretvalue1234567890`; that value appears in `result.reason`.

**Expected:** fail closed with a generic redacted reason, e.g. `secret-scan failed closed (<redacted>)`, while logs also remain redacted.

## Overall Phase 1 Verdict

**FAIL.** The routing/provider/audit surface is substantially covered and F-001 is fixed, but the secret-scan fail-closed path leaks sensitive exception text and the full test suite is red. The merge bar is strict: no merge until F-002 is fixed by a different agent and `npm test` is green.
