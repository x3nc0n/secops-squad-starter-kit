---
title: "Decision 01 — Identity Source of Truth"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - source_of_truth.identity_authority
  - source_of_truth.hris_system
  - source_of_truth.per_attribute_authority
---

# Decision 01 — Identity Source of Truth

## The Decision

**Which system is the authoritative record of user identity in this Ping environment?**

Unlike Okta (a single-product IdP), a Ping deployment may span multiple products: PingFederate handles federation, PingOne hosts the cloud directory, PingDirectory is the on-prem LDAP store, and AIC may exist as a separate ForgeRock-lineage tenant. The answer determines the entire export pipeline architecture.

---

## Options

### `pingfederate`
PingFederate is the federation authority. Users are sourced from PingDirectory (LDAP) or a connected HR system; PF holds the federation configuration (SP connections, attribute contracts). This is the most common on-prem Ping pattern.

**Choose this when:** The customer has an on-prem PF deployment that federates to SPs, and user records live in PingDirectory or Active Directory behind PF.

### `pingone`
PingOne cloud is the master record for user identity. Users, groups, and populations live in PingOne. PF may be present but in a subordinate or coexistence role.

**Choose this when:** The customer has adopted PingOne cloud as their primary IdP and manages users through the PingOne console or SCIM provisioning.

### `aic`
PingOne Advanced Identity Cloud (ForgeRock lineage) is the identity authority. The AIC tenant holds the user store, authentication trees, and policy logic.

**Choose this when:** The customer is a ForgeRock/AIC customer who was migrated to Ping. Tenant domain is `{tenant}.forgeblocks.com`.

### `hris`
An upstream HR system (Workday, SAP SuccessFactors, ADP, etc.) is the master record. Ping is a downstream consumer of HR-provisioned identities.

**Choose this when:** The org has an active HRIS → Ping SCIM/CSV integration and Ping profile data is demonstrably derived from HR.

### `mixed`
Identity authority is split by product or attribute. Core profile attributes (department, manager, title) come from HRIS; PF/PingOne own credentials, access entitlements, and app assignments.

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `pingfederate` | Closest to the federation config; covers SAML SP connections directly | User records may actually live in PingDirectory/AD — assess the actual directory |
| `pingone` | Cloud-native; SCIM export available; clean object model | May not include on-prem SP connections if hybrid |
| `aic` | If AIC is the store, `lib/ping/aic/` + aic-mcp-server are the right tools | AIC requires separate investigation; different API surface than PingOne |
| `hris` | Freshest core profile data | Ping may own app entitlements and credential state that HRIS does not |
| `mixed` | Correctly reflects complex enterprise reality | Requires per-attribute authority mapping; more engineering; harder to validate |

---

## Recommended Default

**`pingfederate`** for on-prem or hybrid Ping deployments; **`pingone`** for cloud-first.

**Rationale:** Most enterprise Ping customers have PingFederate as the centerpiece of their identity estate. It owns federation (SP connections), and its attribute contracts define what flows to SPs. Start with `pingfederate`. If user records are primarily in PingOne or AIC, reassign accordingly.

**Reassess if:** The customer's PingDirectory/AD is the real SoT and PF is purely a federation layer. In that case, both `pingfederate` (for SP connections) and `hris`/AD (for user attributes) may be declared.

---

## Per-Attribute Authority (`per_attribute_authority`)

When `mixed` — or when the declared authority is incomplete for specific attributes — declare per-attribute splits:

```yaml
source_of_truth:
  per_attribute_authority:
    - attribute: manager
      authority: hris
      notes: "Manager chain sourced from Workday via PingDirectory sync — Ping lags by up to 24h"
    - attribute: department
      authority: hris
    - attribute: costCenter
      authority: hris
    - attribute: email
      authority: pingfederate
      notes: "IT-provisioned email addresses live in PF attribute contract"
```

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  source_of_truth:
    identity_authority: pingfederate   # YOUR ANSWER: pingfederate | pingone | aic | hris | mixed
    hris_system: null                  # Required if hris or mixed: e.g. "Workday"
    per_attribute_authority:
      []
      # - attribute: manager
      #   authority: hris
```

**Next decision:** [02 — Federation Source](02-federation-source.md)
