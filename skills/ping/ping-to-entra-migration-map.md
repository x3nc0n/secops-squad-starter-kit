---
title: Ping Identity → Entra ID Migration Map
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# Ping Identity → Entra ID Migration Map

## Overview

This is the primary reference artifact for Ping Identity → Microsoft Entra ID migrations. It covers all major Ping products: PingFederate (on-prem SAML/OIDC IdP), PingOne (cloud IdP), PingDirectory (LDAP/SCIM directory), PingAccess (reverse proxy / gateway), and PingID (MFA).

**How to use this document:**
- Start with the product/object type you are working on
- Read the mapping table column-by-column: Ping object → Entra equivalent → quality tier → gotchas
- Check the NameID compatibility matrix (Section 8) before ANY SAML migration work — it is the #1 blocker

**Quality tier legend:**

| Tier | Meaning |
|------|---------|
| ✅ Direct | Values transfer as-is; no transformation required |
| ⚠️ Transform | Values transfer but require format normalization or expression rewrite |
| 🔧 Manual | No scripted migration path; requires per-item human assessment |
| ❌ Blocked | Hard incompatibility; object class cannot migrate; redesign required |

---

## 1. Users and Profiles

### Core Attribute Mapping (PingOne ↔ Entra)

PingOne stores users in a flat profile schema within a Population. PingDirectory SCIM attributes map to the same Entra targets.

| Ping Attribute (PingOne / PingDirectory SCIM) | Entra Property (Graph API) | Mapping Quality | Gotchas |
|---|---|---|---|
| `username` / `userName` | `userPrincipalName` | ✅ Direct | UPN requires `user@domain.tld` format; PingOne username may not be an email |
| `email` / `emails[0].value` | `mail` | ✅ Direct | |
| `name.given` | `givenName` | ✅ Direct | |
| `name.family` | `surname` | ✅ Direct | |
| `name.formatted` / display name | `displayName` | ✅ Direct | |
| `mobilePhone` / `phoneNumbers[type=mobile]` | `mobilePhone` | ⚠️ Transform | PingOne freeform; Entra expects E.164 (+12125551234) |
| `primaryPhone` / `phoneNumbers[type=work]` | `businessPhones[0]` | ⚠️ Transform | Same E.164 format requirement |
| `title` | `jobTitle` | ✅ Direct | |
| `department` | `department` | ✅ Direct | |
| `organization` | `companyName` | ✅ Direct | |
| `employeeNumber` | `employeeId` | ✅ Direct | |
| `manager` | `manager` (object ref) | ⚠️ Transform | Ping stores a string or reference; Entra requires the manager's Entra object ID — two-pass migration required |
| `costCenter` | `costCenter` | ✅ Direct | |
| `streetAddress` | `streetAddress` | ✅ Direct | |
| `locality` / `city` | `city` | ✅ Direct | |
| `region` / `state` | `state` | ✅ Direct | |
| `postalCode` | `postalCode` | ✅ Direct | |
| `country` / `countryCode` | `country` | ⚠️ Transform | PingOne uses ISO 3166-1 alpha-2; Entra accepts code or name — be consistent |
| `preferredLanguage` | `preferredLanguage` | ✅ Direct | Both use IETF BCP 47 |
| `timezone` | No direct equivalent | ❌ Blocked | Use extension attribute if retention required |
| Custom schema attributes | Extension attributes / Directory schema extensions | ⚠️ Transform | Pre-create extension schema in Entra before migrating values |
| `id` (PingOne user UUID) | No equivalent | 🔧 Manual | Store as extension attribute for reconciliation during coexistence |
| Population membership | No direct equivalent | ⚠️ Transform | Map populations to Entra security groups or use CA policy scoping |

### PingDirectory LDAP Attributes → Entra

