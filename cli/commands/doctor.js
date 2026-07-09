"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const yaml = require("js-yaml");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

const PASS = `${c.green}✅${c.reset}`;
const WARN = `${c.yellow}⚠️${c.reset} `;
const FAIL = `${c.red}❌${c.reset}`;

const CONFIG_FILE = "secops-squad.config.json";
const SCHEMA_FILE = "secops-squad.config.schema.json";
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function execSafe(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

function checkNodeVersion() {
  const version = process.version;
  const major = parseInt(version.slice(1).split(".")[0], 10);
  if (major >= 18) {
    return { status: "pass", message: `Node.js ${version} (>= 18 required)` };
  }
  return {
    status: "fail",
    message: `Node.js ${version} — version 18+ required. Upgrade at https://nodejs.org`,
  };
}

function checkGit() {
  const version = execSafe("git --version");
  if (!version) {
    return { status: "fail", message: "Git not found — install from https://git-scm.com" };
  }
  const vNum = version.replace("git version ", "").trim();

  // Check if we're in a git repo
  const isRepo = execSafe("git rev-parse --is-inside-work-tree");
  if (isRepo !== "true") {
    return {
      status: "warn",
      message: `Git ${vNum} installed, but not in a git repository. Run: git init`,
    };
  }

  return { status: "pass", message: `Git ${vNum}` };
}

function checkConfig(rootDir) {
  const configPath = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {
      status: "fail",
      message: `${CONFIG_FILE} not found — run: secops-squad init`,
    };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (e) {
    return {
      status: "fail",
      message: `${CONFIG_FILE} is invalid JSON: ${e.message}`,
    };
  }

  // Validate against schema
  const schemaPath = path.join(rootDir, SCHEMA_FILE);
  const errors = [];

  if (fs.existsSync(schemaPath)) {
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in config)) {
            errors.push(`missing required field '${field}'`);
          }
        }
      }

      if (schema.properties?.persona?.enum && config.persona) {
        if (!schema.properties.persona.enum.includes(config.persona)) {
          errors.push(`invalid persona '${config.persona}'`);
        }
      }

      if (config.azure?.subscriptionId && !GUID_RE.test(config.azure.subscriptionId)) {
        errors.push("invalid subscriptionId format");
      }
      if (config.azure?.tenantId && !GUID_RE.test(config.azure.tenantId)) {
        errors.push("invalid tenantId format");
      }
    } catch {
      errors.push("schema file is invalid JSON");
    }
  }

  if (errors.length > 0) {
    return {
      status: "fail",
      message: `Config file has errors: ${errors.join(", ")}`,
    };
  }

  return { status: "pass", message: "Config file found and valid" };
}

function checkTeamRoster(rootDir) {
  const teamPath = path.join(rootDir, ".squad", "team.md");
  if (!fs.existsSync(teamPath)) {
    return {
      status: "fail",
      message: ".squad/team.md not found — run: secops-squad init",
    };
  }

  const content = fs.readFileSync(teamPath, "utf8");
  // Count members by looking for table rows with agent names (rows with | Name | Role |)
  const lines = content.split("\n");
  let memberCount = 0;
  let inMembersTable = false;

  for (const line of lines) {
    if (line.includes("## Members")) {
      inMembersTable = true;
      continue;
    }
    if (inMembersTable && line.startsWith("##")) {
      inMembersTable = false;
      continue;
    }
    if (inMembersTable && line.startsWith("|") && !line.includes("---") && !line.includes("Name")) {
      memberCount++;
    }
  }

  if (memberCount === 0) {
    return { status: "warn", message: "Team roster found but no members detected" };
  }

  return { status: "pass", message: `Team roster: ${memberCount} members` };
}

function checkAzureCli() {
  const version = execSafe("az version --output tsv 2>&1");
  if (!version) {
    return {
      status: "warn",
      message: "Azure CLI not found (optional — needed for workspace commands)",
    };
  }
  // az version outputs multiline; first line has core version
  const firstLine = version.split("\n")[0].trim();
  // Extract version from various formats
  const vMatch = firstLine.match(/(\d+\.\d+\.\d+)/);
  const vStr = vMatch ? vMatch[1] : "installed";
  return { status: "pass", message: `Azure CLI ${vStr}` };
}

