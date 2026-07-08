---
title: Okta → Entra ID Migration Map
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta → Entra ID Migration Map

## Overview

This is the primary reference artifact for Okta → Microsoft Entra ID migrations. It consolidates side-by-side mappings for every major object type, calls out where no clean mapping exists, and covers coexistence and continuity concerns during the transition period.

**How to use this document:**
- Start with the object type you are working on (users, groups, apps, policies, MFA)
- Read the mapping table column-by-column: Okta object/attribute → Entra equivalent → gotchas/no-map
- Check the Continuity section before planning cutover sequencing

---

## 1. Users and Profiles

### Core Profile Attributes

| Okta Attribute | Entra Property (Graph API) | Mapping Quality | Gotchas |
|---|---|---|---|
| `profile.login` | `userPrincipalName` | ✅ Clean | Login may not be an email address; UPN requires `user@domain.tld` format |
| `profile.email` | `mail` | ✅ Clean | |
| `profile.firstName` | `givenName` | ✅ Clean | |
| `profile.lastName` | `surname` | ✅ Clean | |
| `profile.displayName` | `displayName` | ✅ Clean | |
| `profile.mobilePhone` | `mobilePhone` | ⚠️ Normalize | Okta stores freeform; Entra expects E.164 (+12125551234) |
| `profile.primaryPhone` | `businessPhones[0]` | ⚠️ Normalize | Same format issue |
| `profile.secondEmail` | `otherMails[0]` | ✅ Clean | |
| `profile.title` | `jobTitle` | ✅ Clean | |
| `profile.department` | `department` | ✅ Clean | |
| `profile.organization` | `companyName` | ✅ Clean | |
| `profile.employeeNumber` | `employeeId` | ✅ Clean | |
| `profile.manager` | `manager` (object reference) | ⚠️ Requires lookup | Okta stores a string; Entra requires the manager's Entra object ID — requires a two-pass migration |
| `profile.costCenter` | `costCenter` | ✅ Clean | |
| `profile.streetAddress` | `streetAddress` | ✅ Clean | |
| `profile.city` | `city` | ✅ Clean | |
| `profile.state` | `state` | ✅ Clean | |
| `profile.zipCode` | `postalCode` | ✅ Clean | |
| `profile.countryCode` | `country` | ⚠️ Normalize | Okta uses ISO 3166-1 alpha-2; Entra accepts name or code — be consistent |
| `profile.userType` | `userType` | ✅ Clean | |
| `profile.locale` | `preferredLanguage` | ✅ Clean | IETF BCP 47 in both |
| `profile.timezone` | No equivalent | ❌ No map | IANA timezone not stored on Entra user object; use extension attribute if required |
| `profile.honorificPrefix` | No equivalent | ❌ No map | Store in extension attribute if required |
| `profile.honorificSuffix` | No equivalent | ❌ No map | Store in extension attribute if required |
| Custom attributes | Extension attributes / Schema extensions | ⚠️ Requires schema design | Must pre-create extension schema in Entra before migrating values |
| `id` (Okta user ID) | No equivalent | ❌ No map | Store Okta ID as an extension attribute for reconciliation during coexistence |

### Lifecycle States

| Okta Status | Entra Representation | `accountEnabled` | Migration Action |
|---|---|---|---|
| `ACTIVE` | Enabled user | `true` | Standard migration |
| `STAGED` | Disabled user | `false` | Create disabled; review for activation |
| `PROVISIONED` | Disabled or enabled (intent-dependent) | `false`/`true` | Treat as pending — force password change at first login |
| `SUSPENDED` | Disabled user | `false` | Create disabled |
| `DEPROVISIONED` | Deleted or disabled | `false` / not created | Generally do not migrate; create disabled for audit retention if required |
| `RECOVERY` | Enabled, force password change | `true` + `forceChangePasswordNextSignIn: true` | |
| `PASSWORD_EXPIRED` | Enabled, force password change | `true` + `forceChangePasswordNextSignIn: true` | |
| `LOCKED_OUT` | Disabled user | `false` | Create disabled; investigate lockout cause |

---

## 2. Groups

| Okta Group Type | Entra Equivalent | Mapping Quality | Gotchas |
|---|---|---|---|
| `OKTA_GROUP` (static membership) | Security Group (assigned membership) | ✅ Clean | Group names, descriptions transfer; Okta group IDs do not — maintain a mapping table |
| `OKTA_GROUP` (dynamic rule) | Security Group (dynamic membership) | ⚠️ Rule translation required | Okta expression language ≠ Entra rule syntax; regex rules cannot be directly translated |
| `APP_GROUP` (from on-prem AD) | Already exists in Entra via Entra Connect | ✅ No action if synced | Verify sync status; do not double-create |
| `APP_GROUP` (from HR system) | Recreate as OKTA_GROUP equivalent OR drive from HR source into Entra | ⚠️ Source-dependent | If HR system supports Entra provisioning, re-point the HR integration |
| `BUILT_IN` ("Everyone") | No direct equivalent | ❌ No map | Express as CA policy `includeUsers: "All"` or dynamic group rule `(user.objectId -ne "")` (not recommended as a group) |

