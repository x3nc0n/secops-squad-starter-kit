---
title: "Decision 07 — Execution Gates"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - execution.dry_run
  - execution.entra_write_tooling
---

# Decision 07 — Execution Gates

## The Decision

Two distinct but related execution-layer decisions:

1. **`dry_run`** — Should tooling run in simulation mode or actually execute state changes?
2. **`entra_write_tooling`** — Which tooling routes Entra-side writes?

These are the last gates before any live state change occurs.

---

## The Ping Gate Contract

`lib/ping/gate.js` exposes four gate functions that must be satisfied before any migration operation proceeds. Understand what each blocks:

### `assertEntraOwned(profile, objectClass, surface)`
Blocks writes to any class still declared `ping` in `per_class_ownership`. Ping is always the read source — this gate prevents accidental writes to the Ping side and ensures Entra writes only happen to declared-ready classes.

- `objectClass`: `users` | `credentials_mfa` | `groups` | `app_assignments` | `policies` | `saml_sp_connections`
- `surface`: `pingone_cloud` | `pingfederate` | `pingdirectory` | `aic`

### `assertNameIdPortable(profile, sourceNameIdFormat)`
Hard-blocks SAML app migration if the source NameID format is incompatible with Entra. No amount of configuration can make Entra emit `transient`, `kerberos`, or `X509SubjectName`. This gate stops you before wasting time migrating a blocked SP connection.

**Blocked formats (hard fail):**
- `urn:oasis:names:tc:SAML:2.0:nameid-format:transient`
- `urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos`
- `urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName`
- `urn:oasis:names:tc:SAML:2.0:nameid-format:encrypted`

**Return shape on block:** `{ok: false, error: '...', blocker: 'nameid_incompatible'}`

### `assertHybridCoverage(profile, confirmedSurfaces)`
Blocks a full discovery run if any declared surface (PF, PD, PA, PingOne, AIC) was not confirmed reachable. Prevents incomplete inventory that produces a flawed migration plan.

Call this at the end of Phase 1 discovery, after running `detectDeployment()`. If any surface is unreachable, the discovery report must be marked incomplete.

### `dryRunGuard(profile, opDescription)`
Short-circuits any state-changing operation when `execution.dry_run: true`. Returns a simulated diff object describing what would have been written, instead of calling the API.

The operational workflow:
```
dry_run: true  → review diff output → validate against expected state
              → set dry_run: false → execute → confirm state
              → set dry_run: true again (reset to safe default)
```

---

## Decision A: Dry Run (`execution.dry_run`)

### `true`
Simulation mode. `lib/ping` exports, computes diffs, and outputs what it *would* write to Entra — no Graph API calls are made. Ping reads still happen (read-only is always safe).

**This is the safe default and the required posture for all non-validated runs.**

### `false`
Live execution mode. Graph API calls execute. State changes are real. **Requires explicit operator confirmation.**

---

### Dry Run Trade-offs

| `dry_run: true` | `dry_run: false` |
|-----------------|------------------|
| Zero risk to live identity state | Executes immediately |
| Required for validation passes, reviews | Required for actual provisioning |
| Output is a plan/diff for human review | Errors affect live users/apps/policies |
| Cannot validate actual API response | Full end-to-end pipeline validation |

**Recommended default: `true`. Always. Without exception.**

> After any live execution run, reset `dry_run` back to `true` in `ping.yaml` before committing. The config file must not be re-runnable without a deliberate change.

---

## Decision B: Entra Write Tooling (`execution.entra_write_tooling`)

### `microsoft_graph`
All Entra writes (user provisioning, group creation, app registration, CA policy deployment) go through the Microsoft Graph REST API. Lowest level, most flexible, fully programmable.

### `entra_native`
Entra writes via Entra-native admin tools — portal bulk import, PowerShell `Microsoft.Graph` module, or Entra ID Governance tooling. Lower barrier, appropriate for smaller migrations.

### `none`
No Entra write tooling configured. Valid during discovery/prep phases only. **Only valid when `dry_run: true`.**

---

### Entra Write Tooling Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `microsoft_graph` | Full programmatic control. Idempotent. Bulk operations. Integrates with `lib/ping` reconciliation loop. | Requires Graph app registration with appropriate permissions. More engineering setup. |
| `entra_native` | Lower barrier. GUI-based. Familiar to Entra admins. | Hard to reconcile. Manual error-prone at scale. |
| `none` | Valid for discovery. No Entra credentials needed yet. | Blocks all actual provisioning. Must change before execution. |

**Recommended default: `microsoft_graph`**

---

## The Full Gate Flow (Ping)

```
Operator declares nameid_strategy, per_class_ownership in ping.yaml
          ↓
Phase 1: lib/ping reads all Ping surfaces (users, groups, SP connections, policies)
          ↓
assertHybridCoverage() — confirms all declared surfaces were reached
assertNameIdPortable()  — logs BLOCKER for each incompatible SP connection NameID
          ↓
Discovery report: full inventory + blocked SP list
          ↓
Operator reviews — remediates blocked SPs with SP vendors
          ↓
Operator sets per_class_ownership.users: entra (first class)
          ↓
dry_run: true → diff computed → review
          ↓
Operator sets dry_run: false
          ↓
assertEntraOwned(profile, 'users', 'pingone_cloud') → passes
dryRunGuard() → passes (dry_run is false)
          ↓
Graph API writes users
          ↓
Confirm → set dry_run: true again
```

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  execution:
    dry_run: true                         # YOUR ANSWER: true | false (always start true)
    entra_write_tooling: microsoft_graph  # YOUR ANSWER: microsoft_graph | entra_native | none
```

---

## Decision Harness Complete

You have now walked through all seven decision guides. Your `migration_profile` in `.secops/identity/ping.yaml` should be fully populated. Return to the [harness README](README.md) and verify every field has a declared value.

Once the profile is populated:
1. `lib/ping/config.js` validates the schema and rejects unknown enum values
2. `lib/ping/gate.js` reads `dry_run`, `per_class_ownership`, and `nameid_strategy` before every operation
3. The SecOps Squad agents will surface your declared choices in every migration workflow prompt

**Start the actual migration work:** [`skills/ping/README.md`](../README.md)
