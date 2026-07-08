# History

<!-- Populated automatically during squad sessions. -->

## Learnings

📌 **Okta Config/Gate Layer + GAP-1 Fix — 2026-07-08**

**Files Created/Modified:**
- `lib/okta/utils.js` — fixed `normalizeOrgUrl()`: `/\/+$/` strips ALL trailing slashes; `if (!url.match(/^https?:\/\//)) url = 'https://' + url` adds scheme. Carver's 2 GAP-1 tests now pass (164/164 total).
- `lib/okta/config.js` — `loadMigrationProfile(filePath?)` reads `migration_profile` block from `.secops/identity/okta.yaml` via js-yaml, validates against canonical schema, returns `{ok,data?,error?}`. `validateProfile(profile)` exported for testing. Mirrors `lib/foundry/config.js` pattern (readYaml → parse → validate → return). Never throws.
- `lib/okta/schema/migration-profile.schema.json` — JSON Schema (draft-07) for the canonical `migration_profile` block. Documents enum values, required fields, optional `per_attribute_authority` array, additionalProperties:false for operator tooling.
- `lib/okta/gate.js` — `assertEntraOwned(profile, objectClass)` blocks writes to Okta-owned classes (single-writer-per-class rule); `isDryRun(profile)` and `dryRunGuard(profile, opDescription)` short-circuit live calls; `cutoverWorkflow(profile)` returns declared shape for workflow selection. All synchronous, all return `{ok,...}`, never throw.
- `lib/okta/fixtures/` — valid-profile.yaml, entra-owned-profile.yaml, invalid-profile.yaml, no-migration-profile.yaml (smoke test fixtures)
- `lib/okta/config.gate.test.js` — 19 smoke tests across config + gate modules (6 suites, 19/19 pass)
- `lib/okta/index.js` — wired `loadMigrationProfile` and `gate` into public exports

**Config/gate design decisions:**

*Schema approach:* Inline enum validation via `Set` (no JSON Schema library dep) mirrors `lib/foundry/config.js`. The `migration-profile.schema.json` file is for operator tooling/documentation; runtime validation uses the Set-based `validateProfile()`.

*Error messages:* Every validation error names the failing field path + the invalid value + the valid options — operators get actionable output, not just "invalid config".

*Absent file / absent block:* Returns `{ok:false}` with a message telling the operator to run the decision guide. Does NOT silently return a default profile — the gate must be explicit.

*`dryRunGuard` pattern:* Returns `null` (proceed live) or a result object (short-circuit). Callers use `if (guard) return guard;` — clear, zero-ambiguity idiom matching the `{ok,...}` contract.

*Gate reusability:* `gate.js` has no imports from the Okta API modules — it's pure profile logic, so the Graph write-side can `require('./lib/okta/gate')` and call the same gates without pulling in the Okta HTTP client.

*`assertEntraOwned` directionality:* Guards Entra-side writes (lib/okta is READ-first; writes route to official MCP). The gate enforces the operator's declared ownership so neither system writes to a class the other owns.

📌 **Okta Platform Layer — 2026-07-08**


