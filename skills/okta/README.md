---
title: Okta Skills Domain
category: okta
author: Kima
version: 1.0.0
last_updated: 2026-07-08
---

# Okta Skills Domain

## Overview

The `skills/okta/` domain covers Okta as both a source system (migrating away from Okta to Microsoft Entra ID) and as an ongoing identity fabric (operating in Okta-federated environments where Okta stays the IdP). These skills give agents the vocabulary, API surface, object models, and mapping knowledge to reason correctly about Okta configurations — whether the goal is migration planning, security analysis, or direct Okta-federated operations.

## Two Operating Modes

This skill set serves two distinct operational contexts. Every agent task that touches Okta should know which mode it is in before taking action.

### Mode 1 — Okta → Entra ID Migration

The org is moving from Okta as the primary IdP to Microsoft Entra ID. Okta objects must be inventoried, evaluated, and recreated (or replaced) in Entra. The key deliverable is a migration map that captures what has a clean equivalent, what needs re-architecture, and what simply cannot be automated.

**Key concerns in this mode:**
- Faithfully mapping user profiles, lifecycle states, group membership, and app assignments
- Recreating policy intent (Okta sign-on policies → Entra Conditional Access)
- Managing coexistence: dual-write periods, cutover sequencing, and what breaks during transition
- SAML and OIDC app reconfiguration: new IdP metadata, certificate rollover, claims re-mapping
- Communicating clearly where no clean mapping exists — do not invent equivalence

### Mode 2 — Okta-Federated Operations

The org keeps Okta as the IdP indefinitely. Okta may be federated into Microsoft services (Entra, M365) via SAML or OIDC, or Okta may manage app assignments and MFA independently. The agent needs to understand Okta's object model to answer security questions, write detection logic, and support operational tasks.

**Key concerns in this mode:**
- Reading and interpreting Okta System Log events for threat detection
- Understanding which users, groups, and policies govern access to a given application
- Enumerating authenticator strength to assess MFA coverage
- Federation trust between Okta and Entra — what Entra trusts from Okta tokens

## Skill Files

| File | Description |
|---|---|
| **[core-api-overview.md](core-api-overview.md)** | Okta Core API surface, auth models (SSWS vs OAuth for Okta), rate limits, pagination, org concepts |
| **[users-and-profiles.md](users-and-profiles.md)** | Okta Universal Directory profile model, lifecycle states, Entra user object mapping |
| **[groups-and-rules.md](groups-and-rules.md)** | Okta group types, dynamic group rules, Entra dynamic group mapping |
| **[applications-saml-oidc.md](applications-saml-oidc.md)** | SAML/OIDC app integrations, assignments, Entra enterprise apps / app registrations |
| **[policies-and-authenticators.md](policies-and-authenticators.md)** | Sign-on policies, MFA enrollment, authenticators → Entra Conditional Access + Authentication Methods |
| **[okta-to-entra-migration-map.md](okta-to-entra-migration-map.md)** | Consolidated side-by-side mapping reference with coexistence guidance |
| **[okta-mcp-server.md](okta-mcp-server.md)** | Okta MCP server integration — tools, auth, and usage patterns (Sydnor) |

## Environment Context

Before working with Okta, read `.secops/identity/okta.yaml` to understand:
- Org URL(s) and auth model (SSWS or OAuth for Okta)
- Whether Okta is the primary IdP or is being migrated
- Federation relationships (Okta ↔ Entra, inbound/outbound)
- Migration phase and cutover target (if applicable)

This file mirrors `.secops/identity/tenants.yaml` for Okta-specific context. If it does not exist, create it from the template in `.secops/identity/okta.yaml`.

## Related Skills

- `skills/msft-security/entra-id-protection.md` — Entra identity risk and Conditional Access (migration target)
- `skills/msft-security/microsoft-graph-security.md` — Graph API for Entra user/group/policy management
- `lib/okta/` — Okta API client library (built by Sydnor)
