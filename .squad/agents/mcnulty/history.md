# History

<!-- Populated automatically during squad sessions. -->

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

📌 **Okta → Entra Migration Architecture** (2026-07-08T12:14:47-05:00)
- **Phase model:** Five phases (Discover → Map → Pilot/Coexistence → Cutover → Decommission) with entry/exit criteria and rollback per phase. Only Decommission has an irreversibility window post-org-deletion.
- **Coexistence source-of-truth:** Always one-way sync (Okta → Entra). No dual-write. Source-of-truth transfers per-object-class as migration completes. Federation default: Okta-as-IdP into Entra during pilot, flip after >50% apps migrated.
- **Tooling boundary (official MCP vs lib/okta vs Graph):** Official Okta MCP server = admin/write on Okta side (interactive CRUD, destructive ops with elicitation). `lib/okta` = migration read/extract (bulk export, mapping, reconciliation, state tracking, dry-run). Graph = all Entra writes. Zero overlap. `lib/okta` has no write capability on Okta; official MCP is stateless.
- **Read-first/dry-run gating:** All state-changing ops follow dry-run → human review → explicit execute → state update → audit. Default is `--dry-run`; `--execute` must be explicitly passed. Even headless CI requires pipeline approval gates for destructive ops.
- **Open-questions punch-list:** 10 decisions for x3nc0n covering tenant topology, Entra write tooling, B2B handling, MCP deployment model (interactive vs headless), PKJWT key management, MFA re-enrollment strategy, Okta Workflows scope, migration state storage, and cutover scheduling.
- **Recommended cutover default:** Phased by Application — bounded blast radius, per-app rollback, independent app-owner readiness.

📌 **Foundry Integration Critical Assessment** (2026-06-25T19:31:35-05:00)
- **External tools hallucinate runtime state from docs:** The external evaluator confused documentation prose (model names, quota status) with live config state. Always validate branch name, commit count, and file existence directly — never trust an external tool's "config analysis" without checking `git log` and `ls`.
- **Schema conflicts compound silently in scaffolding branches:** Three incompatible schemas (JSON camelCase, YAML snake_case, skill pseudo-code reading nonexistent fields) went unnoticed because there was no executable code to fail. Lesson: schema alignment tests should be written BEFORE implementation, not after.
- **Safety gates must be architectural, not advisory:** Prose-only safety policies create false confidence. Gates must be code in the call path — fail-closed, audited, tested. The ordered gate chain (cost→redact→confirm→scan→allowlist→dispatch→audit) is now a project standard.
- **Deprecation intent must be documented at creation time:** Foundry routing is explicitly temporary (bridge until Copilot catalog inclusion). Documenting this upfront prevents it from calcifying into permanent architecture.
- **Three-specialist synthesis works well for complex assessments:** Sydnor (runtime), Kima (safety), Carver (testing) each caught different classes of gap. The consolidated plan is stronger than any individual analysis.

📌 **External Skill Assimilation Orchestration** (2026-05-27T14:32:50.930Z)
- **User directive overrode domain filtering:** McNulty proposed importing 14 Microsoft-adjacent domains (~390 skills) from mukul975/Anthropic-Cybersecurity-Skills. User directive expanded scope to ALL 754 skills across all 26 domains.
- **Architecture survives scope expansion:** The `skills/community/` isolation boundary, hybrid frontmatter, deduplication rules, and vendor-at-commit model remain sound and adaptable to broader imports.
- **Key downstream gates:** Carver's deduplication report (mapping community → curated skill overlaps), domain specialist spot-checks (D3FEND mappings, Threat Hunting KQL accuracy), and McNulty's format/attribution compliance review before merge.
- **Framework coverage gains:** Full import brings D3FEND defensive vocabulary (previously absent), expanded MITRE ATT&CK technique mappings, NIST CSF alignment, and ATLAS coverage for AI/ML-assisted workflows.
- **Deduplication hotspots identified:** Security Operations (15–20 overlaps), Threat Intelligence (10–15), Incident Response (10–12), Cloud Security (12–18) — highest-risk zones requiring careful review.
- **Pattern for future large-scale imports:** When scope expands beyond initial design, preserve architecture boundaries, gate on quality reviews, and document the override decision for transparency.

### 2026-04-30: Platform Coverage Gap Analysis

