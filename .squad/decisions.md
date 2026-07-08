

# Squad Decisions

## Active Decisions


### 2026-07-08T12:14:47-05:00: User directive — use the official Okta MCP server

**By:** x3nc0n (via Copilot)

**What:** Do NOT build a custom Okta MCP server. Adopt Okta's official MCP server (https://github.com/okta/okta-mcp-server, announced 2025-09-22). It is a Python/`uv` server built on Okta's official SDK, exposing User, Group, Application, and Policy management plus system logs, with Device Authorization Grant (interactive) and Private Key JWT (headless) auth. It performs writes as well as reads.

**Why:** Avoid reinventing a maintained, SDK-backed server. Position our own `lib/okta` as the migration-specific, deterministic/idempotent, dry-run-gated complement (bulk export, Okta→Entra mapping, reconciliation, migration-state tracking) rather than duplicating admin CRUD. `skills/okta/okta-mcp-server.md` should become an INTEGRATION guide for the official server (setup, auth, tool surface, when-to-use vs lib/okta), not a spec for a homegrown server.

---

### 2026-07-08T12:14:47-05:00: User directive — source-of-truth is an activation-time decision gate

**By:** x3nc0n (via Copilot)

**What:** Do NOT hardcode an assumption about whether Okta or an upstream HRIS is the identity source of truth. Instead, build the source-of-truth determination in as an explicit **decision point surfaced to the user when they activate the Okta skills in SecOps Squad.** The framework must prompt the operator to declare, per migration engagement: (1) is the true SoT Okta or an upstream HRIS (Workday/etc.); (2) per-object-class writer ownership across phases; (3) per-attribute authority where it splits (e.g. manager/department from HRIS vs app-custom attrs from Okta); (4) group strategy — lift-and-shift vs rationalize to Entra dynamic groups/access packages.

**Why:** Reusable framework across many environments — the SoT answer differs per customer and drives the entire provisioning pipeline (Okta→Entra backbone vs Okta-as-transition-bridge with HRIS→Entra). Capturing it as a guided gate keeps the tooling generic and prevents building the wrong pipeline.

**How to implement:**
- Kima: add a "source-of-truth decision gate" section to skills/okta (README + migration map) that walks the operator through the questions; record the answer in `.secops/identity/okta.yaml` under a `migration_status`/`source_of_truth` block.
- Sydnor: `lib/okta` config + migration-state should carry the declared SoT/ownership so export/reconcile behaves accordingly (no writes to a class the operator didn't declare Entra-owned).
- McNulty: architecture doc treats SoT as an operator-declared INPUT with the ownership matrix as a fill-in-the-blanks artifact, not a fixed assumption.

---

### 2026-07-08T12:25:37-05:00: User directive — build the customizable AI harness, not baked answers

**By:** x3nc0n (via Copilot)

**What:** This entire Okta framework is a REUSABLE framework customized by an individual operator. Every significant decision (source-of-truth, per-class ownership, cutover shape, group strategy, tooling boundary, federation direction, MFA re-enrollment approach, etc.) must be supported by an **AI harness** — not answered by us. Build:
1. **Markdown decision guides** (the "harness" prompts) that walk an operator through each decision with options, trade-offs, and a recommended default — consumable by both the human and the SecOps Squad agents at skill-activation time.
2. **A machine-readable config** the operator fills in (e.g. `.secops/identity/okta.yaml` + a dedicated migration config/profile) capturing every declared choice.
3. **Scripts / lib tooling** that READ the operator's declared choices and behave accordingly (e.g. never write to an object class the operator didn't declare Entra-owned; select cutover workflow per declared shape; dry-run gating driven by config).

**Principle:** The framework encodes the DECISION SPACE and enforces the operator's answers; it does not hardcode a specific customer's answers. Generic + config-driven + agent-guided.

**Routing implications:**
- Sydnor: config schema + a config loader/validator in lib/okta; tooling reads declared ownership/cutover/dry-run flags and gates behavior.
- Kima: markdown decision guides (one per decision area) under skills/okta; okta.yaml template with every decision field + commented options.
- McNulty: architecture doc frames every decision as operator-declared input with a pointer to its decision guide + config field.
- Carver: tests assert tooling honors config (e.g. refuses writes to non-Entra-owned classes; respects dry-run).

---

### 2026-07-08T12:14:47-05:00: Okta → Entra Migration Map — Approach and Two-Mode Framing

**Date:** 2026-07-08T12:14:47-05:00
**By:** Kima (SecOps Engineer)
**Status:** Proposed — team awareness

**What:** Authored `skills/okta/` — a complete reference domain for Okta identity work. Two-mode framing: Mode 1 (Okta → Entra ID Migration) treats Okta as a source system being replaced with migration map as key deliverable. Mode 2 (Okta-Federated Operations) keeps Okta as IdP with agent supporting operational tasks. Mapping uses three-column quality model: ✅ Clean (direct 1:1), ⚠️ Requires action (transformation/lookup), ❌ No map (no Entra equivalent). Key gotchas: MFA enrollments not portable (zero Okta factors migrate; re-enroll required), SAML certs must rotate, OIDC client IDs change, Entra CA most-restrictive vs Okta first-match, regex in dynamic groups unsupported, "Everyone" group has no equivalent, SWA apps cannot migrate. Files: `skills/okta/README.md`, `core-api-overview.md`, `users-and-profiles.md`, `groups-and-rules.md`, `applications-saml-oidc.md`, `policies-and-authenticators.md`, `okta-to-entra-migration-map.md`, `.secops/identity/okta.yaml` template.

---

### 2026-07-08T12:14:47-05:00: Okta → Entra Migration Architecture

**Date:** 2026-07-08T12:14:47-05:00
**By:** McNulty (Lead)
**Status:** Proposed — awaiting x3nc0n approval

**What:** Architecture and decision framework for Okta → Microsoft Entra ID identity migration. Phase model: Discover → Map → Pilot/Coexistence → Cutover → Decommission. Coexistence: Okta → Entra sync (one-way, no dual-write). Source-of-truth: Okta for non-migrated, Entra per-object-class as migration completes. Federation default: Okta-as-IdP into Entra during pilot; flip to Entra-as-IdP once >50% apps migrated. Mechanism: SCIM for core lifecycle + batch sync (lib/okta + Graph) for custom attributes. **Recommended cutover default: Phased by Application** (Option B) for bounded risk, independent rollback per-app, distributed readiness. **Tooling boundary (KEY DECISION):** Official Okta MCP Server handles Okta admin/write (interactive CRUD, ad-hoc ops, policy changes, destructive ops with elicitation). `lib/okta` handles Okta read/export (bulk paginated export, mapping, reconciliation, migration-state tracking, dry-run diffing, read-only scopes only). Microsoft Graph handles all Entra writes (user provisioning, group creation, app registration, CA policy, federation). Seam rules: lib/okta has ZERO write capability; all Okta writes through MCP; neither touches Entra; MCP is stateless; lib/okta owns migration state; no duplication. Read-First / Dry-Run Gating: all destructive operations follow dry-run → human review → explicit execute → state update → audit log. Default always `--dry-run`; `--execute` explicit. 10 open questions for x3nc0n in `docs/okta-entra-migration/architecture.md` §6.

---

### 2026-07-08T12:25:37-05:00: lib/okta Contract

**Date:** 2026-07-08
**Author:** Sydnor
**Branch:** foundry-integration

**Summary:** Created `lib/okta/` as zero-dependency Node.js client (Node 18+, native `fetch` + `crypto`). All API functions return `{ok, data?, error?, status?}` structured result objects — never throw for API errors. Identical shape to `lib/graph-security`. Auth models: `ssws` (SSWS token header, dev/admin), `clientCredentials` (OAuth2 Basic auth, automated pipelines), `privateKeyJwt` (OAuth2 RS256 JWT client assertion, production/high-security). privateKeyJwt native via `crypto.createSign('RSA-SHA256')` — no JWT library. Secrets from env vars only (`OKTA_API_TOKEN`, `OKTA_CLIENT_SECRET`, `OKTA_PRIVATE_KEY`). Modules: `auth.js` (token acquisition + 5-min early-refresh cache), `users.js` (list/get/search users, groups, factors), `groups.js` (list/get groups, members, rules, apps), `apps.js` (list/get apps, SAML/OIDC settings, users, groups, keys), `policies.js` (sign-on, MFA enrollment, password, access, profile enrollment, IDP discovery policies + authenticators), `utils.js` (Link-header pagination, rate-limit backoff X-Rate-Limit-Reset, error shaping), `index.js` (createClient() factory, constants, re-exports). Read-first posture: NO write/update/delete operations. Library is for inventory and migration analysis only. Pagination: Okta uses Link headers (not OData). Rate limiting: HTTP 429 → read X-Rate-Limit-Reset → wait + jitter → retry (max 3×), falls back to exponential backoff from Retry-After header.

---

### 2026-07-08T12:25:37-05:00: Sydnor — Okta config/gate layer design + migration_profile schema

**By:** Sydnor (Platform Dev)
**For:** Kima, Carver, Graph write-side alignment

