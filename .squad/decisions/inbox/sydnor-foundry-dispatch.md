# Sydnor — Foundry Dispatch Orchestrator

**Date:** 2026-06-25T21:40:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-dispatch`: `lib/foundry/index.js` only. Hook call sites defined; gate bodies intentionally not implemented.

## Exported signatures

```js
const { getFoundryProvider, routeToFoundry } = require('./lib/foundry');

getFoundryProvider({
  rootDir,          // optional, defaults process.cwd()
  deploymentName,  // optional model_id or deployment_name override
});

await routeToFoundry({
  rootDir,          // optional, defaults process.cwd()
  deploymentName,  // optional model_id or deployment_name override
  payload,          // provider request body
  hooks,            // optional safety hook object or preDispatch array
  fetchFn,          // optional injectable fetch for tests
  execFn,           // optional injectable az exec for tests
  timeoutMs,        // optional provider timeout
});
```

`getFoundryProvider()` returns `{ok:true, config, deployment, provider, client, endpoint, modelId, deploymentName}` or `{ok:false,error,...}`. It does not acquire credentials.

`routeToFoundry()` returns the provider client result plus `{provider, modelId, deploymentName, latencyMs}` on provider success/failure, or an orchestrator `{ok:false,...}` failure. It never throws.

## Hook contract Kima should implement against

Preferred shape:

```js
hooks: {
  preDispatch: [
    { name: 'secret-scan', run: async (ctx) => ({ ok: true }) }
  ],
  postDispatch: [
    { name: 'audit', run: async (ctx, result) => undefined }
  ]
}
```

Functions are also accepted:

```js
hooks: {
  preDispatch: [async function secretScan(ctx) { return { ok: true }; }],
  postDispatch: [async function audit(ctx, result) {}]
}
```

For shorthand, `hooks: [fn1, fn2]` means `preDispatch: [fn1, fn2]`.

### `ctx` fields

```js
{
  rootDir,
  payload,
  provider,         // 'anthropic' | 'openai' | 'openai-reasoning'
  modelId,
  deploymentName,
  deployment,       // active deployment config entry
  endpoint,         // resolved request URL, no secrets
  apiVersion,
  timestamp
}
```

No token or API key is placed in `ctx`.

### Pre-dispatch

- Runs in order after config/provider/auth resolution and before provider `fetch`.
- Return `undefined` or `{ok:true}` to continue.
- Return `{ok:false, reason}` to block.
- Throwing is treated as a fail-closed block.
- Block result:

```js
{ ok:false, error:'foundry-gate-blocked', gate:'secret-scan', reason:'...' }
```

### Post-dispatch

- Runs after the final route result is known.
- Runs for auth failures, provider responses, and pre-dispatch blocks, so Audit can record both allowed and blocked attempts.
- Receives `(ctx, result)`.
- Return value is ignored.
- Throws are swallowed and warned; post hooks do not change the route result.

P0 production hooks are expected to be named `secret-scan` in `preDispatch` and `audit` in `postDispatch`. `routeToFoundry()` warns if either is absent. Current defaults are no-op for development only.

## Deployment → provider mapping

| `deployment.provider` | Client |
|---|---|
| `anthropic` | `providers/anthropic.js::callAnthropic` |
| `openai` | `providers/openai.js::callOpenAI` |
| `openai-reasoning` | `providers/openai.js::callOpenAI` |

Missing `provider` defaults to `openai`. Any other provider returns `{ok:false,error:'foundry-provider-unsupported',provider}`.

Deployment selection:

1. If `deploymentName` is supplied, match an active deployment where `deployment_name` or `model_id` equals it.
2. Otherwise match active deployment where `model_id === foundry.active_model`.

## `{ok:false}` error codes

| Error | Source |
|---|---|
| `foundry-not-configured` | `loadFoundryConfig(rootDir)` returned `null` |
| `foundry-deployment-not-found` | No active deployment matched active model or requested deployment |
| `foundry-provider-unsupported` | Provider not in the dispatch map |
| `foundry-provider-resolution-failed: ...` | Unexpected provider selection/endpoint failure |
| `foundry-auth-failed` | `getFoundryToken({execFn})` returned `{ok:false}` |
| `foundry-gate-blocked` | A pre-dispatch hook returned `{ok:false}` or threw |
| `foundry-route-failed` | Unexpected top-level orchestrator error |

Provider clients keep their existing fallback contract for HTTP/network/timeout failures:

```js
{ ok:false, status:number, error:string }
```

No orchestrator failure path logs secrets or throws.
