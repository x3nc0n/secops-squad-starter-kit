# PingFederate Admin API — MCP Wrapper (Phase 1 Read-Only Scaffold)

This is a **Phase 1 read-only scaffold** for a Model Context Protocol (MCP) wrapper around the PingFederate Admin REST API.

## Phase 1 Scope

Five read-only tools:

| Tool | Description |
|---|---|
| `list_sp_connections` | Enumerate all SAML SP connections |
| `get_sp_connection` | Get full SP connection config (NameID format, attribute mapping) |
| `list_oauth_clients` | Enumerate OAuth/OIDC clients |
| `get_server_settings` | PF global settings (version, features enabled) |
| `list_password_credentials_validators` | Credential validators (for migration assessment) |

**No write tools in Phase 1.** All tools return read-only inventory.

## OpenAPI Strategy

This wrapper does NOT vendor a static PingFederate OpenAPI spec — PF versions differ per customer deployment (11.x vs 12.x etc.). At runtime the wrapper:

1. Fetches `/pf-admin-api/v1/api-docs` from the configured `adminUrl`
2. Falls back to `/pf-admin-api/v1/swagger.json` if the first path returns non-200
3. Caches the parsed spec in memory for the session lifetime
4. Returns `{ok: false, error: '...'}` with clear guidance if neither path is reachable

## Auth

PingFederate Admin API uses **HTTP Basic Auth** (`Authorization: Basic base64(username:password)`).
Non-GET requests also require the `X-XSRF-Header: PingFederate` header (not required for reads).

## Configuration

Set environment variables:
```
PF_ADMIN_URL=https://pf.corp.example.com:9999
PF_ADMIN_USERNAME=Administrator
PF_ADMIN_PASSWORD=<password>
```

Or pass config to `createPfAdminMcpServer()`:
```js
const server = createPfAdminMcpServer({
  adminUrl: 'https://pf.corp.example.com:9999',
  username: 'Administrator',
  password: process.env.PF_ADMIN_PASSWORD,
});
```

## Phase 2 Extension

Phase 2 will add write tools after SP connection migration gates are in place. Write tools will require explicit `assertEntraOwned()` gate checks (from `lib/ping/gate.js`) before any mutation.

## Relationship to lib/ping/

This MCP wrapper is a thin transport layer over `lib/ping/onprem/pingfederate.js`. The library module provides the actual API logic; this wrapper exposes it as MCP tools for use with AI agents.
