/**
 * Foundry Config — Phase 0 Test Suite
 *
 * Written by Carver (Tester/QA). Tests the config loading, endpoint resolution,
 * and normalization logic for lib/foundry/config.js.
 *
 * Run: node --test lib/foundry/config.test.js
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import yaml from 'js-yaml';

// Load CJS modules via createRequire (matches graph-security test pattern)
const require = createRequire(import.meta.url);
const { loadFoundryConfig, resolveEndpoint, normalizeEndpoint } = require('./config.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES_DIR = resolve(import.meta.dirname, 'fixtures');
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

/** Create a clean temp dir with a .secops subdirectory ready to receive foundry.yaml */
function makeTempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'foundry-cfg-test-'));
  mkdirSync(join(root, '.secops'));
  return root;
}

/** Write a fixture YAML file into a temp root's .secops/foundry.yaml */
function installFixture(tmpRoot, fixtureName) {
  const src = join(FIXTURES_DIR, fixtureName);
  const content = readFileSync(src, 'utf8');
  writeFileSync(join(tmpRoot, '.secops', 'foundry.yaml'), content, 'utf8');
  return tmpRoot;
}

/** Clean up a temp root directory */
function cleanTempRoot(tmpRoot) {
  if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. CONFIG DETECTION MATRIX — 6 fixtures vs Sydnor's contract
// ---------------------------------------------------------------------------

describe('loadFoundryConfig — fixture contract matrix', () => {
  const fixtures = [
    { name: 'valid-foundry.yaml',                file: 'valid-foundry.yaml',                expectNull: false },
    { name: 'disabled-foundry.yaml',             file: 'disabled-foundry.yaml',             expectNull: true  },
    { name: 'malformed-foundry.yaml',            file: 'malformed-foundry.yaml',            expectNull: true  },
    { name: 'schema-drifted-foundry.yaml',       file: 'schema-drifted-foundry.yaml',       expectNull: true  },
    { name: 'partial-foundry.yaml',              file: 'partial-foundry.yaml',              expectNull: true  },
    { name: 'no-active-deployment-foundry.yaml', file: 'no-active-deployment-foundry.yaml', expectNull: true  },
  ];

  for (const { name, file, expectNull } of fixtures) {
    it(`${name} → ${expectNull ? 'null' : 'non-null'}`, () => {
      const tmpRoot = makeTempRoot();
      try {
        installFixture(tmpRoot, file);
        const result = loadFoundryConfig(tmpRoot);
        if (expectNull) {
          assert.equal(result, null, `Expected null for ${name} but got a config object`);
        } else {
          assert.notEqual(result, null, `Expected non-null for ${name} but got null`);
          assert.equal(typeof result, 'object');
        }
      } finally {
        cleanTempRoot(tmpRoot);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. VALID CONFIG — active deployment detail assertions
// ---------------------------------------------------------------------------

describe('loadFoundryConfig — valid fixture returns correct active deployment', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = makeTempRoot();
    installFixture(tmpRoot, 'valid-foundry.yaml');
  });

  after(() => cleanTempRoot(tmpRoot));

  it('returns a non-null config object', () => {
    const cfg = loadFoundryConfig(tmpRoot);
    assert.notEqual(cfg, null);
    assert.ok(cfg.foundry, 'config.foundry must exist');
  });

  it('active_model is claude-fable-5', () => {
    const cfg = loadFoundryConfig(tmpRoot);
    assert.equal(cfg.foundry.active_model, 'claude-fable-5');
  });

  it('model_deployments contains the active deployment with status "active"', () => {
    const cfg = loadFoundryConfig(tmpRoot);
    const active = cfg.foundry.model_deployments.find(
      (d) => d.model_id === 'claude-fable-5' && d.status === 'active'
    );
    assert.ok(active, 'No active deployment found for claude-fable-5');
    assert.equal(active.model_id, 'claude-fable-5');
    assert.equal(active.status, 'active');
    assert.equal(active.provider, 'anthropic');
  });

  it('endpoint is normalized (no trailing slash, no baked-in provider path)', () => {
    const cfg = loadFoundryConfig(tmpRoot);
    assert.ok(typeof cfg.foundry.endpoint === 'string');
    assert.ok(!cfg.foundry.endpoint.endsWith('/'), 'endpoint must not end with /');
    assert.ok(!cfg.foundry.endpoint.includes('/anthropic'), 'endpoint must not have /anthropic baked in');
    assert.ok(!cfg.foundry.endpoint.includes('/openai'), 'endpoint must not have /openai baked in');
  });
});

// ---------------------------------------------------------------------------
// 3. MISSING CONFIG DIR — no .secops/foundry.yaml at all
// ---------------------------------------------------------------------------

describe('loadFoundryConfig — missing config', () => {
  it('returns null when .secops/foundry.yaml does not exist', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'foundry-missing-'));
    try {
      // NOTE: no .secops dir created, no yaml written
      const result = loadFoundryConfig(tmpRoot);
      assert.equal(result, null);
    } finally {
      cleanTempRoot(tmpRoot);
    }
  });

  it('returns null when .secops dir exists but foundry.yaml is absent', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'foundry-emptydir-'));
    try {
      mkdirSync(join(tmpRoot, '.secops'));
      const result = loadFoundryConfig(tmpRoot);
      assert.equal(result, null);
    } finally {
      cleanTempRoot(tmpRoot);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. resolveEndpoint — routing rules
// ---------------------------------------------------------------------------

describe('resolveEndpoint — anthropic deployment', () => {
  let cfg;

  before(() => {
    cfg = {
      foundry: {
        endpoint: 'https://secops-foundry.cognitiveservices.azure.com',
        api_version: '2025-04-01-preview',
      },
    };
  });

  it('provider:anthropic → {endpoint}{api_path}', () => {
    const deployment = {
      provider: 'anthropic',
      deployment_name: 'fable5-secops',
      api_path: '/anthropic/v1/messages',
    };
    const url = resolveEndpoint(cfg, deployment);
    assert.equal(url, 'https://secops-foundry.cognitiveservices.azure.com/anthropic/v1/messages');
  });

  it('provider:anthropic with default api_path when api_path is absent', () => {
    const deployment = { provider: 'anthropic', deployment_name: 'fable5-secops' };
    const url = resolveEndpoint(cfg, deployment);
    // api_path defaults to /anthropic/v1/messages
    assert.equal(url, 'https://secops-foundry.cognitiveservices.azure.com/anthropic/v1/messages');
  });

  it('trailing slash on endpoint base is deduplicated', () => {
    const trailingCfg = {
      foundry: {
        endpoint: 'https://secops-foundry.cognitiveservices.azure.com/',
        api_version: '2025-04-01-preview',
      },
    };
    const deployment = {
      provider: 'anthropic',
      deployment_name: 'fable5-secops',
      api_path: '/anthropic/v1/messages',
    };
    const url = resolveEndpoint(trailingCfg, deployment);
    assert.ok(!url.includes('//anthropic'), `Double slash in URL: ${url}`);
    assert.equal(url, 'https://secops-foundry.cognitiveservices.azure.com/anthropic/v1/messages');
  });
});

describe('resolveEndpoint — openai deployment', () => {
  const openaiCfg = {
    foundry: {
      endpoint: 'https://secops-foundry.cognitiveservices.azure.com',
      api_version: '2025-04-01-preview',
    },
  };

  it('provider:openai → {endpoint}/openai/deployments/{name}/chat/completions?api-version={ver}', () => {
    const deployment = {
      provider: 'openai',
      deployment_name: 'gpt4o-secops',
      api_path: '/openai/v1/chat',
    };
    const url = resolveEndpoint(openaiCfg, deployment);
    assert.equal(
      url,
      'https://secops-foundry.cognitiveservices.azure.com/openai/deployments/gpt4o-secops/chat/completions?api-version=2025-04-01-preview'
    );
  });

  it('provider:openai-reasoning → same openai URL pattern', () => {
    const deployment = {
      provider: 'openai-reasoning',
      deployment_name: 'o4mini-secops',
    };
    const url = resolveEndpoint(openaiCfg, deployment);
    assert.equal(
      url,
      'https://secops-foundry.cognitiveservices.azure.com/openai/deployments/o4mini-secops/chat/completions?api-version=2025-04-01-preview'
    );
  });

  it('unknown/missing provider defaults to openai routing', () => {
    const deployment = { deployment_name: 'mystery-model' };
    const url = resolveEndpoint(openaiCfg, deployment);
    assert.ok(url.includes('/openai/deployments/mystery-model/'));
    assert.ok(url.includes('api-version=2025-04-01-preview'));
  });

  it('uses foundry.api_version fallback when api_version absent from config', () => {
    const minimalCfg = { foundry: { endpoint: 'https://base.azure.com' } };
    const deployment = { provider: 'openai', deployment_name: 'my-dep' };
    const url = resolveEndpoint(minimalCfg, deployment);
    assert.ok(url.includes('api-version='), 'URL must include api-version param');
    // falls back to hardcoded default
    assert.ok(url.includes('2025-04-01-preview'), `Expected default api_version in URL: ${url}`);
  });
});

// ---------------------------------------------------------------------------
// 5. normalizeEndpoint — trailing slash and baked-in path stripping
// ---------------------------------------------------------------------------

describe('normalizeEndpoint', () => {
  it('returns endpoint unchanged when already clean', () => {
    const result = normalizeEndpoint('https://secops.cognitiveservices.azure.com');
    assert.equal(result, 'https://secops.cognitiveservices.azure.com');
  });

  it('strips single trailing slash', () => {
    const result = normalizeEndpoint('https://secops.cognitiveservices.azure.com/');
    assert.equal(result, 'https://secops.cognitiveservices.azure.com');
  });

  it('strips multiple trailing slashes', () => {
    const result = normalizeEndpoint('https://secops.cognitiveservices.azure.com///');
    assert.equal(result, 'https://secops.cognitiveservices.azure.com');
  });

  it('strips baked-in /anthropic path prefix (normalize to base URL)', () => {
    const baked = 'https://secops.services.ai.azure.com/anthropic/v1/';
    const result = normalizeEndpoint(baked);
    assert.equal(result, 'https://secops.services.ai.azure.com');
    assert.ok(!result.includes('/anthropic'), 'Anthropic path must be stripped');
  });

  it('strips baked-in /openai path prefix (normalize to base URL)', () => {
    const baked = 'https://secops.services.ai.azure.com/openai/deployments/foo/chat/completions';
    const result = normalizeEndpoint(baked);
    assert.equal(result, 'https://secops.services.ai.azure.com');
    assert.ok(!result.includes('/openai'), 'OpenAI path must be stripped');
  });

  it('handles non-string input by returning it unchanged (no throw)', () => {
    assert.equal(normalizeEndpoint(null), null);
    assert.equal(normalizeEndpoint(undefined), undefined);
    assert.equal(normalizeEndpoint(42), 42);
  });
});

// ---------------------------------------------------------------------------
// 6. SCHEMA-ALIGNMENT REGRESSION TEST
// Critical: this is the test that would have caught the three-schema drift.
// ---------------------------------------------------------------------------

describe('Schema alignment regression — foundry.yaml.example vs secops-squad.config.schema.json', () => {
  const examplePath = join(REPO_ROOT, '.secops', 'foundry.yaml.example');
  const schemaPath = join(REPO_ROOT, 'secops-squad.config.schema.json');

  it('foundry.yaml.example exists and is valid YAML', () => {
    assert.ok(existsSync(examplePath), `foundry.yaml.example not found at ${examplePath}`);
    const raw = readFileSync(examplePath, 'utf8');
    let parsed;
    assert.doesNotThrow(() => { parsed = yaml.load(raw); }, 'foundry.yaml.example must parse as valid YAML');
    assert.ok(parsed && typeof parsed === 'object', 'Parsed YAML must be a non-null object');
  });

  it('foundry.yaml.example has canonical top-level schema_version field', () => {
    const parsed = yaml.load(readFileSync(examplePath, 'utf8'));
    assert.ok('schema_version' in parsed, 'Must have schema_version at top level (snake_case)');
    assert.equal(typeof parsed.schema_version, 'string');
  });

  it('foundry.yaml.example has all canonical foundry.* snake_case top-level fields', () => {
    const parsed = yaml.load(readFileSync(examplePath, 'utf8'));
    const foundry = parsed.foundry;
    assert.ok(foundry, 'Must have foundry section');
    const required = [
      'enabled', 'resource_name', 'endpoint', 'location', 'resource_group',
      'api_version', 'active_model', 'model_deployments', 'pricing', 'cost_ceiling_usd',
    ];
    for (const field of required) {
      assert.ok(field in foundry, `foundry.yaml.example missing canonical field: foundry.${field}`);
    }
  });

  it('foundry.yaml.example model_deployments has all canonical per-deployment fields', () => {
    const parsed = yaml.load(readFileSync(examplePath, 'utf8'));
    const deps = parsed.foundry.model_deployments;
    assert.ok(Array.isArray(deps) && deps.length > 0, 'model_deployments must be a non-empty array');
    const requiredDepFields = [
      'model_id', 'deployment_name', 'deployment_type', 'provider', 'status', 'api_path', 'reasoning_model',
    ];
    for (const dep of deps) {
      for (const field of requiredDepFields) {
        assert.ok(field in dep, `Deployment entry missing canonical field: ${field}`);
      }
    }
  });

  it('foundry.yaml.example uses snake_case — no camelCase keys present', () => {
    const parsed = yaml.load(readFileSync(examplePath, 'utf8'));
    const raw = JSON.stringify(parsed);
    // The drift that caused schema conflict #1: camelCase in YAML
    const camelCaseKeys = ['modelDeployments', 'resourceName', 'apiVersion', 'activeModel',
                           'resourceGroup', 'costCeiling', 'deploymentName', 'deploymentType',
                           'reasoningModel', 'apiPath'];
    for (const key of camelCaseKeys) {
      assert.ok(!raw.includes(`"${key}"`), `foundry.yaml.example must not contain camelCase key: ${key}`);
    }
  });

  it('secops-squad.config.schema.json does NOT contain camelCase modelDeployments (drift defect removed)', () => {
    assert.ok(existsSync(schemaPath), `schema file not found at ${schemaPath}`);
    const raw = readFileSync(schemaPath, 'utf8');
    // The original three-schema drift: JSON schema had camelCase 'modelDeployments' conflicting with YAML snake_case
    assert.ok(
      !raw.includes('"modelDeployments"'),
      'secops-squad.config.schema.json must NOT contain camelCase "modelDeployments" — this was the schema drift defect'
    );
  });

  it('secops-squad.config.schema.json has $comment pointing to foundry.yaml as the canonical location', () => {
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
    assert.ok(schema.$comment, '$comment must be present in schema root');
    assert.ok(
      schema.$comment.includes('foundry.yaml') || schema.$comment.toLowerCase().includes('foundry'),
      `$comment must reference foundry.yaml. Got: ${schema.$comment}`
    );
  });
});

// ---------------------------------------------------------------------------
// 7. F-001 REGRESSION — partial fixture (missing endpoint)
// ---------------------------------------------------------------------------
// F-001 contract: loadFoundryConfig() is the fail-closed gate. Missing, empty, or
// whitespace endpoints return null before any provider can build a hostless URL.
// resolveEndpoint() still throws clearly if called directly with a malformed config.
// ---------------------------------------------------------------------------

describe('F-001 fail-closed endpoint contract', () => {
  let tmpRoot;

  before(() => {
    tmpRoot = makeTempRoot();
    installFixture(tmpRoot, 'partial-foundry.yaml');
  });

  after(() => cleanTempRoot(tmpRoot));

  it('[F-001 REGRESSION] partial config (no endpoint) returns null — fail-closed', () => {
    const result = loadFoundryConfig(tmpRoot);
    assert.equal(result, null, 'Missing endpoint must make Foundry unavailable');
  });

  it('[F-001 REGRESSION] resolveEndpoint rejects a missing endpoint instead of returning a relative URL', () => {
    const malformedConfig = { foundry: { api_version: '2025-04-01-preview' } };
    const activeDep = {
      model_id: 'claude-fable-5',
      deployment_name: 'fable5-secops',
      provider: 'anthropic',
      status: 'active',
      api_path: '/anthropic/v1/messages',
    };

    assert.throws(
      () => resolveEndpoint(malformedConfig, activeDep),
      /Foundry endpoint is missing or empty/,
      'resolveEndpoint() must not emit hostless provider paths'
    );
  });

  it('[F-001 REGRESSION] whitespace endpoint returns null — fail-closed', () => {
    const tmpWhitespaceRoot = makeTempRoot();
    try {
      installFixture(tmpWhitespaceRoot, 'valid-foundry.yaml');
      const configPath = join(tmpWhitespaceRoot, '.secops', 'foundry.yaml');
      const raw = readFileSync(configPath, 'utf8');
      writeFileSync(
        configPath,
        raw.replace('endpoint: "https://secops-foundry.cognitiveservices.azure.com"', 'endpoint: "   "'),
        'utf8'
      );

      assert.equal(loadFoundryConfig(tmpWhitespaceRoot), null);
    } finally {
      cleanTempRoot(tmpWhitespaceRoot);
    }
  });
});
