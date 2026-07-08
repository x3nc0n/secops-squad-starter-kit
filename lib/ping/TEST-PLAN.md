# Ping Identity Framework — Test Plan

**Author:** Seraph (Tester/QA)  
**Date:** 2026-07-08T18:16:41-05:00  
**Status:** FINAL — executed against landing branch

---

## 1. Scope

Unit tests for the `lib/ping/` framework and `mcp/pf-admin/` MCP scaffold.  
All tests run in-process with mocked `fetch`; **no live network calls in any test**.

---

## 2. Test Files

| File | Modules Covered | Runner |
|---|---|---|
| `lib/ping/config.test.js` | `config.js` — loadMigrationProfile, validateProfile | `node --test` |
| `lib/ping/gate.test.js` | `gate.js` — all 4 gates, isDryRun, dryRunGuard, cutoverWorkflow | `node --test` |
| `lib/ping/detect.test.js` | `detect.js` — detectDeployment, KNOWN_DOMAINS, matchKnownDomain | `node --test` |
| `lib/ping/config.gate.test.js` | Smoke integration: config → gate chain | `node --test` |
| `lib/ping/ping.test.js` | `index.js` — createClient, deployment discriminator, constants | `node --test` |
| `lib/ping/cloud.test.js` | `cloud/apps.js`, `cloud/users.js`, `cloud/groups.js`, `cloud/environments.js`, `cloud/policies.js`, `cloud/auth.js` | `node --test` |
| `lib/ping/onprem.test.js` | `onprem/pingfederate.js`, `onprem/pingdirectory.js`, `onprem/pingaccess.js` | `node --test` |

---

## 3. Mock Strategy

**ALL HTTP calls are mocked.** No test makes a live network request.

### Cloud modules (`cloud/*.js`)

Cloud modules call `pingRequest(client, method, url)` → `fetch()`.  
Tests override `globalThis.fetch` with a URL-pattern map before each test and restore it in `afterEach`.

Mock client shape:
```js
{ baseUrl: 'https://api.pingone.com/v1', getAuthHeader: async () => 'Bearer test-token' }
```

HAL response shape expected by cloud modules:
```json
{ "_embedded": { "<resourceKey>": [...] }, "_links": { "next": { "href": "..." } } }
```

### On-prem modules (`onprem/pingfederate.js`, `onprem/pingdirectory.js`)

These call `pfRequest(client, method, path)` and `pingRequest(client, method, url)` → `fetch()`.  
Same `globalThis.fetch` override approach.

PF mock client: `{ adminUrl: 'https://pf.corp.example.com:9999', getAuthHeader: () => 'Basic dXNlcjpwYXNz', xsrfHeader: 'PingFederate' }`  
PD mock client: `{ scimUrl: 'https://pd.corp.example.com/scim/v2', getAuthHeader: () => 'Basic ...' }`

### PingAccess (`onprem/pingaccess.js`)

PingAccess calls `fetch` directly. Tests override `globalThis.fetch` and return a response with `Set-Cookie` headers to simulate login and session behavior.

---

## 4. Fixture Files

| Fixture | Purpose |
|---|---|
| `fixtures/valid-hybrid-profile.yaml` | Full hybrid profile; all classes ping-owned |
| `fixtures/valid-cloud-profile.yaml` | Cloud-only profile |
| `fixtures/valid-onprem-profile.yaml` | On-prem only profile |
| `fixtures/entra-owned-profile.yaml` | All classes entra-owned; exercises gate allows |
| `fixtures/invalid-profile.yaml` | 7 distinct validation errors (identity_authority, federation_source, per_class_ownership.groups, cutover_shape, mfa_strategy, nameid_strategy, dry_run type) |
| `fixtures/no-migration-profile.yaml` | YAML without a `migration_profile:` block |

---

## 5. Edge Cases per Surface

### Cloud-only
- `listApplications`: requires `client` and `envId`; missing either → `{ok:false}`
- HAL pagination: `nextLink` in response → `listUsers(client, envId, {nextLink})` follows cursor
- `fetchAll: true` → `paginatedGet` collects all pages
- Empty `_embedded` (no results) → `data: []`

### `listSamlApps` / NameID end-to-end
- Each SAML app is enriched with `nameIdFormat` field (top-level)
- When `spSaml.nameIdFormat` is present → extracted
- When `spSaml` is absent → `nameIdFormat: null`
- `assertNameIdPortable(profile, transientFormat)` → `{ok:false, blocker:'nameid_incompatible'}`
- Full chain: `listSamlApps` returns transient format → gate hard-blocks

### On-prem: PingFederate
- `fetchOpenApiSpec`: first probe (`/pf-admin-api/api-docs`) succeeds → returns spec
- `fetchOpenApiSpec`: BOTH probes fail → `{ok:false, error contains "candidate"}`
- XSRF header injected on non-GET requests; absent on GET
- Pagination: `fetchAll:true` auto-pages until `items.length < pageSize`

### On-prem: PingAccess
- `login()` success: `{ok:true, data:{cookie, xsrfToken}}`
- `login()` non-200 response → `{ok:false, status}`
- `login()` network error → `{ok:false, error}`
- `login()` success with no session cookie in response → `{ok:false}`
- GET requests do NOT send XSRF header
- Session expired (401) → `{ok:false, error includes "session expired"}`

### On-prem: PingDirectory
- SCIM `/Users` response extracted from `Resources[]`
- `fetchAll:true` collects pages via startIndex/count until `Resources.length < pageSize`
- Missing `client` → `{ok:false, error:'client is required'}`

### AIC-disabled
- `createClient` with hybrid config but no AIC block: `client.aic` is `undefined`
- `createClient` with AIC block: `client.aic.getAuthHeader()` resolves to a string

### XSRF scenarios
- PF: `X-XSRF-Header: PingFederate` only on non-GET methods
- PA: `XSRF-TOKEN` cookie value echoed in `X-XSRF-TOKEN` request header on POST

### 429 back-off retry
- PingOne `pingRequest`: 429 response → retries up to `MAX_RETRIES` times
- `MAX_RETRIES` exported and equal to 3

### detect.js probe timeout
- `DEFAULT_TIMEOUT_MS` = 3000
- AbortController cancels probe after timeout; result is `{ok:false, error contains "timeout"}`
- `detectDeployment` never throws even when fetch throws synchronously

---

## 6. Acceptance Gate Checklist

- [ ] All test files pass: zero failures in ping files
- [ ] `loadMigrationProfile()` round-trips all 5 fixtures
- [ ] `createClient()` throws synchronously for missing required config
- [ ] `assertEntraOwned` blocks ping-owned; `assertNameIdPortable` hard-blocks 3 formats
- [ ] `dryRunGuard` short-circuits when `dry_run: true`
- [ ] `detectDeployment()` identifies all 5 surface types from mocked responses
- [ ] `listSamlApps()` enriches with `nameIdFormat` (null when absent)
- [ ] `fetchOpenApiSpec()` degrades gracefully when both probe paths fail
- [ ] `pingaccess.login()` returns `{ok, data:{cookie, xsrfToken}}`
- [ ] Zero undeclared dependencies (only `js-yaml` + Node built-ins + relative paths)
- [ ] No regressions to okta/reset/cli suites
