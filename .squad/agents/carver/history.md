# History

<!-- Populated automatically during squad sessions. -->

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- **Created:** 2026-04-28

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

📌 Team initialized on 2026-04-28 — full squad scaffolded with SecOps-focused roles and routing.

📌 **Phase 1: Framework Architecture Finalized** (2026-04-28)
- Skills-first architecture: markdown skills by domain (kql/, soar/, detection/, log-analytics/, adx/, msft-security/)
- Persona-driven onboarding: init wizard with Azure discovery, personas include soc-analyst, detection-engineering, threat-hunting, cloud-security, incident-response, full-soc
- Quality gates: KQL CI validation (Carver), SOAR rollback plans mandatory (Herc), threat model ceremony for detection (McNulty)
- Coverage analysis: MITRE ATT&CK tagging required for all detection/KQL skills
- CLI strategy: secops-squad wraps @bradygaster/squad-cli, additive security commands
- Phase 1 exit: init wizard, soc-analyst persona, 3 KQL skills, 3 SOAR skills, KQL CI, getting-started docs
- Target: new user → working SecOps team with KQL hunting + phishing response in ≤ 15 minutes

📌 **KQL Validator Test Suite Written** (2026-04-28)
- Created `lib/kql-validator/kql-validator.test.js` — 45 tests across 9 describe blocks
- Test categories: valid KQL (10), invalid KQL (8), edge cases (10), markdown extraction (7), file validation (7), directory validation (5), warning detection (4), return shape contract (2), fixture sanity (4)
- Tests written from spec, not implementation — defines the contract for Freamon's validator
- All tests use `node:test` + `node:assert/strict`, runnable via `node --test`
- Graceful degradation: tests fail (not crash) when validator module isn't built yet
- Created 4 fixture files in `lib/kql-validator/fixtures/`: valid-hunting-query.kql, valid-detection-rule.kql, invalid-syntax.kql, sample-skill.md
- Fixture sanity tests pass independently; validator tests awaiting Freamon's implementation
- Temp files written to `__test_tmp__` inside the test dir and cleaned up in `after` hooks
- Package.json already has `"test": "node --test lib/**/*.test.js"` — test file is auto-discovered

📌 **Graph Security API Test Suite Written** (2026-04-28)
- Created `lib/graph-security/graph-security.test.js` — 169 tests across 28 describe blocks
- Modules covered: auth (4 blocks), alerts (4 blocks), incidents (6 blocks), threat-intelligence (5 blocks), secure-score (4 blocks), utils (2 blocks), index/factory (2 blocks + exports)
- Mocking approach: `mock.fn()` from `node:test` to replace `globalThis.fetch` — no external mock libraries needed
- Helper pattern: `mockClient()` returns `{tenantId, getToken}`, `mockFetch(status, body)` installs a fake fetch
- URL-encoding gotcha: `URLSearchParams` encodes `$` as `%24` in URLs — test assertions must use `decodeURIComponent()` before regex matching
- All API modules follow `{ok, data?, error?, status?}` return contract — tests validate both success and error shapes
- Edge cases tested: empty results, malformed JSON, null tokens, missing required fields, URL-encoding of path params, frozen constants, OData nextLink pagination, bulk operations with stopOnError
- Auth tests cover: client credentials (validation, token acquisition, caching, cache clear), managed identity (App Service path, IMDS fallback, network errors), device code (validation, request failures)
- CommonJS modules loaded via `createRequire(import.meta.url)` since test file uses ESM (consistent with kql-validator tests)

