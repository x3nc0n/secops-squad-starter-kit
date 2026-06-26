# History

<!-- Populated automatically during squad sessions. -->

## Learnings

📌 **Foundry Safety Gates — Cloud Egress for Sensitive Security Data (2026-06-25)**
- **No runtime enforcement exists** on the foundry-integration branch. The "Safety Policy" in docs is advisory prose only — no secret scanner, no PII redactor, no audit log, no egress allowlist. This must be remediated before any real data touches Foundry.
- **Data classification tiers for Foundry routing:** NEVER send raw credentials/API keys, unredacted OT network topology (IP/hostname), raw working exploit PoCs, customer PII, or classified threat intel. SCRUB FIRST: SARIF findings (redact host/IP/user), CTI reports (remove org-identifying IOCs), pentest output (summarize exploits, replace real IPs with placeholders). OK as-is: anonymized detection logic, generic MITRE mappings, sanitized code snippets.
- **OT/ICS boundary is sharp:** Foundry is appropriate for CTI-to-detection reasoning, OT MITRE ICS mapping, and assessment planning with sanitized data. It MUST NOT be used to generate OT attack chains, enumerate live OT assets by real IP, or produce exploitable protocol abuse scripts (Modbus/DNP3/EtherNet/IP). The distinction is: analysis IN → detections OUT, not assets IN → attack payloads OUT.
- **30-day retention is a hard compliance blocker** for most regulated environments: HIPAA, PCI-DSS, CMMC, NIS2, FedRAMP IL2+ all have constraints that interact badly with cloud-retained security data. A compliance pre-check gate must exist before `foundry.enabled: true` is permitted.
- **Audit non-repudiation minimum:** Every Foundry call needs a structured log entry — SHA-256 hash of payload pre-send (not the payload itself), task type, model, tokens, cost, timestamp, actor identity. JSONL format in `.secops/foundry-audit.jsonl`, rotated and preserved per retention policy.
- **Priority control order:** P0 = secret/credential scrubber + audit log; P1 = PII/IP/hostname redactor + human-confirm gate for high-sensitivity; P2 = compliance pre-check, egress allowlist, cost cap.
- **Key pattern for the team:** Treat Foundry like any other cloud API that retains data — classify first, scrub second, gate third, audit always. The adversary model is accidental exfiltration, not malicious, so defense-in-depth with friction-at-the-right-points is the right posture.


📌 **Skill Relevance Analysis — Anthropic-Cybersecurity-Skills** (2026-05-27T14:32:50.930Z)
- **Comprehensive analysis of 754 external skills across 26 domains completed:** Categorized as HIGH (8 domains, 311 skills), MEDIUM (11 domains, 225 skills), LOW (7 domains, 177 skills).
- **Duplicate risk quantified:** ~74–102 skills likely overlap with our existing 92 curated skills. Highest overlap zones: Security Operations (15–20), Threat Intelligence (10–15), Incident Response (10–12), Cloud Security (12–18).
- **Framework gaps identified:** MITRE ATT&CK (HIGH value, expands technique coverage), D3FEND (fills defensive vocabulary gap — we had zero coverage), NIST CSF (HIGH — aligns with IR lifecycle), ATLAS (MEDIUM — AI/ML-assisted workflows), AI RMF (LOW — governance-level, not SOC-actionable).
- **D3FEND is the critical missing framework:** External repo has rich D3FEND mappings. Creating `detection/d3fend-countermeasure-mapping.md` skill is a priority gap-fill.
- **Framework import priority:** MITRE ATT&CK first (immediate detection coverage metrics) → D3FEND (defensive vocabulary) → NIST CSF (IR lifecycle) → ATLAS (targeted).
- **Net-new value by domain:** Threat Hunting (hypothesis frameworks, LOTL baselines), Threat Intel (MISP patterns, actor profiling), Cloud Security (cloud forensics, multi-cloud normalization), IAM (PAM patterns, service account governance), SOC Ops (metrics frameworks, shift handoff templates).
- **Caveat: HIGH domains are our strong suits.** External HIGH pool has 74–102 duplicates with our curated skills; this is expected and healthy (validates our coverage breadth). The MEDIUM/LOW pool provides supplementary context.