| LDAP Attribute | Entra Property | Mapping Quality | Gotchas |
|---|---|---|---|
| `uid` | `userPrincipalName` | ⚠️ Transform | UID may not be email format; normalize to UPN |
| `cn` | `displayName` | ✅ Direct | |
| `givenName` | `givenName` | ✅ Direct | |
| `sn` | `surname` | ✅ Direct | |
| `mail` | `mail` | ✅ Direct | |
| `telephoneNumber` | `businessPhones[0]` | ⚠️ Transform | Normalize to E.164 |
| `employeeNumber` | `employeeId` | ✅ Direct | |
| `memberOf` | Group membership (separate API) | 🔧 Manual | Populate via graph group membership calls, not user attribute |
| `inetOrgPerson` custom attrs | Extension attributes | 🔧 Manual | Map per schema review |

### Lifecycle States

| PingOne Status | Entra `accountEnabled` | Migration Action |
|---|---|---|
| `ENABLED` | `true` | Standard migration |
| `DISABLED` | `false` | Create disabled; review intent |
| Not verified (new user) | `false` + `forceChangePasswordNextSignIn: true` | Create; force password change |

---

## 2. Groups

| Ping Group Source | Entra Equivalent | Mapping Quality | Gotchas |
|---|---|---|---|
| PingOne static groups | Security Group (assigned membership) | ✅ Direct | Group names and descriptions transfer; Ping UUIDs do not — maintain a mapping table |
| PingOne population-based segmentation | Security Group (dynamic) or CA condition | ⚠️ Transform | No direct group equivalent; express as dynamic group rule or CA user/group condition |
| PingDirectory LDAP groups (`groupOfUniqueNames`) | Security Group (assigned) | ✅ Direct | Members mapped by objectId after user migration — two-pass |
| PingDirectory dynamic groups (`isMemberOf`) | Security Group (dynamic membership) | ⚠️ Transform | PD dynamic group expressions ≠ Entra rule syntax; translate per-group |
| PingFederate local groups (via LDAP/PD) | Already covered under PingDirectory | — | Source is PD; see above |
| PingAccess application groups | 🔧 Manual | No direct equivalent; map to Entra app roles or Conditional Access app assignments |

---

## 3. SAML SP Connections (PingFederate)

PF SP connections are the most migration-critical objects. Each connection = one Entra Enterprise App (SAML). The NameID configuration is the #1 blocker (see Section 8).

| PingFederate SP Connection Field | Entra Enterprise App Field | Mapping Quality | Gotchas |
|---|---|---|---|
| `entityId` (SP Entity ID) | Identifier (Entity ID) | ✅ Direct | Value must exactly match what SP registered in PF |
| Assertion Consumer Service URL(s) | Reply URL(s) (ACS URL) | ✅ Direct | Entra supports HTTP-POST binding only; HTTP-Redirect ACS must be confirmed supported |
| Default target URL | Sign On URL | ✅ Direct | |
| `nameIdFormat` | NameID format (see Section 8) | ⚠️ Transform / ❌ Blocked | **THE CRITICAL BLOCKER** — see NameID matrix |
| NameID attribute mapping (PD attribute → NameID value) | NameID claim value source | 🔧 Manual | PF maps a directory attribute (e.g. `uid`) to NameID; recreate that mapping in Entra claims |
| Attribute statements | Additional claims (Attributes & Claims) | ⚠️ Transform | PF uses Expression Language / attribute sources; Entra uses fixed attributes or claims transformation rules |
| SAML signing certificate (PF) | New Entra-issued certificate | ❌ Not portable | SP must be updated with Entra's certificate before cutover; no sharing possible |
| PF issuer (`entityId` of PF itself) | `https://sts.windows.net/{tenantId}/` | ❌ Must update SP | SP trusted issuer config must be updated to Entra value at cutover |
| IDP-initiated SSO URL | Entra My Apps / direct link | ⚠️ Transform | IDP-initiated SSO support in Entra is limited; prefer SP-initiated flows |
| SLO endpoint | Varies by Entra config | 🔧 Manual | Test SLO explicitly; Entra SAML SLO support is inconsistent across app types |
| Attribute sources (LDAP/JDBC) | User attributes from Entra directory | 🔧 Manual | PF can source attributes from PD/LDAP; Entra sources from AAD user object — ensure attributes are migrated first |
| Authentication policy contract | CA policy targeting the enterprise app | ⚠️ Transform | PF auth policies map to Entra CA app-targeted policies; complex policies need manual redesign |