📌 **Bicep Templates Refactored for Phase 2 Integration** (2026-05-04)
- Updated all 11 Bicep templates in `templates/bicep/` with Phase 2 integration comment blocks
- SOAR templates (6): main, phishing-response, compromised-account, malware-containment, ip-enrichment, teams-notification
- ADX templates (5): main, cluster, database, tables, ingestion
- Each template now references: relevant PowerShell wrapper skills, `.secops/` config files, post-deployment scripts, and rate-limiting considerations
- Created `templates/bicep/README.md` (222 lines) documenting template inventory, Phase 2 skill cross-reference, pre-deployment checklist, parameter cross-reference, post-deployment automation patterns, rate limiting table, and architecture overview
- Skills referenced: sentinel-api-wrapper.md, defender-api-wrapper.md, data-tiering-commands.md, rate-limiting.md, sentinel-mcp-server.md, workbook-automation.md
- Pattern: comment blocks inserted between file header and `targetScope` declaration in all templates
- QA observation: Templates are structurally sound but post-deployment scripts (Configure-SoarPlaybooks.ps1, Configure-AdxSecurityLake.ps1) don't exist yet — they are forward-referenced for future implementation

📌 **Integration Test Suite Skill Created** (2026-05-04)
- Created `skills/testing/integration-test-suite.md` (562 lines) — comprehensive integration test patterns for all 5 orchestration workflows
- Created `skills/testing/README.md` (61 lines) — testing skill domain overview
- Test harness design: mock `Invoke-RestMethod` at boundary, `Register-MockResponse` pattern with URI regex matching, call count tracking, configurable failure injection
- Mock factories: `New-MockSentinelIncident`, `New-MockIncidentEntities`, `New-MockDefenderAlert`, `New-MockEdiscoveryCase`, `New-MockEdiscoverySearch`
- Environment isolation: `New-TestSecopsConfig` generates single-tenant, multi-tenant, and gov-cloud fixtures; `New-TestDataSourceMap` for workspace routing tests
- 5 workflow scenarios tested: Incident Investigation (Sequential+FanOut+Loop), Compliance Export (Sequential+Checkpoint), Threat Hunting (Sequential+Conditional+Loop), Data Tiering (Loop+Checkpoint), Shadow IT (Sequential+FanOut+Conditional)
- Error handling tests: retry with backoff (429/503), partial failure continuation, auth token refresh on 401, invalid `.secops/` graceful degradation
- Performance tests: 1000+ incident pagination, fan-out MaxConcurrency, query timeout, 500-entity batch
- `.secops/` context tests: missing config → helpful error, workspace routing, migration state, discovery log YAML format, gov-cloud endpoints, multi-tenant MSSP
- Pester patterns: `Assert-SuccessResult`/`Assert-ErrorResult` helpers for `@{ok;data/error}` contract, `Register-RateLimitedMock`, `Mock Invoke-AzRestMethod`
- All scenarios reference corresponding workflows from `cross-skill-orchestration.md`

📌 **Foundry Integration Test Strategy Authored** (2026-06-25)
- Audited `foundry-integration` branch: ZERO runtime code, ZERO tests, THREE confirmed defects before a single test was written
- Defect 1 — Schema drift: `secops-squad.config.schema.json` camelCase vs `.secops/foundry.yaml.example` snake_case vs `foundry-model-routing.md` pseudo-code reading fields (`active_model`, `status`) that exist in neither schema; documented detection code would always return `null`/`None`
- Defect 2 — Language mismatch: sole "implementation" is Python pseudo-code; project runtime is Node.js/CommonJS; nothing is executable
- Defect 3 — Future-dated API: `deploy-foundry-fable5.ps1` calls `api-version=2026-05-15-preview` (post-current-date); skill's own curl example uses `2025-04-01-preview` — inconsistency must be resolved before any deployment
- Test strategy covers: config detection (present/disabled/malformed/schema-drifted/partial), provider selection, endpoint URL construction (Anthropic `/anthropic/v1/` vs OpenAI `/openai/deployments/`), auth token acquisition/expiry/refresh, fallback on 401/404/429/timeout/network error, safety/redaction gates, SARIF payload sizing
- Fixture layout proposed: 9 fixture files under `lib/foundry/fixtures/` mirroring `lib/kql-validator/fixtures/`
- Six P0 merge-blocking gates defined; four P1 gates; three P2 gates
- CI workflow `foundry-tests.yml` spec: path-filtered on `lib/foundry/**` and `.secops/foundry*`, must run `npm test` with Node 18+
- Decision written to `.squad/decisions/inbox/carver-foundry-test-strategy.md`
- Reusable skill written to `.squad/skills/testing-external-http-module.md` (mock fetch pattern, sequence mock, token expiry pattern, safety/redaction pattern, fixture layout)
- Key lesson: when docs ship without a single runnable test, the schema contracts are always aspirational, not actual — test-first catches schema drift before it becomes integration debt