**Summary:** Built the machine-readable half of the Okta migration harness: `lib/okta/config.js` (loader/validator for `migration_profile` block in `.secops/identity/okta.yaml`), `lib/okta/schema/migration-profile.schema.json` (JSON Schema for canonical block), `lib/okta/gate.js` (config-driven gates MUST be called before any state-changing op), fixed GAP-1 in `normalizeOrgUrl` (all trailing slashes + https:// scheme injection).

**Canonical `migration_profile` schema:**
```yaml
migration_profile:
  source_of_truth:
    identity_authority: okta | hris | mixed
    hris_system: <string | null>
    per_class_ownership:
      users: okta | entra
      credentials_mfa: okta | entra
      groups: okta | entra
      app_assignments: okta | entra
      policies: okta | entra
    per_attribute_authority: []  # [{attribute, authority, notes?}]
  strategy:
    cutover_shape: big_bang | phased_by_app | phased_by_population
    group_strategy: lift_and_shift | rationalize
    federation_direction: okta_idp_into_entra | entra_idp | per_app
    mfa_strategy: reenroll_campaign | passkey_bootstrap | per_population
  execution:
    dry_run: true | false
    entra_write_tooling: microsoft_graph | entra_native | none
```

Unknown enum values → validation error with field name + invalid value + valid options listed. `per_attribute_authority` optional; all others required.

**Gate contract (all sync, never throw, return `{ok, data?, error?}`):**
- `assertEntraOwned(profile, objectClass)` — returns `{ok:true}` only if `per_class_ownership[objectClass] === 'entra'`; blocks write if still Okta-owned
- `isDryRun(profile)` → boolean — returns true if `execution.dry_run === true`
- `dryRunGuard(profile, opDescription)` — returns null (proceed) when dry_run false; returns `{ok:true, data:{dryRun:true, would:'...'}}` when dry_run true (caller short-circuits, no live call made)
- `cutoverWorkflow(profile)` → `{ok:true, data:{cutoverShape, groupStrategy, federationDirection, mfaStrategy}}` — returns declared strategy block; callers use `cutoverShape` to select workflow path (big_bang | phased_by_app | phased_by_population)

**config.js contract:** `loadMigrationProfile(filePath?)` → `{ok:true, data} | {ok:false, error}` (defaults to `<cwd>/.secops/identity/okta.yaml`, never throws). `validateProfile(profile)` → `string[]` (exported for unit testing). When absent block: `{ok:false}` tells operator to run `skills/okta/decisions/` guides.

---

### 2026-07-08T12:25:37-05:00: Decision: Okta Decision Harness + migration_profile Schema

**Date:** 2026-07-08T12:25:37-05:00
**By:** Kima
**Status:** Authored — for Scribe to merge into decisions.md

**What:** Built the complete operator-customization harness for the Okta migration framework. Reusable framework encoding the decision space — does NOT hardcode specific customer answers.

**Artifacts:** Seven Decision Guides in `skills/okta/decisions/` (README + 01-source-of-truth.md through 07-execution-gates.md). Each guide: decision statement → enum options → trade-offs → recommended default with rationale → rollback implication → exact config field written. **Canonical `migration_profile` Schema in `.secops/identity/okta.yaml`:** Added to top of okta.yaml above `orgs` block with full schema and conservative defaults (dry_run: true, all classes okta-owned). Sydnor's `lib/okta/config.js` validates this block on startup; `gate.js` enforces `dry_run` and `per_class_ownership` before every write operation.

**`skills/okta/okta-mcp-server.md` — Full Rewrite:** Rewritten from homegrown Node.js server spec into integration guide for **official Okta MCP server** (https://github.com/okta/okta-mcp-server, GA). Covers: What it is (Python/uv, official SDK, GA, performs writes), Setup (git clone + uv sync bare-metal or Docker Compose production), Auth (Device Authorization Grant interactive/local + Private Key JWT headless/CI), Tool surface (User/Group/App/Policy CRUD + System Logs; scope-based tool loading; elicitation for destructive ops), Secure credential handling (scoped access, env vars only, audit via System Log), **"When to use" boundary table** (Official MCP for interactive Okta writes vs lib/okta for bulk read/export/reconcile vs Microsoft Graph for all Entra writes), Integration with per_class_ownership gate (MCP respects declared class ownership).

**Key Principles Encoded:** (1) Framework encodes decision space, not customer answers — every guide prompts operator; nothing hardcoded. (2) Single writer per object class — per_class_ownership prevents split-brain. (3) Tooling seam is hard — MCP owns Okta writes; lib/okta owns Okta reads; Graph owns all Entra writes. No crossing. (4) dry_run: true is permanent default — must be explicitly changed to false for execute runs, then reset. (5) MFA never portable — re-enrollment unavoidable; only when and how to structure it.

**Sydnor Dependency Note:** `lib/okta/config.js` and `gate.js` must validate and enforce the `migration_profile` schema above. Enum values in this harness are canonical valid values — unknown values cause config validation failure with clear error pointing to relevant decision guide.

---

### 2026-07-08T12:25:37-05:00: Carver Review — lib/okta config/gate harness

**Date:** 2026-07-08T12:25:37-05:00
**Reviewer:** Carver (Tester/QA)
**Scope:** `lib/okta/config.js`, `lib/okta/gate.js`, `lib/okta/schema/migration-profile.schema.json`, `migration_profile` block in `.secops/identity/okta.yaml`
**New test files:** `lib/okta/config.test.js` (57 tests), `lib/okta/gate.test.js` (64 tests)
**Full suite totals:** `npm test` → **626 pass, 0 fail** (was 505 before this session)

**Verdict: PASS.** All contract obligations met. GAP-1 confirmed fixed. No gaps requiring separate fix agent.

**GAP-1 Re-verification ✓:** Two previously-intentional-failing tests in `utils — normalizeOrgUrl` now PASS: `[BUG] strips multiple trailing slashes` (→ PASS: `/\/+$/` in utils.js strips all slashes) and `[GAP-1] schemeless orgUrl should gain https:// prefix` (→ PASS: scheme guard added). **Confirmed: no assertion weakened.** Both tests carry original `assert.match` and `assert.equal` assertions with specific expected values. Implementation was fixed; tests not changed.

**What Passes ✓:** config.js: Real operator yaml loads/validates → `{ok:true, data}` ✓; error messaging for missing file, missing block; invalid enums (all 8 fields individually rejected with field name + invalid value + valid options); missing required sections (each field-named error); multi-error accumulation; per_attribute_authority validation. gate.js: assertEntraOwned all 5 classes × 2 states (10 combinations), each tested independently with blockage explanations; unknown class error; null/undefined/empty profile → `{ok:false}`. isDryRun: true, false, null, undefined, missing execution block, string "true" (falsy), number 1 (falsy) — only boolean true returns true ✓. dryRunGuard: `{ok:true, data:{dryRun:true, would:...}}` when dry_run true ✓; null when dry_run false ✓; proven not to call fetch (throw-fetch installed; no error) ✓; composability pattern ✓; live call when dry_run false ✓. cutoverWorkflow: all 3 shapes, all 4 data fields, workflow-selection switch ✓. Integration: loadMigrationProfile(real yaml) → gate chain — all 5 classes blocked (all okta-owned), dryRunGuard short-circuits, cutoverWorkflow returns declared shape ✓. entra-owned fixture: users/groups/app_assignments pass; credentials_mfa/policies blocked ✓. Contract: every config/gate path returns structured object or boolean — never throws ✓. `{ok:false}` on absent block carries actionable operator guidance ✓. Gates honor operator declared choices (config is read, not hardcoded) ✓. Tooling doesn't hardcode behavior — all gate outcomes driven by `migration_profile` values ✓. `isDryRun` accepts only boolean true; truthy strings/numbers return false ✓.

---

### 2026-07-08T12:14:47-05:00: Carver Review — lib/okta

**Date:** 2026-07-08T12:14:47-05:00
**Reviewer:** Carver (Tester/QA)
**Scope:** `lib/okta/` — zero-dependency Okta API client (Sydnor's commit)
**Test file:** `lib/okta/okta.test.js` (164 tests, 162 pass, 2 intentional failures)

**Verdict: CONDITIONAL PASS — requires coordinator sign-off on GAP-2.** The `{ok,...}` contract and rate-limit/pagination handling are both present and working. Implementation does not throw. Two gaps require attention before production-ready.

**What Passes ✓:** `{ok,...}` contract: Every network function returns structured result object. None throw. Verified by 16 dedicated no-throw assertions and 100+ individual function tests ✓. Auth header shapes: `SSWS {token}` for ssws mode; `****** for OAuth modes ✓. Rate-limit handling: HTTP 429 → reads `X-Rate-Limit-Reset` (epoch seconds), retries up to `MAX_RETRIES = 3`, returns `{ok:false, status:429}` after exhaustion ✓. Pagination: Link-header `rel="next"` cursor extracted by `extractNextLink`; list functions accept `options.nextLink` for continuation; `paginatedGet()` auto-traversal helper present; multi-page traversal test confirms 3-page accumulation ✓. Token caching + clearTokenCache: Confirmed one fetch per cached window; `clearTokenCache()` forces re-fetch ✓. All four modules (users, groups, apps, policies): Happy-path, 404/403 negatives, empty-result edge cases pass ✓.

**GAP-1 — `normalizeOrgUrl` does not add `https://` (P1 — Bug):** Location: `lib/okta/utils.js` → `normalizeOrgUrl()`. Problems: `/\/$/.` replaces exactly ONE trailing slash (https://acme.okta.com/// becomes https://acme.okta.com// — still broken); `'dev-123456.okta.com'` (no scheme) stays as-is; downstream `fetch` calls use relative URL, causing runtime crash or wrong endpoint. Evidence: Two intentional failing tests in `utils — normalizeOrgUrl`. Fix required: strip ALL trailing slashes + add https:// scheme if missing.

**GAP-2 — No write operations (P2 — Design decision, needs sign-off):** Sydnor's stated intent: `index.js` documents "READ-FIRST. Write operations (create/update/delete) intentionally absent — must be explicit and rare." Task spec referenced client "mirroring lib/graph-security" which includes write operations. Impact: Callers cannot create users, add group members, assign apps, or update policies through this library. Migration tooling needing write access must call Okta REST API directly. **Coordinator action required:** Confirm whether read-first scope acceptable given migration use-case, or whether Sydnor should add minimal write surface (at minimum: deactivate user, add/remove group member).

**No Contract Violations:** Every path returns `{ok: boolean, data?, error?, status?}` — never throws ✓. Rate-limit handling present and retries correctly ✓. Link-header pagination present and cursor-follows correctly ✓. SSWS and OAuth header formats correct ✓. This review does NOT block merge on contract grounds. GAP-1 is a bug that should be fixed; GAP-2 is a scope decision for coordinator.

---

### 2026-07-08T12:25:37-05:00: Coordinator sign-off — lib/okta is READ-FIRST by design (GAP-2 resolved)

**By:** Squad (Coordinator), on x3nc0n's architecture

**Decision:** APPROVE the read-first posture of `lib/okta`. Write operations (create/update/deactivate users, group membership changes, app assignments, policy edits) are INTENTIONALLY absent from `lib/okta`.

**Rationale:** Per the tooling-boundary decision, the **official Okta MCP server** owns interactive/admin writes on the Okta side, and **Microsoft Graph** owns writes on the Entra side. `lib/okta` is the deterministic read/extract/reconcile/dry-run complement. Adding a write surface to `lib/okta` would duplicate the official server and violate the single-writer-per-object-class continuity principle.

**Consequence:** Carver's GAP-2 is resolved as working-as-designed. Any future write need on the Okta side routes to the official MCP server, gated by the operator's declared per-class ownership config.

**Still open:** GAP-1 (normalizeOrgUrl P1 bug) must be fixed by Sydnor and re-verified by Carver.

---

## Archived Decisions

See decisions-archive.md for Foundry entries (archived 2026-07-08, all entries older than 7 days)



**Date:** 2026-06-25T19:31:35-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — awaiting McNulty approval before implementation

---

## What

Design decisions for turning the `foundry-integration` branch scaffolding into hardened runtime routing in Node.js (CommonJS).

---

## Canonical Config Location and Schema

**Decision:** `.secops/foundry.yaml` is the **only** runtime config file for Foundry. The `foundry.*` section in `secops-squad.config.json` / `secops-squad.config.schema.json` is retired to a documentation stub that says "see `.secops/foundry.yaml`".

**Field naming:** **snake_case** throughout the YAML — consistent with all other `.secops/*.yaml` files (`schema_version`, `resource_name`, etc.). The JSON config uses camelCase (`modelDeployments`) — that mismatch is the core of schema conflict #1 vs #2. Since Foundry config lives only in YAML, snake_case wins.

**Canonical schema** (`.secops/foundry.yaml`):
```yaml
schema_version: "1.0"
foundry:
  enabled: true
  resource_name: "secops-foundry"
  endpoint: "https://secops-foundry.cognitiveservices.azure.com"  # base, NO path suffix
  location: "eastus2"
  resource_group: "rg-secops-ai"
  api_version: "2025-04-01-preview"
  active_model: "claude-fable-5"
  model_deployments:
    - model_id: "claude-fable-5"
      deployment_name: "fable5-secops"
      deployment_type: "global-standard"
      provider: "anthropic"           # NEW: "anthropic" | "openai-reasoning" | "openai"
      status: "active"                # NEW: "active" | "inactive"
      api_path: "/anthropic/v1/messages"  # NEW: provider-specific REST path
      reasoning_model: false          # NEW: enables max_completion_tokens + reasoning_effort
  pricing:
    input_per_million_tokens: 10.00
    output_per_million_tokens: 50.00
    prompt_cache_discount_pct: 90
  cost_ceiling_usd: 5.00              # NEW: per-session spend guard
```

**Why this fixes the conflicts:**
- `active_model` and `model_deployments[].status` are now present — skill reader's detection code works.
- `api_version` is now at top level — o4-mini path needs it.
- `endpoint` is now a clean base URL, no path baked in — `api_path` per deployment carries the route suffix.
- `provider` field drives dispatch in `lib/foundry/index.js`.

---

## Module Layout

```
lib/foundry/
  index.js          ← public API: loadFoundryConfig(), getFoundryProvider(), isFoundryAvailable()
  config.js         ← load+validate .secops/foundry.yaml; enforces schema_version
  auth.js           ← getFoundryToken(resourceName): shell-out to az, in-memory cache (mirrors auth.js)
  telemetry.js      ← appendTelemetryRecord(record): writes to .secops/foundry-telemetry.jsonl
  providers/
    anthropic.js    ← provider=anthropic: POST {endpoint}{api_path} with Anthropic Messages API shape
    openai-reasoning.js  ← provider=openai-reasoning: POST {endpoint}/openai/deployments/{name}/chat/completions
```

**Public API surface (`lib/foundry/index.js`):**
```js
// Returns null if Foundry is disabled/unavailable
async function loadFoundryConfig(rootDir)

// Returns {complete(messages, opts)} or null
async function getFoundryProvider(rootDir)

// provider.complete(messages, opts) → {ok, content, usage, latencyMs, provider, cached}
// opts: { maxTokens, reasoningEffort, systemPrompt, costCeilingUsd }
```

**Auth (`lib/foundry/auth.js`):**
- Shell out: `az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv`
- Wrap in same `getCachedToken` / `cacheToken` pattern from `lib/graph-security/auth.js`
- Cache key: `foundry:cognitiveservices`; expiry parsed from `az account get-access-token --query expiresOn`
- Fallback: `FOUNDRY_API_KEY` env var (for CI/CD without az CLI)

---

## Dependency Strategy

**Decision: No new npm dependencies.** Call REST directly using `fetch` (Node ≥18 built-in). No `@anthropic-ai/sdk`, no `openai` package, no `@azure/identity`.

**Rationale:** The entire project has ONE dependency (`js-yaml`). Both Anthropic Messages API and Azure OpenAI are straightforward REST calls. The Python pseudo-code in the skill uses SDK wrappers as convenience, not necessity. Adding `@azure/identity` (~3MB, 15 transitive deps) for token acquisition that `az account get-access-token` already handles correctly is not justified.

---

## Telemetry Location

**Decision:** `.secops/foundry-telemetry.jsonl` (gitignored, line-delimited JSON). One record per call:
```json
{"ts":"2026-06-25T19:31:35Z","model":"claude-fable-5","provider":"anthropic","inputTokens":4200,"outputTokens":312,"cacheHit":false,"latencyMs":3400,"estimatedCostUsd":0.0573}
```
Cost ceiling enforced at call time: sum recent records from the JSONL file for the current calendar day; if sum + estimated_call_cost > `cost_ceiling_usd`, return `{ok:false, error:"daily cost ceiling reached"}` without making the API call.

---

## CLI Surface

New subcommand: `secops-squad foundry [status|test|route]` dispatched from `cli/index.js`. Module: `cli/commands/foundry.js`.

`doctor` gains a new optional check: `checkFoundry(rootDir)` — returns `pass` (enabled + reachable), `warn` (config present but `enabled:false`, or `az` not logged in), or skipped (no `.secops/foundry.yaml` at all). This check is **not** a blocker — Foundry is opt-in.

---

## Deploy Script Fix

The ARM REST API version `2026-05-15-preview` in `scripts/deploy-foundry-fable5.ps1` (line 203) is future-dated. Replace with `2025-04-01-preview` (verified current preview for CognitiveServices deployments). The written YAML must also be updated to include the new required fields (`api_version`, `active_model`, per-deployment `status`, `provider`, `api_path`, `reasoning_model`).

---

## Impact on Other Files

| File | Required change |
|------|----------------|
| `secops-squad.config.schema.json` | Remove `foundry.*` properties block; replace with `"$comment"` pointing to `.secops/foundry.yaml` |
| `.secops/foundry.yaml.example` | Rewrite to canonical schema (add `schema_version`, `api_version`, `active_model`, per-deployment `status/provider/api_path/reasoning_model`, `cost_ceiling_usd`) |
| `skills/platform/foundry-model-routing.md` | Replace Python pseudo-code with Node.js; update detection to read new schema fields; remove Anthropic/openai SDK imports |
| `scripts/deploy-foundry-fable5.ps1` | Fix API version; update `Write-FoundryConfig` to emit canonical schema |
| `scripts/deploy-foundry-fable5.sh` | Same fixes as .ps1 |
| `.gitignore` | Ensure `.secops/foundry.yaml` and `.secops/foundry-telemetry.jsonl` are ignored |



### 2026-06-25T19:35:20-05:00: Foundry Safety Gates — Required Controls Before Real Data Egress



**Date:** 2026-06-25T19:35:20-05:00
**By:** Kima (SecOps Engineer)
**Status:** Proposed — pending McNulty integration into implementation plan

---

## What

The `foundry-integration` branch wires secops-squad agents to Azure AI Foundry (Claude Fable 5 / o4-mini) for deep security analysis. The current state is **doc + scaffolding only** — the "Safety Policy" in `docs/foundry-fable5-integration.md` and `skills/platform/foundry-model-routing.md` is advisory prose. There are NO runtime safety controls: no secret scanner, no PII/IP redactor, no egress allowlist, no audit trail.

This decision specifies the **minimum enforceable controls** that must exist before any real customer data, pentest output, SARIF findings, or OT/ICS CTI is routed through Foundry.

---

## Data Classification — What May/Must Not Egress

### NEVER send to Foundry (hard block)
- Raw credentials, API keys, tokens, private keys — in any form
- Unredacted OT/ICS network topology (real IPs, hostnames, asset names of live OT environments)
- Working/weaponized exploit PoC code in executable form
- Customer PII (names, contact info, account identifiers)
- Classified or restricted threat intelligence (TLP:RED, STIX objects from closed-community feeds with distribution restrictions)
- `.secops/foundry.yaml` contents (contains endpoint and potentially API keys)

### SCRUB FIRST, then route
- SARIF findings: replace real hostnames/IPs with placeholders (`[HOST-1]`, `[IP-1]`), remove user account names
- Pentest output: summarize exploit chains, replace real targets with `[TARGET]`, omit credentials
- CTI reports (including Dragos-style OT CTI): replace org-identifying IOCs with `[ORG-IOC]`, redact sector-specific asset names
- Incident timelines: anonymize affected users and system names
- Detection rule reviews: OK if rules don't embed real asset names or credentials in hardcoded values

### OK to route as-is
- Anonymized detection logic (KQL/SPL with no real asset context)
- Generic MITRE ATT&CK / ICS MITRE mappings not tied to specific org assets
- Architecture descriptions with placeholder names
- Sanitized code snippets with no embedded secrets or real hostnames
- Publicly available threat intel (TLP:WHITE/GREEN)

---

## Required Safety Gates (Ordered by Priority)

### P0 — Must exist before any real data is sent

**Gate 1: Secret/Credential Scanner (fail-closed)**
- Checks payload for: API keys (regex patterns for common formats), private key headers (`-----BEGIN`), bearer tokens, password-like strings in structured contexts
- Implementation: `detect-secrets` or equivalent, run against the serialized payload before dispatch
- On match: BLOCK the call, log the attempt, surface error to the invoking agent — do NOT send
- Location: Pre-dispatch wrapper function that wraps every Foundry API call

**Gate 2: Audit Log (always-on, no bypass)**
- On every Foundry call (success OR blocked): write a JSONL record to `.secops/foundry-audit.jsonl`
- Required fields: `timestamp`, `actor` (git user or agent session ID), `task_type` (sarif_analysis/threat_model/etc), `payload_sha256` (SHA-256 of the payload **before** any redaction, so post-incident reconstruction is possible), `payload_size_bytes`, `model`, `endpoint`, `tokens_input`, `tokens_output`, `cost_usd_estimate`, `gate_result` (allowed/blocked), `block_reason` (if blocked)
- Do NOT log the payload itself — log the hash only
- Retention: preserve per the local `.secops/compliance/requirements.yaml` retention policy; default 730 days archive

### P1 — Must exist before production use

**Gate 3: PII/IP/Hostname Redactor (fail-closed for OT data)**
- For payloads tagged as `data_sensitivity: high` or `data_type: ot-cti`: run automated redaction before sending
- Redact: IPv4/IPv6 addresses, FQDNs, NetBIOS names, UUIDs that look like asset IDs, email addresses
- Replace with deterministic placeholders (`[IP-1]`, `[HOST-2]`) — deterministic so the analysis output can be de-aliased post-analysis
- For OT/ICS CTI payloads specifically: require explicit human-confirm before send (see Gate 4)
- Location: Redaction stage between agent payload assembly and Gate 1

**Gate 4: Human Confirm for High-Sensitivity Payloads**
- For any payload where `data_sensitivity: high` OR `data_type` is one of `[ot-cti, pentest-output, incident-data]`: pause and require explicit human approval
- Surface: "This payload contains [data_type]. It will be sent to Foundry (30-day retention). Confirm? [yes/no]"
- On 'no': abort, log to audit trail as `gate_result: user_declined`
- On 'yes': log confirmation, proceed
- Location: After redaction (Gate 3), before secret scan (Gate 1) is re-run on redacted payload

### P2 — Should exist, doesn't block launch

**Gate 5: Egress Allowlist**
- Foundry calls only permitted to the endpoint URL configured in `.secops/foundry.yaml`
- Hard-coded allowlist check: if `endpoint` doesn't match expected Foundry hostname pattern (`*.cognitiveservices.azure.com`), block
- Prevents misconfiguration from accidentally routing to a rogue endpoint
- Location: At endpoint resolution time in `foundry_model_available()`

**Gate 6: Cost Cap per Call and per Day**
- Per-call: reject if estimated input tokens > configurable threshold (default: 200K tokens)
- Per-day: reject if daily spend estimate exceeds configurable cap (default: $50/day)
- On breach: block call, log, surface alert — do NOT silently degrade to smaller model
- Location: Pre-dispatch, after payload assembly

**Gate 7: Compliance Pre-Check (required before `foundry.enabled: true` in real tenant)**
- Before setting `foundry.enabled: true`, a named compliance reviewer must sign off on:
  - 30-day cloud retention is acceptable given active regulatory frameworks in `requirements.yaml`
  - Data residency: Foundry resource is in an allowed region per `data_residency.allowed_regions`
  - No prohibited data types are expected to flow through this integration
- Sign-off recorded in `.secops/foundry-compliance-review.yaml` with reviewer, date, frameworks reviewed, and explicit approval
- Agents MUST check for this file and warn if absent when `foundry.enabled: true`

---

## OT/ICS Boundary

**Permitted (defensive):**
- Ingesting Dragos-style CTI reports → mapping to MITRE ICS techniques → generating Sentinel detection rules
- Reasoning over ICS vulnerability assessments (with asset details redacted per Gate 3)
- Lab-environment validation planning where no real asset identifiers are present
- Building OT-specific threat models from anonymized architecture descriptions

**Prohibited (offensive drift):**
- Generating OT attack chains (Modbus command sequences, DNP3 spoofing payloads, EtherNet/IP exploitation scripts)
- Enumerating live OT assets by real IP or hostname through Foundry
- Producing scripts that interact with live industrial protocols
- Using Foundry to assist in automated OT reconnaissance or lateral movement planning

The rule is: **analysis IN → defensive detections OUT**. The moment the output is an attack artifact rather than a detection artifact, it is out of scope for this integration.

---

## Compliance Interaction with 30-Day Retention

| Framework | Interaction | Required action |
|-----------|-------------|-----------------|
| PCI-DSS | Cardholder data must not leave controlled environments | Block: cardholder data context must never route to Foundry |
| HIPAA | PHI retention and access controls required | Block: PHI must never route to Foundry |
| CMMC / FedRAMP | CUI/controlled data residency and access requirements | Gate: requires explicit compliance review; likely prohibited for IL2+ |
| NIS2 | Incident data handling and third-party data processor rules | Gate: incident data requires DPIA / DPA with Microsoft |
| GDPR | 30-day retention may be acceptable; depends on DPA with Microsoft | Gate: confirm Microsoft DPA covers Foundry cognitive services as processor |
| Internal (this repo) | US data residency policy — Foundry regions must be in `allowed_regions` | Enforce: Gate 5 + Gate 7 residency check |

---

## Impact on Team

- **Freamon:** Must wrap all Foundry call generation with the Gate 1 (secret scan) and Gate 2 (audit log) functions. These are pre-dispatch hooks — Freamon doesn't write the gates, but must call through them.
- **Herc:** Logic Apps that automate Foundry routing must include gate invocations in the workflow before the Foundry action step.
- **Sydnor:** Gate implementation lives in the platform layer. Gate 1 and Gate 2 are the highest priority deliverables.
- **Carver:** Security review of the gate implementation code itself — confirm regex patterns in Gate 1 are not bypassable.

---

## Files Affected

- `skills/platform/foundry-model-routing.md` — must be updated to reference gates and link to implementation
- `docs/foundry-fable5-integration.md` — "Safety Policy" section must be replaced with gate reference (not prose)
- `.secops/foundry-audit.jsonl` — new file, created on first Foundry call (gitignored)
- `.secops/foundry-compliance-review.yaml` — new file, required before production enablement (gitignored)
- `.gitignore` — must include `foundry-audit.jsonl` and `foundry-compliance-review.yaml`



### 2026-06-25T19:31:35-05:00: Foundry Integration — Consolidated Architecture Plan



**Date:** 2026-06-25T19:31:35-05:00
**By:** McNulty (Lead)
**Status:** Approved — this is the canonical plan; supersedes individual specialist proposals

---

## 1. Executive Verdict

The `foundry-integration` branch (single commit `3f68380`, +1355 lines on branch `foundry-integration`) is **documentation and scaffolding only**. There is no executable runtime code — the "implementation" is Python pseudo-code in a Node.js project, the config schema is internally contradicted three ways, and the deploy script references a nonexistent ARM API version. The external tool's bottom-line verdict — "feasible for defensive AI-assisted analysis, not yet for production-grade model-routed orchestration" — **holds up**, but its factual claims are wrong: the branch is `foundry-integration` not `foundry-fable5`, it is ONE commit ahead of main not five, and there is NO live `.secops/foundry.yaml` on disk — the external tool hallucinated runtime config state from documentation prose. We validated this ourselves; don't trust that tool's specifics.

---

## 2. What's Missing / Not Considered

### Runtime
- No executable routing code exists (Python pseudo-code in a Node.js project)
- No provider abstraction — endpoint shape conflict between Anthropic (`/anthropic/v1/messages`) and OpenAI reasoning (`/openai/deployments/{name}/chat/completions`) unresolved at runtime
- No auth module — no token acquisition, caching, or refresh
- No fallback contract — no defined behavior for 401/404/429/timeout/ECONNREFUSED

### Config / Schema
- THREE incompatible config schemas: `secops-squad.config.schema.json` (camelCase), `.secops/foundry.yaml.example` (snake_case), and the skill's detection code (reads fields from neither)
- `active_model`, `status`, `api_version` referenced in skill detection code but absent from both schemas
- No `schema_version` field for forward compatibility

### Safety / Governance
- "Safety Policy" is prose — zero runtime enforcement
- No secret/credential scanner pre-dispatch
- No audit trail (30-day Foundry retention = exfiltration surface)
- No PII/IP redactor for OT/ICS or pentest data
- No human-confirm gate for high-sensitivity payloads
- No egress allowlist (misconfigured endpoint → data to rogue server)
- No cost cap (unbounded spend risk)
- No compliance pre-check mechanism before production enablement
- OT/ICS scope boundary is stated but not enforced

### Testing
- Zero tests for any Foundry code
- No CI workflow covering `lib/foundry/**` paths
- No fixtures for config variants (valid/disabled/malformed/partial)
- No negative test matrix (schema drift, secrets in payload, concurrent token race, etc.)

### Deploy / Ops
- ARM API version `2026-05-15-preview` is future-dated / nonexistent — script fails
- Deploy script emits incomplete YAML (missing new required fields)
- Deploy script bakes path into endpoint URL (breaks multi-provider routing)
- No `secops-squad foundry status/test/route` CLI surface
- No `doctor` check for Foundry health

### Docs
- Skill pseudo-code references `anthropic` and `openai` Python SDKs that are not (and will not be) project dependencies
- Safety policy section in `docs/foundry-fable5-integration.md` gives false confidence — it must reference enforceable gates, not advisory prose
- No deprecation notice documenting that Foundry routing is temporary (until Fable 5 reaches Copilot catalog)

---

## 3. Architecture Decisions (Made by McNulty)

### 3a. Config Casing: **snake_case**

**Decision:** All `.secops/foundry.yaml` fields use `snake_case`. The `secops-squad.config.schema.json` foundry block is retired to a pointer comment.

**Rationale:** Every other `.secops/*.yaml` file is snake_case. The JSON config's camelCase convention lives in a different namespace (`secops-squad.config.json`). Foundry config lives in YAML; YAML convention wins. **Carver: align all fixtures to snake_case immediately.**

### 3b. Single Canonical Config File

**Decision:** `.secops/foundry.yaml` is the only config file. Gitignored. Schema per Sydnor's proposal (with `schema_version: "1.0"`, per-deployment `provider`, `api_path`, `status`, `reasoning_model`, and top-level `cost_ceiling_usd`). The `.secops/foundry.yaml.example` ships committed as a template.

### 3c. Dependency Strategy: **Ratified**

**Decision:** No new npm dependencies. Use Node 18 built-in `fetch` for HTTP. Use `az account get-access-token` shell-out with in-memory cache (pattern from `lib/graph-security/auth.js`). Env var fallback `FOUNDRY_API_KEY` for CI.

**Why:** Project has ONE dep (`js-yaml`). Both Anthropic Messages API and Azure OpenAI are trivial REST shapes. No SDK justified.

### 3d. Safety Gate Call Path (Ordered)

When an agent invokes `provider.complete(messages, opts)`, this is the internal execution order inside `lib/foundry/index.js`:

```
1. Cost Cap check       (Gate 6 — reject if daily spend exceeded)
2. PII/IP Redactor      (Gate 3 — deterministic placeholder replacement)
3. Human Confirm        (Gate 4 — prompt if data_sensitivity:high; skip in non-interactive)
4. Secret Scanner       (Gate 1 — regex scan of FINAL payload post-redaction; fail-closed)
5. Egress Allowlist     (Gate 5 — validate endpoint matches *.cognitiveservices.azure.com)
6. HTTP Dispatch        (provider-specific: anthropic.js or openai-reasoning.js)
7. Audit Log            (Gate 2 — ALWAYS fires, success or blocked, hash-not-payload)
8. Telemetry Record     (latency, tokens, cost estimate → foundry-telemetry.jsonl)
```

Gate 2 (audit) fires on EVERY path — including when earlier gates block. Gates 1-5 are fail-closed: any failure = `{ok: false, error: "..."}`, never throws, never sends unredacted data.

### 3e. OT/ICS Scope Boundary (Project Rule)

**Hard rule:** The Foundry integration operates on the principle **"analysis IN → defensive detections OUT."** It is PROHIBITED to use Foundry to generate, refine, or execute OT/ICS attack artifacts (Modbus commands, DNP3 spoofing payloads, exploitation scripts, live-asset enumeration). If a Foundry response contains directly weaponizable output, the invoking agent must discard it and log a `gate_result: output_violation` audit record. This is a project-level constraint, not a per-deployment toggle.

---

## 4. Unified Phased Plan

### Phase 0 — Foundation (Config + Auth + Module Skeleton)
**Duration:** ~8 hours | **Exit criteria:** `lib/foundry/` loads config, acquires token, returns `isFoundryAvailable()` correctly; schema is unified; deploy script fixed.

| Task | Owner | Depends on |
|------|-------|-----------|
| Unify schema: write canonical `.secops/foundry.yaml.example` with all fields | Sydnor | — |
| Retire `foundry.*` from `secops-squad.config.schema.json` (pointer comment only) | Sydnor | Schema above |
| Implement `lib/foundry/config.js` (load + validate YAML, enforce `schema_version`) | Sydnor | Schema above |
| Implement `lib/foundry/auth.js` (az shell-out + env var fallback + in-memory cache) | Sydnor | — |
| Fix `scripts/deploy-foundry-fable5.ps1` and `.sh`: correct API version to `2025-04-01-preview`, emit canonical YAML fields | Sydnor | Schema above |
| Create `test/fixtures/foundry/` with 5 config variants (valid, disabled, malformed, partial, schema-drifted) — **all snake_case** | Carver | Schema above |
| Write `lib/foundry/foundry.test.js` skeleton: config loading + auth tests | Carver | config.js + auth.js |

**Merge gate:** `npm test` passes; config loads from fixture; auth returns mock token; no Python anywhere in `lib/`.

---

### Phase 1 — Safe Routing (Gates + Providers + CLI)
**Duration:** ~18 hours | **Exit criteria:** An agent can call `provider.complete()` and get a response from a mocked endpoint, with all P0 safety gates enforced and tested.

| Task | Owner | Depends on |
|------|-------|-----------|
| Implement Gate 1: secret scanner (`lib/foundry/gates/secret-scan.js`) | Kima | — |
| Implement Gate 2: audit log (`lib/foundry/gates/audit.js`) | Kima | — |
| Implement `lib/foundry/providers/anthropic.js` | Sydnor | config.js, auth.js |
| Implement `lib/foundry/providers/openai-reasoning.js` | Sydnor | config.js, auth.js |
| Implement `lib/foundry/index.js` (public API, gate orchestration per §3d) | Sydnor | All gates, both providers |
| Implement `cli/commands/foundry.js` (status / test / route) | Sydnor | index.js |
| Wire `doctor` foundry check (pass/warn/skip) | Sydnor | index.js |
| Safety gate test: PEM key + AWS key in payload → blocked | Carver | Gate 1 |
| Fallback tests: mock 401/404/429/timeout/ECONNREFUSED → `{ok:false}` | Carver | providers |
| Endpoint construction test: anthropic path vs openai-reasoning path | Carver | providers |
| Audit log test: every call (success + blocked) writes JSONL record with correct fields | Carver | Gate 2 |
| Update skill `foundry-model-routing.md`: Node.js, reference gates, remove Python | Freamon | index.js |
| Update `docs/foundry-fable5-integration.md`: replace prose safety with gate references + deprecation notice | Freamon | Gates |

**Merge gate:** All P0 quality gates pass (see §5). `npm test` ≥80% coverage on `lib/foundry/`. No unredacted secrets reach mock endpoint in any test.

---

### Phase 2 — Hardening (P1/P2 Gates + CI + Production Readiness)
**Duration:** ~12 hours | **Exit criteria:** Full gate stack, CI workflow, compliance pre-check template.

| Task | Owner | Depends on |
|------|-------|-----------|
| Implement Gate 3: PII/IP/hostname redactor (`lib/foundry/gates/redactor.js`) | Kima | — |
| Implement Gate 4: human-confirm for high-sensitivity payloads | Kima | Gate 3 |
| Implement Gate 5: egress allowlist | Kima | — |
| Implement Gate 6: cost cap (per-call + per-day from telemetry JSONL) | Sydnor | telemetry.js |
| Create `.secops/foundry-compliance-review.yaml` template (Gate 7) | Kima | — |
| Token expiry test: mock token expires in < 5m → re-acquire | Carver | auth.js |
| Create `.github/workflows/foundry-tests.yml` (path-filtered, no live Azure creds) | Herc | Tests pass locally |
| Negative/edge test matrix: oversized payload, concurrent token race, double-slash endpoint, malformed YAML, enabled:false fast-path | Carver | index.js |
| End-to-end integration test (mocked Foundry, full gate chain, asserts audit + telemetry written) | Carver | All gates |

**Merge gate:** CI green. P1 quality gates pass. Compliance template committed. Full negative matrix passes.

---

**Total estimated effort:** ~38 hours (Sydnor ~18h, Kima ~10h, Carver ~8h, Freamon ~1.5h, Herc ~0.5h)

---

## 5. Merge Bar — Definition of Done

The `foundry-integration` PR is **REJECTED** in its current form. It must not merge until ALL of the following pass:

1. ✅ `lib/foundry/` exists as Node.js/CommonJS — zero Python in `lib/`
2. ✅ `npm test` passes with ≥80% line coverage on `lib/foundry/**`
3. ✅ Config schema reconciled to snake_case; a schema-alignment test asserts field names
4. ✅ Safety gate test: payloads containing `-----BEGIN RSA PRIVATE KEY-----` or `AKIA[A-Z0-9]{16}` are blocked before HTTP dispatch
5. ✅ Fallback contract test: 401/404/429/timeout/ECONNREFUSED all return `{ok: false, error}` — never throw, never crash
6. ✅ Deploy script API version is `2025-04-01-preview` (or another VERIFIED existing version)

These six gates are non-negotiable. The PR stays open until they all pass.

---

## 6. Scope Guardrails

**NOT in scope (resist these):**

- ❌ Multi-provider abstraction beyond Anthropic + OpenAI-reasoning. Two providers is the ceiling until a third is actually needed.
- ❌ SDK dependencies (`@anthropic-ai/sdk`, `openai`, `@azure/identity`). REST + `az` is sufficient.
- ❌ Real-time streaming/SSE. Batch request/response only.
- ❌ Model fine-tuning, embeddings, or vector DB integration through Foundry.
- ❌ Automated model selection / routing intelligence. The config declares `active_model`; the runtime uses it. No LLM-decides-which-LLM patterns.
- ❌ Production monitoring dashboard. Telemetry JSONL is the interface; dashboarding is a separate concern.
- ❌ Cross-tenant / multi-workspace Foundry routing. One endpoint per config.

**Deprecation path (MUST be documented in the skill and in README):**

When Anthropic Fable 5 (or equivalent) appears in the GitHub Copilot model catalog, `lib/foundry/` and `cli/commands/foundry.js` are **deprecated immediately** and removed within one release cycle. The Foundry integration exists solely to bridge the gap between "model needed now" and "model available in Copilot catalog." It is not a permanent architectural layer.

---

## Appendix: External Tool Error Correction

| External tool claim | Reality |
|---|---|
| Branch is `foundry-fable5` | Branch is `foundry-integration` |
| 5 commits ahead of main | ONE commit (`3f68380`) |
| "Fable 5 `pending_quota` in your live config" | No `.secops/foundry.yaml` exists on disk (gitignored, never committed). Prose in docs mentions quota status — not runtime state. |
| "o4-mini active stopgap in live config" | Skill markdown mentions o4-mini as a stopgap. There is no "live config" — no YAML file exists. |
| "No executable CLI/lib runtime routing exists" | ✅ Correct. This is the actual gap. |



### 2026-06-25T19:31:35-05:00: Foundry Integration Test & Merge Quality Gates



**Date:** 2026-06-25T19:31:35-05:00
**By:** Carver (Tester/QA)
**Status:** Proposed — requires McNulty to incorporate into merge plan

## What

Formal test strategy and merge-blocking quality gates for the `foundry-integration` branch. The branch currently ships docs + scaffolding with ZERO runtime code, ZERO tests, and at least three confirmed defects:

1. **Schema mismatch** — `secops-squad.config.schema.json` uses camelCase (`modelDeployments`, `modelId`, `deploymentName`); `.secops/foundry.yaml.example` uses snake_case (`model_deployments`, `model_id`, `deployment_name`). The documented detection pseudo-code reads `active_model` and `status` fields that exist in *neither* schema.
2. **Python-only implementation** — the sole "implementation" is Python pseudo-code; the runtime is Node.js/CommonJS. Nothing is actually executable.
3. **Future-dated API version** — `deploy-foundry-fable5.ps1` targets REST API `2026-05-15-preview`, which may not exist yet.

## Decision

**Do not merge `foundry-integration` until all P0 quality gates below pass.**

### P0 Gates (merge-blocking)

- [x] `lib/foundry/` module exists in Node.js/CommonJS (NOT Python) — **COMPLETED Phase 0**
- [x] `lib/foundry/foundry.test.js` exists and `npm test` passes with ≥ 80% line coverage on the new module — **285/285 tests pass Phase 0**
- [x] Schema reconciliation: pick ONE canonical case (recommendation: camelCase to match the JSON schema and existing project conventions) and update `foundry.yaml.example`, `foundry-model-routing.md`, and any generated code to match; a schema-alignment test must assert this — **COMPLETED Phase 0 (snake_case chosen per Sydnor)**
- [ ] Safety gate test: a test that feeds a payload containing `-----BEGIN RSA PRIVATE KEY-----` (or `AKIA...` AWS key pattern) through the routing layer and asserts it is blocked/redacted *before* the HTTP call is made
- [ ] Fallback test: mock 401, 404, 429, and network timeout responses from the Foundry endpoint; assert in each case the system returns to the standard model, never crashes, and never re-throws to the caller
- [x] API version verification: either confirm `2026-05-15-preview` exists in the Azure `Microsoft.CognitiveServices` ARM provider, or replace with a version that does — **COMPLETED Phase 0 (updated to 2025-04-01-preview in deploy scripts)**

### P1 Gates (must pass within one sprint of P0)

- [ ] CI workflow `foundry-tests.yml` gating on PRs that touch `lib/foundry/**` or `.secops/foundry*`
- [x] Fixture files for all five config variants (see test strategy) — **COMPLETED Phase 0 (6 fixtures created)**
- [x] Endpoint URL construction test covering the `/anthropic/v1/` vs `/openai/deployments/` split — **COMPLETED Phase 0 (resolveEndpoint tests pass)**
- [ ] Token expiry test (mock a token that expires in < 5 minutes, assert re-acquisition) — **Partial Phase 0; caching tests pass; expiry refresh in cache logic**

## Why

Untested config parsing with known schema drift means the feature is broken on arrival. A test would have caught the camelCase/snake_case split before it was written. The safety gate is non-negotiable — sending unredacted PII through a 30-day-retention cloud endpoint is a compliance violation by design.

## Impact

- **Freamon:** ✅ COMPLETED — implemented `lib/foundry/` in Node.js/CommonJS (not Python)
- **Herc:** must wire `foundry-tests.yml` CI workflow (Phase 1)
- **McNulty:** Phase 0 gates **PASSED**; Phase 1 ready to start
- **Kima:** owns redaction spec; safety gate test implementation requires Kima's redaction rules to be codified before the test can be written (Phase 1+)

---

## Foundry Phase 0 — Implementation Record

**Date:** 2026-06-25T19:49:57-05:00
**By:** Sydnor (Platform Dev)
**Status:** Shipped on \oundry-integration\ branch; commit c7f09ec

### What Shipped

Phase 0 delivers config loading, auth, fixture files, deploy script fixes, and doc cleanup. Phase 1 (provider HTTP clients, index.js public API) is deferred.

#### Files Created

| File | Purpose |
|------|---------|
| \lib/foundry/config.js\ | Load + validate \.secops/foundry.yaml\; endpoint URL resolution |
| \lib/foundry/auth.js\ | Foundry bearer token (API key → az CLI); mirrored tokenCache pattern |
| \lib/foundry/fixtures/valid-foundry.yaml\ | Canonical config; \loadFoundryConfig\ → non-null |
| \lib/foundry/fixtures/disabled-foundry.yaml\ | \nabled: false\ → null |
| \lib/foundry/fixtures/malformed-foundry.yaml\ | Bad YAML syntax → null |
| \lib/foundry/fixtures/schema-drifted-foundry.yaml\ | Old shape (missing active_model/status) → null |
| \lib/foundry/fixtures/partial-foundry.yaml\ | Missing endpoint; returns config (not null) |
| \lib/foundry/fixtures/no-active-deployment-foundry.yaml\ | \status: pending_quota\ → null |

#### Files Updated

| File | Change |
|------|--------|
| \.secops/foundry.yaml.example\ | Rewritten to full canonical schema with comments |
| \secops-squad.config.schema.json\ | Removed \oundry\ properties block; added \\\ pointer |
| \skills/platform/foundry-model-routing.md\ | Replaced Python pseudo-code in §1 and §3 with Node.js CommonJS |
| \scripts/deploy-foundry-fable5.ps1\ | Fixed ARM api-version, base URL, full YAML output |
| \scripts/deploy-foundry-fable5.sh\ | Same fixes as .ps1 |

---

## Carver — Foundry Phase 0 QA Verdict

**Date:** 2026-06-25T20:00:50-05:00
**Author:** Carver (Tester/QA)
**Branch:** foundry-integration
**Reviewed commit:** c7f09ec

### Test Results

| File | Tests | Pass | Fail |
|------|-------|------|------|
| \lib/foundry/config.test.js\ | 34 | 34 | 0 |
| \lib/foundry/auth.test.js\ | 25 | 25 | 0 |
| **Full suite (\
pm test\)**| **285** | **285** | **0** |

### Phase 0 Exit Gate: ✅ PASS

**(a) Config loads from fixtures** — All 6 fixtures exercised; each matches contract:
- \alid-foundry.yaml\ → non-null ✔
- \disabled-foundry.yaml\ → null ✔
- \malformed-foundry.yaml\ → null ✔
- \schema-drifted-foundry.yaml\ → null ✔
- \partial-foundry.yaml\ → non-null ✔ (see Finding F-001 below)
- \
o-active-deployment-foundry.yaml\ → null ✔

**(b) Auth mocked/injectable** — \getFoundryToken({ execFn })\ injection tested across all paths, token caching verified ✔

**(c) No Python in lib/** — All code in \lib/foundry/\ is Node.js CommonJS ✔

### Bugs Found

**None.** All exported behaviors match the documented contracts.

### ⚠️ FINDING F-001: Partial config (missing endpoint) is fail-open

**Severity:** Low (Phase 1 hardening recommended)

\loadFoundryConfig()\ does not validate that \oundry.endpoint\ is present or non-empty. A config with a valid \ctive_model\ and active deployment but **no endpoint** returns non-null, which means callers believe Foundry is available. When they subsequently call \esolveEndpoint()\, the base URL is an empty string, producing broken relative URLs like \/anthropic/v1/messages\ that will fail at HTTP dispatch time.

**Phase 1 recommendation:** Add endpoint validation to \loadFoundryConfig()\:
- \if (!foundry.endpoint || typeof foundry.endpoint !== 'string' || !foundry.endpoint.startsWith('http')) return null;\
- This keeps Phase 0 unblocked but should be a P1 gate before any provider code calls \esolveEndpoint()\ in production.

### Verdict

**Phase 0: ✅ PASSES all three criteria**
- Cleared for Phase 1 work (provider dispatch in \providers/anthropic.js\ and \providers/openai-reasoning.js\)



### 2026-06-25T21:30:00-05:00: Kima — Foundry F-001 Fail-Closed Endpoint Contract

**Date:** 2026-06-25T21:30:00-05:00
**By:** Kima (Safety/SecOps)

Finding F-001 is closed by making `loadFoundryConfig()` the gate. If the resolved active Foundry config lacks a usable `foundry.endpoint` — absent, empty, whitespace-only, or normalized to empty — the loader returns `null`. No caller should treat Foundry as available until that gate passes.

`resolveEndpoint()` remains a defensive backstop. If direct callers bypass the loader with a config missing `foundry.endpoint`, it throws `Foundry endpoint is missing or empty...` instead of producing a hostless path like `/anthropic/v1/messages`.

Test contract changed:
- `lib/foundry/fixtures/partial-foundry.yaml` now expects `null`.
- F-001 regression tests assert the partial fixture fails closed, whitespace endpoints fail closed, and direct `resolveEndpoint()` calls without an endpoint throw clearly.

Validation:
- `node --test lib\foundry\*.test.js`: 60 tests, 60 pass, 0 fail.
- `npm test`: 286 tests, 286 pass, 0 fail.



### 2026-06-25T21:30:00-05:00: Sydnor — Foundry Provider Clients

**Date:** 2026-06-25T21:30:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-providers` only. No dispatch orchestrator or safety gates.

#### Function signatures

- `callAnthropic({ endpoint, apiVersion, token, apiKey, authType, deployment, payload, fetchFn, timeoutMs })`
- `callOpenAI({ endpoint, apiVersion, token, apiKey, authType, deployment, payload, fetchFn, timeoutMs })`

Both are async CommonJS exports from `lib/foundry/providers/anthropic.js` and `lib/foundry/providers/openai.js`.

#### Fallback contract

Success:

```js
{ ok: true, status: number, data: object, usage: object }
```

Failure, including HTTP 401/403/404/429, any other non-2xx HTTP status, network error, invalid URL, missing fetch, or timeout:

```js
{ ok: false, status: number, error: string }
```

For network errors and timeouts, `status` is `0` because there is no HTTP response. Provider clients do not throw for dispatch failures.

#### Header/auth choices

- Anthropic:
  - Bearer mode: `Authorization: Bearer {token}`
  - API-key mode: `x-api-key: {apiKeyOrToken}`
  - Always sends `Content-Type: application/json`, `Accept: application/json`, `anthropic-version`, and `x-ms-model-mesh-model-name` when `deployment.deployment_name` exists.
- OpenAI:
  - Bearer mode: `Authorization: Bearer {token}`
  - API-key mode: `api-key: {apiKeyOrToken}`
  - Always sends `Content-Type: application/json` and `Accept: application/json`.

Default is bearer token because `getFoundryToken()` primarily returns an Entra token. API-key auth is explicit via `apiKey`, `authType: 'api-key'`, or a token object with `{ token, isApiKey: true }` / `{ token, type: 'api-key' }`.

#### Timeout

Default timeout is 60,000 ms. Callers can override with `timeoutMs`. Timeout returns `{ ok:false, status:0, error:'Request timed out after ...ms' }`.

#### Carver test assumptions to verify

- Mock `fetchFn` receives the exact provider headers without leaking secrets to errors.
- Anthropic body maps `maxTokens` to `max_tokens` and includes `model` from `deployment.deployment_name` when omitted.
- OpenAI reasoning deployments map `maxTokens` to `max_completion_tokens` and `reasoningEffort` to `reasoning_effort`; non-reasoning maps to `max_tokens`.
- `apiVersion` is appended only when OpenAI `endpoint` lacks `api-version=`.
- Mock 401/403/404/429, ECONNREFUSED, invalid URL, and hung fetch all return `{ok:false}` and never throw.



### 2026-06-25T21:40:00-05:00: Sydnor — Foundry Dispatch Orchestrator

**Date:** 2026-06-25T21:40:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-dispatch`: `lib/foundry/index.js` only. Hook call sites defined; gate bodies intentionally not implemented.

#### Exported signatures

```js
const { getFoundryProvider, routeToFoundry } = require('./lib/foundry');

getFoundryProvider({
  rootDir,          // optional, defaults process.cwd()
  deploymentName,  // optional model_id or deployment_name override
});

await routeToFoundry({
  rootDir,          // optional, defaults process.cwd()
  deploymentName,  // optional model_id or deployment_name override
  payload,          // provider request body
  hooks,            // optional safety hook object or preDispatch array
  fetchFn,          // optional injectable fetch for tests
  execFn,           // optional injectable az exec for tests
  timeoutMs,        // optional provider timeout
});
```

`getFoundryProvider()` returns `{ok:true, config, deployment, provider, client, endpoint, modelId, deploymentName}` or `{ok:false,error,...}`. It does not acquire credentials.

`routeToFoundry()` returns the provider client result plus `{provider, modelId, deploymentName, latencyMs}` on provider success/failure, or an orchestrator `{ok:false,...}` failure. It never throws.

#### Hook contract Kima should implement against

Preferred shape:

```js
hooks: {
  preDispatch: [
    { name: 'secret-scan', run: async (ctx) => ({ ok: true }) }
  ],
  postDispatch: [
    { name: 'audit', run: async (ctx, result) => undefined }
  ]
}
```

Functions are also accepted:

```js
hooks: {
  preDispatch: [async function secretScan(ctx) { return { ok: true }; }],
  postDispatch: [async function audit(ctx, result) {}]
}
```

For shorthand, `hooks: [fn1, fn2]` means `preDispatch: [fn1, fn2]`.

##### `ctx` fields

```js
{
  rootDir,
  payload,
  provider,         // 'anthropic' | 'openai' | 'openai-reasoning'
  modelId,
  deploymentName,
  deployment,       // active deployment config entry
  endpoint,         // resolved request URL, no secrets
  apiVersion,
  timestamp
}
```

No token or API key is placed in `ctx`.

##### Pre-dispatch

- Runs in order after config/provider/auth resolution and before provider `fetch`.
- Return `undefined` or `{ok:true}` to continue.
- Return `{ok:false, reason}` to block.
- Throwing is treated as a fail-closed block.
- Block result:

```js
{ ok:false, error:'foundry-gate-blocked', gate:'secret-scan', reason:'...' }
```

##### Post-dispatch

- Runs after the final route result is known.
- Runs for auth failures, provider responses, and pre-dispatch blocks, so Audit can record both allowed and blocked attempts.
- Receives `(ctx, result)`.
- Return value is ignored.
- Throws are swallowed and warned; post hooks do not change the route result.

P0 production hooks are expected to be named `secret-scan` in `preDispatch` and `audit` in `postDispatch`. `routeToFoundry()` warns if either is absent. Current defaults are no-op for development only.

#### Deployment → provider mapping

| `deployment.provider` | Client |
|---|---|
| `anthropic` | `providers/anthropic.js::callAnthropic` |
| `openai` | `providers/openai.js::callOpenAI` |
| `openai-reasoning` | `providers/openai.js::callOpenAI` |

Missing `provider` defaults to `openai`. Any other provider returns `{ok:false,error:'foundry-provider-unsupported',provider}`.

Deployment selection:

1. If `deploymentName` is supplied, match an active deployment where `deployment_name` or `model_id` equals it.
2. Otherwise match active deployment where `model_id === foundry.active_model`.

#### `{ok:false}` error codes

| Error | Source |
|---|---|
| `foundry-not-configured` | `loadFoundryConfig(rootDir)` returned `null` |
| `foundry-deployment-not-found` | No active deployment matched active model or requested deployment |
| `foundry-provider-unsupported` | Provider not in the dispatch map |
| `foundry-provider-resolution-failed: ...` | Unexpected provider selection/endpoint failure |
| `foundry-auth-failed` | `getFoundryToken({execFn})` returned `{ok:false}` |
| `foundry-gate-blocked` | A pre-dispatch hook returned `{ok:false}` or threw |
| `foundry-route-failed` | Unexpected top-level orchestrator error |

Provider clients keep their existing fallback contract for HTTP/network/timeout failures:

```js
{ ok:false, status:number, error:string }
```

No orchestrator failure path logs secrets or throws.



### 2026-06-25T21:50:00-05:00: Kima — Foundry Safety Gates

**Date:** 2026-06-25T21:50:00-05:00
**Branch:** foundry-integration
**Scope:** P0 Foundry gates: pre-dispatch secret scan and post-dispatch audit.

#### Factory signatures

- `createSecretScanGate(opts = {})` from `lib/foundry/gates/secret-scan.js`
  - Returns `{ name: 'secret-scan', run(ctx) }`.
  - `opts.rules` can override detection rules for tests.
  - `opts.logger` can override warning output.
- `createAuditGate({ auditPath, fs, logger, nowFn } = {})` from `lib/foundry/gates/audit.js`
  - Returns `{ name: 'audit', run(ctx, result) }`.
  - `auditPath` may be absolute or relative to `ctx.rootDir`.
- `createFoundrySafetyHooks(opts = {})` from `lib/foundry/gates/index.js`
  - Returns `{ preDispatch: [secretScan], postDispatch: [audit] }`.

#### Secret scan fail-closed semantics

The secret scan serializes `ctx.payload` and scans before provider egress. If a high-confidence rule matches, it returns:

```js
{ ok: false, reason: 'secret-scan detected <rule-id> (<redacted>)' }
```

The orchestrator turns that into `foundry-gate-blocked`, so provider fetch is never reached. If serialization or scanning throws, the gate still returns `{ ok:false, reason:'secret-scan failed closed: ...' }`. The gate warns with rule/type only and a redacted indicator; it never logs the secret value. This is the kind of gate that actually catches bad payloads before they leave the box, not an audit checkbox after exfiltration.

#### Audit record schema

One JSON object per line:

- `timestamp` — ISO 8601 UTC
- `deployment` — Foundry deployment name
- `provider` — `anthropic`, `openai`, or `openai-reasoning`
- `modelId` — configured model id
- `payload_sha256` — SHA-256 of a safe serialization of the payload; never the payload
- `outcome` — `ok`, `blocked`, `auth-failed`, or `provider-error`
- `status_code` — provider HTTP status when present, else `null`
- `gate` — blocking gate name for blocked calls, else `null`
- `usage` — `{ inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens }` or `null`

Audit is post-dispatch best effort. It catches write failures, emits a warning, and must not alter route results.

#### Audit path and gitignore

Default path: `.secops/foundry-audit.jsonl` under `ctx.rootDir`. `.gitignore` now includes `.secops/foundry-audit.jsonl`.

#### Smoke checks

Runnable command:

```powershell
node lib\foundry\gates\smoke-check.js
```

It proves:

1. A payload with a fake bearer secret is blocked pre-dispatch.
2. A clean payload passes, writes exactly one audit line, and the audit contains a SHA-256 hash instead of payload text.

#### Carver test coverage needed

- Secret scan blocks AWS keys, private keys, JWTs, bearer tokens, API keys, connection strings, and contextual password/client-secret fields.
- Secret scan does not log matched secret values.
- Secret scan serialization/scanner exception still blocks (`scan throws -> still blocks`).
- Provider `fetchFn` is never called on a secret block.
- Audit writes exactly one JSONL record for success, provider error, auth failure, and gate block.
- Audit records hash-not-payload and never includes raw payload content.
- Audit write failure degrades gracefully with a warning and does not change route result.



### 2026-06-25T22:00:00-05:00: Sydnor — Foundry CLI Surface

**Date:** 2026-06-25T22:00:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-cli`: expose Foundry runtime through the existing `secops-squad` CLI.

#### Command surface

Registered command: `secops-squad foundry`

Subcommands:

- `secops-squad foundry status`
  - Calls `loadFoundryConfig(process.cwd())`.
  - Prints configured/not-configured, active model, deployment, provider, and redacted endpoint host.
  - Never prints tokens, API keys, or raw secret-bearing config.
  - Missing/disabled/invalid config fails closed with a non-zero exit code.

- `secops-squad foundry route`
  - Inputs:
    - `--prompt <text>`
    - `--file <path>`
    - `--payload <json-or-file>`
    - Optional `--deployment <model_id-or-deployment_name>`
    - Optional `--system <text>`, `--max-tokens <n>`, `--timeout-ms <n>`, `--json`
  - Prints extracted model text on success, or raw provider data when `--json` is used.
  - Prints clean `{ok:false}` error codes on failure with gate/reason/status where present; no stack traces.

#### Registration point

The command is registered in `cli/index.js` using the existing `COMMANDS` table:

```js
foundry: {
  description: "Inspect and route requests through Azure AI Foundry",
  usage: "secops-squad foundry [status|route --prompt <text>|route --file <path>|route --payload <json-or-file>]",
  module: "./commands/foundry.js",
}
```

The implementation lives in `cli/commands/foundry.js` and mirrors the existing command-module convention: `module.exports = { run }`, `process.cwd()` as root, subcommand switch, and `process.exit(1)` for CLI failures.

#### P0 safety gates

The production route path always attaches Kima's required P0 gate set:

```js
await routeToFoundry({
  rootDir,
  deploymentName,
  payload,
  hooks: createFoundrySafetyHooks(),
  timeoutMs,
});
```

`createFoundrySafetyHooks()` returns:

```js
{
  preDispatch: [secretScan],
  postDispatch: [audit],
}
```

There is no CLI flag or route branch that disables or replaces these hooks. The wrong thing should be hard.

#### Carver test asks

Carver should cover:

1. `foundry status` with no `.secops/foundry.yaml` exits non-zero and prints a fail-closed/not-configured message.
2. `foundry status` with valid config prints provider, active model, deployment, and redacted endpoint host only.
3. `foundry route --prompt ...` calls `routeToFoundry()` with `hooks.preDispatch` containing `secret-scan` and `hooks.postDispatch` containing `audit`.
4. The route subcommand cannot execute without the P0 gates; there should be no flag/path that omits `createFoundrySafetyHooks()`.
5. Route failures print clean error codes (`foundry-not-configured`, `foundry-gate-blocked`, etc.) with no stack trace and no secret values.
6. `--file` and `--payload` inputs build the expected payload and fail cleanly on unreadable files or invalid JSON.



### 2026-06-25T22:10:00-05:00: Carver — Foundry Phase 1 Verdict (FAIL — F-002 found)

**Date:** 2026-06-25T22:10:00-05:00  
**Branch:** foundry-integration  
**Reviewer:** Carver (QA/Test, reviewer authority)

#### Test Runs

- `node --test lib/foundry/**/*.test.js`: **96 tests**, 22 suites, **95 pass**, **1 fail**, 0 skipped, duration 458.0621ms.
- `npm test`: **322 tests**, 59 suites, **321 pass**, **1 fail**, 0 skipped, duration 482.6075ms.
- Coverage: `node --experimental-test-coverage --test lib/foundry/**/*.test.js` reported **82.37% line coverage** across the Foundry test target (branch 66.67%, funcs 79.59%). Coverage clears the 80% line bar, but the suite is red.

#### Six P0 Merge Gates

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

#### Findings

##### F-002 — P0 blocker — Secret-scan fail-closed path leaks exception text into returned reason

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

#### Overall Phase 1 Verdict

**FAIL.** The routing/provider/audit surface is substantially covered and F-001 is fixed, but the secret-scan fail-closed path leaks sensitive exception text and the full test suite is red. The merge bar is strict: no merge until F-002 is fixed by a different agent and `npm test` is green.



### 2026-06-25T22:20:00-05:00: Sydnor — Foundry F-002 secret-scan fail-closed redaction

**Date:** 2026-06-25T22:20:00-05:00

#### Change

Fail-closed behavior is preserved: scan exceptions still return `ok:false` and block egress.

#### Reason string

Before:
```js
`secret-scan failed closed: ${message}`
```

After:
```js
'secret-scan failed closed (<redacted>)'
```

#### Log string

Before catch-path call:
```js
warn(logger, 'scan-error')
```

Before emitted log:
```text
[foundry/secret-scan] blocked outbound payload: rule=scan-error indicator=<redacted:scan-error>
```

After catch-path call:
```js
warn(logger, `scan-error:${errorTypeOf(err)}`)
```

After emitted log for the Carver repro `Error`:
```text
[foundry/secret-scan] blocked outbound payload: rule=scan-error:Error indicator=<redacted:scan-error:Error>
```

Only the exception type/name is logged. The raw exception message/text is never interpolated into the returned reason or log output.

#### Validation

- `node --test lib\foundry\gates\secret-scan.test.js`: tests 7, suites 1, pass 7, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 95.7075
- `node --test "lib\foundry\**\*.test.js"`: tests 96, suites 22, pass 96, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 461.1062
- `npm test`: tests 322, suites 59, pass 322, fail 0, cancelled 0, skipped 0, todo 0, duration_ms 461.753



### 2026-06-25T22:30:00-05:00: Carver — Foundry Phase 1 Re-Verification (PASS — CLEARED FOR MERGE)

**Date:** 2026-06-25T22:30:00-05:00  
**Reviewer:** Carver (QA/Test)  
**Branch:** foundry-integration  
**Scope:** Re-verify F-002 fix and Phase 1 P0 merge gates after Sydnor commit `faa913b`.

#### Secret-scan fail-closed catch path

Reviewed `lib/foundry/gates/secret-scan.js` directly. Verdict: **PASS**.

- Fails closed on scanner exception: `catch` returns `{ ok: false, reason: ... }`.
- Returned reason is generic: `secret-scan failed closed (<redacted>)`.
- Returned reason does **not** interpolate `err.message` or payload content.
- Logging uses error type only: `scan-error:${errorTypeOf(err)}`.
- `errorTypeOf(err)` returns `err.name` or `Error`; it does **not** log raw exception text.

#### Test re-run evidence

Commands were run locally on `foundry-integration`; I did not trust the report.

| Command | Tests | Suites | Pass | Fail | Skipped | Todo | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| `node --test lib/foundry/gates/secret-scan.test.js` | 7 | 1 | 7 | 0 | 0 | 0 | PASS |
| `node --test lib/foundry/**/*.test.js` | 96 | 22 | 96 | 0 | 0 | 0 | PASS |
| `npm test` | 322 | 59 | 322 | 0 | 0 | 0 | PASS |

F-002 regression test status: **RESOLVED**. The test `fails closed if scanning throws and does not leak the payload secret` now passes and asserts `Bearer scanthrowsecretvalue1234567890` is absent from `result.reason` and warning logs.

#### Coverage evidence

Command: `node --experimental-test-coverage --test lib/foundry/**/*.test.js`

- Tests: 96
- Suites: 22
- Pass: 96
- Fail: 0
- Reported line coverage: **82.36% all files**
- This clears the Phase 1 merge bar requiring `lib/foundry` coverage >=80%. Barely, but it clears. Coverage is a floor, not a trophy.

#### Six P0 merge-gate verdict

| Gate | Requirement | Verdict | Evidence |
|---:|---|---|---|
| 1 | `lib/foundry/` exists as Node.js/CommonJS; zero Python in `lib/` | PASS | `lib/foundry` implementation is Node.js/CommonJS; `lib/**/*.py` search found no files. |
| 2 | `npm test` passes with >=80% line coverage on `lib/foundry/**` | PASS | `npm test`: 322/322 pass. Coverage run: 82.36% line coverage. |
| 3 | Config schema reconciled to snake_case; schema-alignment test asserts field names | PASS | Foundry suite includes schema-alignment regression tests; `node --test lib/foundry/**/*.test.js`: 96/96 pass. |
| 4 | Safety gate test blocks private key / AWS key payloads before HTTP dispatch | PASS | Secret-scan suite: 7/7 pass, including AWS key and private-key blocking/redaction. Route tests confirm pre-dispatch hooks block before egress. F-002 regression also passes. |
| 5 | Fallback contract test: 401/404/429/timeout/ECONNREFUSED-style network rejection returns `{ok:false,error}`; no throw/crash | PASS | Provider fallback tests for Anthropic and OpenAI pass in the Foundry suite: HTTP 401/403/404/429, network rejection, and timeout. |
| 6 | Deploy script API version is verified/current (`2025-04-01-preview`) | PASS | `scripts/deploy-foundry-fable5.ps1` and `.sh` use `2025-04-01-preview`; no `2026-05-15-preview` remains in those scripts. |

#### Findings

No new findings. F-002 is resolved.

#### Overall verdict

**Phase 1: PASS. CLEARED FOR MERGE.**

Carver note: the coverage bar is met, not generous. Do not let future Foundry code land without keeping this above the floor.
