---
title: Ping Identity Skills Domain
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
---

# Ping Identity Skills Domain

## ⚠️ Terminology First — Read This Before Anything Else

"Ping" covers five distinct products that behave entirely differently. Agents that conflate them produce wrong plans. Know what you're looking at before you write a line of API code.

| Name | What It Is | Where It Runs | Notes |
|---|---|---|---|
| **PingOne** | Cloud IAM platform (workforce + customer) | SaaS | Ping Identity's modern cloud product. REST API at `api.pingone.{region}`. This is the main migration source for cloud customers. |
| **PingOne Advanced Identity Cloud (AIC)** | Cloud IAM — ForgeRock lineage | SaaS | Acquired from ForgeRock in 2023. Branded as PingOne AIC. Tenants use `.forgeblocks.com` domain. Different API surface from PingOne. |
| **PingID** | MFA / step-up authentication ONLY | SaaS add-on | NOT an identity platform. PingID is the authenticator app and service that handles second-factor challenges. Often bolted onto PingFederate or PingOne. |
| **PingFederate** | Enterprise federation server (SAML/OIDC/WS-Fed) | On-premises or customer-hosted | The heavyweight on-prem IdP. Most large enterprise "Ping customers" are running PingFederate. REST admin API on port 9999. |
| **PingDirectory** | LDAP/SCIM user store | On-premises or customer-hosted | The authoritative user store behind PingFederate. SCIM `/scim/v2/` + LDAP. Often the real migration blocker because this is where the accounts live. |
| **PingAccess** | Coarse-grained access management / web proxy | On-premises or customer-hosted | Sits in front of web apps. Validates tokens, enforces policies. REST admin API at `/pa-admin-api/v3/`. |
| **PingGateway** | API security proxy | On-premises or customer-hosted | Lightweight reverse proxy / API gateway. Not an identity server. Often confused with PingAccess. |

### The Common Confusion Patterns

**"We use PingID"** — The customer means they are using Ping's MFA product. They almost certainly have PingFederate or PingOne behind it. Ask what the primary IdP is.

**"We use PingFederate with PingDirectory"** — This is the classic on-prem stack. PingFederate handles federation; PingDirectory is the user store. Migration from this stack means moving both.

**"We use PingOne"** — This is the cloud product. Significantly easier to migrate from because it has a clean REST API and no on-prem infrastructure.

**"We use PingOne AIC"** — This is the ForgeRock-lineage cloud product. Different API, different tools, different migration path from standard PingOne.

---

## The Hybrid Reality

Almost no enterprise Ping deployment is pure cloud or pure on-prem. The typical production environment looks like one of these:

### Pattern A — On-Prem PingFederate + PingDirectory (Classic Enterprise)
```
PingDirectory (LDAP user store)
    ↓ LDAP/DSEE
PingFederate (SAML/OIDC federation)
    ↓ SAML assertions
Applications
    PingID (bolted on for MFA)
    PingAccess (in front of web-facing apps)
```

### Pattern B — Hybrid: PingFederate + PingOne Cloud
```
PingDirectory (on-prem)
    ↓ LDAP
PingFederate (on-prem) — federated to PingOne
    ↑                        ↓
 On-prem apps        Cloud apps via PingOne
```

### Pattern C — Pure PingOne Cloud (Modern / Post-2019 Deployments)
```
PingOne Environments + Populations
    ↓
Applications (SAML + OIDC)
    +
PingID (cloud MFA)
    +
DaVinci flows (advanced auth orchestration)
```

**Migration implication:** Pattern A is the hardest. You are migrating the LDAP schema, the PingFederate connection definitions, the adapter configurations, the attribute contracts, and the PingID MFA enrollments. Each of those is a separate domain. Pattern C is the easiest — PingOne has a clean REST API and most concepts map reasonably to Entra.

---

## Two Operating Modes

Like the Okta skill set, these docs serve two operational contexts.

### Mode 1 — Ping → Entra ID Migration

The org is moving from Ping (in any of the above configurations) to Microsoft Entra ID. Ping objects must be inventoried, evaluated, and recreated or replaced in Entra. The skill files provide the read paths — what API calls to make to extract the data needed for migration planning.

**Key concerns:**
- Understanding which Ping product(s) are actually in use (see Terminology above)
- Extracting SP/IdP connection definitions from PingFederate
- Mapping PingDirectory user attributes to Entra user properties
- Handling PingID MFA migration (hint: there is no migration path; users re-enroll)
- Coexistence: dual-IdP periods, SAML cutover, token issuer changes

### Mode 2 — Ping-Federated Operations

The org keeps Ping as the primary IdP, potentially federated to Microsoft services. The agent needs Ping's object model to answer security questions, write detection logic, and support operational tasks.

---

## Skill Files

| File | Description |
|---|---|
| **[core-api-overview.md](core-api-overview.md)** | API surface across the Ping portfolio: PingOne, PingOne AIC, PingFederate, PingDirectory, PingAccess |
| **[ping-mcp-servers.md](ping-mcp-servers.md)** | The three official Ping MCP servers — what they cover, what they don't, and when to build your own |
| **[pingfederate-onprem.md](pingfederate-onprem.md)** | Deep dive on the PingFederate admin API for migration discovery: connections, adapters, SAML/OIDC, NameID |
| **[pingone-cloud.md](pingone-cloud.md)** | PingOne cloud: environments, populations, users, groups, applications, DaVinci flows, MFA |

**Coming later (migration-map phase — not yet authored):**
- `ping-to-entra-migration-map.md` — Consolidated Ping → Entra mapping with quality tiers

---

## Environment Context

Before working with any Ping system, check `.secops/identity/` for:
- Which Ping product(s) the customer is running (ask if unclear)
- On-prem hostnames and port accessibility for PingFederate/PingDirectory/PingAccess
- PingOne environment ID and region (for cloud)
- Whether PingID is in use for MFA (affects user migration planning)
- Whether PingAccess or PingGateway is protecting any resources you need to enumerate

If a `ping.yaml` identity config file does not exist, create one from the Okta example template as a starting point and adapt the fields for Ping.

---

## Related Skills

- `skills/msft-security/entra-id-protection.md` — Entra identity risk and Conditional Access (migration target)
- `skills/msft-security/microsoft-graph-security.md` — Graph API for Entra user/group/policy management
- `skills/okta/` — Okta domain (separate migration track; same Entra target)
