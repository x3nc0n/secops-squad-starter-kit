# Squad Decisions Archive

## Archived Decisions (older than 7 days)

### 2026-06-25T19:31:35-05:00: Foundry Runtime Abstraction — Config, Auth, and Module Layout

**Date:** 2026-06-25T19:31:35-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — awaiting McNulty approval before implementation

**Summary:** Design decisions for turning the `foundry-integration` branch scaffolding into hardened runtime routing in Node.js (CommonJS). Canonical config location is `.secops/foundry.yaml` using snake_case. Module layout covers `lib/foundry/` with index, config, auth, telemetry, and provider abstractions. Auth uses Azure CLI shell-out with caching. No new npm dependencies — call REST directly using `fetch` (Node ≥18 built-in). Telemetry writes to `.secops/foundry-telemetry.jsonl`.

---

### 2026-06-25T19:35:20-05:00: Foundry Safety Gates — Required Controls Before Real Data Egress

**Date:** 2026-06-25T19:35:20-05:00
**By:** Kima (SecOps Engineer)
**Status:** Proposed — pending McNulty integration into implementation plan

**Summary:** Specifies 7 minimum enforceable safety gates (P0/P1/P2) required before real customer data, pentest output, SARIF findings, or OT/ICS CTI routes through Foundry. Core gates: secret/credential scanner (P0, fail-closed), audit log (P0, always-on), PII/IP/hostname redactor (P1, fail-closed for OT), human confirm (P1, high-sensitivity payloads), egress allowlist (P2), cost cap (P2), compliance pre-check (P2). Data classification: never send raw credentials/PII/unredacted OT topology; scrub SARIF/pentest/CTI before routing; OK to route anonymized logic/MITRE mappings/public threat intel. OT/ICS boundary enforced: analysis IN → defensive detections OUT only.

---

### 2026-06-25T19:31:35-05:00: Foundry Integration — Consolidated Architecture Plan

**Date:** 2026-06-25T19:31:35-05:00
**By:** McNulty (Lead)
**Status:** Approved — this is the canonical plan; supersedes individual specialist proposals

**Summary:** Foundry integration architecture (foundry-integration branch, single commit) is documentation and scaffolding only — no executable runtime code. Missing: runtime routing (Python pseudo-code in Node.js project), provider abstraction (endpoint shape conflict), auth module, fallback contract, config schema (three incompatible schemas), safety/governance runtime enforcement, testing (zero tests), deploy ops (future-dated API version), docs (Python SDK references, prose-only safety policy). Decisions made by McNulty: (1) config casing is snake_case (YAML convention wins over JSON), (2) single canonical config file is `.secops/foundry.yaml`, (3) auth via Azure CLI with fallback to env var, (4) no new npm dependencies, (5) telemetry to JSONL with daily cost ceiling enforcement, (6) CLI surface via new `secops-squad foundry` subcommand + `doctor` check, (7) deploy script API version fixed to `2025-04-01-preview`, (8) impact on 9 files documented.

---

### 2026-06-25T19:31:35-05:00: Foundry Integration Test & Merge Quality Gates

**Date:** 2026-06-25T19:31:35-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — pending Carver implementation

**Summary:** Quality gate framework for Foundry integration branch. Requires: (1) lint pass (ESLint), (2) all config fixtures validated (valid/disabled/malformed/partial schemas), (3) secrets scan (detect-secrets), (4) no hardcoded credentials in any examples, (5) auth module token caching verified, (6) cost cap enforcement tested with mock payloads, (7) docs pass spell-check and link validation, (8) safety gate code audited by Carver. Blocking issues: config schema not yet executable, auth module not yet written, safety gate implementation not started. Unblocking path: McNulty's architecture decision (above) resolves schema conflicts. Gate implementation (Kima/Sydnor) follows.

---

### 2026-06-25T19:31:35-05:00: Kima — Foundry F-001 Fail-Closed Endpoint Contract

**Date:** 2026-06-25T19:31:35-05:00
**By:** Kima (SecOps Engineer)
**Status:** Proposed — for architect review

**Summary:** Defines fail-closed endpoint contract for Foundry. The endpoint URL in `.secops/foundry.yaml` must match the expected Foundry hostname pattern (`*.cognitiveservices.azure.com`). Hard-coded allowlist check prevents misconfiguration from routing to rogue endpoint. Fallback contract when endpoint is unreachable: return `{ok:false, error:"endpoint unreachable"}` without trying alternate provider or degrading to smaller model. Audit trail required for every endpoint access attempt. No automatic failover — fails loud with diagnostic message.

---

### 2026-06-25T21:30:00-05:00: Sydnor — Foundry Provider Clients

**Date:** 2026-06-25T21:30:00-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — for architecture review

**Summary:** Provider client abstraction for Foundry. Two provider types: Anthropic (POST to `/anthropic/v1/messages`) and OpenAI reasoning (POST to `/openai/deployments/{name}/chat/completions`). Each provider client handles: auth header injection (Bearer token), request shaping per API (messages format, system prompt handling), response extraction (content/usage/latency), rate-limit retry (429 back-off), timeout handling (30s default). No dependency on SDK packages. REST call via native `fetch` only. Provider selection driven by `model_deployments[].provider` field in config.

---

### 2026-06-25T21:40:00-05:00: Sydnor — Foundry Dispatch Orchestrator

**Date:** 2026-06-25T21:40:00-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — for architecture review

**Summary:** Dispatch orchestrator routes messages to the appropriate Foundry provider. Input: messages array + config profile. Process: (1) validate config loaded, (2) read `active_model` field, (3) lookup model in `model_deployments[]`, (4) extract provider type, (5) invoke provider client, (6) append telemetry record, (7) return `{ok, content, usage, latencyMs, provider, cached}` result. Handles: token caching (check auth module first, acquire if expired), cost ceiling check (block if daily spend + estimated call > ceiling), dry-run mode passthrough (if dry_run mode configured, short-circuit with `{ok:true, would:"..."}` and no API call).

---

### 2026-06-25T21:50:00-05:00: Kima — Foundry Safety Gates

**Date:** 2026-06-25T21:50:00-05:00
**By:** Kima (SecOps Engineer)
**Status:** Proposed — implementation ownership TBD

**Summary:** Implementation notes for Foundry safety gates. Gate 1 (secret scanner): run `detect-secrets` regex patterns against serialized payload before dispatch; on match, block and log to audit trail with field name and pattern matched. Gate 2 (audit log): write JSONL record to `.secops/foundry-audit.jsonl` with: timestamp, actor (git user or agent session ID), task_type, payload_sha256 (SHA-256 of pre-redaction payload), payload_size_bytes, model, endpoint, tokens_input/output, cost_usd_estimate, gate_result (allowed/blocked/user_declined), block_reason. Gate 3 (redactor): for high-sensitivity or OT payloads, redact IPv4/IPv6, FQDNs, NetBIOS names, UUIDs, email addresses with deterministic placeholders. Gate 4 (human confirm): for OT/pentest/incident payloads, pause and require explicit human approval before send. Gates 5-7 (allowlist, cost cap, compliance pre-check) are detection-only in initial release.

---

### 2026-06-25T22:00:00-05:00: Sydnor — Foundry CLI Surface

**Date:** 2026-06-25T22:00:00-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — for architecture review

**Summary:** New CLI subcommand `secops-squad foundry [status|test|route]`. Status: check if `.secops/foundry.yaml` exists, is valid, and endpoint is reachable; report active model and provider type. Test: run a small diagnostic message through the active model; report latency and token usage. Route: show the currently configured provider routing (active_model → provider type → endpoint path). Also: extend `doctor` command with new `checkFoundry(rootDir)` check that returns pass (enabled + reachable), warn (config present but disabled, or az CLI not logged in), or skipped (no config file). Foundry health check is not a blocker — Foundry is opt-in.

---

### 2026-06-25T22:10:00-05:00: Carver — Foundry Phase 1 Verdict (FAIL — F-002 found)

**Date:** 2026-06-25T22:10:00-05:00
**By:** Carver (Tester/QA)
**Status:** Blocking — requires remediation

**Summary:** Phase 1 security review of `foundry-integration` branch identified F-002: secrets in codebase. Finding: `.secops/foundry.yaml.example` contains placeholder values `REPLACE_ME`, but `secrets/foundry-example.env` contains actual (but redacted) format strings with key material pattern leakage. Additionally, deploy script `.ps1` file has hardcoded Azure resource group name and subscription placeholder that looks like it could be copy-pasted with real values, creating injection risk. Verdict: FAIL. Requirement: implement detect-secrets scanning in CI before merge. Implement `.gitignore` rules for `*.env` and `.secops/foundry-audit.jsonl` + `.secops/foundry-compliance-review.yaml`.

---

### 2026-06-25T22:20:00-05:00: Sydnor — Foundry F-002 secret-scan fail-closed redaction

**Date:** 2026-06-25T22:20:00-05:00
**By:** Sydnor (Platform Dev)
**Status:** Proposed — implementation in progress

**Summary:** Remediation for F-002 (secrets in codebase). Actions: (1) implement pre-dispatch secret scanner in `lib/foundry/index.js` — wrapper function that runs `detect-secrets` patterns on every payload before Foundry API call; on match, log to audit trail and return `{ok:false, error:"payload contains suspected secret pattern: [pattern name]"}`; (2) update `.gitignore` to block `*.env`, `.secops/foundry-audit.jsonl`, `.secops/foundry-compliance-review.yaml`; (3) rewrite `.secops/foundry.yaml.example` to remove all format string leakage, use only clearly-marked PLACEHOLDER comments; (4) update deploy scripts to not contain subscription/resource group names — use env vars only.

---

### 2026-06-25T22:30:00-05:00: Carver — Foundry Phase 1 Re-Verification (PASS — CLEARED FOR MERGE)

**Date:** 2026-06-25T22:30:00-05:00
**By:** Carver (Tester/QA)
**Status:** Approved — foundry-integration branch cleared for merge

**Summary:** Phase 1 re-verification after F-002 remediation. Checks: (1) secret scan patterns implemented and tested (✓), (2) detect-secrets baseline created and integrated into CI (✓), (3) `.gitignore` updated and secrets previously in repo purged (✓), (4) `.secops/foundry.yaml.example` rewritten without format string leakage (✓), (5) deploy scripts updated to use env vars only (✓), (6) lint pass (✓), (7) config fixtures validated (✓), (8) safety gate code audited for regex bypassability (✓). Verdict: PASS. Blocking issues resolved. Branch is cleared for merge to main with advisory that Foundry feature is opt-in (disabled by default) and runtime implementation work continues on feature branches.

---

## Archived Decisions (older than 7 days)

### 2026-04-28T09:16:43-05:00: Team composition and role assignments

**By:** Sydnor (on behalf of the squad)

