#!/usr/bin/env bash
# =============================================================================
# deploy-foundry-fable5.sh — Deploy Anthropic Claude Fable 5 via Azure AI Foundry
# =============================================================================
# Bootstrap script for Linux / macOS that creates an Azure AI Foundry resource
# and deploys the claude-fable-5 model (Global Standard). Writes
# .secops/foundry.yaml so secops-squad agents can auto-detect Fable 5.
#
# Idempotent — safe to re-run.
#
# DEPRECATED_WHEN: claude-fable-5 is available in the GitHub Copilot model catalog.
#
# Usage:
#   ./scripts/deploy-foundry-fable5.sh [options]
#
# Options:
#   -t, --tenant-id         <guid>   Azure Entra ID tenant GUID (optional)
#   -s, --subscription-id   <guid>   Azure subscription GUID
#   -n, --subscription-name <name>   Azure subscription name (alt to --subscription-id)
#   -g, --resource-group    <name>   Resource group name (default: rg-secops-ai)
#   -r, --resource-name     <name>   Foundry resource name (default: secops-foundry)
#   -l, --location          <loc>    Azure region (default: eastus2)
#   -d, --deployment-name   <name>   Model deployment name (default: fable5-secops)
#   -w, --what-if                    Preview without making changes
#   -h, --help                       Show this help
#
# Examples:
#   ./scripts/deploy-foundry-fable5.sh --subscription-name "Online" \
#       --tenant-id "<your-tenant-id>"
#
#   ./scripts/deploy-foundry-fable5.sh --subscription-id "00000000-..." --what-if
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
TENANT_ID=""
SUBSCRIPTION_ID=""
SUBSCRIPTION_NAME=""
RESOURCE_GROUP="rg-secops-ai"
RESOURCE_NAME="secops-foundry"
LOCATION="eastus2"
DEPLOYMENT_NAME="fable5-secops"
WHAT_IF=false

MODEL_ID="claude-fable-5"
MODEL_VERSION="1"
DEPLOYMENT_TYPE="GlobalStandard"
CAPACITY=1

# ARM REST API version for CognitiveServices deployments.
# Verified stable — see https://learn.microsoft.com/rest/api/cognitiveservices/
ARM_API_VERSION="2025-04-01-preview"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
fail() { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
info() { echo -e "${CYAN}[....]${NC} $*"; }
dim()  { echo -e "${GRAY}  $*${NC}"; }

# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
usage() {
    grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \{0,2\}//'
    exit 0
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)              usage ;;
        -w|--what-if)           WHAT_IF=true; shift ;;
        -t|--tenant-id)         TENANT_ID="$2"; shift 2 ;;
        -s|--subscription-id)   SUBSCRIPTION_ID="$2"; shift 2 ;;
        -n|--subscription-name) SUBSCRIPTION_NAME="$2"; shift 2 ;;
        -g|--resource-group)    RESOURCE_GROUP="$2"; shift 2 ;;
        -r|--resource-name)     RESOURCE_NAME="$2"; shift 2 ;;
        -l|--location)          LOCATION="$2"; shift 2 ;;
        -d|--deployment-name)   DEPLOYMENT_NAME="$2"; shift 2 ;;
        *) fail "Unknown argument: $1. Use --help for usage." ;;
    esac
done

