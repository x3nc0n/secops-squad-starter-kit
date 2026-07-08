'use strict';

/**
 * @module lib/ping/detect
 * Deployment detection for Ping Identity surfaces.
 *
 * Probes a target configuration using native fetch (Node 18+) and returns a
 * deployment descriptor. Non-throwing — returns {ok: false} on network/probe errors.
 * Parallel probes where independent (PingOne OIDC and PF admin API are independent).
 *
 * @example
 * const { detectDeployment } = require('./detect');
 * const result = await detectDeployment({ baseUrl: 'https://acme.pingone.com' });
 * if (result.ok) console.log(result.data.deploymentType); // 'cloud'
 */

/**
 * Known domain patterns for high-confidence deployment detection.
 * Keys map to deployment types; values are suffix-match patterns.
 */
const KNOWN_DOMAINS = Object.freeze({
  PINGONE_CLOUD: '.pingone.com',
  PINGONE_EU: '.pingone.eu',
  PINGONE_CA: '.pingone.ca',
  PINGONE_ASIA: '.pingone.asia',
  PINGONE_AU: '.pingone.au',
  AIC_FORGEBLOCKS: '.forgeblocks.com',
  AIC_ID_FORGEROCK: '.id.forgerock.io',
});

/** Default probe timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the hostname from a URL string. Returns null on parse failure.
 * @param {string} url
 * @returns {string|null}
 */
function extractHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true if the hostname matches any of the known Ping Identity cloud domains.
 * @param {string} hostname
 * @returns {{ matched: boolean, product: string|null }}
 */
function matchKnownDomain(hostname) {
  if (!hostname) return { matched: false, product: null };
  for (const [key, suffix] of Object.entries(KNOWN_DOMAINS)) {
    if (hostname.endsWith(suffix) || hostname === suffix.slice(1)) {
      if (key.startsWith('AIC')) return { matched: true, product: 'aic' };
      return { matched: true, product: 'pingone' };
    }
  }
  return { matched: false, product: null };
}

/**
 * Performs a single probe fetch with a timeout. Never throws.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ok: boolean, status?: number, body?: any, error?: string}>}
 */
async function probe(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timer);

    let body = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { body = await res.json(); } catch { /* ignore parse errors */ }
    }
    return { ok: true, status: res.status, body };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { ok: false, error: `probe timeout after ${timeoutMs}ms: ${url}` };
    }
    return { ok: false, error: `probe error: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Detection signals
// ---------------------------------------------------------------------------

/**
 * Probe the OIDC discovery endpoint to determine the identity product.
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<{product: string|null, version: string|null, raw: any}>}
 */
async function probeOidc(baseUrl, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  const result = await probe(url, timeoutMs);
  if (!result.ok || result.status !== 200 || !result.body) {
    return { product: null, version: null, raw: result };
  }

  const issuer = (result.body.issuer || '').toLowerCase();
  if (issuer.includes('pingone.com') || issuer.includes('pingone.eu') ||
      issuer.includes('pingone.ca') || issuer.includes('pingone.asia') ||
      issuer.includes('pingone.au')) {
    return { product: 'pingone', version: null, raw: result.body };
  }
  if (issuer.includes('forgeblocks.com') || issuer.includes('forgerock.io')) {
    return { product: 'aic', version: null, raw: result.body };
  }
  if (issuer.includes('/pf/')) {
    return { product: 'pingfederate', version: null, raw: result.body };
  }

  return { product: null, version: null, raw: result.body };
}

/**
 * Probe the PingFederate admin API version endpoint.
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<{reachable: boolean, version: string|null, raw: any}>}
 */
async function probePingFederate(baseUrl, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}/pf-admin-api/v1/version`;
  const result = await probe(url, timeoutMs);
  // 200 = confirmed; 401 = auth required but service is there
  const reachable = result.ok && (result.status === 200 || result.status === 401);
  const version = reachable && result.body ? (result.body.version || null) : null;
  return { reachable, version, raw: result };
}

/**
 * Probe the PingAccess admin API version endpoint.
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<{reachable: boolean, version: string|null}>}
 */
