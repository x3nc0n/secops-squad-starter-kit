# Okta → Microsoft Entra ID Migration Architecture

**Author:** McNulty (Lead)  
**Date:** 2026-07-08  
**Status:** Proposed — awaiting x3nc0n approval  
**Branch:** `foundry-integration`

---

## Executive Summary

This document defines the architecture for migrating identity from Okta to Microsoft Entra ID. It covers the phased migration model, coexistence strategy during transition, tooling boundaries between the official Okta MCP server, our `lib/okta` library, and Microsoft Graph, and the decision framework for cutover strategy. It also supports operating in Okta-federated environments where Okta remains the IdP permanently.

The guiding principles:

1. **Read-first, dry-run-gated.** No destructive operation executes without a successful dry-run producing a diff that a human reviews.
2. **Idempotent and re-runnable.** Every migration step can be re-executed safely. State tracking prevents duplicate creation.
3. **Rollback by default.** Every phase has a documented rollback path. If rollback is impossible (e.g., MFA re-enrollment), that's called out explicitly.
4. **Source-of-truth is singular per object class at any point in time.** No dual-master. Sync is always one-way with a named direction.

---

## 1. Migration Phases

### Phase Model

```
┌─────────────┐    ┌─────────┐    ┌───────────────────┐    ┌──────────┐    ┌───────────────┐
│  DISCOVER   │───▶│   MAP   │───▶│ PILOT/COEXISTENCE │───▶│ CUTOVER  │───▶│ DECOMMISSION  │
│  (Inventory)│    │(Transform)   │  (Dual-run)       │    │(Switch)  │    │  (Cleanup)    │
└─────────────┘    └─────────┘    └───────────────────┘    └──────────┘    └───────────────┘
```

