---
title: Ping Identity MCP Servers — Official Integration Guide
category: ping
difficulty: intermediate
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# Ping Identity MCP Servers — Official Integration Guide

## What Exists (and What Doesn't)

Ping Identity publishes **three official MCP server repositories** on GitHub at `github.com/pingidentity/`. All three are Apache-2.0 licensed and all three are in some form of preview or limited scope. Understanding what each one covers — and, critically, what it does NOT cover — is what separates a working setup from wasted days debugging missing tools.

| Server | Repo | Language | Status | Scope |
|---|---|---|---|---|
| `pingone-mcp-server` | [github.com/pingidentity/pingone-mcp-server](https://github.com/pingidentity/pingone-mcp-server) | Go | **PUBLIC PREVIEW — NOT for production** | PingOne cloud: environments, applications (OIDC), populations, directory. Narrow. |
| `aic-mcp-server` | [github.com/pingidentity/aic-mcp-server](https://github.com/pingidentity/aic-mcp-server) | TypeScript (Node.js) | **Sandbox/Dev environments only** | PingOne AIC: 40+ tools — managed objects, themes, auth journeys, logs, ESVs, OIDC apps |
| `cloudflare-mcp` | [github.com/pingidentity/cloudflare-mcp](https://github.com/pingidentity/cloudflare-mcp) | Terraform/infrastructure | Blueprint | PingGateway + Cloudflare security-proxy deployment pattern |

> **There is no official MCP server for PingFederate, PingDirectory, or PingAccess.** For on-prem Ping products, you must build or extend.

---

## Server 1: `pingone-mcp-server` (PingOne Cloud)

### What It Is

The `pingone-mcp-server` is Ping Identity's official Go-based MCP server for the PingOne cloud management APIs. It allows AI assistants to review and manage PingOne tenants from an MCP-compatible client.

**Key characteristics:**
- Written in Go; distributed as a binary (Homebrew tap, or GitHub release download)
- **PUBLIC PREVIEW**: AS IS, no warranties, subject to change without notice, limited support. Do not use against production or mission-critical workloads
- 14 tools across 4 capability areas (as of public preview)
- Auth: OAuth 2.0 Authorization Code + PKCE (local/interactive) or Device Code flow (headless/Docker)
- All actions are user-based and auditable in PingOne

### What It Covers (14 tools, 4 areas)

Per the GitHub README and Ping Identity Developer Blog:

| Capability Area | Coverage |
|---|---|
| **Environments** | Create, update, analyze environment configurations |
| **Applications** | OIDC application management (create, update, analyze) |
| **Populations** | Population management — create, update, analyze |
| **Directory** | User count and basic directory analysis |

**What it does NOT cover (as of public preview):**
- Full user management (no create/update/delete users via MCP tools)
- Group management
- SAML application configuration
- Sign-on policies or DaVinci flow management
- PingID / MFA enrollment data
- Audit logs

This is a narrow tool set. For migration discovery — bulk enumeration of users, groups, app assignments, and policies — use direct PingOne Platform API calls (see `core-api-overview.md` and `pingone-cloud.md`).

### Setup

**Prerequisites:**
- A licensed or trial PingOne subscription
- An MCP-compatible client (Claude Desktop, VS Code + GitHub Copilot, Cursor, etc.)
- A Worker Application configured in your PingOne tenant (see `core-api-overview.md`)

**Install via Homebrew (macOS/Linux):**
```bash
brew tap pingidentity/tap
brew install pingone-mcp-server

# Verify
pingone-mcp-server --version
```

**Windows:** Download the binary from the [GitHub releases page](https://github.com/pingidentity/pingone-mcp-server/releases/latest) and add to PATH.

### Worker Application Setup

The MCP server requires a PingOne Worker Application with Authorization Code + PKCE grant:
1. PingOne Admin Console → Applications → Add Application → Worker
2. Grant type: **Authorization Code with PKCE required**
3. Response type: Code
4. Token endpoint authentication: None
5. Redirect URI: `http://127.0.0.1:7464/callback`
6. Application Roles: None (the server inherits roles from the authenticated user)
7. Capture the **Environment ID** and **Client ID**

### MCP Client Configuration

**Claude Desktop:**
```json
{
  "mcpServers": {
    "pingone-mcp-server": {
      "type": "stdio",
      "command": "pingone-mcp-server",
      "args": ["run"],
      "env": {
        "PINGONE_MCP_ENVIRONMENT_ID": "your-environment-id",
        "PINGONE_AUTHORIZATION_CODE_CLIENT_ID": "your-client-id",
        "PINGONE_ROOT_DOMAIN": "pingone.com"
      }
    }
  }
}
```

Replace `PINGONE_ROOT_DOMAIN` with your region's root domain (`pingone.com`, `pingone.eu`, `pingone.ca`, `pingone.asia`, `pingone.au`).

**VS Code (GitHub Copilot):** Available via the VS Code MCP install button in the GitHub README. Prompts for environment ID, client ID, and root domain as inputs.

### Authentication Flow

1. On first tool use, the server opens a browser to PingOne for OAuth 2.0 PKCE login
2. The user (or admin) authenticates and authorizes the MCP application
3. Token is stored in the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
4. Subsequent tool calls reuse the cached token; re-authentication triggers when the token expires

For headless environments (Docker, CI), configure the **Device Code Flow** grant instead. See the Docker usage instructions in the repo for specifics.

---

## Server 2: `aic-mcp-server` (PingOne Advanced Identity Cloud)

### What It Is

The `aic-mcp-server` is the official TypeScript MCP server for PingOne Advanced Identity Cloud (AIC) — the ForgeRock-lineage cloud product. It is published to npm as `@ping-identity/aic-mcp-server` and has significantly broader tool coverage than the PingOne server.

**Key characteristics:**
- TypeScript / Node.js 18+; install via `npx` (no local install required)
- Apache-2.0 licensed, maintained by Ping Identity
- **Sandbox and Development environments ONLY** — never use against a production tenant
- 40+ tools covering managed objects, themes, auth journeys, logs, ESVs, OIDC apps
- Auth: OAuth 2.0 PKCE (local) or Device Code (Docker/headless)
- All actions are user-based and auditable in AIC
- Requires administrator access to the AIC tenant

### What It Covers (40+ tools)

The full tool surface is documented in the [GitHub README](https://github.com/pingidentity/aic-mcp-server):

**Managed Objects (generic CRUD — all object types)**
- `listManagedObjects` — discover all managed object types (`alpha_user`, `alpha_group`, `bravo_role`, etc.)
- `getManagedObjectSchema` — get schema for any object type
- `queryManagedObjects` — query with filters, pagination, sorting
- `getManagedObject`, `createManagedObject`, `patchManagedObject`, `deleteManagedObject`
- `createManagedObjectDefinition`, `patchManagedObjectDefinition`, `deleteManagedObjectDefinition`
- `patchManagedObjectRelationship` — manage custom relationship properties

**Themes (UI customization)**
- `getThemeSchema`, `getThemes`, `getTheme`, `createTheme`, `updateTheme`, `deleteTheme`, `setDefaultTheme`

**Logs (audit and activity)**
- `getLogSources` — list available log sources
- `queryLogs` — query by time range, source, content filter

**ESVs (Environment Secrets and Variables)**
- `queryESVs`, `getVariable`, `setVariable`, `deleteVariable`

**Features (platform capabilities)**
- `listFeatures`, `validateIdmFeature`, `installIdmFeature`, `enableAiAgent`

**OIDC Applications** (not available in Docker deployment)
- `getOidcAppSchema`, `listOidcApps`, `getOidcApp` — read OIDC app configurations

**Authentication Journeys and Scripts** — journey management, scripted decision node configuration (see README for full tool list)

### Setup

No local installation required. Use `npx`:

```bash
# One-shot invocation test
npx @ping-identity/aic-mcp-server
```

### MCP Client Configuration

**Claude Desktop / Claude Code:**
```json
{
  "mcpServers": {
    "aic-mcp-server": {
      "command": "npx",
      "args": ["-y", "@ping-identity/aic-mcp-server"],
      "env": {
        "AIC_BASE_URL": "your-tenant.forgeblocks.com"
      }
    }
  }
}
```

**VS Code (GitHub Copilot):**
```json
{
  "mcpServers": {
    "aic-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ping-identity/aic-mcp-server"],
      "env": {
        "AIC_BASE_URL": "your-tenant.forgeblocks.com"
      }
    }
  }
}
```

Replace `your-tenant.forgeblocks.com` with your actual AIC tenant URL.

### Authentication Flow

Same PKCE-based flow as the PingOne server:
1. First tool use opens a browser to the AIC tenant for authentication
2. Token stored in OS keychain; reused until expiry

---

## Server 3: `cloudflare-mcp` (Security Proxy Blueprint)

### What It Is — and What It Is NOT

The `cloudflare-mcp` repository is a **deployment blueprint** for standing up a PingGateway-based security proxy in front of Cloudflare. It is **not** an MCP server for administering PingFederate or any Ping on-prem product.

**Do not confuse this with a PingFederate admin MCP server.** It is infrastructure-as-code (Terraform) that deploys:
- A PingGateway instance as a reverse proxy / API gateway
- Cloudflare edge (WAF, DDoS protection, TLS) in front of PingGateway
- Integration patterns for OAuth/OIDC policy enforcement at the gateway layer

**PingGateway** is Ping Identity's lightweight API security proxy — comparable to NGINX + policy enforcement. It is not an IdP, not a user store, and not an admin surface. If PingGateway appears in a customer's architecture, enumerate it to understand what APIs it protects, but it is not a migration source for user data.

### When the Blueprint Is Useful

- Deploying a zero-trust API gateway pattern that uses Entra as the token issuer (post-migration)
- Understanding how to configure PingGateway to validate Entra-issued tokens (issuer URL, JWKS endpoint)
- Modernizing the customer's API security layer while migrating the identity layer to Entra

---

## Adopt / Extend / Build — Decision Framework

For the Ping portfolio, the tooling boundary is:

**Adopt** (use as-is):
- `aic-mcp-server` for sandbox AIC tenant exploration and managed object discovery
- `pingone-mcp-server` for PingOne cloud environment/app/population navigation

**Extend** (adopt + direct API calls):
- PingOne: use `pingone-mcp-server` for what it covers; call the PingOne Platform API directly for users, groups, SAML apps, sign-on policies, and audit logs that the MCP server doesn't yet expose
- PingOne AIC: use `aic-mcp-server` for managed objects and journeys; call the AM REST API directly for SAML federation configurations and session policies not exposed by the MCP tools

**Build** (no official server exists):
- **PingFederate admin API** — No official MCP server exists. Build a thin wrapper around the `/pf-admin-api/v1/` REST API for migration discovery. See `pingfederate-onprem.md` for the endpoints worth wrapping
- **PingDirectory** — No official MCP server exists. Use direct SCIM calls or LDAP tooling for bulk export
- **PingAccess** — No official MCP server exists. Call `/pa-admin-api/v3/` directly to enumerate protected resources and token validation policy

### The Seam Rule

> If it's **cloud PingOne**, use `pingone-mcp-server` for the 4 covered areas; fall back to direct API for everything else.
> If it's **PingOne AIC**, use `aic-mcp-server` for managed objects and journeys; AIC is sandbox-only, so this is exploration-only.
> If it's **on-prem PingFederate, PingDirectory, or PingAccess**, call the admin APIs directly. There is no shortcut.
> Nothing in the Ping MCP ecosystem writes to Entra. All Entra writes go through Microsoft Graph.

---

## Security Notes

All three official Ping MCP servers share the same security posture:

1. **Preview software** — do not use `pingone-mcp-server` against production tenants under any circumstances
2. **Sandbox only** — `aic-mcp-server` is restricted to development/sandbox environments by both the documentation and its own runtime checks
3. **Tenant data exposure** — the servers return tenant configuration and potentially user data. Use only with trusted MCP clients and trusted LLM inference
4. **Audit trail** — all actions are performed as the authenticated user and are auditable in the respective admin consoles. Check logs before and after any session

For on-prem API calls (PingFederate, PingDirectory, PingAccess):
- Create dedicated read-only admin accounts for migration discovery; never use the superuser account
- Store credentials in Azure Key Vault or equivalent — never in environment files, config files, or code
- Restrict admin port (9999 for PF, 9000 for PA) network access to migration tooling only

---

## Relationship to `skills/ping/`

| File | What it documents |
|------|-------------------|
| [`README.md`](README.md) | Portfolio overview, terminology, hybrid deployment patterns |
| [`core-api-overview.md`](core-api-overview.md) | API surface reference for all Ping products |
| [`pingfederate-onprem.md`](pingfederate-onprem.md) | PingFederate admin API deep dive — the BUILD target |
| [`pingone-cloud.md`](pingone-cloud.md) | PingOne cloud object model — the ADOPT target |
