# History

<!-- Populated automatically during squad sessions. -->

## Learnings

[CMD] **Foundry Fable-5 Activation Draft PR** (2026-07-08)
- **Draft PR opened:** Branch `feat/foundry-fable5-activate` off `origin/main` with draft PR #4 https://github.com/x3nc0n/secops-squad-starter-kit/pull/4 — "feat(foundry): activate Claude Fable 5 (draft — pending quota grant)". Ready to merge once Azure quota is granted and deployment reaches Succeeded.
- **Config delta applied to `.secops/foundry.yaml`:** `active_model` changed from `o4-mini` → `claude-fable-5`; `model_deployments` reordered so `claude-fable-5` is index [0]; `claude-fable-5` status changed from `pending_quota` → `active`; `o4-mini` status changed from `active` → `standby`.
- **Doc updates:** `docs/foundry-fable5-integration.md` Status section updated from "Optional & Deprecated-When-in-Catalog" to "Active Model (Azure deployment pending quota grant)" — wording reflects quota was requested 2026-07-08, Azure deploy not yet live.
- **Merge checklist:** (1) Confirm Azure TPM quota for `AIServices.GlobalStandard.claude-fable-5` (SC-OnlineLZ-00/eastus2) is granted; (2) run `scripts/deploy-foundry-fable5.ps1` and confirm provisioningState=Succeeded; (3) smoke-test inference against endpoint; (4) mark PR ready and merge.
- **Branch hygiene:** Used explicit `git add -- <path>` (never `git add -A`) to avoid staging unrelated untracked files (`--update/`, `.squad/skills/`, `docs/m365-copilot-sentinel-logging.md`, `templates/bicep/README.md`).

[CMD] **Community Skill Import — Full 754-Skill Batch** (2026-05-27T14:32:50.930Z)
- **Executed full import of 754 skills from mukul975/Anthropic-Cybersecurity-Skills:** Created `scripts/import-community-skills.js` to fetch, filter, flatten, and transform upstream content into hybrid frontmatter.
- **Hybrid frontmatter preserved all framework metadata:** MITRE ATT&CK, NIST CSF, NIST 800-53, CIS Controls, ATLAS mappings all retained in frontmatter for compliance/detection alignment.
- **Attribution compliance (Apache-2.0):** Created `skills/community/NOTICE.md` with source commit SHA (pinned for reproducibility), original author roster, and license pointer. Per-skill `author:` fields untouched.
- **Deduplication strategy activated:** Skills overlapping curated content marked with `superseded_by:` field; no deletion, enables reference. Curated skills remain single source of truth.
- **Directory isolation confirmed:** All 754 skills landed in `skills/community/{subdomain}/` — curated domains untouched, clear provenance boundary.
- **Commit f43f848:** Full import with 754 skills across 45 subdomains (more granular categorization than upstream 26 domains).
- **Downstream sync path established:** `scripts/import-community-skills.js` is the canonical import tool. Future upstream refreshes: fetch new commit SHA, re-run script, diff results, open PR. Carver validates deduplication.
- **Architecture resilience:** McNulty's strategy (vendor model, hybrid format, isolation, attribution) proved adaptable when user directive expanded scope from 14 to 26 domains.

[CMD] **Terminology Modernization — Auxiliary Logs → Sentinel data lake** (2026-05-13T07:58:33-05:00)
- "Auxiliary Logs" / "Aux Logs" is now **Sentinel data lake** in modern Microsoft SecOps terminology.
- Azure API still uses `'Auxiliary'` as the tier value — PowerShell `ValidateSet` parameters keep `'Auxiliary'` but add inline comments noting the modern name.
- Modern data tiering order: Analytics Logs → Basic Logs → Sentinel data lake → Archive.
- ADX is repositioned as a specialized option (extreme volume, full KQL on historical data, cross-team sharing). Sentinel data lake is the default for long-term retention.
- `cli/commands/env.js` displays `Sentinel DL` badge for Auxiliary tier tables.
- Key files touched: 30+ files across docs/, .secops/, samples/, skills/, templates/, cli/. Pattern: surgical find-and-replace, preserve Azure API values in code.
- Contoso sample fully updated: migrations, data-source-map, workspaces, compliance, discovery-log all use "Sentinel data lake" terminology.

