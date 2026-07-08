'use strict';

/**
 * @module lib/ping/gate
 * Config-driven gating helpers for Ping Identity → Entra migration tooling.
 *
 * Gates MUST be called before any state-changing or extract-scope operation.
 * Extends lib/okta/gate.js with Ping-specific gates:
 * - assertEntraOwned: surface-aware; blocks writes to ping-owned classes
 * - assertNameIdPortable: hard-blocks NameID formats Entra cannot represent
 * - assertHybridCoverage: ensures all declared surfaces were confirmed reachable
 * - isDryRun / dryRunGuard: short-circuits live calls when dry_run = true
 * - cutoverWorkflow: returns declared workflow shape incl. Ping-specific fields
 *
 * All functions are synchronous and return {ok, data?, error?} — never throw.
 */

const OBJECT_CLASSES = Object.freeze([
  'users',
  'credentials_mfa',
  'groups',
  'app_assignments',
  'policies',
  'saml_sp_connections',
]);

/** Surface identifiers recognised by assertHybridCoverage and assertEntraOwned. */
const SURFACE_CLASSES = Object.freeze([
  'pingone_cloud',
  'pingfederate',
  'pingdirectory',
  'pingaccess',
  'aic',
]);

/**
 * NameID formats that Entra ID CANNOT represent — hard migration blockers.
 * Sources: Entra SAML documentation; spec Section 1.6.
 */
const NAMEID_HARD_BLOCK = Object.freeze(new Set([
  'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:kerberos',
  'urn:oasis:names:tc:SAML:1.1:nameid-format:X509SubjectName',
]));

// ---------------------------------------------------------------------------
// Surface ownership gate
// ---------------------------------------------------------------------------

/**
 * Assert that the given object class on the given surface has been declared
 * Entra-owned. Blocks writes to ping-owned classes.
 *
 * @param {object} profile     — validated migration_profile.data
 * @param {string} objectClass — users | credentials_mfa | groups | app_assignments | policies | saml_sp_connections
 * @param {string} [surface]   — 'pingone_cloud' | 'pingfederate' | 'pingdirectory' | 'aic' (informational; checked for validity)
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function assertEntraOwned(profile, objectClass, surface) {
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
  if (surface !== undefined && !SURFACE_CLASSES.includes(surface)) {
    return {
      ok: false,
      error: `assertEntraOwned: unknown surface "${surface}". Valid surfaces: ${SURFACE_CLASSES.join(', ')}`,
    };
  }

  const ownership = profile?.source_of_truth?.per_class_ownership?.[objectClass];
  if (ownership !== 'entra') {
    const surfaceNote = surface ? ` (surface: ${surface})` : '';
    return {
      ok: false,
      error:
        `Write to "${objectClass}"${surfaceNote} blocked: operator declared per_class_ownership.${objectClass} = "${ownership ?? '(unset)'}". ` +
        `Only Entra-owned classes accept writes from this tooling (single-writer-per-class rule). ` +
        `Update migration_profile.source_of_truth.per_class_ownership.${objectClass} to "entra" ` +
        `when ready to migrate this class.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// NameID blocker gate
// ---------------------------------------------------------------------------

/**
 * Assert that the NameID strategy is declared and that the source NameID format
 * is portable to Entra ID.
 *
 * Hard-blocks: transient, kerberos, X509SubjectName — Entra cannot represent these.
 *
 * @param {object} profile
 * @param {string} sourceNameIdFormat — NameID format string from PF SP connection
 * @returns {{ok: true} | {ok: false, error: string, blocker: 'nameid_incompatible'}}
 */
