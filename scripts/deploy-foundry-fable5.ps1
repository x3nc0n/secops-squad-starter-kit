#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy Anthropic Claude Fable 5 via Azure AI Foundry for secops-squad.

.DESCRIPTION
    Bootstrap script that creates an Azure AI Foundry resource and deploys the
    claude-fable-5 model (Global Standard). Writes .secops/foundry.yaml so
    secops-squad agents can auto-detect and route to Fable 5 at runtime.

    Idempotent — safe to re-run. Use -WhatIf to preview without making changes.

    DEPRECATED_WHEN: claude-fable-5 is available in the GitHub Copilot model catalog.

.PARAMETER TenantId
    Azure Entra ID tenant GUID. If omitted, uses the current az login context.

.PARAMETER SubscriptionId
    Azure subscription GUID. Mutually exclusive with -SubscriptionName.

.PARAMETER SubscriptionName
    Azure subscription display name (e.g. "Online"). Mutually exclusive with -SubscriptionId.

.PARAMETER ResourceGroup
    Name of the Azure resource group. Created if it does not exist.
    Default: rg-secops-ai

.PARAMETER ResourceName
    Name of the Azure AI Foundry (CognitiveServices/AIServices) resource.
    Default: secops-foundry

.PARAMETER Location
    Azure region for the deployment.
    Default: eastus2

.PARAMETER DeploymentName
    Name for the Fable 5 model deployment within the Foundry resource.
    Default: fable5-secops

.PARAMETER WhatIf
    Preview all Azure operations without executing them.

.EXAMPLE
    .\deploy-foundry-fable5.ps1 -SubscriptionName "Online" -TenantId "<your-tenant-id>"

.EXAMPLE
    .\deploy-foundry-fable5.ps1 -SubscriptionId "00000000-0000-0000-0000-000000000000" -WhatIf

.LINK
    https://learn.microsoft.com/azure/ai-services/
#>

[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'ByName')]
param(
    [string]$TenantId,

    [Parameter(ParameterSetName = 'ById')]
    [string]$SubscriptionId,

    [Parameter(ParameterSetName = 'ByName')]
    [string]$SubscriptionName,

    [string]$ResourceGroup  = "rg-secops-ai",
    [string]$ResourceName   = "secops-foundry",
    [string]$Location       = "eastus2",
    [string]$DeploymentName = "fable5-secops"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$MODEL_ID        = "claude-fable-5"
$MODEL_VERSION   = "1"
$DEPLOYMENT_TYPE = "GlobalStandard"
$CAPACITY        = 1   # Thousand tokens per minute, minimum unit

# ARM REST API version for CognitiveServices deployments.
# Verified stable — see https://learn.microsoft.com/rest/api/cognitiveservices/
$ARM_API_VERSION = "2025-04-01-preview"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Banner {
    Write-Host ""
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
    Write-Host "  |  secops-squad  —  Fable 5 Foundry Bootstrapper    |" -ForegroundColor Cyan
    Write-Host "  |  Deploys claude-fable-5 via Azure AI Foundry       |" -ForegroundColor Cyan
    Write-Host "  |  DEPRECATED_WHEN: Fable 5 in GHCP model catalog    |" -ForegroundColor DarkGray
    Write-Host "  +--------------------------------------------------+" -ForegroundColor Cyan
    Write-Host ""
}

function Require-AzCli {
    $cmd = Get-Command "az" -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Host "[FAIL] Azure CLI (az) not found." -ForegroundColor Red
        Write-Host "  Install: https://aka.ms/installazurecliwindows" -ForegroundColor DarkGray
        Write-Host "  Or:      winget install Microsoft.AzureCLI" -ForegroundColor DarkGray
        exit 1
    }
    Write-Host "[OK] Azure CLI found: $(az version --query '\"azure-cli\"' -o tsv 2>$null)" -ForegroundColor Green
}

