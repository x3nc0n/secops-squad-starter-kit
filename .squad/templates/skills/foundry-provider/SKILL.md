# SKILL: Foundry Provider — Node.js REST Abstraction for Azure AI Foundry

**Owner:** Sydnor (Platform Dev)
**Scope:** `lib/foundry/` module; `.secops/foundry.yaml` config; `cli/commands/foundry.js`
**Applies to:** Any agent or CLI command that wants to route a task to a non-catalog model via Azure AI Foundry.

---

## When to Use This Skill

Use the Foundry provider when:
- `.secops/foundry.yaml` exists and `foundry.enabled: true`
- The task is on the "Route to Fable 5" list (large SARIF, multi-file vuln, threat model, IR timeline, 10+ KQL rules)
- A call to `getFoundryProvider()` returns non-null

Do NOT use when:
- `.secops/foundry.yaml` is absent or `enabled: false` — fall back silently
- The task fits a standard model (single file, conversational, quick lookup)
- `cost_ceiling_usd` has been hit for the day

---

## Module Layout

```
lib/foundry/
  index.js              public API
  config.js             load + validate .secops/foundry.yaml
  auth.js               az CLI shell-out, in-memory token cache
  telemetry.js          append to .secops/foundry-telemetry.jsonl
  providers/
    anthropic.js        Anthropic Messages API (claude-fable-5)
    openai-reasoning.js Azure OpenAI reasoning models (o4-mini)
```

---

## Public API (`lib/foundry/index.js`)

```js
'use strict';
const { loadFoundryConfig } = require('./config');
const { dispatchToProvider } = require('./providers');

/**
 * Returns the active Foundry provider, or null if Foundry is unavailable.
 * Callers treat null as "use standard model".
 *
 * @param {string} [rootDir] - defaults to process.cwd()
 * @returns {Promise<FoundryProvider|null>}
 */
async function getFoundryProvider(rootDir) { /* ... */ }

/**
 * @typedef {Object} FoundryProvider
 * @property {string} modelId
 * @property {string} deploymentName
 * @property {string} providerType - 'anthropic' | 'openai-reasoning' | 'openai'
 * @property {(messages: Array, opts?: CompletionOpts) => Promise<CompletionResult>} complete
 */

/**
 * @typedef {Object} CompletionOpts
 * @property {number} [maxTokens=4096]
 * @property {string} [reasoningEffort='medium'] - for reasoning models only
 * @property {string} [systemPrompt]
 * @property {number} [costCeilingUsd] - override per-call ceiling
 */

/**
 * @typedef {Object} CompletionResult
 * @property {boolean} ok
 * @property {string} [content]
 * @property {{inputTokens: number, outputTokens: number, cacheHit: boolean}} [usage]
 * @property {number} [latencyMs]
 * @property {string} [provider]
 * @property {string} [error]
 */
```

**Caller pattern (agent or command):**
```js
const { getFoundryProvider } = require('../../lib/foundry');

const provider = await getFoundryProvider(rootDir);
if (!provider) {
  // Fall back to standard model — do not throw
  return standardAnalysis(content);
}
const result = await provider.complete(
  [{ role: 'user', content: sarifContent }],
  { maxTokens: 8192, systemPrompt: ANALYST_SYSTEM_PROMPT }
);
if (!result.ok) {
  console.warn(`[foundry] ${result.error} — falling back`);
  return standardAnalysis(content);
}
return result.content;
```

---

## Config (`lib/foundry/config.js`)

Reads `.secops/foundry.yaml` via `require('../secops-config').readYaml()`. Validates:
1. `schema_version === '1.0'`
2. `foundry.enabled === true`
3. `foundry.active_model` is set
4. A matching entry in `foundry.model_deployments` has `status === 'active'`
5. `foundry.endpoint` is a non-empty string (no trailing path — validated with URL constructor)

Returns `null` (not throw) on any failure — Foundry is optional.

---

## Auth (`lib/foundry/auth.js`)

```js
'use strict';
const { execSync } = require('child_process');

// Mirrors lib/graph-security/auth.js token cache pattern
const tokenCache = new Map(); // key → {token, expiresAt}

async function getFoundryToken() {
  const key = 'foundry:cognitiveservices';
  const cached = getCachedToken(key);
  if (cached) return { ok: true, token: cached.token };

  // Prefer env var (CI/CD, no az CLI required)
  if (process.env.FOUNDRY_API_KEY) {
    // API key — no expiry concern, cache for session duration
    tokenCache.set(key, { token: process.env.FOUNDRY_API_KEY, expiresAt: Infinity });
    return { ok: true, token: process.env.FOUNDRY_API_KEY, isApiKey: true };
  }

  try {
    const out = execSync(
      'az account get-access-token --resource https://cognitiveservices.azure.com --query "{token:accessToken,expiry:expiresOn}" -o json',
      { encoding: 'utf8', timeout: 15000, stdio: ['pipe','pipe','pipe'] }
    );
    const { token, expiry } = JSON.parse(out);
    const expiresAt = new Date(expiry).getTime();
    tokenCache.set(key, { token, expiresAt });
    return { ok: true, token };
  } catch (err) {
    return { ok: false, error: `az token acquisition failed: ${err.message}. Run: az login` };
  }
}
```

