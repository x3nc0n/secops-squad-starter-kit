'use strict';

/**
 * @module lib/okta/gate
 * Config-driven gating helpers for Okta → Entra migration tooling.
 *
 * These gates MUST be called before any state-changing or extract-scope operation:
 * - assertEntraOwned: enforces single-writer-per-class (blocks writes to Okta-owned classes)
 * - isDryRun / dryRunGuard: short-circuits live calls when dry_run = true
 * - cutoverWorkflow: returns the declared cutover shape for workflow path selection
 *
 * All functions are synchronous and return {ok, data?, error?} — never throw.
 * Reusable by lib/okta tooling AND the Graph write-side (both must honor this contract).
 *
 * Gate contract (coordinator sign-off: copilot-okta-readfirst-signoff.md):
 *   The official Okta MCP server owns interactive Okta-side writes; Microsoft Graph
 *   owns Entra-side writes. These gates enforce the operator's declared per-class
 *   ownership boundaries so neither side writes to a class the other owns.
 */

const OBJECT_CLASSES = Object.freeze([
  'users',
  'credentials_mfa',
  'groups',
  'app_assignments',
  'policies',
]);

// ---------------------------------------------------------------------------
// Ownership gate
// ---------------------------------------------------------------------------

/**
 * Assert that the given object class has been declared Entra-owned by the operator.
 * Call this before any write or migration operation targeting that class on the Entra side.
 *
 * If the class is still Okta-owned, the operator has not declared it ready to migrate —
 * writes must route to the official Okta MCP server instead.
 *
 * @param {object} profile - Validated migration_profile.data (from loadMigrationProfile())
 * @param {string} objectClass - One of: users, credentials_mfa, groups, app_assignments, policies
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function assertEntraOwned(profile, objectClass) {
  if (!profile || typeof profile !== 'object') {
    return {
      ok: false,
      error: 'assertEntraOwned: profile is required — run loadMigrationProfile() first',
    };
  }
  if (!OBJECT_CLASSES.includes(objectClass)) {
    return {
      ok: false,
      error: `assertEntraOwned: unknown object class "${objectClass}". Valid classes: ${OBJECT_CLASSES.join(', ')}`,
    };
  }
  const ownership = profile?.source_of_truth?.per_class_ownership?.[objectClass];
  if (ownership !== 'entra') {
    return {
      ok: false,
      error:
        `Write to "${objectClass}" blocked: operator declared per_class_ownership.${objectClass} = "${ownership ?? '(unset)'}". ` +
        `Only Entra-owned classes accept writes from this tooling (single-writer-per-class rule). ` +
        `Update migration_profile.source_of_truth.per_class_ownership.${objectClass} to "entra" ` +
        `when ready to migrate this class.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Dry-run gate
// ---------------------------------------------------------------------------

/**
 * Returns true if the profile declares dry_run = true.
 *
 * @param {object} profile - Validated migration_profile.data
 * @returns {boolean}
 */
function isDryRun(profile) {
  return profile?.execution?.dry_run === true;
}

/**
 * Short-circuit guard for dry-run mode.
 *
 * When dry_run is true, returns a simulated success result so no live call is made.
 * When dry_run is false (or profile is missing), returns null — caller proceeds with
 * the live operation.
 *
 * Usage pattern:
 *   const guard = dryRunGuard(profile, 'deactivate user abc123');
 *   if (guard) return guard;  // short-circuit — no live call made
 *   // ... live call ...
 *
 * @param {object} profile - Validated migration_profile.data
 * @param {string} opDescription - Human-readable description of the operation that would run
 * @returns {{ok: true, data: {dryRun: true, would: string}} | null}
 */
function dryRunGuard(profile, opDescription) {
  if (!isDryRun(profile)) return null;
  return { ok: true, data: { dryRun: true, would: opDescription } };
}

// ---------------------------------------------------------------------------
// Workflow selector
// ---------------------------------------------------------------------------

/**
 * Returns the declared cutover shape and related strategy fields so callers
 * can select the correct workflow path without inspecting the profile directly.
 *
 * @param {object} profile - Validated migration_profile.data
 * @returns {{ok: true, data: {cutoverShape: string, groupStrategy: string, federationDirection: string, mfaStrategy: string}} | {ok: false, error: string}}
 */
function cutoverWorkflow(profile) {
  if (!profile?.strategy) {
    return {
      ok: false,
      error: 'cutoverWorkflow: migration_profile.strategy block is missing — run loadMigrationProfile() first',
    };
  }
  return {
    ok: true,
    data: {
      cutoverShape: profile.strategy.cutover_shape,
      groupStrategy: profile.strategy.group_strategy,
      federationDirection: profile.strategy.federation_direction,
      mfaStrategy: profile.strategy.mfa_strategy,
    },
  };
}

module.exports = {
  assertEntraOwned,
  isDryRun,
  dryRunGuard,
  cutoverWorkflow,
  OBJECT_CLASSES,
};
