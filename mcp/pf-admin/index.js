'use strict';

/**
 * @module mcp/pf-admin/index
 * PingFederate Admin API — Phase 1 Read-Only MCP Wrapper Scaffold
 *
 * Exposes 5 read-only tools over the PF Admin REST API.
 * OpenAPI spec is fetched live from the instance at runtime and cached in memory.
 * No write tools in Phase 1.
 *
 * Auth: HTTP Basic (no XSRF header required for GET requests).
 *
 * Usage:
 *   const server = createPfAdminMcpServer({
 *     adminUrl: 'https://pf.corp.example.com:9999',
 *     username: 'Administrator',
 *     password: process.env.PF_ADMIN_PASSWORD,
 *   });
 */

/** In-memory OpenAPI spec cache (per process lifetime). */
let _openApiCache = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the Basic Auth header value for PF admin API.
 * @param {string} username
 * @param {string} password
 * @returns {string}
 */
function buildBasicAuth(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

/**
 * Fetch JSON from a PF admin API path with Basic Auth. Never throws.
 * @param {object} config - { adminUrl, username, password }
 * @param {string} path
 * @returns {Promise<{ok: boolean, status?: number, data?: any, error?: string}>}
 */
async function pfGet(config, path) {
  const url = `${config.adminUrl.replace(/\/+$/, '')}${path}`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: buildBasicAuth(config.username, config.password),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { data = await res.json(); } catch { /* ignore */ }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `PF Admin API returned ${res.status} for ${path}: ${data?.message || 'no detail'}`,
      };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, error: `Network error fetching ${path}: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// OpenAPI spec loader (live fetch, memory cache)
// ---------------------------------------------------------------------------

/**
 * Fetch the PingFederate OpenAPI spec from the live instance.
 * Probes /pf-admin-api/v1/api-docs first, falls back to /pf-admin-api/v1/swagger.json.
 * Caches in memory for the session lifetime.
 *
 * @param {object} config - { adminUrl, username, password }
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function fetchOpenApiSpec(config) {
  if (_openApiCache) {
    return { ok: true, data: _openApiCache };
  }

  const candidates = [
    '/pf-admin-api/v1/api-docs',
    '/pf-admin-api/v1/swagger.json',
  ];

  for (const path of candidates) {
    const result = await pfGet(config, path);
    if (result.ok && result.data) {
      _openApiCache = result.data;
      return { ok: true, data: _openApiCache };
    }
  }

  return {
    ok: false,
    error:
      `Failed to fetch PingFederate OpenAPI spec from ${config.adminUrl}. ` +
      `Tried: ${candidates.join(', ')}. ` +
      `Confirm the adminUrl is correct and the PF Admin API is reachable. ` +
      `Check that your credentials have API access (Administrator role).`,
  };
}

/** Clears the in-memory OpenAPI spec cache (for testing). */
function clearSpecCache() {
  _openApiCache = null;
}

// ---------------------------------------------------------------------------
// MCP Tool implementations
// ---------------------------------------------------------------------------

/**
 * list_sp_connections — Enumerate all SAML SP connections.
 *
 * @param {object} config
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=100]
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function listSpConnections(config, options = {}) {
  const page = options.page || 1;
  const numberPerPage = options.numberPerPage || 100;
  return pfGet(config, `/pf-admin-api/v1/sp/connections?page=${page}&numberPerPage=${numberPerPage}`);
}

/**
 * get_sp_connection — Get full SP connection config.
 *
 * @param {object} config
 * @param {string} connectionId
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function getSpConnection(config, connectionId) {
  if (!connectionId) {
    return { ok: false, error: 'getSpConnection: connectionId is required' };
  }
  return pfGet(config, `/pf-admin-api/v1/sp/connections/${encodeURIComponent(connectionId)}`);
}

/**
 * list_oauth_clients — Enumerate OAuth/OIDC clients.
 *
 * @param {object} config
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.numberPerPage=100]
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function listOauthClients(config, options = {}) {
  const page = options.page || 1;
  const numberPerPage = options.numberPerPage || 100;
  return pfGet(config, `/pf-admin-api/v1/oauth/clients?page=${page}&numberPerPage=${numberPerPage}`);
}

/**
 * get_server_settings — PF global settings.
 *
 * @param {object} config
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function getServerSettings(config) {
  return pfGet(config, '/pf-admin-api/v1/serverSettings');
}

/**
 * list_password_credentials_validators — Credential validators.
 *
 * @param {object} config
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function listPasswordCredentialValidators(config) {
  return pfGet(config, '/pf-admin-api/v1/passwordCredentialValidators');
}

// ---------------------------------------------------------------------------
// Tool registry (MCP-compatible descriptor format)
// ---------------------------------------------------------------------------

const MCP_TOOLS = Object.freeze([
  {
    name: 'list_sp_connections',
    description: 'Enumerate all SAML SP connections in PingFederate. Returns connection IDs, names, entity IDs, and NameID formats for migration assessment.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)', default: 1 },
        numberPerPage: { type: 'integer', description: 'Results per page (max 200)', default: 100 },
      },
    },
    handler: listSpConnections,
  },
  {
    name: 'get_sp_connection',
    description: 'Get full SP connection config for a specific SAML SP. Includes NameID format, attribute contract, and assertion settings critical for migration planning.',
    inputSchema: {
      type: 'object',
      required: ['connectionId'],
      properties: {
        connectionId: { type: 'string', description: 'The SP connection ID (from list_sp_connections)' },
      },
    },
    handler: getSpConnection,
  },
  {
    name: 'list_oauth_clients',
    description: 'Enumerate OAuth/OIDC clients registered in PingFederate. Returns client IDs, names, grant types, and redirect URIs.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Page number (1-based)', default: 1 },
        numberPerPage: { type: 'integer', description: 'Results per page', default: 100 },
      },
    },
    handler: listOauthClients,
  },
  {
    name: 'get_server_settings',
    description: 'Get PingFederate global server settings including version, enabled features, and federation roles. Use for initial discovery and migration readiness assessment.',
    inputSchema: { type: 'object', properties: {} },
    handler: getServerSettings,
  },
  {
    name: 'list_password_credentials_validators',
    description: 'List all Password Credentials Validators configured in PingFederate. Used to assess authentication chain complexity before migration.',
    inputSchema: { type: 'object', properties: {} },
    handler: listPasswordCredentialValidators,
  },
]);

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

/**
 * Creates a PF Admin MCP server instance.
 *
 * @param {object} config
 * @param {string} config.adminUrl      — https://pf.corp.example.com:9999
 * @param {string} config.username
 * @param {string} config.password
 * @returns {{ tools: object[], call: Function, fetchOpenApiSpec: Function }}
 */
function createPfAdminMcpServer(config) {
  if (!config || !config.adminUrl || !config.username || !config.password) {
    throw new Error(
      'createPfAdminMcpServer requires config.adminUrl, config.username, and config.password'
    );
  }

  return {
    /** Tool descriptors (name, description, inputSchema) for MCP registration. */
    tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),

    /**
     * Call a tool by name.
     * @param {string} toolName
     * @param {object} args
     * @returns {Promise<{ok: boolean, data?: any, error?: string}>}
     */
    async call(toolName, args = {}) {
      const tool = MCP_TOOLS.find(t => t.name === toolName);
      if (!tool) {
        return { ok: false, error: `Unknown tool: "${toolName}". Available: ${MCP_TOOLS.map(t => t.name).join(', ')}` };
      }
      return tool.handler(config, args);
    },

    /** Fetch the live OpenAPI spec (cached after first call). */
    fetchOpenApiSpec: () => fetchOpenApiSpec(config),
  };
}

module.exports = {
  createPfAdminMcpServer,
  fetchOpenApiSpec,
  clearSpecCache,
  // Individual tool functions (for direct use without MCP wrapper)
  listSpConnections,
  getSpConnection,
  listOauthClients,
  getServerSettings,
  listPasswordCredentialValidators,
  MCP_TOOLS,
};