- **52 skills across 6 domains** is the current inventory. Good breadth but significant depth gaps.
- **Biggest blind spot: PowerShell modules.** Zero dedicated PS skills despite SOC engineers being PS-first. `Az.SecurityInsights` and `Az.OperationalInsights` are the most critical gaps.
- **Sentinel MCP integration is the game-changer.** Without it, agents write KQL but can't execute it. Azure MCP Server exists; we need a skill for configuring and using it.
- **Unified Data Platform (Basic/Auxiliary/Summary Rules)** is where Microsoft is pushing Sentinel. Our data tiering coverage is fragmented across cost-optimization and retention-archive. Needs a dedicated skill.
- **16 critical gaps, 25 important, 15 nice-to-have** identified across 12 Microsoft platform areas.
- **4 new skill domains proposed:** `powershell/`, `mcp/`, `azure-monitor/`, `entra-id/` — all critical.
- **Customer Knowledge Framework:** Proposed `.secops/` directory structure with YAML files for environment-specific knowledge (workspaces, data sources, migrations, routing, compliance). YAML chosen over JSON/markdown for human-editability + machine-parseability.
- **Key design decision:** `.secops/` is gitignored by default (environment-specific data) and separate from `.squad/` (framework internals). Agents consult `.secops/data-sources/data-source-map.yaml` before writing queries.
- **Auto-discovery pattern:** Agents append to `.secops/discovery-log.yaml` when they find environment facts. Human review required before promoting to data-source-map.
- **Scenarios customers neglect:** Multi-tenant MSSP, Lighthouse delegation limitations, government cloud feature gaps, cross-cloud identity mapping, retention-aware queries, data residency constraints.
- **Key file:** `docs/platform-coverage-gap-analysis.md` — full analysis document.

### 2026-05-04: End-to-End Workflow Readiness Assessment

**Workflow 1 — Install Script → Personal Repo**
- Both `install.ps1` and `install.sh` correctly implement clone-strip-.git-reinit. The approach is sound; the result is a personal unlinked repo.
- `node_modules` exists. Single dependency (`js-yaml`) is in `dependencies`, not devDependencies — `--production` install works correctly.
- **Critical gap:** `init.js` line 413 tells users to run `secops-squad workspace connect` post-init, but `workspace` has no `module:` in `index.js` (lines 38–41). It falls through to the "not yet implemented" stub. This is a broken user-facing promise.
- `secops-squad.config.json` is NOT created by the install scripts — only by `init`. Running `doctor` before `init` fails by design. This is documented but not automated.
- `install.sh` has a dead-code `$?` check at line 110 — `set -euo pipefail` at the top of the file would have already exited if `git clone` failed. Non-blocking but a code smell.

**Workflow 2 — `copilot --agent secops-squad` Grounding**
- `.github/agents/secops-squad.agent.md` exists and is substantial (83.7KB).
- **Name field discrepancy:** frontmatter `name: SecOps Squad` (space) vs. filename `secops-squad.agent.md` (hyphen). If CLI matches on `name:` field, `--agent secops-squad` will silently fail. Needs verification and likely alignment to `name: secops-squad`.
- **No `.github/copilot-instructions.md`** deployed. Only `.squad/templates/copilot-instructions.md` exists (template only). Active workspace-level Copilot instructions are missing.
- `.copilot/mcp-config.json` contains only an EXAMPLE GitHub MCP server with `${GITHUB_TOKEN}`. No Azure, no Sentinel MCP. Not configured for actual use.
- Grounding sources are correct structurally: `.squad/`, `.copilot/skills/secops-environment-context.md`, `.secops/`, `skills/`. But `.secops/` is all Contoso Corp template data — no real customer context.

**Workflow 3 — Microsoft Security Product Connectivity**
- `.secops/environment.yaml` is comprehensive in schema but entirely "Contoso Corp" template. All GUIDs are fake. Gap between template state and connected state requires manual editing of 6+ YAML files.
- `secops-squad workspace connect` — does not exist (see Workflow 1 finding).
- `doctor` only checks whether Azure CLI is installed (warning, not fail). Does NOT test `az account show`, subscription access, or workspace ping.
- `.env.example` covers only Sentinel (5 variables). No variables defined for Defender XDR, Defender for Cloud, Defender for Identity, Defender for Endpoint, or Entra ID Protection.
- Skills exist for Azure AD/O365 connectors (`data-connectors-setup.md`) and cross-cloud (`cross-cloud-connectors.md`), but ZERO skills for the 6 Microsoft security products in the workflow. Kima owns this gap.
- `secops-squad env` command IS implemented (env.js has a module) — this works for reading `.secops/` state. It's not a connectivity tester but it's functional.

