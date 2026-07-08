---
title: Ping Migration Decision Harness — Index
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# Ping Identity Migration Decision Harness

This directory is the **operator-customization harness** for the SecOps Squad Ping Identity migration framework. It encodes the **decision space** — not the answers. Every significant choice in a Ping Identity → Entra ID migration is represented here as a structured, AI-consumable guide.

**The framework is reusable across any customer environment. You supply the answers; the framework enforces them.**

---

## How the Decision Gate Works

### 1. At Skill Activation

When an operator activates the Ping skills for a new engagement, the SecOps Squad agents will walk through these guides in order — prompting for each decision and recording the operator's answers.

Each guide:
- States the decision clearly
- Lists the exact enum values that are valid answers
- Explains the trade-offs between options
- Recommends a safe default with rationale
- Describes rollback implications per option
- Names the **exact `migration_profile` config field** it writes in `.secops/identity/ping.yaml`

### 2. Answers Land in `ping.yaml`

Every answer the operator provides is written into the `migration_profile` block in `.secops/identity/ping.yaml`. That block is the machine-readable record of the operator's declared choices.

```yaml
# .secops/identity/ping.yaml — migration_profile block
migration_profile:
  source_of_truth:            # Decisions 01, 02, 04
    identity_authority: ...
    federation_source: ...
    per_class_ownership: ...
  strategy:                   # Decisions 02, 03, 05, 06
    federation_direction: ...
    nameid_strategy: ...
    mfa_strategy: ...
    cutover_shape: ...
  execution:                  # Decision 07
    dry_run: ...
    entra_write_tooling: ...
```

### 3. Tooling Reads the Profile

`lib/ping/config.js` loads the `migration_profile` block and gates all tooling behavior on the declared values:
- No writes to an object class not declared Entra-owned
- Cutover workflow selected by `cutover_shape`
- NameID compatibility enforced by `nameid_strategy` + `assertNameIdPortable()`
- All state changes blocked when `dry_run: true`

> **You do not have to run these guides in isolation.** An AI agent running the Ping skill activation workflow will prompt through them in sequence, validate the answers against the enum, and write the profile in one pass.

---

## Decision Guide Index

| # | Guide | Decision | Config Field(s) |
|---|-------|----------|-----------------|
| 01 | [Source of Truth](01-source-of-truth.md) | Which Ping product is the identity authority? | `source_of_truth.identity_authority`, `hris_system` |
| 02 | [Federation Source](02-federation-source.md) | Which product issues tokens today, and what is the Entra trust direction? | `source_of_truth.federation_source`, `strategy.federation_direction` |
| 03 | [NameID Strategy](03-nameid-strategy.md) | How are SAML NameIDs mapped? (Critical blocker) | `strategy.nameid_strategy` |
| 04 | [Object Ownership](04-object-ownership.md) | Per-class migration order and ownership | `source_of_truth.per_class_ownership.*` |
| 05 | [MFA Strategy](05-mfa-strategy.md) | PingID re-enrollment vs passkey bootstrap | `strategy.mfa_strategy` |
| 06 | [Cutover Shape](06-cutover-shape.md) | Big bang vs phased (by app or population) | `strategy.cutover_shape` |
| 07 | [Execution Gates](07-execution-gates.md) | Dry-run mode and Entra write tooling | `execution.dry_run`, `execution.entra_write_tooling` |

---

## Tooling Boundary Reminder

Before answering any of these guides, understand the three-layer tooling boundary:

| Layer | Tool | What It Does |
|-------|------|-------------|
| **Ping admin / interactive** | `pingone-mcp-server` (PingOne environments, apps, populations) / `aic-mcp-server` (AIC sandbox) | Interactive admin, app inventory, population management |
| **Ping read / bulk export** | `lib/ping` (this repo) | Bulk export of users, groups, SP connections, OIDC clients, policies — **read-only** |
| **Entra write** | Microsoft Graph API | User provisioning, group creation, app registration, CA policies, federation config |

`lib/ping` never writes to Ping. Entra is always the write target. Ping is always the read source.

---

## Where Ping → Entra Doesn't Map 1:1

Many objects in Ping have no direct Entra equivalent. Before making decisions here, read:

**[`skills/ping/ping-to-entra-migration-map.md`](../ping-to-entra-migration-map.md)**

Key gotchas that directly affect these decisions:
- PingID MFA enrollments are **not portable** — every user must re-enroll in Entra
- NameID format is the **#1 blocker** — `transient`, `kerberos`, `X509SubjectName` are hard-blocked in Entra
- PingFederate first-match-wins policy evaluation ≠ Entra CA most-restrictive evaluation — behavioral difference at cutover
- DaVinci flows have **no automated migration path** to Entra Conditional Access
- PingFederate signing certificates are not portable — SPs must update their IdP metadata

---

## Quick Reference: Full `migration_profile` Schema

```yaml
migration_profile:
  source_of_truth:
    identity_authority: pingfederate   # pingfederate | pingone | aic | hris | mixed
    hris_system: null                  # e.g. "Workday" — required when hris or mixed
    federation_source: pingfederate    # pingfederate | pingone | aic — who issues tokens today
    per_class_ownership:
      users: ping                      # ping | entra
      credentials_mfa: ping            # ping | entra
      groups: ping                     # ping | entra
      app_assignments: ping            # ping | entra
      policies: ping                   # ping | entra
      saml_sp_connections: ping        # ping | entra — SAML federation config ownership
    per_attribute_authority: []
  strategy:
    cutover_shape: phased_by_app       # big_bang | phased_by_app | phased_by_population
    group_strategy: lift_and_shift     # lift_and_shift | rationalize
    federation_direction: ping_idp_into_entra  # ping_idp_into_entra | entra_idp | per_app
    mfa_strategy: pingid_reenroll      # pingid_reenroll | passkey_bootstrap | per_population
    nameid_strategy: map_to_persistent # map_to_persistent | use_email | manual_per_app
  execution:
    dry_run: true                      # true | false (always start true)
    entra_write_tooling: microsoft_graph  # microsoft_graph | entra_native | none
```
