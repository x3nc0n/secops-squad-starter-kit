---
title: Okta Users and Profiles
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Users and Profiles

## Overview

Okta's Universal Directory stores every user in a single, schema-driven profile store. Profile attributes are typed, can be marked required or optional, and can be customized per org. Understanding the profile model — what attributes exist, what they mean, and how they map to Entra — is the foundation of any migration or identity operation.

## User Object Structure

A full Okta user object has three top-level sections:

```json
{
  "id": "00u1a2b3c4d5e6f7g8h9",
  "status": "ACTIVE",
  "created": "2024-01-15T10:00:00.000Z",
  "activated": "2024-01-15T10:05:00.000Z",
  "statusChanged": "2024-01-15T10:05:00.000Z",
  "lastLogin": "2026-07-07T14:30:00.000Z",
  "lastUpdated": "2026-06-01T09:00:00.000Z",
  "passwordChanged": "2025-11-01T08:00:00.000Z",
  "type": { "id": "otytypes..." },
  "profile": {
    "login": "jane.smith@acme.com",
    "email": "jane.smith@acme.com",
    "firstName": "Jane",
    "lastName": "Smith",
    "displayName": "Jane Smith",
    "department": "Engineering",
    "title": "Senior Engineer",
    "employeeNumber": "EMP-1042",
    "mobilePhone": "+1-555-867-5309",
    "city": "Austin",
    "state": "TX",
    "countryCode": "US"
  },
  "credentials": {
    "password": {},
    "provider": { "type": "OKTA", "name": "OKTA" },
    "recovery_question": { "question": "..." }
  },
  "_links": { ... }
}
```

**Important fields for migration:**
- `id` — Okta's immutable user ID (`00u...`). Use this as the stable reference, not `login` which can change
- `status` — lifecycle state (see below)
- `profile.login` — the primary identifier; maps to UPN in Entra but may not be an email address
- `profile.email` — the contact email; may differ from `login` in some configurations
- `lastLogin` / `passwordChanged` — useful for identifying stale accounts during migration cleanup

## Universal Directory Profile Attributes

### Base/Standard Attributes

These exist in every Okta org. The mapping to Entra is generally clean for standard attributes.

| Okta Profile Attribute | Type | Entra (Graph API) Property | Notes |
|---|---|---|---|
| `login` | String | `userPrincipalName` | Okta login may not be an email address; UPN must follow `user@domain.tld` format in Entra |
| `email` | String | `mail` | Primary SMTP address |
| `firstName` | String | `givenName` | |
| `lastName` | String | `surname` | |
| `displayName` | String | `displayName` | |
| `nickName` | String | `mailNickname` | |
| `mobilePhone` | String | `mobilePhone` | Format normalization often required — Okta stores freeform; Entra expects E.164 |
| `primaryPhone` | String | `businessPhones[0]` | |
| `secondEmail` | String | `otherMails[0]` | |
| `title` | String | `jobTitle` | |
| `department` | String | `department` | |
| `organization` | String | `companyName` | |
| `employeeNumber` | String | `employeeId` | |
| `division` | String | `division` | Entra extension attribute if not in base schema |
| `manager` | String | `manager` (object reference) | **Gotcha:** Okta stores manager as a string (login or display name); Entra requires the manager's object ID reference. Requires a lookup pass. |
| `costCenter` | String | `costCenter` | |
| `streetAddress` | String | `streetAddress` | |
| `city` | String | `city` | |
| `state` | String | `state` | |
| `zipCode` | String | `postalCode` | |
| `countryCode` | String | `country` | Okta uses ISO 3166-1 alpha-2 (e.g., "US"); Entra accepts the full country name or ISO code — normalize consistently |
| `userType` | String | `userType` | |
| `locale` | String | `preferredLanguage` | IETF BCP 47 in both (e.g., "en-US") |
| `timezone` | String | `officeLocation` (no match) | **No clean mapping.** Okta uses IANA timezone (e.g., "America/Chicago"); Entra has no timezone property on the user object. Store in extension attribute if needed. |
| `honorificPrefix` / `honorificSuffix` | String | No equivalent | **No mapping in Entra base schema.** Drop or store in extension attributes. |

### Custom Profile Attributes

Okta lets each org define custom attributes in the profile editor (Admin Console → Directory → Profile Editor → Okta User). Custom attributes are namespaced under the profile object but have no special prefix.