function assertNameIdPortable(profile, sourceNameIdFormat) {
  if (!profile || typeof profile !== 'object') {
    return {
      ok: false,
      error: 'assertNameIdPortable: profile is required — run loadMigrationProfile() first',
      blocker: 'nameid_incompatible',
    };
  }

  const nameIdStrategy = profile?.strategy?.nameid_strategy;
  if (!nameIdStrategy) {
    return {
      ok: false,
      error:
        'assertNameIdPortable: migration_profile.strategy.nameid_strategy is not declared. ' +
        'Declare a nameid_strategy (map_to_persistent | use_email | manual_per_app) before migrating SAML apps.',
      blocker: 'nameid_incompatible',
    };
  }

  if (NAMEID_HARD_BLOCK.has(sourceNameIdFormat)) {
    return {
      ok: false,
      error:
        `SAML migration BLOCKED: NameID format "${sourceNameIdFormat}" is not supported by Entra ID. ` +
        `Entra supports: unspecified, emailAddress, persistent. ` +
        `Reconfigure the PingFederate SP connection to emit a supported NameID format before proceeding.`,
      blocker: 'nameid_incompatible',
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Hybrid coverage gate
// ---------------------------------------------------------------------------

/**
 * Assert that ALL surfaces declared as enabled in the profile have been
 * confirmed reachable before proceeding with a full discovery run.
 * Prevents partial inventory that misleads the migration plan.
 *
 * @param {object} profile
 * @param {string[]} confirmedSurfaces — from detect.js DetectionResult.confirmedSurfaces
 * @returns {{ok: true} | {ok: false, error: string, missingSurfaces: string[]}}
 */
function assertHybridCoverage(profile, confirmedSurfaces) {
  if (!profile || typeof profile !== 'object') {
    return {
      ok: false,
      error: 'assertHybridCoverage: profile is required — run loadMigrationProfile() first',
      missingSurfaces: [],
    };
  }
  if (!Array.isArray(confirmedSurfaces)) {
    return {
      ok: false,
      error: 'assertHybridCoverage: confirmedSurfaces must be an array from detect.js',
      missingSurfaces: [],
    };
  }

  // Determine which surfaces the profile declares as active
  const declared = [];
  const ping = profile._ping_topology; // may be injected by the caller from ping.yaml ping: block

  // Infer from identity_authority / federation_source as fallback
  const ia = profile?.source_of_truth?.identity_authority;
  const fs = profile?.source_of_truth?.federation_source;

  if (ia === 'pingone' || fs === 'pingone') declared.push('pingone_cloud');
  if (ia === 'pingfederate' || fs === 'pingfederate') declared.push('pingfederate');
  if (ia === 'aic' || fs === 'aic') declared.push('aic');

  // If caller injected topology hints, use those too
  if (ping) {
    if (ping.cloud) declared.push('pingone_cloud');
    if (ping.onprem?.pingfederate) declared.push('pingfederate');
    if (ping.onprem?.pingdirectory) declared.push('pingdirectory');
    if (ping.onprem?.pingaccess) declared.push('pingaccess');
    if (ping.aic?.enabled) declared.push('aic');
  }

  // Deduplicate
  const required = [...new Set(declared)];

  const missing = required.filter(s => !confirmedSurfaces.includes(s));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `assertHybridCoverage: ${missing.length} declared surface(s) not confirmed reachable: ${missing.join(', ')}. ` +
        `Run detectDeployment() against all configured endpoints before starting a discovery run.`,
      missingSurfaces: missing,
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
 * Returns the declared cutover shape and Ping-specific strategy fields so
 * callers can select the correct workflow path.
 *
 * Extended vs Okta: includes federationSource and nameIdStrategy.
 *
 * @param {object} profile - Validated migration_profile.data
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
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
      nameIdStrategy: profile.strategy.nameid_strategy,
      federationSource: profile.source_of_truth?.federation_source ?? null,
    },
  };
}

module.exports = {
  assertEntraOwned,
  assertNameIdPortable,
  assertHybridCoverage,
  isDryRun,
  dryRunGuard,
  cutoverWorkflow,
  OBJECT_CLASSES,
  SURFACE_CLASSES,
  NAMEID_HARD_BLOCK,
};