---

## 4. OIDC Applications (PingFederate / PingOne)

| Ping OIDC Field | Entra App Registration Field | Mapping Quality | Gotchas |
|---|---|---|---|
| Redirect URIs | Redirect URIs | ✅ Direct | Values transfer |
| Post-logout redirect URIs | Front-channel logout URL | ✅ Direct | |
| Grant types | Grant types in Authentication | ✅ Direct | Add `offline_access` scope for refresh tokens |
| Client ID | Application (client) ID | ❌ New value | Apps hardcoded to Ping Client ID must be updated |
| Client secret | New secrets | ❌ Not portable | Generate new secrets; Ping secrets not exportable |
| Issuer URL (PF: `https://pf.corp.example.com`) | `https://login.microsoftonline.com/{tenantId}/v2.0` | ❌ Must update app | Update OIDC issuer discovery URL in every consuming app |
| Issuer URL (PingOne: `https://auth.pingone.com/{envId}/as`) | `https://login.microsoftonline.com/{tenantId}/v2.0` | ❌ Must update app | Same |
| `sub` claim value | `sub` or `oid` (Entra object ID) | ❌ Value changes | Entra sub/oid differ from Ping sub; apps using sub as stable user key must migrate the mapping |
| `email` claim | `email` (if scope requested) | ✅ Direct | Include `email` in scopes |
| Group claims (display names) | Group claims (GUIDs by default) | ❌ Format changes | Entra emits group object IDs, not display names by default; apps reading group names must update |
| PingID / DaVinci MFA step-up | CA authentication strength | 🔧 Manual | DaVinci flows encoding MFA logic have no automated migration to CA |
| Dynamic client registration | App registration (manual or Graph) | 🔧 Manual | Entra does not support dynamic client registration without pre-approval |

---

## 5. Sign-On Policies (PingOne / PingFederate Auth Policies)

| Ping Policy Concept | Entra Component | Mapping Quality | Gotchas |
|---|---|---|---|
| Sign-on policy: allow | CA policy: grant access | ✅ Direct | |
| Sign-on policy: block | CA policy: block | ✅ Direct | CA block is most-restrictive (wins over any allow) |
| Require MFA (PingID push) | CA grant: Require MFA | ✅ Direct | Users must re-enroll in Entra MFA |
| Phishing-resistant MFA | CA authentication strength (P2) | ✅ Direct | P2 required for authentication strength policies |
| Trusted network (IP range) | CA named location (IP ranges) | ✅ Direct | Recreate all IP ranges as named locations before policy migration |
| Trusted network (country) | CA named location (country-based) | ✅ Direct | |
| Session max lifetime | CA sign-in frequency | ⚠️ Transform | Units differ (PF minutes vs CA hours); normalize |
| Session persistence | CA persistent browser session | ⚠️ Approximate | |
| Population-scoped policy | CA user/group conditions | ⚠️ Transform | Map population to Entra group, then target group in CA |
| DaVinci flow policy | No direct equivalent | ❌ Blocked | DaVinci orchestration flows encode complex business logic; require manual Entra redesign |
| Risk-based policy (PingOne Protect) | CA sign-in risk / user risk (P2) | ⚠️ Approximate | Different risk signal models; test for false positives/negatives |
| Device trust (PingAccess device) | CA compliant device / hybrid join | ⚠️ Transform | Requires Intune enrollment re-assessment |
| Grace period / enrollment deferral | No equivalent | ❌ Blocked | Entra has no enrollment grace period |
| First-match policy evaluation | All-policies evaluated (most-restrictive) | ❌ Behavioral difference | **CA evaluates ALL matching policies and takes most-restrictive result.** Ping is first-match-wins. Audit carefully for unintended blocks. |

