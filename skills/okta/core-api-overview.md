---
title: Okta Core API Overview
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Core API Overview

## Overview

The Okta Core API is a REST-based management and authentication surface covering users, groups, applications, policies, sessions, and the System Log. All Okta objects accessed during migration or federated-ops work come through this API. This skill covers the API surface, authentication models, rate limits, pagination, and org-level concepts that agents must understand before calling any Okta endpoint.

Cross-reference: `lib/okta/` (client library built by Sydnor) and the Okta MCP server skill (when available) for tool-level integration.

## Base URL and Org Concepts

Every Okta organization has a unique base URL:

```
https://{yourOktaDomain}/api/v1
```

For Okta-hosted domains: `https://acme.okta.com/api/v1`  
For custom domains: `https://sso.acme.com/api/v1` (verify in the Okta Admin Console under Settings → Customization)

**Preview (sandbox) orgs** use `.oktapreview.com`. Never point migration tooling at preview unless intentional — the data is not production.

**Org ID** — every org has an immutable `id` field (format: `00o...`). Useful for audit correlation across the System Log. Retrieve it via:

```bash
GET /api/v1/org
# Returns: { "id": "00oa...", "subdomain": "acme", ... }
```

## Authentication Models

### SSWS (API Token)

The legacy auth model. An admin creates a static token in the Okta Admin Console (Security → API → Tokens). The token is passed in the `Authorization` header:

```
Authorization: SSWS {token}
```

**Properties:**
- Token inherits **all permissions of the creating user** — no scope restriction is possible
- Tied to the creating user's account; if the account is deactivated, the token dies immediately
- Expires after 30 days of inactivity; otherwise long-lived until manually revoked
- Manual rotation required — no refresh mechanism

**When to use:** Legacy integrations and quick admin scripts only. Do not use SSWS for new migration tooling or automation.

**Rate limit behavior:** SSWS tokens share the org-level rate limit bucket. Each token/OAuth app can consume up to 50% of a bucket's org capacity by default (configurable).

### OAuth 2.0 for Okta (Recommended)

The modern model. A service app is registered in Okta and granted explicit OAuth scopes. Access tokens are short-lived (default 1 hour) and scoped to only the permissions the app needs.

**Setup:**
1. Create an API Services app in the Okta Admin Console (Applications → Create App Integration → API Services)
2. Assign OAuth scopes (e.g., `okta.users.read`, `okta.groups.read`, `okta.apps.read`)
3. Use the client credentials flow — no user involvement for background services

```bash
# Client credentials token request
POST https://{yourOktaDomain}/oauth2/v1/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={clientId}
&client_secret={clientSecret}
&scope=okta.users.read okta.groups.read okta.apps.read

# Response: { "access_token": "eyJ...", "token_type": "Bearer", "expires_in": 3600 }
```

Then pass the access token:

```
Authorization: Bearer {access_token}
```

**Scope reference for migration/ops work:**

| Scope | Access |
|---|---|
| `okta.users.read` | Read users and profiles |
| `okta.users.manage` | Create/update/deactivate users |
| `okta.groups.read` | Read groups and membership |
| `okta.groups.manage` | Create/update groups and rules |
| `okta.apps.read` | Read app integrations and assignments |
| `okta.apps.manage` | Modify app integrations |
| `okta.policies.read` | Read sign-on, MFA, and enrollment policies |
| `okta.logs.read` | Read the System Log |
| `okta.authenticators.read` | Read configured authenticators |

**Why OAuth over SSWS for migration tooling:**
- Least-privilege scoping prevents accidental writes during read-only inventory phases
- Not tied to an individual admin's account lifecycle
- Token rotation is automatic

## Rate Limits

Okta enforces per-endpoint rate limits. Limits are expressed per minute at the org level, with each principal (token or OAuth app) allowed up to 50% by default.

**Key limits for migration/ops work (vary by org tier — verify in Admin Console → Reports → Rate Limits):**

| Endpoint / Bucket | Typical Limit | Notes |
|---|---|---|
| `GET /api/v1/users` | 600 req/min org-wide | Listing users; use cursor pagination |
| `GET /api/v1/users/{id}` | 2000 req/min org-wide | Individual user lookups |
| `GET /api/v1/groups` | 600 req/min org-wide | |
| `GET /api/v1/apps` | 100 req/min org-wide | Apps list is often the bottleneck |
| `GET /api/v1/logs` | 120 req/min org-wide | System Log — paginate carefully |
| `POST /api/v1/users` | 300 req/min org-wide | User creation |
| `PUT /api/v1/users/{id}` | 600 req/min org-wide | Profile updates |

