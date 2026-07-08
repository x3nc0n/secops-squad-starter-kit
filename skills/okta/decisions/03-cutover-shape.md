---
title: "Decision 03 — Cutover Shape"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.cutover_shape
---

# Decision 03 — Cutover Shape

## The Decision

**How is the migration cutover structured — all at once, by application, or by user population?**

This is the highest-impact operational decision in the migration. It determines risk profile, rollback complexity, communication overhead, and how long the coexistence window stays open.

---

## Options

### `big_bang`
Every user, every application, and every policy cutover happens in a single maintenance window. Okta is decommissioned; Entra is the sole IdP from that moment forward.

### `phased_by_app`
Applications are migrated one at a time (or in batches by risk tier). Each app's SP metadata is updated to point at Entra instead of Okta. Users accessing that app authenticate through Entra; users not yet migrated still hit Okta.

### `phased_by_population`
User cohorts are migrated progressively — typically pilot group → department → business unit → everyone. The same app may serve both Okta-authenticated and Entra-authenticated users during the transition window (requires IdP routing logic at the SP or a smart IdP Discovery policy in Okta).

---

## Trade-offs

| Option | Risk | Rollback | Coexistence Complexity | Best for |
|--------|------|----------|------------------------|----------|
| `big_bang` | **High** — single point of failure for all access | **Hard** — full Okta restore required; SAML/OIDC config must be reverted for all apps simultaneously | **None** — brief coexistence, then done | Smaller orgs (<500 users), simple app portfolio, aggressive timeline |
| `phased_by_app` | **Medium** — one app fails at a time; blast radius bounded | **Easy per app** — revert SP IdP metadata to Okta endpoint | **Moderate** — two IdPs active; apps independently migrated | Most common choice for medium-large orgs; maps naturally to app owner sign-off |
| `phased_by_population` | **Low** — pilot group absorbs initial impact | **Moderate** — rollback means re-routing that population back to Okta IdP | **High** — IdP routing logic required; same app must accept both Okta and Entra tokens simultaneously | Large orgs, complex app portfolio, strong need to validate before broad rollout |

---

## Recommended Default

**`phased_by_population`**

**Rationale:** Population-phased rollout gives you the tightest feedback loop on Entra authentication behavior before broad impact. Start with a pilot group (IT, volunteer early adopters), validate MFA re-enrollment, Conditional Access behavior, and app sign-in, then expand. Each wave is independently rollback-able by re-routing that population's IdP discovery.

The risk of `big_bang` is rarely worth the operational simplicity it offers — one misconfigured CA policy or missing attribute mapping affects every user simultaneously. `phased_by_app` is excellent but requires app-owner coordination for each wave; `phased_by_population` lets you validate the Entra experience end-to-end before touching app configurations.

**Reassess if:** You have a very small org, a compressed timeline, or an app portfolio where phased routing is technically infeasible (legacy SAML apps with hard-coded IdP discovery that can't be split by user).

---

## Rollback Per Option

### `big_bang` rollback
1. Restore all SAML/OIDC SP metadata to Okta endpoints (global find/replace across all app configurations)
2. Reactivate Okta sign-on policies (if deactivated)
3. Restore Okta as the provisioning source for all users
4. Deactivate or set Entra CA to report-only
5. Re-communicate to all users simultaneously

**Cost:** Very high. This is effectively running the cutover twice in reverse.

### `phased_by_app` rollback (per app)
1. Update the specific app's SP metadata to point back to Okta IdP endpoint
2. Verify Okta app assignment is still active for affected users
3. Test sign-in via Okta for that app
4. No impact on other already-migrated apps

**Cost:** Low per app. Independent per wave.

### `phased_by_population` rollback (per cohort)
1. Update IdP routing rule to send that population back to Okta
2. Verify Okta MFA is still enrolled (it is — Okta credentials are not removed until final decommission)
3. Test sign-in via Okta for a representative user from the cohort
4. Entra registrations for that cohort may be left in place or cleaned up

**Cost:** Medium. IdP routing logic must be maintained until full cutover is complete.

---

## Coexistence Mechanism by Option

| Option | How coexistence works |
|--------|-----------------------|
| `big_bang` | No coexistence — single-window switch |
| `phased_by_app` | Each app has its own IdP metadata. Apps point to either Okta or Entra. Users authenticate to whatever IdP their current-phase apps point to. |
| `phased_by_population` | IdP Discovery policy in Okta (or SP-side HRD hint) routes each user to Okta or Entra based on group membership, email domain, or attribute. Okta can act as a proxy IdP during transition. |

---

## Config Field Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  strategy:
    cutover_shape: phased_by_population   # YOUR ANSWER: big_bang | phased_by_app | phased_by_population
```

**Next decision:** [04 — Group Strategy](04-group-strategy.md)
