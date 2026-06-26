# Kima — Foundry F-001 Fail-Closed Endpoint Contract

Timestamp: 2026-06-25T21:30:00-05:00

Finding F-001 is closed by making `loadFoundryConfig()` the gate. If the resolved active Foundry config lacks a usable `foundry.endpoint` — absent, empty, whitespace-only, or normalized to empty — the loader returns `null`. No caller should treat Foundry as available until that gate passes.

`resolveEndpoint()` remains a defensive backstop. If direct callers bypass the loader with a config missing `foundry.endpoint`, it throws `Foundry endpoint is missing or empty...` instead of producing a hostless path like `/anthropic/v1/messages`.

Test contract changed:
- `lib/foundry/fixtures/partial-foundry.yaml` now expects `null`.
- F-001 regression tests assert the partial fixture fails closed, whitespace endpoints fail closed, and direct `resolveEndpoint()` calls without an endpoint throw clearly.

Validation:
- `node --test lib\foundry\*.test.js`: 60 tests, 60 pass, 0 fail.
- `npm test`: 286 tests, 286 pass, 0 fail.
