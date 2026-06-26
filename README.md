# SecOps Squad Starter Kit

[![Status](https://img.shields.io/badge/status-alpha-blueviolet)](#status)
[![Skills](https://img.shields.io/badge/skills-847-blue)](SKILLS_CATALOG.md)
[![Platform](https://img.shields.io/badge/platform-GitHub%20Copilot-blue)](#what-is-secops-squad)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green)](https://nodejs.org/)

> ⚠️ **Alpha Software** — SecOps Squad is under active development. Skill schemas, CLI commands, and `.secops/` format may change between releases.

---

## What is SecOps Squad?

SecOps Squad gives you a human-directed AI security operations team through GitHub Copilot. Install it into any repo. Get a team of specialists — KQL hunting, detection engineering, SOAR automation, threat modeling — that live in your repo as files. They persist across sessions, learn your environment, share decisions, and help you move faster without giving up oversight.

It's a security overlay on top of [Squad](https://github.com/bradygaster/squad). The base framework gives you agent teams. SecOps Squad adds **847 skills** across 56 security domains (92 core + 755 community-contributed), **6 personas** for different SOC roles, a **customer knowledge framework** (`.secops/`) that maps your actual infrastructure, and production-ready patterns for the entire Microsoft Security stack.

SecOps Squad is a productivity tool for security professionals, not a replacement for analysts, engineers, or incident responders. People stay accountable for response decisions, detection logic, and compliance — Squad helps with the repetition, the KQL, and the parallel execution.

It's not a chatbot wearing a SOC badge. Each team member runs in its own context, reads its own skill files, and writes back what it learned so the work stays inspectable and auditable.

---

## Quick Start

### 1. Prerequisites

| Requirement | How to get it |
|------------|---------------|
| **GitHub Copilot license** | [github.com/features/copilot](https://github.com/features/copilot) |
| **GitHub Copilot CLI** (`copilot`) | Included with GitHub Copilot — run `copilot --version` to confirm |
| **Windows 10/11 with PowerShell** | The install script handles Git and Node.js automatically via winget |

The installer handles Git and Node.js. GitHub CLI (`gh`) and Azure CLI (`az`) are optional — the agent will walk you through connecting them when you need them.

> [!WARNING]
> **Don't clone this repo directly.** Use the install scripts below — they set up a clean project with its own Git history. Cloning the starter kit directly will leave you working inside the template repo.

### 2. Install

**Windows PowerShell:**
```powershell
irm "https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.ps1" | iex
```

**macOS / Linux:**
```bash
curl -fsSL "https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.sh" | bash
```

The installer clones the repo, installs dependencies, runs persona selection, and scaffolds a working SecOps project in `~/secops-squad`. Total time: ~3 minutes.

**✓ Validate:** Run `cd ~/secops-squad && ls .squad/team.md` — you should see the team roster file.

> **Script blocked on Windows?** If you downloaded the script file (instead of piping with `irm | iex`), Windows marks it as untrusted (Mark of the Web). Fix with either:
> ```powershell
> # Option 1: Remove the block on the downloaded file, then run it
> Unblock-File .\install.ps1
> .\install.ps1
>
> # Option 2: Bypass execution policy for this one run
> powershell -ExecutionPolicy Bypass -File .\install.ps1
> ```
> If you still get an execution policy error, set RemoteSigned:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```

> **Script blocked on macOS?** If you downloaded the file via a browser, macOS adds a quarantine attribute. Remove it:
> ```bash
> # Remove quarantine flag, make executable, then run
> xattr -d com.apple.quarantine install.sh
> chmod +x install.sh
> ./install.sh
> ```
> The `curl | bash` one-liner above avoids this entirely since the script never touches disk.

### 3. Open Copilot and go

```bash
cd ~/secops-squad
copilot --agent secops-squad --yolo
```

Tell the agent what you need:

```
Help me connect my Sentinel workspace.
```

The agent walks you through Azure login, workspace discovery, and GitHub CLI auth interactively — nothing needs to be set up in advance. No Azure subscription? That's fine — detection engineering skills, threat model templates, and KQL learning work offline.

Once connected, try:

```
Hunt for suspicious sign-ins across our Entra logs from the last 7 days.
```

> [!CAUTION]
> `--yolo` mode lets the agent execute without asking for confirmation at each step. It's recommended for everyday use — but avoid it when running destructive operations in a production workspace for the first time.

---

## Optional: Deploy Fable 5 (Azure AI Foundry Add-On)

> **When is this useful?**  Fable 5's extended context makes it worth deploying when you need to review hundreds of SARIF findings at once, trace vulnerabilities across a large codebase, or reconstruct an incident timeline from many log snippets — tasks where a standard model runs out of context or misses cross-file dependencies.
>
> **DEPRECATED_WHEN:** `claude-fable-5` is available in the GitHub Copilot model catalog. At that point, this add-on is unnecessary — remove `.secops/foundry.yaml` and use the catalog model directly.

### 1. Run the bootstrap script

**Windows:**
```powershell
.\scripts\deploy-foundry-fable5.ps1 -SubscriptionName "Online" -TenantId "<your-tenant-id>"
```

**macOS / Linux:**
```bash
chmod +x scripts/deploy-foundry-fable5.sh
./scripts/deploy-foundry-fable5.sh --subscription-name "Online" --tenant-id "<your-tenant-id>"
```

Both scripts are idempotent — safe to re-run. Use `-WhatIf` (PowerShell) or `--what-if` (bash) to preview without making changes.

The script will:
1. Check `az` CLI login
2. Create resource group `rg-secops-ai` (if not exists)
3. Create an Azure AI Foundry resource (`secops-foundry`, East US 2)
4. Deploy `claude-fable-5` as `fable5-secops` (Global Standard)
5. Write `.secops/foundry.yaml` so agents auto-detect the deployment

### 2. What happens next

Once `.secops/foundry.yaml` exists with `enabled: true`, secops-squad agents automatically route deep analysis tasks (large SARIF reviews, multi-file vulnerability correlation, large codebase security reviews) to Fable 5. See [`skills/platform/foundry-model-routing.md`](skills/platform/foundry-model-routing.md) for the full routing logic and SDK patterns.

**Pricing:** $10/M input · $50/M output · 90% prompt cache discount. 30-day retention applies (Anthropic safety policy).

---

## Updating

Keep your project in sync with the latest starter-kit improvements:

```bash
secops-squad update
```

This command adds the starter-kit as a git remote (if not already present), fetches the latest changes, and merges them into your project using `--allow-unrelated-histories`. Your local customizations in `.secops/`, `.squad/`, and any other files you've changed are preserved — the merge only adds or updates starter-kit files.

If merge conflicts arise, the command will tell you which files need attention. Resolve the conflict markers, stage the files with `git add`, and run `git commit` to finish.

> [!TIP]
> Commit your local changes before running `secops-squad update` — the command will refuse to run with uncommitted changes to keep your work safe.

---

## All Commands

| Command | What it does |
|---------|-------------|
| `secops-squad init` | Set up a new secops-squad project with persona selection |
| `secops-squad init --secops` | Scaffold `.secops/` directory interactively |
| `secops-squad doctor` | Check environment prerequisites (Node.js, Git, Azure CLI, `.secops/` config) |
| `secops-squad env [validate\|workspaces\|data-sources]` | Show or validate `.secops/` configuration |
| `secops-squad skill [list\|add <name>]` | List available skills or add a skill to your project |
| `secops-squad persona [list\|switch <name>]` | List personas or switch the active persona |
| `secops-squad kql validate <file\|glob>` | Offline KQL syntax validation (~60 operators, 250+ functions, ~50 tables) |
| `secops-squad playbook [list\|deploy <name>]` | List or deploy SOAR playbooks |
| `secops-squad plugin [install\|list\|remove]` | Manage CLI plugins |
| `secops-squad workspace [connect\|status\|disconnect]` | Connect to a Sentinel workspace |
| `secops-squad update` | Pull latest starter-kit changes into your project |

See [CLI Reference](cli/README.md) for full details and flags.

---

## Personas — Pick Your SOC Role

Six specialized personas, each with its own team composition, skill routing, and ceremony cadence:

| Persona | Focus | Key Skills |
|---------|-------|------------|
| **SOC Analyst** | Triage, investigation, incident response | KQL hunting, auto-triage, enrichment |
| **Detection Engineering** | Rule authoring, KQL, MITRE ATT&CK mapping | Detection lifecycle, NRT/scheduled rules, watchlists |
| **Threat Hunting** | Proactive hunting, hypothesis-driven investigations | Advanced KQL, UEBA, cross-workspace queries |
| **Cloud Security** | Cloud posture, Defender for Cloud, identity | Cloud posture KQL, Defender policies, Entra analysis |
| **Incident Response** | IR procedures, forensics, containment | Malware containment, compromised account, data exfil |
| **Full SOC** | All skills combined for a mature SOC | Complete 847-skill library |

Each persona includes `team.md`, `routing.md`, and `ceremonies.md` for structured agent collaboration. Switch anytime with `secops-squad persona switch <name>`.

See [Personas Guide](docs/personas-guide.md) for team compositions and ceremony definitions.

---

## Agents Work in Parallel — You Stay in Control

When you give a task, the coordinator launches every agent that can usefully start — simultaneously — while you keep priorities, review, and final decisions.

```
You: "Team, build a detection for BEC phishing campaigns"

  🏗️ McNulty (Lead) — scoping requirements, MITRE mapping...    ⎤
  🔒 Kima (SecOps) — researching BEC attack patterns...          ⎥ all launched
  📊 Freamon (KQL) — writing detection query logic...            ⎥ in parallel
  ⚙️ Herc (SOAR) — building auto-response playbook...           ⎥
  🧪 Carver (QA) — writing validation test cases...              ⎥
  📋 Scribe — logging decisions...                               ⎦
```

When agents finish, the coordinator records follow-up work and leaves a breadcrumb trail:

- **`decisions.md`** — every decision any agent made
- **`orchestration-log/`** — what was spawned, why, and what happened
- **`log/`** — full session history, searchable

**Knowledge compounds across sessions.** Every time an agent works, it writes lasting learnings to its `history.md`. After a few sessions, agents know your KQL style, your workspace layout, your detection conventions. They stop asking questions they've already answered.

**And it's all in git.** Anyone who clones your repo gets the team — with all their accumulated knowledge.

---

## Skills — 847 Across 56 Domains

| Domain | Count | Examples |
|--------|-------|----------|
| **KQL Hunting & Analytics** | 11 | Threat hunting, Sentinel analytics, UEBA, Defender XDR, cross-workspace |
| **SOAR Automation** | 12 | Phishing response, compromised account, auto-triage, TI ingest, compliance |
| **Detection Engineering** | 10 | MITRE mapping, detection lifecycle, NRT rules, watchlist detection, fusion |
| **Azure Data Explorer** | 8 | Cluster architecture, data modeling, ML anomaly, dashboards, migration |
| **Microsoft Security** | 19 | Defender XDR, Sentinel, Entra, Purview DLP, MCP servers, Graph API |
| **PowerShell Modules** | 14 | Module foundation, API wrappers, auth, rate limiting, submodules |
| **Log Analytics** | 10 | Workspace architecture, DCR, data connectors, cost optimization, RBAC |
| **Platform** | 4 | Multi-tenant, GCC/GCC-H/DoD sovereign cloud, cross-cloud, performance tuning |
| **Orchestration** | 3 | Cross-skill workflows, Copilot for Security, MSSP workflows |
| **Testing** | 1 | Integration test suites for SecOps workflows |
| **Copilot Agent Skills** | 10 | Agent collaboration, git workflow, error recovery, conventions, onboarding |
| **Community Skills** | 755 | 45 sub-domains: threat hunting, cloud security, network security, malware analysis, digital forensics, identity & access, penetration testing, and more |

Every skill is a Markdown file that teaches agents how to perform a specific security operations task. Skills are composable — agents combine them dynamically based on the work.

See [**SKILLS_CATALOG.md**](SKILLS_CATALOG.md) for the complete inventory with every skill listed by domain.

---

## Customer Knowledge Framework (`.secops/`)

Skills teach agents **how** to do things. `.secops/` tells them **where** — which tenants, workspaces, data sources, and compliance boundaries exist in your specific environment.

```
.secops/
├── environment.yaml        # Tenant, subscription, regions
├── workspaces/             # Log Analytics and Sentinel workspace configs
├── data-sources/           # What data lives where, active migrations
├── identity/               # Multi-tenant topology, RBAC conventions
├── alerting/               # Alert routing rules and notification channels
├── compliance/             # Regulatory boundaries, data residency
└── discovery-log.yaml      # Agent-discovered environment facts
```

**Without `.secops/`:** Agents guess where data lives, assume single-tenant, and can't respect compliance boundaries.

**With `.secops/`:** Agents know that `SecurityEvent` is in ADX (not Sentinel), that the customer is GDPR-bound to EU regions, and that `NetFlowLogs` is mid-migration.

All 6 agent charters include a mandatory environment context step — before any task touching Azure resources, agents read `.secops/` and the [environment context skill](.copilot/skills/secops-environment-context.md) to understand the customer's infrastructure.

See [`.secops/` Schema Reference](docs/SECOPS_SCHEMA.md) for field-level documentation.

---

## Keeping Your Data Personal

SecOps Squad follows the same personal-data pattern as [Productivity Squad](https://github.com/x3nc0n/productivity-squad-starter-kit): the starter kit is a **shared template**, but your working copy is **yours** — customer data never leaves your machine or flows upstream.

### What stays personal (gitignored)

| File / Directory | Purpose |
|-----------------|---------|
| `secops-squad.config.json` | Your persona selection, workspace bindings, local preferences |
| `.secops/discovery-log.yaml` | Agent-discovered environment facts (accumulated at runtime) |
| `.squad/log/`, `.squad/orchestration-log/` | Session history — your conversations, agent traces |
| `.squad/decisions/inbox/` | Pending decisions before the Scribe merges them |
| `node_modules/` | Dependencies (reinstalled from `package.json`) |

### What's shared (committed)

Skills, team roster, agent charters, `.secops/` schema templates, CLI code, and merged decisions. These define **how** the team works — not **where** it works or **whose** data it touches.

### How it works

1. **The installer clones the starter kit** — it becomes a standalone local project, not a fork. There's no upstream to accidentally push customer data to.
2. **`.secops/` templates are committed; runtime data is gitignored.** You commit the schema (`environment.yaml`, `workspaces/`) with your tenant topology so teammates get the same structure. Discovery logs and config stay local.
3. **Agents read `.secops/` before touching Azure resources.** This means queries hit the right workspace, respect compliance boundaries, and use the correct tenant — without you repeating context every session.
4. **All data flows through your authenticated Azure / Microsoft Graph sessions.** The AI sees query results in-session but doesn't retain them after the session ends. No customer telemetry is stored in the repo or sent to third parties.

> **Want the same pattern for productivity workflows?** See [Productivity Squad Starter Kit](https://github.com/x3nc0n/productivity-squad-starter-kit) — same framework, different domain. It adds Teams, Calendar, Planner, and Mail skills with a personal-repo-per-user install model.

---

## Supported Microsoft Security Products

| Product | Coverage |
|---------|----------|
| Microsoft Sentinel | ✅ Full — analytics rules, hunting queries, workbooks, watchlists, data connectors |
| Microsoft Defender XDR | ✅ Full — incidents, advanced hunting, alerts, threat intel |
| Microsoft Defender for Endpoint | ✅ API wrappers, live response, device timeline queries |
| Microsoft Defender for Identity | ✅ Lateral movement detection, identity hunting |
| Microsoft Defender for Office 365 | ✅ Phishing detection, email forensics |
| Microsoft Defender for Cloud / Cloud Apps | ✅ Cloud posture, CSPM, app governance |
| Microsoft Entra ID Protection | ✅ Sign-in analysis, risky user detection, conditional access |
| Microsoft Graph Security API | ✅ Alerts, incidents, threat intel, secure score |
| Microsoft Purview | ✅ DLP policies, eDiscovery, compliance automation |
| Microsoft Copilot for Security | ✅ Integration patterns, prompt engineering, orchestration |
| Azure Data Explorer | ✅ Security data lake, long-term retention, ML anomaly detection |
| Azure Monitor / Log Analytics | ✅ Workspace architecture, DCR, data connectors, cost optimization |

---

## API Wrappers & MCP Servers

Production-ready API integration skills for tool-calling agents:

| Type | Skills | What They Cover |
|------|--------|-----------------|
| **PowerShell API Wrappers** | `sentinel-api-wrapper`, `defender-api-wrapper` | Full REST API coverage with auth, pagination, rate limiting |
| **MCP Servers** | `sentinel-mcp-server`, `defender-mcp-server` | Model Context Protocol servers for Copilot tool integration |
| **Graph Security API** | `microsoft-graph-security` | Alerts, incidents, threat intel, secure score via Graph |
| **Purview / eDiscovery** | `purview-api-wrapper`, `ediscovery-api-wrapper` | Compliance and legal hold automation |
| **Log Analytics** | `api-wrapper` | Query API, workspace management, data export |

---

## Platform Skills — Multi-Tenant, Sovereign Cloud & Cross-Cloud

The `skills/platform/` domain handles enterprise-scale deployment patterns:

- **Multi-Tenant Support** — Azure Lighthouse, cross-tenant KQL queries, tenant-scoped RBAC for MSSPs and multi-org environments
- **Sovereign Cloud (GCC/GCC-H/DoD)** — Endpoint mappings, API differences, feature parity matrices for Azure Government clouds
- **Cross-Cloud Connectors** — Ingesting AWS CloudTrail, GCP Security Command Center, and other cloud provider data into Sentinel

---

## What Gets Created

```
your-repo/
├── .squad/                          # Agent team framework
│   ├── team.md                      # Roster — who's on the team
│   ├── routing.md                   # Who handles what
│   ├── decisions.md                 # Shared brain — team decisions
│   ├── ceremonies.md                # Sprint ceremonies config
│   ├── casting/                     # Persistent name registry
│   ├── agents/
│   │   ├── mcnulty/                 # Lead — architecture, scope, review
│   │   ├── kima/                    # SecOps — security products, hunting
│   │   ├── freamon/                 # KQL — queries, analytics, ADX
│   │   ├── herc/                    # SOAR — automation, playbooks
│   │   ├── sydnor/                  # Platform — CLI, templates, CI/CD
│   │   ├── carver/                  # QA — testing, validation
│   │   ├── scribe/                  # Session logger
│   │   └── ralph/                   # Work monitor
│   ├── identity/                    # Team focus and reusable patterns
│   └── log/                         # Session history
├── .secops/                         # Customer environment knowledge
│   ├── environment.yaml             # Tenant, subscription, regions
│   ├── workspaces/                  # Sentinel / Log Analytics configs
│   ├── data-sources/                # Data mapping and migrations
│   ├── identity/                    # Multi-tenant topology, RBAC
│   ├── alerting/                    # Alert routing
│   ├── compliance/                  # Regulatory constraints
│   └── discovery-log.yaml           # Agent-discovered facts
├── .copilot/                        # Copilot agent configuration
│   ├── skills/                      # 10 Copilot-level skills
│   └── mcp-config.json              # MCP server configuration
├── skills/                          # 847 security operations skills
│   ├── kql/                         # KQL hunting & analytics (11)
│   ├── soar/                        # SOAR automation (12)
│   ├── detection/                   # Detection engineering (10)
│   ├── adx/                         # Azure Data Explorer (8)
│   ├── msft-security/               # Microsoft Security products (19)
│   ├── powershell/                  # PowerShell modules (14)
│   ├── log-analytics/               # Log Analytics (10)
│   ├── platform/                    # Multi-tenant, sovereign cloud (4)
│   ├── orchestration/               # Cross-skill workflows (3)
│   ├── testing/                     # Integration testing (1)
│   └── community/                   # 755 community-contributed skills (45 sub-domains)
├── personas/                        # 6 SOC role configurations
│   ├── soc-analyst/
│   ├── detection-engineering/
│   ├── threat-hunting/
│   ├── cloud-security/
│   ├── incident-response/
│   └── full-soc/
├── templates/                       # Bicep, KQL, threat model templates
├── samples/                         # Contoso reference implementation
├── cli/                             # secops-squad CLI (10 commands)
├── lib/                             # KQL validator, MITRE mapping, plugins
└── docs/                            # Full documentation suite
```

**Commit this folder.** Your team persists. Names persist. Environment knowledge persists. Anyone who clones gets the team — with accumulated knowledge and your `.secops/` configuration.

---

## Samples

The `samples/` directory includes a complete reference implementation:

### [Contoso Corp](samples/secops-contoso/README.md)

A full `.secops/` configuration for a fictional 12,000-employee enterprise with a mature SOC:

- 2 Entra tenants, 3 Azure subscriptions
- ~500 GB/day log ingestion across 3 workspaces
- Cross-cloud monitoring (AWS + GCP)
- Data tiering with active Sentinel → ADX migrations
- NIST, PCI-DSS, and SOC 2 compliance boundaries

Copy it, replace Contoso values with yours, validate with `secops-squad doctor`.

---

## FAQ

<details>
<summary><b>What's the difference between this and a regular Sentinel deployment?</b></summary>
SecOps Squad is an AI-assisted overlay — it doesn't replace your Sentinel workspace. It gives your Copilot CLI agents deep knowledge of KQL, detection engineering, SOAR patterns, and your specific security stack so you can hunt, build detections, and automate response through natural conversation.
</details>

<details>
<summary><b>Do I need an Azure subscription?</b></summary>
For KQL hunting and SOAR skills, yes — you need a Sentinel workspace. For detection engineering skills, threat model templates, and learning KQL patterns, no Azure subscription is required.
</details>

<details>
<summary><b>Can I use this with an existing Sentinel workspace?</b></summary>
Yes. During <code>init</code>, you connect to your existing workspace. The starter kit reads from your environment — it never writes to Sentinel unless you explicitly deploy a playbook or analytics rule.
</details>

<details>
<summary><b>Mac / Linux support?</b></summary>
Yes. Use the <code>install.sh</code> one-liner. Requires Node.js 18+ and Git. The CLI and all skills are cross-platform.
</details>

<details>
<summary><b>How does this relate to Squad?</b></summary>
SecOps Squad is built on <a href="https://github.com/bradygaster/squad">Squad</a> by Brady Gaster. Squad provides the agent team framework (casting, routing, decisions, ceremonies). SecOps Squad adds the security domain — 847 skills, 6 personas, the <code>.secops/</code> knowledge layer, and Microsoft Security product coverage.
</details>

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Script won't run (Windows) | `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser` then retry |
| Node.js not found | Install from [nodejs.org](https://nodejs.org/) or `winget install OpenJS.NodeJS.LTS` |
| KQL validation fails | Run `npm test` locally to see syntax errors before pushing |
| Auth expired | Re-run `az login` for Azure, `gh auth login` for GitHub |
| Persona not loading | Check `secops-squad.config.json` exists in your project root |
| `.secops/` validation errors | Run `secops-squad env validate` to see specific issues |
| Doctor shows warnings | Follow the suggested fix for each check — most are one-liners |

---

## Documentation

### Getting Started & Guides

| Doc | What it covers |
|-----|---------------|
| [**Getting Started**](docs/getting-started.md) | Installation, init wizard, your first hunt |
| [**Architecture Guide**](docs/ARCHITECTURE.md) | Full platform architecture, skills system, orchestration patterns |
| [**Integration Guide**](docs/INTEGRATION.md) | Connect to real Azure environments, multi-tenant, gov cloud |
| [**Personas Guide**](docs/personas-guide.md) | All 6 personas, team composition, ceremony cadence |
| [**ADX Setup Guide**](docs/adx-setup.md) | Azure Data Explorer quick-start, ADX vs Log Analytics |

### Reference

| Doc | What it covers |
|-----|---------------|
| [**Skills Catalog**](SKILLS_CATALOG.md) | All 847 skills organized by domain |
| [**`.secops/` Schema Reference**](docs/SECOPS_SCHEMA.md) | Complete field-level docs for customer knowledge framework |
| [**Graph Security API**](docs/graph-security-api.md) | Library usage, auth flows, error handling |
| [**MITRE Coverage**](docs/mitre-coverage.md) | ATT&CK technique coverage map |
| [**Customer Knowledge**](.secops/README.md) | `.secops/` environment framework docs |
| [**All Docs Index**](docs/README.md) | Navigable index of all documentation |

### Developer & Framework

| Doc | What it covers |
|-----|---------------|
| [**CLI Reference**](cli/README.md) | All `secops-squad` CLI commands |
| [**Libraries**](lib/README.md) | KQL validator, MITRE mapping, Graph Security, plugins |
| [**Squad Framework**](.squad/README.md) | Agent roster, ceremonies, routing, casting system |
| [**Copilot Config**](.copilot/README.md) | Copilot skills, MCP servers, agent definitions |
| [**GitHub Automation**](.github/README.md) | Workflows, issue automation, agent config |
| [**Templates**](templates/README.md) | Bicep, KQL, and threat model templates |
| [**Samples**](samples/README.md) | Contoso reference implementation |

---

## Built On

- **[Squad](https://github.com/bradygaster/squad)** — Brady Gaster's agent team framework that powers the casting, routing, decisions, and ceremony system
- **[GitHub Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli)** — The runtime that makes it all work

### Sibling Projects

- **[Productivity Squad Starter Kit](https://github.com/x3nc0n/productivity-squad-starter-kit)** — Same Squad framework applied to Microsoft 365 productivity workflows (Teams, Calendar, Planner, Mail). Uses a personal-repo-per-user install model with MCP server integration.

---

## Status

SecOps Squad is alpha software. The skill library, CLI commands, and `.secops/` schema are stabilizing but may change. We'll document breaking changes as they happen.

## License

MIT
