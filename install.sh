#!/bin/bash
# ============================================================================
# secops-squad installer
# Usage: curl -fsSL https://raw.githubusercontent.com/x3nc0n/secops-squad-starter-kit/main/install.sh | bash
# ============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

REPO_URL="https://github.com/x3nc0n/secops-squad-starter-kit.git"
INSTALL_DIR="${SECOPS_SQUAD_DIR:-$HOME/secops-squad}"

print_banner() {
  echo ""
  echo -e "${CYAN}${BOLD}  ┌─────────────────────────────────────┐"
  echo -e "  │  secops-squad installer               │"
  echo -e "  │  AI SecOps team for Microsoft        │"
  echo -e "  │  Security stack                      │"
  echo -e "  └─────────────────────────────────────┘${RESET}"
  echo ""
}

check_command() {
  local cmd="$1"
  local name="$2"
  local install_url="$3"
  local required="$4"

  if command -v "$cmd" &>/dev/null; then
    local version
    version=$($cmd --version 2>&1 | grep -v "^WARNING" | head -1 || true)
    echo -e "  ${GREEN}✅ ${name}: ${version}${RESET}"
    return 0
  else
    if [ "$required" = "true" ]; then
      echo -e "  ${RED}❌ ${name} not found${RESET}"
      echo -e "     ${DIM}Install: ${install_url}${RESET}"
      return 1
    else
      echo -e "  ${YELLOW}⚠️  ${name} not found (optional)${RESET}"
      echo -e "     ${DIM}Install: ${install_url}${RESET}"
      return 0
    fi
  fi
}

check_node_version() {
  if ! command -v node &>/dev/null; then
    echo -e "  ${RED}❌ Node.js not found${RESET}"
    echo -e "     ${DIM}Install Node.js 18+: https://nodejs.org${RESET}"
    return 1
  fi

  local version
  version=$(node -v)
  local major
  major=$(echo "$version" | sed 's/v//' | cut -d. -f1)

  if [ "$major" -ge 18 ]; then
    echo -e "  ${GREEN}✅ Node.js ${version} (>= 18 required)${RESET}"
    return 0
  else
    echo -e "  ${RED}❌ Node.js ${version} — version 18+ required${RESET}"
    echo -e "     ${DIM}Upgrade: https://nodejs.org${RESET}"
    return 1
  fi
}

main() {
  print_banner

  echo -e "${BOLD}Checking prerequisites...${RESET}\n"

  local failed=0

  check_node_version || failed=1
  check_command "git" "Git" "https://git-scm.com" "true" || failed=1
  check_command "gh" "GitHub CLI" "https://cli.github.com" "false"

  # GitHub Copilot (includes the copilot command — CLI functionality is part of the app)
  if command -v copilot &>/dev/null; then
    local version
    version=$(copilot --version 2>&1 | head -1 || true)
    echo -e "  ${GREEN}✅ GitHub Copilot: ${version}${RESET}"
  else
    echo -e "  ${YELLOW}⚠️  GitHub Copilot (copilot) not found (optional)${RESET}"
    if command -v npm &>/dev/null; then
      echo -e "  ${CYAN}  Installing GitHub Copilot via npm...${RESET}"
      if npm install -g @github/copilot --quiet 2>/dev/null; then
        echo -e "  ${GREEN}✅ GitHub Copilot installed${RESET}"
      else
        echo -e "  ${YELLOW}⚠️  GitHub Copilot install failed (optional — install manually)${RESET}"
        echo -e "     ${DIM}Install: https://github.com/features/copilot${RESET}"
      fi
    else
      echo -e "  ${YELLOW}⚠️  GitHub Copilot is optional${RESET}"
      echo -e "     ${DIM}Install: https://github.com/features/copilot${RESET}"
    fi
  fi

  check_command "az" "Azure CLI" "https://aka.ms/installazurecli" "false"

  echo ""

  if [ "$failed" -eq 1 ]; then
    echo -e "${RED}${BOLD}Prerequisites check failed.${RESET}"
    echo -e "${DIM}Install the missing tools above and re-run this script.${RESET}\n"
    exit 1
  fi

  echo -e "${GREEN}✅ All required prerequisites met.${RESET}\n"

  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${RED}${BOLD}Directory ${INSTALL_DIR} already exists.${RESET}"
    echo -e "${DIM}Remove it first or set SECOPS_SQUAD_DIR to a different location.${RESET}\n"
    exit 1
  fi

  # Download the repo content (shallow clone), then create a standalone repo
  echo -e "${CYAN}Downloading secops-squad...${RESET}"
  local temp_dir
  temp_dir=$(mktemp -d)
  local clone_output
  clone_output=$(git clone --depth 1 "$REPO_URL" "$temp_dir" 2>&1)
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to download secops-squad:${RESET}"
    echo -e "${DIM}${clone_output}${RESET}"
    rm -rf "$temp_dir"
    exit 1
  fi

  # Copy content (without .git) to create a standalone project
  echo -e "${CYAN}Creating your secops-squad project...${RESET}"
  cp -r "$temp_dir" "$INSTALL_DIR"
  rm -rf "$INSTALL_DIR/.git"

  echo -e "${CYAN}Resetting squad cast for fresh consumer install...${RESET}"
  node "$INSTALL_DIR/scripts/reset-squad.js" "$INSTALL_DIR"
  if [ $? -ne 0 ]; then
    echo -e "${RED}Squad reset failed. Aborting.${RESET}"
    rm -rf "$INSTALL_DIR"
    exit 1
  fi

  # Initialize a fresh git repo
  cd "$INSTALL_DIR"
  git init --quiet
  git add .
  git commit --quiet -m "Initialize secops-squad project"

  # Clean up temp download
  rm -rf "$temp_dir"

  # Install dependencies
  echo -e "${CYAN}Installing dependencies...${RESET}"
  npm install --production --quiet 2>/dev/null || true

  # Make CLI executable
  chmod +x cli/index.js 2>/dev/null || true

  # Add to PATH hint
  echo ""
  echo -e "${GREEN}${BOLD}secops-squad installed!${RESET}"
  echo ""
  echo -e "${BOLD}Getting started:${RESET}"
  echo -e "  ${CYAN}cd ${INSTALL_DIR}${RESET}"
  echo -e "  ${CYAN}copilot --agent secops-squad --yolo${RESET}"
  echo ""
  echo -e "${DIM}That's it! The agent will help you connect GitHub CLI"
  echo -e "and Azure when you need them.${RESET}"
  echo -e "${CYAN}  First run tip:${RESET}"
  echo -e "  ${DIM}Your first 'copilot --agent secops-squad' session will cast your AI team.${RESET}"
  echo -e "  ${DIM}The Squad Coordinator will propose a team roster -- confirm to proceed.${RESET}"
  echo ""
}

main "$@"
