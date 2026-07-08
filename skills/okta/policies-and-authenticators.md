---
title: Okta Policies and Authenticators
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Policies and Authenticators

## Overview

Okta's policy model controls who can sign in, from where, with what factors, and what session characteristics are granted. The system consists of several policy types with rules inside them, plus an authenticator catalog that defines available factors. This is the most complex area of Okta → Entra migration because the policy models are conceptually similar but architecturally different — and some Okta policy capabilities have no clean Entra equivalent.

## Policy Types

Okta has distinct policy types, each governing a different aspect of the authentication experience:

| Policy Type | API Path | Description |
|---|---|---|
| **Okta Sign-On Policy** | `/api/v1/policies?type=OKTA_SIGN_ON` | Global sign-in behavior — network zones, session lifetime, MFA prompts. Legacy (pre-OIE). |
| **App Sign-On Policy** | `/api/v1/policies?type=ACCESS_POLICY` | Per-app authentication requirements (OIE). Replaces app-level sign-on settings. |
| **MFA Enrollment Policy** | `/api/v1/policies?type=MFA_ENROLL` | Which authenticators users must or can enroll, and when enrollment is prompted. |
| **Password Policy** | `/api/v1/policies?type=PASSWORD` | Password complexity, age, lockout settings. |
| **Authenticator Enrollment Policy** | `/api/v1/policies?type=AUTHENTICATOR_ENROLLMENT` | OIE-specific: controls authenticator availability per group. |
| **Profile Enrollment Policy** | `/api/v1/policies?type=PROFILE_ENROLLMENT` | Self-service registration and progressive profiling (OIE). |

## Okta Sign-On Policy (Legacy / Classic Engine)

In Classic Engine orgs, the Okta Sign-On Policy contains ordered rules that evaluate on every sign-in. Each rule has conditions and resulting behavior:

```json
{
  "type": "OKTA_SIGN_ON",
  "name": "Default Policy",
  "rules": [
    {
      "name": "Require MFA from untrusted networks",
      "conditions": {
        "network": {
          "connection": "ANYWHERE"
        },
        "authContext": {
          "authType": "ANY"
        }
      },
      "actions": {
        "signon": {
          "access": "ALLOW",
          "requireFactor": true,
          "factorPromptMode": "ALWAYS",
          "session": {
            "usePersistentCookie": false,
            "maxSessionIdleMinutes": 120,
            "maxSessionLifetimeMinutes": 480
          }
        }
      }
    }
  ]
}
```

**Rules are priority-ordered.** The first matching rule wins. Okta evaluates from top to bottom.

## App Sign-On Policy / Access Policy (OIE)

In Okta Identity Engine (OIE) orgs, each app has its own Access Policy with authentication requirements expressed as an assurance level:

```json
{
  "type": "ACCESS_POLICY",
  "name": "Salesforce - High Assurance",
  "rules": [
    {
      "name": "Require phishing-resistant MFA",
      "conditions": {
        "network": { "connection": "ANYWHERE" },
        "risk": { "behaviors": [] }
      },
      "actions": {
        "appSignOn": {
          "access": "ALLOW",
          "verificationMethod": {
            "type": "ASSURANCE",
            "factorMode": "2FA",
            "constraints": [
              {
                "knowledge": {},
                "possession": {
                  "phishingResistant": true
                }
              }
            ]
          }
        }
      }
    }
  ]
}
```

## MFA Enrollment Policy

Controls which authenticators users must enroll and when enrollment is triggered:

```json
{
  "type": "MFA_ENROLL",
  "name": "Required MFA for All Users",
  "conditions": {
    "people": {
      "groups": {
        "include": ["EVERYONE"]
      }
    }
  },
  "settings": {
    "authenticators": [
      { "key": "okta_verify", "enroll": { "self": "REQUIRED" } },
      { "key": "phone_number", "enroll": { "self": "OPTIONAL" } },
      { "key": "security_key", "enroll": { "self": "OPTIONAL" } }
    ]
  }
}
```

## Authenticators

In Okta OIE, authenticators replace the older "factors" model. They are configured in the Okta Admin Console under Security → Authenticators and referenced by `key` in policies.

### Okta Authenticators and Entra Equivalent Methods