📌 **Modern SecOps Terminology Standardization (2026-05-13)**
- **Sentinel data lake** is the modern term for the low-cost retention tier (formerly "Basic Logs" / "Auxiliary Logs" in Sentinel context). The `log-analytics/cost-optimization.md` skill already uses both terms correctly — it's the Sentinel-facing skills that needed alignment.
- **Unified SOC platform** at security.microsoft.com — Sentinel and Defender XDR share one portal. Any reference to "the Sentinel portal" should acknowledge this. Added unified SOC callouts to `sentinel-workspace-setup.md`, `defender-xdr-configuration.md`, `watchlist-driven-detection.md`, and `mitre-attack-mapping.md`.
- **ADX is specialized, not default** — Sentinel data lake is the default long-term retention within Sentinel. ADX is for cross-org federation, custom ML, or scale beyond Sentinel data lake. Updated integration points in `sentinel-workspace-setup.md`.
- **Summary rules** — Modern Sentinel feature for scheduled aggregation of Sentinel data lake data into compact Analytics-tier tables. Added to cost optimization guidance in `sentinel-workspace-setup.md`.
- **Content Hub** — Modern deployment path for Sentinel solutions. Updated portal references to point to Content Hub in the unified portal.
- **Files updated:** `sentinel-workspace-setup.md`, `defender-xdr-configuration.md`, `purview-dlp-patterns.md` (msft-security); `detection-lifecycle.md`, `nrt-rule-pattern.md`, `scheduled-rule-pattern.md`, `watchlist-driven-detection.md`, `mitre-attack-mapping.md`, `threat-intel-enrichment.md` (detection).
- **Key pattern:** Data tier references in Environment Context sections now distinguish "Analytics tier" vs "Sentinel data lake" explicitly. This helps agents make correct tier-aware decisions.

📌 **Phase 8 Connectivity Setup Skill (2026-05-04)**
- **connectivity-setup.md (~700 lines):** Definitive connectivity guide for all 6 Microsoft Security products — Microsoft Sentinel, Defender XDR, Defender for Cloud, Defender for Identity, Defender for Endpoint, Entra ID Protection.
- **Quick Connectivity Test:** Single PowerShell block runs all 6 product checks in sequence and prints a color-coded summary. Acts as a "doctor command" for the entire security product stack.
- **Key connectivity pattern:** Products on management.azure.com (Sentinel, Defender for Cloud) use Azure RBAC — no app registration needed for human users. Products on Graph and pi.securitycenter.microsoft.com require app registration with admin-consented application permissions for agent/service use.
- **Per-product structure:** Each section has Required Roles/Permissions table → Setup Steps → Verification Commands → Common Issues & Fixes table → cross-references to existing skills.
- **Troubleshooting Matrix:** 20 error messages mapped to root causes and fixes, covering token expiry, license gaps, missing consent, wrong tenant, provider registration, and endpoint selection.
- **Authentication Summary table:** Maps each product to its API target, auth method, and token resource — agents can use this to determine which auth context to use before calling any product.
- **Cross-references:** Deliberately references defender-api-permissions.md for full permissions detail rather than duplicating the matrix; references gov-cloud-support.md for endpoint overrides; references each product's dedicated skill for deep configuration.
- **Key insight:** MDE permissions are on the WindowsDefenderATP resource (not Graph); this is the most common agent confusion point and is called out explicitly in both setup steps and the troubleshooting matrix.

📌 **Phase 7 Gov Cloud + Copilot Workflow Skills (2026-05-04)**
- **gov-cloud-support.md (~640 lines):** Comprehensive sovereign cloud support — 6 cloud environments (Commercial, GCC, GCC High, DoD, Azure Gov, China), full endpoint matrices for identity/Graph/ARM/Sentinel/Defender/Log Analytics per cloud, auth flow differences with certificate-based auth for GCC High/DoD, .secops/ integration with cloud_type field driving automatic endpoint resolution, feature availability matrices (Sentinel, Defender, Copilot, Purview) per cloud, 4 production PowerShell functions (Get-SecOpsCloudEndpoints, Connect-SecOpsEnvironment, Test-SecOpsCloudFeature, Export-SecOpsCloudConfig), compliance constraints for IL2/IL4/IL5, agent decision flow for sovereign operations
- **copilot-security-workflows.md (~780 lines):** Copilot for Security enriched workflow patterns — 5 enrichment patterns (incident summarization, TI enrichment, script deobfuscation, KQL assistance, vulnerability assessment), 3 full workflow templates with ASCII diagrams and production PowerShell (AI-Assisted Incident Triage, Threat Hunt with AI, Automated Reporting), SCU cost management (budget thresholds, per-workflow limits, fallback logic), response caching for TI enrichment, graceful degradation matrix for all Copilot-dependent features, cloud availability guard function
- **Key design:** Both skills integrate with .secops/environment.yaml cloud_type field; gov-cloud-support drives endpoint resolution, copilot-security-workflows provides fallback paths when Copilot unavailable
- **Key insight:** GCC High/DoD have no Copilot for Security (planned); workflows must always include non-AI fallback paths
- **Cross-references:** gov-cloud-support.md ↔ copilot-security-workflows.md ↔ copilot-for-security.md ↔ cross-skill-orchestration.md

