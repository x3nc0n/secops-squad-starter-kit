# Azure AI Foundry + Fable 5 Integration

## Overview

**secops-squad** supports an optional **Azure AI Foundry integration** that enables access to **Claude Fable 5** (Anthropic's Mythos-class model) for deep security analysis tasks.

This is a **temporary bridge**—Fable 5 will eventually be available directly in the GitHub Copilot model catalog, at which point this integration will be deprecated and removed.

---

## Why Fable 5?

**Fable 5** excels at:
- Extended reasoning over large, complex datasets
- Multi-file vulnerability correlation across large codebases
- Threat modeling with 10+ interconnected systems
- SARIF reports with 50+ security findings

The GitHub Copilot model (currently Claude 3.5 Sonnet) handles the vast majority of secops-squad tasks well. Fable 5 is reserved for **heavy-lifting security analysis** that benefits from extended context windows and deeper reasoning.

---

## Status: Active Model (Azure deployment pending quota grant)

- **Configured model:** `claude-fable-5` is the configured `active_model` in `.secops/foundry.yaml` as of 2026-07-08
- **Azure deployment:** Azure TPM quota for `AIServices.GlobalStandard.claude-fable-5` was requested on 2026-07-08 (SC-OnlineLZ-00 / eastus2). The Azure deployment must be run once quota is granted before inference is available.
- **Standby fallback:** `o4-mini` remains configured as `standby` — if the Fable 5 deployment is not yet live, agents fall back to the standard model
- **Deprecation:** When Fable 5 enters the GitHub Copilot model catalog, this integration will be removed
- **No hard dependency:** Your secops-squad workflows are not blocked if the Azure deployment is not yet complete

---

## How to Deploy

### Prerequisites

- Azure subscription with sufficient quota for Claude models
- Azure CLI (`az`) installed and authenticated
- PowerShell (Windows) or Bash (Linux/macOS)

### Deployment Steps

1. **Run the bootstrap script:**
   ```powershell
   # Windows
   ./scripts/deploy-foundry-fable5.ps1

   # Linux/macOS
   ./scripts/deploy-foundry-fable5.sh
   ```

2. **Script will:**
   - Provision an Azure AI Foundry resource in your subscription
   - Deploy Claude Fable 5 model
   - Generate `.secops/foundry.yaml` with endpoint and credentials
   - Validate connectivity

3. **Verify deployment:**
   ```bash
   cat .secops/foundry.yaml
   ```
   You should see `enabled: true` and a valid `endpoint` URL.

### Manual Deployment (Alternative)

If you prefer manual setup:

1. Create Azure AI Foundry resource in Azure Portal
2. Deploy Claude Fable 5 model (request quota if needed)
3. Copy the example file:
   ```bash
   cp .secops/foundry.yaml.example .secops/foundry.yaml
   ```
4. Edit `.secops/foundry.yaml` with your resource details:
   - `resource_name` → your Foundry resource name
   - `endpoint` → your Foundry inference endpoint
   - `location` → Azure region (e.g., `eastus2`)
   - `resource_group` → your Azure resource group
   - `deployment_name` → your Fable 5 deployment name

---

## How It Works

### Agent Detection

When **secops-squad agents** start:
1. Check if `.secops/foundry.yaml` exists
2. If it does and `foundry.enabled` is `true`, agents have Fable 5 access
3. Agents read the endpoint and model deployment name for routing

### Task Routing

Agents use Fable 5 **only** for:
- **SARIF report analysis** with 50+ findings
- **Multi-file vulnerability correlation** across large codebases
- **Complex threat modeling** requiring extended reasoning
- **Security architecture review** of 10+ interconnected services

For routine tasks (KQL queries, single-finding triage, playbook generation, status checks), agents use the standard model to conserve quota and costs.

### API Access

Agents use the **Anthropic SDK** with the Foundry endpoint:
```python
import anthropic

client = anthropic.Anthropic(
    api_key=os.getenv("FOUNDRY_API_KEY"),
    base_url=config["foundry"]["endpoint"]
)

response = client.messages.create(
    model=config["foundry"]["model_deployments"][0]["deployment_name"],
    max_tokens=8000,
    messages=[...]
)
```

---

## Cost & Quota Implications

### Pricing (Claude Fable 5 via Foundry)

| Metric | Cost |
|--------|------|
| Input tokens | $10 per 1M tokens |
| Output tokens | $50 per 1M tokens |

For comparison, Claude 3.5 Sonnet (standard GitHub Copilot model) is cheaper; use Fable 5 only when necessary.

### Usage Monitoring

Azure AI Foundry dashboard tracks:
- Tokens consumed (input/output)
- Model deployment utilization
- Cost burn

### Quota Management

If you hit quota limits:
1. Request additional capacity via Azure Portal
2. Or adjust task routing (use standard model for more tasks)
3. Or disable Foundry integration by setting `enabled: false` in `.secops/foundry.yaml`

---

## Data Retention & Privacy

### Azure AI Foundry Terms

When you use Claude Fable 5 via Azure AI Foundry:
- **30-day retention:** Microsoft retains logs for 30 days (diagnostic/compliance)
- **No training:** Your data is not used to train new models
- **Your responsibility:** Ensure sensitive findings are scrubbed before sending to Foundry (e.g., real exploit code, customer data)

### Guidance

Before routing a complex analysis to Fable 5:
- Redact customer names, IP addresses, and domain names (use placeholders)
- Summarize exploit code rather than pasting full payloads
- Omit internal credentials or API keys

---

## Deprecation Path

### When Will This Be Removed?

Once **Claude Fable 5 is added to the GitHub Copilot model catalog**:
1. secops-squad agents will route to Fable 5 directly (no Foundry bridge needed)
2. This `.secops/foundry.yaml` integration will be **deprecated** (marked in docs)
3. The bootstrap script will be archived or removed
4. Users should delete their `.secops/foundry.yaml` files

### Timeline

Expected **2026 Q3/Q4**, pending Anthropic and GitHub Copilot team decisions. This is not a blocking dependency—work continues with the standard model.

---

## Troubleshooting

### "foundry.yaml not found" warning

**Cause:** Integration not deployed.  
**Fix:** Run the bootstrap script or copy the example file and configure manually.

### "Endpoint connection failed"

**Cause:** Invalid endpoint URL or Azure credentials expired.  
**Fix:** 
- Verify endpoint in `.secops/foundry.yaml` matches Azure Portal
- Re-authenticate: `az login`
- Check Azure resource is running

### "Quota exceeded"

**Cause:** Token limit hit for the month.  
**Fix:**
- Request additional quota in Azure Portal
- Or set `enabled: false` in `.secops/foundry.yaml` to fall back to standard model

### Agents not using Fable 5

**Cause:** Task doesn't meet routing criteria (see "Task Routing" above).  
**Fix:** Fable 5 is intentionally reserved for complex analysis. Simpler tasks use the standard model by design.

---

## FAQ

**Q: Is Fable 5 mandatory?**  
A: No. secops-squad works fine without it. Deploy only if you have complex security analysis needs.

**Q: Can I disable Fable 5 after deploying?**  
A: Yes, set `enabled: false` in `.secops/foundry.yaml`. Agents will fall back to the standard model.

**Q: What if Fable 5 is down for maintenance?**  
A: Agents detect connection failures and automatically fall back to the standard model.

**Q: Can I use a different model (not Fable 5)?**  
A: Fable 5 is the recommended model. Other Claude variants may work but are not tested with secops-squad.

**Q: How do I monitor Fable 5 usage?**  
A: Check the Azure AI Foundry dashboard or enable CloudWatch/Application Insights logging.

---

## Support

For issues with the Foundry integration:
1. Check `.secops/foundry.yaml` is valid YAML and has `enabled: true`
2. Verify Azure resource is running and accessible
3. Check Azure credentials (`az account show`)
4. Review agent logs for Foundry API errors
5. File an issue on GitHub with logs attached

For Azure AI Foundry support, contact [Sydnor](mailto:sydnor@example.com) (Platform team).
