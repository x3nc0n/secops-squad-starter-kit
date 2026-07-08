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

📌 **Okta→Entra Migration Framework Session** (2026-07-08)
- Full session: Sydnor + Kima + McNulty + Carver built complete reusable migration harness (not customer-specific)
- Decision archival: Tier 2 gate applied (59,366 bytes > 51KB + entries > 7 days) → all Foundry decisions (2026-06-25, 13 days old) archived to decisions-archive.md
- Merged 11 Okta decisions from inbox into active decisions.md (2026-07-08 session)
- Framework principles: (1) operator decision gates (source-of-truth, per-class ownership, cutover shape, etc.), (2) no hardcoded answers, (3) config-driven tooling reads declared choices
- Tooling boundary: official Okta MCP (Okta writes) | lib/okta (Okta reads/export, read-first) | Microsoft Graph (Entra writes)
- Quality: 626 tests, 0 fail; Carver verified tooling honors config without hardcoded behavior
- Orchestration logs written for Sydnor, Kima, McNulty, Carver per-agent session outcomes
