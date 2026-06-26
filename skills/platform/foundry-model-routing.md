# Foundry Model Routing — Deep Analysis via Azure AI Foundry

> **Status:** Optional add-on skill — only active when `.secops/foundry.yaml` is present and `foundry.enabled: true`.
>
> **Current model:** `o4-mini` (OpenAI reasoning model) — stopgap while Anthropic quota is pending.
> **Target model:** `claude-fable-5` — will be swapped in when quota is granted, or deprecated when available in the GitHub Copilot model catalog.

---

## 1. Detection — Is a Foundry Model Available?

Before routing any task to Foundry, check whether the add-on is deployed:

```
1. Look for .secops/foundry.yaml in the project root.
2. Parse the YAML. Check foundry.enabled == true.
3. Read foundry.active_model to determine which model to use.
4. Find the matching entry in foundry.model_deployments where status == "active".
5. If any check fails → fall back to standard model. Do NOT error out.
```

**Detection fields (canonical schema — all snake_case):**
- `foundry.enabled` — must be `true`
- `foundry.active_model` — model_id of the deployment to use
- `foundry.model_deployments[].status` — must be `"active"` for the matching entry
- `foundry.model_deployments[].provider` — `"anthropic"` | `"openai"` | `"openai-reasoning"`
- `foundry.model_deployments[].api_path` — provider-specific REST route (anthropic only)
- `foundry.model_deployments[].reasoning_model` — `true` for o-series reasoning models
- `foundry.api_version` — REST api-version for OpenAI-compatible endpoints

**Detection (Node.js / CommonJS):**
```js
// From a skill or CLI command — path assumes running from project root
const { loadFoundryConfig } = require('../../lib/foundry/config');

function foundryModelAvailable(projectRoot) {
  const data = loadFoundryConfig(projectRoot);
  if (!data) return null;  // disabled, missing, or no active deployment

  const foundry = data.foundry;
  const active = foundry.model_deployments.find(
    (d) => d.model_id === foundry.active_model && d.status === 'active'
  );
  if (!active) return null;

  return {
    endpoint: foundry.endpoint,          // clean base URL
    api_version: foundry.api_version,
    deployment_name: active.deployment_name,
    api_path: active.api_path,           // e.g. "/anthropic/v1/messages"
    reasoning_model: active.reasoning_model || false,
    provider: active.provider,           // "anthropic" | "openai" | "openai-reasoning"
    resource_name: foundry.resource_name,
  };
}
```

---

## 2. When to Route to Fable 5

Route to Fable 5 **only** for tasks that genuinely benefit from its extended context and deep reasoning. Unnecessary routing increases cost.

### ✅ Route to Fable 5

| Task | Why Fable 5 |
|------|-------------|
| **Deep SARIF analysis** — reviewing SARIF files with hundreds of findings, correlating across tools | Requires holding large result sets and cross-referencing rule metadata |
| **Large codebase security review** — reviewing entire repos or multi-file change sets for vulnerabilities | Context window advantage; standard models truncate or miss inter-file dependencies |
| **Multi-file vulnerability correlation** — tracing a vuln from source to sink across many files | Requires following data flows across file boundaries simultaneously |
| **Threat model generation** — full STRIDE/MITRE mapping on complex architectures with many components | Benefits from holistic reasoning over a large system description |
| **IR timeline reconstruction** — assembling an incident timeline from many log snippets | Long context lets it hold the full chronology at once |
| **Detection rule review** — reviewing 10+ KQL rules for logic overlap, gaps, and MITRE coverage | Holds the full rule set in context to find cross-rule patterns |

### ❌ Use Standard Model Instead

- Single-file queries or small code snippets
- Conversational Q&A, quick lookups, simple summaries
- Tasks where the context fits comfortably in a standard model
- Any task where cost sensitivity outweighs analytical depth

---

## 3. Calling the Endpoint

### Authentication

Foundry models support **two auth modes** — use whichever fits your deployment:

**Mode A: Azure Entra ID (recommended for automated/agent use)**
```js
const { getFoundryToken } = require('../../lib/foundry/auth');

// Synchronous — checks cache first, then az CLI, then returns {ok, token} or {ok:false, error}
const auth = getFoundryToken();
if (!auth.ok) throw new Error(`Foundry auth failed: ${auth.error}`);
const bearerToken = auth.token;
```

**Mode B: API Key**
```js
// Set FOUNDRY_API_KEY in environment — getFoundryToken() picks it up automatically.
// No code change needed; the env var takes priority over az CLI.
```

### Using the public provider API (Phase 1 — via lib/foundry/index.js)

```js
// getFoundryProvider returns a {complete(messages, opts)} object or null.
const { getFoundryProvider } = require('../../lib/foundry');

async function analyzeWithFoundry(projectRoot, messages) {
  const provider = await getFoundryProvider(projectRoot);
  if (!provider) {
    // Foundry unavailable — fall back to standard model
    return null;
  }
  return provider.complete(messages, { maxTokens: 4096 });
  // Returns: {ok, content, usage, latencyMs, provider, cached}
}
```

