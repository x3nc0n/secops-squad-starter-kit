'use strict';

/**
 * @module lib/foundry/providers/openai
 * Azure AI Foundry OpenAI-compatible chat/completions REST client.
 *
 * Auth choice: callers may pass apiKey (or authType: 'api-key') to emit
 * api-key. Otherwise token is treated as an Entra bearer token from auth.js.
 */

const DEFAULT_TIMEOUT_MS = 60000;

/**
 * Calls an Azure OpenAI-compatible chat/completions deployment through Foundry.
 *
 * @param {object} opts
 * @param {string} opts.endpoint Full request URL, usually resolveEndpoint(config, deployment).
 * @param {string} [opts.apiVersion] API version appended when endpoint lacks api-version.
 * @param {string|{token:string,isApiKey?:boolean,type?:string}} [opts.token] Bearer token or API key token object.
 * @param {string} [opts.apiKey] Explicit API key; preferred over token for API-key auth.
 * @param {'bearer'|'api-key'} [opts.authType] Force token interpretation.
 * @param {object} opts.deployment Active Foundry deployment config entry.
 * @param {object} opts.payload Chat completions payload.
 * @param {Function} [opts.fetchFn] Injectable fetch implementation; defaults to global fetch.
 * @param {number} [opts.timeoutMs=60000] Request timeout in milliseconds.
 * @returns {Promise<{ok:true,status:number,data:any,usage:object}|{ok:false,status:number,error:string}>}
 */
async function callOpenAI({
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

    const headers = buildHeaders({ token, apiKey, authType });
    const body = buildOpenAIPayload(deployment, payload);
    const url = withApiVersion(endpoint, apiVersion);
    const res = await fetchWithTimeout(
      fetchFn,
      url,
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

function buildHeaders({ token, apiKey, authType }) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const credential = normalizeCredential({ token, apiKey, authType });
  if (credential.kind === 'api-key' && credential.value) {
    headers['api-key'] = credential.value;
  } else if (credential.value) {
    headers.Authorization = `Bearer ${credential.value}`;
  }

  return headers;
}

function buildOpenAIPayload(deployment, payload) {
  const body = { ...(payload || {}) };
  const isReasoning = deployment.reasoning_model === true || deployment.provider === 'openai-reasoning';

  if (!Array.isArray(body.messages)) {
    body.messages = [];
  }

  const requestedMaxTokens = body.maxTokens ?? body.max_tokens ?? body.max_completion_tokens;
  if (isReasoning) {
    if (requestedMaxTokens !== undefined) body.max_completion_tokens = requestedMaxTokens;
    if (body.reasoningEffort !== undefined && body.reasoning_effort === undefined) {
      body.reasoning_effort = body.reasoningEffort;
    }
    delete body.max_tokens;
  } else if (requestedMaxTokens !== undefined) {
    body.max_tokens = requestedMaxTokens;
    delete body.max_completion_tokens;
  }

  if (body.max_tokens === undefined && body.max_completion_tokens === undefined) {
    if (isReasoning) body.max_completion_tokens = 4096;
    else body.max_tokens = 4096;
  }

  if (body.systemPrompt !== undefined) {
    body.messages = [{ role: 'system', content: body.systemPrompt }, ...body.messages];
  }

  delete body.maxTokens;
  delete body.reasoningEffort;
  delete body.systemPrompt;
  return body;
}

function withApiVersion(endpoint, apiVersion) {
  if (!apiVersion || typeof endpoint !== 'string' || endpoint.includes('api-version=')) return endpoint;
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}api-version=${encodeURIComponent(apiVersion)}`;
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
    400: 'Bad request — check the chat/completions request body',
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
  const promptDetails = usage.prompt_tokens_details || {};
  const completionDetails = usage.completion_tokens_details || {};
  return {
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
    totalTokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    cachedInputTokens: promptDetails.cached_tokens || 0,
    reasoningTokens: completionDetails.reasoning_tokens || 0,
  };
}

module.exports = {
  callOpenAI,
  DEFAULT_TIMEOUT_MS,
};
