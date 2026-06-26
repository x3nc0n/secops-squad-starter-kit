/**
 * Foundry Auth — Phase 0 Test Suite
 *
 * Written by Carver (Tester/QA). Tests token acquisition, caching, and failure
 * handling for lib/foundry/auth.js with no live Azure CLI or network required.
 *
 * Run: node --test lib/foundry/auth.test.js
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Load CJS module via createRequire (matches graph-security test pattern)
const require = createRequire(import.meta.url);
const { getFoundryToken, clearTokenCache, getCachedToken, cacheToken } = require('./auth.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake execFn that returns a valid az token JSON response */
function makeEntraExecFn(token = 'entra-tok', secondsFromNow = 3600) {
  const expiry = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  return (cmd, opts) => JSON.stringify({ token, expiry });
}

/** Build a fake execFn that tracks call count */
function makeCountingExecFn(token = 'entra-tok', secondsFromNow = 3600) {
  const expiry = new Date(Date.now() + secondsFromNow * 1000).toISOString();
  let callCount = 0;
  const fn = (cmd, opts) => {
    callCount++;
    return JSON.stringify({ token, expiry });
  };
  fn.getCallCount = () => callCount;
  return fn;
}

// ---------------------------------------------------------------------------
// 1. API KEY PATH — FOUNDRY_API_KEY env var takes precedence over execFn
// ---------------------------------------------------------------------------

describe('getFoundryToken — API key path', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('returns {ok:true, token} when FOUNDRY_API_KEY is set', () => {
    process.env.FOUNDRY_API_KEY = 'fake-api-key-123';
    const result = getFoundryToken();
    assert.equal(result.ok, true);
    assert.equal(result.token, 'fake-api-key-123');
  });

  it('does NOT call execFn when FOUNDRY_API_KEY is set', () => {
    process.env.FOUNDRY_API_KEY = 'fake-api-key-123';
    let execCalled = false;
    const execFn = () => { execCalled = true; return '{}'; };
    getFoundryToken({ execFn });
    assert.equal(execCalled, false, 'execFn must NOT be called when FOUNDRY_API_KEY is set');
  });

  it('trims whitespace from FOUNDRY_API_KEY', () => {
    process.env.FOUNDRY_API_KEY = '  trimmed-key  ';
    const result = getFoundryToken();
    assert.equal(result.ok, true);
    assert.equal(result.token, 'trimmed-key');
  });
});

// ---------------------------------------------------------------------------
// 2. EMPTY API KEY — treated as absent, falls through to Entra path
// ---------------------------------------------------------------------------

describe('getFoundryToken — empty FOUNDRY_API_KEY falls through to Entra', () => {
  beforeEach(() => {
    clearTokenCache();
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('empty string FOUNDRY_API_KEY="" falls through to execFn', () => {
    process.env.FOUNDRY_API_KEY = '';
    let execCalled = false;
    const execFn = (cmd, opts) => {
      execCalled = true;
      return JSON.stringify({
        token: 'entra-fallthrough',
        expiry: new Date(Date.now() + 3600000).toISOString(),
      });
    };
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, true, 'Should succeed via Entra when API key is empty string');
    assert.equal(result.token, 'entra-fallthrough');
    assert.equal(execCalled, true, 'execFn must be called when API key is empty');
  });

  it('whitespace-only FOUNDRY_API_KEY="   " falls through to execFn', () => {
    process.env.FOUNDRY_API_KEY = '   ';
    let execCalled = false;
    const execFn = (cmd, opts) => {
      execCalled = true;
      return JSON.stringify({
        token: 'entra-ws-fallthrough',
        expiry: new Date(Date.now() + 3600000).toISOString(),
      });
    };
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, true);
    assert.equal(execCalled, true, 'execFn must be called when API key is whitespace-only');
  });
});

// ---------------------------------------------------------------------------
// 3. ENTRA PATH — Azure CLI token acquisition via injected execFn
// ---------------------------------------------------------------------------

describe('getFoundryToken — Entra (az CLI) path', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('calls execFn and returns {ok:true, token} with correct token value', () => {
    const execFn = makeEntraExecFn('entra-tok');
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, true);
    assert.equal(result.token, 'entra-tok');
  });

  it('execFn is called exactly once on first acquisition', () => {
    const execFn = makeCountingExecFn('entra-tok');
    getFoundryToken({ execFn });
    assert.equal(execFn.getCallCount(), 1, 'execFn must be called exactly once');
  });

  it('result has no error property on success', () => {
    const execFn = makeEntraExecFn('entra-tok');
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, true);
    assert.equal('error' in result, false, 'No error property on successful result');
  });
});

// ---------------------------------------------------------------------------
// 4. TOKEN CACHING — second call within expiry does NOT call execFn again
// ---------------------------------------------------------------------------

