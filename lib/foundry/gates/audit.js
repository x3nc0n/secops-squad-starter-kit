'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RELATIVE_AUDIT_PATH = path.join('.secops', 'foundry-audit.jsonl');

function createAuditGate(opts = {}) {
  const auditPath = opts.auditPath;
  const fsImpl = opts.fs || fs;
  const logger = opts.logger || console;
  const nowFn = typeof opts.nowFn === 'function' ? opts.nowFn : () => new Date();

  return {
    name: 'audit',
    run(ctx, result) {
      try {
        const targetPath = resolveAuditPath(ctx && ctx.rootDir, auditPath);
        fsImpl.mkdirSync(path.dirname(targetPath), { recursive: true });
        fsImpl.appendFileSync(targetPath, `${JSON.stringify(buildAuditRecord(ctx, result, nowFn()))}\n`, 'utf8');
      } catch (err) {
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`[foundry/audit] failed to write audit record: ${messageOf(err)}`);
        }
      }
    },
  };
}

function buildAuditRecord(ctx = {}, result = {}, now = new Date()) {
  return {
    timestamp: toIsoUtc(now),
    deployment: ctx.deploymentName || null,
    provider: ctx.provider || null,
    modelId: ctx.modelId || null,
    payload_sha256: hashPayload(ctx.payload),
    outcome: classifyOutcome(result),
    status_code: typeof result.status === 'number' ? result.status : null,
    gate: result.error === 'foundry-gate-blocked' ? result.gate || null : null,
    usage: normalizeUsage(result.usage),
  };
}

function resolveAuditPath(rootDir, auditPath) {
  if (auditPath && path.isAbsolute(auditPath)) return auditPath;
  const baseDir = rootDir || process.cwd();
  return path.join(baseDir, auditPath || DEFAULT_RELATIVE_AUDIT_PATH);
}

function hashPayload(payload) {
  return crypto.createHash('sha256').update(safeSerialize(payload)).digest('hex');
}

function safeSerialize(value) {
  const seen = new WeakSet();
  const serialized = JSON.stringify(value ?? {}, (_key, current) => {
    if (typeof current === 'bigint') return current.toString();
    if (typeof current === 'function') return '[Function]';
    if (current && typeof current === 'object') {
      if (seen.has(current)) return '[Circular]';
      seen.add(current);
    }
    return current;
  });
  return serialized === undefined ? String(value) : serialized;
}

function classifyOutcome(result = {}) {
  if (result.ok === true) return 'ok';
  if (result.error === 'foundry-gate-blocked') return 'blocked';
  if (result.error === 'foundry-auth-failed') return 'auth-failed';
  return 'provider-error';
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  return {
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
    totalTokens: numberOrZero(usage.totalTokens),
    cachedInputTokens: numberOrZero(usage.cachedInputTokens),
    reasoningTokens: numberOrZero(usage.reasoningTokens),
  };
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toIsoUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

module.exports = {
  createAuditGate,
  buildAuditRecord,
  hashPayload,
  DEFAULT_RELATIVE_AUDIT_PATH,
};
