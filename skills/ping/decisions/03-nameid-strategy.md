---
title: "Decision 03 — NameID Strategy (SAML Migration Blocker)"
category: ping
author: Keymaker
version: 1.0.0
last_updated: 2026-07-08
config_fields:
  - strategy.nameid_strategy
---

# Decision 03 — NameID Strategy

## ⚠️ This is the #1 Migration Blocker

The NameID format emitted by PingFederate for each SP connection determines whether that SP connection can migrate to Entra at all. **Assess every SP connection before declaring a strategy.** Use `listSamlApps()` and `listSpConnections()` with `fetchAll: true` to enumerate all SP connections and their NameID formats, then run `assertNameIdPortable()` from gate.js on each result.

---

## The Decision

**How are SAML NameID values mapped from PingFederate to Microsoft Entra ID?**

NameID is the identifier inside a SAML assertion that tells the SP "this is the user." If the value or format changes at cutover, the SP may treat the user as a new, unknown identity — creating duplicate accounts or outright login failures.

---

## NameID Format Compatibility Recap

| Format | Entra Support | Action |
|--------|---------------|--------|
| `unspecified` | ✅ Supported | Migrate; choose any stable Entra attribute as the value |
| `emailAddress` | ✅ Supported | Use UPN or `mail` as the value |
| `persistent` | ✅ Supported | Map PF persistent attribute → Entra `objectId` or extension attribute |
| `transient` | ❌ **Hard-blocked** | SP must accept a different format before migration can proceed |
| `kerberos` | ❌ **Hard-blocked** | Requires SP redesign |
| `X509SubjectName` | ❌ **Hard-blocked** | Requires SP redesign |

---

## Options

### `map_to_persistent`
Map PingFederate's persistent NameID attribute (typically a stable directory attribute like `uid` or `employeeNumber`) to Entra's `objectId`. Entra emits `urn:oasis:names:tc:SAML:2.0:nameid-format:persistent`.

**How it works:**
1. Discover PF's NameID source attribute per SP connection (from `spBrowserSso.nameIdPolicyConfig` or equivalent)
2. Store the PF attribute value on the Entra user as an extension attribute (e.g. `extension_pingSourceId`)
3. Configure the Entra Enterprise App's SAML claims to emit that extension attribute as the NameID value
4. Validate against a test SP that the NameID value matches what PF was emitting

**Gotcha:** This requires a per-SP claim configuration in Entra. Cannot be scripted en masse unless all SPs used the same PF attribute.

### `use_email`
Use the user's email address (UPN or `mail`) as the NameID value. Configure Entra to emit `emailAddress` format.

**How it works:**
1. Confirm that all PF SP connections were already using email as their NameID value
2. Confirm UPN/email values in Entra match exactly what PF was emitting
3. Configure Entra Enterprise Apps to use `emailAddress` NameID format pointing at `user.mail` or `user.userprincipalname`

**When it's safe:** If PF was emitting the user's email address as the NameID (common in simpler deployments), and the email values are stable and identical in Entra, this is the lowest-effort path.

**Gotcha:** UPN and email address are often different (e.g., UPN is `alice@corp.onmicrosoft.com` but PF emitted `alice@corp.com`). Confirm exact values.

### `manual_per_app`
Each SP connection gets its own NameID mapping decision. Used for complex environments where:
- SP connections use different NameID formats
- Some SPs have `transient` format (blocked; require vendor engagement)
- Some SPs require value continuity that neither `map_to_persistent` nor `use_email` provides cleanly

**How it works:**
1. Run full SP connection inventory with `listSpConnections({ fetchAll: true })`
2. For each SP: document the NameID format, source attribute, and value continuity requirement
3. Assign one of: `map_to_persistent`, `use_email`, or `blocked_pending_sp_update` per SP
4. Track blocked SPs separately; they cannot migrate until the SP vendor updates their NameID acceptance

---

## Trade-offs

| Option | Pro | Con |
|--------|-----|-----|
| `map_to_persistent` | Safest for SPs with stable persistent identifiers. Survives email changes. | Per-SP claim config in Entra. Requires the PF source attribute to exist on every Entra user. |
| `use_email` | Simplest. Entra native. No custom claims config needed if email matches. | Breaks if UPN ≠ PF NameID value. Breaks if email changes post-migration. |
| `manual_per_app` | Handles mixed/complex SP estates. Correct for any non-trivial environment. | Most labor-intensive. Requires SP-by-SP investigation. Blocks apps with hard-blocked formats. |

---

## Recommended Default

**`map_to_persistent`**

**Rationale:** In a PingFederate deployment, the persistent NameID is typically sourced from a stable directory attribute (UID, employeeNumber, or a purpose-built immutable ID). Mapping that same value through Entra as an extension attribute preserves the NameID value the SPs have stored. This prevents the duplicate-account problem even when SPs don't support re-binding.

**Use `use_email` if:** You confirm via discovery that all PF SP connections use email-based NameIDs, and your email addresses are stable and correctly normalized in Entra.

**Use `manual_per_app` if:** Your SP inventory reveals mixed formats, or any SP has a `transient` or `kerberos` NameID that requires vendor engagement before migration.

---

## Gate Enforcement

`gate.js assertNameIdPortable(profile, sourceNameIdFormat)` enforces this decision:
- Reads `strategy.nameid_strategy` from the profile
- Hard-blocks `transient`, `kerberos`, `X509SubjectName` regardless of strategy
- Returns `{ok: false, blocker: 'nameid_incompatible'}` for blocked formats — callers must halt SAML app migration for that SP connection

Run this gate on every SP connection in Phase 1 discovery. Log all blocked SPs to the discovery report. They are the first things requiring manual remediation before Phase 2 can begin.

---

## Config Fields Written

```yaml
# .secops/identity/ping.yaml — migration_profile
migration_profile:
  strategy:
    nameid_strategy: map_to_persistent  # YOUR ANSWER: map_to_persistent | use_email | manual_per_app
    # nameid_strategy notes:
    #   map_to_persistent: map PF persistent attribute value → Entra extension attribute → emitted as NameID
    #   use_email: use UPN/mail as NameID value (only if PF was already emitting email)
    #   manual_per_app: per-SP decision; requires full SP connection inventory first
```

**Next decision:** [04 — Object Ownership](04-object-ownership.md)
