# History

<!-- Populated automatically during squad sessions. -->

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- **Created:** 2026-04-28

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

📌 Team initialized on 2026-04-28 — full squad scaffolded with SecOps-focused roles and routing.

📌 **Phase 1: Framework Architecture Finalized** (2026-04-28)
- Skills-first architecture: markdown skills by domain (kql/, soar/, detection/, log-analytics/, adx/, msft-security/)
- Persona-driven onboarding: init wizard with Azure discovery, personas include soc-analyst, detection-engineering, threat-hunting, cloud-security, incident-response, full-soc
- Quality gates: KQL CI validation (Carver), SOAR rollback plans mandatory (Herc), threat model ceremony for detection (McNulty)
- Coverage analysis: MITRE ATT&CK tagging required for all detection/KQL skills
- CLI strategy: secops-squad wraps @bradygaster/squad-cli, additive security commands
- Phase 1 exit: init wizard, soc-analyst persona, 3 KQL skills, 3 SOAR skills, KQL CI, getting-started docs
- Target: new user → working SecOps team with KQL hunting + phishing response in ≤ 15 minutes

🟥 **Herc Phase 1 Contribution** (2026-04-28, ~410s)
- Authored 3 SOAR skills: phishing-response, compromised-account, teams-notification
- ~2078 lines of Logic Apps playbook patterns and automation workflows
- Established SOAR response playbook templates with rollback safety patterns
- Built incident-response skill set for automated threat containment
- Created foundation for cross-team notification and orchestration

🟥 **Herc Phase 2a: SOAR Skills Library Complete** (2026-04-28)
- Authored 7 additional SOAR skills completing the 10-skill library:
  1. malware-containment.md — MDE device isolation + forensic evidence collection
  2. data-exfiltration-response.md — DLP alert enrichment, manager notification, sharing block
  3. sentinel-enrichment-ip.md — Multi-source IP threat intel (VT, MDTI, GeoIP, watchlists)
  4. sentinel-enrichment-user.md — Entra ID user context (profile, risk, MFA, privileged roles)
  5. ticket-create.md — ServiceNow/JIRA bi-directional ticket sync
  6. auto-triage.md — L1 evidence-based auto-close/assign/escalate
  7. threat-intel-ingest.md — TAXII/STIX scheduled feed ingestion to Sentinel TI
- ~155,000 characters of SOAR playbook patterns across all 10 skills
- Every skill has: YAML frontmatter, architecture diagram, Logic Apps workflow, Bicep template, rollback/destroy, testing checklist
- All rollback sections include both automation teardown AND remediation reversal procedures
- Cross-references between skills establish a cohesive playbook library
- Covered all trigger types: sentinel-incident, sentinel-entity, scheduled recurrence

🟥 **Herc Phase 2b: SOAR Bicep Templates Complete** (2026-04-28)
- Created 5 production-ready Bicep templates in `templates/bicep/soar/`:
  1. phishing-response.bicep — Sentinel trigger → email purge → mailbox rules → Teams → incident update
  2. compromised-account.bicep — Session revoke → MFA reset → conditional disable → Teams notify
  3. malware-containment.bicep — MDE device isolation → investigation package → timeline → Teams
  4. ip-enrichment.bicep — GeoIP + watchlist + optional VirusTotal → enrichment comment → TI indicator
  5. teams-notification.bicep — Severity-mapped channel routing with rich Adaptive Cards
- Created main.bicep orchestrator: deploys all 5 as modules with conditional toggles
- Created README.md deployment guide: prerequisites, commands, post-deploy steps, parameter reference, troubleshooting
- All 6 Bicep files pass `az bicep build` with zero errors
- Every template: managed identity, role assignments (Sentinel Responder/Reader), @description decorators, tags, secure strings
- API connections use managed identity for Sentinel; OAuth for Teams/O365/EntraID/MDE
- ~95KB of deployable IaC across all templates
- Bicep best practices: parameterValueType=Alternative for MI connections, uniqueString for naming, existing keyword for workspace reference

