/**
 * Foundry Orchestrator — Phase 1 dispatch smoke checks.
 *
 * Run: node --test lib/foundry/index.test.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getFoundryProvider, routeToFoundry } = require('./index.js');
const { clearTokenCache } = require('./auth.js');

const WORK_ROOT = resolve(import.meta.dirname, '.index-test-work');
const ORIGINAL_API_KEY = process.env.FOUNDRY_API_KEY;

describe('lib/foundry index exports', () => {
  it('can be required and exposes public functions', () => {
    const foundry = require('./index.js');
    assert.equal(typeof foundry.getFoundryProvider, 'function');
    assert.equal(typeof foundry.routeToFoundry, 'function');
  });
});

describe('routeToFoundry hook dispatch contract', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
    rmSync(WORK_ROOT, { recursive: true, force: true });
    mkdirSync(join(WORK_ROOT, '.secops'), { recursive: true });
  });

  afterEach(() => {
    clearTokenCache();
    if (ORIGINAL_API_KEY === undefined) delete process.env.FOUNDRY_API_KEY;
    else process.env.FOUNDRY_API_KEY = ORIGINAL_API_KEY;
    rmSync(WORK_ROOT, { recursive: true, force: true });
  });

  it('selects the active provider from config', () => {
    writeFoundryConfig('anthropic');
    const provider = getFoundryProvider({ rootDir: WORK_ROOT });
    assert.equal(provider.ok, true);
    assert.equal(provider.provider, 'anthropic');
    assert.equal(provider.deploymentName, 'fable5-secops');
  });

  it('fails closed when config is missing and never calls fetch', async () => {
    rmSync(join(WORK_ROOT, '.secops', 'foundry.yaml'), { force: true });
    let fetchCalled = false;

    const result = await routeToFoundry({
      rootDir: WORK_ROOT,
      payload: { messages: [{ role: 'user', content: 'no config' }] },
      execFn: fakeExec,
      fetchFn: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'foundry-not-configured');
    assert.equal(fetchCalled, false);
  });

  it('F-001 regression: partial config missing endpoint fails closed before egress', async () => {
    writeRawFoundryConfig(`
schema_version: "1.0"
foundry:
  enabled: true
  api_version: "2025-04-01-preview"
  active_model: "gpt-4o"
  model_deployments:
    - model_id: "gpt-4o"
      deployment_name: "gpt4o-secops"
      provider: "openai"
      status: "active"
`);
    let fetchCalled = false;

    const result = await routeToFoundry({
      rootDir: WORK_ROOT,
      payload: { messages: [{ role: 'user', content: 'missing endpoint' }] },
      execFn: fakeExec,
      fetchFn: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'foundry-not-configured');
    assert.equal(fetchCalled, false);
  });

  it('returns ok:false for an unknown configured provider', () => {
    writeRawFoundryConfig(`
schema_version: "1.0"
foundry:
  enabled: true
  endpoint: "https://secops-foundry.cognitiveservices.azure.com"
  api_version: "2025-04-01-preview"
  active_model: "mystery-model"
  model_deployments:
    - model_id: "mystery-model"
      deployment_name: "mystery-deployment"
      provider: "bogus-provider"
      status: "active"
`);

    const provider = getFoundryProvider({ rootDir: WORK_ROOT });
    assert.equal(provider.ok, false);
    assert.equal(provider.error, 'foundry-provider-unsupported');
    assert.equal(provider.provider, 'bogus-provider');
  });

  it('runs post-dispatch hooks on auth failure and never calls fetch', async () => {
    writeFoundryConfig('openai');
    let fetchCalled = false;
    let auditCalled = false;

    const result = await routeToFoundry({
      rootDir: WORK_ROOT,
      payload: { messages: [{ role: 'user', content: 'auth fails' }] },
      execFn: () => {
        throw new Error('az login required');
      },
      fetchFn: async () => {
        fetchCalled = true;
        return { ok: true, status: 200, json: async () => ({}) };
      },
      hooks: {
        preDispatch: [{ name: 'secret-scan', run: () => ({ ok: true }) }],
        postDispatch: [
          {
            name: 'audit',
            run: (_ctx, routeResult) => {
              auditCalled = true;
              assert.equal(routeResult.ok, false);
              assert.equal(routeResult.error, 'foundry-auth-failed');
            },
          },
        ],
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'foundry-auth-failed');
    assert.equal(fetchCalled, false);
    assert.equal(auditCalled, true);
  });

  it('fails closed before egress when a pre-dispatch hook blocks', async () => {
    writeFoundryConfig('openai');
    let fetchCalled = false;
    let auditCalled = false;

    const result = await routeToFoundry({
      rootDir: WORK_ROOT,
      payload: { messages: [{ role: 'user', content: 'do not send' }] },
      execFn: fakeExec,
      fetchFn: async () => {
        fetchCalled = true;
        throw new Error('fetch must not be reached');
      },
      hooks: {
        preDispatch: [{ name: 'secret-scan', run: () => ({ ok: false, reason: 'synthetic-secret' }) }],
        postDispatch: [
          {
            name: 'audit',
            run: (ctx, routeResult) => {
              auditCalled = true;
              assert.equal(routeResult.ok, false);
              assert.equal(routeResult.gate, 'secret-scan');
            },
          },
        ],
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, 'foundry-gate-blocked');
    assert.equal(result.gate, 'secret-scan');
    assert.equal(result.reason, 'synthetic-secret');
    assert.equal(fetchCalled, false, 'provider fetch must not run when a pre-dispatch hook blocks');
    assert.equal(auditCalled, true, 'postDispatch audit hook must see blocked attempts');
  });

  it('routes to the provider when pre-dispatch hooks pass', async () => {
    writeFoundryConfig('openai');
    let fetchCalled = 0;
    let auditCalled = false;

    const result = await routeToFoundry({
      rootDir: WORK_ROOT,
      payload: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 32 },
      execFn: fakeExec,
      fetchFn: async (url, options) => {
        fetchCalled++;
        assert.ok(url.includes('/openai/deployments/gpt4o-secops/chat/completions'));
        assert.equal(options.method, 'POST');
        assert.ok(options.headers.Authorization.startsWith('Bearer '));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'ok' } }],
            usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          }),
        };
      },
      hooks: {
        preDispatch: [{ name: 'secret-scan', run: () => ({ ok: true }) }],
        postDispatch: [
          {
            name: 'audit',
            run: (_ctx, routeResult) => {
              auditCalled = true;
              assert.equal(routeResult.ok, true);
            },
          },
        ],
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.provider, 'openai');
    assert.equal(result.deploymentName, 'gpt4o-secops');
    assert.equal(fetchCalled, 1);
    assert.equal(auditCalled, true);
  });
});

function fakeExec() {
  return JSON.stringify({
    token: 'fake-entra-token',
    expiry: new Date(Date.now() + 3600000).toISOString(),
  });
}

function writeFoundryConfig(provider) {
  const deployment =
    provider === 'anthropic'
      ? {
          modelId: 'claude-fable-5',
          deploymentName: 'fable5-secops',
          provider: 'anthropic',
          apiPath: '/anthropic/v1/messages',
          reasoningModel: false,
        }
      : {
          modelId: 'gpt-4o',
          deploymentName: 'gpt4o-secops',
          provider: 'openai',
          apiPath: '/openai/v1/chat',
          reasoningModel: false,
        };

  writeFileSync(
    join(WORK_ROOT, '.secops', 'foundry.yaml'),
    `schema_version: "1.0"
foundry:
  enabled: true
  endpoint: "https://secops-foundry.cognitiveservices.azure.com"
  api_version: "2025-04-01-preview"
  active_model: "${deployment.modelId}"
  model_deployments:
    - model_id: "${deployment.modelId}"
      deployment_name: "${deployment.deploymentName}"
      deployment_type: "global-standard"
      provider: "${deployment.provider}"
      status: "active"
      api_path: "${deployment.apiPath}"
      reasoning_model: ${deployment.reasoningModel}
`,
    'utf8'
  );
}

function writeRawFoundryConfig(content) {
  writeFileSync(join(WORK_ROOT, '.secops', 'foundry.yaml'), content, 'utf8');
}