### Group Rule Translation

| Okta Operator | Entra Dynamic Rule Operator | Notes |
|---|---|---|
| `== "value"` | `-eq "value"` | ✅ Direct |
| `!= "value"` | `-ne "value"` | ✅ Direct |
| `AND` | `-and` | ✅ Direct |
| `OR` | `-or` | ✅ Direct |
| `NOT` | `-not` | ✅ Direct |
| `=~ "regex"` | No equivalent | ❌ No map | Approximate with `-contains`, `-startsWith`, `-endsWith`; complex regex must be redesigned |
| `String.startsWith()` | `-startsWith` | ⚠️ Approximate | |
| `String.contains()` | `-contains` | ⚠️ Approximate | |
| `Arrays.contains()` | Limited support | ⚠️ Partial | Test per attribute |

---

## 3. Applications (SAML)

| Okta SAML Field | Entra Enterprise App Field | Mapping Quality | Gotchas |
|---|---|---|---|
| `ssoAcsUrl` | Reply URL (ACS URL) | ✅ Clean (value transfers) | Multiple ACS URLs: Entra supports HTTP-POST only |
| `audience` | Identifier (Entity ID) | ✅ Clean (value transfers) | SP must update its trusted IdP Entity ID — Okta and Entra IDs differ |
| `destination` / `recipient` | Sign on URL | ✅ Clean | |
| `defaultRelayState` | Relay State | ✅ Clean | |
| `subjectNameIdTemplate` | NameID claim value | ⚠️ Review required | Value must exactly match what SP stored from Okta; mismatch creates duplicate SP accounts |
| `subjectNameIdFormat` | NameID format | ✅ Clean (set explicitly) | |
| Attribute statements (expression) | Additional claims in Attributes & Claims | ⚠️ Syntax differs | Okta uses EL expressions; Entra uses fixed attributes or claims transformation |
| Attribute statements (group filter, regex) | Group claims (prefix filter only) | ❌ Partial | Entra does NOT support regex group name filtering; use app roles for precise control |
| Signing certificate | New certificate (NOT portable) | ❌ Rotate required | SP must be updated with Entra certificate before cutover |
| `idpIssuer` (Okta issuer) | `https://sts.windows.net/{tenantId}/` | ❌ Must update SP | SP trusted issuer config must change |
| SLO endpoint | Varies by Entra version | ⚠️ Test explicitly | SLO support varies; test before asserting parity |

---

## 4. Applications (OIDC)

| Okta OIDC Field | Entra App Registration Field | Mapping Quality | Gotchas |
|---|---|---|---|
| `redirect_uris` | Redirect URIs | ✅ Clean (values transfer) | |
| `post_logout_redirect_uris` | Front-channel logout URL | ✅ Clean | |
| `grant_types` | Grant types in Authentication | ✅ Clean | Add `offline_access` scope for refresh tokens |
| Client ID | Application (client) ID | ❌ New value | Apps hardcoded to Okta Client ID must be updated |
| Client Secret | New secrets | ❌ Not portable | Generate new secrets; Okta secrets not exportable |
| Issuer URL | `https://login.microsoftonline.com/{tenantId}/v2.0` | ❌ Must update app | Update OIDC issuer discovery URL in every app |
| `sub` claim value | `sub` or `oid` (Entra object ID) | ❌ Value changes | Entra `sub` and `oid` differ from Okta `sub`; apps using `sub` as a stable user key must migrate the mapping |
| `email` claim | `email` (if scope requested) | ✅ Clean | Include `email` in scopes |
| Group claims (display name) | Group claims (GUIDs) | ❌ Format changes | Entra emits group object IDs, not display names; apps reading group names from tokens must update |
| `consent_method: TRUSTED` | Admin consent grant | ⚠️ Requires admin action | Grant admin consent per tenant before users attempt login |
| Refresh tokens | `offline_access` scope required | ⚠️ Explicit scope needed | Must be requested; not implicit |

---

## 5. Policies and Conditional Access