[CMD] **Install & Onboarding Overhaul** (2026-05-08T16:41:19.514-05:00)
- Removed `Ensure-GhCopilotExtension` from `install.ps1` entirely — gh-copilot is no longer an extension, `copilot` CLI is standalone.
- Demoted `gh` CLI from required to optional in `install.ps1`; install no longer fails when gh is absent.
- New next-steps message: `cd $InstallDir` + `copilot --agent secops-squad --yolo`. Two commands, no auth prerequisite.
- `install.sh` simplified: removed PATH export block and `node cli/index.js` instructions; same two-command flow.
- `README.md` prerequisites table now lists `copilot` CLI as required, `gh`/`az` as optional (connected during use). `--yolo` is promoted to primary command.
- `cli/commands/doctor.js` — added `checkCopilotCli()` (required; runs `copilot --version`); reordered checks: Node → Git → copilot CLI → config → team → gh → az → azure-login → secops → skills → KQL.
- Key pattern: gh CLI and az CLI are deferred to agent-assisted interactive setup, not install-time blockers.

[CMD] **Full Dependency Bootstrap** (2026-05-08T16:21:48.253-05:00)
- Rewrote `install.ps1` from partial prereq checker to full bootstrap for fresh Windows installs.
- Dependency chain: winget (detect) -> Git -> Node.js 18+ -> GitHub CLI -> gh-copilot extension -> Azure CLI (optional).
- `Refresh-Path` helper reloads `$env:Path` from Machine+User registry after winget installs so tools are immediately available in the current session.
- `Ensure-Command` pattern: check command -> if missing + winget available, auto-install -> verify again -> fall back to manual URL. Keeps idempotent behavior.
- `Ensure-GhCopilotExtension` uses `gh extension list` to detect, `gh extension install github/gh-copilot` to install. Skipped if gh itself not available.
- GitHub CLI promoted from optional to required (needed for squad issue mode, copilot extension).
- Post-install message now shows: `gh auth login` -> `secops-squad workspace connect` -> `copilot --agent secops-squad`.
- README prerequisites simplified to "install script handles everything" -- removed manual Node.js/Git install instructions and `node --version` validate step.
- All strings remain ASCII-only, UTF-8 BOM preserved, zero parse errors under PS5.1.

[CMD] **Workspace Connect Auto-Discovery** (2026-05-08T16:09:41.073-05:00)
- Rewrote `cli/commands/workspace.js` `connect()` from manual prompts to Azure auto-discovery flow.
- New flow: check az CLI → auto-login → pick subscription → discover Log Analytics workspaces → check Sentinel via SecurityInsights solution REST call → user picks → write `.secops/workspaces/<name>.yaml` + update `environment.yaml`.
- Sentinel detection: `az rest --method get` against `Microsoft.OperationsManagement/solutions/SecurityInsights({workspaceName})` — 200 = enabled, error = not.
- `execAz()` helper replaces `execSafe()` with configurable timeout (30s default, 120s for login), `inherit` stdio for interactive `az login`, and `allowFail` for non-fatal checks.
- Workspace YAML now uses `subscription` (not `subscription_id`) and `workspace_id` (customerId GUID) to match example-workspace.yaml schema.
- Resource group extracted from workspace ARM resource ID via regex on `/resourceGroups/([^/]+)/`.
- If no Sentinel workspaces found, falls back to showing all LA workspaces with a warning.
- `status()` and `disconnect()` functions unchanged.

[CMD]**CLI Shim + PATH Auto-Setup** (2026-05-08T16:08:28.643-05:00)
- Created `secops-squad.cmd` in project root: `@echo off / node "%~dp0cli\index.js" %*`. Standard Windows batch wrapper pattern.
- `install.ps1` now adds `$InstallDir` to both session PATH (`$env:Path`) and persistent user PATH (`[Environment]::SetEnvironmentVariable`). Both are idempotent (checks `-notlike "*$InstallDir*"` before adding).
- Post-install message simplified: tells users to run `secops-squad init` directly, mentions restarting other terminals for PATH propagation.
- All strings are ASCII-only, no em-dashes or emoji in comments. Validated with PS5.1 parser.

