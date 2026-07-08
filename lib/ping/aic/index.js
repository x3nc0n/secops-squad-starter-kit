'use strict';

/**
 * @module aic/index
 * PingOne Advanced Identity Cloud (AIC) — thin client stub.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ARCHITECTURE NOTE
 * ════════════════════════════════════════════════════════════════════════════
 * AIC (formerly ForgeRock Identity Cloud) has a full-featured official MCP
 * server: @ping-identity/aic-mcp-server (40+ tools). For interactive admin
 * and dev/sandbox operations, route all AIC work through that MCP server.
 *
 * This module exists for two purposes:
 *   1. Document the AIC surface contract so migration tooling can reference it.
 *   2. Provide a thin createAicClient() for any direct-API reads needed by
 *      migration workflows (e.g., bulk user export from production AIC tenants).
 *
 * Per spec Open Question #4: if the operator has an AIC production tenant,
 * a direct client IS needed because aic-mcp-server is documented as
 * sandbox/dev only (Ping's own warning). In that case, expand this module
 * to mirror the lib/ping/cloud/ pattern with resource-specific modules.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * AIC API SURFACE CONTRACT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Tenant URL format:  https://{tenant}.forgeblocks.com
 * AM (Access Management) base:  {tenantUrl}/am
 * IDM (Identity Management) base: {tenantUrl}/openidm
 *
 * Authentication:
 *   AIC uses OAuth2 / OIDC for API access. The access token (Bearer) is
 *   obtained out-of-band (service account or admin session) and passed in.
 *   Token endpoint: {tenantUrl}/am/oauth2/access_token (client_credentials
 *   or auth-code flow depending on service account type).
 *
 * Key read endpoints (for migration inventory):
 *   Users:   GET {tenantUrl}/openidm/managed/alpha_user?_queryFilter=true
 *   Groups:  GET {tenantUrl}/openidm/managed/alpha_group?_queryFilter=true
 *   Apps:    GET {tenantUrl}/am/realm-config/agents/OAuth2Client (OIDC)
 *            GET {tenantUrl}/am/saml2/jsp/exportmetadata.jsp?entityid=... (SAML)
 *   Realms:  GET {tenantUrl}/am/json/realms/root/realms
 *
 * Pagination: AIC IDM uses _pageSize and _pagedResultsCookie for cursor-based
 * pagination. AM endpoints may use different conventions.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * OPEN QUESTION (spec Q#4): Production AIC Tenant Direct API
 * ════════════════════════════════════════════════════════════════════════════
 * If the operator's AIC deployment is production-tier (not sandbox/dev),
 * the aic-mcp-server README warning precludes its use for bulk migration reads.
 * Expand this module with resource-specific functions (users, groups, apps)
 * following the lib/ping/cloud/ pattern before running Phase 1 discovery
 * against a production AIC tenant.
 *
 * @see https://github.com/pingidentity/aic-mcp-server
 * @see https://backstage.forgerock.com/docs/idcloud/latest/developer-guides/
 */

/**
 * Create a thin AIC client for direct API reads.
 * Heavy AIC operations use aic-mcp-server instead.
 *
 * @param {object} config
 * @param {string} config.baseUrl      — https://{tenant}.forgeblocks.com
 * @param {string} config.accessToken  — Pre-obtained Bearer token
 * @returns {{baseUrl: string, getAuthHeader: () => Promise<string>, amUrl: string, idmUrl: string}}
 */
function createAicClient(config) {
  if (!config) throw new Error('AIC config is required');
  if (!config.baseUrl) throw new Error('config.baseUrl is required (e.g. https://{tenant}.forgeblocks.com)');
  if (!config.accessToken) throw new Error('config.accessToken is required — obtain via AIC OAuth2 flow');

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const token = config.accessToken;

  return {
    baseUrl,
    amUrl: `${baseUrl}/am`,
    idmUrl: `${baseUrl}/openidm`,

    /** Resolves to "Bearer <token>" — sync for now; extend for auto-refresh. */
    getAuthHeader: async () => `Bearer ${token}`,
  };
}

module.exports = {
  createAicClient,
};
