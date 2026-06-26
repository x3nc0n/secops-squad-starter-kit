'use strict';

/**
 * @module lib/foundry
 * Public Foundry dispatch orchestrator. This module owns config selection,
 * auth, provider routing, and the safety hook call sites.
 */

const { loadFoundryConfig, resolveEndpoint } = require('./config');
const { getFoundryToken } = require('./auth');
const { callAnthropic } = require('./providers/anthropic');
const { callOpenAI } = require('./providers/openai');

const PROVIDERS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  'openai-reasoning': callOpenAI,
};

/**
 * Resolve the configured Foundry provider without acquiring credentials.
 *
 * @param {object} [options]
 * @param {string} [options.rootDir=process.cwd()]
 * @param {string} [options.deploymentName] model_id or deployment_name override.
 * @returns {{ok:true,config:object,deployment:object,provider:string,client:Function,endpoint:string,modelId:string,deploymentName:string}|{ok:false,error:string,provider?:string}}
 */
function getFoundryProvider(options = {}) {
  try {
    const rootDir = options.rootDir || process.cwd();
    const config = loadFoundryConfig(rootDir);
    if (!config) return { ok: false, error: 'foundry-not-configured' };

    const deployment = selectDeployment(config, options.deploymentName);
    if (!deployment) return { ok: false, error: 'foundry-deployment-not-found' };

    const provider = deployment.provider || 'openai';
    const client = PROVIDERS[provider];
    if (!client) return { ok: false, error: 'foundry-provider-unsupported', provider };

    const endpoint = resolveEndpoint(config, deployment);
    return {
      ok: true,
      config,
      deployment,
      provider,
      client,
      endpoint,
      modelId: deployment.model_id,
      deploymentName: deployment.deployment_name,
    };
  } catch (err) {
    return { ok: false, error: `foundry-provider-resolution-failed: ${messageOf(err)}` };
  }
}

/**
 * High-level Foundry route with safety hook call sites.
 *
 * Hook contract:
 *   hooks = {
 *     preDispatch: [
 *       function secretScan(ctx) { return { ok: true }; }
 *       // or { name: 'secret-scan', run: async (ctx) => ({ ok: true }) }
 *     ],
 *     postDispatch: [
 *       function audit(ctx, result) {}
 *       // or { name: 'audit', run: async (ctx, result) => {} }
 *     ]
 *   }
 *
 * Pre-dispatch hooks run in order before any provider fetch. Any
 * {ok:false, reason} result aborts fail-closed. Post-dispatch hooks run after
 * the final route result is known, including auth failures and pre-dispatch
 * blocks, so audit can record both allowed and blocked attempts. Post hook
 * failures are swallowed.
 *
 * P0 production hooks are expected to be named "secret-scan" (preDispatch) and
 * "audit" (postDispatch). This module warns when they are absent but supplies
 * no-op defaults for development and tests.
 *
 * @param {object} opts
 * @param {string} [opts.rootDir=process.cwd()]
 * @param {string} [opts.deploymentName] model_id or deployment_name override.
 * @param {object} opts.payload Provider request payload.
 * @param {object|Function[]} [opts.hooks]
 * @param {Function} [opts.fetchFn] Injectable fetch implementation.
 * @param {Function} [opts.execFn] Injectable child_process exec implementation.
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<object>} Provider result or {ok:false,...}; never throws.
 */
async function routeToFoundry(opts = {}) {
  const startedAt = Date.now();
  let ctx = null;
  let postHooks = [];

  try {
    const providerResult = getFoundryProvider(opts);
    if (!providerResult.ok) return providerResult;

    const normalizedHooks = normalizeHooks(opts.hooks);
    postHooks = normalizedHooks.postDispatch;
    warnIfProductionHooksMissing(normalizedHooks);

    const apiVersion =
      providerResult.provider === 'anthropic'
        ? providerResult.deployment.anthropic_version
        : providerResult.config.foundry.api_version;

    ctx = buildHookContext({
      rootDir: opts.rootDir || process.cwd(),
      payload: opts.payload || {},
      providerResult,
      apiVersion,
    });

    const auth = getFoundryToken({ execFn: opts.execFn });
    if (!auth.ok) {
      return await finalizeWithPostHooks(
        postHooks,
        ctx,
        withLatency({ ok: false, error: 'foundry-auth-failed', detail: auth.error }, startedAt)
      );
    }

    const envApiKey = getEnvApiKey();

    const gate = await runPreDispatchHooks(normalizedHooks.preDispatch, ctx);
    if (!gate.ok) {
      const blocked = {
        ok: false,
        error: 'foundry-gate-blocked',
        gate: gate.gate,
        reason: gate.reason || 'blocked',
      };
      return await finalizeWithPostHooks(postHooks, ctx, withLatency(blocked, startedAt));
    }

    const result = await providerResult.client({
      endpoint: providerResult.endpoint,
      apiVersion,
      token: envApiKey ? undefined : auth.token,
      apiKey: envApiKey || undefined,
      authType: envApiKey ? 'api-key' : undefined,
      deployment: providerResult.deployment,
      payload: opts.payload || {},
      fetchFn: opts.fetchFn,
      timeoutMs: opts.timeoutMs,
    });

    return await finalizeWithPostHooks(
      postHooks,
      ctx,
      withRouteMetadata(withLatency(result, startedAt), providerResult)
    );
  } catch (err) {
    const result = { ok: false, error: 'foundry-route-failed', detail: messageOf(err) };
    if (ctx) return await finalizeWithPostHooks(postHooks, ctx, withLatency(result, startedAt));
    return withLatency(result, startedAt);
  }
}

