---
title: "Decision 05 — Federation Direction During Coexistence"
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.federation_direction
---

# Decision 05 — Federation Direction During Coexistence

## The Decision

**During the coexistence window, which system is the IdP? And how do you route authentication requests?**

This decision governs how users authenticate during the transition period when both Okta and Entra are active. There are three viable architectural postures. They are not mutually exclusive across apps, but you should pick one as the dominant pattern and use `per_app` only for genuine edge cases.

---

## Options

### `okta_idp_into_entra`
Okta remains the primary IdP. Entra is configured to trust Okta-issued SAML or OIDC tokens (Okta is registered as a federated IdP in Entra external identities or as a SAML IdP trust). Apps that have been migrated to Entra app registrations still accept Okta-authenticated tokens during the transition window. Okta manages MFA; Entra respects the MFA claim from Okta.

**This is the default coexistence posture in most migrations.**

### `entra_idp`
Entra becomes the IdP immediately. All authentication routes through Entra from the moment coexistence begins. Okta is still provisioned (for apps not yet migrated), but its role as the authenticating IdP is removed or minimized. MFA re-enrollment must happen before or simultaneously with the Entra-IdP switch.

### `per_app`
Authentication routing is decided per application. Some apps authenticate through Okta (not yet migrated), others through Entra (already migrated). This requires per-app IdP routing logic — either in Okta's IdP Discovery policy (routing some apps to Entra while Okta serves others) or at the SP level (each app's metadata points to the appropriate IdP).

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `okta_idp_into_entra` | Users don't re-enroll MFA until final cutover. Okta continues providing consistent auth experience. Lower disruption during migration. | Okta trust relationship in Entra must be carefully removed at final cutover. MFA re-enrollment deferred (but not avoided — it must still happen). Okta infrastructure stays active longer. |
| `entra_idp` | Faster Entra adoption. MFA re-enrollment happens once, early. Entra Identity Protection, Smart Lockout, and CA policies are active from day one of coexistence. | High disruption at coexistence start — all users must re-enroll MFA before the switch. Riskiest option if Entra is not fully validated. |
| `per_app` | Surgical control — each app migrates independently. No cross-app dependency. | Operationally complex. Users may authenticate through Okta for one app and Entra for another simultaneously — session management across IdPs can cause confusion. Requires per-app routing maintenance. |

---

## Recommended Default

**`okta_idp_into_entra`**

**Rationale:** Keeping Okta as the authenticating IdP during coexistence is the lowest-disruption path. Users experience no change to their authentication flow until the final cutover wave. MFA re-enrollment is deferred to the cutover phase (where it is unavoidable regardless of federation direction). The Okta SAML trust in Entra is a temporary configuration that is removed as the final decommission step.

This is the posture recommended in McNulty's architecture document and aligns with the standard Microsoft migration guidance for Okta → Entra migrations.

**Reassess if:** You have a strong compliance or security driver to activate Entra Identity Protection early (in which case `entra_idp` or `per_app` for high-risk apps may be warranted), or if the Okta infrastructure has contractual end-of-life pressure before the migration timeline completes.

---

## Token Trust During `okta_idp_into_entra`

When Okta is registered as a SAML IdP in Entra:
- Entra trusts the `mfa` claim in Okta-issued SAML assertions
- Apps configured in Entra (Enterprise Apps or App Registrations) accept Okta-authenticated sessions
- Entra Conditional Access can be applied, but MFA satisfaction comes from Okta's assertion

> ⚠️ **MFA claim pass-through is configuration-dependent.** Verify that the Okta SAML assertion includes `authnContextClassRef` = `urn:oasis:names:tc:SAML:2.0:ac:classes:MFA` and that the Entra CA policies are configured to honor it. Misconfigured MFA claim pass-through is a common cutover blocker.

---

## The SAML Trust Removal Step (Final Cutover)

When you shift from `okta_idp_into_entra` to `entra_idp` at final cutover:
1. Ensure all users have completed MFA re-enrollment in Entra
2. Remove the Okta SAML IdP trust from Entra external identities
3. Update any app-specific IdP metadata that still references Okta
4. Validate that CA policies no longer reference the Okta MFA claim
5. Deactivate Okta federation app in Okta admin console

This is a **one-way door** at the Entra trust level. Once removed, reverting requires re-establishing the SAML trust relationship from scratch.

---

## Mapping Note

There is no 1:1 mapping between Okta IdP Discovery policy and Entra's Home Realm Discovery. If you use `per_app`, be aware that Okta's IdP discovery routing rules (based on email domain, network zone, or application) have no direct equivalent in Entra — you will need per-application routing configuration at the SP level.

See [okta-to-entra-migration-map.md](../okta-to-entra-migration-map.md) for the policy mapping table.

---

## Config Field Written

```yaml
# .secops/identity/okta.yaml — migration_profile
migration_profile:
  strategy:
    federation_direction: okta_idp_into_entra   # YOUR ANSWER: okta_idp_into_entra | entra_idp | per_app
```

**Next decision:** [06 — MFA Strategy](06-mfa-strategy.md)