| Okta Authenticator | Okta `key` | Strength | Entra Authentication Method | Notes |
|---|---|---|---|---|
| Okta Verify (TOTP) | `okta_verify` | Medium | Microsoft Authenticator (TOTP) or OATH TOTP | Okta Verify enrollments do NOT transfer — users re-enroll in Authenticator |
| Okta Verify Push | `okta_verify` | Medium-High | Microsoft Authenticator Push | Same app, same re-enrollment requirement |
| FIDO2 / WebAuthn | `security_key` | High (phishing-resistant) | FIDO2 security keys | Passkey/FIDO2 credentials are NOT portable across IdPs — users re-register hardware keys |
| SMS / Text | `phone_number` | Low | SMS (text message) | Entra Authentication Methods Policy: SMS sign-in |
| Email | `okta_email` | Low | Email OTP | Entra supports email OTP as an authentication method |
| Voice call | `phone_number` | Low | Voice call | Entra supports voice call |
| Password | `okta_password` | Low | Password | Managed separately via password policy |
| Security question | `security_question` | Low | No equivalent | **No mapping.** Entra does not support security questions as an authentication method. |
| Google Authenticator | `google_otp` | Medium | OATH TOTP (third-party) | Google Authenticator TOTP secrets are NOT portable; users re-enroll |
| Hardware TOTP tokens | `token:hotp` / `token:totp` | Medium | OATH TOTP hardware tokens (requires Entra ID P1/P2) | OATH TOTP seed importable IF you have access to the seed — rare for Okta-provisioned tokens |
| PIV / Smart Card | `smart_card_idp` | High | Certificate-based auth (CBA) | Entra supports CBA; PKI infrastructure must be trusted by Entra |
| On-prem Windows auth | `windows_hello` (via Okta Desktop MFA) | High | Windows Hello for Business | Separate enrollment; not portable |

### Critical Callout: MFA Enrollments Are Not Portable

**No Okta MFA factor enrollment migrates to Entra.** Every authenticator is cryptographically bound to the originating IdP's infrastructure. This includes:
- TOTP secrets (Okta Verify, Google Authenticator, hardware tokens) — the TOTP seed is in Okta's custody
- FIDO2/WebAuthn passkeys — bound to the origin (RP ID = Okta domain)
- Push notification registrations — bound to the Okta Verify push service

**Consequence:** Every user must re-enroll their MFA methods in Entra after migration. This is the single largest operational cost of an Okta → Entra migration. Plan for:
- A pre-migration MFA registration campaign (direct users to enroll in Entra MFA before cutover)
- Conditional Access policy in report-only mode to identify who has NOT yet registered
- A break-glass plan for users who fail MFA registration at first Entra login

## Mapping to Entra Conditional Access

### The Two-Component Model

Okta sign-on policies combine access control and authenticator requirements in a single policy object. Entra splits these across two components:

1. **Conditional Access Policy** — who must authenticate, under what conditions, and what grant controls are required
2. **Authentication Methods Policy** — which authentication methods are enabled/disabled for which user groups

You need BOTH components to fully represent an Okta sign-on policy in Entra.

### Mapping Table

| Okta Policy Concept | Entra Component | Entra Object | Notes |
|---|---|---|---|
| Sign-on policy rule: allow/block | Conditional Access policy grant control | `grantControls.builtInControls: ["block"]` or grant | |
| Require MFA | CA grant control | `grantControls.builtInControls: ["mfa"]` | |
| Require specific authenticator (e.g., phishing-resistant) | CA grant control | `grantControls.authenticationStrength` | Requires Entra ID P2; authentication strength policies |
| Network zone (trusted IP) | CA named location (IP-based) | `conditions.locations` | Must recreate trusted IPs as named locations in Entra |
| Network zone (untrusted) | CA condition: exclude named locations | | |
| Session lifetime (maxSessionLifetimeMinutes) | CA session control: sign-in frequency | `sessionControls.signInFrequency` | |
| Persistent cookie | CA session control: persistent browser | `sessionControls.persistentBrowser` | |
| MFA enrollment policy (required authenticators) | Authentication Methods Policy | Per-method enable/disable per group | |
| App-level sign-on policy (per app) | App-targeted CA policy | `conditions.applications.includeApplications` | Target the specific enterprise app |
| Risk-based policy (Okta ThreatInsight) | CA sign-in risk / user risk | `conditions.signInRiskLevels` / `conditions.userRiskLevels` | Requires Entra ID Protection (P2) |
| Device trust (Okta Device Trust) | CA device compliance | `grantControls.builtInControls: ["compliantDevice"]` | Requires Intune enrollment |
| Group-based policy condition | CA user/group scope | `conditions.users.includeGroups` | |

