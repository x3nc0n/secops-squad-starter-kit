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

**Detection pseudo-code (Python):**
```python
import yaml, os

def foundry_model_available(project_root: str) -> dict | None:
    config_path = os.path.join(project_root, ".secops", "foundry.yaml")
    if not os.path.exists(config_path):
        return None
    with open(config_path) as f:
        cfg = yaml.safe_load(f)
    foundry = cfg.get("foundry", {})
    if not foundry.get("enabled", False):
        return None
    active_id = foundry.get("active_model")
    deployments = foundry.get("model_deployments", [])
    active = next((d for d in deployments if d.get("model_id") == active_id and d.get("status") == "active"), None)
    if not active:
        return None
    return {
        "endpoint": foundry["endpoint"],
        "api_version": foundry.get("api_version", "2025-04-01-preview"),
        "deployment_name": active["deployment_name"],
        "api_path": active.get("api_path", ""),
        "reasoning_model": active.get("reasoning_model", False),
        "resource_name": foundry["resource_name"],
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
```python
import subprocess

def get_entra_token() -> str:
    result = subprocess.run(
        ["az", "account", "get-access-token",
         "--resource", "https://cognitiveservices.azure.com",
         "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, check=True
    )
    return result.stdout.strip()
```

**Mode B: API Key**
```python
import os
api_key = os.environ.get("FOUNDRY_API_KEY")
```

### OpenAI-compatible models (o4-mini, GPT-5.x)

```python
import openai

def get_foundry_openai_client(endpoint: str, api_version: str) -> openai.AzureOpenAI:
    token = get_entra_token()
    return openai.AzureOpenAI(
        azure_endpoint=endpoint,
        api_version=api_version,
        azure_ad_token=token,
    )

# Usage
foundry = foundry_model_available(".")
if foundry:
    client = get_foundry_openai_client(foundry["endpoint"], foundry["api_version"])
    params = {
        "model": foundry["deployment_name"],
        "messages": [{"role": "user", "content": sarif_content}],
    }
    if foundry["reasoning_model"]:
        params["max_completion_tokens"] = 4096
        params["reasoning_effort"] = "medium"
    else:
        params["max_tokens"] = 4096
    response = client.chat.completions.create(**params)
```

### Anthropic models (claude-fable-5, when available)

```python
import anthropic

def get_fable5_client(endpoint: str, deployment_name: str) -> anthropic.Anthropic:
    token = get_entra_token()
    return anthropic.Anthropic(
        base_url=f"{endpoint}/anthropic/v1",
        default_headers={
            "Authorization": f"Bearer {token}",
            "x-ms-model-mesh-model-name": deployment_name,
        },
    )
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
