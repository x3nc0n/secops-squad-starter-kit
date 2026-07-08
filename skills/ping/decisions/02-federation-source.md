---
title: "Decision 02 — Federation Source and Entra Trust Direction"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - source_of_truth.federation_source
  - strategy.federation_direction
---

# Decision 02 — Federation Source and Entra Trust Direction

## The Decision

Two related questions answered together:

1. **Which Ping product issues SAML/OIDC tokens today?** (the `federation_source`)
2. **What is the trust direction between Ping and Entra during and after migration?** (the `federation_direction`)

These define the coexistence architecture — how both systems operate simultaneously before the final cutover.

---

## Part A: Federation Source (`federation_source`)

### `pingfederate`
PingFederate is the current token issuer. It acts as an IdP for SAML SP connections and an Authorization Server for OIDC clients. This is the most common pattern.

### `pingone`
PingOne cloud is the current token issuer. Apps are registered against the PingOne tenant, not a PF server. Common in cloud-first or recently-modernized Ping deployments.

### `aic`
AIC (ForgeRock lineage) is the current token issuer. Authentication trees in AIC drive the session and token model.

---

## Part B: Entra Trust Direction (`federation_direction`)

### `ping_idp_into_entra`
Ping remains the IdP; Entra is configured to trust Ping as an external IdP (SAML or OIDC federation). Apps that need Entra access authenticate via Ping → Entra trusts the Ping assertion.

**Use during coexistence:** Apps are moved to Entra one at a time. Until an app is migrated, it continues to use Ping directly. Entra receives federated assertions from Ping for users who are being migrated but whose apps aren't yet.

**Post-migration:** Ping is decommissioned; Entra is the sole IdP.

### `entra_idp`
Entra is the IdP from day one; Ping is configured to trust Entra (or is immediately decommissioned).

**Use when:** Performing a fast-track cutover with a small app estate where all apps can be re-configured simultaneously. Also use when the customer's SP estate is already in Entra (e.g., Ping was only used as an IDP proxy for a subset of apps).

### `per_app`
Trust direction is decided application-by-application. Some apps stay in Ping; others move to Entra. Each app has its own cutover date and federation config.

**Use when:** Large, complex app estates where some SPs cannot be updated quickly (vendor-managed, expensive to change, or have NameID blockers). Per-app requires maintaining both systems fully operational for an extended coexistence period.

---

## Trade-offs

| `federation_direction` | Pro | Con |
|---|---|---|
| `ping_idp_into_entra` | Preserves Ping as the user experience for apps that haven't moved yet. Safe, incremental. | Requires Entra → Ping SAML/OIDC trust config, which adds a federation hop. Longer coexistence = higher operational cost. |
| `entra_idp` | Cleanest architecture; eliminates coexistence complexity | Requires all apps to be re-configured to Entra simultaneously. High coordination burden. Blocked by any NameID-incompatible apps. |
| `per_app` | Most flexible; accommodates complex/slow SP owners | Hardest to operate. Both systems must be maintained indefinitely until all apps move. Risk of the "forever coexistence" anti-pattern. |

---

## Recommended Default

**`federation_direction: ping_idp_into_entra`** with a time-bounded coexistence agreement.

**Rationale:** Most enterprise Ping estates have dozens to hundreds of SP connections. Simultaneous cutover is operationally infeasible. The `ping_idp_into_entra` pattern lets apps migrate individually while users have a consistent Ping-based login experience until the bulk of apps are moved. Set a hard deadline for the coexistence period (recommend 90–180 days) to prevent the anti-pattern.

**Coexistence constraint:** PingFederate signing certificates expire (typically 2 years). Confirm the cert expiry before planning a long coexistence — you may be forced to rotate before you finish.

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  source_of_truth:
    federation_source: pingfederate    # YOUR ANSWER: pingfederate | pingone | aic
  strategy:
    federation_direction: ping_idp_into_entra  # YOUR ANSWER: ping_idp_into_entra | entra_idp | per_app
```

**Next decision:** [03 — NameID Strategy](03-nameid-strategy.md)