---

## 6. MFA / PingID

| Ping MFA Method | Entra Method | Portability | Migration Action |
|---|---|---|---|
| PingID push notification | Microsoft Authenticator push | ❌ Not portable | Users re-enroll in Authenticator |
| PingID TOTP | Microsoft Authenticator TOTP / OATH TOTP | ❌ Not portable | TOTP seeds are PingID-custody; users re-enroll |
| PingID SMS OTP | SMS (Text message sign-in) | ✅ Phone number transfers | Re-verify phone number in Entra |
| PingID voice call | Voice call | ✅ Phone number transfers | |
| PingID email OTP | Email OTP (TAP / FIDO-less) | ✅ Email transfers | |
| PingID biometric (device-bound) | Microsoft Authenticator biometric | ❌ Not portable | Device-bound; users re-register |
| FIDO2 / WebAuthn (if PA-brokered) | FIDO2 security keys | ❌ Not portable | FIDO2 credentials are RP-bound; users re-register hardware keys with Entra RP |
| Smart card / PIV (PF CBA) | Certificate-based authentication | ✅ If PKI trusted | Entra must trust the issuing CA; PKI cert itself is portable |
| Security questions (PD-based) | No equivalent | ❌ Blocked | Security questions do not exist in Entra |

**Blanket rule:** Assume zero MFA enrollments transfer from PingID. Plan a pre-migration re-enrollment campaign targeting all active users. Use Temporary Access Pass (TAP) to onboard users who cannot receive a new push notification immediately.

---

## 7. PingDirectory Attributes — Extended Mapping

| PingDirectory Schema Element | Migration Consideration |
|---|---|
| `objectClass: inetOrgPerson` | Standard LDAP — map core attributes as above |
| `objectClass: organizationalPerson` | Organizational fields (title, ou, etc.) map to Entra standard attributes |
| Custom schema extensions (registered OIDs) | Map to Entra directory schema extensions; pre-create schema before migrating values |
| Password (hashed) | **Not migratable.** Passwords cannot cross identity systems. Use Entra SSPR / TAP for first login. |
| `krbPrincipalName` (Kerberos) | No direct Entra equivalent. If Kerberos auth is required, use Entra Kerberos (hybrid join) not a directory attribute |
| `shadowLastChange` / `pwdChangedTime` | No Entra equivalent; use `passwordPolicies` and `lastPasswordChangeDateTime` on Entra user for tracking |
| Group membership (`memberOf`) | Populate via Graph group membership API after users exist in Entra |
| `entryUUID` (PD unique ID) | Store as extension attribute for reconciliation; do not use as Entra ID |

---

## 8. NameID Format Compatibility Matrix

> **This is the #1 migration blocker for all PingFederate SAML SP connections.**
> Assess every SP connection's NameID format before committing to a migration approach.
> Use `assertNameIdPortable()` in gate.js to automate this check.

### Entra-Supported NameID Formats

Entra ID SAML assertions support only these NameID formats:

| NameID Format URI | Entra Support | Notes |
|---|---|---|
| `urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified` | ✅ Supported | Default when no format declared; flexible — use when SP doesn't care about format |
| `urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress` | ✅ Supported | Use UPN or `mail` attribute as the NameID value |
| `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent` | ✅ Supported | Stable opaque identifier; map PF persistent NameID attribute → Entra objectId |

### Hard-Blocked NameID Formats

Entra ID **cannot** emit the following formats. Any SP connection using these is blocked from SAML migration without SP-side redesign:

