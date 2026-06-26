import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const WORK_ROOT = resolve(import.meta.dirname, '.cli-test-work');

describe('secops-squad foundry CLI', () => {
  beforeEach(() => {
    rmSync(WORK_ROOT, { recursive: true, force: true });
    mkdirSync(WORK_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(WORK_ROOT, { recursive: true, force: true });
  });

  it('status with no config exits non-zero and prints fail-closed', () => {
    const result = spawnSync(process.execPath, [resolve(REPO_ROOT, 'cli', 'index.js'), 'foundry', 'status'], {
      cwd: WORK_ROOT,
      encoding: 'utf8',
      env: { ...process.env, FOUNDRY_API_KEY: '' },
    });

    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /not configured/i);
    assert.match(output, /fail-closed/i);
  });

  it('route attaches createFoundrySafetyHooks output so P0 gates cannot be bypassed', async () => {
    const cliPath = require.resolve('../../cli/commands/foundry.js');
    const foundryIndexPath = require.resolve('./index.js');
    const gatesPath = require.resolve('./gates/index.js');
    const originalCli = require.cache[cliPath];
    const originalFoundry = require.cache[foundryIndexPath];
    const originalGates = require.cache[gatesPath];
    const sentinelHooks = {
      preDispatch: [{ name: 'secret-scan', run: () => ({ ok: true }) }],
      postDispatch: [{ name: 'audit', run: () => undefined }],
    };
    let capturedRouteOptions;
    const logs = [];
    const originalLog = console.log;
    const originalCwd = process.cwd();

    try {
      delete require.cache[cliPath];
      require.cache[foundryIndexPath] = {
        id: foundryIndexPath,
        filename: foundryIndexPath,
        loaded: true,
        exports: {
          routeToFoundry: async (opts) => {
            capturedRouteOptions = opts;
            return { ok: true, data: { choices: [{ message: { content: 'routed' } }] } };
          },
        },
      };
      require.cache[gatesPath] = {
        id: gatesPath,
        filename: gatesPath,
        loaded: true,
        exports: {
          createFoundrySafetyHooks: () => sentinelHooks,
        },
      };
      console.log = (msg) => logs.push(String(msg));
      process.chdir(WORK_ROOT);

      const { run } = require('../../cli/commands/foundry.js');
      await run(['route', '--prompt', 'hello']);

      assert.equal(capturedRouteOptions.rootDir, WORK_ROOT);
      assert.deepEqual(capturedRouteOptions.payload, { messages: [{ role: 'user', content: 'hello' }] });
      assert.equal(capturedRouteOptions.hooks, sentinelHooks);
      assert.equal(capturedRouteOptions.hooks.preDispatch[0].name, 'secret-scan');
      assert.equal(capturedRouteOptions.hooks.postDispatch[0].name, 'audit');
      assert.deepEqual(logs, ['routed']);
    } finally {
      console.log = originalLog;
      process.chdir(originalCwd);
      delete require.cache[cliPath];
      if (originalCli) require.cache[cliPath] = originalCli;
      else delete require.cache[cliPath];
      if (originalFoundry) require.cache[foundryIndexPath] = originalFoundry;
      else delete require.cache[foundryIndexPath];
      if (originalGates) require.cache[gatesPath] = originalGates;
      else delete require.cache[gatesPath];
    }
  });
});
