---
name: "secops-onboarding"
description: "Captures SecOps-specific first-run clarifications a coordinator must ask before generating Microsoft-security-stack tooling or config — tenant model, auth method, and product scope — so the right files are scaffolded from the start."
domain: "onboarding, microsoft-security, multi-tenant, identity"
confidence: "medium"
license: MIT
---

# SecOps Onboarding Clarifications

Ask these questions **after the team is cast** (Phase 2 of first-run) and **before generating any `.secops/` config or tooling**. Ask them one at a time. Never batch all three into a single wall-of-text prompt.

---

## When to Use This Skill

Use this skill when:

- The user is setting up a new Microsoft-security-stack project for the first time
- `.secops/environment.yaml` or `.secops/identity/tenants.yaml` does not exist yet, or contains only template defaults
- The coordinator has just finished casting the team and is about to scaffold config

**Skip this skill** if all three answers are already captured in existing `.secops/` files with non-default values.

---

## Clarification 1 — Cross-Tenant / MSSP Model

> **Ask:** "Do you manage security across more than one Entra ID tenant? If so, how do those tenants relate?"

Present the options clearly. Wait for an answer before proceeding to Clarification 2.

### Option A — Azure Lighthouse (delegated resource management)

- The managing tenant (SOC/MSSP) has ARM-level access to customer subscriptions via a Lighthouse delegation ARM template.
- **No guest accounts** needed in the managed tenant; access is granted via RBAC projection.
- Access scoped to **Azure resources only** — no Entra ID object access (users, groups, policies) in the managed tenant unless explicitly re-delegated.
- Best for: ongoing multi-customer Sentinel workspace management, SOAR playbook deployment, Log Analytics operations.
- Config impact:
  - Managed tenants use `type: lighthouse-delegated` in `tenants.yaml` and `environment.yaml`
  - `lighthouse.delegations` block populated in `environment.yaml`
  - All Sentinel/ARM operations run from the managing tenant's subscription context

### Option B — GDAP (Granular Delegated Admin Privileges)

- Consent-driven, role-scoped, time-bounded delegation — initiated by the partner/MSSP, approved by the customer.
- Access spans **both ARM and Entra ID / Microsoft 365 workloads** with precise role targeting.
- As of April 2026, GDAP is being extended to cover Sentinel and Defender XDR delegation for non-CSP organizations (public preview). This is the strategic Microsoft direction for MSSP SIEM/XDR delegation going forward.
- **Best for**: new MSSP onboardings where you need to operate Sentinel/Defender XDR *and* manage Entra ID identity tasks from one unified delegation model; scenarios where Lighthouse's ARM-only scope is too narrow.
- Requires the CSP/partner model or the new unified delegated access handshake (April 2026+).
- Config impact:
  - Managed tenants use `type: managed` in `tenants.yaml`, with a `delegation_model: gdap` annotation
  - Authentication per tenant via the delegated security group in the managing tenant
  - Unified SOC portal (security.microsoft.com) is the operational surface

### Option C — B2B Guest Access

- SOC/MSSP users have **guest accounts** in each managed tenant with assigned roles.
- Simplest to set up, lowest operational scale ceiling. Works with any tenant — no CSP relationship required.
- Each guest needs explicit role assignment in every target tenant (Microsoft Sentinel Reader/Contributor, Security Reader, etc.).
- **Best for**: small-scale multi-tenant scenarios (2–5 tenants), personal/family trust models, or where Lighthouse/GDAP isn't available.
- Config impact:
  - Each tenant listed in `tenants.yaml` with `type: secondary` or `type: managed`
  - `cross_tenant_access.b2b.enabled: true` in `tenants.yaml`
  - Authentication uses per-tenant credentials (see Clarification 2)

### Option D — Separate Direct Auth Per Tenant (No Delegation)

- Each tenant is fully independent — no cross-tenant relationship.
- SOC has separate credentials (service principal or user) in each tenant.
- No Lighthouse, no GDAP, no guest accounts. Each tenant auth block is self-contained.
- **Best for**: isolated tenants with no managed relationship, dev/prod separation with no cross-access, compliance regimes that prohibit delegation.
- Config impact:
  - Each tenant has its own identity block with its own `client_id`, `auth_method`, and subscription reference
  - No `lighthouse` or `managed_customers` blocks needed
  - `org_type: enterprise` (not `mssp`) in `environment.yaml`

### Option E — Single Tenant

- Only one Entra ID tenant — skip multi-tenant config entirely.
- Config impact:
  - `tenants` list has exactly one entry with `type: primary`
  - No `lighthouse`, `managed_customers`, or `cross_tenant_access` blocks needed

---

## Clarification 2 — Authentication Method Per Tenant

> **Ask:** "How should the tooling authenticate to each tenant — automated service principal, managed identity, or interactive login?"

Ask per-tenant if Option A/B/C above produced multiple tenants. For each tenant, one of:

### Option A — App Registration (Service Principal)

**With client secret:**
- Quick to set up, works everywhere. Secret must be rotated; store in Key Vault, not `.env` files.
- Acceptable for automation in controlled environments. **Not recommended for production long-term** — secrets leak.

