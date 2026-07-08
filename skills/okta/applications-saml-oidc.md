---
title: Okta Applications — SAML and OIDC
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Applications — SAML and OIDC

## Overview

Okta app integrations are the integrations between Okta as IdP and downstream service providers (SPs). Understanding how Okta models SAML and OIDC apps — and where they map (cleanly or not) to Entra enterprise apps and app registrations — is the hardest part of an Okta → Entra migration. Certificates, claims, ACS URLs, group claims, and sign-on mode differences all generate real-world failures during cutover.

## App Object Structure

Every Okta app integration is a single object regardless of sign-on mode:

```json
{
  "id": "0oa1a2b3c4d5e6f7g8h9",
  "name": "salesforce",
  "label": "Salesforce Production",
  "status": "ACTIVE",
  "signOnMode": "SAML_2_0",
  "settings": {
    "signOn": { ... }
  },
  "_embedded": {
    "appCredentials": { ... }
  }
}
```

**`signOnMode` values relevant to migration:**

| signOnMode | Description |
|---|---|
| `SAML_2_0` | Service provider-initiated SAML 2.0 SSO |
| `OPENID_CONNECT` | OIDC/OAuth 2.0 |
| `BOOKMARK` | Link-only app (no SSO — just a URL in the app catalog) |
| `AUTO_LOGIN` | Okta-initiated SSO via SWA (Secure Web Authentication — form-fill) |
| `BASIC_AUTH` | HTTP Basic auth |
| `SECURE_PASSWORD_STORE` | Saved password / SWA |
| `WS_FEDERATION` | WS-Fed (rare) |

**Migration priority:** Focus on `SAML_2_0` and `OPENID_CONNECT`. SWA (`AUTO_LOGIN`, `SECURE_PASSWORD_STORE`) apps have no equivalent in Entra — they require the SP to implement a proper SSO protocol, or they remain on Okta for federated-ops mode.

## Fetching Apps via API

```bash
# List all ACTIVE apps
GET /api/v1/apps?filter=status eq "ACTIVE"&limit=100

# List SAML apps only
GET /api/v1/apps?filter=status eq "ACTIVE"&q=saml

# Get a specific app
GET /api/v1/apps/{appId}

# Get groups assigned to an app
GET /api/v1/apps/{appId}/groups?limit=200

# Get users directly assigned to an app (not via group)
GET /api/v1/apps/{appId}/users?limit=200
```

## SAML 2.0 App Integration

### Okta SAML Settings Object

The key SAML configuration lives in `settings.signOn`:

```json
{
  "settings": {
    "signOn": {
      "defaultRelayState": "",
      "ssoAcsUrl": "https://acme.salesforce.com/services/oauth2/callback",
      "idpIssuer": "${org.externalKey}",
      "audience": "https://saml.salesforce.com",
      "recipient": "https://acme.salesforce.com/services/oauth2/callback",
      "destination": "https://acme.salesforce.com/services/oauth2/callback",
      "subjectNameIdTemplate": "${user.userName}",
      "subjectNameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
      "responseSigned": true,
      "assertionSigned": true,
      "signatureAlgorithm": "RSA_SHA256",
      "digestAlgorithm": "SHA256",
      "honorForceAuthn": true,
      "authnContextClassRef": "urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport",
      "attributeStatements": [
        {
          "type": "EXPRESSION",
          "name": "email",
          "namespace": "urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified",
          "values": ["${user.email}"]
        },
        {
          "type": "GROUP",
          "name": "groups",
          "namespace": "urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified",
          "filter": { "type": "REGEX", "value": "^salesforce-.*" }
        }
      ]
    }
  }
}
```

### Entra Enterprise App SAML Equivalent

In Entra, a SAML app is represented as an **Enterprise Application** with a service principal. Key configuration surfaces:

| Okta SAML Field | Entra Equivalent | Notes |
|---|---|---|
| `ssoAcsUrl` | Reply URL (ACS URL) | Set in Enterprise App → Single sign-on → Basic SAML Configuration |
| `audience` | Identifier (Entity ID) | Set in Enterprise App → Single sign-on → Basic SAML Configuration |
| `destination` | Sign on URL (SP-initiated) | Optional; used for SP-initiated flows |
| `defaultRelayState` | Relay State | Set in Entra SSO configuration if needed |
| `subjectNameIdTemplate` | User attribute → NameID claim | Configure in Attributes & Claims |
| `subjectNameIdFormat` | NameID format | Persistent, email address, unspecified, etc. |
| `attributeStatements` | Additional claims | Each attribute maps to a claim in Attributes & Claims |
| `signatureAlgorithm` | SHA-256 is the Entra default | Verify SP requirements — some legacy SPs still require SHA-1 |
| Signing certificate | SAML Signing Certificate | Download from Entra and upload to SP; do NOT reuse Okta's certificate |

