---
title: "Decision 01 — Identity Source of Truth"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - source_of_truth.identity_authority
  - source_of_truth.hris_system
  - source_of_truth.per_attribute_authority
---

# Decision 01 — Identity Source of Truth

## The Decision

**Who is the authoritative system of record for user identity?**

This is the foundational question of any migration. The answer determines the entire provisioning pipeline architecture. Getting this wrong means you rebuild the pipeline.

---

## Options

### `okta`
Okta is the master record for identity. User attributes in Okta are authoritative. An upstream HR system may feed Okta via SCIM/CSV, but Okta is the declared SoT.

### `hris`
An upstream HR system (Workday, SAP SuccessFactors, ADP, etc.) is the authoritative record. Okta is a downstream consumer. Users, departments, job titles, and lifecycle events originate in the HRIS — not in Okta.

### `mixed`
Neither system is fully authoritative. Identity authority is split by attribute or population — typically some core profile attributes come from HRIS (department, manager, title), while Okta owns application-custom attributes, credentials, and access entitlements. This is common in large enterprises and requires per-attribute authority declarations (see `per_attribute_authority`).

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `okta` | Simpler pipeline — Okta exports directly to Entra. No additional upstream dependency. | If HRIS already feeds Okta via SCIM, you may be re-exporting stale data. |
| `hris` | Source data is fresher (terminations, rehires, manager chains reflect HR reality). Avoids Okta as a stale middleman. | Requires direct HRIS → Entra integration. `lib/okta` export is still needed for access entitlements, but not for core profile. More integration surface. |
| `mixed` | Correctly reflects complex enterprise reality. Avoids over-sourcing from either system. | Requires explicit per-attribute authority mapping. More complex to validate. More dangerous to get wrong at cutover. |

---

## Recommended Default

**`okta`**

**Rationale:** In most Okta → Entra migrations, Okta is the closest available source for current user state (including statuses, last login, MFA enrollment, and group membership) regardless of what feeds Okta upstream. Starting with `okta` gives you a working pipeline on day one. If HRIS-freshness is critical for specific attributes (manager, department, costCenter), promote those attributes to `per_attribute_authority` rather than switching the entire authority to `hris`.

**Reassess if:** The org has an active HRIS → Okta SCIM integration where Okta is clearly secondary, or if Okta profile data is demonstrably stale compared to the HR source.

---

## Rollback Implication

This is a **pipeline architecture decision**. Changing the declared `identity_authority` mid-migration requires:
- Rebuilding the export/import pipeline (Sydnor's `lib/okta` vs direct HRIS connector)
- Re-validating all attribute mapping in `per_attribute_authority`
- Re-running reconciliation against the new authoritative source

There is no clean rollback once Entra objects have been provisioned from the wrong source. **Declare this before any provisioning begins.**

---

## Per-Attribute Authority (`per_attribute_authority`)

When `identity_authority` is `mixed` — or when `okta` is the declared authority but HRIS is fresher for specific fields — use `per_attribute_authority` to declare split ownership at the attribute level.

**Format:**
```yaml
source_of_truth:
  per_attribute_authority:
    - attribute: manager
      authority: hris
      notes: "Manager chain is always pulled from Workday — Okta lags by 24h"
    - attribute: department
      authority: hris
    - attribute: costCenter
      authority: hris
    - attribute: customAttribute_salesRegion
      authority: okta
```

**Common split patterns:**
| Attribute | Typical Authority | Reason |
|-----------|-------------------|--------|
| `manager` | `hris` | Manager chain is HR reality; Okta often lags |
| `department` | `hris` | Org structure originates in HR |
| `costCenter` | `hris` | Finance-controlled; HR system is authoritative |
| `jobTitle` | `hris` | HR approves titles, not IT |
| `email` | `okta` | IT controls email provisioning |
| `mobilePhone` | `okta` | User self-service in Okta |
| App custom attributes | `okta` | Okta-specific; no HRIS equivalent |
| MFA/credentials | `okta` | Always Okta-owned until cutover |

---

## Config Fields Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  source_of_truth:
    identity_authority: okta        # YOUR ANSWER: okta | hris | mixed
    hris_system: null               # Required if hris or mixed: e.g. "Workday"
    per_attribute_authority:        # Optional — add entries for split attributes
      []
      # - attribute: manager
      #   authority: hris
      #   notes: "Workday is authoritative for manager chain"
```

**Next decision:** [02 — Object Ownership](02-object-ownership.md)