**Key pattern observed:** The CLI has several stub commands registered in `index.js` that fall through to "not yet implemented" — `workspace`, `status`, `playbook`, `plugin`. These need to be either implemented or clearly marked as coming soon in user output rather than silently printing a generic stub message after being advertised in init output.

### 2026-05-13: Modernization Audit — Sentinel Data Lake + Unified SOC Platform

- **Trigger:** Agent output used "Aux Logs" and "ADX" when modern default is Sentinel data lake. John directed all charters be grounded on 2025-2026 SecOps approaches.
- **All 6 agent charters** now have a `## Technology Grounding` section (inserted before `## Model`) with agent-specific modern defaults, terminology corrections, and deviation guidelines.
- **Key terminology change:** "Aux Logs" / "Auxiliary Logs" → **Sentinel data lake**. ADX repositioned from default to advanced option requiring justification.
- **Sentinel data tiering model:** Analytics Logs (full KQL, detection) → Basic Logs (limited KQL, cheaper) → Sentinel data lake (long-term, search-based) → Archive (cheapest, restore required).
- **Unified SOC platform** (security.microsoft.com) — Defender + Sentinel converged portal — added as modern operational surface across all charters.
- **Modern features referenced:** Summary Rules (Freamon), Content Hub (Kima, Sydnor), Microsoft Security Exposure Management (Kima), unified platform APIs (Herc, Sydnor).
- **team.md** project context updated to include Sentinel data lake and unified SOC platform.
- **Files modified:** `.squad/agents/{mcnulty,kima,freamon,herc,sydnor,carver}/charter.md`, `.squad/team.md`
- **Pattern:** Technology Grounding sections should be maintained as the platform evolves. Any future platform shift gets the same treatment — update all charters, not just the one that triggered the issue.

---

## 2026-06-26T04:33:44Z — Foundry Phase 1 COMPLETE: ALL MERGE GATES PASS — CLEARED FOR MERGE

Foundry integration Phase 1 completed on foundry-integration branch. All teams delivered and Carver re-verified: **Phase 1: PASS, CLEARED FOR MERGE**.

**Phase 1 Build Summary:**
- **Kima (Safety):** F-001 fail-closed fix (commit 54b32be) + P0 safety gates (commit 56e9dd3)
- **Sydnor (Platform):** Providers (commit de7e981) + dispatch orchestrator (commit 6e48348) + CLI (commit 7f63550) + F-002 redaction fix (commit faa913b)
- **Carver (Testing):** Initial verdict found F-002 (commit db80059) → re-verified all gates PASS (commit ada897c)

**Merge Gate Verdict:**
| Gate | Status |
|------|--------|
| Node.js/CommonJS, no Python | ✓ PASS |
| `npm test` 322/322 pass, coverage 82.36% | ✓ PASS |
| Schema snake_case + tests | ✓ PASS |
| Secret-scan blocks before egress | ✓ PASS |
| Fallback contract (no throw) | ✓ PASS |
| Deploy script API version verified | ✓ PASS |

**F-002 Incident:** Secret-scan exception text was leaking into returned reason. Sydnor fixed by redacting exception message; Carver verified fix resolves the issue and doesn't break fail-closed semantics.

**Recommendation:** Merge foundry-integration to main. Phase 2 (hardening gates + CI workflow) can begin independently.

Inbox merged into decisions.md. Orchestration logs in .squad/orchestration-log/. Session log in .squad/log/.

## 2026-05-08 — CLI Dependency Updates

GH CLI demoted to optional at install-time. **Your code must detect when gh is not available** (e.g., before issue routing) and **offer to help users connect it interactively** during the session. Same pattern as before but now user-guided rather than pre-required.

---

## 2026-06-26T01:07:49Z — Foundry Phase 0 EXIT GATE: PASSED

Sydnor (platform) and Carver (testing) completed Phase 0 on foundry-integration branch (commit c7f09ec).

**Status:** All three P0 quality gates PASSED:
- [x] \lib/foundry/\ exists in Node.js/CommonJS
- [x] Config loads from all 6 fixtures + auth injection verified
- [x] No Python in lib/

285/285 tests pass. Ready to merge Phase 0 or proceed to Phase 1 per your call.

Inbox merged into decisions.md. See orchestration-log/ for agent details.
