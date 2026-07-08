---
title: Okta Migration Decision Harness — Index
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Migration Decision Harness

This directory is the **operator-customization harness** for the SecOps Squad Okta migration framework. It encodes the **decision space** — not the answers. Every significant choice in an Okta → Entra ID migration is represented here as a structured, AI-consumable guide.

**The framework is reusable across any customer environment. You supply the answers; the framework enforces them.**

---

## How the Decision Gate Works

### 1. At Skill Activation

When an operator activates the Okta skills for a new engagement, the SecOps Squad agents will walk through these guides in order — prompting for each decision and recording the operator's answers.

Each guide:
- States the decision clearly
- Lists the exact enum values that are valid answers
- Explains the trade-offs between options
- Recommends a safe default with rationale
- Describes rollback implications per option
- Names the **exact `migration_profile` config field** it writes in `.secops/identity/okta.yaml`

### 2. Answers Land in `okta.yaml`

Every answer the operator provides is written into the `migration_profile` block in `.secops/identity/okta.yaml`. That block is the machine-readable record of the operator's declared choices.

```yaml
# .secops/identity/okta.yaml — migration_profile block
migration_profile:
  source_of_truth:       # Decision 01, 02
    identity_authority: ...
    per_class_ownership: ...
  strategy:              # Decisions 03–06
    cutover_shape: ...
    group_strategy: ...
    federation_direction: ...
    mfa_strategy: ...
  execution:             # Decision 07
    dry_run: ...
    entra_write_tooling: ...
```

### 3. Tooling Reads the Profile

Sydnor's `lib/okta/config.js` loads the `migration_profile` block and gates all tooling behavior on the operator's declared values:
- No writes to an object class not declared Entra-owned
- Cutover workflow selected by `cutover_shape`
- State changes blocked when `dry_run: true`

> **You do not have to run these guides in isolation.** An AI agent running the Okta skill activation workflow will prompt through them in sequence, validate the answers against the enum, and write the profile in one pass.

---

## Decision Guide Index

| # | Guide | Decision | Config Field(s) |
|---|-------|----------|-----------------|
| 01 | [Source of Truth](01-source-of-truth.md) | Is Okta the identity authority, or does an upstream HRIS own the record? | `source_of_truth.identity_authority`, `hris_system`, `per_attribute_authority` |
| 02 | [Object Ownership](02-object-ownership.md) | Which system is the single writer per object class per phase? | `source_of_truth.per_class_ownership.*` |
| 03 | [Cutover Shape](03-cutover-shape.md) | How is the migration cutover structured? | `strategy.cutover_shape` |
| 04 | [Group Strategy](04-group-strategy.md) | Lift-and-shift Okta groups or rationalize to Entra dynamic groups and access packages? | `strategy.group_strategy` |
| 05 | [Federation Direction](05-federation-direction.md) | Which system is the IdP during coexistence? | `strategy.federation_direction` |
| 06 | [MFA Strategy](06-mfa-strategy.md) | How do you handle MFA re-enrollment? | `strategy.mfa_strategy` |
| 07 | [Execution Gates](07-execution-gates.md) | Dry-run mode and Entra write tooling selection | `execution.dry_run`, `execution.entra_write_tooling` |

---

## Tooling Boundary Reminder

Before answering any of these guides, understand the three-layer tooling boundary:

| Layer | Tool | What it does |
|-------|------|-------------|
| **Okta admin/write** | Official Okta MCP Server | Interactive CRUD, policy changes, system logs, destructive ops with elicitation |
| **Okta read/export** | `lib/okta` (this repo) | Bulk export, mapping, reconciliation, dry-run diffing — **read-only** |
| **Entra write** | Microsoft Graph API | User provisioning, group creation, app registration, CA policies, federation config |

The official MCP server performs **writes on the Okta side**. The declared `per_class_ownership` in the `migration_profile` determines what the MCP server is permitted to write. `lib/okta` never writes to Okta. Neither tool touches Entra — that is Graph's domain exclusively.

---

## Where Okta → Entra Doesn't Map 1:1

Many objects and behaviors in Okta have no direct Entra equivalent. Before making decisions here, read:

**[`skills/okta/okta-to-entra-migration-map.md`](../okta-to-entra-migration-map.md)**

Key gotchas that directly affect these decisions:
- MFA enrollments are **not portable** — every user must re-enroll in Entra (see Guide 06)
- Okta sign-on policy is **first-match-wins**; Entra CA is **most-restrictive** — behavioral difference at cutover
- Okta group rules support full regex; Entra dynamic membership rules do not
- SWA apps have no Entra equivalent and cannot be migrated

---

## Quick Reference: Full `migration_profile` Schema

```yaml
migration_profile:
  source_of_truth:
    identity_authority: okta        # okta | hris | mixed
    hris_system: null               # e.g. "Workday" — required when hris or mixed
    per_class_ownership:
      users: okta                   # okta | entra
      credentials_mfa: okta         # okta | entra
      groups: okta                  # okta | entra
      app_assignments: okta         # okta | entra
      policies: okta                # okta | entra
    per_attribute_authority: []     # [{attribute: manager, authority: hris}]
  strategy:
    cutover_shape: phased_by_population   # big_bang | phased_by_app | phased_by_population
    group_strategy: lift_and_shift        # lift_and_shift | rationalize
    federation_direction: okta_idp_into_entra  # okta_idp_into_entra | entra_idp | per_app
    mfa_strategy: reenroll_campaign       # reenroll_campaign | passkey_bootstrap | per_population
  execution:
    dry_run: true                         # true | false
    entra_write_tooling: microsoft_graph  # microsoft_graph | entra_native | none
```