function Assert-AzLogin {
    $account = az account show 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    if (-not $account) {
        Write-Host "[FAIL] Not logged in to Azure. Run: az login" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Logged in as: $($account.user.name) (tenant: $($account.tenantId))" -ForegroundColor Green
}

function Set-AzContext {
    param([string]$SubId, [string]$SubName, [string]$Tenant)

    if ($Tenant) {
        Write-Host "[....] Setting tenant: $Tenant" -ForegroundColor Cyan
        if ($PSCmdlet.ShouldProcess("az login --tenant", "Set tenant context")) {
            az login --tenant $Tenant --only-show-errors | Out-Null
        }
    }

    if ($SubId) {
        Write-Host "[....] Setting subscription by ID: $SubId" -ForegroundColor Cyan
        if ($PSCmdlet.ShouldProcess("az account set --subscription $SubId", "Set subscription")) {
            az account set --subscription $SubId
        }
    } elseif ($SubName) {
        Write-Host "[....] Setting subscription by name: $SubName" -ForegroundColor Cyan
        if ($PSCmdlet.ShouldProcess("az account set --subscription '$SubName'", "Set subscription")) {
            az account set --subscription $SubName
        }
    }

    $ctx = az account show 2>$null | ConvertFrom-Json
    Write-Host "[OK] Active subscription: $($ctx.name) ($($ctx.id))" -ForegroundColor Green
    return $ctx
}

function Ensure-ResourceGroup {
    param([string]$Name, [string]$Loc)

    $existing = az group show --name $Name 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[OK] Resource group exists: $Name" -ForegroundColor Green
        return
    }

    Write-Host "[....] Creating resource group: $Name ($Loc)" -ForegroundColor Cyan
    if ($PSCmdlet.ShouldProcess("az group create --name $Name --location $Loc", "Create resource group")) {
        az group create --name $Name --location $Loc --only-show-errors | Out-Null
        Write-Host "[OK] Resource group created: $Name" -ForegroundColor Green
    }
}

