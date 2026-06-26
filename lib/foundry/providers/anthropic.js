'use strict';

/**
 * @module lib/foundry/providers/anthropic
 * Azure AI Foundry Anthropic Messages REST client.
 *
 * Auth choice: callers may pass apiKey (or authType: 'api-key') to emit
 * x-api-key. Otherwise token is treated as an Entra bearer token from auth.js.
 */

const DEFAULT_TIMEOUT_MS = 60000;
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Calls an Anthropic Messages-compatible deployment through Azure AI Foundry.
 *
 * @param {object} opts
 * @param {string} opts.endpoint Full request URL, usually resolveEndpoint(config, deployment).
 * @param {string} [opts.apiVersion] Anthropic API version header override.
 * @param {string|{token:string,isApiKey?:boolean,type?:string}} [opts.token] Bearer token or API key token object.
 * @param {string} [opts.apiKey] Explicit API key; preferred over token for API-key auth.
 * @param {'bearer'|'api-key'} [opts.authType] Force token interpretation.
 * @param {object} opts.deployment Active Foundry deployment config entry.
 * @param {object} opts.payload Anthropic Messages API payload.
 * @param {Function} [opts.fetchFn] Injectable fetch implementation; defaults to global fetch.
 * @param {number} [opts.timeoutMs=60000] Request timeout in milliseconds.
 * @returns {Promise<{ok:true,status:number,data:any,usage:object}|{ok:false,status:number,error:string}>}
 */
async function callAnthropic({
  endpoint,
  apiVersion,
  token,
  apiKey,
  authType,
  deployment = {},
  payload = {},
  fetchFn = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  try {
    if (typeof fetchFn !== 'function') {
      return { ok: false, status: 0, error: 'Fetch is unavailable; Node 18+ is required' };
    }

    const headers = buildHeaders({ token, apiKey, authType, deployment, apiVersion });
    const body = buildAnthropicPayload(deployment, payload);
    const res = await fetchWithTimeout(
      fetchFn,
      endpoint,
      { method: 'POST', headers, body: JSON.stringify(body) },
      timeoutMs
    );

    const data = await readResponseData(res);
    const status = typeof res.status === 'number' ? res.status : 0;
    if (!res.ok) {
      return { ok: false, status, error: normalizeError(status, data) };
    }

    return { ok: true, status, data, usage: extractUsage(data) };
  } catch (err) {
    return normalizeThrownError(err, timeoutMs);
  }
}

function buildHeaders({ token, apiKey, authType, deployment, apiVersion }) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-version': deployment.anthropic_version || apiVersion || ANTHROPIC_VERSION,
  };

  const credential = normalizeCredential({ token, apiKey, authType });
  if (credential.kind === 'api-key' && credential.value) {
    headers['x-api-key'] = credential.value;
  } else if (credential.value) {
    headers.Authorization = `Bearer ${credential.value}`;
  }

  if (deployment.deployment_name) {
    headers['x-ms-model-mesh-model-name'] = deployment.deployment_name;
  }

  return headers;
}

function buildAnthropicPayload(deployment, payload) {
  const body = { ...(payload || {}) };

  if (!body.model) {
    body.model = deployment.deployment_name || deployment.model || deployment.model_id;
  }
  if (!Array.isArray(body.messages)) {
    body.messages = [];
  }
  if (body.maxTokens !== undefined && body.max_tokens === undefined) {
    body.max_tokens = body.maxTokens;
  }
  if (body.systemPrompt !== undefined && body.system === undefined) {
    body.system = body.systemPrompt;
  }
  if (body.max_tokens === undefined) {
    body.max_tokens = 4096;
  }

  delete body.maxTokens;
  delete body.systemPrompt;
  return body;
}

function normalizeCredential({ token, apiKey, authType }) {
  if (apiKey) return { kind: 'api-key', value: apiKey };

  const tokenValue = token && typeof token === 'object' ? token.token : token;
  const tokenIsApiKey =
    authType === 'api-key' ||
    (token && typeof token === 'object' && (token.isApiKey === true || token.type === 'api-key'));

  return { kind: tokenIsApiKey ? 'api-key' : 'bearer', value: tokenValue };
}

async function fetchWithTimeout(fetchFn, url, options, timeoutMs) {
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer;

  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(`Request timed out after ${effectiveTimeoutMs}ms`);
      err.name = 'AbortError';
      reject(err);
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([fetchFn(url, { ...options, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseData(res) {
  try {
    if (typeof res.json === 'function') return await res.json();
  } catch {
    // Fall through to text parsing.
  }

  try {
    if (typeof res.text === 'function') {
      const text = await res.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
  } catch {
    // Return null below.
  }

  return null;
}

function normalizeError(status, body) {
  if (body && typeof body === 'object') {
    return body.error?.message || body.error_description || body.message || friendlyStatus(status);
  }
  if (typeof body === 'string' && body.trim()) return body.slice(0, 500);
  return friendlyStatus(status);
}

function normalizeThrownError(err, timeoutMs) {
  const message = err && err.message ? err.message : String(err);
  if (err && err.name === 'AbortError') {
    return { ok: false, status: 0, error: message || `Request timed out after ${timeoutMs}ms` };
  }
  return { ok: false, status: 0, error: `Network error: ${message}` };
}

function friendlyStatus(status) {
  const map = {
    400: 'Bad request — check the Anthropic Messages request body',
    401: 'Unauthorized — token or API key is missing, expired, or invalid',
    403: 'Forbidden — insufficient permissions for this Foundry deployment',
    404: 'Foundry deployment or route not found',
    429: 'Rate limited — too many requests. Retry after the Retry-After interval.',
    500: 'Internal server error — retry the request',
    502: 'Bad gateway — the service is temporarily unavailable',
    503: 'Service unavailable — retry after a short delay',
  };
  return map[status] || `Request failed with status ${status}`;
}

function extractUsage(data) {
  const usage = data && data.usage ? data.usage : {};
  return {
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
    totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
    cacheCreationInputTokens: usage.cache_creation_input_tokens || 0,
    cacheReadInputTokens: usage.cache_read_input_tokens || 0,
  };
}

module.exports = {
  callAnthropic,
  DEFAULT_TIMEOUT_MS,
};
