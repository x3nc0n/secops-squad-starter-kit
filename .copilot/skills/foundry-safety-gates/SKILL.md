# SKILL: Foundry Safety Gates

**Owner:** Kima (SecOps Engineer)
**Created:** 2026-06-25
**Applies to:** Any agent routing payloads to Azure AI Foundry (Fable 5 / o4-mini)

---

## Purpose

This skill describes the safety control pattern required before any payload is sent from secops-squad to an Azure AI Foundry endpoint. Foundry has 30-day data retention. Sensitive security data (SARIF, pentest output, OT CTI, incident data) requires classification, scrubbing, and audit logging before egress.

---

## Pre-Dispatch Checklist (run in order)

Before calling any Foundry endpoint, an agent MUST:

1. **Classify the payload** — assign `data_sensitivity` (low/medium/high) and `data_type` (sarif/cti/pentest/incident/generic)
2. **Run redaction** (if `data_sensitivity: high` OR `data_type` is `ot-cti`, `pentest-output`, or `incident-data`):
   - Replace real IPs with `[IP-N]` (deterministic per-session mapping)
   - Replace real hostnames/FQDNs with `[HOST-N]`
   - Replace user account names with `[USER-N]`
   - Summarize exploit PoC code — do NOT paste working exploits
3. **Run secret scan** (always) — scan serialized payload for API keys, private key headers, bearer tokens, password strings. If found: BLOCK, do not send
4. **Human confirm** (if `data_sensitivity: high`) — surface a confirmation prompt before sending
5. **Write audit log entry** (always, including blocked calls) — JSONL to `.secops/foundry-audit.jsonl`
6. **Check egress allowlist** — endpoint must match `*.cognitiveservices.azure.com`
7. **Check cost cap** — estimated input tokens must be under the configured per-call cap

---

## Audit Log Schema (`.secops/foundry-audit.jsonl`)

Each line is a JSON object:

```json
{
  "timestamp": "2026-06-25T19:35:20-05:00",
  "actor": "kima-agent | git:jospaid",
  "task_type": "sarif_analysis | threat_model | ot_cti | ir_timeline | detection_review",
  "data_sensitivity": "low | medium | high",
  "payload_sha256": "<sha256 of pre-redaction payload>",
  "payload_size_bytes": 42000,
  "model": "o4-mini | claude-fable-5",
  "endpoint": "https://<resource>.cognitiveservices.azure.com",
  "tokens_input": 8500,
  "tokens_output": 1200,
  "cost_usd_estimate": 0.145,
  "gate_result": "allowed | blocked | user_declined",
  "block_reason": null
}
```

**Do NOT log the payload itself.** Log only the SHA-256 hash. Post-incident reconstruction uses the hash to verify if a specific payload was sent.

---

## Data Classification Reference

| Data type | Sensitivity | Redaction required | Send allowed? |
|-----------|-------------|-------------------|---------------|
| Raw credentials / API keys | CRITICAL | N/A | NEVER |
| Working exploit PoC | CRITICAL | N/A | NEVER |
| Customer PII | CRITICAL | N/A | NEVER |
| Live OT asset IPs/hostnames | CRITICAL | N/A | NEVER |
| TLP:RED threat intel | CRITICAL | N/A | NEVER |
| SARIF findings (real hosts) | HIGH | Yes — redact IPs/hosts/users | After redaction |
| Pentest output | HIGH | Yes — summarize exploits, replace targets | After redaction + human confirm |
| OT/ICS CTI (Dragos-style) | HIGH | Yes — redact org IOCs, asset names | After redaction + human confirm |
| Incident timeline data | HIGH | Yes — anonymize users/systems | After redaction + human confirm |
| Detection rule set (with real assets) | MEDIUM | Redact hardcoded asset values | After redaction |
| Anonymized SARIF / generic rules | LOW | None required | OK as-is |
| MITRE mappings (no org context) | LOW | None required | OK as-is |
| Public TLP:WHITE/GREEN CTI | LOW | None required | OK as-is |

---

## OT/ICS Boundary Rules

**Permitted uses of Foundry for OT/ICS work:**
- CTI ingestion → MITRE ICS technique mapping → Sentinel detection rule generation
- Anonymized OT architecture threat modeling
- ICS vulnerability assessment analysis (with asset details redacted)
- Lab environment validation planning (no real asset identifiers)

**Prohibited uses (hard stop — do not proceed):**
- Generating OT attack chains (Modbus sequences, DNP3 spoofing, EtherNet/IP exploits)
- Producing scripts that interact with live industrial protocols
- Enumerating live OT assets through Foundry
- Assisting in automated OT reconnaissance or lateral movement

**The rule:** Analysis IN → defensive detections OUT. Any task where the output is an attack artifact rather than a detection artifact is out of scope.

---

## Compliance Pre-Check (required before production)

Before setting `foundry.enabled: true` in a real customer environment:

1. Check `.secops/compliance/requirements.yaml` for active regulatory frameworks
2. Confirm 30-day cloud retention is acceptable under each active framework
3. Confirm Foundry resource region is in `data_residency.allowed_regions`
4. Confirm no prohibited data types are expected to flow through this integration
5. Record sign-off in `.secops/foundry-compliance-review.yaml`:

```yaml
reviewed_by: "name"
reviewed_date: "2026-06-25"
frameworks_reviewed: ["PCI-DSS", "HIPAA"]
approved: true
notes: ""
```

If `.secops/foundry-compliance-review.yaml` is absent and `foundry.enabled: true`, agents MUST warn the user before routing any payload.

---

## References

- `docs/foundry-fable5-integration.md` — Foundry deployment and data retention overview
- `skills/platform/foundry-model-routing.md` — Routing criteria and API call patterns
- `.secops/compliance/requirements.yaml` — Active regulatory frameworks and data residency
- `.squad/decisions/inbox/kima-foundry-safety-gates.md` — Full decision record with gate specifications
