---
title: PingOne Cloud — Identity Objects and Migration Read Paths
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# PingOne Cloud — Identity Objects and Migration Read Paths

## Overview

PingOne is Ping Identity's cloud IAM platform. It serves workforce and customer identity use cases. For migration planning, PingOne is significantly easier to work with than the on-premises PingFederate/PingDirectory stack — the REST API is well-documented, the object model is relatively clean, and authentication is straightforward.

This document covers the PingOne object model and the API read paths for migration discovery. Auth model, base URLs, and pagination are in `core-api-overview.md`.

**Prerequisites for all examples:**
- You have a valid Bearer token from a Worker Application (see `core-api-overview.md`)
- You know the customer's `{environmentId}` (UUID, found in PingOne Admin Console → Environments → Environment Details)
- Your base URL matches the customer's region (NA: `api.pingone.com`, EU: `api.eu.pingone.com`, etc.)

Examples use the North America region throughout. Substitute your region as needed.

---

## Environments

The environment is the top-level container for all identity objects. A single PingOne organization may have multiple environments (Production, Staging, Dev). For migration, inventory all environments — do not assume there is only one.

```bash
# List all environments in the organization
GET https://api.pingone.com/v1/environments
Authorization: Bearer {access_token}
```

Response excerpt:
```json
{
  "_embedded": {
    "environments": [
      {
        "id": "a1b2c3d4-...",
        "name": "Production",
        "description": "Production environment",
        "type": "PRODUCTION",
        "region": "NA",
        "organization": { "id": "org-uuid" }
      },
      {
        "id": "b2c3d4e5-...",
        "name": "UAT",
        "type": "SANDBOX",
        "region": "NA"
      }
    ]
  },
  "count": 2
}
```

Environment types:
- `PRODUCTION` — live environment; treat all read operations carefully
- `SANDBOX` — non-production; safe for testing migration tooling

**Migration note:** Migrate from `PRODUCTION` only. Do not accidentally target a Sandbox environment for discovery.

---

## Populations

Populations are the primary user segmentation model in PingOne. Every user belongs to exactly one population. Applications and policies can be scoped to specific populations.

```bash
# List all populations in an environment
GET https://api.pingone.com/v1/environments/{environmentId}/populations
Authorization: Bearer {access_token}
```

Response:
```json
{
  "_embedded": {
    "populations": [
      {
        "id": "pop-uuid-1",
        "name": "Employees",
        "description": "Internal workforce users",
        "userCount": 4823,
        "default": true
      },
      {
        "id": "pop-uuid-2",
        "name": "Contractors",
        "description": "External contractor users",
        "userCount": 312,
        "default": false
      }
    ]
  }
}
```

**Migration note:** PingOne populations have no native equivalent in Microsoft Entra ID. Options for representing populations post-migration:
- **Administrative Units** — Entra administrative units provide management scoping but are not a full population analog
- **Dynamic Groups** — create an Entra dynamic group per population using a user attribute (e.g., `employeeType`, a custom extension attribute sourced from the PingOne population name)
- **Accept the flattening** — for many organizations, the population segmentation was Ping-specific and does not need to be replicated in Entra

---

## Users

### List Users (All or by Population)

```bash
# All users in an environment (paginated)
GET https://api.pingone.com/v1/environments/{environmentId}/users?limit=100
Authorization: Bearer {access_token}

# Users in a specific population
GET https://api.pingone.com/v1/environments/{environmentId}/users?filter=population.id eq "{populationId}"&limit=100

# Search by attribute
GET https://api.pingone.com/v1/environments/{environmentId}/users?filter=username eq "jsmith@acme.com"
```

Follow `_links.next.href` for subsequent pages.

### User Object Structure

```json
{
  "id": "user-uuid",
  "username": "jane.smith@acme.com",
  "email": "jane.smith@acme.com",
  "name": {
    "given": "Jane",
    "family": "Smith",
    "formatted": "Jane Smith"
  },
  "title": "Senior Engineer",
  "department": "Engineering",
  "employeeId": "EMP-1042",
  "mobilePhone": "+15558675309",
  "enabled": true,
  "accountStatus": {
    "canAuthenticate": true,
    "locked": { "status": false }
  },
  "population": { "id": "pop-uuid-1" },
  "lifecycle": {
    "status": "ACCOUNT_OK",
    "suppressVerificationCode": false
  },
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2026-06-01T09:00:00.000Z"
}
```

