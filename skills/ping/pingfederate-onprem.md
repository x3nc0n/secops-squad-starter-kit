---
title: PingFederate On-Premises Admin API — Migration Discovery Guide
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# PingFederate On-Premises Admin API — Migration Discovery Guide

## Why This Matters

PingFederate is the most common Ping Identity deployment pattern in large enterprises. When the migration source is PingFederate, the admin API is your primary discovery tool for understanding what identity configurations exist and what must be rebuilt in Microsoft Entra ID. This document covers the read paths that matter for migration planning.

**Before you start:** Verify network access to port 9999 on the PingFederate admin node. Confirm Basic Auth credentials with the customer. Pull the live OpenAPI spec (see below) — do not rely on version assumptions.

---

## Quick Reference

| Item | Value | Verified? |
|---|---|---|
| Admin port | `9999` (HTTPS) | ✅ Confirmed via docs.pingidentity.com |
| Base path | `/pf-admin-api/v1/` | ✅ Confirmed via docs.pingidentity.com |
| Auth | `Authorization: Basic base64(user:pass)` | ✅ Confirmed |
| XSRF on writes | `X-XSRF-Header: PingFederate` | ✅ Confirmed — required on POST/PUT/DELETE |
| XSRF on GETs | Not required | ✅ Confirmed |
| OpenAPI spec | `GET :9999/pf-admin-api/api-docs` | ✅ Confirmed — served live from instance |
| Swagger UI | `GET :9999/pf-admin-api/` | ✅ Confirmed |

---

## Getting the Live OpenAPI Spec

Always pull the OpenAPI spec from the customer's instance before writing any API code. PingFederate's admin API evolves with each version and may include customer-specific extensions.

```bash
# Pull the live spec
curl -k -u admin:password \
  https://{pingfederate-host}:9999/pf-admin-api/api-docs \
  > pf-admin-api-spec.json

# Or open the interactive Swagger UI in a browser:
# https://{pingfederate-host}:9999/pf-admin-api/
```

The `-k` flag ignores self-signed certificates during initial exploration — for production migration tooling, add the server cert to your trust store.

---

## SP Connections (Service Providers)

SP connections define how PingFederate acts as an IdP for downstream Service Providers. These are the SAML integrations you must inventory and recreate in Entra.

### List All SP Connections

```bash
GET https://{pf-host}:9999/pf-admin-api/v1/idp/spConnections?page=1&numberPerPage=100
Authorization: Basic base64(admin:password)
```

Response excerpt:
```json
{
  "items": [
    {
      "id": "salesforce-prod",
      "name": "Salesforce Production",
      "entityId": "https://saml.salesforce.com",
      "active": true,
      "creationDate": "2022-03-15T10:00:00.000Z",
      "modificationDate": "2025-11-01T14:30:00.000Z",
      "type": "SP",
      "spBrowserSso": {
        "protocol": "SAML20",
        "enabledProfiles": ["SP_INITIATED", "IDP_INITIATED"]
      }
    }
  ]
}
```

### Get a Specific SP Connection (Full Detail)

```bash
GET https://{pf-host}:9999/pf-admin-api/v1/idp/spConnections/{connectionId}
Authorization: Basic base64(admin:password)
```

The full SP connection object contains the entire SAML configuration. Key sections for migration:

```json
{
  "id": "salesforce-prod",
  "entityId": "https://saml.salesforce.com",
  "spBrowserSso": {
    "protocol": "SAML20",
    "assertionsSigned": true,
    "signResponseAsRequired": true,
    "sloServiceEndpoints": [...],
    "defaultTargetUrl": "https://acme.salesforce.com",
    "encryptionPolicy": {
      "encryptAssertion": false,
      "encryptionAlgorithm": "AES_128"
    },
    "attributeContract": {
      "coreAttributes": [
        { "name": "SAML_SUBJECT", "nameFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified" }
      ],
      "extendedAttributes": [
        { "name": "email", "nameFormat": "urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified" },
        { "name": "firstName", "nameFormat": "urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified" },
        { "name": "department", "nameFormat": "urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified" }
      ]
    },
    "assertionLifetime": {
      "minutesBefore": 5,
      "minutesAfter": 5
    },
    "acsUrls": [
      {
        "index": 0,
        "default": true,
        "binding": "POST",
        "url": "https://acme.salesforce.com/services/oauth2/callback"
      }
    ]
  },
  "credentials": {
    "signingSettings": {
      "signingKeyPairRef": { "id": "keyPair123" },
      "algorithm": "SHA256withRSA"
    }
  }
}
```

