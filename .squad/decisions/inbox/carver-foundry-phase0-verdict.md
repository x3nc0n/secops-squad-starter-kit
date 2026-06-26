# Carver — Foundry Phase 0 QA Verdict

**Date:** 2026-06-25T20:00:50-05:00
**Author:** Carver (Tester/QA)
**Branch:** foundry-integration
**Reviewed commit:** c7f09ec (Sydnor — Foundry Phase 0 foundation)

---

## Test Results

| File | Tests | Pass | Fail |
|------|-------|------|------|
| `lib/foundry/config.test.js` | 34 | 34 | 0 |
| `lib/foundry/auth.test.js` | 25 | 25 | 0 |
| **Full suite (`npm test`)** | **285** | **285** | **0** |

**Command:** `node --test lib/foundry/config.test.js` + `node --test lib/foundry/auth.test.js`
**Exit codes:** both 0

---

## Phase 0 Exit Gate Assessment

### (a) Config loads from fixtures ✅ PASS
All 6 fixtures exercised; each matches Sydnor's stated contract exactly:
- `valid-foundry.yaml` → non-null ✔
- `disabled-foundry.yaml` → null ✔
- `malformed-foundry.yaml` → null ✔
- `schema-drifted-foundry.yaml` → null ✔
- `partial-foundry.yaml` → non-null ✔ (see Safety Smell below)
- `no-active-deployment-foundry.yaml` → null ✔

### (b) Auth mocked/injectable works ✅ PASS
`getFoundryToken({ execFn })` injection tested across all paths:
- API key path: FOUNDRY_API_KEY → ok:true, execFn never called ✔
- Empty/whitespace API key falls through to Entra path ✔
- Entra path: execFn returns JSON → ok:true + correct token ✔
- Token caching: second call uses cache, execFn call count stays 1 ✔
- `clearTokenCache()` forces re-acquisition ✔
- az failure (throw) → ok:false, no exception escapes ✔
- Malformed JSON output → ok:false, no throw ✔
- Buffer output (execSync default) handled correctly ✔
- Null token in JSON output → ok:false ✔

### (c) No Python in lib/ ✅ PASS
All code in `lib/foundry/` is Node.js CommonJS. No `.py` files present.

---

## Bugs Found in Sydnor's Code

**None.** All exported behaviors match the documented contracts.

---

## Findings (Non-Blocking)

### ⚠️ FINDING F-001: Partial config (missing endpoint) is fail-open

**File:** `lib/foundry/config.js`, `loadFoundryConfig()` (lines 76–109)
**Severity:** Low (Phase 1 hardening recommended)

`loadFoundryConfig()` does not validate that `foundry.endpoint` is present or non-empty. A config with a valid `active_model` and active deployment but **no endpoint** returns non-null, which means callers believe Foundry is available. When they subsequently call `resolveEndpoint()`, the base URL is an empty string, producing broken relative URLs like `/anthropic/v1/messages` that will fail at HTTP dispatch time with a confusing `ENOTFOUND` or connection error.

**Current behavior (documented in test):** `partial-foundry.yaml` → non-null, `resolveEndpoint()` → `/anthropic/v1/messages` (no scheme/host).

**Phase 1 recommendation:** Add endpoint validation to `loadFoundryConfig()`:
```js
if (!foundry.endpoint || typeof foundry.endpoint !== 'string' || !foundry.endpoint.startsWith('http')) {
  return null; // fail-closed: no endpoint = not usable
}
```

This keeps Phase 0 unblocked but should be a P1 gate before any provider code calls `resolveEndpoint()` in production.

---

## Schema Regression Coverage

The schema alignment tests verify:
1. `foundry.yaml.example` is valid YAML ✔
2. All canonical snake_case fields present: `schema_version`, `resource_name`, `endpoint`, `location`, `resource_group`, `api_version`, `active_model`, `model_deployments`, `pricing`, `cost_ceiling_usd` ✔
3. Per-deployment fields present: `model_id`, `deployment_name`, `deployment_type`, `provider`, `status`, `api_path`, `reasoning_model` ✔
4. No camelCase keys in the example YAML (the original drift defect) ✔
5. `secops-squad.config.schema.json` has no `"modelDeployments"` camelCase key (removed per decision) ✔
6. JSON schema `$comment` references `foundry.yaml` as canonical location ✔

These tests would have caught all three pre-Sydnor schema drift defects Carver identified in the previous audit.

---

## Reviewer Verdict

**Phase 0: ✅ PASSES**

Sydnor's foundation is solid. The three exported functions (`loadFoundryConfig`, `resolveEndpoint`, `normalizeEndpoint`) and the auth module (`getFoundryToken`, cache primitives) all behave exactly as specified. The fail-open partial-config behavior is the only finding, and it is intentional per Sydnor's stated contract — I've flagged it for Phase 1 hardening, not as a blocker here.

**Cleared for Phase 1 work** (provider dispatch in `providers/anthropic.js` and `providers/openai-reasoning.js`).
