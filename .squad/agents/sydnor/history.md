# History

<!-- Populated automatically during squad sessions. -->

## Learnings

📌 **Foundry Phase 0 Implementation — 2026-06-25**

**Files Created:**
- `lib/foundry/config.js` — `loadFoundryConfig(rootDir)` + `resolveEndpoint(config, deployment)` + `normalizeEndpoint(endpoint)`
- `lib/foundry/auth.js` — `getFoundryToken({execFn?})` with tokenCache Map (5-min buffer), FOUNDRY_API_KEY env var path, az CLI path
- `lib/foundry/fixtures/valid-foundry.yaml` — canonical enabled config, one active anthropic deployment → `loadFoundryConfig` returns config
- `lib/foundry/fixtures/disabled-foundry.yaml` — enabled:false → returns null
- `lib/foundry/fixtures/malformed-foundry.yaml` — unmatched quote/bad indent → returns null (parse error)
- `lib/foundry/fixtures/schema-drifted-foundry.yaml` — old shape, missing active_model + status → returns null
- `lib/foundry/fixtures/partial-foundry.yaml` — enabled:true, active deployment, but endpoint missing → returns config (endpoint absent); resolveEndpoint produces empty base URL
- `lib/foundry/fixtures/no-active-deployment-foundry.yaml` — status:"pending_quota" → returns null

**Public API contract (Carver must test against these):**

`lib/foundry/config.js`:
- `loadFoundryConfig(rootDir)` → `object | null`
  - Returns `null` if: file missing, malformed YAML, `foundry.enabled !== true`, `foundry.active_model` absent, no deployment with `model_id === active_model && status === "active"`
  - Normalizes `foundry.endpoint` in-place (strips `/anthropic`/`/openai` suffixes, warns)
  - NEVER throws
- `resolveEndpoint(config, deployment)` → `string` (full URL)
  - `provider: "anthropic"` → `{endpoint}{api_path}`
  - `provider: "openai"|"openai-reasoning"` → `{endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}`
- `normalizeEndpoint(endpoint)` → `string` (exported for unit testing)

`lib/foundry/auth.js`:
- `getFoundryToken({execFn?})` → `{ok: true, token: string} | {ok: false, error: string}`
  - Order: in-memory cache → FOUNDRY_API_KEY env → az CLI
  - `execFn` injection: `getFoundryToken({ execFn: (cmd, opts) => '{"token":"...","expiry":"..."}' })`
  - Cache key: `foundry:cognitiveservices`; 5-min early-refresh buffer
  - NEVER throws
- `clearTokenCache()` — flush cache (testing)
- `getCachedToken(key)`, `cacheToken(key, token, expiresInSeconds)` — exported for testing

**Canonical schema field names (snake_case — final, ratified):**
`schema_version`, `foundry.enabled`, `foundry.resource_name`, `foundry.endpoint`, `foundry.location`, `foundry.resource_group`, `foundry.api_version`, `foundry.active_model`, `foundry.model_deployments[].model_id`, `.deployment_name`, `.deployment_type`, `.provider`, `.status`, `.api_path`, `.reasoning_model`, `foundry.pricing.input_per_million_tokens`, `.output_per_million_tokens`, `.prompt_cache_discount_pct`, `foundry.cost_ceiling_usd`

🔷 **Foundry Runtime Abstraction — Phase 0 Completion (2026-06-25)**
- **Schema conflict remediation:** Three incompatible schemas identified + unified to snake_case YAML (matches `.secops/` convention). JSON `foundry.*` section retired to pointer comment.
- **Module layout:** `lib/foundry/` with config.js (load+validate), auth.js (token + cache), fixtures (6 YAML files). Phase 1: providers/anthropic.js, providers/openai-reasoning.js, telemetry.js, public API.
- **Auth pattern:** Shell out to `az account get-access-token` with in-memory cache (5-min buffer, mirrors graph-security/auth.js pattern). No new npm deps (keep at 1: js-yaml only).
- **Deploy script fixes:** API version `2026-05-15-preview` corrected to `2025-04-01-preview` (verified stable), YAML output fields completed (active_model, status, provider, api_path, reasoning_model, cost_ceiling_usd).
- **Endpoint shape conflict resolved:** Anthropic path `/anthropic/v1/messages` vs OpenAI path `/openai/deployments/{name}/chat/completions` via per-deployment `api_path` field (not baked into base URL).
- **Phase 0 EXIT GATE: PASS** — Carver validated all 3 criteria (config loads, auth injection works, no Python in lib/). 59 new tests + 285 full suite pass. Cleared for Phase 1.
- **F-001 Finding (non-blocking):** Partial config (missing endpoint) is fail-open — Phase 1 hardening recommendation before production use.