| Phase | Entry Criteria | Exit Criteria | Rollback |
|-------|---------------|---------------|----------|
| **Discover** | Okta org access confirmed; scopes granted (`okta.users.read`, `okta.groups.read`, `okta.apps.read`, `okta.policies.read`, `okta.logs.read`) | Complete inventory exported: users, groups, apps, policies, authenticators, sign-on policies. Inventory validated against Okta admin console counts. | N/A — read-only phase. |
| **Map** | Inventory complete; Entra target tenant provisioned; mapping reference authored (Kima's `skills/okta/`) | Mapping file produced for every object class. No-1:1-map items flagged with remediation plan. Mapping reviewed and approved by identity owner. | Delete mapping artifacts; no Entra changes made yet. |
| **Pilot / Coexistence** | Mapping approved; pilot population selected (<5% of users); Entra Conditional Access baseline deployed | Pilot users authenticate via Entra for all pilot apps. No auth failures attributable to migration. Coexistence federation validated (Okta IdP → Entra or vice versa). MFA re-enrollment complete for pilot. | Remove pilot users from Entra app assignments; revert federation trust to Okta-primary; pilot users fall back to Okta auth seamlessly. |
| **Cutover** | Pilot success confirmed (≥2 weeks stable); full population mapping validated; rollback plan tested | All users authenticate via Entra. All apps re-pointed to Entra. Okta sign-on policies disabled (not deleted). No active Okta sessions. | Re-enable Okta sign-on policies; revert app federation to Okta; users re-authenticate via Okta. Window: must complete within token lifetime (typically 1h). |
| **Decommission** | Cutover stable ≥30 days; Okta system logs show zero auth events for 14 consecutive days; all SAML/OIDC certs rotated to Entra-only | Okta org suspended (not deleted — retain for 90-day audit trail). All Okta-issued SAML signing certs revoked. SCIM connectors disabled. | **Irreversible after org deletion.** During suspension window: reactivate org, re-enable sign-on policies, revert federation. After deletion: full rebuild from backup. |

### Phase Duration Estimates (Conservative)

| Phase | Duration | Parallelizable |
|-------|----------|---------------|
| Discover | 1–2 weeks | — |
| Map | 2–4 weeks | Partially (per object class) |
| Pilot | 4–8 weeks | — |
| Cutover | 1–5 days (per wave if phased) | Per population wave |
| Decommission | 2–4 weeks post-stabilization | — |

---

## 2. Continuity & Coexistence Model

### Source-of-Truth per Object Class Over Time

| Object Class | Discover/Map | Pilot | Cutover | Post-Cutover |
|-------------|-------------|-------|---------|-------------|
| **Users (lifecycle)** | Okta | Okta (pilot users dual-provisioned to Entra) | Entra | Entra |
| **Users (attributes)** | Okta | Okta → Entra (one-way sync via SCIM or Graph import) | Entra | Entra |
| **Groups (membership)** | Okta | Okta (mirrored to Entra via sync) | Entra | Entra |
| **App assignments** | Okta | Split: pilot apps in Entra, others in Okta | Entra | Entra |
| **MFA/Authenticators** | Okta | Dual-enrollment required for pilot users | Entra | Entra |
| **Conditional Access / Sign-on Policies** | Okta (sign-on policies) | Both (Okta policies active for non-pilot; Entra CA for pilot) | Entra CA | Entra CA |
| **SAML/OIDC trust** | Okta is IdP | Okta IdP for non-pilot apps; Entra IdP for pilot apps | Entra IdP | Entra IdP |

### Sync Direction

During coexistence, sync is **always Okta → Entra (one-way)**. Entra is the write target; Okta remains authoritative for non-migrated objects. There is **no dual-write** — dual-write creates conflict resolution nightmares that are unacceptable for identity.

**Mechanism options:**
- **SCIM provisioning (Okta → Entra):** Okta pushes user/group changes to Entra via SCIM. Mature, well-supported. Limitation: Okta SCIM doesn't push all custom attributes.
- **Batch sync via `lib/okta` + Graph:** Periodic export from Okta (via `lib/okta`), transform, write to Entra (via Graph). More control, handles custom attributes. Requires scheduling.
- **Recommended:** SCIM for core lifecycle (create/update/deactivate) + batch sync for custom attributes and app assignments.

### Federation During Transition

Two viable patterns:

| Pattern | How it Works | When to Use |
|---------|-------------|-------------|
| **Okta-as-IdP into Entra** | Okta remains the authentication endpoint; Entra trusts Okta as an external IdP via SAML/OIDC federation. Users authenticate at Okta, get tokens for Entra-protected resources. | Early coexistence. Minimizes user disruption. Allows gradual app re-pointing. |
| **Entra-as-IdP with Okta apps** | Entra becomes primary; apps still configured in Okta point to Entra for auth via federated SAML relay. | Late coexistence / pre-cutover. Used when most users are already on Entra. |

**Recommended default:** Start with Okta-as-IdP into Entra during pilot. Flip to Entra-as-IdP once >50% of apps have been re-pointed.

### Highest-Risk Seams

1. **Auth cutover moment** — The instant users switch from Okta to Entra auth. Risk: session invalidation, app-specific token caching, service accounts with hardcoded Okta endpoints.
2. **MFA re-enrollment** — Okta authenticators (Okta Verify, WebAuthn keys) do NOT transfer to Entra. Users must re-register in Microsoft Authenticator. Risk: support ticket surge, user lockout if re-enrollment window is too short.
3. **App SSO re-pointing** — Changing SAML/OIDC config in each SP to point to Entra metadata. Risk: SP-specific quirks (certificate pinning, hardcoded issuer validation, audience restriction mismatches).
4. **Service account / API integration breakage** — Integrations using Okta OAuth tokens or SAML assertions will break at cutover unless pre-migrated.
5. **Conditional Access policy gap** — Okta sign-on policies and Entra CA are not equivalent. Gap period between Okta policy disable and Entra CA enforcement = zero-trust gap.

---

## 3. What Migrates Cleanly vs. What Doesn't

### Clean Migration (1:1 or near-1:1 mapping)

| Okta Object | Entra Equivalent | Notes |
|------------|-----------------|-------|
| Users (core attributes: name, email, status) | Entra ID users | Direct mapping. UPN strategy needed (email vs. custom). |
| Groups (static membership) | Entra security groups | Direct. |
| SAML apps (standard config) | Entra enterprise apps (SAML) | Metadata swap. Usually clean. |
| OIDC apps (standard config) | Entra app registrations | Redirect URIs, scopes map directly. Secret rotation required. |
| User lifecycle states (active/suspended/deprovisioned) | Entra account enabled/disabled/deleted | Mapping is straightforward. |

### No 1:1 Map — Requires Remediation

| Okta Concept | Entra Equivalent (Approximate) | Gap / Risk | Framework Handling |
|-------------|-------------------------------|-----------|-------------------|
| **Okta Sign-On Policies** (per-app, per-group, factor-based) | **Conditional Access policies** (broader, assignment-based, grant/session controls) | Different mental model. Okta is per-app sign-on; Entra CA is policy-targeted-at-apps-users-conditions. No automatic conversion. | `lib/okta` exports sign-on policies → mapping phase produces CA policy *drafts* in JSON → human review → Graph deploys in report-only mode first. |
| **Okta MFA Authenticators** (Okta Verify, SMS, hardware tokens) | **Entra MFA methods** (Microsoft Authenticator, FIDO2, TAP) | **Non-transferable.** Okta Verify registrations cannot move to MS Authenticator. TOTP seeds are not exportable from Okta. | Dual-enrollment during pilot. Temporary Access Pass (TAP) for bulk re-enrollment. Hardware tokens: re-seed or replace. |
| **Okta Group Rules** (dynamic membership via expressions) | **Entra dynamic groups** (rule syntax differs) | Expression languages are incompatible. Complex rules may not translate. | `lib/okta` extracts rules → mapping phase converts to Entra dynamic membership rules → validation against test population. Manual rewrite for unsupported expressions. |
| **SAML signing certificates** (Okta-issued) | **Entra-issued SAML signing certs** | Must re-issue from Entra. SPs that pin Okta's cert will break. | App inventory flags cert-pinning SPs. Dual-cert period: configure SP to trust both Okta and Entra certs before cutover. |
| **OIDC client secrets** | **Entra app registration secrets/certs** | Secrets cannot be copied. Must rotate to new Entra-issued credentials. | Inventory all client_secret consumers. Issue new secrets in Entra. Coordinate rotation with app owners. |
| **Okta Workflows** (if/then automation) | **Logic Apps / Power Automate / Lifecycle Workflows** | Completely different platforms. No conversion tool exists. | Manual rewrite. Inventory all active workflows; prioritize by business criticality; rebuild in target platform. |
| **Network Zones** (IP-based access control) | **Named Locations** (CA condition) | Conceptually similar but integrated differently (standalone in Okta vs. CA condition in Entra). | Export zones → create Named Locations → reference in CA policies. |
| **Custom Okta attributes** (user profile schema) | **Entra extension attributes / directory extensions** | Limited built-in extension attributes (15). Graph-registered extensions are unlimited but require app registration. | Map custom attributes → decide: built-in extension attrs, directory extensions, or custom security attributes. |

---

## 4. Cutover Strategy Options

### Option A: Big-Bang Cutover

**What:** All users, all apps switch to Entra on a single maintenance window.

| Pros | Cons |
|------|------|
| Shortest coexistence period | Highest risk — single point of failure |
| Simplest to reason about (no split-brain) | Requires ALL apps ready simultaneously |
| Lowest ongoing sync cost | MFA re-enrollment for entire population at once |
| Clean break — no lingering Okta dependencies | Rollback window is extremely tight (token lifetime) |

**Rollback:** Re-enable Okta sign-on policies, revert app federation configs, revert DNS (if applicable). Must execute within 1 hour of cutover (before Entra-issued tokens expire and users experience hard failures on rollback).

**When appropriate:** Small orgs (<500 users), limited app portfolio (<20 apps), strong testing confidence.

### Option B: Phased by Application (Recommended Default)

**What:** Migrate apps in waves (3–5 apps per wave). Users accessing migrated apps authenticate via Entra; others continue via Okta.

| Pros | Cons |
|------|------|
| Incremental risk — blast radius per wave is bounded | Extended coexistence period (weeks–months) |
| Each wave validates the next | Federation complexity during transition |
| App owners can prepare independently | Users may authenticate via both IdPs (confusion) |
| Rollback is per-app (revert SP config) | Requires robust federation (Okta-as-IdP ↔ Entra) |

**Rollback:** Per-app: revert SP's SAML/OIDC metadata to Okta. Users for that app fall back to Okta auth. No impact on other migrated apps.

**Wave sequencing recommendation:**
1. Wave 0: Internal low-risk apps (wiki, time tracking) — prove the pattern
2. Wave 1: Apps with standard SAML/OIDC, no custom integrations
3. Wave 2: Apps with custom attributes or group-rule dependencies
4. Wave 3: High-criticality apps (HR, finance, production SaaS)
5. Wave 4: Service accounts and API integrations (highest coordination cost)

### Option C: Phased by Population

**What:** Migrate user cohorts (by department, geography, or risk tier). Each cohort switches entirely to Entra.

| Pros | Cons |
|------|------|
| MFA re-enrollment is manageable per cohort | Apps must support both IdPs simultaneously |
| Support burden is distributed over time | Complex: same app has users from both IdPs |
| Departmental readiness can vary | Requires SP multi-IdP support (not all apps do) |
| Rollback is per-cohort | Group/membership sync is complicated |

**Rollback:** Per-cohort: revert cohort's user objects to Okta-primary; re-enable Okta sign-on policies for that population; revert cohort-specific CA policies.

**When appropriate:** Large orgs (>5000 users) with strong departmental boundaries and apps that support multi-IdP (e.g., via SAML IdP discovery / Home Realm Discovery).

### Recommended Default

**Option B (Phased by Application)** is the recommended default because:
- Risk is bounded per wave and independently rollback-able.
- App owners drive their own readiness — no big-bang coordination tax.
- Federation during transition is well-understood (Okta-as-IdP into Entra).
- MFA re-enrollment can be staggered by app wave (users only need Entra MFA for migrated apps).

**Rollback for recommended default:** Revert the SP's IdP metadata to Okta. Restore Okta sign-on policy for that app. Users immediately fall back. No data loss. Proven in pilot phase before full rollout.

---

## 5. Tooling Boundary — Official Okta MCP vs. lib/okta vs. Microsoft Graph

This is the critical architectural seam. Three systems, clear responsibilities, no overlap.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MIGRATION CONTROL PLANE                              │
├─────────────────────┬──────────────────────────┬────────────────────────────┤
│   OKTA READ/EXPORT  │     OKTA ADMIN/WRITE     │      ENTRA WRITE           │
│                     │                          │                            │
│   lib/okta          │  Official Okta MCP       │  Microsoft Graph API       │
│   (our code)        │  (okta/okta-mcp-server)  │  (lib/graph-security)      │
│                     │                          │                            │
│ • Bulk user export  │ • Ad-hoc user CRUD       │ • User provisioning        │
│ • Group enumeration │ • Group management       │ • Group creation           │
│ • App inventory     │ • Policy changes         │ • App registration         │
│ • Policy export     │ • Deactivation/deletion  │ • CA policy deployment     │
│ • Sign-on policy    │ • System log queries     │ • Named Locations          │
│   extraction        │ • Interactive admin ops  │ • Extension attributes     │
│ • Authenticator     │ • Elicitation-confirmed  │ • Service principal config │
│   inventory         │   destructive ops        │ • SAML/OIDC metadata       │
│ • Custom attribute  │                          │ • Lifecycle Workflows      │
│   schema export     │                          │                            │
│ • Migration state   │                          │                            │
│   tracking          │                          │                            │
│ • Reconciliation    │                          │                            │
│ • Dry-run diffing   │                          │                            │
│ • Mapping file I/O  │                          │                            │
└─────────────────────┴──────────────────────────┴────────────────────────────┘
```

### (a) Official Okta MCP Server — Interactive Admin & Writes on Okta Side

**What it is:** Okta's official MCP server (`okta/okta-mcp-server`). Python/`uv`, built on Okta SDK v3.4.1. GA. Supports full CRUD for users, groups, applications, policies, device assurance policies, brands, themes, custom pages, email templates, custom domains, email domains. Scope-based tool loading — only tools matching granted OAuth scopes are registered.

**Auth modes:**
- **Device Authorization Grant** — interactive, browser-based. Best for operator sessions.
- **Private Key JWT** — headless, no browser. Best for CI/CD and automated pipelines.

**Safety:** Destructive operations (deletes, deactivations) prompt user confirmation via MCP Elicitation API. Fallback for clients without elicitation support.

**Our usage:**
- Ad-hoc admin operations during migration (create/update/deactivate users, manage groups, policy changes).
- Interactive troubleshooting during pilot/cutover.
- Post-migration Okta decommission actions (disable sign-on policies, suspend org).
- Any Okta WRITE that isn't bulk/migration-specific.
- System log queries for real-time monitoring during cutover.

**What it is NOT used for:**
- Bulk export (rate-limited per-request, no pagination state management).
- Migration state tracking (no concept of "which objects are migrated").
- Mapping or transformation logic.
- Dry-run simulation.

### (b) lib/okta — Migration-Specific Read/Extract & State (Our Code)

**What it is:** Our deterministic, idempotent migration library. Owned by Sydnor. Node.js (CommonJS, matching repo convention).

**Responsibilities:**
- **Bulk export** — Paginated extraction of all users, groups, apps, policies, authenticators, custom schemas. Handles Okta rate limits with backoff. Outputs structured JSON/YAML inventory files.
- **Mapping** — Transforms Okta objects to Entra equivalents per the mapping reference (Kima's skill). Produces mapping files with source/target/status/notes per object.
- **Reconciliation** — Compares Okta source state against Entra target state. Reports: migrated, pending, failed, drifted objects.
- **Migration state tracking** — Maintains state per object: `{ id, source_type, source_id, target_id, status: pending|migrated|failed|skipped, last_sync, error }`. Stored in `.secops/identity/migration-state/` as YAML partitioned by object class.
- **Dry-run diffing** — Simulates what a migration step WOULD do without executing. Produces a diff (objects to create, update, skip) for human review.
- **Idempotency** — Every operation checks state before acting. Re-running a step that already succeeded is a no-op.

**What it is NOT:**
- An admin tool for Okta. No user creation, no policy changes, no destructive ops on Okta side.
- A replacement for the official MCP server's interactive capabilities.
- An Entra write tool (that's Graph's job).

**Key design constraints:**
- All reads use read-only Okta scopes (`okta.*.read`).
- Never stores Okta credentials — reads from environment (same pattern as official MCP server).
- Rate limiting: respects Okta's `X-Rate-Limit-*` headers; exponential backoff with jitter.

### (c) Microsoft Graph — Entra Write Side

**What it is:** Microsoft Graph API (and potentially `lib/graph-security` from this repo) handles all WRITES to Entra ID.

**Responsibilities:**
- User provisioning (create, update, disable).
- Group creation and membership management.
- App registration and service principal configuration.
- Conditional Access policy deployment (report-only first, then enforced).
- Named Location creation.
- Extension attribute configuration.
- SAML/OIDC federation metadata configuration.
- Lifecycle Workflow creation.

**Gating:**
- All Graph writes are gated by the dry-run output from `lib/okta`.
- Write operations require explicit `--execute` flag (default is `--dry-run`).
- CA policies deploy in **report-only mode** first, enforced only after human confirmation.
- Destructive operations (delete user, remove app) require double-confirmation.

### Tooling Seam Rules

| Principle | Rule |
|-----------|------|
| **No overlap** | If the official MCP server can do it interactively and it's a one-off admin op → use MCP. If it's bulk/deterministic/stateful → use `lib/okta`. |
| **Reads** | `lib/okta` owns all bulk reads for migration. Official MCP server handles ad-hoc/interactive queries. |
| **Okta writes** | Official MCP server only. `lib/okta` has zero write capability on Okta. |
| **Entra writes** | Graph only. Neither `lib/okta` nor official Okta MCP touches Entra. |
| **State** | `lib/okta` owns migration state. Official MCP is stateless (per-request). |
| **Destructive ops** | MCP server: elicitation-confirmed. Graph writes: dry-run + explicit execute flag. `lib/okta`: read-only, cannot be destructive. |

### Where Migration State Lives

```
.secops/identity/migration-state/
├── users.yaml          # Per-user migration status
├── groups.yaml         # Per-group migration status
├── apps.yaml           # Per-app migration status
├── policies.yaml       # Per-policy migration status (sign-on → CA mapping)
├── authenticators.yaml # MFA re-enrollment tracking
└── _metadata.yaml      # Last sync timestamps, phase, wave info
```

Each file is append-safe (new entries appended, existing entries updated in place). Format:

```yaml
- source_id: "00u1a2b3c4d5e6f7g"
  source_type: "okta_user"
  source_display: "jane.doe@contoso.com"
  target_id: "aabbccdd-1122-3344-5566-778899aabbcc"  # null if pending
  target_type: "entra_user"
  status: "migrated"  # pending | migrated | failed | skipped | rollback
  wave: 2
  migrated_at: "2026-07-15T14:30:00Z"
  last_reconciled: "2026-07-16T08:00:00Z"
  error: null
  notes: ""
```

### Idempotency & Re-Runnability

- **`lib/okta` export:** Re-running overwrites inventory files (full snapshot). No side effects.
- **`lib/okta` mapping:** Re-running regenerates mapping from current inventory. Previously approved mappings preserved (append-only).
- **Graph writes:** Check target_id in state file before creating. If target exists and attributes match → skip. If target exists and attributes differ → update (not create duplicate). If target doesn't exist → create and record target_id.
- **State is the single coordination point.** Multiple operators can run steps independently; state file prevents duplicate work.

### Destructive Operation Gates

```
┌──────────────┐     ┌──────────┐     ┌────────────┐     ┌──────────┐
│  Dry-run     │────▶│  Human   │────▶│  Execute   │────▶│  State   │
│  (diff only) │     │  Review  │     │  (--execute)│    │  Update  │
└──────────────┘     └──────────┘     └────────────┘     └──────────┘
                                             │
                                      ┌──────┴──────┐
                                      │  Audit Log  │
                                      └─────────────┘
```

No shortcut. Even in CI with Private Key JWT auth on the Okta MCP server, destructive ops require the elicitation confirmation step (or explicit pipeline approval gate).

---

## 6. Open Questions for x3nc0n

These decisions cannot be made by the framework — they require business context and organizational authority.

| # | Question | Options | McNulty's Recommendation |
|---|----------|---------|------------------------|
| 1 | **Tenant topology** — Is this a single Okta org → single Entra tenant? Or multi-org / multi-tenant? | (A) 1:1, (B) Many Okta orgs → 1 Entra tenant, (C) 1 Okta org → multiple Entra tenants | Start with (A) 1:1. The framework supports multi-tenant but the first implementation should prove the pattern on the simplest case. |
| 2 | **Entra write-side tooling** — Use raw Microsoft Graph SDK, our existing `lib/graph-security`, or the Entra-native migration tooling (Microsoft Entra Connect Sync)? | (A) Direct Graph API calls via `lib/graph-security`, (B) Entra Connect Sync for users + Graph for apps/policies, (C) Third-party migration tool (e.g., BitTitan, Quest) | (A) Direct Graph. Gives us full control, matches the deterministic/idempotent principle, and avoids Entra Connect Sync's opinionated agent model. Reserve (B) if user population exceeds 50K and bulk provisioning performance matters. |
| 3 | **External/B2B identity handling** — How are Okta-managed external/partner identities handled? | (A) Migrate to Entra B2B guest accounts, (B) Leave in Okta (Okta continues as external IdP), (C) Migrate to Entra External ID (CIAM) | (B) for partners who have their own IdP; (A) for partners without one. Avoid (C) unless there's a customer-facing CIAM use case. |
| 4 | **Official MCP server deployment model** — Interactive (Device Auth) for operators, or headless (Private Key JWT) in CI pipelines, or both? | (A) Interactive only (operators run it locally), (B) Headless only (CI/CD), (C) Both — interactive for ad-hoc, headless for pipeline steps | (C) Both. Interactive for pilot/troubleshooting; headless for cutover-day automation where ops must execute in sequence without browser prompts. |
| 5 | **Private Key JWT key management** — Where do the PKJWT keys for headless Okta MCP auth live? | (A) Azure Key Vault, (B) GitHub Actions secrets, (C) `.env` files (dev only), (D) HashiCorp Vault | (A) Azure Key Vault for production pipelines. (C) acceptable for local dev only. Never commit keys to repo. |
| 6 | **MFA re-enrollment strategy** — How much lead time do users get? Is Temporary Access Pass (TAP) acceptable for bulk re-enrollment? | (A) Self-service with 30-day window, (B) TAP-assisted bulk re-enrollment during cutover weekend, (C) Phased per-wave with combined registration (SSPR + MFA) | (C) Phased per-wave. TAP as escape hatch for users who miss the window. 14-day minimum registration window per wave. |
| 7 | **Scope boundary — what about Okta Workflows?** | (A) Rebuild in Logic Apps / Power Automate (in scope), (B) Rebuild in Lifecycle Workflows only (subset), (C) Out of scope for v1 | (C) Out of scope for v1. Inventory them, document them, but don't migrate automation until identity migration is stable. |
| 8 | **Okta-as-permanent-IdP environments** — For federated environments where Okta stays, what's the integration depth? | (A) Read-only monitoring (audit logs, user lifecycle events), (B) Full operational management via official MCP server, (C) Minimal — just the federation trust | (B) Full operational management. The official MCP server is the right interface for ongoing Okta admin in environments where Okta persists. `lib/okta` still provides bulk reporting/reconciliation. |
| 9 | **Migration state storage** — YAML files in `.secops/` (simple, git-tracked) or a proper database (SQLite, Cosmos DB)? | (A) YAML in `.secops/` (works for <5K objects), (B) SQLite (works for <100K objects), (C) Cloud DB for large orgs | (A) for orgs <5K users. (B) if >5K. Decision depends on org size — answer #1 first. |
| 10 | **Cutover scheduling** — Business hours with instant rollback capability, or maintenance window (off-hours)? | (A) Business hours (requires zero-downtime cutover), (B) Maintenance window (4h off-hours), (C) Rolling by timezone | (B) Maintenance window for the first cutover wave. Move to (A) once the pattern is proven. Rollback must complete within the window. |

---

## Appendix A: Okta Official MCP Server — Capability Summary

**Source:** `github.com/okta/okta-mcp-server` (GA)

| Domain | Capabilities |
|--------|-------------|
| **Users** | Create, list, retrieve, update, deactivate |
| **Groups** | Create, list, retrieve, update, delete |
| **Group Operations** | View members, view assigned apps, add/remove users |
| **Applications** | Full CRUD |
| **Policies** | Full CRUD (sign-on, MFA, password, authorization) |
| **Device Assurance** | Full CRUD |
| **Brands/Themes** | Full CRUD |
| **Email Templates** | Full CRUD |
| **Custom Domains** | Full CRUD |
| **System Logs** | Query and retrieve |

**Scope-based loading:** Only tools matching configured `OKTA_SCOPES` are registered at startup. Unscoped tools are silently removed.

**Safety:** Destructive ops use MCP Elicitation API for user confirmation. Fallback behavior for clients without elicitation support.

## Appendix B: Related Files

| File | Owner | Purpose |
|------|-------|---------|
| `lib/okta/` | Sydnor | Migration library (bulk export, mapping, reconciliation, state) |
| `skills/okta/` | Kima | Okta skill files incl. Okta→Entra mapping reference |
| `.secops/identity/okta.yaml` | Kima | Okta org configuration for the framework |
| `.secops/identity/tenants.yaml` | — | Target Entra tenant topology |
| `.secops/identity/migration-state/` | lib/okta | Per-object migration state tracking |
| `skills/msft-security/entra-id-protection.md` | Kima | Entra ID Protection reference |

---

*This architecture is a living document. Update as decisions from §6 are resolved.*
