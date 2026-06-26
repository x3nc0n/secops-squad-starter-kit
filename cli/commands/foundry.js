"use strict";

const fs = require("fs");
const path = require("path");
const { loadFoundryConfig } = require("../../lib/foundry/config");
const { routeToFoundry } = require("../../lib/foundry");
const { createFoundrySafetyHooks } = require("../../lib/foundry/gates");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function printHelp() {
  console.log(`
${c.cyan}${c.bold}secops-squad foundry${c.reset} — Azure AI Foundry routing

${c.bold}Usage:${c.reset}
  secops-squad foundry status
  secops-squad foundry route --prompt <text> [--deployment <name>] [--max-tokens <n>]
  secops-squad foundry route --file <path> [--deployment <name>] [--max-tokens <n>]
  secops-squad foundry route --payload <json-or-file> [--deployment <name>]

${c.bold}Subcommands:${c.reset}
  status   Show Foundry configuration status without printing secrets
  route    Send a prompt or payload through Foundry with required P0 gates

${c.bold}Options:${c.reset}
  --prompt <text>       Prompt text to send as a user message
  --file <path>         Read prompt text from a file
  --payload <value>     JSON payload string, or path to a JSON file
  --deployment <name>   Override active deployment by model_id or deployment_name
  --system <text>       System prompt for providers that support it
  --max-tokens <n>      Max output tokens (default: provider default)
  --timeout-ms <n>      Provider request timeout in milliseconds
  --json                Print raw provider data as JSON
`);
}

function handleStatus(rootDir) {
  const config = loadFoundryConfig(rootDir);
  console.log(`\n${c.cyan}${c.bold}secops-squad foundry status${c.reset}`);
  console.log(`${c.cyan}${"=".repeat(40)}${c.reset}\n`);

  if (!config) {
    console.error(`${c.red}❌ Foundry: not configured (fail-closed)${c.reset}`);
    console.error(
      `${c.dim}Expected .secops${path.sep}foundry.yaml with foundry.enabled: true, a usable endpoint, and an active deployment.${c.reset}\n`
    );
    process.exit(1);
  }

  const foundry = config.foundry;
  const active = findActiveDeployment(foundry);
  if (!active) {
    console.error(`${c.red}❌ Foundry: no active deployment found (fail-closed)${c.reset}\n`);
    process.exit(1);
  }

  console.log(`${c.green}✅ Foundry: configured${c.reset}`);
  console.log(`Provider: ${active.provider || "openai"}`);
  console.log(`Active model: ${foundry.active_model}`);
  console.log(`Deployment: ${active.deployment_name}`);
  console.log(`Endpoint: ${redactEndpoint(foundry.endpoint)}`);
  console.log("");
}

async function handleRoute(args, rootDir) {
  const deploymentName = valueOf(args, "--deployment");
  const timeoutMs = parsePositiveInt(valueOf(args, "--timeout-ms"), "--timeout-ms");
  const payload = buildPayload(args, rootDir);

  const result = await routeToFoundry({
    rootDir,
    deploymentName,
    payload,
    hooks: createFoundrySafetyHooks(),
    timeoutMs,
  });

  if (!result.ok) {
    printRouteError(result);
    process.exit(1);
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(result.data ?? result, null, 2));
    return;
  }

  const text = extractModelText(result.data);
  if (text) {
    console.log(text);
    return;
  }

  console.log(JSON.stringify(result.data ?? result, null, 2));
}

function buildPayload(args, rootDir) {
  const payloadArg = valueOf(args, "--payload");
  if (payloadArg) return readJsonValue(payloadArg, rootDir);

  const prompt = valueOf(args, "--prompt") ?? readPromptFile(valueOf(args, "--file"), rootDir);
  if (!prompt) {
    console.error(`${c.red}❌ Foundry route requires --prompt, --file, or --payload.${c.reset}`);
    process.exit(1);
  }

  const payload = {
    messages: [{ role: "user", content: prompt }],
  };

  const systemPrompt = valueOf(args, "--system");
  if (systemPrompt) payload.systemPrompt = systemPrompt;

  const maxTokens = parsePositiveInt(valueOf(args, "--max-tokens"), "--max-tokens");
  if (maxTokens) payload.maxTokens = maxTokens;

  return payload;
}

function readPromptFile(fileArg, rootDir) {
  if (!fileArg) return null;
  const filePath = path.resolve(rootDir, fileArg);
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`${c.red}❌ Could not read prompt file: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

function readJsonValue(value, rootDir) {
  const maybePath = path.resolve(rootDir, value);
  let raw = value;
  if (fs.existsSync(maybePath)) {
    raw = fs.readFileSync(maybePath, "utf8");
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload must be a JSON object");
    }
    return parsed;
  } catch (err) {
    console.error(`${c.red}❌ Invalid JSON payload: ${err.message}${c.reset}`);
    process.exit(1);
  }
}

function findActiveDeployment(foundry) {
  const deployments = Array.isArray(foundry.model_deployments) ? foundry.model_deployments : [];
  return deployments.find((d) => d && d.status === "active" && d.model_id === foundry.active_model);
}

function valueOf(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1) return null;
  const value = args[idx + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${c.red}❌ Missing value for ${flag}${c.reset}`);
    process.exit(1);
  }
  return value;
}

function parsePositiveInt(value, label) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`${c.red}❌ ${label} must be a positive integer.${c.reset}`);
    process.exit(1);
  }
  return parsed;
}

function extractModelText(data) {
  if (!data || typeof data !== "object") return null;

  const openAiText = data.choices?.[0]?.message?.content;
  if (typeof openAiText === "string" && openAiText.trim()) return openAiText;

  if (Array.isArray(data.content)) {
    const text = data.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text.trim()) return text;
  }

  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  return null;
}

function printRouteError(result) {
  console.error(`${c.red}❌ Foundry route failed: ${redact(result.error || "unknown-error")}${c.reset}`);
  if (result.gate) console.error(`Gate: ${redact(result.gate)}`);
  if (result.reason) console.error(`Reason: ${redact(result.reason)}`);
  if (result.status) console.error(`Status: ${result.status}`);
  if (result.error === "foundry-not-configured") {
    console.error(
      `${c.dim}Foundry is fail-closed until .secops${path.sep}foundry.yaml is enabled with an active deployment.${c.reset}`
    );
  }
}

function redactEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== "string") return "(not set)";
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}`;
  } catch {
    return redact(endpoint);
  }
}

function redact(value) {
  return String(value)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[-_ ]?key|token|secret|password)(["'\s:=]+)[^"'\s,}]+/gi, "$1$2[redacted]")
    .slice(0, 500);
}

async function run(args) {
  const rootDir = process.cwd();

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case "status":
      handleStatus(rootDir);
      break;
    case "route":
      await handleRoute(subArgs, rootDir);
      break;
    default:
      console.error(`${c.red}Unknown subcommand: ${subcommand}${c.reset}`);
      printHelp();
      process.exit(1);
  }
}

module.exports = { run };
