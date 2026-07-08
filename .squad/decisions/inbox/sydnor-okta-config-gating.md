### 2026-07-08T12:25:37-05:00: Sydnor — Okta config/gate layer design + migration_profile schema

**By:** Sydnor (Platform Dev)
**For:** Kima, Carver, Graph write-side alignment

---

## Summary

Built the machine-readable half of the Okta migration harness:
- `lib/okta/config.js` — loader/validator for `migration_profile` block in `.secops/identity/okta.yaml`
- `lib/okta/schema/migration-profile.schema.json` — JSON Schema for the canonical block
- `lib/okta/gate.js` — config-driven gates that MUST be called before any state-changing op
- Fixed GAP-1 in `normalizeOrgUrl` (all trailing slashes + https:// scheme injection)

---

## Canonical `migration_profile` schema (both Sydnor and Kima build to this)

```yaml
migration_profile:
  source_of_truth:
    identity_authority: okta | hris | mixed
    hris_system: <string | null>
    per_class_ownership:
      users: okta | entra
      credentials_mfa: okta | entra
      groups: okta | entra
      app_assignments: okta | entra
      policies: okta | entra
    per_attribute_authority:        # optional
      - attribute: <string>
        authority: okta | hris | entra
  strategy:
    cutover_shape: big_bang | phased_by_app | phased_by_population
    group_strategy: lift_and_shift | rationalize
    federation_direction: okta_idp_into_entra | entra_idp | per_app
    mfa_strategy: reenroll_campaign | passkey_bootstrap | per_population
  execution:
    dry_run: true | false
    entra_write_tooling: microsoft_graph | entra_native | none
```

Unknown enum values → validation error with field name + invalid value + valid options listed.
`per_attribute_authority` is optional; all other fields are required.

---

## Gate contract

All gate functions are **synchronous**, **never throw**, and return `{ok, data?, error?}`.

### `assertEntraOwned(profile, objectClass)`

Call before ANY write to an Entra-side object class.

- `objectClass` must be one of: `users`, `credentials_mfa`, `groups`, `app_assignments`, `policies`
- Returns `{ok:true}` only if `per_class_ownership[objectClass] === 'entra'`
- Returns `{ok:false, error}` otherwise — write is blocked, with a message explaining which class is still Okta-owned and how to declare readiness

**Enforces:** single-writer-per-class rule. Neither system writes to a class the other owns.

### `isDryRun(profile)` → boolean

Returns `true` if `execution.dry_run === true`.

### `dryRunGuard(profile, opDescription)`

```js
const guard = dryRunGuard(profile, 'deactivate user abc123');
if (guard) return guard;   // {ok:true, data:{dryRun:true, would:'deactivate user abc123'}}
// ... live call ...
```

Returns `null` when dry_run is false (caller proceeds). Returns a result object when dry_run is true (caller short-circuits — no live call made).

### `cutoverWorkflow(profile)`

Returns `{ok:true, data:{cutoverShape, groupStrategy, federationDirection, mfaStrategy}}` from the declared strategy block. Callers use `cutoverShape` to select the right workflow path:

- `big_bang` → single coordinated cutover
- `phased_by_app` → iterate apps, migrate one at a time
- `phased_by_population` → migrate user populations in waves

---

## config.js contract

`loadMigrationProfile(filePath?)` → `{ok:true, data} | {ok:false, error}`

- Defaults to `<cwd>/.secops/identity/okta.yaml`
- Returns `{ok:false}` with actionable message when file is missing, block is absent, or validation fails
- `{ok:false}` on absent block tells operator to run `skills/okta/decisions/` guides
- NEVER throws

`validateProfile(profile)` → `string[]` (exported for unit testing)

---

## Kima alignment note

`lib/okta/config.js` reads ONLY the `migration_profile:` block from `okta.yaml`.
It does NOT read or touch any other section of the file. Kima owns the rest of `okta.yaml`.
When Kima adds the `migration_profile:` block to the operator template, it must match the
canonical schema above exactly (field names, enum values, nesting depth).

The `migration-profile.schema.json` file can be used to validate the template YAML as well.

---

## Carver alignment note

Smoke tests in `lib/okta/config.gate.test.js` (19 tests). Carver owns the full config-gating suite.
Key behaviors to cover:
- `loadMigrationProfile` with every invalid-field combination
- `assertEntraOwned` called with each of the 5 object classes in both states
- `dryRunGuard` composability with real mock operations
- `cutoverWorkflow` driving a workflow-selection switch
- Integration: loadMigrationProfile → gate chain
