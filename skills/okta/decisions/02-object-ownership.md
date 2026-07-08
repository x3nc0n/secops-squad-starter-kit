---
title: "Decision 02 — Object Ownership (Per-Class Writer)"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - source_of_truth.per_class_ownership.users
  - source_of_truth.per_class_ownership.credentials_mfa
  - source_of_truth.per_class_ownership.groups
  - source_of_truth.per_class_ownership.app_assignments
  - source_of_truth.per_class_ownership.policies
---

# Decision 02 — Object Ownership (Per-Class Single Writer)

## The Decision

**For each object class, which system is the single authoritative writer at any given migration phase?**

The single-writer-per-class rule prevents split-brain: if two systems can write to the same object class simultaneously, you will have divergence that is expensive to reconcile. This matrix is filled in per-phase — ownership should shift from Okta to Entra progressively as the migration advances, never simultaneously.

---

## Object Classes

### `users`
Lifecycle events — create, update, deactivate, delete. Entra "owns" users when Entra is the provisioning target and Okta is no longer creating/modifying records.

**Enum:** `okta` | `entra`

### `credentials_mfa`
Authentication factors and MFA enrollments. This class almost always stays with Okta until final cutover, then transfers fully to Entra. There is no migration path for credentials — ownership transfer means re-enrollment, not portability.

**Enum:** `okta` | `entra`

### `groups`
Group creation, membership, and deletion. During coexistence, Okta groups may be synced to Entra (read from Okta, written to Entra) — but the authoritative writer is the system where group membership decisions are made.

**Enum:** `okta` | `entra`

### `app_assignments`
Application access grants — who has access to what app. This is distinct from group membership: it tracks the entitlement layer (direct app assignment vs. group-based access).

**Enum:** `okta` | `entra`

### `policies`
Sign-on policies, MFA enrollment policies, password policies, Conditional Access policies. Policy ownership typically transfers last because policy validation requires a fully migrated population to test against.

**Enum:** `okta` | `entra`

---

## Trade-offs

| Keeping in Okta | Transferring to Entra |
|-----------------|-----------------------|
| Zero disruption to existing access | Enables Entra-native features (Smart Lockout, Identity Protection, SSPR) |
| Rollback is simple (nothing changed in Entra) | Requires Entra configuration to be validated before Okta deprovisioning |
| Risk: Entra objects drift from Okta truth if Okta is still the writer | Risk: premature transfer creates a gap if Entra isn't ready |

---

## The Ownership Matrix

**Fill this in per phase of your migration.**

This is the canonical ownership matrix. Mark each cell as `okta` or `entra` for each phase. The `migration_profile` holds your current-phase declaration — it should be updated as phases complete.

```
                  | Discovery | Prep | Coexistence | Cutover | Post-Cutover
------------------|-----------|------|-------------|---------|-------------
users             |   okta    | okta |    okta     | entra   |   entra
credentials_mfa   |   okta    | okta |    okta     | entra   |   entra
groups            |   okta    | okta |    okta     | entra   |   entra
app_assignments   |   okta    | okta | okta/entra  | entra   |   entra
policies          |   okta    | okta |    okta     | entra   |   entra
```

> **Standard starting position:** All classes owned by `okta`. Transfer happens progressively during cutover.

---

## Recommended Default

**All classes `okta` during discovery/prep/coexistence; shift to `entra` at cutover.**

The `migration_profile` captures the current state. Update the values as each class is formally transferred. Do not declare Entra ownership until Entra objects are validated and Okta writes have been deprovisioned for that class.

---

## Critical Rule: No Simultaneous Writers

The official Okta MCP server (Okta-side writes) and Microsoft Graph (Entra-side writes) must respect this matrix. `lib/okta/config.js` reads `per_class_ownership` and gates operations accordingly:

- If `users: okta`, `lib/okta` may export users but Graph should not be creating/updating users independently
- If `groups: entra`, the MCP server should not be creating new Okta groups (though it may still read them)

The tooling enforces this through the ownership gate — it will refuse a write to a class not declared as its domain.

---

## Rollback Implication

Per class:
- **`users` rollback from entra → okta:** Reverse the provisioning sync direction; mark Okta users active; deactivate Entra-only users until Okta is restored as writer
- **`credentials_mfa` rollback:** Users re-enroll in Okta MFA; Entra MFA registrations are not portable back to Okta
- **`groups` rollback:** Restore group membership management to Okta; any Entra-only group changes are lost unless reconciled
- **`policies` rollback:** Reactivate Okta sign-on/MFA policies; Entra CA policies must be disabled or set to report-only

---

## Config Fields Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  source_of_truth:
    per_class_ownership:
      users: okta             # YOUR ANSWER: okta | entra
      credentials_mfa: okta   # YOUR ANSWER: okta | entra
      groups: okta            # YOUR ANSWER: okta | entra
      app_assignments: okta   # YOUR ANSWER: okta | entra
      policies: okta          # YOUR ANSWER: okta | entra
```

**Next decision:** [03 — Cutover Shape](03-cutover-shape.md)