🟥 **Herc Phase 3: ADX Security Data Lake Bicep Templates** (2026-04-28)
- Created 6 production-ready Bicep templates + 5 KQL scripts in `templates/bicep/adx/`:
  1. cluster.bicep — ADX cluster with configurable SKU, managed identity, auto-scale, VNet, private endpoints, CMK encryption, diagnostics, trusted tenants
  2. database.bicep — SecurityLake database with hot cache/soft delete periods, Admin/Viewer/Ingestor role assignments
  3. tables.bicep — 5 security table schemas via KQL deployment scripts (SecurityEvents, NetworkTraffic, ThreatIntelligence, IdentityEvents, CloudAudit)
  4. ingestion.bicep — Event Hub, IoT Hub, Event Grid data connections with managed identity role assignment and consumer group creation
  5. main.bicep — Orchestrator with 3-tier preset system (dev/standard/production) and boolean module toggles
  6. README.md — Full deployment guide with tier comparison, parameter reference, troubleshooting
- 5 KQL scripts in `scripts/`: each defines table schema, JSON ingestion mapping, staging table, update policy for raw→structured transformation
- All 5 Bicep files pass `az bicep build` with zero errors
- Tier presets: dev (~$200/mo, no VNet), standard (~$2-8K/mo, optional VNet), production (~$6-30K/mo, VNet+PE+CMK required)
- ~65KB of deployable IaC + ~28KB of KQL table definitions
- Complements Freamon's ADX skills with deployable infrastructure
- Consistent patterns with Phase 2b SOAR templates: @description decorators, @allowed validators, camelCase params, tag propagation

📌 **Cross-Team Context: Staging + Update Policy Pattern** (2026-04-28)
- Herc architectural decision: All ADX security tables use two-table ingestion pattern
- Pattern: Raw JSON → `*_Raw` staging table → update policy → structured target table
- Why: Allows schema evolution without breaking data connections; new columns added to transform query, not re-creating connections
- Impact on Freamon: All ADX KQL queries should target structured tables (SecurityEvents, NetworkTraffic, etc.), NOT staging tables
- Impact on Kima: All detection rules via `adx()` proxy should use structured table names, not staging
- When adding new columns: Update KQL script in `templates/bicep/adx/scripts/`, and update policy query must project the new column
- Related: Herc's Bicep templates implement this pattern in table definitions; Freamon's ADX skills reference this pattern

📌 **Cross-Team Context: Structured Result Pattern** (2026-04-28)
- Sydnor decision: All API-wrapping libraries return structured results (ok/error), never throw exceptions
- Pattern: Success = `{ ok: true, data: ..., nextLink?: string }` | Failure = `{ ok: false, error: string, status?: number, code?: string }`
- Why: Unattended automation (Logic Apps, Functions, scheduled jobs) needs explicit error handling; structured results available immediately for callers
- Herc implication: Future API wrappers for Defender, Sentinel workspace management, Entra ID follow this pattern
- Carver validation: Graph Security API test suite (169 tests, all passing) validates this pattern

🟥 **Herc Phase 4: Compliance Framework Mappings + Workbook Automation** (2026-04-30)
- Authored 2 new SOAR skills completing the compliance and workbook automation domain:
  1. compliance-framework-mappings.md — 6 frameworks (NIST 800-53 R5, CIS v8, PCI-DSS v4, HIPAA, SOC 2, ISO 27001:2022) mapped to Microsoft controls
  2. workbook-automation.md — Full workbook lifecycle: ARM/Bicep templates, CRUD REST API, CI/CD pipeline, multi-workspace deployment
