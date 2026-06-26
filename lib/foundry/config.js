'use strict';

/**
 * @module lib/foundry/config
 * Loads and validates .secops/foundry.yaml. No external dependencies beyond js-yaml.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const SUPPORTED_SCHEMA_VERSIONS = ['1.0'];

// Provider-specific path prefixes that must NOT be baked into the base endpoint URL.
// If detected, we strip and warn so resolveEndpoint() can compose the right URL.
const ENDPOINT_PATH_PREFIXES = ['/anthropic', '/openai'];

/**
 * Safely read and parse a YAML file. Returns null on any failure.
 * Matches the readYaml() pattern from cli/secops-config.js.
 *
 * @param {string} filePath
 * @returns {object|null}
 */
function readYaml(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content) || null;
  } catch {
    return null;
  }
}

/**
 * Strip any provider-specific path suffix baked into an endpoint base URL.
 * Emits console.warn if normalization is performed.
 *
 * @param {string} endpoint
 * @returns {string} normalized base URL (no trailing slash)
 */
function normalizeEndpoint(endpoint) {
  if (typeof endpoint !== 'string') return endpoint;
  let normalized = endpoint.trim().replace(/\/+$/, '');
  for (const prefix of ENDPOINT_PATH_PREFIXES) {
    const idx = normalized.indexOf(prefix);
    if (idx !== -1) {
      const stripped = normalized.slice(0, idx);
      console.warn(
        `[foundry/config] endpoint "${normalized}" has a provider path baked in. ` +
          `Normalizing to base URL: "${stripped}". ` +
          `Set endpoint to the base URL only; use api_path per deployment for routing.`
      );
      return stripped;
    }
  }
  return normalized;
}

/**
 * loadFoundryConfig() is the fail-closed gate for endpoint presence.
 * resolveEndpoint() keeps a defensive guard for malformed direct calls.
 *
 * @param {unknown} endpoint
 * @returns {boolean}
 */
function hasUsableEndpoint(endpoint) {
  return typeof endpoint === 'string' && endpoint.trim().length > 0;
}

/**
 * Load and validate .secops/foundry.yaml from rootDir.
 *
 * Returns the parsed config object (with normalized endpoint), or null if any
 * of the following are true:
 *   - File is missing
 *   - YAML is malformed
 *   - foundry.enabled !== true
 *   - foundry.active_model is absent or empty
 *   - No model_deployments entry with matching model_id and status === "active"
 *   - foundry.endpoint is absent, empty, whitespace, or normalizes to empty
 *
 * NEVER throws — all errors return null.
 *
 * @param {string} [rootDir] - Project root (defaults to process.cwd())
 * @returns {object|null} Parsed config or null
 */
function loadFoundryConfig(rootDir) {
  try {
    const dir = rootDir || process.cwd();
    const configPath = path.join(dir, '.secops', 'foundry.yaml');

    const data = readYaml(configPath);
    if (!data || typeof data !== 'object') return null;

    const foundry = data.foundry;
    if (!foundry || typeof foundry !== 'object') return null;

    // Must be explicitly enabled
    if (foundry.enabled !== true) return null;

    // Must have a non-empty active_model
    if (!foundry.active_model || typeof foundry.active_model !== 'string') return null;

    // Must have at least one deployment matching active_model with status === "active"
    const deployments = Array.isArray(foundry.model_deployments) ? foundry.model_deployments : [];
    const activeDeployment = deployments.find(
      (d) => d && d.model_id === foundry.active_model && d.status === 'active'
    );
    if (!activeDeployment) return null;

    // Fail-closed gate: Foundry is unavailable without a usable base endpoint.
    if (!hasUsableEndpoint(foundry.endpoint)) return null;

    // Normalize endpoint (strip baked-in provider paths, warn), then re-check.
    foundry.endpoint = normalizeEndpoint(foundry.endpoint);
    if (!hasUsableEndpoint(foundry.endpoint)) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Resolve the full request URL for a given deployment.
 *
 * Routing rules:
 *   provider: "anthropic"           → {endpoint}{api_path}
 *   provider: "openai"              → {endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}
 *   provider: "openai-reasoning"    → same as "openai"
 *
 * Handles trailing-slash deduplication on the base endpoint.
 *
 * @param {object} config     - Parsed config object from loadFoundryConfig() (the full data object)
 * @param {object} deployment - A model_deployments entry from config.foundry.model_deployments
 * @returns {string} Full request URL
 */
function resolveEndpoint(config, deployment) {
  const foundry = config && config.foundry;
  if (!foundry || typeof foundry !== 'object' || !hasUsableEndpoint(foundry.endpoint)) {
    throw new Error(
      'Foundry endpoint is missing or empty. loadFoundryConfig() is the fail-closed gate; ' +
        'resolveEndpoint() requires a config with foundry.endpoint.'
    );
  }
  const base = normalizeEndpoint(foundry.endpoint);
  const provider = deployment.provider || 'openai';

  if (provider === 'anthropic') {
    // api_path e.g. "/anthropic/v1/messages"
    const apiPath = deployment.api_path || '/anthropic/v1/messages';
    return `${base}${apiPath}`;
  }

  // openai or openai-reasoning
  const deploymentName = deployment.deployment_name;
  const apiVersion = foundry.api_version || '2025-04-01-preview';
  return `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
}

module.exports = {
  loadFoundryConfig,
  resolveEndpoint,
  // exported for testing
  normalizeEndpoint,
};
