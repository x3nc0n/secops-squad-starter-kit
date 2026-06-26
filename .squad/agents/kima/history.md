# History

<!-- Populated automatically during squad sessions. -->

## Learnings

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
