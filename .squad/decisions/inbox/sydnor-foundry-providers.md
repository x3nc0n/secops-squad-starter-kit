# Sydnor — Foundry Provider Clients

**Date:** 2026-06-25T21:30:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-providers` only. No dispatch orchestrator or safety gates.

## Function signatures

- `callAnthropic({ endpoint, apiVersion, token, apiKey, authType, deployment, payload, fetchFn, timeoutMs })`
- `callOpenAI({ endpoint, apiVersion, token, apiKey, authType, deployment, payload, fetchFn, timeoutMs })`

Both are async CommonJS exports from `lib/foundry/providers/anthropic.js` and `lib/foundry/providers/openai.js`.

## Fallback contract

Success:

```js
{ ok: true, status: number, data: object, usage: object }
```

Failure, including HTTP 401/403/404/429, any other non-2xx HTTP status, network error, invalid URL, missing fetch, or timeout:

```js
{ ok: false, status: number, error: string }
```

For network errors and timeouts, `status` is `0` because there is no HTTP response. Provider clients do not throw for dispatch failures.

## Header/auth choices

- Anthropic:
  - Bearer mode: `Authorization: Bearer {token}`
  - API-key mode: `x-api-key: {apiKeyOrToken}`
  - Always sends `Content-Type: application/json`, `Accept: application/json`, `anthropic-version`, and `x-ms-model-mesh-model-name` when `deployment.deployment_name` exists.
- OpenAI:
  - Bearer mode: `Authorization: Bearer {token}`
  - API-key mode: `api-key: {apiKeyOrToken}`
  - Always sends `Content-Type: application/json` and `Accept: application/json`.

Default is bearer token because `getFoundryToken()` primarily returns an Entra token. API-key auth is explicit via `apiKey`, `authType: 'api-key'`, or a token object with `{ token, isApiKey: true }` / `{ token, type: 'api-key' }`.

## Timeout

Default timeout is 60,000 ms. Callers can override with `timeoutMs`. Timeout returns `{ ok:false, status:0, error:'Request timed out after ...ms' }`.

## Carver test assumptions to verify

- Mock `fetchFn` receives the exact provider headers without leaking secrets to errors.
- Anthropic body maps `maxTokens` to `max_tokens` and includes `model` from `deployment.deployment_name` when omitted.
- OpenAI reasoning deployments map `maxTokens` to `max_completion_tokens` and `reasoningEffort` to `reasoning_effort`; non-reasoning maps to `max_tokens`.
- `apiVersion` is appended only when OpenAI `endpoint` lacks `api-version=`.
- Mock 401/403/404/429, ECONNREFUSED, invalid URL, and hung fetch all return `{ok:false}` and never throw.
