# Kima — Foundry Safety Gates

**Date:** 2026-06-25T21:50:00-05:00
**Branch:** foundry-integration
**Scope:** P0 Foundry gates: pre-dispatch secret scan and post-dispatch audit.

## Factory signatures

- `createSecretScanGate(opts = {})` from `lib/foundry/gates/secret-scan.js`
  - Returns `{ name: 'secret-scan', run(ctx) }`.
  - `opts.rules` can override detection rules for tests.
  - `opts.logger` can override warning output.
- `createAuditGate({ auditPath, fs, logger, nowFn } = {})` from `lib/foundry/gates/audit.js`
  - Returns `{ name: 'audit', run(ctx, result) }`.
  - `auditPath` may be absolute or relative to `ctx.rootDir`.
- `createFoundrySafetyHooks(opts = {})` from `lib/foundry/gates/index.js`
  - Returns `{ preDispatch: [secretScan], postDispatch: [audit] }`.

## Secret scan fail-closed semantics

The secret scan serializes `ctx.payload` and scans before provider egress. If a high-confidence rule matches, it returns:

```js
{ ok: false, reason: 'secret-scan detected <rule-id> (<redacted>)' }
```

The orchestrator turns that into `foundry-gate-blocked`, so provider fetch is never reached. If serialization or scanning throws, the gate still returns `{ ok:false, reason:'secret-scan failed closed: ...' }`. The gate warns with rule/type only and a redacted indicator; it never logs the secret value. This is the kind of gate that actually catches bad payloads before they leave the box, not an audit checkbox after exfiltration.

## Audit record schema

One JSON object per line:

- `timestamp` — ISO 8601 UTC
- `deployment` — Foundry deployment name
- `provider` — `anthropic`, `openai`, or `openai-reasoning`
- `modelId` — configured model id
- `payload_sha256` — SHA-256 of a safe serialization of the payload; never the payload
- `outcome` — `ok`, `blocked`, `auth-failed`, or `provider-error`
- `status_code` — provider HTTP status when present, else `null`
- `gate` — blocking gate name for blocked calls, else `null`
- `usage` — `{ inputTokens, outputTokens, totalTokens, cachedInputTokens, reasoningTokens }` or `null`

Audit is post-dispatch best effort. It catches write failures, emits a warning, and must not alter route results.

## Audit path and gitignore

Default path: `.secops/foundry-audit.jsonl` under `ctx.rootDir`. `.gitignore` now includes `.secops/foundry-audit.jsonl`.

## Smoke checks

Runnable command:

```powershell
node lib\foundry\gates\smoke-check.js
```

It proves:

1. A payload with a fake bearer secret is blocked pre-dispatch.
2. A clean payload passes, writes exactly one audit line, and the audit contains a SHA-256 hash instead of payload text.

## Carver test coverage needed

- Secret scan blocks AWS keys, private keys, JWTs, bearer tokens, API keys, connection strings, and contextual password/client-secret fields.
- Secret scan does not log matched secret values.
- Secret scan serialization/scanner exception still blocks (`scan throws -> still blocks`).
- Provider `fetchFn` is never called on a secret block.
- Audit writes exactly one JSONL record for success, provider error, auth failure, and gate block.
- Audit records hash-not-payload and never includes raw payload content.
- Audit write failure degrades gracefully with a warning and does not change route result.