**In Entra**, custom attributes require [directory schema extensions](https://learn.microsoft.com/en-us/graph/extensibility-overview):

```json
// Entra open extension (simple but per-object, not schema-enforced)
{
  "extensions": {
    "com.acme.secops": {
      "oktaEmployeeType": "CONTRACTOR",
      "costCenterCode": "CC-1042"
    }
  }
}
```

Or stronger: **schema extension** (type-enforced, indexed, usable in dynamic group rules):

```bash
POST /v1.0/schemaExtensions
{
  "id": "acme_oktaProfile",
  "description": "Attributes migrated from Okta Universal Directory",
  "targetTypes": ["User"],
  "properties": [
    { "name": "employeeClassification", "type": "String" },
    { "name": "costCenterCode", "type": "String" }
  ]
}
```

**Migration advice:** Inventory all custom Okta profile attributes before migration. Any attribute used in a dynamic group rule or app assignment rule in Okta **must** exist in Entra before you attempt to recreate those rules.

## Lifecycle States

Okta tracks every user's state through a defined lifecycle state machine. Understanding these states is critical for migration — you cannot migrate a DEPROVISIONED user back to ACTIVE in one step, and a STAGED user has never authenticated.

```
STAGED → PROVISIONED → ACTIVE ⇄ SUSPENDED → DEPROVISIONED
                                              ↑
                                        (also from ACTIVE)
```

### State Definitions and Entra Mapping

| Okta Status | Meaning | Entra Equivalent | `accountEnabled` | Migration Action |
|---|---|---|---|---|
| `STAGED` | Created but not yet activated. No activation email sent. User cannot log in. | User object with `accountEnabled: false` | `false` | Create in Entra disabled. Determine if these should be activated or skipped. |
| `PROVISIONED` | Activation email sent, but user has not completed activation (no password set). | User with `accountEnabled: false` or `true` depending on intent | Varies | Treat as pending activation — may need forced password reset on first Entra login. |
| `ACTIVE` | User is fully active and can authenticate. | `accountEnabled: true` | `true` | Standard migration path. |
| `SUSPENDED` | Temporarily disabled. User cannot log in; account is preserved. | `accountEnabled: false` | `false` | Create disabled in Entra. Document reason for suspension for review. |
| `DEPROVISIONED` | Deactivated. In Okta OIE, data is retained for audit but access is revoked. | Deleted user (soft-delete in Entra, 30-day recycle bin) or `accountEnabled: false` | `false` or deleted | Typically do NOT migrate deprovisioned users. If audit trail is required, keep as disabled in Entra. |
| `RECOVERY` | User is in password reset flow. Counts as ACTIVE for most purposes. | `accountEnabled: true` + force password change on next sign-in | `true` | Migrate as ACTIVE with `passwordProfile.forceChangePasswordNextSignIn: true` |
| `PASSWORD_EXPIRED` | Password has expired; user must change before proceeding. | `accountEnabled: true` + force password change | `true` | Migrate as ACTIVE with forced password change. |
| `LOCKED_OUT` | Account temporarily locked due to failed login attempts. | `accountEnabled: false` (or Smart Lockout engaged) | `false` | Migrate disabled; review lockout cause. |

**No 1:1 mapping exists** for `STAGED` and `PROVISIONED` — Entra has no concept of an activation-pending state. These are both expressed as `accountEnabled: false`, with a custom extension attribute recommended to preserve the original Okta status for audit purposes.

### Fetching Users by Lifecycle State

```bash
# Get all ACTIVE users
GET /api/v1/users?filter=status eq "ACTIVE"&limit=200

# Get suspended users
GET /api/v1/users?filter=status eq "SUSPENDED"&limit=200

# Get deprovisioned users (last 90 days of login activity)
GET /api/v1/users?filter=status eq "DEPROVISIONED" and lastLogin gt "2026-04-08T00:00:00.000Z"&limit=200
```

## Password Credentials and Migration

**You cannot migrate Okta passwords to Entra.** Okta stores passwords using a one-way hash; the plaintext is never accessible. During a migration:

1. For ACTIVE users: Force a password reset on first Entra login. Communicate this ahead of the cutover.
2. If SSO is in place (Okta currently providing SSO to M365), ensure Entra becomes the new source before disabling Okta.
3. For SAML-federated users (Okta federating into Entra): the Okta session becomes irrelevant post-cutover; users authenticate directly against Entra.

**Entra Graph API to create user with forced reset:**

```json
POST /v1.0/users
{
  "accountEnabled": true,
  "displayName": "Jane Smith",
  "mailNickname": "jsmith",
  "userPrincipalName": "jane.smith@acme.com",
  "mail": "jane.smith@acme.com",
  "givenName": "Jane",
  "surname": "Smith",
  "passwordProfile": {
    "forceChangePasswordNextSignIn": true,
    "password": "{temporary-random-password}"
  }
}
```

## MFA Enrollment State

Okta tracks per-user MFA enrollment in the `factors` sub-resource:

```bash
GET /api/v1/users/{userId}/factors
```

Returns a list of enrolled factors with their status (`ACTIVE`, `INACTIVE`, `PENDING_ACTIVATION`, `EXPIRED`).

**For migration planning:** Inventory MFA enrollment gaps before cutover. Users with no enrolled factors in Entra will be blocked by Conditional Access policies requiring MFA at first post-cutover login. Consider:
- Sending MFA registration campaigns before cutover
- Temporarily using report-only mode on CA policies to understand impact
- Configuring the MFA registration CA policy to run at first Entra login for all migrated users

## Related Skills

- **[core-api-overview.md](core-api-overview.md)** — API auth, rate limits, pagination
- **[groups-and-rules.md](groups-and-rules.md)** — Group membership tied to user profiles
- **[okta-to-entra-migration-map.md](okta-to-entra-migration-map.md)** — Full attribute mapping table
- **`skills/msft-security/entra-id-protection.md`** — Entra user risk and Conditional Access