**Rate limit headers — always read these:**

```
X-Rate-Limit-Limit: 600          # Bucket total capacity
X-Rate-Limit-Remaining: 598      # Remaining this window
X-Rate-Limit-Reset: 1720000000   # Unix epoch when the window resets
```

**When you hit a limit:** Okta returns `HTTP 429` with a `Retry-After` header. Back off to that timestamp, then resume. Do not retry immediately — Okta will extend the penalty window.

**DynamicScale add-on** — orgs with this add-on have significantly higher limits. Check with the customer before planning migration concurrency.

## Pagination

Okta uses **cursor-based pagination** via Link headers. Do not use offset pagination — it is unreliable for large orgs because directory mutations (new users added during a scan) cause pages to shift.

**Pattern:**

```bash
# First request
GET /api/v1/users?limit=200

# Response headers include:
Link: <https://acme.okta.com/api/v1/users?after=00u...&limit=200>; rel="next"

# Follow "next" until the header is absent (last page)
```

- `limit` max is **200** for most collection endpoints
- The `after` cursor is opaque — do not attempt to construct it manually
- Cursors are valid for ~24 hours; long-running scans should checkpoint the cursor value

**System Log pagination** uses `since`/`until` time bounds plus cursor. Always paginate forward in time:

```bash
GET /api/v1/logs?since=2026-07-01T00:00:00Z&limit=1000
# Follow Link: rel="next" until HTTP 200 with no next link
```

## Search and Filtering

Most collection endpoints support `filter` and `search` query parameters:

```bash
# Filter users by status
GET /api/v1/users?filter=status eq "ACTIVE"

# Search across profile attributes (slower, but more flexible)
GET /api/v1/users?search=profile.department eq "Engineering"

# Filter groups by type
GET /api/v1/groups?filter=type eq "OKTA_GROUP"
```

**Filter vs Search:**
- `filter` uses Okta's SCIM-like filter syntax; operates on indexed fields; faster
- `search` supports a broader set of profile attributes; uses full-text index; slower and subject to stricter rate limits

For migration inventory work, prefer `filter` on `status` and `type` fields, then fetch individual records for profile detail.

## Error Handling

Okta error responses follow a consistent schema:

```json
{
  "errorCode": "E0000001",
  "errorSummary": "Api validation failed",
  "errorLink": "E0000001",
  "errorId": "oaEHs-abc123",
  "errorCauses": [
    { "errorSummary": "login: An object with this field already exists in the current organization" }
  ]
}
```

**Common error codes in migration context:**

| Code | Meaning | Action |
|---|---|---|
| `E0000001` | Validation failed | Check the `errorCauses` field for the specific field violation |
| `E0000011` | Invalid token | Token expired, revoked, or scoped incorrectly |
| `E0000047` | Rate limit exceeded | Back off per `Retry-After` header |
| `E0000095` | Feature not enabled | Operation requires a feature not in this org's license tier |
| `E0000112` | Cannot delete/deactivate — app assignments exist | Remove app assignments before deactivating |

## System Log (Audit Trail)

The Okta System Log is the primary audit source. Every management API call, authentication event, user lifecycle change, and policy evaluation is logged here.

**Key event types for security/migration use:**

| Event Type | Description |
|---|---|
| `user.lifecycle.create` | User created |
| `user.lifecycle.activate` | User activated |
| `user.lifecycle.deactivate` | User deactivated (DEPROVISIONED) |
| `user.lifecycle.suspend` | User suspended |
| `user.lifecycle.unsuspend` | User unsuspended |
| `user.authentication.sso` | SSO authentication event |
| `user.session.start` | User session created |
| `user.mfa.factor.activate` | MFA factor enrolled |
| `policy.lifecycle.update` | Policy modified |
| `application.lifecycle.create` | App integration created |
| `group.user_membership.add` | User added to group |

**Fetching System Log via API:**

```bash
GET /api/v1/logs?since=2026-07-01T00:00:00Z&until=2026-07-08T00:00:00Z&limit=1000
Authorization: Bearer {token}
```

For Okta-federated environments, pipe the System Log to Sentinel via the Okta data connector for correlation with Entra sign-in logs.

## Related Skills

- **[users-and-profiles.md](users-and-profiles.md)** — User API detail and profile mapping
- **[groups-and-rules.md](groups-and-rules.md)** — Group API detail
- **[applications-saml-oidc.md](applications-saml-oidc.md)** — App API detail
- **[policies-and-authenticators.md](policies-and-authenticators.md)** — Policy API detail
- **`lib/okta/`** — Client library implementation (Sydnor)
