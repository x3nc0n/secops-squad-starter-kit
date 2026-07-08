---
title: "Decision 05 — MFA Strategy"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.mfa_strategy
---

# Decision 05 — MFA Strategy

## The Decision

**How do you handle MFA re-enrollment when migrating from PingID to Entra?**

PingID enrollments are non-portable across identity provider boundaries. Every user who has PingID enrolled will need to re-enroll in Microsoft Entra MFA. The only question is *how* you manage that re-enrollment campaign.

---

## The Hard Rule

> **Zero PingID enrollments transfer to Entra. Plan for 100% re-enrollment.**

This is confirmed: PingID push credentials are bound to PingID's push infrastructure. TOTP seeds are PingID-custody. FIDO2/WebAuthn registrations are RP-bound to the Ping domain. None of these transfer.

The only MFA credentials that carry over naturally are phone numbers (for SMS/voice OTP). Confirm phone number format normalization to E.164 before relying on this.

---

## Options

### `pingid_reenroll`
Users are enrolled in Microsoft Authenticator via a pre-migration campaign. Before any SP connection is cut over to Entra, every user in scope receives a registration invitation (Microsoft Authenticator setup link or Temporary Access Pass).

**How it works:**
1. Provision users into Entra (users class moves to `entra`)
2. Run the Microsoft Authenticator registration campaign via the Entra Registration Campaign feature
3. Monitor registration completion; use Entra sign-in logs + registration report to track progress
4. Set an Authenticator-required CA policy in report-only mode to measure readiness
5. Once ≥ 95% registered (with exceptions handled), cut over apps and switch CA to enforcement mode

**Gotcha:** Users who don't pre-register will be blocked at first Entra login (if MFA is required). Have a TAP (Temporary Access Pass) help-desk process ready for stragglers.

### `passkey_bootstrap`
Skip traditional MFA and drive users directly to FIDO2 passkey registration as their primary Entra authenticator. Users register a platform passkey (Touch ID, Windows Hello, Android biometric) or hardware key at first Entra login.

**How it works:**
1. Configure Entra for FIDO2 authentication (Authentication Methods Policy)
2. Issue Temporary Access Pass to all users at first login
3. Users authenticate with TAP and are immediately prompted to register a passkey
4. CA policy enforces phishing-resistant MFA (authentication strength) after passkey registered

**When to use:** Organizations with a strong security posture who want to skip the Authenticator app entirely and go passwordless. Requires more user education. Excellent for high-security environments (finance, healthcare).

**Gotcha:** FIDO2 hardware keys are re-usable but require re-registration (new RP, new credential). Platform passkeys (Touch ID / Windows Hello) are device-bound — new credential per device.

### `per_population`
Different MFA re-enrollment strategies applied to different user populations. Typically used when:
- Executive or privileged users get passkey_bootstrap for higher security
- General users get the standard Authenticator reenroll campaign
- Contractors or guests get a different flow (no Authenticator; use SMS OTP)

**How it works:**
- Segment users by Entra group (mapped from PingOne populations or PF policy groups)
- Apply different Authentication Methods Policies and CA authentication strength requirements per group
- Run separate enrollment campaigns per population segment

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `pingid_reenroll` | Most familiar to users. Authenticator push UX is similar to PingID push. Highest pre-migration completion rate. | Does not improve security posture. Users carry over the push-based MFA habits. Phishing-resistant upgrade requires a second campaign. |
| `passkey_bootstrap` | Highest security posture from day one. Eliminates push-hijacking risk. No app download required for platform passkeys. | More user education required. Help-desk burden higher at launch. Device-bound passkeys mean re-enroll on each new device. |
| `per_population` | Tailored to risk tier and user type. Can start with `pingid_reenroll` for bulk and `passkey_bootstrap` for privileged. | Operational complexity. Multiple enrollment campaigns. Harder to track completion across segments. |

---

## Recommended Default

**`pingid_reenroll`**

**Rationale:** For most organizations migrating from PingID, the Microsoft Authenticator push flow is the least disruptive transition for end users — the UX is functionally equivalent to PingID push. Starting with `pingid_reenroll` maximizes first-day adoption rates, which directly determines how quickly you can enforce MFA in CA policies. Once the bulk of users are on Authenticator, run a second campaign to upgrade high-value accounts to passkeys.

**Upgrade path:** After migration is stable, run `passkey_bootstrap` for admin accounts as a Phase 2 security uplift.

---

## Temporary Access Pass (TAP) Planning

Regardless of the MFA strategy, plan a TAP (Temporary Access Pass) process for:
- Users who fail to self-enroll before cutover
- Users who lose/replace their device during migration
- New joiners who cannot authenticate via the old method
- Help-desk-assisted recovery scenarios

TAP is a time-limited one-time code issued by admins that allows first-time Entra login without pre-existing MFA. It is the escape hatch for every MFA migration scenario.

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  strategy:
    mfa_strategy: pingid_reenroll    # YOUR ANSWER: pingid_reenroll | passkey_bootstrap | per_population
```

**Next decision:** [06 — Cutover Shape](06-cutover-shape.md)