📌 **Foundry Phase 0 Tests Written and Green** (2026-06-25)
- Created `lib/foundry/config.test.js` — 34 tests across 8 describe blocks (all pass)
- Created `lib/foundry/auth.test.js` — 25 tests across 7 describe blocks (all pass)
- Total: 59 new tests; full suite npm test = 285/285 pass, 0 fail
- Test file locations: `lib/foundry/config.test.js`, `lib/foundry/auth.test.js`
- Fixture contract confirmed: valid→non-null, disabled→null, malformed→null, schema-drifted→null, partial→non-null, no-active-deployment→null
- Fixture import pattern: read raw YAML from `lib/foundry/fixtures/`, write to `mkdtempSync` temp dirs, clean up in after()/finally
- CJS module import in ESM test file: `createRequire(import.meta.url)` (matches graph-security pattern)
- SAFETY SMELL found and documented (non-blocking): `partial-foundry.yaml` (no endpoint) returns non-null from `loadFoundryConfig()` — fail-open; `resolveEndpoint()` silently produces a relative URL (e.g., `/anthropic/v1/messages`). Phase 1 recommendation: validate endpoint presence in `loadFoundryConfig()` and return null if absent (fail-closed).
- Schema regression test covers: example YAML parses valid, has all canonical snake_case fields, no camelCase keys; JSON schema has no `modelDeployments` key (drift removed), has $comment pointing to foundry.yaml
- Auth test injection: `execFn` parameter used throughout — no live az CLI or network calls; `clearTokenCache()` called in beforeEach/afterEach to isolate tests
- Phase 0 exit gate verdict: PASS (see `.squad/decisions/inbox/carver-foundry-phase0-verdict.md`)

---

## 2026-06-26T04:33:44Z — Foundry Phase 1 COMPLETED: All Merge Gates PASS + F-002 Resolved

Carver completed Phase 1 QA on foundry-integration branch (commits db80059 → faa913b → ada897c).

**Status:** Phase 1 PASS — CLEARED FOR MERGE

- Initial test run (commit db80059): Found F-002 (P0) — secret-scan exception text leaked into returned reason; verdict: FAIL pending fix
- Sydnor fixed F-002 (commit faa913b): redacted exception text to generic `secret-scan failed closed (<redacted>)`, error type only in logs
- Re-verification (commit ada897c): All 6 P0 merge gates now PASS:
  - Gate 1: Node.js/CommonJS, no Python ✓
  - Gate 2: `npm test` 322/322 pass, coverage 82.36% (meets ≥80%) ✓
  - Gate 3: Schema snake_case + regression tests ✓
  - Gate 4: Secret-scan blocks PII/keys before HTTP dispatch ✓
  - Gate 5: 401/404/429/timeout/ECONNREFUSED → `{ok:false}`, no throw ✓
  - Gate 6: Deploy script API version verified (`2025-04-01-preview`) ✓
- F-002 regression test confirmed: `Bearer scanthrowsecretvalue1234567890` absent from reason/logs ✓
- Verdict: Phase 1 PASS, CLEARED FOR MERGE

Inbox merged into decisions.md. Orchestration logs in .squad/orchestration-log/. Session log in .squad/log/.