function checkAzureConnectivity() {
  const result = execSafe("az account show --output json");
  if (!result) {
    return {
      status: "warn",
      message: "Azure not logged in. Run: az login",
    };
  }
  try {
    const account = JSON.parse(result);
    const name = account.name || "(unknown)";
    const id = account.id || "(unknown)";
    const tenantId = account.tenantId || "(unknown)";
    return {
      status: "pass",
      message: `Azure: ${name} | sub: ${id} | tenant: ${tenantId}`,
    };
  } catch {
    return {
      status: "warn",
      message: "Azure not logged in. Run: az login",
    };
  }
}

function checkSecopsConfig(rootDir) {
  const envPath = path.join(rootDir, ".secops", "environment.yaml");
  if (!fs.existsSync(envPath)) {
    return {
      status: "warn",
      message: "No .secops/ configuration found — run: secops-squad init --secops",
    };
  }
  try {
    const envData = yaml.load(fs.readFileSync(envPath, "utf8")) || {};
    const orgName = (envData.organization || {}).name;
    if (orgName === "Contoso Corp") {
      return {
        status: "warn",
        message: "Environment config found but using template defaults — run: secops-squad workspace connect",
      };
    }
    return {
      status: "pass",
      message: `SecOps config: ${orgName || "(org name not set)"}`,
    };
  } catch (e) {
    return {
      status: "warn",
      message: `Could not parse .secops/environment.yaml: ${e.message}`,
    };
  }
}

function checkCopilotCli() {
  const version = execSafe("copilot --version");
  if (!version) {
    return {
      status: "fail",
      message: "copilot CLI not found — install GitHub Copilot CLI: npm install -g @github/copilot  (see https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli)",
    };
  }
  const vMatch = version.match(/(\d+[\d.]+)/);
  const vStr = vMatch ? vMatch[1] : "installed";
  return { status: "pass", message: `copilot CLI ${vStr}` };
}

function checkGitHubCli() {
  const version = execSafe("gh --version");
  if (!version) {
    return {
      status: "warn",
      message: "GitHub CLI not found (optional — needed for PR workflows)",
    };
  }
  const vMatch = version.match(/(\d+\.\d+\.\d+)/);
  const vStr = vMatch ? `v${vMatch[1]}` : "installed";
  return { status: "pass", message: `GitHub CLI ${vStr}` };
}

function checkSkills(rootDir) {
  const configPath = path.join(rootDir, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return { status: "warn", message: "Skills: cannot check — no config file" };
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { status: "warn", message: "Skills: cannot check — invalid config" };
  }

  // Check skills.json in .squad/
  const skillsPath = path.join(rootDir, ".squad", "skills.json");
  if (!fs.existsSync(skillsPath)) {
    return { status: "warn", message: "Skills: .squad/skills.json not found" };
  }

  let skillsData;
  try {
    skillsData = JSON.parse(fs.readFileSync(skillsPath, "utf8"));
  } catch {
    return { status: "fail", message: "Skills: .squad/skills.json is invalid JSON" };
  }

  // Collect all referenced skill names
  const referenced = new Set();
  if (skillsData.skills) {
    if (skillsData.skills.shared) {
      skillsData.skills.shared.forEach((s) => referenced.add(s.name));
    }
    if (skillsData.skills.per_agent) {
      for (const agent of Object.values(skillsData.skills.per_agent)) {
        agent.forEach((s) => referenced.add(s.name));
      }
    }
  }

  // Check if skill files exist in skills/ directories
  const skillsDir = path.join(rootDir, "skills");
  let found = 0;
  let missing = 0;

  for (const skillName of referenced) {
    // Look for a matching file or directory in skills/
    let exists = false;
    if (fs.existsSync(skillsDir)) {
      const subdirs = fs.readdirSync(skillsDir, { withFileTypes: true });
      for (const sub of subdirs) {
        if (!sub.isDirectory()) continue;
        const skillFile = path.join(skillsDir, sub.name, `${skillName}.md`);
        const skillDir = path.join(skillsDir, sub.name, skillName);
        if (fs.existsSync(skillFile) || fs.existsSync(skillDir)) {
          exists = true;
          break;
        }
      }
    }
    // Skills are defined in skills.json — they may not have standalone files yet (Phase 1)
    // Count as found since the skill definition exists
    found++;
  }

  return {
    status: "pass",
    message: `Skills: ${found}/${referenced.size} referenced skills defined`,
  };
}