### What Has No Clean Mapping

**Okta network zones with ASN/DNS matching** — Okta supports zone rules based on AS numbers and reverse DNS patterns. Entra named locations support only IP ranges and country. ASN-based rules must be redesigned.

**Okta behavior detection rules** (anomalous behavior in OIE) — Okta OIE supports policy rules triggered by behavior signals (new device, new city, velocity). Entra has sign-in risk detection (Entra ID Protection, P2 license required) but the signal model is different. Rich Okta behavior-based rules with custom conditions may not have a direct equivalent — they approximate to sign-in risk policies in Entra, but with less granular per-behavior control.

**Multiple authenticator constraints in a single rule** — Okta OIE access policies can require "possession AND knowledge" or "phishing-resistant possession" as a compound constraint in one rule. Entra expresses this via Authentication Strength policies (added in 2023), but the mapping is not always 1:1 for complex constraint chains.

**Okta's "step-up MFA" (re-prompt every N minutes)** — Okta sign-on rules can prompt for MFA again after N minutes. Entra's sign-in frequency control is session-level (reauthenticate every N hours), not step-up per-access. For high-security apps needing re-authentication on every access, Entra sign-in frequency every 1 hour is the closest approximation.

**MFA enrollment grace period** — Okta enrollment policies support a grace period (user can defer enrollment for N days). Entra's MFA registration policy does not have an equivalent grace period — users either must register or are blocked.

**Okta app sign-on policy ordering** (first-match wins) — Okta policy rules are priority-ordered. Entra CA policies are all evaluated; conflicting grant controls use the most restrictive result (block wins over allow). This behavioral difference can cause unexpected blocks at cutover if conflicting policies exist.

## Password Policy Mapping

| Okta Password Policy Field | Entra Equivalent | Notes |
|---|---|---|
| `minLength` | Password Protection: min length | Entra global password policy requires 8+ characters minimum |
| `minLowerCase` / `minUpperCase` | Not configurable in Entra cloud passwords | Entra does not enforce character class requirements for cloud-only users |
| `minNumber` | Not directly configurable | |
| `minSymbol` | Not directly configurable | |
| `excludeUsername` | Entra blocks passwords containing UPN | Partially equivalent |
| `historyCount` | Password Protection: history | Configurable via Entra Password Protection |
| `maxAgeDays` | Password expiration (per-user or policy) | Entra can enforce via user settings; Modern Auth best practice is to disable password expiration |
| `lockoutAttempts` | Smart Lockout threshold | Entra Smart Lockout replaces static lockout — adaptive |
| `lockoutDuration` | Smart Lockout lockout duration | |
| Custom banned passwords | Entra Password Protection custom list | Near-equivalent; Entra also has global banned password list |

**Key difference:** Entra cloud password policies are largely fixed at the tenant level for cloud-only users. Per-user or per-group fine-grained password policies (similar to Okta's group-targeted password policies) require on-premises AD with Fine-Grained Password Policies (FGPP) pushed through Entra Connect, or Microsoft Entra Password Protection for on-prem.

## Fetching Policies via API

```bash
# List all sign-on policies
GET /api/v1/policies?type=OKTA_SIGN_ON

# List OIE access policies
GET /api/v1/policies?type=ACCESS_POLICY

# Get rules for a specific policy
GET /api/v1/policies/{policyId}/rules

# List MFA enrollment policies
GET /api/v1/policies?type=MFA_ENROLL

# List authenticators
GET /api/v1/authenticators
```

## Related Skills

- **[users-and-profiles.md](users-and-profiles.md)** — User attributes used in policy conditions
- **[groups-and-rules.md](groups-and-rules.md)** — Group-based policy scoping
- **[okta-to-entra-migration-map.md](okta-to-entra-migration-map.md)** — Consolidated policy mapping with gotchas
- **`skills/msft-security/entra-id-protection.md`** — Entra Conditional Access and risk-based policies