function Ensure-FoundryResource {
    param([string]$Name, [string]$RG, [string]$Loc)

    $existing = az cognitiveservices account show --name $Name --resource-group $RG 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "[OK] AI Foundry resource exists: $Name" -ForegroundColor Green
        return $existing
    }

    Write-Host "[....] Creating Azure AI Foundry resource: $Name" -ForegroundColor Cyan
    if ($PSCmdlet.ShouldProcess("az cognitiveservices account create --name $Name --resource-group $RG --kind AIServices --sku S0 --location $Loc", "Create AI Foundry resource")) {
        $result = az cognitiveservices account create `
            --name $Name `
            --resource-group $RG `
            --kind AIServices `
            --sku S0 `
            --location $Loc `
            --yes `
            --only-show-errors | ConvertFrom-Json
        Write-Host "[OK] AI Foundry resource created: $Name" -ForegroundColor Green
        return $result
    }
    return $null
}

function Ensure-ModelDeployment {
    param([string]$ResourceName, [string]$RG, [string]$DeployName, [string]$SubId)

    $existing = az cognitiveservices account deployment show `
        --name $ResourceName `
        --resource-group $RG `
        --deployment-name $DeployName 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue

    if ($existing) {
        Write-Host "[OK] Model deployment exists: $DeployName ($MODEL_ID)" -ForegroundColor Green
        return $existing
    }

    Write-Host "[....] Deploying model: $MODEL_ID as '$DeployName' (Global Standard)" -ForegroundColor Cyan

    # The az CLI does not yet support --model-provider-data for Anthropic models.
    # Use the ARM REST API directly (api-version constant defined at top of script).
    if ($PSCmdlet.ShouldProcess("PUT deployments/$DeployName (REST API $ARM_API_VERSION)", "Deploy Fable 5 model")) {
        $token = az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
        if (-not $token) {
            Write-Host "[FAIL] Could not acquire ARM access token." -ForegroundColor Red
            exit 1
        }

        $uri = "https://management.azure.com/subscriptions/$SubId/resourceGroups/$RG/providers/Microsoft.CognitiveServices/accounts/$ResourceName/deployments/${DeployName}?api-version=$ARM_API_VERSION"

        $body = @"
{"sku":{"name":"$DEPLOYMENT_TYPE","capacity":$CAPACITY},"properties":{"model":{"format":"Anthropic","name":"$MODEL_ID","version":"$MODEL_VERSION"},"modelProviderData":{"organizationName":"Microsoft","countryCode":"US","industry":"technology"}}}
"@

        $headers = @{
            "Authorization" = "Bearer $token"
            "Content-Type"  = "application/json"
        }

        try {
            $response = Invoke-RestMethod -Uri $uri -Method PUT -Headers $headers -Body $body -ErrorAction Stop
            Write-Host "[OK] Model deployment created: $DeployName" -ForegroundColor Green
            return $response
        } catch {
            $errBody = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
            if ($errBody.error.code -eq "InsufficientQuota") {
                Write-Host "[FAIL] Insufficient quota for $MODEL_ID." -ForegroundColor Red
                Write-Host "  $($errBody.error.message)" -ForegroundColor Yellow
                Write-Host ""
                Write-Host "  Request quota via Azure Portal:" -ForegroundColor Cyan
                Write-Host "    Foundry resource > Quotas > 'Claude Fable 5' > Request increase" -ForegroundColor DarkGray
                Write-Host ""
                Write-Host "  Or via az CLI:" -ForegroundColor Cyan
                Write-Host "    az supportticket create --ticket-name 'fable5-quota' \" -ForegroundColor DarkGray
                Write-Host "      --title 'Quota: Claude Fable 5 TPM in eastus2' \" -ForegroundColor DarkGray
                Write-Host "      --problem-classification '/providers/Microsoft.Support/services/.../problemClassifications/...' \" -ForegroundColor DarkGray
                Write-Host "      --severity minimal --contact-first-name <fn> --contact-last-name <ln> \" -ForegroundColor DarkGray
                Write-Host "      --contact-method email --contact-email <email>" -ForegroundColor DarkGray
                Write-Host ""
                Write-Host "  The Foundry resource is ready. Re-run this script after quota is granted." -ForegroundColor Yellow
                exit 1
            } else {
                Write-Host "[FAIL] Model deployment failed:" -ForegroundColor Red
                Write-Host "  $($_.ErrorDetails.Message)" -ForegroundColor Yellow
                exit 1
            }
        }
    }
    return $null
}