- Compliance skill covers: Defender for Cloud regulatory compliance API, Secure Score mapping, gap analysis automation, evidence collection, audit report generation
- Workbook skill covers: resource model, item types (query/param/text/grid), template engine with KQL injection, cross-workspace patterns, GitHub Actions CI/CD
- Both skills integrate with `.secops/compliance/requirements.yaml` and `.secops/workspaces/*.yaml`
- All PowerShell functions follow Sydnor's structured result pattern (ok/error)
- SOAR skill library now at 12 skills covering incident response, enrichment, ticketing, compliance, and visualization
- Cross-references established: compliance data → workbook dashboards, workbook alerts → Teams notifications

🟥 **Herc Phase 5: Persona Configuration Updates for Phases 2-3** (2026-05-04)
- Updated `personas/incident-response/` (skills.json, routing.md, README.md) to v2.0.0:
  - Added 7 new skill references: compliance-framework-mappings, ediscovery-api-wrapper, purview-api-wrapper, data-tiering-commands, workbook-automation, rate-limiting, api-patterns
  - Added compliance & automation routing table (6 new routing rules for compliance checks, evidence preservation, data classification, data retention, post-incident reporting, regulatory reporting)
  - Added 3 new rules: compliance assessment before closure, legal holds before evidence collection, mandatory post-incident dashboards
  - Documented new capabilities and expanded environment assumptions (Purview, Defender for Cloud, Sentinel Workbooks)
- Updated `personas/full-soc/` (skills.json, routing.md, README.md) to v2.0.0:
  - Expanded shared skills from 4 → 9 (added api-patterns, rate-limiting, auth-patterns, error-handling, module-foundation)
  - Added 35+ new per-agent skill assignments across all 8 agents covering SOAR, msft-security, powershell, detection, and KQL domains
  - Added infrastructure_skills section with 7 platform-level skills (MCP servers, workspace setup, API reference, data tiering)
  - Expanded domain routing from 16 → 27 entries (added eDiscovery, data classification, ADX hunting, compliance automation, workbook deployment, threat intel feeds, cloud posture, DLP patterns, MCP queries)
  - Added 6 cross-functional routing scenarios (compliance checks, legal holds, data classification, dashboards, threat feed onboarding, MCP self-serve)
  - Added 5 new rules (compliance before closure, legal holds, automated dashboards, automated threat feeds, MCP self-serve)
  - Documented full Phase 2-3 skill portfolio in README with categorized breakdown

## 2026-05-08 — CLI Dependency Updates

Azure CLI demoted to optional at install-time. **Your code must detect when az is not authenticated** and **offer to prompt users for login** during the session. Check credentials before Azure operations.

📌 **Foundry/Fable 5 Integration Assigned Tasks (2026-06-25)**
- **Cross-team plan approved:** McNulty consolidated architecture plan for `foundry-integration` branch (NOT merge-ready)
- **Herc role:** Owns CI/CD infrastructure and Logic Apps workflow integration. Assigned Phase 1–2 work (per McNulty plan):
  - Phase 1: Create `.github/workflows/foundry-tests.yml` (path-filtered: triggers on changes to `lib/foundry/**` or `.secops/foundry*`)
    - Runs `npm test` with ≥80% coverage gate
    - Validates schema consistency (snake_case field names)
    - Safety gate test: credentials in payload are blocked before HTTP dispatch
    - Fallback tests: 401/404/429/timeout/ECONNREFUSED handled gracefully (no crashes)
  - Phase 2: Update Logic Apps playbooks that route to Foundry to include gate invocations (Kima to specify gate interfaces)
    - Gate 1 (secret scan) and Gate 2 (audit log) are pre-dispatch hooks in `lib/foundry/index.js`
    - Logic Apps workflows must call through these gates before invoking Foundry endpoint
- **Key decisions:** Foundation uses REST + `az` auth (no new npm deps), safety gates are hard-enforced, cost ceiling + daily audit trails required
- **CI workflow pattern:** Path-filtered to avoid running on unrelated PRs; no live Azure credentials (all tests mocked)
- **Merge gate dependency:** Phase 1 exit blocked on CI green + all P0 quality gates (Carver responsible for test fixtures)