| Okta Policy Concept | Entra Component | Mapping Quality | Gotchas |
|---|---|---|---|
| Sign-on policy rule: allow | CA policy: grant access | ✅ Clean | |
| Sign-on policy rule: block | CA policy: block | ✅ Clean | Entra block wins over all other policies (most-restrictive evaluation) |
| Require MFA | CA grant: Require MFA | ✅ Clean | |
| Require phishing-resistant MFA | CA authentication strength | ✅ Clean (P2 required) | |
| Trusted network zone (IP) | CA named location (IP ranges) | ✅ Clean (must recreate) | Recreate all trusted IP ranges as named locations before policy migration |
| Trusted network zone (ASN/DNS) | No equivalent | ❌ No map | Must redesign using IP ranges or country location |
| Session max lifetime (minutes) | CA sign-in frequency | ⚠️ Different unit | Okta in minutes; CA in hours — normalize |
| Session persistence | CA persistent browser session | ✅ Approximate | |
| App sign-on policy (per app) | App-targeted CA policy | ✅ Clean | Target specific enterprise app in CA conditions |
| Behavior detection (new device, city) | Entra sign-in risk (P2) | ⚠️ Approximate | Entra risk is ML-based, not rule-based; per-behavior triggers not available |
| MFA enrollment policy | Authentication Methods Policy | ✅ Clean (method-level) | |
| Grace period for enrollment | No equivalent | ❌ No map | Entra has no enrollment deferral grace period |
| Policy priority order (first-match) | All policies evaluated (most restrictive) | ❌ Behavioral difference | Conflicting Entra CA policies use most-restrictive result; audit for unintended blocks |
| Group-based policy targeting | CA user/group conditions | ✅ Clean | |
| Risk-based policy (ThreatInsight) | CA sign-in risk / user risk (P2) | ⚠️ Approximate | Different risk signal model; test for false positive/negative differences |
| Device trust (Okta Device Trust) | CA compliant device / hybrid join | ✅ Approximate | Requires Intune enrollment; no certificate-based device trust equivalent |

---

## 6. Authenticators / MFA Methods

| Okta Authenticator | Entra Method | Portability | Migration Action |
|---|---|---|---|
| Okta Verify TOTP | Microsoft Authenticator (TOTP) or OATH TOTP | ❌ Not portable | Users re-enroll |
| Okta Verify Push | Microsoft Authenticator Push | ❌ Not portable | Users re-enroll |
| FIDO2 / WebAuthn | FIDO2 security keys | ❌ Not portable | FIDO2 credentials are RP-bound; users re-register hardware keys |
| SMS OTP | SMS | ✅ Phone number transfers | Re-verify phone number in Entra |
| Voice call | Voice call | ✅ Phone number transfers | |
| Email OTP | Email OTP | ✅ Email address transfers | |
| Google Authenticator (TOTP) | OATH TOTP | ❌ TOTP secret not portable | Users re-enroll; seed is Okta-custody |
| Hardware TOTP tokens | OATH TOTP hardware tokens (P1/P2) | ⚠️ Seed needed | If vendor-provided seed export available, import to Entra; rare |
| Smart card / PIV | Certificate-based authentication (CBA) | ✅ If PKI trusted | Entra must trust the issuing CA |
| Security question | No equivalent | ❌ No map | Security questions do not exist in Entra |

**Blanket rule:** Assume zero MFA enrollments transfer. Plan a pre-migration user registration campaign.

---

## 7. Continuity — Coexistence, Dual-Write, and What Breaks

### What Breaks Immediately at Cutover

These items break the moment Okta is no longer the IdP for a given app or user — there is no grace period:

| Item | Why It Breaks | Mitigation |
|---|---|---|
| SAML app SP configurations | SP still trusts Okta's certificate and entity ID | Update SP IdP metadata before cutover; validate with pilot group |
| OIDC apps | Hardcoded issuer URL, client ID, or client secret | Update app configs before cutover; test in dev first |
| Okta Verify MFA push sessions | Okta Verify is bound to Okta's push service | Pre-register users in Authenticator; enforce with report-only CA |
| FIDO2 passkeys registered with Okta | RP ID is the Okta domain | Users must re-register with new Entra RP ID |
| SWA apps | No equivalent in Entra | Keep in Okta or migrate SP to SAML/OIDC first |

### What Can Be Dual-Written During Coexistence

If Okta and Entra must coexist during a phased migration:

| Object | Dual-Write Possible? | Notes |
|---|---|---|
| User profiles | Yes (via SCIM or Okta → Entra provisioning) | Okta can provision users into Entra via the Okta Microsoft Azure AD integration (app in Okta catalog) |
| Group membership | Yes (group sync via Okta → Entra provisioning) | OKTA_GROUP groups can be synced as Entra security groups during coexistence |
| App assignments | Partial | Group-based assignments can follow group sync; per-user direct assignments require explicit mapping |
| Passwords | No | Passwords cannot be synced; use SSPR at first Entra login |
| MFA enrollments | No | No cross-IdP MFA portability |
| SAML certificates | No | Each IdP has its own certificate; no shared signing |
| Conditional Access policies | No | Policies live in Entra; Okta has its own sign-on policies — no sync |