function Get-EndpointUrl {
    param([string]$ResourceName, [string]$RG)

    $resource = az cognitiveservices account show `
        --name $ResourceName `
        --resource-group $RG `
        --only-show-errors 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue

    if ($resource -and $resource.properties.endpoint) {
        # Return the clean base URL — no provider path suffix.
        # api_path per deployment carries the route (e.g. /anthropic/v1/messages).
        return $resource.properties.endpoint.TrimEnd('/')
    }
    # Fallback to well-known cognitiveservices base URL pattern
    return "https://$ResourceName.cognitiveservices.azure.com"
}

function Write-FoundryConfig {
    param([string]$Endpoint, [string]$ResName, [string]$RG, [string]$Loc, [string]$DeployName)

    # Resolve project root (script lives in scripts/, config goes in .secops/)
    $scriptDir  = $PSScriptRoot
    $projectRoot = Split-Path $scriptDir -Parent
    $secopDir   = Join-Path $projectRoot ".secops"
    $configPath  = Join-Path $secopDir "foundry.yaml"

    if (-not (Test-Path $secopDir)) {
        New-Item -ItemType Directory -Path $secopDir -Force | Out-Null
    }

    $yaml = @"
# Auto-generated by deploy-foundry-fable5.ps1 — $(Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
# This file tells secops-squad agents that Fable 5 is available for deep analysis tasks.
#
# DEPRECATED_WHEN: claude-fable-5 is available in the GitHub Copilot model catalog.
# At that point, remove this file and set foundry.enabled: false in your config.
schema_version: "1.0"
foundry:
  enabled: true
  resource_name: "$ResName"
  endpoint: "$Endpoint"
  location: "$Loc"
  resource_group: "$RG"
  api_version: "2025-04-01-preview"
  active_model: "claude-fable-5"
  model_deployments:
    - model_id: "claude-fable-5"
      deployment_name: "$DeployName"
      deployment_type: "global-standard"
      provider: "anthropic"
      status: "active"
      api_path: "/anthropic/v1/messages"
      reasoning_model: false
  pricing:
    input_per_million_tokens: 10.00
    output_per_million_tokens: 50.00
    prompt_cache_discount_pct: 90
  cost_ceiling_usd: 5.00
"@

    if ($PSCmdlet.ShouldProcess($configPath, "Write .secops/foundry.yaml")) {
        Set-Content -Path $configPath -Value $yaml -Encoding UTF8
        Write-Host "[OK] Config written: $configPath" -ForegroundColor Green
    }

    return $configPath
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

function Deploy-Fable5 {
    Write-Banner

    if ($WhatIfPreference) {
        Write-Host "[WhatIf] Previewing operations — no Azure changes will be made." -ForegroundColor Yellow
        Write-Host ""
    }

    # 1. Verify az CLI and login
    Write-Host "--- Checking prerequisites ---" -ForegroundColor White
    Require-AzCli
    Assert-AzLogin

    # 2. Set subscription context
    Write-Host ""
    Write-Host "--- Setting Azure context ---" -ForegroundColor White
    $ctx = Set-AzContext -SubId $SubscriptionId -SubName $SubscriptionName -Tenant $TenantId
    $resolvedSubId = $ctx.id

    # 3. Ensure resource group
    Write-Host ""
    Write-Host "--- Resource group: $ResourceGroup ---" -ForegroundColor White
    Ensure-ResourceGroup -Name $ResourceGroup -Loc $Location

    # 4. Ensure AI Foundry resource
    Write-Host ""
    Write-Host "--- AI Foundry resource: $ResourceName ---" -ForegroundColor White
    Ensure-FoundryResource -Name $ResourceName -RG $ResourceGroup -Loc $Location

    # 5. Deploy Fable 5 model
    Write-Host ""
    Write-Host "--- Model deployment: $DeploymentName ($MODEL_ID) ---" -ForegroundColor White
    Ensure-ModelDeployment -ResourceName $ResourceName -RG $ResourceGroup -DeployName $DeploymentName -SubId $resolvedSubId

    # 6. Resolve endpoint and write config
    Write-Host ""
    Write-Host "--- Writing secops-squad config ---" -ForegroundColor White
    $endpoint = Get-EndpointUrl -ResourceName $ResourceName -RG $ResourceGroup
    $configPath = Write-FoundryConfig `
        -Endpoint $endpoint `
        -ResName $ResourceName `
        -RG $ResourceGroup `
        -Loc $Location `
        -DeployName $DeploymentName

    # 7. Output summary
    Write-Host ""
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host "  Fable 5 deployment complete!" -ForegroundColor Green
    Write-Host "======================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Endpoint:    $endpoint" -ForegroundColor Cyan
    Write-Host "  Deployment:  $DeploymentName" -ForegroundColor Cyan
    Write-Host "  Config:      $configPath" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Test with curl:" -ForegroundColor White
    Write-Host "    `$token = (az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)" -ForegroundColor DarkGray
    Write-Host "    curl -s -X POST '$endpoint/messages' \\" -ForegroundColor DarkGray
    Write-Host "      -H 'Authorization: Bearer `$token' \\" -ForegroundColor DarkGray
    Write-Host "      -H 'Content-Type: application/json' \\" -ForegroundColor DarkGray
    Write-Host "      -d '{""model"":""$DeploymentName"",""max_tokens"":128,""messages"":[{""role"":""user"",""content"":""Hello""}]}'" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Pricing:   `$10/M input · `$50/M output · 90% prompt cache discount" -ForegroundColor DarkGray
    Write-Host "  Retention: 30-day (Anthropic safety policy)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  DEPRECATED_WHEN: claude-fable-5 available in GitHub Copilot model catalog" -ForegroundColor DarkGray
    Write-Host ""
}

Deploy-Fable5