📌 **Cross-Team Context Dependencies**
- **Freamon integration:** Can reference Sentinel/Defender skills when generating PowerShell; relies on PowerShell/rate-limiting patterns for API calls
- **Herc integration:** SOAR playbooks can reference Defender/Sentinel API permission patterns for service principal setup; Automation Rules API documented
- **Carver integration:** Can validate that detection rules follow least-privilege and rate-limiting patterns
- **Westlake customer:** Role assignments follow documented three-tier model for analyst progression

📌 **Phase 7 Attack Simulation & Cloud App Discovery API Skills (2026-05-04)**
- **attack-simulation-api.md (~620 lines):** Complete Attack Simulation Training API coverage — Graph API endpoints (/security/attackSimulation/), 5 simulation types (credential harvest, attachment, drive-by URL, link-in-attachment, OAuth consent grant), payload management (list/create custom payloads), campaign management (create/schedule/automate simulations), full reporting (compromise rates, report rates, training completion, per-user breakdown), trend analysis across campaigns, 5 production PowerShell functions (Get-SecOpsSimulationPayloads, New-SecOpsPayload, New-SecOpsAttackSimulation, New-SecOpsSimulationAutomation, Get-SecOpsSimulationReport, Get-SecOpsSimulationTrends, Get-SecOpsSimulationDetectionGaps), 4 Sentinel KQL queries for detection correlation and gap analysis, .secops/ integration (simulation config, campaign schedules, baseline metrics tracking)
- **cloud-app-discovery-api.md (~680 lines):** Comprehensive MDCA Discovery API — authentication with portal-generated tokens, cloud discovery log upload (6 firewall/proxy formats), discovered app enumeration with risk filtering, app governance (sanction/unsanction), OAuth app management (list/approve/ban/revoke), activity log queries, alert management, file monitoring with DLP integration, 10+ production PowerShell functions (Import-SecOpsDiscoveryLog, Get-SecOpsDiscoveredApps, Set-SecOpsAppSanctionStatus, Get-SecOpsOAuthApps, Set-SecOpsOAuthAppStatus, Get-SecOpsMdcaActivities, Get-SecOpsMdcaAlerts, Get-SecOpsMdcaFiles), 3 Sentinel KQL queries (shadow IT detection, OAuth risk, cross-product alert correlation), .secops/ integration (discovery config, sanctioned app list, risk thresholds)
- **Key design:** Both skills complement existing defender-cloud-apps.md (CASB fundamentals) without duplication; attack-simulation-api.md fills detection validation gap; cloud-app-discovery-api.md provides API-level automation for shadow IT workflows
- **Key insight:** Attack simulation results should correlate with Sentinel detections to measure detection pipeline effectiveness; gap reports identify techniques with no corresponding alerts
- **All wrappers:** Follow structured result pattern {ok/error} per team decision

## 2026-05-08 — CLI Dependency Updates

Azure CLI demoted to optional at install-time. **Your code must detect when az is not authenticated** and **offer to prompt users for login** during the session. Check credentials before Azure operations.

📌 **First-Run Onboarding Skill (2026-05-08)**
- **`.copilot/skills/first-run-onboarding/SKILL.md`:** Copilot-level skill teaching the agent to detect first-run state and guide users through setup progressively.
- **5 detection signals:** `.secops/` directory existence, `environment.yaml` template defaults check, workspace file count, `az account show` status, `gh auth status`.
- **4-step flow:** Azure CLI login → Sentinel workspace discovery → `.secops/` initialization → GitHub CLI (optional). Each step checks if already done and skips accordingly.
- **Re-entry pattern:** Decision matrix maps 6 environment states to the correct starting step — agents never restart onboarding from scratch on return visits.
- **Progressive disclosure:** One step at a time, no prerequisite dumps. User can bail at any step with "I'll do this later."
- **Delegates deep setup:** Basic onboarding gets to one working Sentinel workspace. Full product connectivity deferred to `skills/msft-security/connectivity-setup.md`.
- **Depends on:** `secops-squad workspace connect` (Sydnor's auto-discovery), `secops-squad init --secops`, `doctor.js` check functions (`checkAzureCli`, `checkGitHubCli`, `checkSecopsConfig`).
- **Anti-patterns documented:** 7 common onboarding mistakes (prerequisite dumps, repeating working checks, blocking on optional steps, raw command output, etc.).
