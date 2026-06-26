# Foundry Phase 0 — Implementation Record

**Date:** 2026-06-25T19:49:57-05:00
**By:** Sydnor (Platform Dev)
**Status:** Shipped on `foundry-integration` branch

---

## What Shipped

Phase 0 delivers config loading, auth, fixture files, deploy script fixes, and
doc cleanup. Phase 1 (provider HTTP clients, index.js public API) is deferred.

### Files Created

| File | Purpose |
|------|---------|
| `lib/foundry/config.js` | Load + validate `.secops/foundry.yaml`; endpoint URL resolution |
| `lib/foundry/auth.js` | Foundry bearer token (API key → az CLI); mirrored tokenCache pattern |
| `lib/foundry/fixtures/valid-foundry.yaml` | Canonical config; `loadFoundryConfig` → non-null |
| `lib/foundry/fixtures/disabled-foundry.yaml` | `enabled: false` → null |
| `lib/foundry/fixtures/malformed-foundry.yaml` | Bad YAML syntax → null |
| `lib/foundry/fixtures/schema-drifted-foundry.yaml` | Old shape (missing active_model/status) → null |
| `lib/foundry/fixtures/partial-foundry.yaml` | Missing endpoint; returns config (not null) |
| `lib/foundry/fixtures/no-active-deployment-foundry.yaml` | `status: pending_quota` → null |

### Files Updated

| File | Change |
|------|--------|
| `.secops/foundry.yaml.example` | Rewritten to full canonical schema with comments |
| `secops-squad.config.schema.json` | Removed `foundry` properties block; added `$comment` pointer |
| `skills/platform/foundry-model-routing.md` | Replaced Python pseudo-code in §1 and §3 with Node.js CommonJS |
| `scripts/deploy-foundry-fable5.ps1` | Fixed ARM api-version, base URL, full YAML output |
| `scripts/deploy-foundry-fable5.sh` | Same fixes as .ps1 |

---

## Public API Contract — Carver Must Test Against These

### `lib/foundry/config.js`

```js
const { loadFoundryConfig, resolveEndpoint, normalizeEndpoint } = require('./lib/foundry/config');
```

**`loadFoundryConfig(rootDir)`** → `object | null`
- Returns `null` when:
  - `.secops/foundry.yaml` is missing
  - YAML is malformed (parse error)
  - `foundry.enabled !== true`
  - `foundry.active_model` is absent or empty
  - No `model_deployments` entry where `model_id === active_model && status === "active"`
- On success, returns the full parsed data object (mutated: `foundry.endpoint` normalized in-place)
- NEVER throws

**`resolveEndpoint(config, deployment)`** → `string`
- `config` = full data object from `loadFoundryConfig()`
- `deployment` = one entry from `config.foundry.model_deployments`
- `provider: "anthropic"` → `{endpoint}{api_path}`
- `provider: "openai"` or `"openai-reasoning"` → `{endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}`
- Deduplicates trailing slashes on base endpoint

**`normalizeEndpoint(endpoint)`** → `string`
- Strips `/anthropic` or `/openai` path suffix if baked into the URL
- Emits `console.warn` when stripping occurs
- Exported for unit testing

### `lib/foundry/auth.js`

```js
const { getFoundryToken, clearTokenCache, getCachedToken, cacheToken } = require('./lib/foundry/auth');
```

**`getFoundryToken({execFn?})`** → `{ok: true, token: string} | {ok: false, error: string}`
- Resolution order: in-memory cache → `FOUNDRY_API_KEY` env var → `az account get-access-token`
- `execFn` is injectable: pass `(cmd, opts) => string` to avoid real az CLI in tests
  - Example: `getFoundryToken({ execFn: () => '{"token":"t","expiry":"2099-01-01 00:00:00"}' })`
- Cache key: `'foundry:cognitiveservices'`; 5-minute early-refresh buffer
- API key entries cached with 1-year TTL
- NEVER throws

**`clearTokenCache()`** — flush all cached tokens (use in test beforeEach/afterEach)

**`getCachedToken(key)`**, **`cacheToken(key, token, expiresInSeconds)`** — exported for low-level testing

---

## Fixture Contract

| File | `loadFoundryConfig()` returns | Why |
|------|-------------------------------|-----|
| `valid-foundry.yaml` | non-null config object | Fully valid canonical schema |
| `disabled-foundry.yaml` | `null` | `enabled: false` |
| `malformed-foundry.yaml` | `null` | YAML parse error |
| `schema-drifted-foundry.yaml` | `null` | `active_model` absent; no active deployment |
| `partial-foundry.yaml` | non-null config (endpoint undefined) | Valid enough to pass gating checks; caller must handle missing endpoint |
| `no-active-deployment-foundry.yaml` | `null` | Deployment `status: "pending_quota"` |

> **Note for Carver:** To test `loadFoundryConfig` against a fixture, place the
> fixture at `<tmpDir>/.secops/foundry.yaml` and call `loadFoundryConfig(tmpDir)`.
> The fixtures dir itself cannot be used as a rootDir — the function looks for
> `{rootDir}/.secops/foundry.yaml`.

---

## Deploy Script Constants

Both `.ps1` and `.sh` now define `ARM_API_VERSION = "2025-04-01-preview"` as a
named constant with a verification comment + source URL. The endpoint emitted by
both scripts is now a clean base URL (`https://{resource}.cognitiveservices.azure.com`)
with no `/anthropic/v1/` suffix.
