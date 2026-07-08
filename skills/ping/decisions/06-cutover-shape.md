---
title: "Decision 06 — Cutover Shape"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.cutover_shape
---

# Decision 06 — Cutover Shape

## The Decision

**How is the migration cutover structured — all at once, app by app, or population by population?**

This is the pacing and risk management decision. It determines how long the coexistence period lasts and what the operational burden looks like.

---

## Options

### `big_bang`
All users and all apps cut over to Entra simultaneously on a planned date. Ping is decommissioned in a single maintenance window.

**When to use:** Small app estates (< 20 SP connections), all SPs have compatible NameIDs, a complete Authenticator pre-registration campaign has been run, and stakeholders accept the all-or-nothing risk profile.

**Critical prerequisites for big_bang:**
1. All SP connections have compatible NameID formats (no blocked SPs)
2. Every SP admin has pre-staged the Entra IdP metadata in their system
3. ≥ 90% of users have completed Entra MFA enrollment
4. Rollback plan is documented and tested (restoring PF as IdP for all SPs within 30 minutes)

### `phased_by_app`
SP connections/apps are migrated individually or in small batches. Each app gets its own cutover date. PingFederate continues to serve unmigrated apps during the transition.

**When to use:** Most enterprise Ping migrations. Allows individual SP owners to control their own readiness. Isolates risk — a bad migration of one SP doesn't affect others.

**Operational requirement:** PingFederate must remain operational and maintained until the last SP is migrated. Track migration status per SP connection in a separate tracking artifact (see `assertHybridCoverage()` in gate.js for automated surface coverage tracking).

**PF certificate gotcha:** If the coexistence period extends beyond the PingFederate signing certificate's validity, you will need to rotate the PF cert during migration — a disruptive operation requiring SP metadata updates for all still-in-PF apps. Plan the migration timeline against the cert expiry date. Run `getServerSettings()` and check the certificate validity.

### `phased_by_population`
Users are migrated to Entra by population segment (PingOne populations or PF-scoped user groups). All apps for each user population cut over together when that population is ready.

**When to use:** PingOne-heavy deployments where user segmentation by population is already the operational unit. Requires clear mapping from PingOne populations to Entra groups.

**Complexity:** This shape requires that SPs support per-user IdP selection (i.e., during coexistence, the same SP must accept SAML assertions from both PF and Entra, differentiated by user). This is possible via SP-level IdP discovery, but requires SP cooperation.

---

## Trade-offs

| Shape | Pro | Con |
|-------|-----|-----|
| `big_bang` | Fastest. Cleanest. No long coexistence. | Highest risk. Requires total readiness across all dimensions simultaneously. One failure blocks the entire cutover. |
| `phased_by_app` | Standard approach. Isolates risk. SPs migrate independently. | Longest coexistence period. PF must be maintained in production throughout. PF cert expiry is a time constraint. |
| `phased_by_population` | Aligns with PingOne's segmentation model. User experience is consistent per population group. | Requires SP-side IdP routing capability (many SPs don't support this). Complex to orchestrate. Less common in PF-heavy deployments. |

---

## Recommended Default

**`phased_by_app`**

**Rationale:** For most enterprise Ping → Entra migrations, the app estate is the natural unit of migration progress. SP owners (Salesforce, Workday, ServiceNow, etc.) have independent timelines and readiness criteria. `phased_by_app` lets each owner proceed at their own pace while the rest of the estate remains stable in Ping. It is the approach with the most industry precedent and the most forgiving risk profile.

**Set a hard coexistence end date.** Without a deadline, `phased_by_app` becomes "forever coexistence" — a common failure mode. Communicate a decommission date for PingFederate (recommend 6–12 months from migration start) and enforce it.

---

## Cutover Tracking Integration

`gate.js assertHybridCoverage(profile, confirmedSurfaces)` verifies that all surfaces declared in the profile have been confirmed reachable. This does NOT track per-app cutover status — use a separate tracking artifact (spreadsheet, JIRA board, or migration dashboard) to track which SP connections have moved.

The gate function catches a different failure mode: a surface (PF server, PD, PA) that was declared in the profile but cannot be reached during a discovery run, which would produce an incomplete inventory and a flawed migration plan.

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  strategy:
    cutover_shape: phased_by_app     # YOUR ANSWER: big_bang | phased_by_app | phased_by_population
```

**Next decision:** [07 — Execution Gates](07-execution-gates.md)