### Direct fetch — Anthropic models (claude-fable-5)

```js
const { loadFoundryConfig, resolveEndpoint } = require('../../lib/foundry/config');
const { getFoundryToken } = require('../../lib/foundry/auth');

async function callFoundryAnthropic(projectRoot, messages, opts = {}) {
  const data = loadFoundryConfig(projectRoot);
  if (!data) throw new Error('Foundry not available');

  const foundry = data.foundry;
  const deployment = foundry.model_deployments.find(
    (d) => d.model_id === foundry.active_model && d.status === 'active'
  );

  const url = resolveEndpoint(data, deployment);
  const auth = getFoundryToken();
  if (!auth.ok) throw new Error(`Foundry auth failed: ${auth.error}`);

  const body = {
    model: deployment.deployment_name,
    max_tokens: opts.maxTokens || 4096,
    messages,
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
      'x-ms-model-mesh-model-name': deployment.deployment_name,
    },
    body: JSON.stringify(body),
  });

  return resp.json();
}
```

### Direct fetch — OpenAI / reasoning models (o4-mini, GPT-5.x)

```js
const { loadFoundryConfig, resolveEndpoint } = require('../../lib/foundry/config');
const { getFoundryToken } = require('../../lib/foundry/auth');

async function callFoundryOpenAI(projectRoot, messages, opts = {}) {
  const data = loadFoundryConfig(projectRoot);
  if (!data) throw new Error('Foundry not available');

  const foundry = data.foundry;
  const deployment = foundry.model_deployments.find(
    (d) => d.model_id === foundry.active_model && d.status === 'active'
  );

  const url = resolveEndpoint(data, deployment); // builds ?api-version= automatically
  const auth = getFoundryToken();
  if (!auth.ok) throw new Error(`Foundry auth failed: ${auth.error}`);

  const body = {
    model: deployment.deployment_name,
    messages,
  };

  if (deployment.reasoning_model) {
    body.max_completion_tokens = opts.maxTokens || 4096;
    body.reasoning_effort = opts.reasoningEffort || 'medium';
  } else {
    body.max_tokens = opts.maxTokens || 4096;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  return resp.json();
}
```

### Raw curl — o4-mini (current)

```bash
TOKEN=$(az account get-access-token \
  --resource https://cognitiveservices.azure.com \
  --query accessToken -o tsv)

ENDPOINT="https://<your-foundry-resource>.cognitiveservices.azure.com"

curl -s -X POST "${ENDPOINT}/openai/deployments/o4-mini/chat/completions?api-version=2025-04-01-preview" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Summarize this SARIF finding in one sentence."}],
    "max_completion_tokens": 500,
    "reasoning_effort": "medium"
  }'
```

---

## 4. Pricing & Cost Controls

| Token type | Cost |
|-----------|------|
| Input | $10.00 / 1M tokens |
| Output | $50.00 / 1M tokens |
| Prompt cache hit | 90% discount on input |

**Cost guidance for agents:**
- Always use prompt caching for repeated system prompts or large context documents.
- For iterative SARIF review, cache the SARIF content as a user-turn prefix and vary only the analysis instruction.
- If the task can be broken into smaller chunks that fit a standard model, prefer that approach.
- Log token usage per call when running bulk analysis pipelines.

---

## 5. Safety Policy

Anthropic requires **30-day data retention** for Fable 5 on Azure AI Foundry. This is enforced at the Azure resource level and applies to all calls through this endpoint. Do not route PII or regulated data through Foundry unless your compliance review has cleared it for 30-day cloud retention.

---

## 6. Deprecation Path

This add-on exists because `claude-fable-5` is not yet in the GitHub Copilot model catalog. Once it is:

1. Remove `.secops/foundry.yaml` (or set `foundry.enabled: false`).
2. Delete `skills/platform/foundry-model-routing.md` (this file).
3. Delete `scripts/deploy-foundry-fable5.ps1` and `scripts/deploy-foundry-fable5.sh`.
4. Update agent prompts to reference the catalog model directly.
5. Optionally deprovision the Azure AI Foundry resource to stop billing.

The Azure resource can be deleted with:
```bash
az cognitiveservices account delete \
  --name secops-foundry \
  --resource-group rg-secops-ai
```

---

## 7. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | Re-run `az login`; Entra tokens expire after ~1 hour |
| `404 Not Found` on deployment | Verify `deployment_name` in `.secops/foundry.yaml` matches the Azure deployment |
| `429 Too Many Requests` | Foundry deployment capacity is low (default: 1K TPM); increase via `az cognitiveservices account deployment update` |
| Foundry config not found | Run `scripts/deploy-foundry-fable5.ps1` or `.sh` to create the deployment and config file |
| High cost | Enable prompt caching; audit which tasks are being routed to Fable 5 |
