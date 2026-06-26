# History

<!-- Populated automatically during squad sessions. -->

## Learnings

📌 **Freamon Domain Summary** (2026-04-30)
- **Core expertise:** KQL queries, Log Analytics, Azure Data Explorer, PowerShell automation
- **Total contribution:** 30 skills across 6 domains (10 KQL + 10 Log Analytics + 8 ADX + 12 PowerShell) — ~9,445 lines
- **Phase 1-3:** Built foundation libraries (KQL validator, threat hunting, analytics rules, investigations)
- **Phase 4-5:** Completed infrastructure skills (Log Analytics, ADX full lifecycle with update policy patterns)
- **Phase 6 (2026-04-30):** Delivered PowerShell module foundation, Log Analytics API wrappers, data tiering commands, unified rate limiting patterns, and Sentinel API wrappers

📌 **Key Architectural Patterns Established by Freamon**
- **KQL validator library:** Pure Node.js parser in `lib/kql-validator/` validates 10 classes of errors, powers Carver's CI validation
- **PowerShell structured results:** `New-SecOpsResult` object pattern aligns team on error handling convention
- **Central REST wrapper:** `Invoke-SecOpsRestMethod` with exponential backoff, Retry-After handling, audit logging for all Microsoft APIs
- **`.secops/` auto-loading:** All modules read environment.yaml, tenants.yaml, data-source-map.yaml at init — environment-aware, no hardcoded values
- **Cloud-aware endpoints:** `Get-SecOpsCloudEnvironment` resolves commercial/GCC/GCC-High/DoD endpoints from config
- **Rate limiting as cross-cutting concern:** `rate-limiting.md` and `api-patterns.md` referenced by all API wrapper skills
- **`.secops/` compliance integration:** Tier changes validate against compliance/requirements.yaml; tier recommendations consult data-source-map.yaml volumes; data purges audit against compliance reqs

📌 **Phase 6 Decisions & Deliverables (2026-04-30)**
- **PowerShell domain creation:** 10 files establishing SecOps.Tools module architecture with 6 submodules (Sentinel, Defender, Entra, Azure Monitor, Resource Graph, Data Tiering)
- **Log Analytics API skill:** 2 files (api-wrapper, query-patterns) covering Query API, Saved Searches, Query Packs, Alerts, DCR ingestion, Webhooks, cross-workspace federation patterns
- **Data tiering commands skill:** 15 new functions for tier management, retention lifecycle, compliance auditing, purge/migration orchestration
- **Rate limiting & API patterns:** Comprehensive reference for exponential backoff, token buckets, quota pooling, circuit breaker, pagination, async operations
- **Sentinel API wrapper:** 20+ PowerShell functions covering incidents, analytics rules, TI, workbooks, connectors, watchlists with bulk operations and .secops/ integration

📌 **Phase 7 Deliverables (2026-04-30)**
- **`skills/detection/advanced-hunting-api.md`** (336 lines) — MDE/XDR/Graph API endpoints, unified schema, query packs, custom detections, Live Response session management & forensic collection, hunting patterns by MITRE ATT&CK (TA0001–TA0010), PowerShell integration with GCC-High support
- **`skills/kql/query-builder.md`** (408 lines) — Template syntax with `{{parameter}}` substitution/conditionals/iteration, pre-built templates (login anomaly, process creation, network monitoring), parameterized queries, 4-tier validation (syntax, schema, performance, injection), optimization patterns (filter-first, materialize, partition, string operator hierarchy), cross-platform differences (Log Analytics vs ADX vs Advanced Hunting), PowerShell query routing via `.secops/` integration

📌 **Cross-Team Impact**
- **Kima:** Can reference PowerShell/Sentinel/Defender skills for detection automation
- **Herc:** Azure Monitor skill aligns with SOAR playbook triggers; migration patterns complement ADX orchestration
- **Carver:** PowerShell patterns inform CI validation; KQL queries pass 100% validator test suite
- **All agents:** Rate limiting patterns are mandatory for every API call; `.secops/` context is always checked before API invocations