**With certificate:**
- Strongly preferred for automation. Certificate stored in Key Vault or local cert store; no exportable secret.
- Least-privilege: grant only the API permissions/roles the workload needs.
- Config: `auth_method: service_principal_cert`, `key_vault_cert_name` reference

**Minimum required roles for Sentinel operations:**
- `Microsoft Sentinel Reader` — read rules, incidents, workbooks
- `Microsoft Sentinel Contributor` — create/edit rules, incidents, playbooks
- `Microsoft Sentinel Responder` — triage incidents, run playbooks (no rule edit)
- `Log Analytics Reader` — KQL queries against the workspace

### Option B — Managed Identity

- **Best for automation** when the workload runs in Azure (Azure DevOps hosted agents, Azure Functions, Logic Apps, AKS pods).
- No credentials to manage — the platform handles token issuance and rotation.
- System-assigned or user-assigned. User-assigned is portable and re-usable across resources.
- **Cannot be used** from on-prem or GitHub Actions without workload identity federation (see Option C).
- Config: `auth_method: managed_identity`, optional `client_id` if user-assigned

### Option C — Workload Identity Federation (OIDC)

- **Best for GitHub Actions / external CI-CD**. The GitHub Actions OIDC token is exchanged for an Azure access token — no stored secrets.
- Requires configuring a federated credential on the app registration, mapping the GitHub repo/branch/environment.
- Least-privilege, no secret rotation, auditable.
- Config: `auth_method: workload_identity_federation`, `federated_credential_issuer`, `federated_credential_subject`

### Option D — Interactive (`az login` / Device Code)

- **For human operators only** — not suitable for automation.
- Use for ad-hoc threat hunting, incident investigation, one-off queries.
- MFA-enforced via Conditional Access — do not configure service accounts for interactive auth.
- Config: `auth_method: interactive` — no credentials stored; operators authenticate at runtime

### Least-Privilege Guidance

| Use Case | Recommended Auth | Role |
|---|---|---|
| Automated detection deployment (CI/CD) | Service principal cert or OIDC | Sentinel Contributor |
| Automated incident triage (SOAR) | Managed identity | Sentinel Responder |
| Read-only threat hunting (human) | Interactive | Sentinel Reader |
| Cross-tenant Lighthouse operations | Service principal cert (managing tenant) | Delegated RBAC per Lighthouse |
| GDAP delegated operations | GDAP security group (managing tenant) | Delegated Entra/Sentinel roles |

---

## Clarification 3 — Product Scope Per Tenant

> **Ask:** "Which Microsoft security products are active in each tenant? This determines what connectors and config blocks I'll generate."

For each tenant, select all that apply:

### Microsoft Sentinel

- Workspace-based SIEM. Requires a Log Analytics workspace with the Sentinel solution deployed.
- Config to scaffold: `workspaces/<name>.yaml`, `data-sources/data-source-map.yaml`
- Ask: workspace name, resource group, subscription, region
- **Sentinel data lake** (high-volume, cost-optimized long-term retention) — ask if in use for any tables

### Defender XDR (Unified SOC Platform)

- Unified portal: **security.microsoft.com** — Defender + Sentinel converged operational surface.
- Includes: endpoint, identity, cloud apps, email/collaboration signals under one pane.
- Config to scaffold: `environment.yaml` `org_type` field, Defender XDR connector block in data-source-map
- No separate workspace config needed — data flows through the Defender backend

### Defender for Endpoint (MDE)

- Agent-based EDR. Onboarding via Intune, SCCM, local script, or Group Policy.
- Data surfaces in Defender XDR portal and can stream to Sentinel via the MDE data connector.
- Config to scaffold: MDE data connector entry in data-source-map

### Defender for Cloud (MDC)

- Cloud security posture management (CSPM) + cloud workload protection (CWP) for Azure, AWS, GCP.
- Generates security recommendations, alerts, and compliance assessments.
- Config to scaffold: MDC connector in data-source-map, subscription reference

### Defender for Identity (MDI)

- Identity threat detection: monitors on-prem AD DS, Entra ID sign-in risk, lateral movement.
- Requires sensor deployment on domain controllers (on-prem AD) or uses Entra ID signals natively.
- Config to scaffold: MDI connector entry

### Defender for Office 365 (MDO)

- Email and collaboration threat protection (Exchange Online, Teams, SharePoint).
- Config to scaffold: MDO connector entry

### Entra ID Protection

- Automated risk detection for sign-in risk and user risk (leaked creds, impossible travel, MFA fatigue, etc.).
- Risk policies output to Entra and stream to Sentinel via the Entra ID Protection connector.
- Config to scaffold: Entra ID Protection connector entry, `identity/` RBAC block

### Microsoft Security Exposure Management (XSPM)

- Attack surface visibility, security initiative scoring, attack path analysis.
- Surfaces in security.microsoft.com under **Exposure Management**.
- Config to scaffold: exposure management product scope note in environment.yaml

---

## Decision Matrix: Answers → Config Files to Generate