### Cutover Sequencing Recommendation

1. **Inventory phase:** Export all users (by status), groups (with rules), apps (SAML + OIDC + SWA list), policies, and authenticator enrollments via Okta API
2. **Schema prep:** Create Entra extension attributes for Okta-specific fields (Okta user ID, timezone, etc.)
3. **Group recreation:** Recreate OKTA_GROUP groups in Entra; migrate static membership; translate dynamic rules (with manual review for regex)
4. **App prep:** For each SAML app: create Entra enterprise app, configure ACS/Entity ID/claims, obtain new signing certificate metadata, coordinate SP update. For each OIDC app: create app registration, update app config in dev environment
5. **User provisioning:** Enable Okta → Entra user sync (Okta Microsoft Azure AD integration) for ACTIVE users; disabled users after, deprovisioned users last (as audit-only disabled objects)
6. **MFA registration campaign:** Run Entra MFA registration campaign with CA policy (report-only first); give users 2–4 weeks to register before enforcement
7. **Pilot cutover:** Move a test group to Entra auth for each app; validate SSO, group claims, MFA flow, SLO
8. **Production cutover by app:** App-by-app SP updates to point to Entra; verify SAML traces for each before removing Okta fallback
9. **Okta decommission:** After all apps and all users are confirmed on Entra, disable Okta SCIM sync, then retire Okta org

### What Cannot Be Migrated Automatically

These require human review and decision per instance:

- **SWA apps** — No Entra equivalent; requires SP-side SAML/OIDC implementation or permanent Okta coexistence
- **Okta Workflow automations** — Okta Workflows (no-code automation) have no direct Entra equivalent; evaluate Logic Apps or Power Automate as replacements
- **Okta API Access Management (custom authorization servers)** — Okta's custom OAuth 2.0 authorization servers are not replaceable with Entra alone; evaluate Azure API Management or Entra External Identities Custom Auth Extensions
- **Complex behavior-based policy rules** — Cannot be fully replicated in Entra CA; requires risk policy redesign
- **Security question enrollments** — Data can be exported (if enabled) but cannot be imported into Entra; no target exists
- **Inbound federation from external IdPs into Okta** — If Okta federates external identity sources (social, other enterprise IdPs), these federation relationships must be independently recreated in Entra External Identities or B2B settings

---

## Appendix: Attribute Mapping Quick Reference

For the migration tool's field mapping configuration:

```yaml
# Okta → Entra attribute map (for provisioning / migration tooling)
user_attribute_map:
  - okta: "profile.login"
    entra: "userPrincipalName"
  - okta: "profile.email"
    entra: "mail"
  - okta: "profile.firstName"
    entra: "givenName"
  - okta: "profile.lastName"
    entra: "surname"
  - okta: "profile.displayName"
    entra: "displayName"
  - okta: "profile.title"
    entra: "jobTitle"
  - okta: "profile.department"
    entra: "department"
  - okta: "profile.organization"
    entra: "companyName"
  - okta: "profile.employeeNumber"
    entra: "employeeId"
  - okta: "profile.mobilePhone"
    entra: "mobilePhone"
    transform: "e164"  # Normalize to E.164 format
  - okta: "profile.city"
    entra: "city"
  - okta: "profile.state"
    entra: "state"
  - okta: "profile.zipCode"
    entra: "postalCode"
  - okta: "profile.countryCode"
    entra: "country"
  - okta: "id"
    entra: "extension_acme_oktaUserId"  # Extension attribute — create schema first
  - okta: "status"
    entra: "extension_acme_oktaStatus"  # Preserve original status for audit
    # accountEnabled logic: ACTIVE/PROVISIONED → true; others → false
```

## Related Skills

- **[users-and-profiles.md](users-and-profiles.md)** — Profile attribute detail and lifecycle states
- **[groups-and-rules.md](groups-and-rules.md)** — Group type detail and rule translation
- **[applications-saml-oidc.md](applications-saml-oidc.md)** — App integration detail and gotchas
- **[policies-and-authenticators.md](policies-and-authenticators.md)** — Policy and MFA detail
- **`skills/msft-security/entra-id-protection.md`** — Entra Conditional Access target configuration
- **`skills/msft-security/microsoft-graph-security.md`** — Graph API for Entra user/group/policy automation