### SAML Migration Gotchas

**1. Signing certificates are NOT portable.**
Okta and Entra each generate their own signing certificates. The SP (Salesforce, ServiceNow, etc.) must be updated with the new Entra IdP certificate. This is a hard cutover step. If the SP is configured to reject unknown certificates, there is no graceful path — it's a coordinated switchover.

**2. IdP Entity ID changes.**
In Okta, the IdP Entity ID is typically `http://www.okta.com/{externalKey}`. In Entra, it is `https://sts.windows.net/{tenantId}/`. The SP's trusted IdP configuration MUST be updated to match. Missing this causes immediate SSO failure with a cryptic "Invalid issuer" error from the SP.

**3. ACS URL differences.**
Some SPs register multiple ACS URLs in Okta (e.g., one for HTTP-POST, one for HTTP-Redirect). Entra supports HTTP-POST only for SAML responses. If the SP requires HTTP-Redirect binding, test carefully — some apps will silently fall back, others will break.

**4. NameID value and format.**
Okta commonly uses `${user.userName}` (login) or `${user.email}` as NameID. Entra's default NameID claim is `user.userprincipalname`. If the SP stores the NameID as a persistent user key (common in Salesforce, WorkDay), you MUST match the value exactly. A mismatch here creates a new user in the SP instead of matching the existing one — this can produce duplicate accounts or orphaned SSO sessions.

**5. Attribute statement claim names are case-sensitive.**
A claim named `Email` in Okta is not the same as `email` in Entra if the SP is case-sensitive. Audit each attribute statement name against what the SP actually expects. Use a SAML tracer (browser extension) to capture assertions from both Okta and Entra during testing.

**6. Group claims and group filters.**
Okta supports regex-filtered group claims (`"filter": { "type": "REGEX", "value": "^salesforce-.*" }`). In Entra, group claims can include all groups, security groups only, or groups matching a specific prefix filter. Entra does NOT support regex filtering on group names in SAML group claims — the prefix filter is the closest approximation. For complex filtering, use app roles instead of group claims.

**7. Single Logout (SLO).**
Okta supports SAML SLO (Single Logout) broadly. Entra supports SLO but its implementation varies by app. Test SLO explicitly — some SPs expect the IdP to initiate SLO on sign-out, and missing this means stale SP sessions persist after Okta logout.

## OIDC/OAuth 2.0 App Integration

### Okta OIDC Settings Object

```json
{
  "signOnMode": "OPENID_CONNECT",
  "settings": {
    "oauthClient": {
      "client_uri": "https://app.acme.com",
      "logo_uri": "https://app.acme.com/logo.png",
      "redirect_uris": [
        "https://app.acme.com/callback",
        "https://app.acme.com/silent-callback"
      ],
      "post_logout_redirect_uris": ["https://app.acme.com/logout"],
      "response_types": ["code"],
      "grant_types": ["authorization_code", "refresh_token"],
      "token_endpoint_auth_method": "client_secret_basic",
      "initiate_login_uri": "https://app.acme.com/login",
      "consent_method": "TRUSTED"
    }
  }
}
```

### Entra App Registration Equivalent

OIDC apps map to Entra **App Registrations** (not just Enterprise Apps — you need both the registration and its service principal):

| Okta OIDC Field | Entra Equivalent | Notes |
|---|---|---|
| `redirect_uris` | Redirect URIs | Set in App Registration → Authentication → Redirect URIs |
| `post_logout_redirect_uris` | Front-channel logout URL | App Registration → Authentication → Front-channel logout URL |
| `grant_types` | Grant types in App Registration | Implicit, authorization code, device code — map each explicitly |
| `response_types` | Configured with grant types | `code` → authorization code; `id_token` → implicit |
| `token_endpoint_auth_method` | Client authentication | `client_secret_basic` → client secret; `private_key_jwt` → certificate |
| Client ID | Application (client) ID | New value assigned by Entra — the app must be updated |
| Client Secret | Client secrets | Must regenerate — Okta client secrets are not portable |
| Issuer URL | `https://login.microsoftonline.com/{tenantId}/v2.0` | Apps hardcoded to the Okta issuer URL must be updated |
| `consent_method: TRUSTED` | Enterprise app admin consent | Entra admin consent replaces Okta's trusted consent model |

