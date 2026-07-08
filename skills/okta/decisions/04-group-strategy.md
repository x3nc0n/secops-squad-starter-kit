---
title: "Decision 04 — Group Strategy"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.group_strategy
---

# Decision 04 — Group Strategy

## The Decision

**Do you reproduce Okta groups as-is in Entra ID, or use the migration as an opportunity to rationalize them into Entra-native constructs (dynamic groups, access packages, role assignments)?**

This decision has long-tail consequences for IAM governance. A lift-and-shift gets you to Entra fast. A rationalization gets you to a better Entra. Neither is free.

---

## Options

### `lift_and_shift`
Replicate every Okta group (OKTA_GROUP type) into Entra as a security group with the same name and membership. Okta dynamic group rules are approximated as Entra dynamic membership rules where possible, and flagged for manual review where regex or unsupported syntax is used.

### `rationalize`
Evaluate the existing Okta group inventory and rebuild in Entra using Entra-native constructs:
- **Entra dynamic groups** (attribute-based dynamic membership rules)
- **Access packages** (Entitlement Management — bundle app + group access into request-and-approve flows)
- **Administrative units** (scope admin delegation)
- **Privileged Identity Management (PIM) roles** (for elevated access currently managed through Okta groups)

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `lift_and_shift` | Fast to implement. Familiar group names for app owners. Lower migration risk — behavior preserves existing access model. | Imports group debt into Entra. Misses Entra-native capabilities. Regex-based Okta rules break silently (see below). Dynamic rule conversion is imperfect. |
| `rationalize` | Clean IAM posture in Entra. Better audit trail. Access packages provide self-service + approval workflows. Dynamic groups reduce manual membership operations. | Significantly more effort. Requires IAM governance conversations. Group owners must participate. Migration timeline extends. |

---

## The Regex Problem (Critical)

This is not a small gotcha — **it determines whether `lift_and_shift` is even viable for your dynamic groups.**

Okta group rules support full regular expressions using the `=~` operator:
```
# Okta group rule — supported syntax
profile.department =~ "^Eng(ineering)?$"
profile.email =~ ".*@partner\.acme\.com$"
```

Entra dynamic membership rules do **not** support regex. They only support:
- `-eq` (exact match)
- `-contains`
- `-startsWith`
- `-endsWith`
- `-match` (limited pattern, not full POSIX/ECMAScript regex)

**Before deciding `lift_and_shift`:** Run `lib/okta`'s group rules export and count how many rules use regex. Rules that can't be approximated in Entra syntax require either:
- A manual membership group (someone updates it) — defeats the purpose
- An access package — effectively rationalization for those groups
- A custom Azure AD provisioning extension — significant engineering

See [okta-to-entra-migration-map.md](../okta-to-entra-migration-map.md) for the full group rules mapping table.

---

## Recommended Default

**`lift_and_shift`**

**Rationale:** Lift-and-shift is the lower-risk default for getting to a working Entra environment. It preserves access continuity during a period where the migration itself is the priority. Group debt can be rationalized post-migration as a separate IAM hygiene initiative.

**However:** Do not lift-and-shift blindly. Flag every Okta group rule that uses regex — those groups must either be manually maintained in Entra, rationalized, or rebuilt with Entra-compatible rule syntax. The migration map will tell you which ones need attention.

**Rationalize if:** You have a governance mandate, an active Entitlement Management deployment, or an existing PIM rollout — in those cases, rationalization is cheaper to do during migration than to retrofit afterward.

---

## Group Type Reference

Okta has three group types. Only `OKTA_GROUP` is directly managed in Okta:

| Okta Group Type | Description | Entra Equivalent |
|-----------------|-------------|-----------------|
| `OKTA_GROUP` | Manually managed or rule-based Okta group | Security group (static or dynamic) |
| `APP_GROUP` | Pushed from app (e.g., AD group pushed via SCIM) | Already exists in Entra — reconcile, don't duplicate |
| `BUILT_IN` | "Everyone" group — all org users | No Entra group equivalent — use CA `includeUsers: All` |

> **"Everyone" group has no Entra equivalent.** If your app assignments or policies use the Okta "Everyone" group, you must translate to `All users` in CA policies or an explicit dynamic group (`user.userType -ne null`).

---

## Rollback Implication

- **`lift_and_shift` rollback:** Group membership in Entra is reset to Okta state. If Okta groups were not deprovisioned, rollback means re-syncing from Okta's export. Low-friction.
- **`rationalize` rollback:** Access packages and PIM roles cannot be trivially reverted to flat groups. Rollback of a rationalized model requires re-granting access via the old flat-group model in Entra or returning to Okta. **Higher rollback cost than lift-and-shift.**

---

## Config Field Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  strategy:
    group_strategy: lift_and_shift   # YOUR ANSWER: lift_and_shift | rationalize
```

**Next decision:** [05 — Federation Direction](05-federation-direction.md)