function selectDeployment(config, requested) {
  const foundry = config && config.foundry;
  const deployments = foundry && Array.isArray(foundry.model_deployments) ? foundry.model_deployments : [];
  if (requested) {
    return deployments.find(
      (d) => d && d.status === 'active' && (d.deployment_name === requested || d.model_id === requested)
    );
  }
  return deployments.find((d) => d && d.status === 'active' && d.model_id === foundry.active_model);
}

function normalizeHooks(hooks) {
  if (Array.isArray(hooks)) {
    return { preDispatch: hooks.map((hook, index) => normalizeHook(hook, `preDispatch[${index}]`)), postDispatch: [] };
  }

  const pre = hooks && Array.isArray(hooks.preDispatch) ? hooks.preDispatch : [];
  const post = hooks && Array.isArray(hooks.postDispatch) ? hooks.postDispatch : [];
  return {
    preDispatch: pre.map((hook, index) => normalizeHook(hook, `preDispatch[${index}]`)),
    postDispatch: post.map((hook, index) => normalizeHook(hook, `postDispatch[${index}]`)),
  };
}

function normalizeHook(hook, fallbackName) {
  if (typeof hook === 'function') {
    return { name: hook.gateName || hook.displayName || hook.name || fallbackName, run: hook };
  }
  if (hook && typeof hook.run === 'function') {
    return { name: hook.name || hook.gateName || fallbackName, run: hook.run };
  }
  return {
    name: fallbackName,
    run: () => ({ ok: false, reason: 'invalid-hook' }),
  };
}

async function runPreDispatchHooks(hooks, ctx) {
  for (const hook of hooks) {
    try {
      const result = await hook.run(ctx);
      if (result && result.ok === false) {
        return { ok: false, gate: hook.name, reason: result.reason || result.error || 'blocked' };
      }
    } catch (err) {
      return { ok: false, gate: hook.name, reason: `hook-threw: ${messageOf(err)}` };
    }
  }
  return { ok: true };
}

async function finalizeWithPostHooks(hooks, ctx, result) {
  await runPostDispatchHooks(hooks, ctx, result);
  return result;
}

async function runPostDispatchHooks(hooks, ctx, result) {
  for (const hook of hooks) {
    try {
      await hook.run(ctx, result);
    } catch (err) {
      console.warn(`[foundry] postDispatch hook "${hook.name}" failed: ${messageOf(err)}`);
    }
  }
}

function buildHookContext({ rootDir, payload, providerResult, apiVersion }) {
  return {
    rootDir,
    payload,
    provider: providerResult.provider,
    modelId: providerResult.modelId,
    deploymentName: providerResult.deploymentName,
    deployment: providerResult.deployment,
    endpoint: providerResult.endpoint,
    apiVersion,
    timestamp: new Date().toISOString(),
  };
}

function warnIfProductionHooksMissing(hooks) {
  const hasSecretScan = hooks.preDispatch.some((hook) => /secret[-_ ]?scan/i.test(hook.name));
  const hasAudit = hooks.postDispatch.some((hook) => /audit/i.test(hook.name));
  if (!hasSecretScan) {
    console.warn('[foundry] P0 preDispatch hook "secret-scan" is absent; required before production use.');
  }
  if (!hasAudit) {
    console.warn('[foundry] P0 postDispatch hook "audit" is absent; required before production use.');
  }
}

function getEnvApiKey() {
  const value = process.env.FOUNDRY_API_KEY;
  return value && value.trim() ? value.trim() : null;
}

function withLatency(result, startedAt) {
  return { ...result, latencyMs: Date.now() - startedAt };
}

function withRouteMetadata(result, providerResult) {
  return {
    ...result,
    provider: providerResult.provider,
    modelId: providerResult.modelId,
    deploymentName: providerResult.deploymentName,
  };
}

function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = {
  getFoundryProvider,
  routeToFoundry,
  PROVIDERS,
};
