'use strict';

/**
 * @module lib/ping/config
 * Loads and validates the migration_profile block from .secops/identity/ping.yaml.
 *
 * Uses js-yaml (the project's single npm dependency). Never throws — all paths
 * return {ok, data?, error?}. Mirrors lib/okta/config.js exactly in structure,
 * extended for Ping-specific fields: federation_source, nameid_strategy,
 * pingid_reenroll MFA strategy, saml_sp_connections ownership class, au region.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ---------------------------------------------------------------------------
// Valid enum values — matches migration-profile.schema.json exactly
// ---------------------------------------------------------------------------

const VALID = Object.freeze({
  identity_authority: new Set(['pingfederate', 'pingone', 'aic', 'hris', 'mixed']),
  ownership: new Set(['ping', 'entra']),
  federation_source: new Set(['pingfederate', 'pingone', 'aic']),
  cutover_shape: new Set(['big_bang', 'phased_by_app', 'phased_by_population']),
  group_strategy: new Set(['lift_and_shift', 'rationalize']),
  federation_direction: new Set(['ping_idp_into_entra', 'entra_idp', 'per_app']),
  mfa_strategy: new Set(['pingid_reenroll', 'passkey_bootstrap', 'per_population']),
  nameid_strategy: new Set(['map_to_persistent', 'use_email', 'manual_per_app']),
  attribute_authority: new Set(['ping', 'hris', 'entra']),
  entra_write_tooling: new Set(['microsoft_graph', 'entra_native', 'none']),
  region: new Set(['com', 'eu', 'ca', 'asia', 'au']),
});

const OWNERSHIP_CLASSES = Object.freeze([
  'users',
  'credentials_mfa',
  'groups',
  'app_assignments',
  'policies',
  'saml_sp_connections',
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validates a migration_profile object against the canonical Ping schema.
 * Returns a (possibly empty) array of human-readable error strings.
 *
 * @param {unknown} profile
 * @returns {string[]} Validation errors. Empty array = valid.
 */