| NameID Format URI | Entra Support | Blocker Impact |
|---|---|---|
| `urn:oasis:names:tc:SAML:2.0:nameid-format:transient` | ❌ Hard-blocked | Entra does not emit transient NameIDs. SP must accept a stable format instead. |
| `urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos` | ❌ Hard-blocked | Kerberos NameIDs have no Entra equivalent. |
| `urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName` | ❌ Hard-blocked | Certificate subject NameIDs are not emitted by Entra SAML. |
| `urn:oasis:names:tc:SAML:2.0:nameid-format:encrypted` | ❌ Hard-blocked | Entra does not emit encrypted NameIDs (though it can consume them from upstream IdPs). |
| `urn:oasis:names:tc:SAML:1.1:nameid-format:WindowsDomainQualifiedName` | ❌ Hard-blocked | Windows domain accounts are not valid SAML NameID values in Entra. |

### Strategy Per Format

| PF Source NameID Format | Recommended Strategy | `nameid_strategy` Value | Risk |
|---|---|---|---|
| `unspecified` | Map to any stable Entra attribute (UPN, objectId) | `use_email` or `map_to_persistent` | Low |
| `emailAddress` | Use UPN or `mail` as Entra NameID value | `use_email` | Low — verify SP accepts UPN vs email |
| `persistent` | Map PF persistent attribute (e.g. `uid`) to Entra `objectId` | `map_to_persistent` | Medium — NameID value will change; SP must support re-bind |
| `transient` | **Blocked.** SP must be updated to accept `unspecified` or `persistent` | `manual_per_app` | **HIGH — requires SP vendor engagement** |
| `kerberos` | **Blocked.** SP must change its NameID expectation | `manual_per_app` | **HIGH** |
| `X509SubjectName` | **Blocked.** Usually CBA apps — evaluate cert-based auth in Entra instead | `manual_per_app` | **HIGH** |

### NameID Value Continuity Warning

Even for supported formats, the **NameID VALUE** must match what the SP originally received from PingFederate. If PF issued `uid: jdoe` as a persistent NameID and the SP stored that as its user identifier, Entra must emit the same value. If Entra emits `objectId` instead, the SP treats it as a new unknown user — creating duplicate accounts or login failures.

**Action:** For every `persistent` NameID SP connection, document:
1. What PF attribute was the source of the NameID value
2. Whether that value exists on the migrated Entra user (as UPN, employeeId, or extension attribute)
3. Whether the SP can survive a NameID value change (re-bind vs hard-fail)

---

## 9. Continuity — Coexistence and What Breaks at Cutover

### What Breaks Immediately

| Item | Why It Breaks | Mitigation |
|---|---|---|
| SAML SP configurations | SP trusts PF certificate and entity ID; Entra has a different cert and entity ID | Update SP IdP metadata before cutover; validate with pilot group first |
| OIDC app configurations | Hardcoded PingOne/PF issuer URL and client ID | Update app configs before cutover; test in dev environment first |
| PingID MFA push sessions | PingID is bound to Ping's push service infrastructure | Pre-register users in Microsoft Authenticator before cutover |
| FIDO2 passkeys registered with PingOne/PF | RP ID is the Ping domain | Users must re-register with Entra's RP ID after cutover |
| PingAccess reverse-proxy rules | PA rules point to Ping as the IdP; post-cutover, PA must validate Entra tokens or be decommissioned | Either update PA OIDC/SAML integration to Entra, or phase out PA via Entra App Proxy |
| DaVinci flows | DaVinci orchestration is PingOne-specific | Redesign as Entra CA + custom MFA policy; no automated migration path |

### What Can Be Dual-Written During Coexistence

| Object | Dual-Write Possible? | Notes |
|---|---|---|
| User profiles | Yes (via SCIM provisioning from PingOne to Entra) | PingOne can provision users into Entra via SCIM outbound provisioning integration |
| Group membership | Yes (conditional) | If group sync is configured, PingOne groups can flow to Entra |
| Passwords | No | No cross-IdP password sync |
| MFA enrollments | No | No PingID → Entra Authenticator portability |
| SAML certificates | No | Each IdP has its own signing certificate |
| CA / Sign-on policies | No | Policies live in each system separately |
