---
title: "Decision 07 — Execution Gates"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - execution.dry_run
  - execution.entra_write_tooling
---

# Decision 07 — Execution Gates

## The Decision

This guide covers two distinct but related execution-layer decisions:

1. **`dry_run`** — Should tooling run in simulation mode (output what it *would* do) or actually execute state changes?
2. **`entra_write_tooling`** — Which tooling does this engagement use for Entra-side writes?

These are the last gates before any live state change occurs. They belong together because they both govern the execution boundary.

---

## Decision A: Dry Run (`execution.dry_run`)

### `true`
All tooling runs in simulation mode. `lib/okta` exports, computes diffs, and outputs what it *would* write to Entra — but no API calls are made to Microsoft Graph. The official Okta MCP server will still perform Okta reads, but any write operation it proposes is shown for review, not executed.

**This is the safe default and the required posture for all non-validated runs.**

### `false`
Tooling executes live state changes. `lib/okta` will call Graph APIs to write users, groups, and app registrations to Entra. The Okta MCP server can perform writes to Okta. **This mode requires explicit operator confirmation.**

---

### Dry Run Trade-offs

| `dry_run: true` | `dry_run: false` |
|-----------------|------------------|
| Zero risk to live identity state | Executes changes immediately |
| Required for validation passes, audits, and reviews | Required to actually complete provisioning |
| Output is a diff/plan that humans review | Errors affect live users/apps/policies |
| Cannot validate the actual API response (just the intent) | Validates the full end-to-end pipeline |

---

### Dry Run Recommended Default

**`true`**

**Rationale:** Always start dry. No exception. The operational workflow is:

```
dry_run: true  → review output → validate against expected state
               → set dry_run: false → execute → confirm state
               → set dry_run: true again (reset to safe default)
```

Sydnor's `lib/okta/gate.js` enforces this: if `dry_run: true`, all write functions return a simulated diff object instead of calling the API. If `dry_run: false`, the gate passes and the API is called. The gate log records every run with a timestamp, operator identity, and dry/live flag.

> **Rule of thumb:** After any execution run that changes state, reset `dry_run` back to `true` in `okta.yaml` before committing. This ensures the config file cannot accidentally be re-run against live state without a deliberate change.

---

## Decision B: Entra Write Tooling (`execution.entra_write_tooling`)

Which API/toolset do Entra-side writes route through?

### `microsoft_graph`
All Entra writes (user provisioning, group creation, app registration, CA policy deployment) go through the Microsoft Graph REST API — specifically through `lib/graph-security` or a dedicated migration module calling Graph directly. This is the lowest-level, most flexible option and aligns with standard Microsoft migration tooling.

### `entra_native`
Entra writes are performed through Entra-native administrative tools — Entra admin portal bulk import, PowerShell `Microsoft.Graph` module, or Entra ID Governance tooling. Less programmatic, but appropriate for smaller migrations or environments where a custom Graph integration is not feasible.

### `none`
Entra write tooling is not configured for this engagement. This is valid during early discovery/prep phases where Okta export and analysis are the only active workflows. Entra writes will be handled manually or deferred. **Only valid when `dry_run: true`.**

---

### Entra Write Tooling Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `microsoft_graph` | Full programmatic control. Idempotent. Supports bulk operations. Integrates with `lib/okta` reconciliation loop. | Requires Graph app registration with appropriate permissions. More engineering setup. |
| `entra_native` | Lower barrier to entry. GUI-based. Familiar to Entra admins. | Less automation. Hard to diff/reconcile. Harder to reproduce exactly. Manual error-prone for large populations. |
| `none` | Valid for discovery/analysis phases. No Entra credentials needed. | Blocks any actual provisioning. Must be changed before execution. |

---

### Entra Write Tooling Recommended Default

**`microsoft_graph`**

**Rationale:** The migration framework is built around programmatic, idempotent, dry-run-gated operations. Microsoft Graph is the only option that fully supports that model. `lib/graph-security` (the Graph complement to `lib/okta`) is the intended Entra write path and is the one Sydnor's gate.js tests against when `dry_run: false`.

Use `entra_native` only if the org has a policy restricting custom Graph app registrations, or for ad-hoc manual steps during the migration. Use `none` during the discovery phase before any Entra configuration is in place.

---

## The Full Execution Gate Flow

```
Operator sets dry_run: true, entra_write_tooling: microsoft_graph
          ↓
lib/okta exports from Okta (reads only)
          ↓
Diff computed: what Graph calls WOULD be made
          ↓
Operator reviews diff — validates expected state changes
          ↓
Operator sets dry_run: false (explicit change to okta.yaml)
          ↓
lib/okta/gate.js passes — Graph calls execute
          ↓
Confirmation report written to audit log
          ↓
Operator resets dry_run: true
```

---

## Rollback Implication

- **`dry_run: true`** — There is nothing to roll back. No state was changed.
- **`dry_run: false` (post-execution rollback):** Rollback depends on the specific object class and the declared `per_class_ownership`. Entra objects provisioned from Okta can be deleted/reset if the migration is aborted. Refer to the class-specific rollback notes in [02 — Object Ownership](02-object-ownership.md).

---

## Config Fields Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  execution:
    dry_run: true                         # YOUR ANSWER: true | false  (default: true — always start here)
    entra_write_tooling: microsoft_graph  # YOUR ANSWER: microsoft_graph | entra_native | none
```

---

## Decision Harness Complete

You have now walked through all seven decision guides. Your `migration_profile` in `.secops/identity/okta.yaml` should be fully populated. Return to the [harness README](README.md) and verify that every field in the `migration_profile` block has a declared value (no `REPLACE_ME` remaining).

Once the profile is populated:
1. Sydnor's `lib/okta/config.js` will validate the schema and reject unknown enum values
2. `lib/okta/gate.js` will read `dry_run` and `per_class_ownership` before every operation
3. The SecOps Squad agents will surface your declared choices in every migration workflow prompt

**Start the actual migration work:** [`skills/okta/README.md`](../README.md)
