# Foundry Model Routing — Deep Analysis via Azure AI Foundry

> **Status:** Optional add-on skill — only active when `.secops/foundry.yaml` is present and `foundry.enabled: true`.
>
> **Current model:** `o4-mini` (OpenAI reasoning model) — stopgap while Anthropic quota is pending.
> **Target model:** `claude-fable-5` — will be swapped in when quota is granted, or deprecated when available in the GitHub Copilot model catalog.

---

## 1. Detection — Is a Foundry Model Available?

Before routing any task to Foundry, check whether the add-on is deployed with the real CLI:

```powershell
node cli\index.js foundry status
```

`status` calls `loadFoundryConfig(projectRoot)`. If `.secops/foundry.yaml` is missing, disabled, malformed, missing a usable endpoint, or has no active deployment, the command fails closed with a non-zero exit code and a not-configured message. It never prints tokens or secrets.

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
const { loadFoundryConfig } = require('../../lib/foundry/config');

function foundryModelAvailable(projectRoot) {
  const config = loadFoundryConfig(projectRoot);
  if (!config) return null;  // disabled, missing, malformed, or no active deployment

  const foundry = config.foundry;
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

## 3. Calling Foundry

### CLI invocation

Use the CLI for manual or scripted routing:

```powershell
node cli\index.js foundry route --prompt "Summarize this SARIF finding in one sentence." --max-tokens 500
node cli\index.js foundry route --file .\analysis-prompt.txt --deployment o4-mini
node cli\index.js foundry route --payload .\foundry-payload.json --json
```

The production route command always calls:

```js
await routeToFoundry({
  rootDir,
  deploymentName,
  payload,
  hooks: createFoundrySafetyHooks(),
  timeoutMs,
});
```

That attaches the required P0 hook set every time:

```js
{
  preDispatch: [secretScan],
  postDispatch: [audit],
}
```

### Programmatic invocation from Node.js

Skills and platform code should call the public orchestrator, not provider clients directly:

```js
const { routeToFoundry } = require('../../lib/foundry');
const { createFoundrySafetyHooks } = require('../../lib/foundry/gates');

async function analyzeWithFoundry(projectRoot, prompt) {
  const result = await routeToFoundry({
    rootDir: projectRoot,
    payload: {
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4096,
    },
    hooks: createFoundrySafetyHooks(),
  });

  if (!result.ok) {
    // Fail closed or fall back according to the caller's policy.
    // Common errors: foundry-not-configured, foundry-auth-failed,
    // foundry-gate-blocked, foundry-provider-unsupported.
    return null;
  }

  return result.data;
}
```

`routeToFoundry()` handles deployment selection, endpoint resolution, Entra/API-key auth, provider routing, timeout handling, and audit. It never throws; all failures return `{ ok:false, ... }`. Do not bypass `createFoundrySafetyHooks()` in production paths.

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
