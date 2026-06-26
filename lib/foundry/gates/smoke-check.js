'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { routeToFoundry } = require('../index');
const { clearTokenCache } = require('../auth');
const { createFoundrySafetyHooks } = require('./index');

const WORK_ROOT = path.resolve(__dirname, '.smoke-work');
const AUDIT_PATH = path.join(WORK_ROOT, '.secops', 'foundry-audit.jsonl');
const ORIGINAL_API_KEY = process.env.FOUNDRY_API_KEY;

main()
  .then(() => {
    console.log('foundry gates smoke-check: PASS');
  })
  .catch((err) => {
    console.error(`foundry gates smoke-check: FAIL: ${err.stack || err.message || err}`);
    process.exitCode = 1;
  })
  .finally(() => {
    clearTokenCache();
    if (ORIGINAL_API_KEY === undefined) delete process.env.FOUNDRY_API_KEY;
    else process.env.FOUNDRY_API_KEY = ORIGINAL_API_KEY;
    fs.rmSync(WORK_ROOT, { recursive: true, force: true });
  });

async function main() {
  clearTokenCache();
  delete process.env.FOUNDRY_API_KEY;
  fs.rmSync(WORK_ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(WORK_ROOT, '.secops'), { recursive: true });
  writeFoundryConfig();

  const blocked = await routeToFoundry({
    rootDir: WORK_ROOT,
    payload: { messages: [{ role: 'user', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' }] },
    execFn: fakeExec,
    fetchFn: async () => {
      throw new Error('provider fetch must not run for blocked payloads');
    },
    hooks: createFoundrySafetyHooks(),
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, 'foundry-gate-blocked');
  assert.equal(blocked.gate, 'secret-scan');

  fs.rmSync(AUDIT_PATH, { force: true });

  const cleanPayload = { messages: [{ role: 'user', content: 'hello from a clean smoke payload' }], maxTokens: 32 };
  const clean = await routeToFoundry({
    rootDir: WORK_ROOT,
    payload: cleanPayload,
    execFn: fakeExec,
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'ok' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }),
    }),
    hooks: createFoundrySafetyHooks(),
  });

  assert.equal(clean.ok, true);
  const lines = fs.readFileSync(AUDIT_PATH, 'utf8').trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const audit = JSON.parse(lines[0]);
  assert.match(audit.payload_sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(audit).includes('hello from a clean smoke payload'), false);
  assert.equal(audit.outcome, 'ok');
  assert.equal(audit.status_code, 200);
}

function fakeExec() {
  return JSON.stringify({
    token: 'fake-entra-token',
    expiry: new Date(Date.now() + 3600000).toISOString(),
  });
}

function writeFoundryConfig() {
  fs.writeFileSync(
    path.join(WORK_ROOT, '.secops', 'foundry.yaml'),
    `schema_version: "1.0"
foundry:
  enabled: true
  endpoint: "https://secops-foundry.cognitiveservices.azure.com"
  api_version: "2025-04-01-preview"
  active_model: "gpt-4o"
  model_deployments:
    - model_id: "gpt-4o"
      deployment_name: "gpt4o-secops"
      deployment_type: "global-standard"
      provider: "openai"
      status: "active"
      api_path: "/openai/v1/chat"
      reasoning_model: false
`,
    'utf8'
  );
}