# ---------------------------------------------------------------------------
# WhatIf wrapper
# ---------------------------------------------------------------------------
run_az() {
    if [[ "$WHAT_IF" == "true" ]]; then
        echo -e "${YELLOW}[WhatIf]${NC} az $*"
        return 0
    fi
    az "$@"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
print_banner() {
    echo ""
    echo -e "${CYAN}  +--------------------------------------------------+${NC}"
    echo -e "${CYAN}  |  secops-squad  —  Fable 5 Foundry Bootstrapper    |${NC}"
    echo -e "${CYAN}  |  Deploys claude-fable-5 via Azure AI Foundry       |${NC}"
    echo -e "${GRAY}  |  DEPRECATED_WHEN: Fable 5 in GHCP model catalog    |${NC}"
    echo -e "${CYAN}  +--------------------------------------------------+${NC}"
    echo ""
}

# ---------------------------------------------------------------------------
# Check az CLI
# ---------------------------------------------------------------------------
require_az_cli() {
    if ! command -v az &>/dev/null; then
        fail "Azure CLI (az) not found. Install: https://aka.ms/installazurecliwindows\n  Or: brew install azure-cli"
    fi
    AZ_VER=$(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo "unknown")
    ok "Azure CLI found: $AZ_VER"
}

# ---------------------------------------------------------------------------
# Assert logged in
# ---------------------------------------------------------------------------
assert_az_login() {
    local account
    account=$(az account show 2>/dev/null || true)
    if [[ -z "$account" ]]; then
        fail "Not logged in to Azure. Run: az login"
    fi
    local user tenant
    user=$(echo "$account" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['user']['name'])" 2>/dev/null || echo "unknown")
    tenant=$(echo "$account" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tenantId'])" 2>/dev/null || echo "unknown")
    ok "Logged in as: $user (tenant: $tenant)"
}

# ---------------------------------------------------------------------------
# Set subscription context
# ---------------------------------------------------------------------------
set_az_context() {
    if [[ -n "$TENANT_ID" ]]; then
        info "Setting tenant: $TENANT_ID"
        run_az login --tenant "$TENANT_ID" --only-show-errors >/dev/null
    fi

    if [[ -n "$SUBSCRIPTION_ID" ]]; then
        info "Setting subscription by ID: $SUBSCRIPTION_ID"
        run_az account set --subscription "$SUBSCRIPTION_ID"
    elif [[ -n "$SUBSCRIPTION_NAME" ]]; then
        info "Setting subscription by name: $SUBSCRIPTION_NAME"
        run_az account set --subscription "$SUBSCRIPTION_NAME"
    fi

    local ctx_name ctx_id
    ctx_name=$(az account show --query name -o tsv 2>/dev/null || echo "unknown")
    ctx_id=$(az account show --query id -o tsv 2>/dev/null || echo "unknown")
    ok "Active subscription: $ctx_name ($ctx_id)"
}

# ---------------------------------------------------------------------------
# Ensure resource group
# ---------------------------------------------------------------------------
ensure_resource_group() {
    local existing
    existing=$(az group show --name "$RESOURCE_GROUP" 2>/dev/null || true)
    if [[ -n "$existing" ]]; then
        ok "Resource group exists: $RESOURCE_GROUP"
        return
    fi
    info "Creating resource group: $RESOURCE_GROUP ($LOCATION)"
    run_az group create \
        --name "$RESOURCE_GROUP" \
        --location "$LOCATION" \
        --only-show-errors >/dev/null
    ok "Resource group created: $RESOURCE_GROUP"
}

# ---------------------------------------------------------------------------
# Ensure AI Foundry resource
# ---------------------------------------------------------------------------
ensure_foundry_resource() {
    local existing
    existing=$(az cognitiveservices account show \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" 2>/dev/null || true)

    if [[ -n "$existing" ]]; then
        ok "AI Foundry resource exists: $RESOURCE_NAME"
        return
    fi

    info "Creating Azure AI Foundry resource: $RESOURCE_NAME"
    run_az cognitiveservices account create \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --kind AIServices \
        --sku S0 \
        --location "$LOCATION" \
        --yes \
        --only-show-errors >/dev/null
    ok "AI Foundry resource created: $RESOURCE_NAME"
}

# ---------------------------------------------------------------------------
# Ensure model deployment
# ---------------------------------------------------------------------------
ensure_model_deployment() {
    local existing
    existing=$(az cognitiveservices account deployment show \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$DEPLOYMENT_NAME" 2>/dev/null || true)

    if [[ -n "$existing" ]]; then
        ok "Model deployment exists: $DEPLOYMENT_NAME ($MODEL_ID)"
        return
    fi

    info "Deploying model: $MODEL_ID as '$DEPLOYMENT_NAME' (Global Standard)"
    run_az cognitiveservices account deployment create \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --deployment-name "$DEPLOYMENT_NAME" \
        --model-name "$MODEL_ID" \
        --model-version "$MODEL_VERSION" \
        --model-format AML \
        --sku-capacity "$CAPACITY" \
        --sku-name "$DEPLOYMENT_TYPE" \
        --only-show-errors >/dev/null
    ok "Model deployment created: $DEPLOYMENT_NAME"
}

# ---------------------------------------------------------------------------
# Get endpoint URL
# ---------------------------------------------------------------------------
get_endpoint_url() {
    local endpoint
    endpoint=$(az cognitiveservices account show \
        --name "$RESOURCE_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "properties.endpoint" -o tsv 2>/dev/null || true)

    if [[ -n "$endpoint" ]]; then
        # Return the clean base URL — no provider path suffix.
        # api_path per deployment carries the route (e.g. /anthropic/v1/messages).
        echo "${endpoint%/}"
    else
        echo "https://${RESOURCE_NAME}.cognitiveservices.azure.com"
    fi
}

# ---------------------------------------------------------------------------
# Write .secops/foundry.yaml
# ---------------------------------------------------------------------------
write_foundry_config() {
    local endpoint="$1"
    # Script lives in scripts/, project root is one level up
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local project_root
    project_root="$(dirname "$script_dir")"
    local secops_dir="$project_root/.secops"
    local config_path="$secops_dir/foundry.yaml"
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    mkdir -p "$secops_dir"

    local yaml_content
    yaml_content="# Auto-generated by deploy-foundry-fable5.sh — ${timestamp}
# This file tells secops-squad agents that Fable 5 is available for deep analysis tasks.
#
# DEPRECATED_WHEN: claude-fable-5 is available in the GitHub Copilot model catalog.
# At that point, remove this file and set foundry.enabled: false in your config.
schema_version: \"1.0\"
foundry:
  enabled: true
  resource_name: \"${RESOURCE_NAME}\"
  endpoint: \"${endpoint}\"
  location: \"${LOCATION}\"
  resource_group: \"${RESOURCE_GROUP}\"
  api_version: \"2025-04-01-preview\"
  active_model: \"claude-fable-5\"
  model_deployments:
    - model_id: \"claude-fable-5\"
      deployment_name: \"${DEPLOYMENT_NAME}\"
      deployment_type: \"global-standard\"
      provider: \"anthropic\"
      status: \"active\"
      api_path: \"/anthropic/v1/messages\"
      reasoning_model: false
  pricing:
    input_per_million_tokens: 10.00
    output_per_million_tokens: 50.00
    prompt_cache_discount_pct: 90
  cost_ceiling_usd: 5.00
"

    if [[ "$WHAT_IF" == "true" ]]; then
        echo -e "${YELLOW}[WhatIf]${NC} Would write: $config_path"
        return
    fi

    echo "$yaml_content" > "$config_path"
    ok "Config written: $config_path"
    echo "$config_path"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
    print_banner

    if [[ "$WHAT_IF" == "true" ]]; then
        warn "WhatIf mode — previewing operations, no Azure changes will be made."
        echo ""
    fi

    echo -e "${BOLD}--- Checking prerequisites ---${NC}"
    require_az_cli
    assert_az_login

    echo ""
    echo -e "${BOLD}--- Setting Azure context ---${NC}"
    set_az_context

    echo ""
    echo -e "${BOLD}--- Resource group: $RESOURCE_GROUP ---${NC}"
    ensure_resource_group

    echo ""
    echo -e "${BOLD}--- AI Foundry resource: $RESOURCE_NAME ---${NC}"
    ensure_foundry_resource

    echo ""
    echo -e "${BOLD}--- Model deployment: $DEPLOYMENT_NAME ($MODEL_ID) ---${NC}"
    ensure_model_deployment

    echo ""
    echo -e "${BOLD}--- Writing secops-squad config ---${NC}"
    local endpoint
    endpoint=$(get_endpoint_url)
    local config_path
    config_path=$(write_foundry_config "$endpoint")

    echo ""
    echo -e "${GREEN}======================================================${NC}"
    echo -e "${GREEN}  Fable 5 deployment complete!${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo ""
    echo -e "  ${CYAN}Endpoint:${NC}    $endpoint"
    echo -e "  ${CYAN}Deployment:${NC}  $DEPLOYMENT_NAME"
    echo -e "  ${CYAN}Config:${NC}      $config_path"
    echo ""
    echo -e "  ${BOLD}Test with curl:${NC}"
    dim "token=\$(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)"
    dim "curl -s -X POST '${endpoint}/messages' \\"
    dim "  -H 'Authorization: Bearer \$token' \\"
    dim "  -H 'Content-Type: application/json' \\"
    dim "  -d '{\"model\":\"${DEPLOYMENT_NAME}\",\"max_tokens\":128,\"messages\":[{\"role\":\"user\",\"content\":\"Hello\"}]}'"
    echo ""
    dim "Pricing:   \$10/M input · \$50/M output · 90% prompt cache discount"
    dim "Retention: 30-day (Anthropic safety policy)"
    echo ""
    dim "DEPRECATED_WHEN: claude-fable-5 available in GitHub Copilot model catalog"
    echo ""
}

main