async function probePingAccess(baseUrl, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}/pa-admin-api/v3/version`;
  const result = await probe(url, timeoutMs);
  const reachable = result.ok && (result.status === 200 || result.status === 401);
  const version = reachable && result.body ? (result.body.version || null) : null;
  return { reachable, version };
}

/**
 * Probe the PingDirectory SCIM ServiceProviderConfig endpoint.
 * @param {string} baseUrl
 * @param {number} timeoutMs
 * @returns {Promise<{reachable: boolean}>}
 */
async function probePingDirectory(baseUrl, timeoutMs) {
  const url = `${baseUrl.replace(/\/+$/, '')}/scim/v2/ServiceProviderConfig`;
  const result = await probe(url, timeoutMs);
  const reachable = result.ok && result.status === 200;
  return { reachable };
}

// ---------------------------------------------------------------------------
// Main API
// ---------------------------------------------------------------------------

/**
 * @typedef {object} DetectionResult
 * @property {'cloud'|'onprem'|'hybrid'|'aic'|'unknown'} deploymentType
 * @property {string[]} confirmedSurfaces  — e.g. ['pingone_cloud', 'pingfederate', 'pingaccess']
 * @property {object}   signals            — raw probe results for auditing
 * @property {string}   [product]          — 'pingone' | 'pingfederate' | 'pingaccess' | 'pingdirectory' | 'aic'
 * @property {string}   [version]          — detected version string if available
 */

/**
 * Probes a target configuration and returns a deployment descriptor.
 * Non-throwing — returns {ok: false} on network/probe errors.
 *
 * @param {object} config
 * @param {string} [config.baseUrl]         — primary URL to probe
 * @param {string} [config.oidcIssuerUrl]   — optional explicit OIDC discovery URL
 * @param {object} [options]
 * @param {number} [options.timeoutMs=3000] — probe timeout per request
 * @returns {Promise<{ok: true, data: DetectionResult} | {ok: false, error: string}>}
 */
async function detectDeployment(config, options = {}) {
  try {
    if (!config || typeof config !== 'object') {
      return { ok: false, error: 'detectDeployment: config object is required' };
    }

    const baseUrl = config.baseUrl || '';
    const oidcUrl = config.oidcIssuerUrl || baseUrl;
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

    const confirmedSurfaces = [];
    const signals = {};
    let product = null;
    let version = null;

    // High-confidence: domain pattern matching (no network required)
    const hostname = extractHostname(baseUrl);
    const domainMatch = matchKnownDomain(hostname);
    signals.domainMatch = { hostname, ...domainMatch };

    if (domainMatch.matched) {
      if (domainMatch.product === 'pingone') {
        confirmedSurfaces.push('pingone_cloud');
        product = 'pingone';
      } else if (domainMatch.product === 'aic') {
        confirmedSurfaces.push('aic');
        product = 'aic';
      }
    }

    // Run network probes in parallel where independent
    const probePromises = [];

    // OIDC discovery — runs for all URLs
    if (oidcUrl) {
      probePromises.push(
        probeOidc(oidcUrl, timeoutMs).then(r => { signals.oidc = r; return { type: 'oidc', result: r }; })
      );
    }

    // PingFederate admin API probe — only if not already confirmed as cloud/AIC
    if (baseUrl && !domainMatch.matched) {
      probePromises.push(
        probePingFederate(baseUrl, timeoutMs).then(r => { signals.pingfederate = r; return { type: 'pf', result: r }; })
      );
      probePromises.push(
        probePingAccess(baseUrl, timeoutMs).then(r => { signals.pingaccess = r; return { type: 'pa', result: r }; })
      );
      probePromises.push(
        probePingDirectory(baseUrl, timeoutMs).then(r => { signals.pingdirectory = r; return { type: 'pd', result: r }; })
      );
    }

    const results = await Promise.all(probePromises);

    // Evaluate OIDC probe
    const oidcResult = results.find(r => r.type === 'oidc');
    if (oidcResult && oidcResult.result.product) {
      const op = oidcResult.result.product;
      if (op === 'pingone' && !confirmedSurfaces.includes('pingone_cloud')) {
        confirmedSurfaces.push('pingone_cloud');
        product = product || 'pingone';
      } else if (op === 'aic' && !confirmedSurfaces.includes('aic')) {
        confirmedSurfaces.push('aic');
        product = product || 'aic';
      } else if (op === 'pingfederate' && !confirmedSurfaces.includes('pingfederate')) {
        confirmedSurfaces.push('pingfederate');
        product = product || 'pingfederate';
      }
    }

    // Evaluate on-prem probes
    const pfResult = results.find(r => r.type === 'pf');
    if (pfResult && pfResult.result.reachable) {
      if (!confirmedSurfaces.includes('pingfederate')) confirmedSurfaces.push('pingfederate');
      product = product || 'pingfederate';
      version = version || pfResult.result.version;
    }

    const paResult = results.find(r => r.type === 'pa');
    if (paResult && paResult.result.reachable) {
      if (!confirmedSurfaces.includes('pingaccess')) confirmedSurfaces.push('pingaccess');
    }

    const pdResult = results.find(r => r.type === 'pd');
    if (pdResult && pdResult.result.reachable) {
      if (!confirmedSurfaces.includes('pingdirectory')) confirmedSurfaces.push('pingdirectory');
    }

    // Determine deploymentType from confirmed surfaces
    const hasCloud = confirmedSurfaces.includes('pingone_cloud') || confirmedSurfaces.includes('aic');
    const hasOnprem = confirmedSurfaces.some(s => ['pingfederate', 'pingdirectory', 'pingaccess'].includes(s));

    let deploymentType;
    if (confirmedSurfaces.includes('aic') && !hasOnprem) {
      deploymentType = 'aic';
    } else if (hasCloud && hasOnprem) {
      deploymentType = 'hybrid';
    } else if (hasCloud) {
      deploymentType = 'cloud';
    } else if (hasOnprem) {
      deploymentType = 'onprem';
    } else {
      deploymentType = 'unknown';
    }

    /** @type {DetectionResult} */
    const data = { deploymentType, confirmedSurfaces, signals };
    if (product) data.product = product;
    if (version) data.version = version;

    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: `detectDeployment: unexpected error — ${err.message}` };
  }
}

module.exports = {
  detectDeployment,
  KNOWN_DOMAINS,
  DEFAULT_TIMEOUT_MS,
  // Exported for testing
  _internal: { probe, probeOidc, probePingFederate, probePingAccess, probePingDirectory, matchKnownDomain },
};