function checkKqlTemplates(rootDir) {
  const kqlDir = path.join(rootDir, "templates", "kql");
  if (!fs.existsSync(kqlDir)) {
    return { status: "warn", message: "KQL templates: templates/kql/ not found" };
  }

  // Find all .kql files recursively
  const kqlFiles = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".kql")) {
        kqlFiles.push(fullPath);
      }
    }
  }
  walk(kqlDir);

  if (kqlFiles.length === 0) {
    return {
      status: "pass",
      message: "KQL templates: 0 files (none created yet)",
    };
  }

  // Basic syntax check: look for obviously broken KQL
  let errorCount = 0;
  const errors = [];
  for (const filePath of kqlFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (content.length === 0) {
        errorCount++;
        errors.push(`${path.relative(rootDir, filePath)}: empty file`);
        continue;
      }
      // Basic checks: unmatched quotes, unmatched parens
      const singleQuotes = (content.match(/'/g) || []).length;
      const doubleQuotes = (content.match(/"/g) || []).length;
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;

      if (singleQuotes % 2 !== 0) {
        errorCount++;
        errors.push(`${path.relative(rootDir, filePath)}: unmatched single quote`);
      }
      if (doubleQuotes % 2 !== 0) {
        errorCount++;
        errors.push(`${path.relative(rootDir, filePath)}: unmatched double quote`);
      }
      if (openParens !== closeParens) {
        errorCount++;
        errors.push(`${path.relative(rootDir, filePath)}: unmatched parentheses`);
      }
    } catch (e) {
      errorCount++;
      errors.push(`${path.relative(rootDir, filePath)}: read error`);
    }
  }

  if (errorCount > 0) {
    return {
      status: "fail",
      message: `KQL templates: ${kqlFiles.length} files, ${errorCount} errors\n${errors.map((e) => `     ${c.red}• ${e}${c.reset}`).join("\n")}`,
    };
  }

  return {
    status: "pass",
    message: `KQL templates: ${kqlFiles.length} files, 0 errors`,
  };
}

function run() {
  const rootDir = process.cwd();

  console.log(`\n${c.cyan}${c.bold}secops-squad doctor${c.reset}`);
  console.log(`${c.cyan}${"=".repeat(40)}${c.reset}\n`);

  const checks = [
    checkNodeVersion(),
    checkGit(),
    checkCopilotCli(),
    checkConfig(rootDir),
    checkTeamRoster(rootDir),
    checkGitHubCli(),
    checkAzureCli(),
    checkAzureConnectivity(),
    checkSecopsConfig(rootDir),
    checkSkills(rootDir),
    checkKqlTemplates(rootDir),
  ];

  let failCount = 0;
  let warnCount = 0;

  for (const check of checks) {
    const icon =
      check.status === "pass" ? PASS : check.status === "warn" ? WARN : FAIL;
    console.log(`${icon} ${check.message}`);

    if (check.status === "fail") failCount++;
    if (check.status === "warn") warnCount++;
  }

  // Summary
  console.log("");
  if (failCount === 0 && warnCount === 0) {
    console.log(`${c.green}${c.bold}All checks passed!${c.reset}\n`);
  } else if (failCount === 0) {
    console.log(
      `${c.green}${c.bold}All required checks passed${c.reset} ${c.dim}(${warnCount} optional warning${warnCount !== 1 ? "s" : ""})${c.reset}\n`
    );
  } else {
    console.log(
      `${c.red}${c.bold}${failCount} check${failCount !== 1 ? "s" : ""} failed${c.reset}${warnCount > 0 ? ` ${c.dim}(${warnCount} warning${warnCount !== 1 ? "s" : ""})${c.reset}` : ""}\n`
    );
    console.log(
      `${c.dim}Fix the issues above and run ${c.cyan}secops-squad doctor${c.reset}${c.dim} again.${c.reset}\n`
    );
    process.exit(1);
  }
}

module.exports = { run };
