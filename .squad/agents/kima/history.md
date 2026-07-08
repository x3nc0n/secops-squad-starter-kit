# History

<!-- Populated automatically during squad sessions. -->

## Learnings

📌 **Okta Decision Harness + Official MCP Framing (2026-07-08)**
- **`skills/okta/decisions/` structure:** README.md (index + how the gate works) + seven decision guides (01–07), one per major migration decision. Each guide: states the decision, lists enum values, trade-offs, recommended default with rationale, rollback implication, and the exact `migration_profile` config field it writes.
- **Decision guide map:** 01-source-of-truth (identity_authority/hris_system/per_attribute_authority), 02-object-ownership (per_class_ownership.*), 03-cutover-shape (cutover_shape), 04-group-strategy (group_strategy), 05-federation-direction (federation_direction), 06-mfa-strategy (mfa_strategy), 07-execution-gates (dry_run + entra_write_tooling).
- **Canonical `migration_profile` schema** added to `.secops/identity/okta.yaml` — commented options for every field, conservative defaults (dry_run: true, all classes okta-owned), REPLACE_ME placeholders, header pointing to decisions/. Sydnor's config.js and gate.js validate and enforce this block.
- **MFA is never portable:** Every Okta factor type (Okta Verify, FIDO2, TOTP, SMS, hardware tokens) is non-exportable. This is non-negotiable. The re-enrollment seam is the most operationally sensitive moment of any migration.
- **Official Okta MCP server reframe:** `skills/okta/okta-mcp-server.md` rewritten from a homegrown-server spec into an integration guide for https://github.com/okta/okta-mcp-server (Python/uv, GA, Okta SDK v3.4.1). Covers: what it is, Docker + bare-metal setup, Device Auth Grant (interactive) + Private Key JWT (headless) auth, full tool surface (User/Group/App/Policy CRUD + System Logs), secure credential handling (scoped tool loading, elicitation for destructive ops, env vars only), and the critical "when to use MCP vs lib/okta vs Graph" boundary table.
- **Tooling boundary re-stated:** Official MCP = Okta-side writes (interactive/one-off). `lib/okta` = bulk read/export/reconcile (never writes to Okta). Microsoft Graph = all Entra writes. No tool crosses its lane. `per_class_ownership` in migration_profile gates what the MCP server may write.
- **Group rules regex gotcha is a `lift_and_shift` viability gate:** Okta supports `=~` full regex in group rules; Entra dynamic membership rules do not. Operators must audit their group rules export before declaring `lift_and_shift` — rules using regex must be manually managed, rationalized, or rewritten in Entra-compatible syntax.
- **`okta_idp_into_entra` is the lowest-disruption coexistence default:** Okta stays the authenticating IdP; Entra trusts Okta's SAML/OIDC assertions during the transition. MFA re-enrollment is deferred to final cutover wave. The SAML trust removal from Entra is a one-way door — plan it explicitly.

📌 **Okta Skills Domain — Two-Mode Framing and Migration Map (2026-07-08)**
- **`skills/okta/` structure:** README.md (domain overview, two-mode framing), core-api-overview.md, users-and-profiles.md, groups-and-rules.md, applications-saml-oidc.md, policies-and-authenticators.md, okta-to-entra-migration-map.md. Each file follows the msft-security exemplar format with YAML frontmatter, use-when guidance, tables, and real API examples.
- **Two-mode framing decision:** Okta tooling always serves either (a) migration-to-Entra or (b) federated-ops where Okta stays the IdP. `.secops/identity/okta.yaml` → `operating_mode` field drives agent behavior selection. Do not assume migration is always the goal.
- **Migration map approach:** Three-quality-tier system (✅ Clean / ⚠️ Requires action / ❌ No map). Explicit "no map" callouts rather than invented equivalences. Key gotchas: MFA not portable, certificates not portable, OIDC client IDs change, Entra CA is most-restrictive-wins not first-match, regex unsupported in Entra dynamic group rules.
- **Key Okta→Entra gotchas confirmed via research:**
  - Every MFA enrollment re-registration is required; zero Okta factors port to Entra (FIDO2 RP-bound to Okta domain, TOTP seeds Okta-custody, push bound to Okta push service)
  - SAML: SP must update IdP Entity ID (Okta → `https://sts.windows.net/{tenantId}/`) and certificate; NameID value mismatch creates duplicate SP accounts
  - OIDC: Okta Client ID is replaced by Entra Application ID; issuer URL changes; group claims emit GUIDs not display names in Entra; `offline_access` scope required for refresh tokens
  - Group rules: Okta supports full regex (`=~`); Entra dynamic rules only support `-contains`, `-startsWith`, `-endsWith` — complex regex rules require redesign
  - "Everyone" BUILT_IN group has no Entra group equivalent; express as CA `includeUsers: All`
  - SWA apps have no Entra equivalent; must stay on Okta or require SP-side SAML/OIDC implementation
  - Okta sign-on policy is first-match-wins; Entra CA evaluates all policies with most-restrictive result — behavioral difference causes unexpected blocks at cutover