**Key fields for migration:**

| PingOne User Field | Entra (Graph API) Equivalent | Notes |
|---|---|---|
| `username` | `userPrincipalName` | PingOne username may not be an email address; UPN must be `user@domain.tld` |
| `email` | `mail` | Primary SMTP address |
| `name.given` | `givenName` | |
| `name.family` | `surname` | |
| `name.formatted` | `displayName` | |
| `title` | `jobTitle` | |
| `department` | `department` | |
| `employeeId` | `employeeId` | |
| `mobilePhone` | `mobilePhone` | Entra expects E.164 format; normalize if needed |
| `enabled` | `accountEnabled` | `true` / `false` direct mapping |
| `population.id` | No direct equivalent | Use dynamic group or extension attribute |
| `lifecycle.status` | `accountEnabled` + `passwordProfile.forceChangePasswordNextSignIn` | See status table below |

### User Lifecycle Status Values

| PingOne `lifecycle.status` | Meaning | Entra `accountEnabled` | Migration Action |
|---|---|---|---|
| `ACCOUNT_OK` | Active, no issues | `true` | Standard migration |
| `VERIFICATION_CODE_REQUIRED` | Account created; verification pending | `false` | Create disabled; determine if activation needed |
| `PASSWORD_EXPIRED` | Password has expired | `true` | Migrate with `forceChangePasswordNextSignIn: true` |
| `LOCKED` | Account locked (failed attempts) | `false` | Migrate disabled; investigate lockout cause |
| `DISABLED` | Admin-disabled | `false` | Migrate disabled |

**You cannot migrate PingOne passwords to Entra.** Like Okta, PingOne stores passwords as irreversible hashes. Migrated users must reset their password on first Entra login. Plan a forced-reset campaign or Temporary Access Pass (TAP) strategy.

### Get a Specific User (Full Profile with Custom Attributes)

```bash
GET https://api.pingone.com/v1/environments/{environmentId}/users/{userId}
Authorization: Bearer {access_token}
```

PingOne supports custom user schema attributes — fields defined beyond the base set. These appear at the top level of the user object alongside standard attributes. Inventory them:

```bash
# Get the population's user schema to discover custom attributes
GET https://api.pingone.com/v1/environments/{environmentId}/schemas?filter=schemaType eq "USER"
Authorization: Bearer {access_token}
```

Custom PingOne attributes map to Entra directory extension attributes. Build the attribute inventory before writing any Graph API provisioning code.

---

## Groups

PingOne groups are used to organize users for access assignment and policy scoping. They are simpler than Okta groups — there are no dynamic membership rules in the PingOne base platform (dynamic rules exist in PingOne DaVinci flows and advanced policy, but not as native group rules).

```bash
# List all groups
GET https://api.pingone.com/v1/environments/{environmentId}/groups?limit=100
Authorization: Bearer {access_token}

# Get group details
GET https://api.pingone.com/v1/environments/{environmentId}/groups/{groupId}

# Get group members
GET https://api.pingone.com/v1/environments/{environmentId}/groups/{groupId}/users?limit=200
```

Group object:
```json
{
  "id": "group-uuid",
  "name": "Salesforce Users",
  "description": "Users with Salesforce access",
  "externalId": "sf-users",
  "memberCount": 152
}
```

**Migration note:** PingOne groups map cleanly to Entra security groups. The lack of native dynamic membership rules in PingOne makes this one of the easier migration objects — it is essentially a flat list of named groups with membership lists.

---

## Applications (SAML and OIDC)

### List All Applications

```bash
GET https://api.pingone.com/v1/environments/{environmentId}/applications?limit=100
Authorization: Bearer {access_token}
```

### SAML Applications

```bash
# Filter for SAML apps
GET https://api.pingone.com/v1/environments/{environmentId}/applications?filter=protocol eq "SAML"
```

SAML application object (key fields):

