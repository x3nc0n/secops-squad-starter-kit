import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callOpenAI } = require('./openai.js');

const ENDPOINT = 'https://secops-foundry.cognitiveservices.azure.com/openai/deployments/gpt4o/chat/completions';
const DEPLOYMENT = { deployment_name: 'gpt4o', model_id: 'gpt-4o', provider: 'openai' };

describe('callOpenAI fallback contract', () => {
  it('returns ok:true with parsed data and normalized usage on 200', async () => {
    let request;
    const data = {
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 13,
        completion_tokens: 5,
        total_tokens: 18,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    };

    const result = await callOpenAI({
      endpoint: ENDPOINT,
      apiVersion: '2025-04-01-preview',
      token: 'entra-token',
      deployment: DEPLOYMENT,
      payload: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 64, systemPrompt: 'system' },
      fetchFn: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return jsonResponse(200, data);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, data);
    assert.deepEqual(result.usage, {
      inputTokens: 13,
      outputTokens: 5,
      totalTokens: 18,
      cachedInputTokens: 3,
      reasoningTokens: 2,
    });
    assert.equal(request.url, `${ENDPOINT}?api-version=2025-04-01-preview`);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer entra-token');
    assert.equal(request.options.headers.Accept, 'application/json');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.body.max_tokens, 64);
    assert.equal(request.body.messages[0].role, 'system');
    assert.equal('maxTokens' in request.body, false);
  });

  for (const status of [401, 403, 404, 429]) {
    it(`returns ok:false without throwing on HTTP ${status}`, async () => {
      let result;
      await assert.doesNotReject(async () => {
        result = await callOpenAI({
          endpoint: `${ENDPOINT}?api-version=2025-04-01-preview`,
          token: 'entra-token',
          deployment: DEPLOYMENT,
          payload: { messages: [] },
          fetchFn: async () => jsonResponse(status, { error: { message: `status ${status}` } }),
        });
      });
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
      assert.match(result.error, new RegExp(String(status)));
    });
  }

  it('returns ok:false without throwing on network rejection', async () => {
    let result;
    await assert.doesNotReject(async () => {
      result = await callOpenAI({
        endpoint: ENDPOINT,
        token: 'entra-token',
        deployment: DEPLOYMENT,
        payload: { messages: [] },
        fetchFn: async () => {
          throw new Error('ENOTFOUND');
        },
      });
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.error, /Network error: ENOTFOUND/);
  });

  it('returns ok:false without throwing on timeout', async () => {
    let result;
    await assert.doesNotReject(async () => {
      result = await callOpenAI({
        endpoint: ENDPOINT,
        token: 'entra-token',
        deployment: DEPLOYMENT,
        payload: { messages: [] },
        timeoutMs: 5,
        fetchFn: async () => new Promise(() => {}),
      });
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.error, /timed out/i);
  });

  it('uses api-key instead of bearer authorization in api-key mode', async () => {
    let headers;
    const result = await callOpenAI({
      endpoint: ENDPOINT,
      authType: 'api-key',
      token: { token: 'openai-api-key', type: 'api-key' },
      deployment: DEPLOYMENT,
      payload: { messages: [] },
      fetchFn: async (_url, options) => {
        headers = options.headers;
        return jsonResponse(200, { usage: {} });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(headers['api-key'], 'openai-api-key');
    assert.equal(headers.Authorization, undefined);
  });

  it('maps reasoning deployments to max_completion_tokens and reasoning_effort', async () => {
    let body;
    await callOpenAI({
      endpoint: ENDPOINT,
      token: 'entra-token',
      deployment: { ...DEPLOYMENT, provider: 'openai-reasoning', reasoning_model: true },
      payload: { messages: [], maxTokens: 128, reasoningEffort: 'high' },
      fetchFn: async (_url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse(200, { usage: {} });
      },
    });

    assert.equal(body.max_completion_tokens, 128);
    assert.equal(body.reasoning_effort, 'high');
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.reasoningEffort, undefined);
  });
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