**What:** The secops-squad team is composed of 8 members from The Wire universe, each with distinct SecOps responsibilities:
- **McNulty** (Lead) — architecture, scope, code review
- **Kima** (SecOps Engineer) — Microsoft Security products, threat hunting, detection engineering
- **Freamon** (KQL Engineer) — KQL queries, Log Analytics, Azure Data Explorer
- **Herc** (Automation/SOAR) — Logic Apps, Azure Functions, SOAR workflows
- **Sydnor** (Platform Dev) — templates, CLI, framework, CI/CD
- **Carver** (Tester/QA) — validation, testing, quality gates
- **Scribe** (Session Logger) — logging, decisions, memory management
- **Ralph** (Work Monitor) — work tracking, circuit breaking

**Why:** Clear role separation ensures each domain has a dedicated specialist. SecOps work spans detection engineering, query authoring, automation, and platform tooling — each requires distinct expertise. Reviewer authority is shared between McNulty (architecture) and Carver (quality).

### 2026-04-28T09:16:43-05:00: secops-squad Framework Architecture

**By:** McNulty (Lead)

**Decision:** The core product is a skills-first architecture modeled after bradygaster/squad, specialized for Microsoft Security products, KQL engineering, Logic Apps automation, Log Analytics workspace management, and Azure Data Explorer integration.

**Key Architectural Choices:**
1. **Skills-First Architecture** — Markdown skill files categorized by domain (`skills/kql/`, `skills/soar/`, `skills/detection/`, `skills/log-analytics/`, `skills/adx/`, `skills/msft-security/`)
2. **Persona-Driven Onboarding** — Pre-built team configurations installable via `secops-squad init` (initial set: `soc-analyst`, `detection-engineering`, `threat-hunting`, `cloud-security`, `incident-response`, `full-soc`)
3. **KQL Files Are CI-Validated** — Every `.kql` file syntax-validated on PR. Carver owns the quality gate.
4. **Every SOAR Skill Requires a Rollback Plan** — No Logic Apps playbook ships without `destroy.ps1` and documented undo procedure
5. **CLI Extends Squad** — `secops-squad` CLI wraps `@bradygaster/squad-cli`; security-specific commands are additive
6. **Azure Discovery Is Non-Blocking** — Init completes with placeholder config if discovery fails; users can connect later
7. **Threat Model Required for Every Detection** — `detection-engineering` persona enforces threat-model-session ceremony; McNulty gates review
8. **MITRE ATT&CK Tagging Mandatory** — Every detection/KQL skill maps to ATT&CK technique IDs (machine-readable YAML frontmatter)

**Owners of Key Areas:**
- KQL skills + ADX skills: Freamon
- SOAR skills + Bicep templates: Herc
- Detection skills + Microsoft Security skills: Kima
- Log Analytics skills: Freamon + Kima
- CLI + install script: Sydnor
- KQL validation harness + testing: Carver
- Architecture + persona design: McNulty
- Session logging + decisions: Scribe

**Phase 1 Exit Criteria:** Working init wizard, `soc-analyst` persona, 3 KQL skills, 3 SOAR skills, KQL validation CI, getting-started docs. Target: New user → working SecOps team with KQL hunting and phishing response in ≤ 15 minutes.

### 2026-04-28T12:01:11-05:00: KQL Validator Library Design

**By:** Freamon (KQL Engineer)

**Status:** Implemented

**What:** Built `lib/kql-validator/` — offline KQL syntax validation with 4 modules (index, parser, reporter, operators). ~60 operators, 250+ functions, ~50 Sentinel/Defender tables. 56/57 tests passing.

**Key Choices:**
- Offline-only (no Azure workspace connectivity)
- Error vs Warning distinction (= in where clause is error; project * is warning)
- Where-clause scoping prevents false positives on join patterns
- Markdown extraction supports both ````kql` and ````kusto` blocks
- CommonJS modules, zero dependencies

**Why:** CI pipeline requires KQL validation on every PR. CLI command `secops-squad kql validate` needs a library to call.

### 2026-04-28T14:08:04-05:00: ADX Table Schemas Use Staging + Update Policy Pattern

**By:** Herc (Automation/SOAR)

**What:** All ADX security tables use two-table ingestion: `*_Raw` staging table receives raw JSON, update policy transforms to structured target table.

**Impact:**
- Freamon: ADX skills and queries target structured tables (SecurityEvents, NetworkTraffic, etc.), not `*_Raw`
- Kima: Detection rules via `adx()` proxy use structured table names
- All: Adding new columns requires updating KQL scripts in `templates/bicep/adx/scripts/`

**Why:** Allows schema evolution without breaking ingestion pipelines. New columns can be added to transform query without re-creating data connections.

### 2026-04-28T12:34:12-05:00: Persona Template Architecture and Character Assignments

**By:** McNulty (Lead)

**Status:** Active

**What:** All 6 personas are self-contained, installable team configurations with no cross-persona dependencies. Each uses unique Wire characters with thematic alignment:
- soc-analyst: Bunk, Kima, Freamon, Daniels
- detection-engineering: Daniels, Lester, Prop Joe, Landsman
- threat-hunting: Omar, Slim Charles, Bubbles, Rhonda
- cloud-security: Avon, Stringer, D'Angelo
- incident-response: Rawls, Sydnor, Beadie, Prez
- full-soc: Bunny Colvin, Bodie, Poot, Carver, Herc, Cutty, McNulty, Lester

**Key Choices:**
1. Self-contained — each installs complete working team with no external dependencies
2. Consistent format — all follow 5-file structure from soc-analyst
3. Skill references forward-compatible — reference Phase 2 skills to be created
4. Full-SOC is additive — shows integration, not concatenation
5. Ceremonies domain-specific

**Why:** Users pick any persona and get working team immediately.

### 2026-04-28T14:08:04-05:00: Structured Result Objects for API Libraries

**By:** Sydnor (Platform Dev)

**Status:** Proposed

**What:** All API-wrapping libraries return structured result objects instead of throwing exceptions:
```javascript
// Success: { ok: true, data: ..., nextLink?: string }
// Failure: { ok: false, error: string, status?: number, code?: string }
```

**Why:** SOC automation runs unattended in Logic Apps and Functions. Thrown exceptions cause silent failures. Structured results force explicit error handling, make context available, compose cleanly in async pipelines.

**Scope:**
- Applies to all `lib/*/` API wrapper modules
- Does NOT apply to CLI commands (use `fatal()`)
- `createClient()` may throw for invalid config (programmer error)

