#!/usr/bin/env node

"use strict";

const path = require("path");
const fs = require("fs");

const COMMANDS = {
  init: {
    description: "Set up a new secops-squad project",
    usage: "secops-squad init [--persona <name>] [--no-interactive] [--secops]",
    module: "./commands/init.js",
  },
  doctor: {
    description: "Check environment prerequisites and configuration health",
    usage: "secops-squad doctor",
    module: "./commands/doctor.js",
  },
  env: {
    description: "Show and validate .secops/ environment configuration",
    usage: "secops-squad env [validate|workspaces|data-sources]",
    module: "./commands/env.js",
  },
  status: {
    description: "Show current config, loaded persona, and active skills",
    usage: "secops-squad status",
  },
  skill: {
    description: "List and add skills from the built-in library",
    usage: "secops-squad skill [list|add <name>] [--category <cat>] [--json]",
    module: "./commands/skill.js",
  },
  persona: {
    description: "Switch or inspect the active persona",
    usage: "secops-squad persona [list|switch <name>]",
    module: "./commands/persona.js",
  },
  workspace: {
    description: "Manage Microsoft Sentinel workspace connection",
    usage: "secops-squad workspace [connect|status|disconnect]",
    module: "./commands/workspace.js",
  },
  kql: {
    description: "KQL query tools — validate, format, explain",
    usage: "secops-squad kql validate <file|glob> [--format table|json]",
    module: "./commands/kql-validate.js",
  },
  playbook: {
    description: "SOAR playbook deployment and management",
    usage: "secops-squad playbook [list|deploy <name>] [--dry-run]",
    module: "./commands/playbook.js",
  },
  plugin: {
    description: "Install, list, or remove plugins",
    usage: "secops-squad plugin [install <source>|list|remove <name>]",
    module: "./commands/plugin.js",
  },
  recast: {
    description: "Re-theme your squad with a different TV/Movie universe",
    usage: "secops-squad recast [--universe \"Name\"] [--no-interactive] [--dry-run]",
    module: "./commands/recast.js",
  },
  update: {
    description: "Pull latest starter-kit changes into your project",
    usage: "secops-squad update",
    module: "./commands/update.js",
  },
};

function getVersion() {
  try {
    const pkgPath = path.join(__dirname, "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.version || "0.1.0";
  } catch {
    return "0.1.0";
  }
}

function printBanner() {
  const version = getVersion();
  console.log(`
  \x1b[36m\x1b[1m┌─────────────────────────────────────┐
  │         secops-squad v${version.padEnd(13)}│
  │  AI SecOps team for Microsoft       │
  │  Security stack                     │
  └─────────────────────────────────────┘\x1b[0m
  `);
}

function printHelp() {
  printBanner();
  console.log("Usage: secops-squad <command> [options]\n");
  console.log("Commands:\n");

  const padSize = Math.max(...Object.keys(COMMANDS).map((k) => k.length)) + 2;
  for (const [name, cmd] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(padSize)} ${cmd.description}`);
  }

  console.log("\nRun secops-squad <command> --help for command-specific usage.\n");
}

async function handleCommand(command, args) {
  const cmd = COMMANDS[command];
  if (!cmd) {
    console.error(`Unknown command: ${command}`);
    console.error(`Run 'secops-squad --help' to see available commands.\n`);
    process.exit(1);
  }

  // Route `init --secops` to the secops init module
  if (command === "init" && args.includes("--secops")) {
    const secopsInit = require("./secops-init.js");
    await secopsInit.run(args);
    return;
  }

  // Dispatch to real module if available
  if (cmd.module) {
    const mod = require(cmd.module);
    await mod.run(args);
    return;
  }

  // Stub for commands not yet implemented
  console.log(`[secops-squad] ${cmd.description}`);
  console.log(`Usage: ${cmd.usage}`);
  console.log(`\nThis command is not yet implemented.`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(getVersion());
    process.exit(0);
  }

  // --update is an alias for the update subcommand
  if (args.includes("--update")) {
    const remaining = args.filter((a) => a !== "--update");
    await handleCommand("update", remaining);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);
  await handleCommand(command, commandArgs);
}

main().catch((err) => {
  console.error(`\x1b[31mError: ${err.message}\x1b[0m`);
  process.exit(1);
});