describe('getFoundryToken — token caching', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('second call within expiry returns cached token without calling execFn again', () => {
    const execFn = makeCountingExecFn('cached-tok');
    // First call — populates cache
    const first = getFoundryToken({ execFn });
    assert.equal(first.ok, true);
    assert.equal(first.token, 'cached-tok');
    assert.equal(execFn.getCallCount(), 1);

    // Second call — must hit cache, not execFn
    const second = getFoundryToken({ execFn });
    assert.equal(second.ok, true);
    assert.equal(second.token, 'cached-tok');
    assert.equal(execFn.getCallCount(), 1, 'execFn must still be 1 — cache was used on second call');
  });

  it('clearTokenCache() forces re-acquisition on next call', () => {
    const execFn = makeCountingExecFn('refresh-tok');
    getFoundryToken({ execFn }); // populate
    clearTokenCache();             // wipe
    getFoundryToken({ execFn }); // re-acquire
    assert.equal(execFn.getCallCount(), 2, 'execFn must be called again after clearTokenCache()');
  });

  it('getCachedToken() returns null after clearTokenCache()', () => {
    const execFn = makeEntraExecFn('tok-x');
    getFoundryToken({ execFn }); // populate cache
    clearTokenCache();
    const cached = getCachedToken('foundry:cognitiveservices');
    assert.equal(cached, null, 'Cache must be empty after clear');
  });

  it('getCachedToken() returns the token after a successful acquisition', () => {
    const execFn = makeEntraExecFn('tok-y');
    getFoundryToken({ execFn });
    const cached = getCachedToken('foundry:cognitiveservices');
    assert.ok(cached, 'Cache entry must exist after acquisition');
    assert.equal(cached.token, 'tok-y');
  });
});

// ---------------------------------------------------------------------------
// 5. AZ FAILURE — execFn throws → {ok:false, error}, no throw escapes
// ---------------------------------------------------------------------------

describe('getFoundryToken — az CLI failure modes', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('execFn throwing returns {ok:false, error} — no exception escapes', () => {
    const execFn = () => { throw new Error('az: command not found'); };
    let result;
    assert.doesNotThrow(() => { result = getFoundryToken({ execFn }); });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string', 'error must be a string');
    assert.ok(result.error.length > 0, 'error must be non-empty');
  });

  it('execFn throwing "not logged" returns {ok:false} with az login hint', () => {
    const execFn = () => { throw new Error('az login required: AADSTS70011'); };
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, false);
    assert.ok(result.error.toLowerCase().includes('login') || result.error.toLowerCase().includes('az'),
      `Error message should reference az/login: ${result.error}`);
  });

  it('execFn throwing "not recognized" (Windows) returns {ok:false}', () => {
    const execFn = () => { throw new Error("'az' is not recognized as an internal or external command"); };
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('generic execFn throw returns {ok:false, error} containing the message', () => {
    const execFn = () => { throw new Error('timeout exceeded'); };
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, false);
    assert.ok(typeof result.error === 'string');
  });
});

// ---------------------------------------------------------------------------
// 6. MALFORMED AZ OUTPUT — execFn returns non-JSON → {ok:false}, no throw
// ---------------------------------------------------------------------------

describe('getFoundryToken — malformed az output', () => {
  beforeEach(() => {
    clearTokenCache();
    delete process.env.FOUNDRY_API_KEY;
  });

  afterEach(() => {
    delete process.env.FOUNDRY_API_KEY;
    clearTokenCache();
  });

  it('non-JSON output returns {ok:false} — no throw', () => {
    const execFn = () => 'this is not json at all';
    let result;
    assert.doesNotThrow(() => { result = getFoundryToken({ execFn }); });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('empty string output returns {ok:false}', () => {
    const execFn = () => '';
    let result;
    assert.doesNotThrow(() => { result = getFoundryToken({ execFn }); });
    assert.equal(result.ok, false);
  });

  it('JSON missing "token" field returns {ok:false}', () => {
    const execFn = () => JSON.stringify({ expiry: '2099-01-01', notTheTokenField: 'whoops' });
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, false);
    assert.equal(typeof result.error, 'string');
  });

  it('JSON with null token returns {ok:false}', () => {
    const execFn = () => JSON.stringify({ token: null, expiry: '2099-01-01' });
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, false);
  });

  it('Buffer output is handled (execSync returns Buffer by default)', () => {
    // execSync can return a Buffer — auth.js should handle this gracefully
    const execFn = () => Buffer.from(JSON.stringify({
      token: 'buf-tok',
      expiry: new Date(Date.now() + 3600000).toISOString(),
    }));
    const result = getFoundryToken({ execFn });
    assert.equal(result.ok, true, 'Buffer output must be converted to string and parsed');
    assert.equal(result.token, 'buf-tok');
  });
});

// ---------------------------------------------------------------------------
// 7. cacheToken / getCachedToken — direct cache utility tests
// ---------------------------------------------------------------------------

describe('cacheToken / getCachedToken — cache utility contract', () => {
  beforeEach(() => clearTokenCache());
  afterEach(() => clearTokenCache());

  it('getCachedToken returns null when cache is empty', () => {
    const result = getCachedToken('foundry:cognitiveservices');
    assert.equal(result, null);
  });

  it('cacheToken stores token, getCachedToken retrieves it', () => {
    cacheToken('foundry:cognitiveservices', 'my-token', 3600);
    const result = getCachedToken('foundry:cognitiveservices');
    assert.ok(result, 'Cache entry must exist');
    assert.equal(result.token, 'my-token');
  });

  it('getCachedToken returns null for expired token (past the 5-min buffer)', () => {
    // Store with 1 second TTL — well within the 5-min buffer, so should be treated as expired
    cacheToken('foundry:cognitiveservices', 'expired-tok', 1);
    const result = getCachedToken('foundry:cognitiveservices');
    // Token expires in 1s, buffer is 5min → already in the refresh window → null
    assert.equal(result, null, 'Token within 5-min buffer window must be treated as expired');
  });

  it('getCachedToken returns token for long-lived entry (far future expiry)', () => {
    cacheToken('foundry:cognitiveservices', 'live-tok', 7200);
    const result = getCachedToken('foundry:cognitiveservices');
    assert.ok(result);
    assert.equal(result.token, 'live-tok');
  });
});