function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return ['migration_profile must be an object'];
  }

  const errors = [];

  // --- source_of_truth ---
  const sot = profile.source_of_truth;
  if (!sot || typeof sot !== 'object') {
    errors.push('migration_profile.source_of_truth is required and must be an object');
  } else {
    if (!VALID.identity_authority.has(sot.identity_authority)) {
      errors.push(
        `migration_profile.source_of_truth.identity_authority must be one of: ${[...VALID.identity_authority].join(', ')} — got: ${JSON.stringify(sot.identity_authority)}`
      );
    }

    if (sot.federation_source !== undefined && sot.federation_source !== null) {
      if (!VALID.federation_source.has(sot.federation_source)) {
        errors.push(
          `migration_profile.source_of_truth.federation_source must be one of: ${[...VALID.federation_source].join(', ')} — got: ${JSON.stringify(sot.federation_source)}`
        );
      }
    }

    if (
      sot.hris_system !== undefined &&
      sot.hris_system !== null &&
      typeof sot.hris_system !== 'string'
    ) {
      errors.push(
        'migration_profile.source_of_truth.hris_system must be a string or null'
      );
    }

    const own = sot.per_class_ownership;
    if (!own || typeof own !== 'object') {
      errors.push(
        'migration_profile.source_of_truth.per_class_ownership is required and must be an object'
      );
    } else {
      for (const cls of OWNERSHIP_CLASSES) {
        if (!VALID.ownership.has(own[cls])) {
          errors.push(
            `migration_profile.source_of_truth.per_class_ownership.${cls} must be one of: ping, entra — got: ${JSON.stringify(own[cls])}`
          );
        }
      }
    }

    // per_attribute_authority — optional
    if (sot.per_attribute_authority !== undefined) {
      if (!Array.isArray(sot.per_attribute_authority)) {
        errors.push(
          'migration_profile.source_of_truth.per_attribute_authority must be an array'
        );
      } else {
        sot.per_attribute_authority.forEach((entry, i) => {
          if (!entry || typeof entry !== 'object') {
            errors.push(
              `migration_profile.source_of_truth.per_attribute_authority[${i}] must be an object`
            );
            return;
          }
          if (typeof entry.attribute !== 'string' || !entry.attribute) {
            errors.push(
              `migration_profile.source_of_truth.per_attribute_authority[${i}].attribute must be a non-empty string`
            );
          }
          if (!VALID.attribute_authority.has(entry.authority)) {
            errors.push(
              `migration_profile.source_of_truth.per_attribute_authority[${i}].authority must be one of: ping, hris, entra — got: ${JSON.stringify(entry.authority)}`
            );
          }
        });
      }
    }
  }

  // --- strategy ---
  const strat = profile.strategy;
  if (!strat || typeof strat !== 'object') {
    errors.push('migration_profile.strategy is required and must be an object');
  } else {
    if (!VALID.cutover_shape.has(strat.cutover_shape)) {
      errors.push(
        `migration_profile.strategy.cutover_shape must be one of: ${[...VALID.cutover_shape].join(', ')} — got: ${JSON.stringify(strat.cutover_shape)}`
      );
    }
    if (!VALID.group_strategy.has(strat.group_strategy)) {
      errors.push(
        `migration_profile.strategy.group_strategy must be one of: ${[...VALID.group_strategy].join(', ')} — got: ${JSON.stringify(strat.group_strategy)}`
      );
    }
    if (!VALID.federation_direction.has(strat.federation_direction)) {
      errors.push(
        `migration_profile.strategy.federation_direction must be one of: ${[...VALID.federation_direction].join(', ')} — got: ${JSON.stringify(strat.federation_direction)}`
      );
    }
    if (!VALID.mfa_strategy.has(strat.mfa_strategy)) {
      errors.push(
        `migration_profile.strategy.mfa_strategy must be one of: ${[...VALID.mfa_strategy].join(', ')} — got: ${JSON.stringify(strat.mfa_strategy)}`
      );
    }
    if (!VALID.nameid_strategy.has(strat.nameid_strategy)) {
      errors.push(
        `migration_profile.strategy.nameid_strategy must be one of: ${[...VALID.nameid_strategy].join(', ')} — got: ${JSON.stringify(strat.nameid_strategy)}`
      );
    }
  }

  // --- execution ---
  const exec = profile.execution;
  if (!exec || typeof exec !== 'object') {
    errors.push('migration_profile.execution is required and must be an object');
  } else {
    if (typeof exec.dry_run !== 'boolean') {
      errors.push(
        `migration_profile.execution.dry_run must be true or false — got: ${JSON.stringify(exec.dry_run)}`
      );
    }
    if (!VALID.entra_write_tooling.has(exec.entra_write_tooling)) {
      errors.push(
        `migration_profile.execution.entra_write_tooling must be one of: ${[...VALID.entra_write_tooling].join(', ')} — got: ${JSON.stringify(exec.entra_write_tooling)}`
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load and validate the migration_profile block from .secops/identity/ping.yaml.
 *
 * Returns {ok:false} with a clear actionable error when:
 * - The file is missing
 * - The YAML is malformed
 * - The migration_profile block is absent
 * - The block fails schema validation
 *
 * NEVER throws.
 *
 * @param {string} [filePath] - Override path to ping.yaml.
 *   Defaults to <cwd>/.secops/identity/ping.yaml.
 * @returns {{ok: true, data: object} | {ok: false, error: string}}
 */
function loadMigrationProfile(filePath) {
  try {
    const resolvedPath = filePath
      ? path.resolve(filePath)
      : path.join(process.cwd(), '.secops', 'identity', 'ping.yaml');

    if (!fs.existsSync(resolvedPath)) {
      return {
        ok: false,
        error:
          `Migration profile not found: ${resolvedPath}\n` +
          `Run the Ping decision guide (skills/ping/decisions/) to declare your migration ` +
          `choices, then add a migration_profile: block to .secops/identity/ping.yaml.`,
      };
    }

    let parsed;
    try {
      const content = fs.readFileSync(resolvedPath, 'utf8');
      parsed = yaml.load(content);
    } catch (yamlErr) {
      return {
        ok: false,
        error: `Failed to parse ${resolvedPath}: ${yamlErr.message}`,
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        ok: false,
        error: `${resolvedPath} is empty or not a valid YAML object`,
      };
    }

    const profile = parsed.migration_profile;
    if (!profile) {
      return {
        ok: false,
        error:
          `migration_profile block not found in ${resolvedPath}.\n` +
          `Run the Ping decision guide (skills/ping/decisions/) to declare your migration ` +
          `choices, then add a migration_profile: block to .secops/identity/ping.yaml.`,
      };
    }

    const errors = validateProfile(profile);
    if (errors.length > 0) {
      return {
        ok: false,
        error:
          `migration_profile validation failed with ${errors.length} error(s):\n` +
          errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n'),
      };
    }

    return { ok: true, data: profile };
  } catch (err) {
    return {
      ok: false,
      error: `Unexpected error loading migration profile: ${err.message}`,
    };
  }
}

module.exports = {
  loadMigrationProfile,
  validateProfile,
  VALID,
  OWNERSHIP_CLASSES,
};
