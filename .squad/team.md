# Team Roster

> SecOps Squad **starter-kit dev team** — the crew that builds and maintains this reusable framework (identity-migration tooling: Okta/Ping → Entra ID, MCP servers, skills, CLI). This roster is the *maintainer's* dev squad (bradygaster/squad pattern). It is NOT the product roster consumers get — install strips it.

## Coordinator

| Name | Role | Notes |
|------|------|-------|
| Squad | Coordinator | Routes work, enforces handoffs and reviewer gates. Does not generate domain artifacts. |

## Members

| Name | Role | Charter | Status |
|------|------|---------|--------|
| Morpheus | Lead | `.squad/agents/morpheus/charter.md` | ✅ Active |
| Keymaker | SecOps / Identity Engineer | `.squad/agents/keymaker/charter.md` | ✅ Active |
| Tank | Platform Dev (CLI/MCP/framework) | `.squad/agents/tank/charter.md` | ✅ Active |
| Seraph | Tester / QA (reviewer gate) | `.squad/agents/seraph/charter.md` | ✅ Active |
| Scribe | Session Logger | `.squad/agents/scribe/charter.md` | 📋 Silent |
| Ralph | Work Monitor | — | 🔄 Monitor |

> Deferred (available on request, no surviving history): **Oracle** (KQL/analytics), **Sentinel** (SOAR/automation).

## Coding Agent

<!-- copilot-auto-assign: false -->

| Name | Role | Charter | Status |
|------|------|---------|--------|
| @copilot | Coding Agent | — | 🤖 Coding Agent |

### Capabilities

**🟢 Good fit — auto-route when enabled:**
- Bug fixes with clear reproduction steps
- Test coverage (adding missing tests, fixing flaky tests)
- Lint/format fixes and code style cleanup
- Dependency updates and version bumps
- Small isolated features with clear specs
- Boilerplate/scaffolding generation
- Documentation fixes and README updates

**🟡 Needs review — route to @copilot but flag for squad member PR review:**
- Medium features with clear specs and acceptance criteria
- Refactoring with existing test coverage
- API endpoint additions following established patterns
- Migration scripts with well-defined schemas

**🔴 Not suitable — route to squad member instead:**
- Architecture decisions and system design
- Multi-system integration requiring coordination
- Ambiguous requirements needing clarification
- Security-critical changes (auth, encryption, access control)
- Performance-critical paths requiring benchmarking
- Changes requiring cross-team discussion

## Project Context

- **Owner:** x3nc0n
- **Stack:** Node.js CLI, Markdown AI harness, MCP servers, Bash/PowerShell installers; targets Microsoft Sentinel/Defender/Entra + identity providers (Okta, Ping).
- **Description:** Reusable SecOps AI-team starter kit with identity-provider migration tooling (Okta/Ping → Entra ID) and framework for operating IdP-federated environments.
- **Cast universe:** The Matrix (dev team). Recast 2026-07-08 from prior assignment; per-agent memory preserved.
