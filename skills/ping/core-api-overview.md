---
title: Ping Identity Core API Overview
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# Ping Identity Core API Overview

## Overview

The Ping Identity portfolio has four separate REST admin API surfaces. They share no authentication model, no base URL scheme, and no pagination convention. You must know which product you are talking to before writing any code. This document covers each surface in turn: PingOne cloud, PingOne Advanced Identity Cloud (AIC), on-premises PingFederate, PingDirectory, and PingAccess.

---

## PingOne Platform API (Cloud)

Source: [PingOne Platform API Reference](https://apidocs.pingidentity.com/pingone/platform/v1/api/)

### Base URLs and Regions

PingOne tenants are created in one of five regions. The region determines your API base URL. **You cannot change a tenant's region.** Identify the customer's region from the PingOne Admin Console before writing any API calls.

| Region | API Base URL |
|---|---|
| North America | `https://api.pingone.com/v1` |
| Europe | `https://api.eu.pingone.com/v1` |
| Asia Pacific | `https://api.asia.pingone.com/v1` |
| Canada | `https://api.ca.pingone.com/v1` |
| Australia | `https://api.au.pingone.com/v1` |

Every resource path is scoped under an environment:

```
https://api.pingone.{region}/v1/environments/{environmentId}/{resource}
```

Example — list users in a North America environment:

```bash
GET https://api.pingone.com/v1/environments/a1b2c3d4-e5f6-7890-abcd-ef1234567890/users
```

The `environmentId` is a UUID visible in the PingOne Admin Console under the environment's settings.

### Authentication — Worker Application (Client Credentials)

PingOne uses OAuth 2.0 with the `client_credentials` grant for service-to-service API access. The credential pair is a **Worker Application** configured in PingOne.

**To create a Worker Application:**
1. PingOne Admin Console → Applications → Add Application → Worker
2. Enable the application
3. Assign roles to the application principal (e.g., "Environment Admin" for read + write; "Identity Data Read Only" for inventory work)
4. Capture the **Client ID** and **Client Secret** from the application's Configuration tab

**Token request:**

```bash
POST https://auth.pingone.{region}/{environmentId}/as/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={clientId}
&client_secret={clientSecret}
```

Response:
```json
{
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

Then pass the access token as `Authorization: Bearer {access_token}` on all subsequent calls.

**Least privilege:** Grant the Worker Application only the roles it needs. For migration discovery (read-only), "Identity Data Read Only" at the environment level is sufficient. Add "Application Admin" and "Directory Admin" roles only when writes are needed.

### Environments and Populations Model

PingOne organizes identity data in a two-level hierarchy:

- **Organization** — the top-level account (your customer's Ping subscription)
- **Environment** — a logical tenant within the organization (e.g., Production, UAT, Dev). Each environment has its own users, groups, applications, and policies
- **Population** — a subset of users within an environment. Populations are used to segment users by business unit, application audience, or lifecycle stage. Every user belongs to exactly one population

```
Organization
  └─ Environment (Production)
       ├─ Population (Employees)
       ├─ Population (Contractors)
       └─ Population (Customers)
            └─ Users, Groups, Applications, Policies
```

**Migration note:** PingOne populations are the primary segmentation model. If the customer has multiple populations, understand the boundary — you may be migrating all populations into a single Entra tenant, which flattens the segmentation (Entra doesn't have a native populations concept; use dynamic groups or administrative units to approximate it).

### Rate Limits

PingOne enforces rate limits per tenant. Exact limits depend on the customer's license tier. Check the `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` response headers. On limit: HTTP 429.

Limits are generally lower than Okta's defaults. Design migration bulk-read tooling with exponential backoff from the start.

### Pagination

PingOne uses cursor-based pagination via `_links.next.href` in the response body (HAL-style):

```json
{
  "_embedded": {
    "users": [ ... ]
  },
  "_links": {
    "self": { "href": "https://api.pingone.com/v1/environments/{envId}/users?limit=100" },
    "next": { "href": "https://api.pingone.com/v1/environments/{envId}/users?cursor=abc123&limit=100" }
  },
  "size": 100,
  "count": 4523
}
```

Follow `_links.next.href` until it is absent. Use `limit` up to 200 (check per-endpoint docs for the maximum).

**Do not use offset-based pagination** — PingOne does not reliably support it for large collections.

---

## PingOne Advanced Identity Cloud (AIC)

PingOne AIC is the ForgeRock-lineage cloud product (ForgeRock acquired 2023). AIC tenants are hosted at `{tenant-name}.forgeblocks.com`. The admin console URL is `https://{tenant}.forgeblocks.com/am/` for the Access Manager and `https://{tenant}.forgeblocks.com/openidm/` for the Identity Management component.

**AIC is NOT the same product as PingOne.** Different APIs, different tooling, different migration approach. If the customer's tenant URL contains `.forgeblocks.com`, they are on AIC, not PingOne.

### AIC API Surfaces

AIC exposes two major internal API surfaces, both requiring OAuth 2.0 access:

| Surface | Base URL | Description |
|---|---|---|
| AM (Access Manager) | `https://{tenant}.forgeblocks.com/am/` | Authentication journeys, SAML/OIDC, sessions, policies |
| IDM (Identity Management) | `https://{tenant}.forgeblocks.com/openidm/` | Managed objects (users, roles, groups, orgs), SCIM, sync |

**Authentication:** AIC uses OAuth 2.0 PKCE or Device Code flows. The recommended approach for tooling is to create a service account and use the AIC MCP server (see `ping-mcp-servers.md`) or call the IDM REST API directly.

For migration discovery, the IDM managed objects endpoint is the primary read surface:

```bash
GET https://{tenant}.forgeblocks.com/openidm/managed/alpha_user?_queryFilter=true&_pageSize=100
Authorization: Bearer {access_token}
```

The `alpha_` / `bravo_` prefix is a realm convention in AIC (alpha = default realm; bravo = secondary realm if configured).

---

## PingFederate Admin API (On-Premises)

Source: [PingFederate Admin API Documentation](https://docs.pingidentity.com/r/en-us/pingfederate-112/pf_api_pf_admin_api)

### Base URL and Port

PingFederate's admin API is hosted on the **admin port**, which is separate from the runtime federation port. Default admin port is **9999** (HTTPS only).

```
https://{pingfederate-admin-host}:9999/pf-admin-api/v1/{resource}
```

The admin port is typically firewalled from external networks. Migration tooling must run from a host with network access to port 9999 on the PingFederate admin node(s).

### Authentication

PingFederate admin API uses **HTTP Basic Authentication** with a PingFederate administrator username and password:

```
Authorization: Basic base64(username:password)
```

**For migration discovery:** Create a dedicated admin account with read-only permissions. PingFederate supports delegated admin roles — use the "Crypto Manager" and "User Admin" minimum roles for read operations; avoid using the `Administrator` superuser account.

### XSRF Protection (Required on All Writes)

PingFederate requires a custom XSRF header on all state-changing requests (POST, PUT, PATCH, DELETE). Without this header, the server returns HTTP 403.

```
X-XSRF-Header: PingFederate
```

GET requests do not require the XSRF header. For migration discovery work (read-only), you only need Basic Auth.

### OpenAPI Specification

PingFederate serves its own live OpenAPI (Swagger) spec from the running instance. Always pull the spec from the customer's instance — it reflects the exact version and configuration, including any custom extensions:

```bash
GET https://{pingfederate-host}:9999/pf-admin-api/api-docs

# Or for the interactive Swagger UI:
# https://{pingfederate-host}:9999/pf-admin-api/
```

The spec path and content change with each PingFederate version. Do not hardcode field assumptions from docs — pull the live spec.

### Error Handling

PingFederate returns standard HTTP status codes with a JSON error body:

```json
{
  "resultId": "validation_error",
  "message": "Validation error(s) occurred. Please review the error(s) below.",
  "validationErrors": [
    {
      "fieldPath": "name",
      "message": "This field is required.",
      "errorId": "required"
    }
  ]
}
```

Common codes in discovery context:
- `400` — Validation error (malformed request or invalid field value)
- `401` — Authentication failure (wrong credentials or missing header)
- `403` — Forbidden — missing XSRF header on a write, or insufficient admin role
- `404` — Resource not found
- `422` — Unprocessable entity — semantic validation failure

---

## PingDirectory (On-Premises)

PingDirectory is the LDAP-based user store. For migration work, you interact with it via SCIM 2.0 (preferred for structured JSON export) or LDAP.

### SCIM 2.0 Interface

PingDirectory exposes SCIM 2.0 at `/scim/v2/`. The default port for the SCIM HTTP endpoint is typically **443** (HTTPS, through a reverse proxy) or **8080/8443** on the directory server directly — verify the actual port with the customer's infrastructure team.

```bash
# List users (paginated)
GET https://{directory-host}/scim/v2/Users?count=100&startIndex=1
Authorization: Basic base64(username:password)

# Get a single user
GET https://{directory-host}/scim/v2/Users/{userId}

# Filter users by attribute
GET https://{directory-host}/scim/v2/Users?filter=userName eq "jsmith@acme.com"
```

SCIM pagination uses `startIndex` (1-based) and `count`. Response follows the SCIM 2.0 `ListResponse` format:

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
  "totalResults": 8423,
  "startIndex": 1,
  "itemsPerPage": 100,
  "Resources": [ ... ]
}
```

### LDAP Interface

For bulk export, LDAP is often faster than SCIM for large directories. Use `ldapsearch` or an LDAP library. The default LDAP port is **389** (or **636** for LDAPS). The admin port for replication and management operations is typically **4444**.

**Migration planning:** Always prefer SCIM for attribute enumeration — it returns JSON and the PingDirectory attribute schema is visible. LDAP is preferred for bulk export of accounts when SCIM pagination is too slow for the directory size.

⚠️ **SCIM port is reported here as a common default — verify against the customer's PingDirectory configuration. Port varies by deployment.**

---

## PingAccess Admin API (On-Premises)

Source: [PingAccess Admin API Documentation](https://docs.pingidentity.com/access/latest/pingaccess/apig.html)

### Base URL and Port

PingAccess admin API uses a separate admin port from the runtime proxy port. Default admin port is **9000** (HTTPS).

```
https://{pingaccess-admin-host}:9000/pa-admin-api/v3/{resource}
```

⚠️ **Port 9000 is the reported default — verify against the customer's PingAccess deployment configuration. Some deployments use a different admin port.**

### Authentication

PingAccess admin API requires an authenticated session. Session-based auth uses a `JSESSIONID` cookie obtained from the login endpoint. For scripted access, obtain a session first:

```bash
# Step 1: Login
POST https://{pingaccess-host}:9000/pa-admin-api/v3/login
Content-Type: application/json
X-XSRF-Header: PingAccess

{"username": "Administrator", "password": "..."}

# Response: Set-Cookie: PA_TOKEN=...; JSESSIONID=...
```

### XSRF Protection (Required on All Requests)

PingAccess requires the XSRF header on **all requests** including GET, unlike PingFederate which only requires it on writes:

```
X-XSRF-Header: PingAccess
```

⚠️ **The XSRF header value casing ("PingAccess" vs "pingaccess") is reported to vary by version. Some community sources report lowercase `pingaccess`. Verify against your customer's deployed PingAccess version from the admin API docs at `/pa-admin-api/`.**

### Migration Use

PingAccess sits in front of web applications — it is not an identity store or user database. For migration purposes, enumerate PingAccess to understand:
- Which applications are protected and by what policy
- Which OAuth/OIDC resource servers and clients are registered
- Token validation configuration (what token issuer PingAccess trusts)

After Entra migration, PingAccess token validation configuration must be updated to trust Entra-issued tokens (new issuer URL, new JWKS endpoint).

---

## API Surface Comparison

| Product | Base Path | Auth | XSRF | Pagination | Notes |
|---|---|---|---|---|---|
| PingOne (cloud) | `api.pingone.{region}/v1/` | OAuth2 Bearer (Worker App) | Not required | HAL `_links.next.href` | Five regions; env-scoped paths |
| PingOne AIC (cloud) | `{tenant}.forgeblocks.com/openidm/` | OAuth2 PKCE / Bearer | Not required | `_pagedResultsCookie` | ForgeRock-lineage; AM + IDM surfaces |
| PingFederate (on-prem) | `:9999/pf-admin-api/v1/` | HTTP Basic | `X-XSRF-Header: PingFederate` on writes | Cursor-based per endpoint | Live OpenAPI at `/api-docs` |
| PingDirectory (on-prem) | `/scim/v2/` | Basic or LDAP bind | Not required | SCIM `startIndex` + `count` | Also LDAP on :389/:636 |
| PingAccess (on-prem) | `:9000/pa-admin-api/v3/` | Session cookie (POST /login) | `X-XSRF-Header: PingAccess` on all requests | Varies | Not an identity store; governs access policy |

---

## Related Skills

- **[ping-mcp-servers.md](ping-mcp-servers.md)** — MCP tooling for the Ping portfolio
- **[pingfederate-onprem.md](pingfederate-onprem.md)** — PingFederate admin API deep dive
- **[pingone-cloud.md](pingone-cloud.md)** — PingOne cloud object model
- **[README.md](README.md)** — Terminology and hybrid deployment patterns