🔷 **PS5 Encoding Fix** (2026-05-08T15:50:14.020-05:00)
- PowerShell 5.1 reads UTF-8 files without a BOM as ANSI (Windows-1252). Multi-byte Unicode characters (emoji, box-drawing) become garbled, breaking string parsing and causing cascading `UnexpectedToken` errors.
- Fix: replaced all non-ASCII characters in `install.ps1` with ASCII equivalents (`[OK]`, `[FAIL]`, `[WARN]`, `+---+`/`|` box) and re-saved with UTF-8 BOM (`EF BB BF`).
- Both fixes applied together for maximum robustness: ASCII content survives any encoding interpretation, and the BOM ensures PS5 reads UTF-8 correctly if Unicode is ever reintroduced.
- Verified with `[System.Management.Automation.Language.Parser]::ParseFile()` — zero parse errors.

🔷 **Update Command** (2026-05-08T15:06:07.002-05:00)
- Created `cli/commands/update.js` — adds `starter-kit` git remote, fetches, and merges `starter-kit/main` with `--allow-unrelated-histories`.
- Registered in `cli/index.js` as the `update` command with module path `./commands/update.js`.
- Pre-flight checks: verifies git repo, refuses to run with uncommitted changes, handles existing remote gracefully.
- Merge conflict path: exits with instructions for manual resolution instead of crashing.
- README.md updated: new "Updating" section after Quick Start, and row added to All Commands table.
- Pattern: sync command using `child_process.execSync`, same ANSI color helpers as other commands, `run()` export.

🔷 **Starter-Kit Clone Guard** (2026-05-08T11:39:37.415-05:00)
- Added `[!WARNING]` callout in README.md Quick Start section (before "### 2. Install") telling users not to clone the repo directly.
- Added `isStarterKitRepo()` detection in `cli/commands/init.js` — checks `.git/config` for "secops-squad-starter-kit" remote URL and `package.json` for `@secops-squad/secops-squad-starter-kit` name.
- Warning prints after `printBanner()` but does NOT block execution — informational only.
- Install URLs point to `x3nc0n/secops-squad-starter-kit` repo (the GitHub remote name, not the local folder).

📌 **Framework Architecture Complete**— Skills-first architecture (domain-sorted .md files), persona-driven onboarding, CLI with plugin system, init wizard, environment context framework (.secops/).

📌 **CLI Built** — `secops-squad` wraps @bradygaster/squad-cli. Commands: init (wizard), doctor (health check), skill (list/add), persona (list/switch), kql-validate, playbook (deploy), plugin (install/list/remove), env (validate/.secops/ tooling). Zero external deps except js-yaml for YAML parsing.

📌 **`.secops/` Framework** — Customer knowledge layer (tenants, workspaces, data sources, compliance, routing). 16 files, 6 subdirectories, schema v1.0 with examples. Separate from `.squad/` (framework internals). All agents read `.secops/` for environment context before operations.

📌 **Orchestration Skills Established** — `skills/orchestration/` and `skills/platform/` domains cover multi-skill workflows, multi-tenant support, API orchestration patterns, and MSSP scenarios.

📌 **Sample Config** — Contoso Corp demo under `samples/secops-contoso/.secops/` — 13 files, 2 tenants, cross-cloud, full compliance + discovery log.

📌 **Agent Integration** — `.copilot/skills/secops-environment-context.md` teaches all agents the 7-step discovery flow. All 6 agent charters updated with environment context requirement.


🔷 **Install Directory Rename** (2026-05-07T12:45:11.843-05:00)
- Default install directory changed from `~/secops-squad-starter-kit` to `~/secops-squad` in both install.ps1 and install.sh.
- Banner text, status messages, and git init commit message updated to drop "-starter-kit" suffix.
- README.md and docs/getting-started.md updated for new install path.
- GitHub repo URL (`x3nc0n/secops-squad-starter-kit`) intentionally preserved — only the local folder name changed.
- `SECOPS_SQUAD_DIR` env var override in install.sh still works as before.

