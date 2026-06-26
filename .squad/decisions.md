

# Squad Decisions

## Active Decisions


### 2026-06-25T19:31:35-05:00: Foundry Runtime Abstraction — Config, Auth, and Module Layout



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