```json
{
  "id": "app-uuid",
  "name": "Salesforce Production",
  "enabled": true,
  "protocol": "SAML",
  "type": "WEB_APP",
  "spEntityId": "https://saml.salesforce.com",
  "acsUrls": [
    {
      "index": 0,
      "default": true,
      "binding": "POST",
      "url": "https://acme.salesforce.com/services/oauth2/callback"
    }
  ],
  "assertionDuration": 60,
  "assertionSigned": true,
  "sloBinding": "HTTP_POST",
  "sloEndpoint": "https://acme.salesforce.com/services/auth/sp/saml2/logout",
  "nameIdFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
  "subjectNameIdType": "EMAIL_ADDRESS",
  "subjectNameIdCustomValue": null
}
```

**For migration:** The SAML app migration gotchas from PingFederate apply here too — signing certificates change, IdP entity ID changes (`https://auth.pingone.com/{envId}/saml20/idp/issuer` → Entra's `https://sts.windows.net/{tenantId}/`), and NameID values must be preserved if the SP uses them as persistent keys.

Get attribute mappings for a SAML app:

```bash
GET https://api.pingone.com/v1/environments/{environmentId}/applications/{applicationId}/attributes
Authorization: Bearer {access_token}
```

### OIDC Applications

```bash
# Filter for OIDC apps
GET https://api.pingone.com/v1/environments/{environmentId}/applications?filter=protocol eq "OPENID_CONNECT"
```

OIDC application object (key fields):

```json
{
  "id": "app-uuid",
  "name": "Corporate Portal",
  "protocol": "OPENID_CONNECT",
  "type": "WEB_APP",
  "grantTypes": ["AUTHORIZATION_CODE", "REFRESH_TOKEN"],
  "redirectUris": ["https://portal.acme.com/callback"],
  "postLogoutRedirectUris": ["https://portal.acme.com/logout"],
  "tokenEndpointAuthMethod": "CLIENT_SECRET_BASIC",
  "responseTypes": ["CODE"],
  "scopes": [
    { "name": "openid" },
    { "name": "profile" },
    { "name": "email" }
  ]
}
```

**Migration note:** Like Okta → Entra OIDC migrations, the Client ID changes. Applications hardcoded to the PingOne client ID and issuer URL (`https://auth.pingone.com/{envId}/as`) must be updated. Token claim structure differs between PingOne and Entra (see `skills/okta/applications-saml-oidc.md` for a comparable claims-diff table — the same patterns apply to PingOne OIDC).

### Application Access Policies

PingOne applications are governed by sign-on policies (or DaVinci flows — see below). Retrieve the policy associated with an application:

```bash
GET https://api.pingone.com/v1/environments/{environmentId}/applications/{applicationId}/signOnPolicyAssignments
Authorization: Bearer {access_token}
```

---

## Sign-On Policies

Sign-on policies are PingOne's analogue to Okta sign-on policies. They define authentication requirements for accessing applications.

```bash
# List all sign-on policies
GET https://api.pingone.com/v1/environments/{environmentId}/signOnPolicies
Authorization: Bearer {access_token}

# Get a policy's actions (authentication steps)
GET https://api.pingone.com/v1/environments/{environmentId}/signOnPolicies/{policyId}/actions
```

Policy action object:
```json
{
  "id": "action-uuid",
  "priority": 1,
  "type": "LOGIN",
  "conditions": {
    "ipRange": ["0.0.0.0/0"]
  }
}
```

Common action types:

| PingOne Policy Action | Description | Entra CA Equivalent |
|---|---|---|
| `LOGIN` | Username/password login | Primary authentication (no special policy) |
| `MULTI_FACTOR_AUTHENTICATION` | MFA step-up | Require MFA grant control |
| `IDENTIFIER_FIRST` | Username-first flow | Custom auth strength / Entra Conditional Access |
| `PROGRESSIVE_PROFILING` | Collect extra attributes during login | No equivalent (application-layer) |
| `AGREEMENT` | ToS / consent | No equivalent in CA; application-layer |
| `PINGID_WINLOGIN_PASSWORDLESS_AUTHENTICATION` | PingID Windows Login | FIDO2 / Windows Hello for Business |

**Migration note:** PingOne sign-on policies map to **Entra Conditional Access policies**. The mapping is not 1:1. Priority-based ordering in PingOne (first match wins) vs Entra's most-restrictive evaluation model is the main behavioral difference — same problem as Okta → Entra CA mapping.

---

## DaVinci Flows (Advanced Authentication Orchestration)

DaVinci is PingOne's low-code authentication orchestration engine. If the customer has DaVinci enabled, their sign-on policies are implemented as DaVinci flows — visual flow diagrams that can include custom logic, API calls, risk scoring, etc.

DaVinci flows are significantly more complex to migrate than simple sign-on policies. The DaVinci API is a separate surface:

```bash
# Check if DaVinci is enabled
GET https://api.pingone.com/v1/environments/{environmentId}/capabilities
# Look for "DAVINCI" in the capabilities list

# DaVinci flows are managed via a separate API (davinci.pingone.com)
# See: https://docs.pingidentity.com/davinci/latest/api/
```

**For migration planning:** Inventory which applications use DaVinci flows vs simple sign-on policies. DaVinci flows require the most analysis — they may encode business logic that needs to be expressed as custom authentication policies in Entra. Flag each DaVinci-backed app as requiring a human architecture review before migration.

---

## PingID (MFA)

PingID is the Ping Identity MFA product. It integrates with PingOne cloud environments to provide second-factor authentication. If PingID is in use, users have enrolled authenticators (TOTP, push notifications, SMS, etc.).

### Check PingID Enrollment for a User

```bash
GET https://api.pingone.com/v1/environments/{environmentId}/users/{userId}/mfaEnabled
Authorization: Bearer {access_token}

# Get enrolled devices
GET https://api.pingone.com/v1/environments/{environmentId}/users/{userId}/devices
Authorization: Bearer {access_token}
```

Device response:
```json
{
  "_embedded": {
    "devices": [
      {
        "id": "device-uuid",
        "type": "TOTP",
        "status": "ACTIVE",
        "createdAt": "2024-03-01T09:00:00.000Z",
        "name": "Authenticator App"
      }
    ]
  }
}
```

**⚠️ PingID enrollments CANNOT be migrated to Microsoft Authenticator or any other MFA system.** Authenticator app enrollments are bound to the PingID service — the TOTP seeds and push notification tokens are not exportable. Users must re-enroll their MFA devices in Entra after migration.

**Migration strategy:**
1. Inventory the percentage of users with active PingID enrollments (this is your MFA-enabled population)
2. Design an Entra MFA registration campaign before or immediately after cutover
3. Consider using Temporary Access Passes (TAP) to allow users to set up Entra MFA without a pre-existing authenticator
4. Set Entra Conditional Access policies to enforce MFA registration before first access to sensitive apps

---

## Useful Discovery Script Outline

For a PingOne migration inventory (North America tenant), run these reads in order:

```bash
ENV="https://api.pingone.com/v1/environments/{environmentId}"
AUTH="Authorization: Bearer {token}"

# 1. Environment details
curl -s "$ENV" -H "$AUTH"

# 2. Populations (with user counts)
curl -s "$ENV/populations" -H "$AUTH"

# 3. User schema (discover custom attributes)
curl -s "$ENV/schemas" -H "$AUTH"

# 4. Applications (all protocols)
curl -s "$ENV/applications?limit=100" -H "$AUTH"

# 5. Application attribute mappings (per app)
# curl -s "$ENV/applications/{appId}/attributes" -H "$AUTH"

# 6. Sign-on policies
curl -s "$ENV/signOnPolicies" -H "$AUTH"

# 7. Groups (with membership counts)
curl -s "$ENV/groups?limit=100" -H "$AUTH"

# 8. User count by population
# (from step 2 — populations include userCount field)
```

For user export (large environments):
```bash
# Export users in pages of 100 — follow _links.next.href until absent
curl -s "$ENV/users?limit=100" -H "$AUTH"
```

---

## Related Skills

- **[core-api-overview.md](core-api-overview.md)** — Base URLs, auth, pagination
- **[ping-mcp-servers.md](ping-mcp-servers.md)** — MCP tooling for PingOne cloud
- **[pingfederate-onprem.md](pingfederate-onprem.md)** — On-prem PingFederate (separate migration track)
- **[README.md](README.md)** — Terminology and deployment patterns
- **`skills/okta/applications-saml-oidc.md`** — SAML/OIDC migration gotchas (many apply to PingOne too)
- **`skills/msft-security/entra-id-protection.md`** — Entra MFA and Conditional Access (migration target)
