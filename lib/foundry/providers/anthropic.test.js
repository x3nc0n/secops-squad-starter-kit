import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { callAnthropic } = require('./anthropic.js');

const ENDPOINT = 'https://secops-foundry.cognitiveservices.azure.com/anthropic/v1/messages';
const DEPLOYMENT = { deployment_name: 'fable5-secops', model_id: 'claude-fable-5' };

describe('callAnthropic fallback contract', () => {
  it('returns ok:true with parsed data and normalized usage on 200', async () => {
    let request;
    const data = { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 11, output_tokens: 7 } };
    const result = await callAnthropic({
      endpoint: ENDPOINT,
      apiVersion: '2023-06-01',
      token: 'entra-token',
      deployment: DEPLOYMENT,
      payload: { messages: [{ role: 'user', content: 'hello' }], maxTokens: 99 },
      fetchFn: async (url, options) => {
        request = { url, options, body: JSON.parse(options.body) };
        return jsonResponse(200, data);
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, data);
    assert.deepEqual(result.usage, {
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    assert.equal(request.url, ENDPOINT);
    assert.equal(request.options.method, 'POST');
    assert.equal(request.options.headers.Authorization, 'Bearer entra-token');
    assert.equal(request.options.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.options.headers['x-ms-model-mesh-model-name'], 'fable5-secops');
    assert.equal(request.options.headers.Accept, 'application/json');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.body.model, 'fable5-secops');
    assert.equal(request.body.max_tokens, 99);
    assert.equal('maxTokens' in request.body, false);
  });

  for (const status of [401, 403, 404, 429]) {
    it(`returns ok:false without throwing on HTTP ${status}`, async () => {
      let result;
      await assert.doesNotReject(async () => {
        result = await callAnthropic({
          endpoint: ENDPOINT,
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
      result = await callAnthropic({
        endpoint: ENDPOINT,
        token: 'entra-token',
        deployment: DEPLOYMENT,
        payload: { messages: [] },
        fetchFn: async () => {
          throw new Error('ECONNRESET');
        },
      });
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.match(result.error, /Network error: ECONNRESET/);
  });

  it('returns ok:false without throwing on timeout', async () => {
    let result;
    await assert.doesNotReject(async () => {
      result = await callAnthropic({
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

  it('uses x-api-key instead of bearer authorization in api-key mode', async () => {
    let headers;
    const result = await callAnthropic({
      endpoint: ENDPOINT,
      apiKey: 'anthropic-api-key',
      deployment: DEPLOYMENT,
      payload: { messages: [] },
      fetchFn: async (_url, options) => {
        headers = options.headers;
        return jsonResponse(200, { usage: {} });
      },
    });

    assert.equal(result.ok, true);
    assert.equal(headers['x-api-key'], 'anthropic-api-key');
    assert.equal(headers.Authorization, undefined);
  });
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