- **`.secops/identity/okta.yaml`:** New template file following tenants.yaml schema conventions (schema_version, REPLACE_ME placeholders, comment-rich). Fields: org URL, engine (classic/OIE), auth_model, operating_mode, federation relationships (Okta-as-IdP-to-Entra, Entra-as-IdP-to-Okta, provisioning sync), key apps, migration_status block, security notes.
- **Pattern for future Okta ops work:** Always read `.secops/identity/okta.yaml` first for org context, then select the appropriate skills/okta/ file for the object type being worked.

📌 **Foundry Safety Gates — Cloud Egress for Sensitive Security Data (2026-06-25)**
- **No runtime enforcement exists** on the foundry-integration branch. The "Safety Policy" in docs is advisory prose only — no secret scanner, no PII redactor, no audit log, no egress allowlist. This must be remediated before any real data touches Foundry.
- **Data classification tiers for Foundry routing:** NEVER send raw credentials/API keys, unredacted OT network topology (IP/hostname), raw working exploit PoCs, customer PII, or classified threat intel. SCRUB FIRST: SARIF findings (redact host/IP/user), CTI reports (remove org-identifying IOCs), pentest output (summarize exploits, replace real IPs with placeholders). OK as-is: anonymized detection logic, generic MITRE mappings, sanitized code snippets.
- **OT/ICS boundary is sharp:** Foundry is appropriate for CTI-to-detection reasoning, OT MITRE ICS mapping, and assessment planning with sanitized data. It MUST NOT be used to generate OT attack chains, enumerate live OT assets by real IP, or produce exploitable protocol abuse scripts (Modbus/DNP3/EtherNet/IP). The distinction is: analysis IN → detections OUT, not assets IN → attack payloads OUT.
- **30-day retention is a hard compliance blocker** for most regulated environments: HIPAA, PCI-DSS, CMMC, NIS2, FedRAMP IL2+ all have constraints that interact badly with cloud-retained security data. A compliance pre-check gate must exist before oundry.enabled: true is permitted.
- **Audit non-repudiation minimum:** Every Foundry call needs a structured log entry — SHA-256 hash of payload pre-send (not the payload itself), task type, model, tokens, cost, timestamp, actor identity. JSONL format in .secops/foundry-audit.jsonl, rotated and preserved per retention policy.
- **Priority control order:** P0 = secret/credential scrubber + audit log; P1 = PII/IP/hostname redactor + human-confirm gate for high-sensitivity; P2 = compliance pre-check, egress allowlist, cost cap.
- **Key pattern for the team:** Treat Foundry like any other cloud API that retains data — classify first, scrub second, gate third, audit always. The adversary model is accidental exfiltration, not malicious, so defense-in-depth with friction-at-the-right-points is the right posture.

See history-archive.md for older learnings and project history (May 2026 and earlier).

---

## 2026-06-26T01:07:49Z — Phase 0 PASSED; F-001 Endpoint Validation Gate for Phase 1

Carver completed QA of Sydnor's Phase 0 Foundry work (config loading, auth, fixtures). All 285 tests pass.

**For Kima:** Finding F-001 (fail-open on missing endpoint) is the target for Phase 1 fail-closed validation. Endpoint validation should be added to loadFoundryConfig() before any provider code calls resolveEndpoint() in production. This is a gate before Phase 1 provider work begins.

Inbox files merged into decisions.md by Scribe.

---

## 2026-06-26T04:33:44Z — Foundry Phase 1 COMPLETED: F-001 + P0 Safety Gates RESOLVED

Kima completed F-001 fail-closed endpoint validation (commit 54b32be) and P0 safety gates implementation (commit 56e9dd3).

**Status:** Phase 1 PASS — CLEARED FOR MERGE

- F-001: loadFoundryConfig() now fails closed (returns 
ull) for missing/empty/whitespace endpoints
- Secret-scan gate: regex detection for API keys, private keys, bearer tokens; fail-closed on exceptions
- Audit gate: JSONL log with SHA-256 hash (never payload); posts to .secops/foundry-audit.jsonl (gitignored)
- Finding F-002 (P0): fixed by Sydnor — secret exception text now redacted in reason and log
- Phase 1 verdict: 6/6 merge gates PASS; Carver re-verified all tests green (322/322); coverage 82.36%

Inbox merged into decisions.md. Orchestration logs in .squad/orchestration-log/. Session log in .squad/log/.
