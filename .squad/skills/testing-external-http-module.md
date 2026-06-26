# Skill: Testing an External HTTP Module Without a Live Endpoint

**Domain:** testing  
**Author:** Carver  
**Created:** 2026-06-25  
**Applies to:** Any `lib/` module that calls an external HTTP API (Azure, Graph, Foundry, etc.)

---

## Pattern

Use Node's built-in `node:test` `mock.fn()` to replace `globalThis.fetch`. No external mock library needed. This works for any module that uses native `fetch` (Node 18+).

### Core helpers (copy-paste into any `*.test.js`)

```js
import { mock } from 'node:test';

/** Install a fake fetch that returns a preset HTTP response. */
function mockFetch(status, body, headers = {}) {
  const headerMap = new Map(Object.entries(headers));
  const fn = mock.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headerMap.get(name) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  globalThis.fetch = fn;
  return fn;
}

/** Install a fake fetch that simulates a network failure. */
function mockFetchError(message = 'connect ECONNREFUSED') {
  const fn = mock.fn(async () => { throw new Error(message); });
  globalThis.fetch = fn;
  return fn;
}

/** Install a fake fetch that times out after `ms` milliseconds. */
function mockFetchTimeout(ms = 5000) {
  const fn = mock.fn(() => new Promise((_, reject) =>
    setTimeout(() => reject(new Error('fetch timeout')), ms)
  ));
  globalThis.fetch = fn;
  return fn;
}
```

### Sequence mock (different response per call)

```js
function mockFetchSequence(...responses) {
  let i = 0;
  globalThis.fetch = mock.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)];
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: () => null },
      json: async () => r.body,
      text: async () => JSON.stringify(r.body),
    };
  });
}
// Use: mockFetchSequence({status:401,body:{error:'Unauthorized'}}, {status:200,body:{token:'x'}})
// First call → 401, second call → 200 (simulates token refresh retry)
```

### Fixture file layout (mirror `lib/kql-validator/fixtures/`)

```
lib/{module}/
  fixtures/
    valid-config.yaml          ← canonical happy-path config
    disabled-config.yaml       ← enabled: false
    malformed-config.yaml      ← invalid YAML
    schema-drifted-config.yaml ← snake_case when module expects camelCase
    partial-config.yaml        ← required fields missing
    sample-payload.json        ← realistic request body
    payload-with-secrets.json  ← PII/credential payload for redaction tests
    sample-response.json       ← realistic success response
    sarif-small.json           ← SARIF with < 10 findings
    sarif-large.json           ← SARIF with 200+ findings (oversized payload test)
  {module}.test.js
  index.js
```

### Token expiry test pattern

```js
it('re-acquires token when cached token is near expiry', async () => {
  // Seed a token expiring in 3 minutes (below the 5-min refresh buffer)
  tokenCache.set('key', { token: 'old', expiresAt: Date.now() + 3 * 60 * 1000 });
  const fetchFn = mockFetch(200, { access_token: 'new-token', expires_in: 3600 });
  const result = await acquireToken(/* params */);
  assert.equal(result.token, 'new-token');
  assert.equal(fetchFn.mock.callCount(), 1, 'should have fetched a new token');
});
```

### Fallback contract

Every API wrapper that calls an external endpoint must satisfy:

```
on 401 → ok: false, error contains "401" or "Unauthorized", does NOT throw
on 404 → ok: false, error contains "404" or "Not Found", does NOT throw
on 429 → ok: false, error contains "429" or "rate limit", does NOT throw
on timeout → ok: false, error contains "timeout" or "network", does NOT throw
on network error → ok: false, error contains message from thrown Error, does NOT throw
```

Test this with one `it()` per error code. Use `assert.doesNotThrow` / `assert.rejects` never (the contract forbids throws at the API boundary).

### Safety/redaction test pattern

```js
const DANGEROUS_PATTERNS = [
  '-----BEGIN RSA PRIVATE KEY-----',   // PEM private key
  'AKIA[0-9A-Z]{16}',                  // AWS access key
  'ghp_[A-Za-z0-9]{36}',               // GitHub PAT
  'password=hunter2',                   // obvious credential in query string
];

for (const pattern of DANGEROUS_PATTERNS) {
  it(`blocks payload containing: ${pattern.slice(0,30)}`, async () => {
    const fetchFn = mockFetch(200, { choices: [] });
    const result = await routeToFoundry({ content: `some text ${pattern} more text` });
    // Either blocked before the call:
    assert.equal(fetchFn.mock.callCount(), 0, 'must not call endpoint with secret payload');
    // Or redacted in the call body:
    // const body = JSON.parse(fetchFn.mock.calls[0].arguments[1].body);
    // assert.doesNotMatch(JSON.stringify(body), new RegExp(pattern));
  });
}
```

## When to Use

- Any new `lib/` module that calls Azure REST APIs, Graph, or third-party AI endpoints
- Any module that reads config from disk (`.secops/`, `secops-squad.config.json`) — use temp fixtures, not real files
- Any module with auth/token logic — always test the expiry/refresh path

## When NOT to Use

- KQL validation (Freamon's validator uses a local parser, not HTTP — no mock needed)
- Pure utility functions (no I/O)