**Migration checklist for each SP connection:**
- [ ] Record `entityId` — this becomes the Entra Enterprise App Identifier
- [ ] Record all `acsUrls` — these become Entra Reply URLs
- [ ] Record `attributeContract.extendedAttributes` — these become Entra SAML claims
- [ ] Record the NameID format and template (see NameID section below — this is the #1 migration blocker)
- [ ] Check `encryptionPolicy.encryptAssertion` — if true, Entra needs to be configured for assertion encryption
- [ ] Note `sloServiceEndpoints` — test SLO behavior explicitly after migration

---

## IdP Connections (Identity Providers — Inbound Federation)

IdP connections define how PingFederate accepts SAML assertions from upstream identity providers. If PingFederate is acting as a hub (SP role to an upstream IdP, then IdP role to downstream apps), you need to inventory both sides.

```bash
# List all IdP connections
GET https://{pf-host}:9999/pf-admin-api/v1/sp/idpConnections?page=1&numberPerPage=100
Authorization: Basic base64(admin:password)
```

For migration: if PingFederate is brokering between an upstream corp directory (e.g., Active Directory via ADFS) and downstream apps, the migration may replace PingFederate entirely — Entra becomes both the IdP and the token issuer, eliminating the hub.

---

## Authentication Adapters

Adapters define how PingFederate collects user credentials. They are the mechanism by which PingFederate authenticates users before issuing SAML assertions or OIDC tokens. Understanding what adapters are in use tells you how users are authenticating today and what the post-migration authentication path in Entra must achieve.

```bash
# List all configured adapters
GET https://{pf-host}:9999/pf-admin-api/v1/idp/adapters?page=1&numberPerPage=100
Authorization: Basic base64(admin:password)

# Get a specific adapter's configuration
GET https://{pf-host}:9999/pf-admin-api/v1/idp/adapters/{adapterId}
```

**Common adapter types and their Entra migration implications:**

| Adapter Type | What It Does | Entra Equivalent |
|---|---|---|
| HTML Form Adapter | Username/password form collected by PF | Entra native authentication (SSPR, password policies) |
| Kerberos Adapter | Windows Integrated Auth (NTLM/Kerberos) | Entra seamless SSO (Azure AD Kerberos) |
| RADIUS Adapter | RADIUS-based MFA or VPN auth | Entra MFA / NPS Extension for RADIUS |
| Certificate Adapter | Client certificate authentication | Entra certificate-based auth (CBA) |
| OpenToken Adapter | Token-passing from another system | Context-specific — investigate the source system |
| PingID Adapter | PingID step-up MFA integration | Entra MFA / Microsoft Authenticator |

---

## OAuth/OIDC Clients (PingFederate AS)

PingFederate also acts as an OAuth 2.0 Authorization Server and OIDC Provider. OIDC clients configured here must be recreated as Entra App Registrations.

```bash
# List all OAuth clients
GET https://{pf-host}:9999/pf-admin-api/v1/oauth/clients?page=1&numberPerPage=100
Authorization: Basic base64(admin:password)

# Get a specific client
GET https://{pf-host}:9999/pf-admin-api/v1/oauth/clients/{clientId}
```

Key fields per client:
- `clientId` — the current OAuth client identifier (will change in Entra)
- `grantTypes` — which OAuth flows are enabled (`AUTHORIZATION_CODE`, `CLIENT_CREDENTIALS`, `IMPLICIT`, `REFRESH_TOKEN`, `DEVICE_CODE`)
- `redirectUris` — redirect URIs (must be carried over to Entra app registration)
- `allowedScopes` — scopes configured for this client
- `clientAuth` — authentication method (`SECRET`, `PRIVATE_KEY_JWT`, `NONE`)

---

## Attribute Contracts and Attribute Sources

Attribute contracts define what user attributes are included in SAML assertions or OIDC tokens. Attribute sources define where those attributes come from (typically PingDirectory/LDAP or the HTML Form Adapter).

```bash
# Attribute contracts are embedded in SP connections (spBrowserSso.attributeContract)
# and in OIDC access token management configs:
GET https://{pf-host}:9999/pf-admin-api/v1/oauth/accessTokenManagers
Authorization: Basic base64(admin:password)

# Attribute sources are embedded in the attribute mapping of each connection
# Retrieve the full connection to see the idpBrowserSso.attributeSources array
GET https://{pf-host}:9999/pf-admin-api/v1/idp/spConnections/{connectionId}
```

**Migration implication:** Every attribute sourced from PingDirectory/LDAP must be mapped to an Entra user property or directory extension attribute. Build the attribute-to-Entra-property map before writing any Graph API user creation code.

---

## ⚠️ The #1 Migration Blocker: NameID and Persistent Subject

The NameID is the primary user identifier sent in SAML assertions. For many Service Providers — particularly Salesforce, Workday, ServiceNow, and legacy enterprise apps — the NameID is stored as a persistent key in the SP's user database. **If the NameID value changes during migration, the SP will create a new user account instead of matching the existing one.**

### How PingFederate Configures NameID

In each SP connection, the `spBrowserSso` section contains the `nameIdAttributeMapping` (or embedded in the attribute contract) defining what value is used as the SAML Subject and in what format:

```json
{
  "spBrowserSso": {
    "sloServiceEndpoints": [...],
    "assertionLifetime": {...},
    "attributeContract": {
      "coreAttributes": [
        {
          "name": "SAML_SUBJECT",
          "nameFormat": "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent"
        }
      ]
    },
    "adapterMappingRef": {
      "id": "htmlFormAdapter"
    }
  }
}
```

The NameID value is determined by the adapter-to-SP attribute mapping. To see it:

```bash
# The full attribute mapping is in the idpToSpAdapterMapping sub-objects
# Check the spBrowserSso.ssoServiceEndpoints and attributeMapping in the full connection
GET https://{pf-host}:9999/pf-admin-api/v1/idp/spConnections/{connectionId}
# Look for: attributeSources, attributeMapping, contract/fulfillment
```

### Common NameID Patterns and Entra Mapping

| PingFederate NameID Source | Format | Entra Equivalent | Risk |
|---|---|---|---|
| `username` (login name) | `emailAddress` or `unspecified` | `userPrincipalName` | Medium — UPN must match exactly |
| `email` attribute | `emailAddress` | `mail` or `userPrincipalName` | Low — if email is stable |
| Opaque persistent ID (LDAP attr) | `persistent` | Custom claim from extension attribute | **High** — must preserve exact value |
| Employee number | `unspecified` | `employeeId` | Medium |
| Object GUID / UUID | `persistent` | `objectId` or extension attribute | **High** — often stored in SP as primary key |

### What to Do When You Find a `persistent` NameID

1. **Record the NameID source attribute** from PingDirectory (LDAP) — what LDAP attribute is being used?
2. **Verify whether the SP stores this value** — does Salesforce, Workday, etc. have this exact value as the user's federated ID in its user profile?
3. **Map the LDAP attribute to an Entra user property** — if the source is `employeeNumber`, map to `employeeId`; if it's a custom LDAP attribute, you need a directory extension in Entra
4. **Configure the Entra SAML claim to emit the exact same value** — using the Attributes & Claims configuration in the Enterprise App
5. **Do not assume `userPrincipalName` is a safe default** — it often is not, especially when the SP was configured years ago against a non-UPN LDAP attribute

**Flag this for the migration-map author:** The persistent NameID problem requires per-SP investigation. There is no automated resolution. Each SP connection in PingFederate with a `persistent` NameID format is a potential manual migration task.

---

## Password Credential Validators (PCVs)

PCVs define how PingFederate validates user passwords. They tell you the authoritative credential store:

```bash
GET https://{pf-host}:9999/pf-admin-api/v1/passwordCredentialValidators
Authorization: Basic base64(admin:password)
```

Common PCV types:
- **LDAP Username Password Credential Validator** — credentials validated against PingDirectory/AD
- **Simple Username Password Credential Validator** — local PF user store (rare; usually dev/test)
- **RADIUS PCV** — credentials validated via RADIUS

For migration: if the PCV points at Active Directory (same AD tenant as Entra), users already have Entra credentials. If it points at PingDirectory, the password migration problem (hash portability) exists — see the users section of `pingone-cloud.md` for guidance.

---

## Certificate Management

PingFederate manages its own signing certificates for SAML assertions and OIDC token signing. Inventory the certificates in use:

```bash
# List all key pairs (signing certificates)
GET https://{pf-host}:9999/pf-admin-api/v1/keyPairs/signing
Authorization: Basic base64(admin:password)

# List all trusted CAs (for validating inbound tokens/assertions)
GET https://{pf-host}:9999/pf-admin-api/v1/keyPairs/sslServer/cacerts
```

**For each SP connection:** Record which signing key pair is in use (`credentials.signingSettings.signingKeyPairRef.id`). When you reconfigure the SP to trust Entra, the SP must be given Entra's new SAML signing certificate. The PingFederate certificate is not portable and cannot be imported into Entra's certificate store.

---

## Useful Discovery Script Outline

For a PingFederate migration inventory, run these in order:

```bash
BASE="https://{pf-host}:9999/pf-admin-api/v1"
AUTH="-u admin:password"
HDR="-H 'Content-Type: application/json'"

# 1. Server version and capabilities
curl -sk $AUTH $BASE/version

# 2. All SP connections (paginate if > 100)
curl -sk $AUTH "$BASE/idp/spConnections?numberPerPage=100&page=1"

# 3. All IdP connections
curl -sk $AUTH "$BASE/sp/idpConnections?numberPerPage=100&page=1"

# 4. All adapters
curl -sk $AUTH "$BASE/idp/adapters?numberPerPage=100&page=1"

# 5. OAuth clients (if PF is an AS)
curl -sk $AUTH "$BASE/oauth/clients?numberPerPage=100&page=1"

# 6. Access token management instances (OIDC)
curl -sk $AUTH "$BASE/oauth/accessTokenManagers"

# 7. PCVs (password credential validators)
curl -sk $AUTH "$BASE/passwordCredentialValidators"

# 8. Signing certificates
curl -sk $AUTH "$BASE/keyPairs/signing"
```

Save the full JSON output of each. These become the inputs for the migration-map phase.

---

## Related Skills

- **[core-api-overview.md](core-api-overview.md)** — PF admin API auth, XSRF, OpenAPI
- **[pingone-cloud.md](pingone-cloud.md)** — Cloud migration path (PingOne)
- **[ping-mcp-servers.md](ping-mcp-servers.md)** — No official PF MCP server; build guidance
- **`skills/okta/applications-saml-oidc.md`** — SAML migration gotchas (cross-reference; many apply to PF too)