### OIDC Migration Gotchas

**1. Client IDs change.**
Okta issues a new Client ID for each app. Entra issues a new Application (client) ID. Any application or service hardcoded to the Okta Client ID must be updated. This is often the highest-effort step in OIDC migrations.

**2. Issuer URL is hardcoded in many apps.**
OIDC libraries often discover endpoints from the issuer URL. The Okta issuer (`https://acme.okta.com/oauth2/default`) must be replaced with the Entra issuer (`https://login.microsoftonline.com/{tenantId}/v2.0`). Watch for this in `appsettings.json`, `.env` files, and config maps.

**3. Token claim structure differs.**
Okta access tokens and ID tokens have different claim names than Entra tokens:

| Claim | Okta | Entra |
|---|---|---|
| User identifier | `sub` (Okta user ID) | `sub` (Entra object ID) or `oid` |
| Email | `email` (if in scope) | `email` (if in scope) or `upn` |
| Groups | Custom claim if configured | `groups` (GUIDs) or app roles |
| Tenant | Not present | `tid` |
| Name | `name` | `name` |

Applications that parse JWT claims by name will break if the claim name or value format changes. Audit claim usage in each app before migration.

**4. Group claims are GUIDs in Entra.**
When Entra emits group claims in OIDC tokens, it emits the group's object ID (GUID), not the display name. Okta emits display names. Applications that read group names from tokens must be updated to handle GUIDs.

**5. `offline_access` scope is required for refresh tokens.**
Okta handles refresh token issuance through its own grant configuration. In Entra, the app must explicitly request the `offline_access` scope to receive a refresh token. Missing this causes apps to expire sessions without re-prompting.

**6. Consent model differences.**
Okta's `TRUSTED` consent bypasses user consent. In Entra, this is accomplished via admin consent grant. For multi-tenant apps, admin consent must be granted per tenant. Plan this ahead of cutover.

## App Assignment Migration

Both users and groups can be assigned to apps in Okta. For migration, the recommended approach:

1. **Enumerate direct user assignments** — these typically indicate exceptions (someone gets access outside the normal group path). In Entra, prefer group-based assignment over direct user assignment for maintainability.
2. **Enumerate group assignments** — these become the primary Entra app assignment model.
3. **Check for app-level profile attribute overrides** — Okta supports per-user/per-group profile attribute values within an app assignment (`profile` on the assignment object). Entra app roles partially address this but are not a full equivalent.

```bash
# Get all group assignments for an app
GET /api/v1/apps/{appId}/groups?limit=200

# Get per-group profile overrides
GET /api/v1/apps/{appId}/groups/{groupId}
# Returns: { "id": "...", "priority": 0, "profile": { "salesforceRole": "Standard User" } }
```

**App roles in Entra** are the closest analog to Okta's app assignment profiles. If the Okta app uses profile overrides to assign roles within the SP (e.g., different Salesforce profiles for different groups), recreate these as Entra App Roles in the App Registration and assign them via group assignment.

## SWA (Secure Web Authentication) Apps

**No migration path.** SWA apps use form-fill automation — Okta injects credentials into login forms. Entra has no equivalent. Options:
- Work with the SP vendor to implement SAML or OIDC SSO (preferred)
- Retain the app in Okta for federated-ops mode post-migration if full IdP replacement is not feasible
- Accept that some SWA apps will require end-user password management after Okta retirement

## Related Skills

- **[users-and-profiles.md](users-and-profiles.md)** — User identity in app assignments
- **[groups-and-rules.md](groups-and-rules.md)** — Group-based app access control
- **[policies-and-authenticators.md](policies-and-authenticators.md)** — App authentication policies
- **[okta-to-entra-migration-map.md](okta-to-entra-migration-map.md)** — Consolidated mapping with gotchas
- **`skills/msft-security/entra-id-protection.md`** — Entra Conditional Access for apps
