# Sydnor — Foundry CLI Surface

**Date:** 2026-06-25T22:00:00-05:00
**Branch:** foundry-integration
**Scope:** Phase 1 `p1-cli`: expose Foundry runtime through the existing `secops-squad` CLI.

## Command surface

Registered command: `secops-squad foundry`

Subcommands:

- `secops-squad foundry status`
  - Calls `loadFoundryConfig(process.cwd())`.
  - Prints configured/not-configured, active model, deployment, provider, and redacted endpoint host.
  - Never prints tokens, API keys, or raw secret-bearing config.
  - Missing/disabled/invalid config fails closed with a non-zero exit code.

- `secops-squad foundry route`
  - Inputs:
    - `--prompt <text>`
    - `--file <path>`
    - `--payload <json-or-file>`
    - Optional `--deployment <model_id-or-deployment_name>`
    - Optional `--system <text>`, `--max-tokens <n>`, `--timeout-ms <n>`, `--json`
  - Prints extracted model text on success, or raw provider data when `--json` is used.
  - Prints clean `{ok:false}` error codes on failure with gate/reason/status where present; no stack traces.

## Registration point

The command is registered in `cli/index.js` using the existing `COMMANDS` table:

```js
foundry: {
  description: "Inspect and route requests through Azure AI Foundry",
  usage: "secops-squad foundry [status|route --prompt <text>|route --file <path>|route --payload <json-or-file>]",
  module: "./commands/foundry.js",
}
```

The implementation lives in `cli/commands/foundry.js` and mirrors the existing command-module convention: `module.exports = { run }`, `process.cwd()` as root, subcommand switch, and `process.exit(1)` for CLI failures.

## P0 safety gates

The production route path always attaches Kima's required P0 gate set:

```js
await routeToFoundry({
  rootDir,
  deploymentName,
  payload,
  hooks: createFoundrySafetyHooks(),
  timeoutMs,
});
```

`createFoundrySafetyHooks()` returns:

```js
{
  preDispatch: [secretScan],
  postDispatch: [audit],
}
```

There is no CLI flag or route branch that disables or replaces these hooks. The wrong thing should be hard.

## Carver test asks

Carver should cover:

1. `foundry status` with no `.secops/foundry.yaml` exits non-zero and prints a fail-closed/not-configured message.
2. `foundry status` with valid config prints provider, active model, deployment, and redacted endpoint host only.
3. `foundry route --prompt ...` calls `routeToFoundry()` with `hooks.preDispatch` containing `secret-scan` and `hooks.postDispatch` containing `audit`.
4. The route subcommand cannot execute without the P0 gates; there should be no flag/path that omits `createFoundrySafetyHooks()`.
5. Route failures print clean error codes (`foundry-not-configured`, `foundry-gate-blocked`, etc.) with no stack trace and no secret values.
6. `--file` and `--payload` inputs build the expected payload and fail cleanly on unreadable files or invalid JSON.