**Established in:** `lib/graph-security/` (Carver's test suite validates pattern)

# Decision: Advanced Hunting API & KQL Query Builder Skills

**Date:** 2026-04-30T17:40:42-05:00
**By:** Freamon (KQL Engineer)
**Status:** Implemented
**Requested by:** Jose

## What

Created two new skill documents:

1. **`skills/detection/advanced-hunting-api.md`** (336 lines) ΓÇö Comprehensive API reference for MDE, XDR, and Graph Advanced Hunting endpoints, including Live Response session management, custom detection rule creation, query packs, and MITRE ATT&CKΓÇômapped hunting patterns (Initial Access through Exfiltration).

2. **`skills/kql/query-builder.md`** (408 lines) ΓÇö KQL template engine with `{{parameter}}` substitution, conditional/iteration blocks, pre-built SecOps templates, 4-tier validation (syntax via `lib/kql-validator/`, schema via `data-source-map.yaml`, performance pattern detection, injection prevention), optimization guidance (filter-first, materialize, partition, string operator hierarchy), and cross-platform differences.

## Key Design Choices

1. **API skill in `detection/`, not `kql/`** ΓÇö The API endpoints, Live Response, and custom detections are detection infrastructure, not query authoring. KQL patterns stay in `kql/`.
2. **Template syntax uses `{{...}}`** ΓÇö Lightweight, Handlebars-inspired syntax that doesn't conflict with KQL's `{ }` braces.
3. **4-tier validation** ΓÇö Syntax ΓåÆ Schema ΓåÆ Performance ΓåÆ Security, from cheapest to most expensive check.
4. **Cross-references, not duplication** ΓÇö Both skills link to `defender-xdr-hunting.md`, `defender-api-wrapper.md`, `threat-hunting-foundations.md` for existing coverage.
5. **GCC-High awareness** ΓÇö PowerShell wrappers check `environment.yaml` cloud field and swap endpoints for government clouds.

## Impact

- **Kima:** Can reference `advanced-hunting-api.md` for custom detection rule API patterns
- **Herc:** Live Response forensic collection patterns complement SOAR playbook triggers
- **Carver:** `Test-SecOpsKqlPerformance` rules can feed into CI validation pipeline
- **All agents:** `Get-SecOpsQueryTarget` auto-routes queries to correct API surface based on `.secops/` data-source-map

# Decision: Compliance & Workbook Automation Skill Architecture

**Date:** 2026-04-30T17:40:42-05:00
**By:** Herc (Automation/SOAR)
**Status:** Implemented

## What

Created two new SOAR skills establishing compliance automation and workbook lifecycle management:

1. **`skills/soar/compliance-framework-mappings.md`** ΓÇö Maps Microsoft controls (Defender for Cloud, Secure Score, Sentinel analytics, Purview DLP) to 6 regulatory frameworks (NIST 800-53 R5, CIS v8, PCI-DSS v4, HIPAA, SOC 2, ISO 27001:2022). Includes automated assessment pipelines, gap analysis, and evidence collection.

2. **`skills/soar/workbook-automation.md`** ΓÇö Programmatic workbook CRUD via Azure REST API, ARM/Bicep deployment templates, CI/CD pipeline patterns, multi-workspace deployment from `.secops/` config.

## Key Choices

1. **Defender for Cloud as compliance source of truth** ΓÇö All frameworks map to `Get-AzSecurityRegulatoryComplianceStandard` API. This is the only Microsoft API that natively provides framework-to-control mappings.

2. **`.secops/compliance/requirements.yaml` drives assessment scope** ΓÇö Only frameworks listed in `.secops/` get assessed. No hardcoded framework lists.

3. **Structured result pattern for workbook CRUD** ΓÇö All `New-`/`Get-`/`Update-`/`Remove-SentinelWorkbook` functions return `@{ ok = $true/false; data/error }` per Sydnor's decision.

4. **CI/CD via GitHub Actions** ΓÇö Workbook JSON stored in repo, deployed on merge via `azure/powershell@v2`. Idempotent PUT operations.

5. **Multi-workspace deployment reads `.secops/workspaces/`** ΓÇö Workbooks deploy to all configured workspaces with data residency checks against `prohibited_regions`.

## Impact

- **Kima:** Detection rules can reference compliance control IDs from the mapping tables
- **Freamon:** KQL queries in workbook items follow same syntax as standalone hunting queries
- **Carver:** Can validate workbook JSON structure and compliance report outputs
- **Sydnor:** CI/CD pipeline pattern can be added to `secops-squad` CLI as `secops-squad workbook deploy`

## Why

SOC teams need compliance dashboards and audit evidence on demand, not after weeks of manual work. These skills make compliance posture visible in real-time and workbook deployment a one-command operation.

# Decision: Copilot for Security + Defender for Cloud Apps Skill Architecture

**Date:** 2026-04-30T17:40:42-05:00
**Author:** Kima (SecOps Engineer)
**Requested by:** Jose
**Status:** Proposed

## What

Created two new skills in `skills/msft-security/`:

1. **`copilot-for-security.md`** ΓÇö Copilot for Security integration covering SCU capacity, plugins, custom plugins, promptbooks, REST API, and agent integration patterns
2. **`defender-cloud-apps.md`** ΓÇö MDCA CASB coverage including Cloud Discovery, OAuth app governance, 6 policy types, full REST API reference, Conditional Access App Control, and SIEM integration

## Key Design Decisions

### 1. Copilot API Session Reuse Pattern
Sessions preserve conversation context. Agents should create one session per investigation and reuse it across multiple prompts rather than creating new sessions per prompt. This saves SCU consumption and improves response quality through accumulated context.

### 2. MDCA API Token Authentication (Not OAuth)
MDCA's REST API uses portal-generated API tokens (`Authorization: Token <value>`), not OAuth2 flows. This is a different auth pattern from all other Defender APIs. Agents must handle this distinction when building multi-product workflows.

### 3. Structured Result Pattern Applied
Both skills' PowerShell wrappers (`Invoke-CopilotWithRetry`, `Invoke-MdcaApiWithRetry`) follow Sydnor's structured result pattern (`{ok: true/false, data/error}`), consistent with all other API-wrapping code in the project.

### 4. New MITRE Techniques Added to Coverage
These skills introduce 5 MITRE techniques not previously covered: T1071 (Application Layer Protocol), T1199 (Trusted Relationship), T1537 (Transfer Data to Cloud Account), T1550 (Use Alternate Authentication Material), T1567 (Exfiltration Over Web Service). The MITRE coverage map should be updated.

## Impact

- **Freamon:** Can reference MDCA tables (`McasShadowItReporting`, `CloudAppEvents`) in KQL skills
- **Herc:** SOAR playbooks can call Copilot API for incident enrichment and MDCA API for governance actions
- **Carver:** Should validate MITRE coverage map update with new techniques
- **All agents:** Can use Copilot for Security as enrichment layer in investigation workflows

## Why

These two products were identified in the platform coverage gap analysis as critical gaps: Copilot for Security is the AI augmentation layer for all SOC operations, and MDCA covers the CASB/Shadow IT domain that no existing skill addresses.

# Decision: eDiscovery & Purview API Wrapper Skills

**Date:** 2026-04-30T17:40:42-05:00
**Author:** Kima (SecOps Engineer)
**Requested by:** Jose
**Status:** Implemented

## What

Created two new comprehensive skill documents in `skills/msft-security/`:

1. **`ediscovery-api-wrapper.md`** ΓÇö Full eDiscovery API integration covering Graph `/security/cases/ediscoveryCases` hierarchy, case CRUD, custodian management, legal hold, KQL-based content search, review sets, export operations, and production PowerShell wrappers.

2. **`purview-api-wrapper.md`** ΓÇö Purview API surface covering information protection (sensitivity labels), DLP alerts/policies, data classification (SITs, EDM, trainable classifiers), records management, insider risk alerts, Unified Audit Log (3 access methods), Compliance Manager, and production PowerShell wrappers.

## Key Design Decisions

1. **Scope separation from purview-dlp-patterns.md** ΓÇö The existing skill covers DLP policy *design* (taxonomy, endpoint config, SIT patterns). The new purview-api-wrapper covers programmatic *API access* for agent automation. No content duplication.

2. **Structured result pattern** ΓÇö All wrapper functions return `{ok, data}` / `{ok: false, error}` per Sydnor's decision on structured result objects.

3. **Multi-API auth awareness** ΓÇö Documented that Purview's API surface is fragmented across Graph, IPPSSession, EXO, and Management API. Agents must manage multiple authentication contexts.

4. **`.secops/` integration** ΓÇö Both skills reference `compliance/requirements.yaml` for retention constraints and `identity/tenants.yaml` for multi-tenant topology.

## Why

- No programmatic eDiscovery coverage existed in the skills library
- Existing Purview skill (purview-dlp-patterns.md) was design-only, no API wrappers
- Incident response workflows (phishing, insider threat, compliance) require eDiscovery automation
- Data governance lifecycle (classify ΓåÆ label ΓåÆ protect ΓåÆ audit) needs API-driven agent support

## Impact

- **Freamon:** Can reference audit log query patterns when building KQL for compliance-related detection rules
- **Herc:** SOAR playbooks can call eDiscovery wrapper functions for automated evidence collection
- **All agents:** Purview API wrapper provides compliance posture monitoring for weekly agent-driven checks

### 2026-04-30T15:05:29-05:00: Customer Knowledge Framework (.secops/) and Platform Gap Priorities



**By:** McNulty (Lead)



**Status:** Proposed



**Requested by:** Jose Paid



**What:** Two decisions for team review:



1. **Customer Knowledge Framework** — Proposed `.secops/` directory structure for environment-specific knowledge:

   - YAML format for human-editability + machine-parseability

   - Gitignored by default (contains environment-specific data like workspace IDs, tenant IDs)

   - Separate from `.squad/` — framework internals vs. customer environment

   - Auto-discovery pattern — agents append to `discovery-log.yaml`, human review before promotion

   - Key files: `environment.yaml`, `data-sources/data-source-map.yaml`, `workspaces/*.yaml`, `alerting/routing.yaml`



2. **Platform Gap Priorities — New Skill Domains** — Four new skill domains proposed (all Critical priority):

   - `skills/powershell/` — Az.SecurityInsights, Az.OperationalInsights (SOC engineers are PS-first, zero coverage today)

   - `skills/mcp/` — Sentinel MCP Server integration (agents can't execute KQL without this)

   - `skills/azure-monitor/` — Action Groups, Alert Rules, Workbooks (operational alerting backbone)

   - `skills/entra-id/` — Conditional Access as code, PIM automation (daily SOC operations)



**Why:** 16 critical gaps identified across Microsoft's security platform. No PowerShell module skills despite target audience being PS-first. Agents write KQL but can't execute it (no MCP integration). Customer environments are invisible to agents. MSSP/multi-tenant scenarios completely unaddressed.



**Impact:**

- **Kima:** Owns new `msft-security` gaps (MDE APIs, Defender for Cloud Apps)

- **Freamon:** Owns new `kql/resource-graph-hunting.md`, data tiering skills, Query API skill

- **Herc:** Owns Azure Monitor skills (action groups, alert rules)

- **Sydnor:** Owns `.secops/` scaffolding in CLI (`secops-squad env init`), config schema extension

- **All agents:** Must learn to consult `.secops/` before making environment assumptions



**Full Analysis:** See `docs/platform-coverage-gap-analysis.md`



### 2026-04-30T16:42:00-05:00: .secops/ Customer Knowledge Framework — Schema v1.0



**By:** Sydnor (Platform Dev)



**Status:** Proposed



**Blocks:** All Phase 1 downstream work (skills integration, agent routing, CLI env commands)



**What:** Created the `.secops/` directory as the customer-specific environment knowledge framework for secops-squad. Foundational schema that all agents, skills, and CLI commands depend on for environment-aware operations.



**Structure:**

```

.secops/ (16 files across 6 subdirectories)

├── README.md + environment.yaml

├── workspaces/    (README.md + example-workspace.yaml)

├── data-sources/  (README.md + data-source-map.yaml + migrations.yaml)

├── identity/      (README.md + tenants.yaml + rbac-conventions.yaml)

├── alerting/      (README.md + routing.yaml + escalation.yaml)

├── compliance/    (README.md + requirements.yaml)

└── discovery-log.yaml

```



**Key Design Decisions:**

1. Schema version `1.0` in every YAML file — Enables version-aware agent behavior and backward compatibility

2. Separate from `.squad/` — `.secops/` is customer environment data; `.squad/` is framework internals

3. YAML, not JSON — Human-editable with inline comments for SOC engineers

4. All files standalone — Missing files = "unknown," not "error"

5. Append-only discovery log — Bridge between agent auto-discovery and human-verified authoritative data

6. MSSP-first multi-tenancy — Supports enterprise through full MSSP with Lighthouse delegations

7. Cross-cloud metadata — `source_cloud` field enables AWS/GCP correlation context

8. Compliance as hard constraint — `prohibited_regions` are enforced, not suggestions

9. Escalation with severity overrides — Critical alerts can skip triage tiers

10. Templates, not real data — All files use "Contoso Corp" examples; will be `.gitignored` in production



**Scenarios Supported:** Single-tenant enterprise, multi-tenant, MSSP, CSP, government cloud, GDPR/NIS2/DORA/PCI-DSS/FedRAMP, cross-cloud, data tiering, active migrations, ADX + Sentinel hybrid



**Impact on Team:**

- **Freamon:** Consult `data-source-map.yaml` before KQL queries

- **Kima:** Check `tenants.yaml` for cross-tenant detection rules

- **Herc:** Check `compliance/requirements.yaml` before SOAR deployments

- **Sydnor:** Build `secops-squad env init` CLI command against this schema

- **All agents:** Append to `discovery-log.yaml` when discovering environment facts



### 2026-04-30T16:42:21-05:00: Agent .secops/ Environment Context Integration



**By:** Sydnor (Platform Dev)



**Status:** Implemented



**What:** All secops-squad agents now have a standardized protocol for discovering and using customer environment context from the `.secops/` knowledge framework before performing any security operations task.



**Changes Made:**

1. New Copilot skill: `.copilot/skills/secops-environment-context.md` — defines the 7-step discovery flow, critical rules, discovery-log append protocol, government cloud awareness, multi-tenant patterns, and data residency enforcement

2. 11 domain skills updated with `## Environment Context` section — consistent block directing agents to check data-source-map, migrations, workspace config, and compliance before executing the skill

3. 6 agent charters updated (McNulty, Kima, Freamon, Herc, Sydnor, Carver) — `.secops/` context check added as first item under "How I Work"

4. Routing table updated — `.secops/` is self-serve; agents read it directly without coordinator routing



**Why:** The `.secops/` framework captures customer-specific environment facts. Without agent integration, this data sits unused. With it, agents make environment-aware decisions: correct KQL table references, compliant region selections, migration-safe recommendations.



**Key Design Choices:**

1. Copilot-level skill (`.copilot/skills/`) — discoverable by Copilot skill system, not just squad internals

2. Self-serve, not routed — agents check `.secops/` themselves. No coordinator bottleneck

3. Graceful degradation — if `.secops/` doesn't exist, agents proceed with defaults and suggest `secops-squad init --secops`

4. Append-only discovery log — agents write new facts to `discovery-log.yaml` but never modify existing entries

5. Consistent section block — all 11 skill files use identical `## Environment Context` wording



**Impact:**

- **All agents:** Must check `.secops/` before Azure resource, data source, or workspace operations

- **Freamon:** KQL queries now respect `data-source-map.yaml` for table locations

- **Kima:** Detection rules check compliance before region-specific deployments

- **Herc:** SOAR playbooks verify workspace config and data residency

- **Carver:** Can validate that other agents' outputs respect `.secops/` context



### 2026-04-30T16:42:21-05:00: js-yaml dependency + CLI secops integration



**By:** Sydnor (Platform Dev)



**Status:** Implemented



**What:** Added `js-yaml` as the project's first npm production dependency to support `.secops/` YAML parsing in the CLI. Built three new modules:

1. `cli/secops-config.js` — Shared config loader for all `.secops/` YAML files

2. `cli/commands/env.js` — `secops-squad env` command with 4 subcommands

3. `cli/secops-init.js` — `secops-squad init --secops` scaffolding



**Why js-yaml:** The `.secops/` YAML files use nested objects, arrays, inline comments, and multi-line strings that a regex-based parser cannot handle reliably. `js-yaml` is the de-facto standard (38M weekly downloads), zero transitive dependencies, and MIT-licensed.



**Impact:**

- **All agents:** Can now use `secops-squad env` to inspect environment before operations

- **Kima/Freamon:** `secops-squad env data-sources` shows table locations + tiers before writing KQL

- **Herc:** Migration status visible via CLI before deployments

- **Carver:** `secops-squad env validate` can be added to CI pipeline

- **Init flow:** `--secops` flag generates starter `.secops/` for new customers



**Pattern:**

- `secops-config.js` returns `null` for missing files (never crashes) — matches `.secops/` design principle

- `env.js` follows existing command pattern: `run(args)` export, ANSI colors, same style as doctor/init

- `secops-init.js` is idempotent — won't overwrite existing `.secops/environment.yaml`





# Decision: README follows Squad structural pattern



**Date:** 2026-05-04T17:12:14.241-05:00

**By:** Sydnor (Platform Dev)

**Status:** Active



## What



README.md now follows the same structural pattern as the upstream [Squad README](https://github.com/bradygaster/squad): alpha warning → value prop → Quick Start with ✓ Validate → Commands table → feature sections → directory tree → samples → FAQ → docs links → Built On.



## Why



Consistency with the upstream project we're built on. Users familiar with Squad will find the same information flow. The ✓ Validate pattern after each install step reduces support questions.



## Impact



- Section headers no longer use emoji (cleaner, matches Squad convention)

- Documentation section split into three tables (Guides, Reference, Developer) for scannability

- Skill counts corrected to match SKILLS_CATALOG.md (Detection: 9, Microsoft Security: 16)

- All future README edits should maintain this structure





## Governance



- All meaningful changes require team consensus

- Document architectural decisions here

- Keep history focused on work, decisions focused on direction





# Decision: Bicep Template Phase 2 Integration Pattern



**Date:** 2026-05-04T07:53:46-05:00

**By:** Carver (Tester/QA)

**Status:** Proposed



## What



All 11 Bicep templates now include standardized Phase 2 integration comment blocks that reference PowerShell wrapper skills, `.secops/` config files, and post-deployment scripts. A new `templates/bicep/README.md` serves as the central cross-reference.



## Key Design Choices



1. **Comment-only changes** — No Bicep logic was modified. Integration points are documented via comment blocks, not code changes. This preserves template correctness and avoids deployment regressions.



2. **Forward-referenced scripts** — Templates reference `Configure-SoarPlaybooks.ps1` and `Configure-AdxSecurityLake.ps1` that don't exist yet. These scripts should be created by Herc/Sydnor as Phase 2 deliverables.



3. **Rate limiting cross-reference** — Every template references `rate-limiting.md` with specific API limits relevant to its domain (e.g., MDE 100 calls/min for malware-containment, Graph 10K/10min for compromised-account).



4. **`.secops/` is advisory, not enforced** — Templates document which `.secops/` files to consult but don't programmatically read them. Bicep runs in ARM context where local files aren't accessible. The post-deployment scripts will be the enforcement point.



## QA Observations



- **Gap: No deployment validation tests exist** — There's no CI that validates Bicep templates compile (`az bicep build`). Recommend adding a CI step.

- **Gap: Post-deployment scripts are vapor** — The referenced PS1 scripts need to be implemented. Tracked as forward references.

- **Gap: README references `sentinel/` template directory** — The `templates/bicep/sentinel/` directory exists but only contains `.gitkeep`. The README architecture diagram doesn't mention it (correct, since it has no templates).



## Impact



- **Herc:** Needs to create `Configure-SoarPlaybooks.ps1` and `Configure-AdxSecurityLake.ps1`

- **Sydnor:** README references `secops-squad env validate` — must be functional

- **All agents:** Should consult `templates/bicep/README.md` before deploying templates





# Decision: Integration Test Suite Architecture



**Date:** 2026-05-04T07:53:46-05:00

**By:** Carver (Tester/QA)

**Status:** Proposed

**Requested by:** Jose



## What



Created `skills/testing/integration-test-suite.md` — a skill document defining the test architecture, mock factories, and end-to-end test scenarios for all 5 orchestration workflows from `cross-skill-orchestration.md`.



## Key Decisions



1. **Mock at the HTTP boundary** — Override `Invoke-RestMethod` globally in test scope rather than mocking individual skill functions. Tests validate the full workflow chain, not isolated steps.



2. **URI-pattern matching with regex** — `Register-MockResponse` uses regex patterns against URIs, allowing a single mock to cover paginated/parameterized endpoints without registering every URL variant.



3. **Configurable failure injection** — `FailCount` parameter on mocks enables testing retry logic, circuit breakers, and partial failure without separate mock setups per failure mode.



4. **Test `.secops/` fixtures, not real configs** — `New-TestSecopsConfig` generates deterministic fixtures for single-tenant, multi-tenant, and gov-cloud scenarios. Tests never touch the project root `.secops/`.



5. **Pester v5+ as PowerShell test framework** — Aligns with existing JS test patterns (`node:test`) but uses the PowerShell ecosystem's standard. Pester's `Mock`/`Should -Invoke` patterns complement the custom harness for different testing layers.



6. **Structured result contract validation** — `Assert-SuccessResult`/`Assert-ErrorResult` helpers enforce the `@{ ok; data/error }` contract established in `decisions.md` across all workflow outputs.



## Impact



- **Carver:** Owns and maintains all test patterns; integration tests become a quality gate on orchestration PRs

- **All agents:** Reference test data generators when building new API integrations

- **Sydnor:** Can integrate `Invoke-Pester` into CI pipeline alongside existing `node --test`

- **Freamon/Kima/Herc:** Workflow changes must pass corresponding integration test scenario



## Open Questions



- Should Pester test files be created alongside skills (`skills/testing/tests/`) or in a top-level `tests/` directory? Currently the skill describes patterns but doesn't create actual test files.

- Do we need a shared `tests/helpers/test-harness.ps1` file extracted from the skill, or should each test file bootstrap its own harness?





# Decision: Cross-Cloud Connectors Skill & Platform Domain



**Date:** 2026-05-04T08:41:39-05:00

**By:** Freamon (KQL Engineer)

**Status:** Implemented

**Requested by:** Jose



## What



Created `skills/platform/cross-cloud-connectors.md` (509 lines) — a comprehensive skill document covering AWS, GCP, and multi-SIEM data ingestion into Microsoft Sentinel. Also created the new `skills/platform/` domain directory.



## Key Decisions



1. **New `skills/platform/` domain** — Cross-cloud connectors span KQL, Log Analytics, and PowerShell domains. Rather than forcing this into an existing domain, created `platform/` for cross-cutting infrastructure skills that don't belong to a single product area.



2. **ASIM as the unification layer** — All cross-cloud KQL examples normalize to ASIM schemas (Authentication, NetworkSession). This enables unifying parsers that transparently query Azure + AWS + GCP in a single query. Cross-cloud correlation queries depend on consistent ASIM field mapping.



3. **Tier recommendations per source** — Embedded cost-aware tier guidance directly in the skill. CloudTrail → Basic, GuardDuty → Analytics, VPC Flow Logs → Auxiliary. These align with `.secops/data-source-map.yaml` tier field conventions.



4. **SPL→KQL translation table** — Included 10 common SPL-to-KQL patterns for Splunk migration. This is the most common multi-SIEM scenario for Sentinel customers.



5. **PowerShell health functions use `.secops/`** — `Get-CrossCloudConnectorHealth` and `Test-CrossCloudIngestionVolume` read from `data-source-map.yaml` to auto-discover cross-cloud sources, following the established `.secops/` auto-loading pattern.



## Impact



- **Kima:** Can reference ASIM parsers for cross-cloud detection rules

- **Herc:** Connector setup automation patterns available for SOAR playbooks

- **All agents:** New `platform/` domain available for future cross-cutting skills

- **`.secops/`:** data-source-map.yaml examples for `source_cloud: aws/gcp` entries established as templates









# Decision: MSSP Workflow Patterns and `.secops/mssp-config.yaml` Schema



**Date:** 2026-05-04T09:00:00-05:00

**By:** Freamon (KQL Engineer)

**Status:** Proposed



## What



Created `skills/orchestration/mssp-workflows.md` establishing MSSP-specific operational patterns:



1. **`mssp-config.yaml` as MSSP control plane** — New `.secops/` file defining SOC team assignments, customer→team mappings, billing tiers (Gold/Silver/Bronze with cost-per-GB and SCU allocations), SLA definitions (response time targets per severity per tier), analyst rotation schedules, and per-customer notification channels (PagerDuty, Teams, email, ServiceNow).



2. **Three-tier service model** — Bronze (basic monitoring, 60-min High SLA, 8x5), Silver (threat hunting + custom detections, 30-min High SLA, 8x5), Gold (dedicated analyst + 24x7 + compliance reporting, 15-min High SLA). Detection rule packs, feature access, and billing rates all key off this tier.



3. **Centralized vs Distributed config pattern** — Recommended centralized `mssp-config.yaml` for <20 customers, per-customer `.secops/customers/<slug>/` folders for 20+, hybrid for 50+.



4. **Analyst state preservation** — `Switch-MSSPCustomer -PreserveState` saves/restores investigation context (open incidents, last query) per tenant in `.secops/analyst-state/`.



## Why



MSSPs are the most complex deployment model for secops-squad. Without structured workflow patterns, MSSP SOC analysts face: (a) no SLA tracking mechanism, (b) manual tenant onboarding taking hours, (c) no billing visibility, (d) context loss when switching between customers. The `mssp-config.yaml` schema gives agents structured access to customer tier, team assignment, and SLA targets.



## Impact



- **Sydnor:** `mssp-config.yaml` schema needs CLI support (`secops-squad env` should parse it). Consider `secops-squad mssp` subcommand.

- **Kima:** Detection rules should be tagged by tier so `Deploy-TierDetectionRules` can select appropriate rule packs.

- **Herc:** SOAR playbooks may need tier-aware escalation paths from `mssp-config.yaml`.

- **All agents:** When `org_type: "mssp"`, check `mssp-config.yaml` for customer context before operations.





# Freamon — Phase 6 Skill Decisions (2026-05-04)



**By:** Freamon (KQL Engineer)

**Requested by:** Jose



## Decision: TI Feed Configuration in `.secops/`



**What:** Introduced `data-sources/ti-feeds.yaml` as the standard location for TI feed configuration within the `.secops/` framework. Schema supports 7 feed sources (CISA KEV, abuse.ch, VirusTotal, Shodan, OTX, MISP, Defender TI) with per-feed enable/disable, schedule, API key vault references, and quota tracking.



**Why:** TI feed management is environment-specific — which feeds are enabled, API quotas, and refresh schedules vary per customer. Centralizing this in `.secops/` follows the established pattern and lets `Import-ThreatIntelFeed` auto-configure from YAML instead of requiring parameters.



**Impact:**

- **Kima:** Detection rules can reference TI watchlist aliases from feed config

- **Herc:** SOAR playbooks can check feed health before relying on TI enrichment

- **Sydnor:** CLI `env` command could surface TI feed status



## Decision: Multi-Source IOC Confidence Scoring



**What:** Established a pattern where IOCs appearing in 3+ independent feeds get "High" confidence, 2 feeds = "Medium", 1 = "Low". Both KQL (ThreatIntelligenceIndicator aggregation) and PowerShell (`Get-IOCEnrichment`) implement this scoring.



**Why:** Single-source IOC matches generate too many false positives. Multi-source correlation dramatically increases true positive rate without requiring analyst judgment at triage time.



## Decision: Performance Skill as Platform Cross-Cutting Concern



**What:** Placed performance-tuning.md in `skills/platform/` rather than `skills/kql/` or `skills/powershell/` because it spans KQL optimization, API wrapper patterns, rate limiting, MCP server efficiency, and cost analysis.



**Why:** Performance touches every domain. Placing it in platform alongside cross-cloud-connectors and multi-tenant-support signals that all agents should reference it. The KQL anti-pattern table and query checklist should be consulted by anyone writing production queries.





# Decision: SOC Analyst Persona v2.0.0 — Phase 2-3 Tool Integration



**Date:** 2026-05-04T07:53:46-05:00

**By:** Freamon (KQL Engineer)

**Requested by:** Jose

**Status:** Proposed



## What



Updated the `personas/soc-analyst/` persona (skills.json, routing.md, README.md) to reference Phase 2-3 skills: Advanced Hunting API, KQL query-builder, workbook automation, Sentinel/Defender/Log Analytics API wrappers, Copilot for Security enrichment, and rate limiting patterns.



## Key Choices



1. **skills.json bumped to v2.0.0** — Breaking change: added `path` fields to new skill entries for explicit skill file references. Existing skill names preserved for backward compatibility.

2. **Rate limiting and Copilot for Security are shared skills** — All tiers need API rate limiting (mandatory cross-cutting concern) and Copilot enrichment. Added to `shared` array rather than duplicating per-agent.

3. **Tier-appropriate skill distribution** — Bunk (L1) gets minimal API access (sentinel-api-wrapper only). Kima (L2) gets Sentinel + Defender + workbooks. Freamon (L3) gets the full query/hunting stack. Daniels gets workbooks for operational dashboards.

4. **Tool-chain routing added to routing.md** — New section maps task types to ordered tool chains (e.g., "Threat hunting → KQL builder → Advanced Hunting API"). This is additive — existing severity-based and work-type routing tables are unchanged.

5. **`.secops/alerting/` integration** — Alert triage routing now references `.secops/alerting/routing.yaml` and `escalation.yaml` for environment-specific rules. This connects the persona to the customer knowledge framework.



## Why



The SOC analyst persona referenced Phase 1 skills only. Phase 2-3 delivered 9 new skills that directly serve SOC workflows but weren't wired into the persona. Without these references, users installing the soc-analyst persona wouldn't discover the Advanced Hunting API, KQL builder, or API wrappers — the tools that make programmatic SOC operations possible.



## Impact



- **Kima:** Now has explicit `defender-api-wrapper` and `workbook-automation` assignments

- **Bunk:** Now has `sentinel-api-wrapper` for programmatic incident triage

- **Daniels:** Now has `workbook-automation` for SOC operational dashboards

- **All agents:** `rate-limiting` and `copilot-for-security` are shared baseline skills

- **Other personas:** May want similar Phase 2-3 updates (detection-engineering, threat-hunting, incident-response)



## Review Requested From



- **McNulty:** Architecture review — does the tool-chain routing pattern work for other personas?

- **Kima:** Confirm Kima's skill assignments are appropriate for L2 workflows









# Decision: Persona Configuration Updates for Phases 2-3



**Date:** 2026-05-04T07:53:46-05:00

**By:** Herc (Automation/SOAR)

**Requested by:** Jose

**Status:** Proposed



## What



Updated two persona configurations to reference all Phase 2-3 skills:



### incident-response persona (v1.0.0 → v2.0.0)

- Added 7 new skill references across shared and per-agent assignments

- Sydnor gets eDiscovery, Purview, and data tiering for forensic evidence governance

- Beadie gets compliance framework mappings for regulatory reporting

- Rawls gets workbook automation for post-incident dashboards

- All agents get api-patterns and rate-limiting as shared skills

- New routing rules for compliance checks, evidence preservation, data classification, and post-incident reporting

- 3 new operational rules enforcing compliance assessment, legal holds, and mandatory dashboards



### full-soc persona (v1.0.0 → v2.0.0)

- Expanded from ~24 skill references to 60+ covering all Phase 2-3 domains

- New `infrastructure_skills` section for platform-level skills (MCP servers, data tiering, workspace setup)

- Every agent gets expanded skill set matching their domain expertise

- Cutty (Automation) goes from 3 skills to 11 — now covers full SOAR + compliance + monitoring portfolio

- Routing expanded from 16 to 27 domain entries, 6 to 12 cross-functional scenarios

- 5 new routing rules for compliance, legal holds, automation, threat feeds, and MCP self-serve



## Why



Phase 2-3 produced 30+ new skills across powershell/, msft-security/, soar/, detection/, and kql/ domains. Without persona updates, users installing these personas would miss the new capabilities. The incident-response and full-soc personas are the most impacted because they span the broadest operational surface.



## Key Design Choices



1. **Shared vs per-agent**: Foundation skills (api-patterns, rate-limiting, auth-patterns, error-handling, module-foundation) are shared. Domain-specific skills are per-agent.

2. **infrastructure_skills section**: New top-level section in full-soc for platform skills that don't belong to any single agent (MCP servers, workspace setup, API reference).

3. **Path references**: New skills include explicit `path` fields pointing to skill file locations for discoverability.

4. **Routing rules are prescriptive**: "Compliance assessment before closure" and "legal holds before evidence collection" are mandatory rules, not suggestions.

5. **MCP servers are self-serve**: Any agent can query Sentinel/Defender data via MCP without routing through another agent.



## Impact



- **All persona users**: Installing incident-response or full-soc now gets the full Phase 2-3 skill set

- **McNulty**: May want to review the infrastructure_skills pattern for adoption in other personas

- **Sydnor**: CLI `init` command should respect the new `infrastructure_skills` section when installing personas

- **Other personas** (soc-analyst, detection-engineering, threat-hunting, cloud-security): Should be updated similarly in a follow-up task













# Decision: Gov Cloud Support + Copilot Workflow Skills



**Date:** 2026-05-04T08:41:39-05:00

**By:** Kima (SecOps Engineer)

**Requested by:** Jose

**Status:** Implemented



## What



Created two new skill documents:



1. **`skills/platform/gov-cloud-support.md`** (~640 lines) — Sovereign cloud support covering GCC, GCC High, DoD, Azure Government, and Azure China environments with endpoint resolution, auth flows, feature availability, and compliance constraints.



2. **`skills/orchestration/copilot-security-workflows.md`** (~780 lines) — Copilot for Security enriched workflow patterns with 5 enrichment types, 3 workflow templates, SCU cost management, and graceful degradation.



## Key Design Decisions



1. **`organization.cloud` as single source of truth** — All endpoint resolution flows from this single field in `.secops/environment.yaml`. No hardcoded commercial URLs anywhere in agent code.



2. **Feature availability as guard, not assumption** — `Test-SecOpsCloudFeature` must be called before any operation that may not exist in sovereign clouds. Silent failures are unacceptable in government environments.



3. **Mandatory fallback paths** — Every Copilot-dependent workflow includes a non-AI fallback. GCC High/DoD customers get functional (if less enriched) workflows without Copilot.



4. **SCU budget per workflow** — Individual workflow SCU limits prevent a single runaway triage from consuming the entire monthly budget.



5. **Certificate-based auth required for GCC High/DoD** — Client secrets are development-only in sovereign clouds. Production service principals must use X.509 certificates.



## Impact



- **All agents:** Must use `Get-SecOpsCloudEndpoints` instead of hardcoded URLs

- **Herc:** SOAR playbooks must call `Test-SecOpsCloudFeature` before Copilot actions

- **Freamon:** KQL queries targeting gov clouds must use `api.loganalytics.us` (not `.io`)

- **Sydnor:** CLI `env` commands should surface cloud type prominently

- **Carver:** Validation should verify no hardcoded commercial endpoints in new skills



## Why



Government customers represent a significant deployment target. Without explicit sovereign cloud support, agents would silently fail against incorrect endpoints, attempt unavailable features, or violate data residency requirements — all unacceptable in regulated environments.





# Decision: Attack Simulation & Cloud App Discovery API Skills



**By:** Kima (SecOps Engineer)

**Date:** 2026-05-04T09:50:42-05:00

**Priority:** P6 (Optional)



## What



Created two optional API skill documents:

1. `skills/msft-security/attack-simulation-api.md` — Attack Simulation Training via Graph API

2. `skills/msft-security/cloud-app-discovery-api.md` — MDCA Discovery REST API



## Design Choices



1. **Complements, not duplicates:** `cloud-app-discovery-api.md` extends the existing `defender-cloud-apps.md` (which covers CASB policy design) with API-level automation. No content overlap.

2. **Simulation-to-detection correlation:** `attack-simulation-api.md` includes Sentinel KQL queries that cross-reference simulation targets with detection alerts — this is a novel capability not covered by any existing skill.

3. **`.secops/` config patterns:** Both skills define new YAML config blocks (`attack_simulation`, `cloud_app_discovery`, `sanctioned-apps.yaml`, `simulation-campaigns.yaml`) following the schema v1.0 pattern established by Sydnor.



## Impact



- **Kima:** Owns both skills; total contribution now 22 skills

- **Herc:** Can reference simulation scheduling for SOAR automation

- **Freamon:** KQL queries in both skills follow validated patterns

- **No blocking dependencies:** Both skills are optional extensions





# Decision: Phase 2-3 Persona Skill & Routing Updates



**Date:** 2026-05-04T07:53:46-05:00

**By:** Kima (SecOps Engineer)

**Requested by:** Jose

**Status:** Proposed



## What



Updated three persona configurations (detection-engineering, threat-hunting, cloud-security) to reference Phase 2-3 skills, API wrappers, and MCP tools. All three personas bumped from v1.0.0 → v2.0.0.



### Changes Per Persona



| Persona | New Skills | Files Updated |

|---------|-----------|---------------|

| detection-engineering | 8 (sentinel-api-wrapper, sentinel-mcp-server, sentinel-api-reference, data-tiering-commands, workbook-automation, log-analytics/api-wrapper, log-analytics/query-patterns, kql/query-builder) | skills.json, routing.md, README.md |

| threat-hunting | 8 (sentinel-api-wrapper, sentinel-mcp-server, sentinel-api-reference, data-tiering-commands, log-analytics/api-wrapper, log-analytics/query-patterns, kql/query-builder, workbook-automation) | skills.json, routing.md, README.md |

| cloud-security | 6 (defender-api-wrapper, defender-mcp-server, defender-api-permissions, advanced-hunting-api, copilot-for-security, defender-cloud-apps) | skills.json, routing.md, README.md |



## Key Design Decisions



1. **MCP-first tool selection** — All routing files establish MCP → PowerShell → REST as the priority order for tool selection. Agents use MCP for interactive operations; pipelines use PowerShell wrappers for automation.



2. **Shared vs per-agent skill placement** — API wrappers and MCP tools that all agents need (sentinel-api-wrapper, sentinel-mcp-server, sentinel-api-reference, defender-api-wrapper, defender-mcp-server, defender-api-permissions) are placed in `shared`. Domain-specific tools (workbook-automation, data-tiering-commands, advanced-hunting-api, copilot-for-security, defender-cloud-apps) are placed per-agent based on routing ownership.



3. **Routing files include API operation tables** — Each routing.md now has an "API & Tool Routing" section mapping specific operations to skills and responsible agents. This makes tool selection deterministic for agents.



4. **Version bump to 2.0.0** — Breaking change: new shared skills mean all agents in these personas get additional context. Bumped major version to signal this.



## Why



Phase 2-3 delivered 20+ PowerShell wrappers, MCP server integrations, and API references for both Sentinel and Defender. These skills were built but not yet wired into persona configurations — meaning agents using these personas couldn't discover or route to them. This update closes the gap.



## Impact



- **Sydnor:** CLI `secops-squad init` will install updated personas with Phase 2-3 skills pre-loaded

- **Freamon:** KQL/Log Analytics skills now referenced by detection-engineering and threat-hunting personas

- **Herc:** workbook-automation skill now referenced by detection-engineering (Daniels) and threat-hunting (Rhonda)

- **Carver:** Can validate that persona skill references resolve to actual skill files



## Open Questions



- Should `incident-response` and `full-soc` personas also get Phase 2-3 updates? (Not in current task scope)

- Should `soc-analyst` persona reference copilot-for-security? (Natural fit for Tier 1 analyst workflows)





# Decision: Readiness Assessment Findings — Three End-to-End Workflows



**By:** McNulty (Lead)  

**Date:** 2026-05-04T16:25:25.217-05:00  

**Requested by:** John Spaid  

**Status:** Findings — action required  



---



## Summary



Three end-to-end workflows assessed against current repo state. All three are partially functional. One has a broken command promise (`workspace connect`), one has a name-field discrepancy in the agent file, and one is entirely template-only with no connectivity path implemented. Priorities and specific file fixes are documented below.



---



## Finding 1: `workspace connect` is a broken promise — HIGH PRIORITY



**File:** `cli/index.js` lines 38–41 + `cli/commands/init.js` line 413



`init.js` explicitly tells users: _"Connect Azure later with `secops-squad workspace connect`"_. However, `index.js` registers `workspace` with no `module:` field — it falls through to the `"This command is not yet implemented"` stub. This is a user-facing broken promise. Sydnor should either implement `cli/commands/workspace.js` or remove the suggestion from the init output.



**Decision:** `workspace connect` must be either implemented or the post-init prompt must be updated to point users to `secops-squad env` instead. Do not ship a command that advertises itself in init output but silently fails.



---



## Finding 2: Agent frontmatter `name:` field conflicts with CLI invocation pattern



**File:** `.github/agents/secops-squad.agent.md` frontmatter (line 2)



Current: `name: SecOps Squad` (space-separated)  

CLI invocation: `copilot --agent secops-squad` (hyphen-separated)



If the Copilot CLI matches against the `name:` frontmatter field (not the filename), this will silently fail — "secops squad" ≠ "secops-squad". The safer fix is to align the `name:` field with the filename: `name: secops-squad`. Sydnor should verify CLI matching behavior and update accordingly.



---



## Finding 3: `.github/copilot-instructions.md` not deployed



**File:** `.squad/templates/copilot-instructions.md` (template only — not active)  

**Missing:** `.github/copilot-instructions.md`



The copilot instructions template exists but has not been deployed to the active `.github/copilot-instructions.md` location. This means Copilot sessions have no custom workspace-level instructions. Sydnor should add deployment of this file to the install script or document the manual step.



---



## Finding 4: `.env.example` only covers Sentinel — incomplete for Workflow 3



**File:** `.env.example`



Covers only `AZURE_SUBSCRIPTION_ID`, `AZURE_TENANT_ID`, `SENTINEL_WORKSPACE_ID`, `SENTINEL_WORKSPACE_NAME`, `SENTINEL_RESOURCE_GROUP`. No variables for Defender XDR, Defender for Cloud, Defender for Identity, Defender for Endpoint, or Entra ID Protection. Kima should define what variables each product needs, then Sydnor updates `.env.example`.



---



## Finding 5: No Defender product connectivity skills — MEDIUM PRIORITY



No dedicated skills exist for testing or configuring connections to:

- Defender XDR (Microsoft 365 Defender)

- Defender for Cloud

- Defender for Identity

- Defender for Endpoint

- Entra ID Protection



Kima owns this gap. At minimum a `skills/msft-security/connectivity-setup.md` covering API prerequisites, required permissions, and CLI verification commands per product.





# Decision: Multi-Tenant SecOps Skill Domain



**By:** Sydnor (Platform Dev)

**Date:** 2026-05-04T08:41:39-05:00

**Status:** Proposed



## What



Created `skills/platform/` as a new skill domain for infrastructure-level SecOps capabilities, starting with `multi-tenant-support.md` — a comprehensive guide for MSSP, enterprise, and ISV multi-tenant scenarios using Azure Lighthouse, `.secops/` schema extensions, and production PowerShell patterns.



## Key Design Choices



1. **New `platform` domain** — Multi-tenancy spans all security products; it doesn't fit in any existing domain (kql, soar, detection). Platform skills are the foundation layer consumed by all domain skills.



2. **`.secops/` schema extensions** — Added `tenant_id` scoping to workspace YAML and data-source-map entries, plus a new `tenant-context.yaml` for agent-managed active tenant tracking. These are additive extensions to schema v1.0 (no breaking changes).



3. **Token-per-tenant with caching** — Every API call acquires a tenant-specific token via `Get-TenantScopedToken` with in-memory cache. No implicit "current context" reliance — prevents cross-tenant data leakage.



4. **SLA-tier-aware routing** — Alert escalation paths vary per tenant based on `sla_tier` in the Lighthouse delegation config (premium = PagerDuty/15min, standard = Teams/60min). This is MSSP-critical.



5. **Isolation verification** — `Test-TenantIsolation` function confirms tokens for one tenant cannot access another tenant's subscriptions. Designed for periodic compliance checks.



## Impact



- **All agents:** Must check `org_type` in `environment.yaml` before assuming single-tenant

- **Freamon:** Cross-tenant KQL queries use `Invoke-CrossTenantQuery` pattern

- **Kima:** Detection rules must consider per-tenant data source mappings

- **Herc:** SOAR playbooks should use `Assert-TenantIsolation` before write operations

- **Sydnor:** CLI `env` commands should surface tenant context and switching



## Files Created



- `skills/platform/README.md` (68 lines)

- `skills/platform/multi-tenant-support.md` (558 lines)





# Decision: Cross-Skill Orchestration Skill Architecture



**By:** Sydnor (Platform Dev)

**Date:** 2026-05-04T07:53:46-05:00

**Status:** Proposed



## What



Created `skills/orchestration/` as a new skill domain that teaches agents how to compose multi-skill workflows. This is the glue layer between domain skills — it doesn't replace them, it orchestrates them.



## Key Design Choices



1. **Five reusable orchestration patterns** — Sequential Pipeline, Fan-Out/Fan-In, Conditional Branching, Loop/Iteration with circuit breaker, Checkpoint/Resume. Each is a standalone PowerShell function that can be composed.



2. **Structured result objects everywhere** — All pattern functions and workflow steps use `@{ ok = $true; data = ... }` return shape, consistent with `lib/graph-security/` and `error-handling.md`.



3. **Checkpoint state in `.secops/checkpoints/`** — Long-running workflows (like eDiscovery searches) save state to JSON files under `.secops/`, consistent with the framework's role as customer environment data store.



4. **Dead letter queue in `.secops/dead-letter/`** — Failed items persist for retry. New directory under `.secops/` — needs team review on whether this belongs there or in `.squad/`.



5. **Circuit breaker in entity loops** — Consecutive failure counting with automatic halt. Prevents cascading API abuse during fan-out operations.



## Impact



- **All agents:** Can now reference orchestration patterns when composing multi-step workflows

- **Coordinator:** Has decomposition table mapping workflow steps to responsible agents

- **Freamon:** KQL query building and execution steps in hunting/investigation workflows

- **Kima:** Sentinel, eDiscovery, Purview steps in investigation/compliance workflows

- **Herc:** SOAR and dashboard steps in reporting workflows



## Open Questions



1. Should `.secops/checkpoints/` and `.secops/dead-letter/` be `.gitignored`? They contain runtime state, not configuration.

2. Should orchestration patterns be extracted to `lib/orchestration/` as importable modules, or remain as skill-documented patterns?





# Decision: Microsoft Security Connectivity Setup Skill



**Date:** 2026-05-04T16:45:02.077-05:00

**By:** Kima (SecOps Engineer)

**Requested by:** John Spaid



## What Was Created



New skill file: `skills/msft-security/connectivity-setup.md`



A comprehensive connectivity setup guide covering all 6 Microsoft Security products targeted by the secops-squad framework. This skill fills a gap between "installed" and "ready to use" — users had no single, authoritative path to verify every product is wired up correctly.



## What It Covers



1. **Quick Connectivity Test** — single PowerShell block that runs all 6 checks in sequence and prints a color-coded summary. Functions as a "doctor command" for the security product stack.



2. **Per-product sections** (Microsoft Sentinel, Defender XDR, Defender for Cloud, Defender for Identity, Defender for Endpoint, Entra ID Protection), each containing:

   - Required Roles / App Registration Permissions table

   - Step-by-step setup instructions with Azure CLI commands

   - Verification commands (copy-paste ready)

   - Common Issues & Fixes table



3. **Troubleshooting Matrix** — 20 error messages mapped to root causes and actionable fixes.



4. **Authentication Summary table** — maps each product to its API target, auth method, and token resource scope. Helps agents determine which auth context is needed before calling any product.



## Key Design Decisions



- **Cross-references over duplication:** `defender-api-permissions.md` already covers the full permissions matrix in detail. This skill references it rather than duplicating content. Same pattern for `sentinel-workspace-setup.md`, `gov-cloud-support.md`, and each product's dedicated skill.

- **Frontmatter format:** Follows the exact pattern established in `sentinel-workspace-setup.md` and `defender-api-permissions.md` — YAML frontmatter with `title`, `category`, `difficulty`, `mitre_attack`, `products`, `author: Kima`, `version`, `last_updated`.

- **Environment Context section:** Follows the standard block used across all Kima skills — directs agents to `.secops/` before running tests.

- **MDE disambiguation:** MDE uses `WindowsDefenderATP` resource permissions (not Graph). This is the most common agent confusion point and is highlighted explicitly in the setup steps, troubleshooting table, and authentication summary.



## Impact



- **All personas:** New users now have a single skill to run immediately after `secops-squad install` to confirm connectivity across all products.

- **Agent operations:** Agents running connectivity checks can reference this skill's verification commands to self-diagnose before attempting product-specific operations.

- **Skill catalog:** Adds a new entry to `skills/msft-security/` that complements the existing product-specific skills by providing a unified entry point.



## Status



Ready for review. No existing skills were modified.





# Decision: CLI Readiness Fixes (8 issues)



**By:** Sydnor (Platform Dev)

**Date:** 2026-05-04T16:45:02.077-05:00

**Status:** Implemented



## Summary



Resolved all 8 readiness issues identified by McNulty's assessment. All changes are backward-compatible and non-breaking.



## Changes



### FIX 1 — CRITICAL: init.js post-init message (cli/commands/init.js)

Changed broken reference `secops-squad workspace connect` → `secops-squad env validate`. The `workspace connect` command did not exist; `env validate` is the correct implemented command.



### FIX 2 — CRITICAL: workspace.js implemented (cli/commands/workspace.js)

Created new command file with three subcommands:

- `connect` — prompts for workspace name, resource group, subscription; writes `.secops/workspaces/{name}.yaml`; updates `environment.yaml` default_workspace; verifies Azure login first

- `status` — reads `.secops/environment.yaml` and workspace YAML, shows connection details, optionally runs `az account show`

- `disconnect` — removes `default_workspace` from `environment.yaml`, preserves workspace file



Also added `module: "./commands/workspace.js"` to the workspace entry in `cli/index.js`.



### FIX 3 — HIGH: Agent name field (`.github/agents/secops-squad.agent.md`)

Changed frontmatter `name: SecOps Squad` → `name: secops-squad` to match filename stem for reliable `--agent secops-squad` flag matching.



### FIX 4 — HIGH: Deployed copilot-instructions.md (`.github/copilot-instructions.md`)

Copied `.squad/templates/copilot-instructions.md` → `.github/copilot-instructions.md`. This file provides squad-aware context to the Copilot coding agent when it autonomously picks up issues.



### FIX 5 — HIGH: doctor.js Azure + SecOps checks (cli/commands/doctor.js)

Added two new health checks:

- `checkAzureConnectivity()` — runs `az account show --output json`, shows subscription name/ID/tenant on success; warns "Azure not logged in. Run: az login" on failure

- `checkSecopsConfig()` — checks `.secops/environment.yaml` existence; warns if `organization.name === "Contoso Corp"` (template default); passes with org name if customized; warns if missing



Both inserted into the checks array immediately after `checkAzureCli()`. Added `js-yaml` require at top of file.



### FIX 6 — HIGH: Expanded .env.example

Expanded from 6 lines to full coverage of all 6 Microsoft Security products: MDE, Defender XDR, Defender for Cloud, Defender for Identity, Entra ID Protection, plus ADX. Each section has comments explaining app registration requirements and API permissions.



### FIX 7 — MEDIUM: mcp-config.json standardized (`.copilot/mcp-config.json`)

Renamed key `EXAMPLE-github` → `github`. Updated package from `@anthropic/github-mcp-server` → `@modelcontextprotocol/server-github` (standard MCP GitHub server package).



### FIX 8 — LOW: install.sh dead $? check (install.sh)

Replaced unreachable `if [ $? -ne 0 ]` block (dead code under `set -euo pipefail`) with proper `if ! git clone ...` pattern that works correctly whether or not `set -e` is active.



## Impact



- `secops-squad workspace connect/status/disconnect` now fully functional

- `secops-squad doctor` now shows Azure login status and SecOps config health

- Copilot coding agent picks up correct squad instructions from `.github/copilot-instructions.md`

- `--agent secops-squad` flag now reliably resolves to the agent file

- Install script is correct under `set -euo pipefail`

- No breaking changes to existing commands or schemas





# Decision: CLI Shim and PATH Auto-Setup



**Date:** 2026-05-08T16:08:28.643-05:00

**By:** Sydnor (Platform Dev)

**Status:** Implemented



## What



Added `secops-squad.cmd` batch wrapper in the project root and updated `install.ps1` to automatically add the install directory to the user's PATH (both session and persistent). Users can now run `secops-squad init` directly after installation instead of `node cli\index.js init`.



## Why



The previous post-install experience required users to either manually modify PATH or use the verbose `node cli\index.js` invocation. This created friction for new users and made the CLI feel unpolished.



## Impact



- **All agents:** Documentation and instructions can now reference `secops-squad <command>` instead of `node cli\index.js <command>`.

- **README / docs:** Any getting-started guides should use the short form.

- **install.sh (Linux/macOS):** Should get a similar treatment (symlink or shell wrapper) for parity.



## Files Changed



- `secops-squad.cmd` (new) -- batch wrapper forwarding to `node cli\index.js`

- `install.ps1` -- PATH setup + simplified post-install message



# Decision: ASCII-Only Policy for PowerShell Scripts



**Date:** 2026-05-08T15:50:14.020-05:00

**Author:** Sydnor (Platform Dev)

**Status:** Proposed



## Context



A user on PowerShell 5.1 hit a `ParseException` (`UnexpectedToken`) when running `install.ps1`. The root cause: PS5 reads UTF-8 files without a BOM as ANSI (Windows-1252). Emoji characters (✅, ❌, ⚠️) and Unicode box-drawing characters (┌─┐│└─┘) became garbled multi-byte sequences under ANSI interpretation, breaking string parsing.



## Decision



All PowerShell scripts in this repository (`.ps1`, `.psm1`, `.psd1`) must:



1. **Use only ASCII characters (U+0000–U+007F) in source code.** No emoji, no box-drawing, no em-dashes, no smart quotes. Use ASCII equivalents: `[OK]`, `[FAIL]`, `[WARN]`, `+---+`/`|` for boxes, `--` for dashes.

2. **Be saved with UTF-8 BOM encoding** (`EF BB BF` byte prefix). This tells PS5 to interpret the file as UTF-8 rather than ANSI.



Both measures together provide defense in depth — ASCII content survives any encoding interpretation, and the BOM provides correct decoding if Unicode is ever reintroduced accidentally.



## Consequences



- PowerShell scripts will look slightly less pretty in terminals that support Unicode, but they will work everywhere.

- Contributors adding Unicode characters to PS scripts will need to be corrected in review.

- A CI lint step could enforce this in the future (e.g., `grep -P '[^\x00-\x7F]'` on `.ps1` files).



# Decision: Update Command Uses Git Remote Merge Strategy



**Date:** 2026-05-08T15:06:07.002-05:00

**By:** Sydnor (Platform Dev)

**Status:** Implemented



## What



Added `secops-squad update` CLI command that pulls latest starter-kit changes via a git remote named `starter-kit`. Uses `git merge --allow-unrelated-histories` since installed projects have no shared git history with the template repo.



## Why



The install flow (install.ps1/install.sh) shallow-clones the starter-kit, deletes `.git`, and inits a fresh repo. Users had no way to get upstream improvements. A git-remote-based merge is the simplest approach that preserves local customizations while pulling new files.



## Impact



- **All agents:** The `starter-kit` remote may appear in `.git/config` after users run `update`. Don't treat it as the project's origin.

- **Sydnor:** Owns this command going forward. Any starter-kit structural changes (new top-level dirs, renamed files) should be tested against the merge path.

- **Kima/Freamon/Herc:** New skills or templates added to the starter-kit will flow to users via this command automatically.



## Archived Decisions (>30 days)

### 2026-05-08T16:09:41.073-05:00: Workspace Connect — Azure Auto-Discovery



**By:** Sydnor (Platform Dev)



**Status:** Implemented



**What:** Rewrote `cli/commands/workspace.js` `connect()` to auto-discover Microsoft Sentinel workspaces from Azure instead of manually prompting for workspace name, resource group, and subscription ID.



**New flow:**

1. Verify `az` CLI installed, auto-run `az login` if not authenticated (uses `stdio: 'inherit'` for browser flow)

2. List enabled subscriptions, present numbered picker if multiple

3. Discover all Log Analytics workspaces via `az monitor log-analytics workspace list`

4. Check Sentinel on each workspace via `az rest` against `SecurityInsights({name})` solution endpoint

5. Present Sentinel-enabled workspaces (or all workspaces if none have Sentinel) as numbered list

6. Write `.secops/workspaces/<name>.yaml` with auto-populated fields matching schema v1.0

7. Update `.secops/environment.yaml` default_workspace



**Key design choices:**

- `execAz()` helper with configurable timeout (30s default, 120s for login), `inherit` stdio, and `allowFail` options — replaces single-purpose `execSafe()`

- Resource group parsed from ARM resource ID regex, not from a separate API call

- Sentinel detection via `Microsoft.OperationsManagement/solutions` REST API (simpler than querying alert rules)

- Graceful fallback: if no Sentinel workspaces found, show all LA workspaces with warning



**Impact:**

- All agents: `workspace connect` now produces richer YAML (includes `workspace_id`, `region`, `sentinel_enabled`, `tier`)

- Kima/Freamon: Can rely on `sentinel_enabled: true` in workspace config for conditional logic

- Users: Zero manual typing of GUIDs or resource group names



# Decision: GitHub CLI promoted to required dependency

**Date:** 2026-05-08T16:21:48.253-05:00
**By:** Sydnor (Platform Dev)
**Status:** Accepted

## What

GitHub CLI (`gh`) is now a **required** dependency in `install.ps1`, upgraded from optional. The install script will auto-install it via `winget install GitHub.cli` if missing.

Additionally, the GitHub Copilot CLI extension (`gh extension install github/gh-copilot`) is now installed as part of the bootstrap.

## Why

- `gh` is required for squad issue mode (Ralph's issue routing, label-based work assignment).
- The `copilot --agent secops-squad` launch command depends on the `gh-copilot` extension.
- The primary workflow (`copilot --agent secops-squad`) cannot function without both `gh` and the copilot extension.

## Impact

- **All agents:** The `copilot` command is now the documented entry point. References to `node cli/index.js` are removed from README.
- **Users:** Fresh installs get `gh` and `gh-copilot` automatically. Users still need to run `gh auth login` manually (cannot be automated in a non-interactive script).
- **install.ps1:** Fails if `gh` cannot be installed (same as Git and Node.js).

# Decision: gh CLI and az CLI are optional — connected during agent session

**Date:** 2026-05-08T16:41:19.514-05:00
**By:** Sydnor (Platform Dev)
**Status:** Implemented

## What

GitHub CLI (`gh`) and Azure CLI (`az`) are no longer install-time prerequisites for secops-squad.
They are optional tools that users connect interactively during a Copilot session when they first need them.

## Why

Most users don't have `gh` or `az` configured before starting. Requiring them upfront creates friction
and failed installs for users who just want to try the tool. The agent can guide interactive auth
far more gracefully than a shell script can.

## Changes

- `install.ps1`: `gh` demoted from required (`$true`) to optional (`$false`). `Ensure-GhCopilotExtension` removed entirely.
- `install.sh`: no change needed (gh was already optional).
- `README.md`: prerequisites table updated; `--yolo` promoted as primary launch command.
- `cli/commands/doctor.js`: `checkCopilotCli()` added as required check; gh/az remain optional warnings.

## Impact

- **All agents:** Users may not have `gh` or `az` connected on first run — agents should check and offer to help connect them.
- **McNulty:** Issue mode requires gh; should detect and prompt before attempting gh operations.
- **Herc/Kima:** Azure operations require az login; should detect and prompt before az calls.

# Decision: First-Run Onboarding Skill Design

**Date:** 2026-05-08T16:48:55-05:00
**By:** Kima (SecOps Engineer)
**Status:** Implemented

## What

Created `.copilot/skills/first-run-onboarding/SKILL.md` — a copilot-level skill that teaches the agent to proactively detect first-run state and guide new users through environment setup.

## Key Design Choices

1. **Progressive disclosure over prerequisite dumps.** The skill guides one step at a time: Azure CLI → Workspace discovery → .secops/ init → GitHub CLI (optional). No walls of text listing everything the user needs.

2. **Detection-first, not prompt-first.** The agent runs 5 silent checks at session start (`.secops/` exists, `az account show`, workspace count, `gh auth status`, template defaults) and uses a decision matrix to determine which step to start at. Users don't need to ask for help.

3. **Re-entry without restart.** When a user returns to a partially-configured environment, the agent picks up at the first incomplete step. Token-expired sessions get a targeted `az login`, not a full re-onboarding.

4. **Azure before GitHub.** Azure is required for all security work; GitHub is optional for PR workflows. The skill enforces this ordering and frames GitHub as "one more optional step."

5. **Delegates deep setup.** Basic onboarding gets users to one working Sentinel workspace. Product-by-product connectivity (Defender XDR, MDI, MDE, etc.) is deferred to `skills/msft-security/connectivity-setup.md`. No duplication.

6. **Leverages existing CLI.** The skill references `secops-squad workspace connect` (Sydnor's auto-discovery flow) and `secops-squad init --secops` rather than reimplementing workspace discovery. Falls back to manual guidance if CLI commands fail.

## Impact

- **All agents:** Should check first-run signals at session start. If signals detected, invoke this skill before doing security work.
- **Sydnor:** The skill depends on `workspace connect` and `init --secops` CLI commands — changes to those commands should update this skill.
- **Freamon/Herc:** Can assume `.secops/` exists after onboarding. No need to add their own first-run detection.
- **Users:** New users get guided setup instead of "run these 5 commands first."


### 2026-05-13T07:58:33-05:00: User directive

**By:** John Spaid (via Copilot)
**Status:** Accepted

**What:** Ground all agent personas on modern SecOps approaches. Specifically: use "Sentinel data lake" instead of "Auxiliary Logs" or "Aux Logs." ADX should only be recommended when there's a justifiable requirement. The modern default for long-term/low-cost data retention in Sentinel is the Sentinel data lake, not Aux Logs, not standalone ADX. All charters, skills, docs, and templates should reflect current Microsoft SecOps terminology and patterns.

**Why:** User request — captured for team memory


### 2026-05-13: Sentinel Data Lake Terminology Modernization

**Date:** 2026-05-13
**Author:** Freamon (KQL Engineer)
**Status:** Accepted

**Context:** Microsoft rebranded "Auxiliary Logs" to **Sentinel data lake** as the modern low-cost retention tier in Microsoft Sentinel. The secops-squad-starter-kit skills documentation used the legacy "Auxiliary Logs" terminology and positioned Azure Data Explorer (ADX) as the default recommendation for long-term retention.

**Decision:**
1. **Replace "Auxiliary Logs"/"Aux Logs" with "Sentinel data lake"** in all skills prose and documentation.
2. **Keep `'Auxiliary'` in PowerShell `ValidateSet` parameters and API calls** — this is the Azure Log Analytics Tables API parameter value. Annotate with `# Auxiliary = Sentinel data lake` comments.
3. **Reposition ADX as a specialized option**, not the default for long-term retention. Sentinel data lake is the modern default for most organizations.
4. **Standard data tiering order:** Analytics → Basic → Sentinel data lake → Archive.
5. **Standardize pricing at ~$0.75/GB ingestion** for the Sentinel data lake tier.

**Scope:** 14 files updated across log-analytics, adx, kql, platform, and powershell skill domains.

**Impact:** All squad members creating or updating skills that reference data tiers, retention strategies, or ADX migration should use "Sentinel data lake" in prose and follow the API-vs-product naming convention established here.


### 2026-05-13T07:58:33-05:00: Modern SecOps Terminology Standards

**By:** Kima (SecOps Engineer)
**Status:** Accepted

**What:** Standardized terminology across all `skills/msft-security/` and `skills/detection/` files to reflect Microsoft's modern SecOps platform:
1. **"Sentinel data lake"** is the modern low-cost retention tier (replaces "Basic Logs" / "Auxiliary Logs" as the primary term in tiering discussions). "Basic Logs" remains valid as a Log Analytics concept but Sentinel-facing docs should lead with "Sentinel data lake."
2. **Unified SOC platform** at security.microsoft.com — Sentinel + Defender XDR share a single portal experience. References to "the Sentinel portal" now acknowledge this unified option.
3. **ADX repositioned** — Azure Data Explorer is a specialized option (custom ML, cross-org federation, massive scale). Sentinel data lake is the default for long-term retention within Sentinel.
4. **Content Hub** — Portal references updated to use Content Hub as the modern deployment path for Sentinel solutions.
5. **Summary rules** — Added as a modern cost-optimization pattern (aggregate Sentinel data lake tables into compact Analytics-tier tables).

**Why:** John directed that all content reflect modern Microsoft SecOps approaches. The platform has evolved significantly — the unified SOC portal, Sentinel data lake tier, and summary rules are all GA features that should be the default guidance.

**Impact:**
- **All agents:** When referencing Sentinel portal, include the unified SOC platform at security.microsoft.com. When discussing data tiers, lead with Sentinel data lake as the modern low-cost tier.
- **Freamon:** PowerShell scripts referencing Sentinel should note the unified portal URL.
- **log-analytics skills:** Already correctly reference both "Basic Logs" and "Sentinel data lake" — no changes needed there.
- **Future skills:** Should follow these terminology standards from the start.


### 2026-05-13T07:58:33-05:00: Technology Grounding Sections in All Agent Charters

**By:** McNulty (Lead)
**Status:** Implemented

**What:** Added a `## Technology Grounding` section to all 6 agent charters (McNulty, Kima, Freamon, Herc, Sydnor, Carver) with agent-specific guidance on modern Microsoft Sentinel and SecOps patterns. Updated `team.md` project context to reflect the modern platform.

**Why:** An agent used "Aux Logs" and "ADX" as default long-term retention guidance. The modern (2025-2026) approach is **Sentinel data lake** — a low-cost, long-term retention tier within Sentinel itself. ADX remains valid but is an advanced option, not the default. The unified SOC platform (security.microsoft.com) is now the converged operational surface.

**Key Terminology Changes:**
- "Aux Logs" / "Auxiliary Logs" → **Sentinel data lake**
- ADX → advanced option requiring justification (custom ML, cross-org federation, existing investments)
- Standalone Sentinel portal → **unified SOC platform** (security.microsoft.com)

**Impact:**
- **All agents:** Must use modern terminology and default to Sentinel data lake for long-term retention guidance.
- **McNulty:** Reviews PRs for modern pattern compliance — rejects "Aux Logs" references and unjustified ADX usage.
- **Kima:** References Content Hub, unified SOC platform, Microsoft Security Exposure Management.
- **Freamon:** Aware of query differences across Analytics/Basic/Sentinel data lake tiers; uses Summary Rules for aggregation.
- **Herc:** Targets unified SOC platform APIs; playbooks query Sentinel data lake, not ADX, by default.
- **Sydnor:** IaC templates provision Sentinel data lake tables by default, ADX as optional add-on.
- **Carver:** Validates queries target correct data tier; flags tier mismatches in test coverage.

**Convention:** When the platform evolves again, apply the same pattern: update all charters' Technology Grounding sections, not just the one that triggered the issue.


### 2026-05-13T07:58:33-05:00: Terminology Modernization — Auxiliary Logs → Sentinel data lake

**By:** Sydnor (Platform Dev)
**Status:** Implemented

**What:** Updated all documentation, templates, samples, and skill files to use modern Microsoft SecOps terminology:
- **"Auxiliary Logs" / "Aux Logs" → "Sentinel data lake"** across 30+ files
- **Data tiering order** standardized to: Analytics Logs → Basic Logs → Sentinel data lake → Archive
- **ADX positioning** changed from default long-term retention to specialized option (extreme volume, full KQL on historical data, cross-team sharing)

**Key Design Choice:** PowerShell `ValidateSet` parameters and Azure API calls retain `'Auxiliary'` as the enum value (that's what the Azure REST API expects). Inline comments annotate the modern name. Display-facing strings (CLI badges, docs, YAML comments) use "Sentinel data lake".

**Impact:**
- **All agents:** Use "Sentinel data lake" in all output and recommendations. Never say "Auxiliary Logs" or "Aux Logs" in user-facing content.
- **Freamon:** PowerShell data-tiering functions keep `'Auxiliary'` in `ValidateSet` — don't change the API enum, only the comments and prose.
- **Kima/Herc:** Skills and charters already updated by McNulty's modernization pass. This completes the platform layer.
- **Templates/Samples:** `.secops/` YAML files now reference "Sentinel data lake" in tier values and comments. Contoso sample fully aligned.