| Answer | Files / Blocks to Generate |
|---|---|
| Single tenant | `tenants.yaml` (1 entry, `type: primary`), `environment.yaml` (`org_type: enterprise`) |
| Lighthouse (multi-tenant) | `tenants.yaml` with `type: lighthouse-delegated` entries, `environment.yaml` `lighthouse.delegations` block, `managed_customers` list |
| GDAP (multi-tenant) | `tenants.yaml` with `type: managed` + `delegation_model: gdap`, `environment.yaml` `org_type: mssp`, per-tenant auth blocks |
| B2B guest (multi-tenant) | `tenants.yaml` with `cross_tenant_access.b2b.enabled: true`, per-tenant entries |
| Separate direct auth | Per-tenant identity blocks only; no delegation sections |
| Auth: service principal cert | `identity/` block with `auth_method: service_principal_cert`, `key_vault_cert_name` |
| Auth: managed identity | `identity/` block with `auth_method: managed_identity` |
| Auth: OIDC | `identity/` block with `auth_method: workload_identity_federation`, federated credential fields |
| Auth: interactive | `identity/` block with `auth_method: interactive`; note no automation support |
| Product: Sentinel | `workspaces/<name>.yaml`, `data-sources/data-source-map.yaml` |
| Product: Defender XDR | Defender XDR connector block in data-source-map, `org_type` check |
| Product: MDE/MDC/MDI/MDO | Respective connector entries in data-source-map |
| Product: Entra ID Protection | Entra ID Protection connector entry, `identity/` RBAC block |
| Product: Exposure Management | `environment.yaml` product scope annotation |

---

## Config Schema Vocabulary Reference

Match these field names when writing `.secops/` YAML — they align with existing example schemas.

### `environment.yaml`

```yaml
organization:
  org_type: "enterprise"   # enterprise | mssp

tenants:
  - id: "<TENANT_ID>"
    name: "<NAME>"
    type: "primary"        # primary | secondary | managed | lighthouse-delegated | csp

lighthouse:
  delegations: []          # populated for Lighthouse model

managed_customers: []      # populated for MSSP/Lighthouse model
```

### `identity/tenants.yaml`

```yaml
tenants:
  - id: "<TENANT_ID>"
    type: "primary"        # primary | secondary | managed | lighthouse-delegated | csp
    cloud: "azure-commercial"

cross_tenant_access:
  b2b:
    enabled: false         # true for B2B guest model
  lighthouse:
    enabled: false         # true for Lighthouse model
```

### Auth block (per tenant in identity config)

```yaml
auth_method: "service_principal_cert"   # service_principal_cert | service_principal_secret | managed_identity | workload_identity_federation | interactive
client_id: "<APP_ID>"
tenant_id: "<TENANT_ID>"
key_vault_cert_name: "<CERT_NAME>"       # for service_principal_cert
# client_id only, no secret for managed_identity
# federated_credential_issuer / federated_credential_subject for workload_identity_federation
```

---

## Ask-One-At-A-Time Protocol

Follow the same ask-one-at-a-time rule from `first-run-onboarding`:

1. Ask Clarification 1 (tenant model). **Wait for answer.**
2. Ask Clarification 2 (auth method) for each tenant. **Wait for answer.**
3. Ask Clarification 3 (product scope) for each tenant. **Wait for answer.**
4. Then generate `.secops/` config using the decision matrix above.

**Never** dump all three questions at once. Each answer shapes the next question (e.g., if single-tenant, auth question has no "per-tenant" qualifier).

If the user says "I don't know" or "I'll figure it out later," write a placeholder with a `# TODO:` comment and note which clarification is outstanding in `.secops/discovery-log.yaml`.

---

## Anti-Patterns

| Anti-Pattern | Why Bad | Do This Instead |
|---|---|---|
| Scaffolding `tenants.yaml` before asking Clarification 1 | Wrong tenant type gets hardcoded | Ask first, scaffold after |
| Defaulting to interactive auth for all tenants | Blocks automation from day one | Ask intent — automate vs. human ops |
| Generating Sentinel workspace config when only Defender XDR is in use | Creates phantom workspace references | Product scope drives what's scaffolded |
| Using Lighthouse for Entra ID / identity tasks | Lighthouse is ARM-only; Entra tasks need GDAP or B2B | Match delegation model to task scope |
| Recommending Lighthouse when user is CSP/partner and has GDAP | GDAP is the strategic path from 2026 onward for CSP scenarios | Recommend GDAP for new CSP/MSSP onboardings |
| Storing client secrets in `.env` or repo files | Secrets leak via git history | Always reference Key Vault names, never values |

---

## References

- Azure Lighthouse overview: https://learn.microsoft.com/azure/lighthouse/overview
- GDAP for Sentinel/Defender (2026 preview): https://azurefeeds.com/2026/03/21/how-granular-delegated-admin-privileges-gdap-allows-sentinel-customers-to-delegate-access/
- Unified SOC platform (security.microsoft.com): https://learn.microsoft.com/unified-secops-platform/overview-unified-soc-platform
- Microsoft Sentinel RBAC: https://learn.microsoft.com/azure/sentinel/roles
- Workload identity federation (GitHub Actions → Azure): https://learn.microsoft.com/entra/workload-id/workload-identity-federation
