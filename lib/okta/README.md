# Okta API Library

Zero-dependency Node.js library for the [Okta Core API](https://developer.okta.com/docs/reference/core-okta-api/). Built for **read-first migration analysis** — enumerating users, groups, applications, and policies in preparation for identity migration (e.g., Okta → Microsoft Entra ID).

## Requirements

- **Node.js 18+** (uses native `fetch` and `crypto`)
- Okta org with an API token or OAuth 2.0 service app

## Design Posture: Read-First

This library is intentionally read-first. It does **not** expose write, update, or delete operations. Migration tooling should read and analyze, not modify production identity infrastructure without explicit review.

Any writes to Okta should be:
1. Explicit and purpose-built (not via this library)
2. Tested against a non-production org first
3. Gated behind human review

---

## Authentication Setup

### Method 1: SSWS API Token (Simplest)

1. In the Okta Admin Console → **Security → API → Tokens → Create Token**
2. Copy the token value
3. Set environment variable: `OKTA_API_TOKEN=<token>`

```javascript
const client = createClient({
  orgUrl: process.env.OKTA_ORG_URL,
  apiToken: process.env.OKTA_API_TOKEN,
  // authMethod: 'ssws' (default)
});
```

### Method 2: OAuth 2.0 — Client Credentials (clientId + clientSecret)

1. In Okta Admin Console → **Applications → Create App Integration → API Services**
2. Copy the Client ID and generate a Client Secret
3. Grant the app the required scopes via **Okta API Scopes** tab
4. Set env vars: `OKTA_CLIENT_ID`, `OKTA_CLIENT_SECRET`, `OKTA_ORG_URL`

```javascript
const client = createClient({
  orgUrl: process.env.OKTA_ORG_URL,
  clientId: process.env.OKTA_CLIENT_ID,
  clientSecret: process.env.OKTA_CLIENT_SECRET,
  scopes: ['okta.users.read', 'okta.groups.read', 'okta.apps.read'],
  authMethod: 'clientCredentials',
});
```

### Method 3: OAuth 2.0 — Private Key JWT (clientId + RSA private key)

The most secure option — no shared secret. The client proves identity by signing a JWT with an RSA private key.

1. Create an **API Services** app in Okta (as above)
2. Under **Public Keys** → Add a public key (generate a 2048-bit RSA keypair)
3. Keep the private key in a secrets manager; never commit it
4. Set env vars: `OKTA_CLIENT_ID`, `OKTA_PRIVATE_KEY` (PEM), `OKTA_ORG_URL`

```javascript
const client = createClient({
  orgUrl: process.env.OKTA_ORG_URL,
  clientId: process.env.OKTA_CLIENT_ID,
  privateKey: process.env.OKTA_PRIVATE_KEY, // PEM-encoded RSA private key
  scopes: ['okta.users.read', 'okta.groups.read', 'okta.apps.read'],
  authMethod: 'privateKeyJwt',
});
```

### Required OAuth Scopes by Module

| Module         | Minimum Scopes                                          |
|----------------|----------------------------------------------------------|
| `users`        | `okta.users.read`                                        |
| `groups`       | `okta.groups.read`                                       |
| `apps`         | `okta.apps.read`                                         |
| `policies`     | `okta.policies.read`                                     |

SSWS tokens with **Read-Only Administrator** role cover all of the above.

---

## Quick Start

```javascript
const { createClient, users, groups, apps, policies } = require('./lib/okta');

const client = createClient({
  orgUrl: process.env.OKTA_ORG_URL,
  apiToken: process.env.OKTA_API_TOKEN,
});

// List active users
const result = await users.listUsers(client, {
  filter: 'status eq "ACTIVE"',
  limit: 200,
});
if (result.ok) {
  console.log(`Found ${result.data.length} active users`);
}

// Get a specific user
const user = await users.getUser(client, 'alice@example.com');
if (user.ok) {
  console.log(user.data.profile.displayName, '→', user.data.status);
}
```

---

## The `{ok, ...}` Contract

Every API function returns a structured result object — **never throws for API errors**.

```javascript
// Success
{ ok: true, data: [...], nextLink?: string }

// Error
{ ok: false, error: string, status?: number, errorCode?: string }
```

```javascript
const result = await apps.listApps(client);

if (result.ok) {
  console.log(result.data);         // Array of app objects
  if (result.nextLink) {
    // More pages — pass nextLink to the same function
    const page2 = await apps.listApps(client, { nextLink: result.nextLink });
  }
} else {
  console.error(`Error: ${result.error}`);
  console.error(`Status: ${result.status}`);     // HTTP status code
  console.error(`Code: ${result.errorCode}`);    // Okta error code (if available)
}
```

---

## Pagination

All list functions support Okta's Link-header cursor pagination.

### Manual Pagination

```javascript
let allUsers = [];
let result = await users.listUsers(client, { limit: 200 });

while (result.ok) {
  allUsers.push(...result.data);
  if (!result.nextLink) break;
  result = await users.listUsers(client, { nextLink: result.nextLink });
}

console.log(`Total users: ${allUsers.length}`);
```

### Automatic Pagination (`fetchAll: true`)

```javascript
// WARNING: Use with care on large orgs — may return thousands of records
const result = await users.listUsers(client, { fetchAll: true });
if (result.ok) {
  console.log(`All users: ${result.data.length}`);
}
```

---

## Usage Examples

### Users

```javascript
// Search by department
const engineers = await users.searchUsers(
  client,
  'profile.department eq "Engineering" and status eq "ACTIVE"',
  { fetchAll: true }
);

// Get a user's MFA enrollments
const factors = await users.listUserFactors(client, '00u1abc...');
if (factors.ok) {
  factors.data.forEach(f => console.log(`${f.factorType} (${f.provider}) — ${f.status}`));
}

// Get user's lifecycle state
const lifecycle = await users.getUserLifecycle(client, 'alice@example.com');
// { status: 'ACTIVE', lastLogin: '2026-07-07T12:00:00.000Z', ... }
```

### Groups

```javascript
// List all Okta-managed groups
const oktaGroups = await groups.listGroups(client, {
  filter: 'type eq "OKTA_GROUP"',
  fetchAll: true,
});

// Get members of a specific group
const members = await groups.listGroupMembers(client, '00g1abc...', { fetchAll: true });

// List dynamic group rules
const rules = await groups.listGroupRules(client, { fetchAll: true });
rules.data.forEach(r => console.log(r.name, '→', r.conditions?.expression?.value));
```

### Applications

```javascript
// List all SAML applications
const samlApps = await apps.listApps(client, {
  filter: 'status eq "ACTIVE"',
  fetchAll: true,
});
const saml = samlApps.data.filter(a => a.signOnMode === 'SAML_2_0');

// Get full SAML settings for a specific app (ACS URL, Entity ID, attributes)
const samlConfig = await apps.getAppSamlSettings(client, '0oa1abc...');
if (samlConfig.ok) {
  console.log('ACS URL:', samlConfig.data.settings.ssoAcsUrl);
  console.log('Entity ID:', samlConfig.data.settings.audience);
  console.log('Attribute Statements:', samlConfig.data.settings.attributeStatements);
}

// Get OIDC settings for a specific app
const oidcConfig = await apps.getAppOidcSettings(client, '0oa2def...');
if (oidcConfig.ok) {
  console.log('Client ID:', oidcConfig.data.clientId);
  console.log('Grant Types:', oidcConfig.data.oauthClient.grantTypes);
  console.log('Redirect URIs:', oidcConfig.data.oauthClient.redirectUris);
}

// List groups assigned to an app
const appGroups = await apps.listAppGroups(client, '0oa1abc...', { fetchAll: true });
```

### Policies

```javascript
// List all sign-on policies (Okta's Conditional Access equivalent)
const signOnPolicies = await policies.listPolicies(client, 'OKTA_SIGN_ON');

// Get the rules for a specific policy (conditions + actions)
const rules = await policies.getPolicyRules(client, '00p1abc...');
rules.data.forEach(r => {
  console.log(`Rule: ${r.name} — MFA: ${r.actions?.signon?.requireFactor}`);
});

// Get all migration-relevant policies at once
const allPolicies = await policies.listAllMigrationPolicies(client);
// allPolicies.data = { OKTA_SIGN_ON: [...], MFA_ENROLL: [...], PASSWORD: [...], ... }

// List available authenticators (OIE orgs)
const authenticators = await policies.listAuthenticators(client);
authenticators.data.forEach(a => console.log(`${a.name} (${a.type}) — ${a.status}`));
```

---

## Rate Limiting

Okta enforces per-endpoint rate limits. The library handles HTTP 429 automatically:

1. Reads `X-Rate-Limit-Reset` header (Unix epoch when the window resets)
2. Waits until the reset timestamp plus a small jitter
3. Retries up to 3 times before returning `{ok: false, error: 'Rate limited...', status: 429}`

For bulk operations across large orgs, prefer:
- Using `fetchAll: true` with large `limit` values (fewer requests, same data)
- Spreading requests across multiple rate-limit windows
- Checking `X-Rate-Limit-Remaining` in response headers if polling custom logic

---

## Error Handling

```javascript
const result = await users.getUser(client, 'nonexistent@example.com');
if (!result.ok) {
  switch (result.status) {
    case 401: console.error('Check OKTA_API_TOKEN or OAuth config'); break;
    case 403: console.error('Insufficient scopes — check app permissions'); break;
    case 404: console.error('User not found'); break;
    case 429: console.error('Rate limited (auto-retried 3× — still hit limit)'); break;
    default:  console.error(`Error ${result.status}: ${result.error}`);
  }
  if (result.errorCode) console.error('Okta code:', result.errorCode);
}
```

---

## Module Reference

| Module          | Key Exports                                                                                                  |
|-----------------|--------------------------------------------------------------------------------------------------------------|
| `index.js`      | `createClient()`, all modules & constants (`GROUP_TYPE`, `USER_STATUS`, `SIGN_ON_MODE`, `POLICY_TYPE`, `FACTOR_TYPE`) |
| `auth.js`       | `getSswsAuthHeader()`, `getTokenClientCredentials()`, `getTokenPrivateKeyJwt()`, `clearTokenCache()`         |
| `users.js`      | `listUsers()`, `getUser()`, `searchUsers()`, `listUserGroups()`, `listUserFactors()`, `getUserLifecycle()`   |
| `groups.js`     | `listGroups()`, `getGroup()`, `listGroupMembers()`, `listGroupRules()`, `getGroupRule()`, `listGroupApps()`  |
| `apps.js`       | `listApps()`, `getApp()`, `getAppSamlSettings()`, `getAppOidcSettings()`, `listAppUsers()`, `listAppGroups()`, `listAppKeys()` |
| `policies.js`   | `listPolicies()`, `getPolicy()`, `getPolicyRules()`, `getPolicyRule()`, `listAuthenticators()`, `getAuthenticator()`, `listAllMigrationPolicies()` |
| `utils.js`      | `normalizeOrgUrl()`, `oktaGet()`, `oktaPost()`, `paginatedGet()`, `extractNextLink()` (internal helpers)    |

---

## Environment Variables

```bash
# Okta org URL (required for all auth methods)
OKTA_ORG_URL=https://acme.okta.com

# SSWS API token (for authMethod: 'ssws')
OKTA_API_TOKEN=00T...

# OAuth2 service app (for authMethod: 'clientCredentials' or 'privateKeyJwt')
OKTA_CLIENT_ID=0oa...
OKTA_CLIENT_SECRET=...          # clientCredentials only
OKTA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."  # privateKeyJwt only
```

See `.env.example` for the full schema. **Never hardcode credentials** — always source from environment variables or a secrets manager.