🔷 **CLI Readiness Fixes — 8 issues resolved** (2026-05-04T16:45:02.077-05:00)
- **FIX 1:** `cli/commands/init.js` — corrected post-init message from broken `secops-squad workspace connect` to `secops-squad env validate`.
- **FIX 2:** Created `cli/commands/workspace.js` — full `connect` / `status` / `disconnect` implementation. `connect` prompts for workspace name, resource group, subscription; writes `.secops/workspaces/{name}.yaml` and updates `environment.yaml` default_workspace. `status` reads config and optionally verifies `az account show`. `disconnect` clears default_workspace while preserving the workspace file. Wired into `cli/index.js` with `module:` field.
- **FIX 3:** `.github/agents/secops-squad.agent.md` frontmatter — changed `name: SecOps Squad` to `name: secops-squad` to match filename stem for `--agent` flag matching.
- **FIX 4:** Created `.github/copilot-instructions.md` from template — provides Copilot coding agent instructions for picking up squad issues.
- **FIX 5:** `cli/commands/doctor.js` — added `checkAzureConnectivity()` (runs `az account show`, shows subscription/tenant details, warns if not logged in) and `checkSecopsConfig()` (checks `.secops/environment.yaml`, warns if using "Contoso Corp" defaults or missing). Added `js-yaml` import. Both inserted after `checkAzureCli()`.
- **FIX 6:** `.env.example` — expanded to cover all 6 Microsoft Security products with per-section comments.
- **FIX 7:** `.copilot/mcp-config.json` — renamed key `EXAMPLE-github` to `github`, updated package to `@modelcontextprotocol/server-github`.
- **FIX 8:** `install.sh` — replaced dead `True` check (unreachable under `set -euo pipefail`) with proper `if ! git clone ...` pattern.

📌 **js-yaml must be required at top of doctor.js** — doctor.js now uses yaml.load() in checkSecopsConfig(). The import must remain.

📌 **workspace.js pattern** — connect is async (readline prompts); status and disconnect are sync. run() export is async. All three interact with .secops/workspaces/*.yaml and .secops/environment.yaml via js-yaml.

🔷 **README.md Rewrite — Squad Structure Pattern** (2026-05-04T17:12:14.241-05:00)
- Rewrote README.md to follow the bradygaster/squad README structural pattern: alpha warning → "What is X?" value prop → Quick Start with ✓ Validate steps → All Commands table → Personas → Parallel execution → Skills → .secops/ framework → Products → API Wrappers → What Gets Created (directory tree) → Samples → FAQ → Troubleshooting → Documentation (split into 3 tables: Guides, Reference, Developer) → Built On → Status
- Updated skill counts to match SKILLS_CATALOG.md (Detection: 9, Microsoft Security: 16 — corrected from 10/18 in old README)
- Removed emoji from section headers for cleaner markdown rendering (matching Squad pattern)
- Added "Agents Work in Parallel" section showing SecOps-specific parallel execution example (BEC detection scenario)
- Verified all 20 local file links resolve to existing files
- Badge updated: removed "Phase 3" (too internal), added "status: alpha" (matching Squad), kept skills-96 and Node.js badges
- README expanded from 210 to 302 lines — no content dropped, structure improved

[NEW SKILL] **First-Run Onboarding Skill** (2026-05-08T16:48:55-05:00)
- Kima created `.copilot/skills/first-run-onboarding/SKILL.md` — detects first-run signals and guides progressive onboarding.
- Skill depends on `workspace connect` (Sydnor's auto-discovery) and `init --secops` commands — changes to those CLIs should trigger skill updates.
- Decision merged to `.squad/decisions.md` under "First-Run Onboarding Skill Design".

[CMD] **Community Skill Bulk Import** (2026-05-27T09:32:50.930-05:00)
- User preference: import all 754 Apache-2.0 skills from `mukul975/Anthropic-Cybersecurity-Skills` into `skills/community/` with no domain filtering; keep community provenance separate from curated skills.
- Import pattern: flatten each source `skills/{skill-name}/SKILL.md` into `skills/community/{subdomain}/{skill-name}.md`, preserving the markdown body while transforming frontmatter into the hybrid schema.
- `scripts/import-community-skills.js` is the canonical sync tool. It requires `--source`, `--commit`, and `--imported-at`, resets `skills/community/`, rewrites frontmatter with `js-yaml`, and regenerates `skills/community/NOTICE.md`.
- Pinned source commit for this import: `0f429d0f96ee70d2a6c259c4ecc6c6e18e0d23ff`.
- Key file paths: `scripts/import-community-skills.js`, `skills/community/NOTICE.md`, `skills/community/<subdomain>/*.md`, `.squad/decisions/inbox/sydnor-community-skill-full-import.md`.