**Files Created:**
- `lib/okta/utils.js` — `normalizeOrgUrl()`, `oktaGet/Post/Put()`, `paginatedGet()` (Link-header cursor), `extractNextLink()`, `shapeError()`, rate-limit back-off using `X-Rate-Limit-Reset` + exponential jitter
- `lib/okta/auth.js` — SSWS (`getSswsAuthHeader()`), OAuth2 `client_credentials` (`getTokenClientCredentials()`), OAuth2 `private_key_jwt` (`getTokenPrivateKeyJwt()` + `buildPrivateKeyJwt()`), in-memory token cache with 5-min early-refresh buffer (mirrors graph-security/auth.js)
- `lib/okta/index.js` — `createClient(config)` factory supporting `ssws`/`clientCredentials`/`privateKeyJwt` auth methods; constants `GROUP_TYPE`, `USER_STATUS`, `SIGN_ON_MODE`, `POLICY_TYPE`, `FACTOR_TYPE`
- `lib/okta/users.js` — `listUsers()`, `getUser()`, `searchUsers()`, `listUserGroups()`, `listUserFactors()`, `getUserLifecycle()`
- `lib/okta/groups.js` — `listGroups()`, `getGroup()`, `listGroupMembers()`, `listGroupRules()`, `getGroupRule()`, `listGroupApps()`
- `lib/okta/apps.js` — `listApps()`, `getApp()`, `getAppSamlSettings()`, `getAppOidcSettings()`, `listAppUsers()`, `listAppGroups()`, `listAppKeys()`
- `lib/okta/policies.js` — `listPolicies()`, `getPolicy()`, `getPolicyRules()`, `getPolicyRule()`, `listAuthenticators()`, `getAuthenticator()`, `listAllMigrationPolicies()`
- `lib/okta/README.md` — auth setup, {ok} contract, pagination, rate-limit guidance, env vars
- `skills/okta/okta-mcp-server.md` — MCP server tool contract, tool schemas, migration workflow phases

**Auth model decisions:**
- Three auth methods: `ssws` (SSWS header, no network), `clientCredentials` (Basic auth → token), `privateKeyJwt` (RS256 JWT assertion → token)
- `privateKeyJwt` implemented natively using Node.js `crypto.createSign('RSA-SHA256')` + `crypto.randomUUID()` — zero external deps
- Token caching with 5-min buffer on `expiresAt` (identical pattern to `lib/foundry/auth.js` and `lib/graph-security/auth.js`)

**Pagination design:**
- Okta uses `Link: <url>; rel="next"` header (unlike OData `@nextLink`)
- `extractNextLink()` parses the Link header with regex
- All list functions: pass `nextLink` option for manual paging, or `fetchAll: true` for auto-collect (100-page safety cap)

**Rate-limit design:**
- On HTTP 429: read `X-Rate-Limit-Reset` (Unix epoch), compute wait = (resetEpoch - now) + random jitter ≤500ms
- Falls back to exponential back-off using `Retry-After` header
- Max 3 retries before returning `{ok: false}` to caller

**{ok} contract reuse:**
- Identical shape to graph-security: `{ok: true, data, nextLink?}` | `{ok: false, error, status?, errorCode?}`
- `shapeError()` maps Okta's `errorCode`/`errorSummary`/`errorCauses` into the standard shape

**Read-first posture:**
- No write/update/delete functions exposed in any module
- Documented explicitly in README and MCP skill doc

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

---

## 2026-06-26T04:33:44Z — Foundry Phase 1 COMPLETED: Providers + Dispatch + CLI READY

Sydnor completed Phase 1 on foundry-integration branch across 4 commits:
1. Commit de7e981: `lib/foundry/providers/anthropic.js` + `openai.js` (no-throw fallback contract)
2. Commit 6e48348: `lib/foundry/index.js` dispatch orchestrator (fail-closed gate semantics)
3. Commit 7f63550: `cli/commands/foundry.js` + CLI registration (P0 gates always attached)
4. Commit faa913b: F-002 fix (secret exception redaction)

**Status:** Phase 1 PASS — CLEARED FOR MERGE

- Providers: Anthropic and OpenAI clients; both return `{ok:false,error}` on any failure; never throw
- Dispatch: `getFoundryProvider()` + `routeToFoundry()` with hook contract for pre/post gates
- CLI: `foundry status` and `foundry route` commands; status shows config state (no secrets); route always attaches P0 gates
- F-002: fixed exception text redaction to prevent secret leakage in reason/logs
- Final verdict: 6/6 merge gates PASS; all tests green (322/322); coverage 82.36%

Inbox merged into decisions.md. Orchestration logs in .squad/orchestration-log/. Session log in .squad/log/.

