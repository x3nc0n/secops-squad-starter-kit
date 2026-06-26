'use strict';

const DEFAULT_RULES = [
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i,
  },
  {
    id: 'aws-access-key-id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    id: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/i,
  },
  {
    id: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/,
  },
  {
    id: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  },
  {
    id: 'openai-api-key',
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/,
  },
  {
    id: 'azure-storage-connection-string',
    pattern:
      /DefaultEndpointsProtocol=https?;AccountName=[^;"'\s]{3,};AccountKey=[A-Za-z0-9+/=]{20,}(?:;EndpointSuffix=[^;"'\s]+)?/i,
  },
  {
    id: 'sas-token',
    pattern: /\b(?:SharedAccessSignature=|sig=)[A-Za-z0-9%+/=_-]{20,}/i,
  },
  {
    id: 'sql-connection-string-password',
    pattern: /\b(?:Server|Data Source)=[^;"']+;[^"']*(?:User ID|Uid)=[^;"']+;[^"']*(?:Password|Pwd)=[^;"']{8,}/i,
  },
  {
    id: 'contextual-secret-value',
    pattern:
      /(?:api[_-]?key|x-api-key|token|access[_-]?token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)\s*["']?\s*[:=]\s*["']?(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{16,}/i,
  },
  {
    id: 'aws-secret-access-key',
    pattern: /aws.{0,30}(?:secret|access).{0,30}key\s*["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/i,
  },
];

function createSecretScanGate(opts = {}) {
  const rules = Array.isArray(opts.rules) && opts.rules.length ? opts.rules : DEFAULT_RULES;
  const logger = opts.logger || console;

  return {
    name: 'secret-scan',
    run(ctx) {
      try {
        const serialized = serializePayload(ctx && ctx.payload);
        const detection = scanText(serialized, rules);
        if (!detection) return { ok: true };

        warn(logger, detection.id);
        return {
          ok: false,
          reason: `secret-scan detected ${detection.id} (<redacted>)`,
        };
      } catch (err) {
        warn(logger, `scan-error:${errorTypeOf(err)}`);
        return {
          ok: false,
          reason: 'secret-scan failed closed (<redacted>)',
        };
      }
    },
  };
}

function scanText(text, rules = DEFAULT_RULES) {
  for (const rule of rules) {
    if (!rule || !(rule.pattern instanceof RegExp)) continue;
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) return { id: rule.id || 'unknown-secret' };
  }
  return null;
}

function serializePayload(payload) {
  if (typeof payload === 'string') return payload;
  return JSON.stringify(payload ?? {});
}

function warn(logger, ruleId) {
  if (!logger || typeof logger.warn !== 'function') return;
  logger.warn(`[foundry/secret-scan] blocked outbound payload: rule=${ruleId} indicator=<redacted:${ruleId}>`);
}

function errorTypeOf(err) {
  return err && err.name ? err.name : 'Error';
}

module.exports = {
  createSecretScanGate,
  scanText,
  DEFAULT_RULES,
};
