---
title: Okta MCP Server — Official Integration Guide
category: okta
difficulty: intermediate
mitre_attack:
  - T1078   # Valid Accounts (identity management context)
  - T1087   # Account Discovery
  - T1069   # Permission Groups Discovery
products:
  - Okta Workforce Identity Cloud
  - Okta Customer Identity Cloud
  - Microsoft Entra ID (migration target)
author: Kima
version: 2.0.0
last_updated: 2026-07-08
---

# Okta MCP Server — Official Integration Guide

## What It Is

The [Okta MCP Server](https://github.com/okta/okta-mcp-server) is Okta's official, open-source Model Context Protocol server. It is **generally available**, maintained by Okta, and built on Okta's [Python SDK v3.4.1](https://github.com/okta/okta-sdk-python). It exposes Okta's Admin Management APIs to LLM agents via the MCP protocol, enabling natural-language-driven identity administration.

> This is NOT a homegrown server. Do not build a custom Okta MCP implementation — adopt this one. Our `lib/okta` module is the migration-specific read/export/reconcile complement, not a replacement.

**Key characteristics:**
- Python + [`uv`](https://docs.astral.sh/uv/) package manager (Python 3.9+)
- Docker-first deployment; also runs bare-metal with `uv`
- Performs **full CRUD writes** — this is the Okta-side write path
- Destructive operations (deactivations, deletes) use **MCP Elicitation** to prompt the user for confirmation before executing
- **Scope-based tool loading** — tools are silently removed at startup if the configured OAuth scopes don't grant the required permission; you only see what you're allowed to do

---

## Setup

### Clone and Install (bare-metal with uv)

```bash
git clone https://github.com/okta/okta-mcp-server.git
cd okta-mcp-server
uv sync
```

### Docker (recommended for production and CI)

```bash
git clone https://github.com/okta/okta-mcp-server.git
cd okta-mcp-server
cp .env.example .env
# Edit .env with your Okta credentials
docker compose up --build
```

---

## Authentication

The server supports two auth modes. Choose based on whether a human is present.

### Option A: Device Authorization Grant (interactive, local dev)

Best for: local development, ad-hoc admin sessions, quick queries where a human is at the keyboard.

**Setup in Okta Admin Console:**
1. Applications → Create App Integration
2. Sign-in method: **OIDC – OpenID Connect**; app type: **Native Application**
3. Enable **Device Authorization** grant type
4. Grant the OAuth scopes you need (e.g., `okta.users.read`, `okta.groups.manage`)
5. Copy the Client ID

**Environment variables:**
```bash
OKTA_ORG_URL=https://your-org.okta.com
OKTA_CLIENT_ID=0oaYourClientId
OKTA_SCOPES=okta.users.read okta.groups.read okta.apps.read
# No private key — browser flow will handle auth
```

When the server starts, it outputs a browser URL. Open it, log in with an admin account, and the server receives the token. Token is cached in the system keyring between sessions.

### Option B: Private Key JWT (headless, CI/CD, production)

Best for: automated pipelines, scheduled migration jobs, containerized agent deployments — any context without a human present.

**Setup in Okta Admin Console:**
1. Applications → Create App Integration
2. Sign-in method: **API Services** (not OIDC Native)
3. Client Authentication: **Public Key / Private Key**
4. Generate or upload a public/private key pair; copy the Key ID
5. Grant admin API scopes

**Environment variables:**
```bash
OKTA_ORG_URL=https://your-org.okta.com
OKTA_CLIENT_ID=0oaYourClientId
OKTA_SCOPES=okta.users.read okta.groups.read okta.apps.read okta.policies.read
OKTA_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
OKTA_KEY_ID=your-key-id
```

> **Private key handling:** Store the private key in a secrets manager (Azure Key Vault, HashiCorp Vault, GitHub Actions Secrets). Never commit it to source. Pass it via environment variable at runtime.

---

## MCP Client Configuration

### Claude Desktop (Private Key JWT — recommended)

```json
{
  "mcpServers": {
    "okta-mcp-server": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "OKTA_ORG_URL",
        "-e", "OKTA_CLIENT_ID",
        "-e", "OKTA_SCOPES",
        "-e", "OKTA_PRIVATE_KEY",
        "-e", "OKTA_KEY_ID",
        "okta-mcp-server"
      ],
      "env": {
        "OKTA_ORG_URL": "https://your-org.okta.com",
        "OKTA_CLIENT_ID": "your-client-id",
        "OKTA_SCOPES": "okta.users.read okta.groups.manage okta.apps.read okta.policies.read okta.logs.read",
        "OKTA_PRIVATE_KEY": "${OKTA_PRIVATE_KEY}",
        "OKTA_KEY_ID": "your-key-id"
      }
    }
  }
}
```

### VS Code (bare-metal, Device Auth Grant)

```json
{
  "mcp": {
    "servers": {
      "okta-mcp-server": {
        "command": "uv",
        "args": ["run", "python", "-m", "okta_mcp_server"],
        "cwd": "/path/to/okta-mcp-server",
        "env": {
          "OKTA_ORG_URL": "https://your-org.okta.com",
          "OKTA_CLIENT_ID": "your-client-id",
          "OKTA_SCOPES": "okta.users.read okta.groups.read"
        }
      }
    }
  }
}
```

---

## Tool Surface

The server exposes tools across five functional domains. Which tools are active depends on the `OKTA_SCOPES` configured — tools without a matching scope are silently removed at startup.

### User Management
Scope required: `okta.users.read` (read), `okta.users.manage` (write)

- Create, list, retrieve, update users
- Deactivate users (elicitation-confirmed)
- Delete users (elicitation-confirmed — destructive, irreversible)
- Query users by filter, profile attribute search, or startsWith

### Group Management
Scope required: `okta.groups.read` (read), `okta.groups.manage` (write)

- Create, list, retrieve, update, delete groups
- View group members and assigned applications
- Add and remove users from groups

### Application Management
Scope required: `okta.apps.read` (read), `okta.apps.manage` (write)

- List and retrieve applications
- View SAML 2.0 and OIDC configuration
- View app user and group assignments
- Application lifecycle operations

### Policy Management
Scope required: `okta.policies.read` (read), `okta.policies.manage` (write)

- List and retrieve policies (sign-on, MFA enrollment, password, access, profile enrollment)
- View policy rules
- Create, update, and delete policies and rules
- Device assurance policies, brands, themes, custom pages, email templates

### System Logs
Scope required: `okta.logs.read`

- Retrieve Okta System Log events
- Filter by event type, actor, target, date range
- Supports the full Okta log query syntax

---

## Secure Credential Handling

The official server follows least-privilege by design:

1. **Scope-based tool loading** — only grant the scopes you actually need for a session. Read-only analysis: grant only `*.read` scopes. Provisioning: add `okta.users.manage` for that session only.

2. **Elicitation for destructive ops** — deactivations and deletes require explicit MCP Elicitation confirmation. Clients that don't yet support Elicitation fall back gracefully (the operation is held until confirmed through an alternative confirmation mechanism).

3. **Environment variables only** — credentials are never in config files or code. Use a secrets manager for the private key.

4. **Audit trail** — all operations are logged in Okta's System Log under the authenticating principal (the API Services app or the user who completed Device Auth). Query `okta.logs.read` to audit what the agent has done.

**Recommended scope set for a migration engagement:**
```
okta.users.read
okta.groups.read
okta.apps.read
okta.policies.read
okta.logs.read
```

Add `*.manage` scopes only for sessions where you intend to make changes, and only for the specific resource types you need to modify.

---

## When to Use the Official MCP vs `lib/okta` vs Microsoft Graph

This is the core tooling-boundary question for a migration engagement. Read it carefully.

| Task | Use This |
|------|----------|
| **Interactive Okta admin** — add a user to a group, deactivate a stale account, pull a system log report, change a policy rule | **Official Okta MCP Server** |
| **Bulk Okta export** — paginate all 50,000 users with all profile attributes, export all group rules, extract all app SAML configs in one structured run | **`lib/okta`** |
| **Migration reconciliation** — diff Okta user state vs Entra state, identify gaps, track migration-state per object | **`lib/okta`** |
| **Dry-run diff** — compute what Graph calls *would* be made before any live execution | **`lib/okta` + gate.js** |
| **Write to Entra** — provision users, create groups, register apps, deploy CA policies | **Microsoft Graph** (`lib/graph-security` or equivalent) |
| **Entra admin** — interactive queries, report pulls, policy checks on the Entra side | **Microsoft Graph or Entra MCP (if available)** |

### The Rule of Thumb

> If it's **interactive and one-off on the Okta side**, use the official MCP server.
> If it's **bulk, deterministic, idempotent, or stateful** for migration purposes, use `lib/okta`.
> If it **touches Entra**, use Microsoft Graph. Nothing else writes to Entra.

The official Okta MCP server has **zero visibility into Entra** and `lib/okta` has **zero write capability on Okta**. These are intentional seam rules. The MCP server owns Okta writes; Graph owns Entra writes; `lib/okta` owns Okta reads.

### The `per_class_ownership` Gate

The operator's declared `per_class_ownership` in `.secops/identity/okta.yaml` governs what the official MCP server is permitted to write. When Sydnor's `lib/okta/gate.js` is used in a workflow that also invokes the MCP server, it will refuse to route a write request to the MCP server for a class not declared as `okta`-owned.

Example: If `groups: entra` is declared (meaning Entra is the authoritative group writer for this phase), the gate will block the MCP server from creating new Okta groups, even though the server is technically capable of doing so.

---

## Migration Workflow Integration

This server plugs into the migration workflow at the **Okta-side operations layer**:

```
lib/okta (bulk read/export)
   ↓ structured data
Migration reconcile + diff (lib/okta gate.js)
   ↓ diff plan (dry_run: true)
Human review
   ↓ approved
Okta MCP Server (one-off Okta writes, if needed for pre-migration cleanup)
   ↓ parallel
Microsoft Graph (Entra provisioning)
   ↓
Validation pass (both sides)
```

Example pre-migration cleanup tasks routed to the Okta MCP server:
- Deactivating stale/inactive Okta users before exporting the active population to Entra
- Removing orphaned app assignments before group rationalization
- Pulling a System Log audit of admin actions over the past 90 days before declaring a baseline

---

## Relationship to `skills/okta/`

The rest of `skills/okta/` documents the Okta object model and migration mappings:

| File | What it covers |
|------|---------------|
| [`README.md`](README.md) | Domain overview, two-mode framing |
| [`core-api-overview.md`](core-api-overview.md) | Okta API structure, auth, rate limits |
| [`users-and-profiles.md`](users-and-profiles.md) | User lifecycle, profile schema |
| [`groups-and-rules.md`](groups-and-rules.md) | Group types, dynamic rules, BUILT_IN gotchas |
| [`applications-saml-oidc.md`](applications-saml-oidc.md) | App sign-on modes, SAML/OIDC config |
| [`policies-and-authenticators.md`](policies-and-authenticators.md) | Sign-on policies, MFA enrollment, authenticators |
| [`okta-to-entra-migration-map.md`](okta-to-entra-migration-map.md) | Full Okta → Entra object mapping with quality tiers and gotchas |
| [`decisions/`](decisions/README.md) | Operator decision harness — walks through every migration choice |

---

## Where Okta → Entra Doesn't Map 1:1

Before planning any write operations with this server, read the migration map for the object type you're working with. Key gaps that affect what you'd route through this server:

- **MFA factors are not portable** — the MCP server can query enrollment status (`okta.users.read`), but there is no migration path; users must re-enroll in Entra ([Decision 06](decisions/06-mfa-strategy.md))
- **Okta sign-on policy evaluation is first-match-wins** — Entra CA is most-restrictive; policy cleanup via the MCP server before cutover helps prevent unexpected Entra blocks
- **SWA apps have no Entra equivalent** — the MCP server can inventory them but they cannot be migrated; they stay in Okta or require SP-side SAML/OIDC work
- **FIDO2 keys are RP-bound** — even if you query key enrollment via the MCP server, the keys cannot be re-registered to a different RP; users re-register their security key in Entra from scratch

Full mapping details: [`okta-to-entra-migration-map.md`](okta-to-entra-migration-map.md)