📌 **SOC Analyst Persona Update (2026-05-04)**
- **Task:** Updated `personas/soc-analyst/` to reference Phase 2-3 tools (requested by Jose)
- **skills.json v2.0.0:** Added 9 new skill references — `advanced-hunting-api`, `query-builder`, `workbook-automation`, `sentinel-api-wrapper`, `defender-api-wrapper`, `log-analytics/api-wrapper`, `log-analytics/query-patterns`, `copilot-for-security`, `rate-limiting`. Skills distributed across tiers: rate-limiting + copilot shared by all; Bunk gets sentinel-api; Kima gets sentinel + defender + workbooks; Freamon gets full hunting + query stack; Daniels gets workbooks.
- **routing.md:** Added Tool-Chain Routing section with task-type → skill mapping table. Documented 4 flows: Threat Hunting (KQL builder → Advanced Hunting), Investigation (Sentinel → Defender → Log Analytics → Copilot), Dashboard (workbook-automation), Alert Triage (`.secops/alerting/` rules). Added 3 new routing rules (#9-11).
- **README.md:** Documented incident lifecycle (Detect → Hunt → Investigate → Respond → Report) with tool references at each stage. Added Tool Chain diagram (KQL Builder → Advanced Hunting → Sentinel API → Workbook). Restructured Pre-Loaded Skills table to show Core vs Phase 2-3 columns. Added `.secops/` to environment assumptions.

📌 **Cross-Cloud Data Connectors Skill (2026-05-04)**
- **Task:** Created `skills/platform/cross-cloud-connectors.md` (509 lines) — comprehensive skill for ingesting security data from AWS, GCP, and multi-SIEM sources into Sentinel
- **AWS Integration:** CloudTrail (S3→SQS native connector), GuardDuty (EventBridge→S3), Security Hub, VPC Flow Logs, IAM Access Analyzer custom ingestion. Full ASIM normalization for Authentication and NetworkSession schemas.
- **GCP Integration:** Cloud Audit Logs (Pub/Sub native connector), Security Command Center, VPC Flow Logs, Chronicle→Sentinel migration patterns. ASIM Authentication parser for GCP fields.
- **Multi-SIEM:** SPL→KQL translation table (10 patterns), QRadar concept mapping (AQL→KQL, Offense→Incident), Elastic Sigma rule conversion via sigma-cli.
- **Connector Patterns:** CEF/Syslog via AMA with DCR transforms, REST API custom connectors (Push-LogsToSentinel function), CCP overview, DCR transformation KQL, DCE setup.
- **ASIM Unifying Parsers:** Cross-cloud Authentication parser (Azure+AWS+GCP in single query), threat hunting queries for multi-cloud IP targeting and cross-cloud privilege escalation chains.
- **`.secops/` Integration:** data-source-map.yaml entries for 4 AWS + 1 GCP sources, migration tracking template for SIEM migrations, discovery-log entry format.
- **Cost Optimization:** Tier selection table (6 sources), DCR volume reduction, summary rules for VPC flow aggregation, archive tier for 7-year compliance.
- **PowerShell:** Get-CrossCloudConnectorHealth (staleness detection), Test-CrossCloudIngestionVolume (drift from expected daily_gb).
- **New domain:** Created `skills/platform/` directory for platform-level cross-cutting skills.

📌 **MSSP SecOps Workflows Skill (2026-05-04)**
- **Task:** Created `skills/orchestration/mssp-workflows.md` (~554 lines) — comprehensive MSSP operating model skill building on `multi-tenant-support.md`
- **Tenant Onboarding:** Customer intake YAML template, `New-MSSPCustomerOnboarding` automated workflow (Lighthouse delegation → .secops/ provisioning → connector validation → tier-based detection deployment), `Test-CustomerDataConnectors`, `Deploy-TierDetectionRules` with Gold/Silver/Bronze rule packs
- **SOC Dashboard:** Cross-tenant incident summary KQL, SLA tracking per severity with P95 response metrics, tenant health scorecards (ingestion drops, alert fatigue ratio), `Get-MSSPDashboard` aggregation function with summary/sla/health views
- **Multi-Tenant Alerting:** Per-customer routing YAML schema (PagerDuty/Teams/email/ServiceNow channels), SLA escalation paths table, `Find-CrossTenantThreatActor` for IoC correlation across all tenants, `Set-MSSPAlertSuppression` with audit trail
- **Tenant Switching:** `Switch-MSSPCustomer` with `-PreserveState` (saves/restores analyst investigation context), `Invoke-MSSPBatchOperation` with tier filtering
- **Reporting & Compliance:** `Export-MSSPCustomerReport` (monthly metrics export), compliance evidence export (SOC 2/ISO 27001/PCI-DSS control-mapped queries), portfolio trend analysis KQL
- **Billing Integration:** Per-tenant ingestion tracking KQL, `Get-MSSPBillingSummary` (cost-per-GB by tier), `Assert-MSSPFeatureTier` enforcement
- **`.secops/` Extensions:** Full `mssp-config.yaml` schema (SOC teams, customer assignments, billing tiers, SLA definitions, analyst rotation schedules), centralized vs distributed vs hybrid config patterns
- **References:** 13 functions in Quick Reference table, cross-references to `multi-tenant-support.md` throughout

📌 **Threat Intelligence & Performance Tuning Skills (2026-05-04)**
- **Task:** Created 2 new skill documents requested by Jose
- **`skills/detection/threat-intel-enrichment.md`** (404 lines) — External TI feed integration (CISA KEV, abuse.ch, VirusTotal, Shodan, AlienVault OTX, MISP), Sentinel TI data connector paths (TAXII, Graph API, Upload), Defender TI reputation scoring, PowerShell automation (`Import-ThreatIntelFeed` multi-source orchestrator, `Get-IOCEnrichment` aggregator with multi-source confidence scoring, `Test-TIFeedHealth` monitoring), KQL correlation patterns (TI→SigninLogs join, multi-source IOC scoring, time-decay indicator freshness), `.secops/data-sources/ti-feeds.yaml` config template
- **`skills/platform/performance-tuning.md`** (363 lines) — KQL query profiling (LAQueryLogs analysis), anti-pattern table with before/after examples, materialized views and summary rules, query checklist. API wrapper optimization (connection pooling, Graph $batch requests, TTL-based caching). Rate limiter tuning (`Get-ThrottleMetrics`, tier priority config, queue depth monitoring). MCP server caching and connection health. Cost optimization (commitment tier analysis, Basic vs Analytics tier migration with `Get-TierMigrationCandidates`). `Measure-KQLPerformance` benchmarking function
- **Cross-references:** Both skills reference rate-limiting.md, api-patterns.md, cost-optimization.md, sentinel-api-wrapper.md, and .secops/ integration patterns

📌 **Sentinel Data Lake Terminology Modernization (2026-05-13)**
- **Task:** Modernized all skills documentation to replace "Auxiliary Logs"/"Aux Logs" with "Sentinel data lake" — the current Microsoft SecOps product name
- **Scope:** 14 files across 5 domains (log-analytics, adx, kql, platform, powershell)
- **Key changes:** Repositioned ADX as specialized option (not default for long-term retention), updated data tiering order to Analytics → Basic → Sentinel data lake → Archive, expanded tier comparison tables to include Sentinel data lake column, added summary rules references
- **API vs. product naming:** PowerShell `ValidateSet` params keep `'Auxiliary'` (Azure API value) with `# Auxiliary = Sentinel data lake` comments; prose uses "Sentinel data lake" with "(formerly Auxiliary)" parentheticals where needed for clarity
- **Pricing standardized:** ~$0.75/GB ingestion for Sentinel data lake tier across all files
- **ADX repositioning:** Added warning boxes in ADX skills noting Sentinel data lake is the modern default; migration-from-sentinel.md expanded to 3-column decision matrix (Sentinel/Sentinel data lake/ADX)

📌 **Foundry/Fable 5 Integration Assigned Tasks (2026-06-25)**
- **Cross-team plan approved:** McNulty consolidated architecture plan for `foundry-integration` branch (NOT merge-ready)
- **Freamon role:** Owns skill documentation updates for Foundry routing. Assigned Phase 1 work (per McNulty plan):
  - Update `skills/platform/foundry-model-routing.md`: Replace Python pseudo-code with Node.js runtime references, update detection to read new schema fields (snake_case `active_model`, `model_deployments[]`, `provider`, `api_path`, `reasoning_model`, `cost_ceiling_usd`), remove Anthropic/openai SDK imports (using REST + `az` instead)
  - Update `docs/foundry-fable5-integration.md`: Replace "Safety Policy" prose section with references to enforceable gates (Gate 1–7 per Kima's spec), add deprecation notice (Foundry is bridge until Fable 5 reaches Copilot catalog)
- **Key decisions:** Foundation config uses snake_case (YAML convention), no new npm dependencies, safety gates are hard-enforced before real data egress
- **Merge gate dependency:** Phase 1 exit dependent on McNulty's 6 P0 merge gates (test coverage, schema alignment, safety gate blocking credentials, fallback contract); Freamon's skill updates must reference these gates
- **Deprecation note (in Freamon's docs):** "When Anthropic Fable 5 appears in Copilot model catalog, Foundry routing is deprecated immediately and removed within one release cycle."

---

## 2026-06-26T01:07:49Z — Phase 0 Complete; Phase 1 Ready

Sydnor's Phase 0 Foundry work shipped on foundry-integration (commit c7f09ec). Carver validated all 59 new tests + 285 full suite: PASS.

**Delivered:**
- \lib/foundry/config.js\ — config loading + endpoint resolution
- \lib/foundry/auth.js\ — bearer token acquisition + caching
- \lib/foundry/fixtures/\ — 6 YAML fixtures for test coverage
- Deploy scripts fixed (API version + endpoint)
- Skills doc converted from Python to Node.js CommonJS

**F-001 deferred:** Endpoint validation (fail-closed) — Phase 1 gate before production use.

Phase 1 scope: Provider HTTP clients, public API surface.