**Cache behaviour:** Same `getCachedToken` logic as `lib/graph-security/auth.js` — 5-minute expiry buffer, `tokenCache.delete()` on eviction. Token lifetime is ~1 hour (Entra default). `clearFoundryTokenCache()` exported for tests.

---

## Telemetry (`lib/foundry/telemetry.js`)

Appends one JSON line per call to `.secops/foundry-telemetry.jsonl` (gitignored):
```json
{"ts":"2026-06-25T19:31:35Z","model":"claude-fable-5","provider":"anthropic","inputTokens":4200,"outputTokens":312,"cacheHit":false,"latencyMs":3400,"estimatedCostUsd":0.0573}
```

**Cost ceiling enforcement:**
```js
function getTodaySpend(rootDir) {
  // Read .secops/foundry-telemetry.jsonl, sum estimatedCostUsd for today's UTC date
}

function estimateCost(inputTokens, outputTokens, cacheHit, pricing) {
  const inputCost = (cacheHit ? inputTokens * 0.1 : inputTokens) / 1e6 * pricing.input_per_million_tokens;
  const outputCost = outputTokens / 1e6 * pricing.output_per_million_tokens;
  return inputCost + outputCost;
}
```

Before making an API call: `if (getTodaySpend(rootDir) + estimatedCallCost > costCeiling) return {ok:false, error:'daily cost ceiling reached'}`.

---

## Provider Dispatch

### Anthropic (`providers/anthropic.js`)

```
POST {endpoint}{api_path}
  Authorization: Bearer {entra_token}
  Content-Type: application/json
  x-ms-model-mesh-model-name: {deployment_name}   // Azure Foundry routing header
  anthropic-version: 2023-06-01

Body: { model: deploymentName, max_tokens, messages, system? }
```

No `anthropic` npm package needed. Pure `fetch()`.

### OpenAI Reasoning (`providers/openai-reasoning.js`)

```
POST {endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}
  Authorization: Bearer {entra_token}
  Content-Type: application/json

Body: { messages, max_completion_tokens, reasoning_effort }
```

No `openai` npm package needed. Pure `fetch()`.

---

## CLI: `secops-squad foundry`

Module: `cli/commands/foundry.js`

| Subcommand | What it does |
|---|---|
| `foundry status` | Load config, check `az` login, report enabled/disabled, active model, daily spend so far |
| `foundry test` | Send a minimal test message ("Respond with OK.") to the active deployment; report latency and token count |
| `foundry route <task>` | Print which provider would be selected for a named task type; useful for dry-run debugging |

Register in `cli/index.js` COMMANDS map:
```js
foundry: {
  description: 'Manage Azure AI Foundry model add-on (optional)',
  usage: 'secops-squad foundry [status|test|route <task>]',
  module: './commands/foundry.js',
},
```

---

## Doctor Integration

Add to `cli/commands/doctor.js` `checks` array (after `checkAzureConnectivity`):

```js
function checkFoundry(rootDir) {
  const configPath = path.join(rootDir, '.secops', 'foundry.yaml');
  if (!fs.existsSync(configPath)) {
    return { status: 'skip', message: 'Foundry: not configured (optional)' };
  }
  // load config, check enabled, check active deployment exists
  // return pass/warn — never fail (Foundry is opt-in)
}
```

Doctor exits with code 0 even if Foundry warns — it is **not** a required check.

---

## Deprecation Trigger

When `claude-fable-5` (or the target model) appears in the GitHub Copilot model catalog:
1. Delete `lib/foundry/` entirely.
2. Delete `cli/commands/foundry.js`.
3. Remove the `foundry` entry from `cli/index.js` COMMANDS.
4. Remove `checkFoundry` from `doctor.js`.
5. Delete `scripts/deploy-foundry-fable5.{ps1,sh}`.
6. Delete `skills/platform/foundry-model-routing.md`.
7. Users: `rm .secops/foundry.yaml` and deprovision the Azure resource.

The module boundary is clean by design — deletion is the upgrade path.
