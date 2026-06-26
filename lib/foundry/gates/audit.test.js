import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAuditGate, hashPayload } = require('./audit.js');

const WORK_ROOT = resolve(import.meta.dirname, '.audit-test-work');

describe('createAuditGate', () => {
  beforeEach(() => {
    rmSync(WORK_ROOT, { recursive: true, force: true });
    mkdirSync(WORK_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(WORK_ROOT, { recursive: true, force: true });
  });

  it('appends one JSON line per dispatch with payload hash instead of raw payload', () => {
    const payload = { messages: [{ role: 'user', content: 'raw-secret-shaped-but-not-scanned-here' }] };
    const auditPath = join(WORK_ROOT, '.secops', 'foundry-audit.jsonl');
    const gate = createAuditGate({
      nowFn: () => new Date('2026-06-25T22:10:00.000Z'),
      logger: { warn: () => assert.fail('audit write should not warn') },
    });

    const outcomes = [
      { ok: true, status: 200, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
      { ok: false, error: 'foundry-gate-blocked', gate: 'secret-scan' },
      { ok: false, error: 'foundry-auth-failed' },
      { ok: false, status: 429, error: 'Rate limited' },
    ];
    for (const result of outcomes) gate.run(baseCtx(payload), result);

    const raw = readFileSync(auditPath, 'utf8');
    const lines = raw.trim().split(/\r?\n/);
    assert.equal(lines.length, 4);
    assert.equal(raw.includes('raw-secret-shaped-but-not-scanned-here'), false);
    assert.equal(raw.includes(hashPayload(payload)), true);

    const records = lines.map((line) => JSON.parse(line));
    assert.deepEqual(records.map((r) => r.outcome), ['ok', 'blocked', 'auth-failed', 'provider-error']);
    assert.equal(records[0].timestamp, '2026-06-25T22:10:00.000Z');
    assert.equal(records[0].payload_sha256, hashPayload(payload));
    assert.equal(records[1].gate, 'secret-scan');
    assert.equal(records[3].status_code, 429);
  });

  it('does not throw when audit writes fail', () => {
    const warnings = [];
    const gate = createAuditGate({
      fs: {
        mkdirSync() {
          throw new Error('disk full');
        },
        appendFileSync() {
          throw new Error('must not be called');
        },
      },
      logger: { warn: (msg) => warnings.push(msg) },
    });

    assert.doesNotThrow(() => gate.run(baseCtx({ clean: true }), { ok: true, status: 200 }));
    assert.match(warnings.join('\n'), /failed to write audit record/);
  });
});

function baseCtx(payload) {
  return {
    rootDir: WORK_ROOT,
    payload,
    provider: 'openai',
    modelId: 'gpt-4o',
    deploymentName: 'gpt4o-secops',
  };
}
