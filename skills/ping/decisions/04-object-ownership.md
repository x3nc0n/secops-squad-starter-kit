---
title: "Decision 04 — Object Ownership and Migration Order"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - source_of_truth.per_class_ownership.users
  - source_of_truth.per_class_ownership.credentials_mfa
  - source_of_truth.per_class_ownership.groups
  - source_of_truth.per_class_ownership.app_assignments
  - source_of_truth.per_class_ownership.policies
  - source_of_truth.per_class_ownership.saml_sp_connections
---

# Decision 04 — Object Ownership and Migration Order

## The Decision

**Which system is the single writer for each object class, and in what order do classes migrate?**

This is an operational safety decision. `gate.js assertEntraOwned()` blocks writes to any class that is still declared `ping`-owned. You cannot accidentally migrate an object class that hasn't been declared ready.

---

## Object Classes

| Class | Description | Default Initial Ownership |
|-------|-------------|--------------------------|
| `users` | User accounts and profile attributes | `ping` |
| `credentials_mfa` | MFA enrollments, passwords, session tokens | `ping` |
| `groups` | Security groups and membership | `ping` |
| `app_assignments` | Which users/groups can access which apps | `ping` |
| `policies` | Sign-on policies, authentication policies | `ping` |
| `saml_sp_connections` | SAML SP federation configurations | `ping` — **Ping-specific class; no Okta equivalent** |

---

## Options Per Class

Each class can be set to:

### `ping`
Ping owns this class. No Entra writes for this class are permitted. `assertEntraOwned()` will block any write attempt.

**Start here.** All classes begin `ping`-owned.

### `entra`
Entra is now the authoritative owner of this class. Ping data for this class is read-only (source for migration, not source of truth). `assertEntraOwned()` passes for this class, enabling Graph writes.

**Move here only when:** Phase 1 discovery is complete for this class, a dry-run write plan has been reviewed and approved, and the operator has explicitly changed the YAML.

---

## Recommended Migration Order

Migrate classes in this order to minimize dependency failures:

```
1. users              — Provision users in Entra first; all other classes depend on user existence
2. groups             — After users exist; group membership references Entra user objectIds
3. app_assignments    — After groups; assignments reference Entra group/user objectIds
4. saml_sp_connections — After users + groups exist; configure Entra Enterprise Apps (SAML)
5. policies           — After apps exist; CA policies target apps and groups
6. credentials_mfa    — Last; MFA enrollment campaign happens after cutover is confirmed
```

**Why credentials_mfa is last:** Users cannot re-enroll in Entra MFA until they can reach Entra. Attempting MFA migration before Entra auth is working produces re-enrollment failures. Plan the campaign for the first post-cutover week.

---

## SAML SP Connections — Special Sequencing

`saml_sp_connections` is a Ping-specific object class. Each PF SP connection maps to one Entra Enterprise App configured for SAML. The following sub-steps apply before declaring this class `entra`-owned:

1. **NameID assessment** — Run `assertNameIdPortable()` on every SP connection (Phase 1)
2. **Blocked SPs** — SPs with incompatible NameIDs remain `ping`-owned until the SP vendor updates their config
3. **Certificate pre-staging** — Export Entra's SAML signing certificate and deliver to each SP admin before cutover day
4. **Metadata exchange** — Each SP must update their IdP metadata to point at Entra before the DNS/traffic switch
5. **Pilot validation** — Cut one low-risk SP first; validate end-to-end SSO before bulk migration

---

## Rollback Implication

Changing a class from `entra` back to `ping` is possible in the YAML but requires:
- Restoring the Ping-side configuration for that class
- Ensuring the Ping configuration is still current (not stale from coexistence period)
- Notifying users (especially for MFA — they may need to re-enroll in PingID)

There is no automated rollback. Declare classes `entra`-owned only after a tested dry-run pass.

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  source_of_truth:
    per_class_ownership:
      users: ping                      # YOUR ANSWER (per class): ping | entra
      credentials_mfa: ping
      groups: ping
      app_assignments: ping
      policies: ping
      saml_sp_connections: ping
```

**Next decision:** [05 — MFA Strategy](05-mfa-strategy.md)
