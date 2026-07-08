/**
 * update.js — Unit + Regression Test Suite
 *
 * Written by Carver (Tester/QA).
 * Proves Sydnor's scoped-sync rewrite fixes the .squad/decisions.md contamination bug.
 *
 * Run: node --test cli/commands/update.test.js
 * (Not auto-discovered by npm test which targets lib/**; run directly.)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Module under test — CommonJS, loaded via createRequire
const { globToRegex, matchesGlob, classifyPath, isFramework, planUpdate, diffPackageJsonDeps } =
  require('./update.js');

// Real manifest — the actual gate used in production
const MANIFEST = require('../framework-manifest.json');

// ─────────────────────────────────────────────────────────────────────────────
// 1. globToRegex / matchesGlob
// ─────────────────────────────────────────────────────────────────────────────

describe('globToRegex / matchesGlob', () => {
  describe('** recursive glob — cli/**', () => {
    it('cli/** matches cli/index.js', () =>
      assert.equal(matchesGlob('cli/index.js', 'cli/**'), true));
    it('cli/** matches cli/commands/update.js (nested)', () =>
      assert.equal(matchesGlob('cli/commands/update.js', 'cli/**'), true));
    it('cli/** does NOT match lib/index.js', () =>
      assert.equal(matchesGlob('lib/index.js', 'cli/**'), false));
    it('cli/** does NOT match xcli/index.js (prefix segment mismatch)', () =>
      assert.equal(matchesGlob('xcli/index.js', 'cli/**'), false));
  });

  describe('**/*.example — suffix matching across depth', () => {
    it('.env.example at root matches **/*.example', () =>
      assert.equal(matchesGlob('.env.example', '**/*.example'), true));
    it('.secops/foundry.yaml.example matches **/*.example', () =>
      assert.equal(matchesGlob('.secops/foundry.yaml.example', '**/*.example'), true));
    it('a/b/c.example (3 levels) matches **/*.example', () =>
      assert.equal(matchesGlob('a/b/c.example', '**/*.example'), true));
    it('.secops/identity/okta.yaml does NOT match **/*.example', () =>
      assert.equal(matchesGlob('.secops/identity/okta.yaml', '**/*.example'), false));
    it('.squad/decisions.md does NOT match **/*.example', () =>
      assert.equal(matchesGlob('.squad/decisions.md', '**/*.example'), false));
  });

  describe('* single-segment — .squad/agents/*/charter.md', () => {
    it('matches .squad/agents/kima/charter.md', () =>
      assert.equal(matchesGlob('.squad/agents/kima/charter.md', '.squad/agents/*/charter.md'), true));
    it('matches .squad/agents/sydnor/charter.md', () =>
      assert.equal(matchesGlob('.squad/agents/sydnor/charter.md', '.squad/agents/*/charter.md'), true));
    it('does NOT match .squad/agents/kima/sub/charter.md (two segments in wildcard slot)', () =>
      assert.equal(matchesGlob('.squad/agents/kima/sub/charter.md', '.squad/agents/*/charter.md'), false));
    it('.secops/workspaces/*.yaml matches .secops/workspaces/prod.yaml', () =>
      assert.equal(matchesGlob('.secops/workspaces/prod.yaml', '.secops/workspaces/*.yaml'), true));
    it('.secops/workspaces/*.yaml does NOT match .secops/workspaces/sub/prod.yaml', () =>
      assert.equal(matchesGlob('.secops/workspaces/sub/prod.yaml', '.secops/workspaces/*.yaml'), false));
  });

  describe('exact match', () => {
    it('README.md matches README.md', () =>
      assert.equal(matchesGlob('README.md', 'README.md'), true));
    it('docs/README.md does NOT match README.md', () =>
      assert.equal(matchesGlob('docs/README.md', 'README.md'), false));
    it('decisions.md matches decisions.md', () =>
      assert.equal(matchesGlob('decisions.md', 'decisions.md'), true));
    it('.squad/decisions.md does NOT match decisions.md (extra dir)', () =>
      assert.equal(matchesGlob('.squad/decisions.md', 'decisions.md'), false));
  });

  describe('backslash normalization (Windows paths)', () => {
    it('cli\\commands\\update.js matches cli/**', () =>
      assert.equal(matchesGlob('cli\\commands\\update.js', 'cli/**'), true));
    it('.squad\\decisions.md matches .squad/decisions.md pattern', () =>
      assert.equal(matchesGlob('.squad\\decisions.md', '.squad/decisions.md'), true));
  });

  describe('edge cases', () => {
    it('skills/okta/foo.md matches skills/**', () =>
      assert.equal(matchesGlob('skills/okta/foo.md', 'skills/**'), true));
    it('.squad/skills/bar.md matches .squad/skills/**', () =>
      assert.equal(matchesGlob('.squad/skills/bar.md', '.squad/skills/**'), true));
    it('empty path does NOT match cli/**', () =>
      assert.equal(matchesGlob('', 'cli/**'), false));
    it('globToRegex returns a RegExp', () =>
      assert.ok(globToRegex('cli/**') instanceof RegExp));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. classifyPath / isFramework — THE CRITICAL GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyPath — personal_paths WINS over framework_paths', () => {

  // Personal files — must never be synced
  it('.secops/identity/okta.yaml → personal (live YAML, consumer-specific)', () =>
    assert.equal(classifyPath('.secops/identity/okta.yaml', MANIFEST), 'personal'));

  it('.squad/decisions.md → personal (THE contamination vector — must be SKIPPED)', () =>
    assert.equal(classifyPath('.squad/decisions.md', MANIFEST), 'personal'));

  it('.squad/agents/kima/history.md → personal', () =>
    assert.equal(classifyPath('.squad/agents/kima/history.md', MANIFEST), 'personal'));

  it('.squad/agents/kima/charter.md → personal', () =>
    assert.equal(classifyPath('.squad/agents/kima/charter.md', MANIFEST), 'personal'));

  it('.squad/skills/bar.md → personal (consumer skill library, NOT framework skills/)', () =>
    assert.equal(classifyPath('.squad/skills/bar.md', MANIFEST), 'personal'));

  it('.squad/decisions/inbox/carver-test.md → personal', () =>
    assert.equal(classifyPath('.squad/decisions/inbox/carver-test.md', MANIFEST), 'personal'));

  it('decisions.md (root) → personal', () =>
    assert.equal(classifyPath('decisions.md', MANIFEST), 'personal'));

  it('secops-squad.config.json → personal', () =>
    assert.equal(classifyPath('secops-squad.config.json', MANIFEST), 'personal'));

  it('.secops/foundry.yaml → personal', () =>
    assert.equal(classifyPath('.secops/foundry.yaml', MANIFEST), 'personal'));

  // Framework files — must be synced
  it('.secops/identity/okta.yaml.example → framework (*.example pattern wins; no personal pattern matches it)', () =>
    assert.equal(classifyPath('.secops/identity/okta.yaml.example', MANIFEST), 'framework'));

  it('.env.example → framework', () =>
    assert.equal(classifyPath('.env.example', MANIFEST), 'framework'));

  it('.secops/foundry.yaml.example → framework', () =>
    assert.equal(classifyPath('.secops/foundry.yaml.example', MANIFEST), 'framework'));

  it('.squad/templates/charter.md → framework (template, not a live charter)', () =>
    assert.equal(classifyPath('.squad/templates/charter.md', MANIFEST), 'framework'));

  it('skills/okta/foo.md → framework', () =>
    assert.equal(classifyPath('skills/okta/foo.md', MANIFEST), 'framework'));

  it('cli/commands/update.js → framework', () =>
    assert.equal(classifyPath('cli/commands/update.js', MANIFEST), 'framework'));

  it('lib/okta/client.js → framework', () =>
    assert.equal(classifyPath('lib/okta/client.js', MANIFEST), 'framework'));

  it('README.md → framework', () =>
    assert.equal(classifyPath('README.md', MANIFEST), 'framework'));

  it('package.json → framework', () =>
    assert.equal(classifyPath('package.json', MANIFEST), 'framework'));

  it('scripts/setup.sh → framework', () =>
    assert.equal(classifyPath('scripts/setup.sh', MANIFEST), 'framework'));

  it('.copilot/skills/some-skill.md → framework', () =>
    assert.equal(classifyPath('.copilot/skills/some-skill.md', MANIFEST), 'framework'));

  // Unknown
  it('some/random/file.xyz → unknown', () =>
    assert.equal(classifyPath('some/random/file.xyz', MANIFEST), 'unknown'));
});

describe('isFramework — convenience wrapper', () => {
  it('cli/index.js → true', () =>
    assert.equal(isFramework('cli/index.js', MANIFEST), true));
  it('.squad/decisions.md → false', () =>
    assert.equal(isFramework('.squad/decisions.md', MANIFEST), false));
  it('.secops/foundry.yaml → false', () =>
    assert.equal(isFramework('.secops/foundry.yaml', MANIFEST), false));
  it('.secops/foundry.yaml.example → true', () =>
    assert.equal(isFramework('.secops/foundry.yaml.example', MANIFEST), true));
  it('skills/detection/my-rule.kql → true', () =>
    assert.equal(isFramework('skills/detection/my-rule.kql', MANIFEST), true));
  it('some/random.xyz → false (unknown is not framework)', () =>
    assert.equal(isFramework('some/random.xyz', MANIFEST), false));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. planUpdate
// ─────────────────────────────────────────────────────────────────────────────

describe('planUpdate', () => {
  // Upstream file list (simulates git ls-tree from starter-kit/main)
  const UPSTREAM = [
    'cli/commands/update.js',         // framework → toSync
    'lib/okta/client.js',             // framework → toSync
    'README.md',                      // framework → toSync
    'skills/new-skill.md',            // framework → toSync
    '.env.example',                   // framework → toSync
    '.secops/foundry.yaml.example',   // framework → toSync (*.example wins)
    '.squad/decisions.md',            // personal  → skippedPersonal (THE contamination vector)
    '.squad/agents/kima/charter.md',  // personal  → skippedPersonal
    '.secops/foundry.yaml',           // personal  → skippedPersonal
  ];

  // Local file list (simulates git ls-files in consumer repo)
  const LOCAL = [
    'cli/commands/update.js',
    'lib/okta/client.js',
    'cli/commands/old-removed.js',   // framework + absent upstream → toDelete
    'README.md',
    '.squad/decisions.md',           // personal locally → must NOT be deleted
    'secops-squad.config.json',      // personal → must NOT be deleted
  ];

  let result;
  before(() => { result = planUpdate(UPSTREAM, LOCAL, MANIFEST); });

  describe('toSync — framework files from upstream', () => {
    it('includes cli/commands/update.js', () =>
      assert.ok(result.toSync.includes('cli/commands/update.js')));
    it('includes lib/okta/client.js', () =>
      assert.ok(result.toSync.includes('lib/okta/client.js')));
    it('includes README.md', () =>
      assert.ok(result.toSync.includes('README.md')));
    it('includes skills/new-skill.md', () =>
      assert.ok(result.toSync.includes('skills/new-skill.md')));
    it('includes .env.example', () =>
      assert.ok(result.toSync.includes('.env.example')));
    it('includes .secops/foundry.yaml.example (*.example is framework)', () =>
      assert.ok(result.toSync.includes('.secops/foundry.yaml.example')));
    it('has exactly 6 items (all and only framework upstream files)', () =>
      assert.equal(result.toSync.length, 6));
    it('does NOT include .squad/decisions.md', () =>
      assert.ok(!result.toSync.includes('.squad/decisions.md')));
    it('does NOT include .squad/agents/kima/charter.md', () =>
      assert.ok(!result.toSync.includes('.squad/agents/kima/charter.md')));
    it('does NOT include .secops/foundry.yaml', () =>
      assert.ok(!result.toSync.includes('.secops/foundry.yaml')));
  });

  describe('skippedPersonal — upstream personal files filtered out', () => {
    it('includes .squad/decisions.md', () =>
      assert.ok(result.skippedPersonal.includes('.squad/decisions.md')));
    it('includes .squad/agents/kima/charter.md', () =>
      assert.ok(result.skippedPersonal.includes('.squad/agents/kima/charter.md')));
    it('includes .secops/foundry.yaml', () =>
      assert.ok(result.skippedPersonal.includes('.secops/foundry.yaml')));
    it('has exactly 3 items', () =>
      assert.equal(result.skippedPersonal.length, 3));
  });

  describe('toDelete — local framework files absent upstream', () => {
    it('includes cli/commands/old-removed.js (framework + absent upstream)', () =>
      assert.ok(result.toDelete.includes('cli/commands/old-removed.js')));
    it('does NOT include .squad/decisions.md (personal files never deleted)', () =>
      assert.ok(!result.toDelete.includes('.squad/decisions.md')));
    it('does NOT include secops-squad.config.json (personal)', () =>
      assert.ok(!result.toDelete.includes('secops-squad.config.json')));
    it('has exactly 1 item', () =>
      assert.equal(result.toDelete.length, 1));
  });

  describe('edge cases', () => {
    it('personal file locally AND absent upstream → NOT in toDelete', () => {
      const upstreamWithout = UPSTREAM.filter((f) => f !== '.squad/decisions.md');
      const localWith = ['.squad/decisions.md', 'cli/commands/update.js'];
      const r = planUpdate(upstreamWithout, localWith, MANIFEST);
      assert.ok(!r.toDelete.includes('.squad/decisions.md'),
        'personal local file absent upstream must never appear in toDelete');
    });

    it('local framework file absent from empty upstream → in toDelete', () => {
      const r = planUpdate([], ['cli/commands/update.js'], MANIFEST);
      assert.ok(r.toDelete.includes('cli/commands/update.js'),
        'framework file absent upstream is a deletion candidate');
    });

    it('local personal file with empty upstream → toDelete is empty', () => {
      const r = planUpdate([], ['.squad/decisions.md'], MANIFEST);
      assert.equal(r.toDelete.length, 0,
        'personal file must not be deleted even if absent from upstream');
    });

    it('unknown local file absent upstream → NOT in toDelete', () => {
      const r = planUpdate([], ['mystery/unknown-file.xyz'], MANIFEST);
      assert.equal(r.toDelete.length, 0,
        'unknown classification is never a deletion candidate');
    });

    it('empty inputs → all empty outputs', () => {
      const r = planUpdate([], [], MANIFEST);
      assert.equal(r.toSync.length, 0);
      assert.equal(r.toDelete.length, 0);
      assert.equal(r.skippedPersonal.length, 0);
    });

    it('unknown upstream file → silently ignored (not in toSync, not in skippedPersonal)', () => {
      const r = planUpdate(['mystery/unknown-file.xyz'], [], MANIFEST);
      assert.equal(r.toSync.length, 0);
      assert.equal(r.skippedPersonal.length, 0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. diffPackageJsonDeps
// ─────────────────────────────────────────────────────────────────────────────

describe('diffPackageJsonDeps', () => {
  it('consumer added dep not in upstream → returned', () => {
    const local    = { dependencies: { express: '^4.0.0', 'consumer-extra': '^1.0.0' } };
    const upstream = { dependencies: { express: '^4.0.0' } };
    assert.deepEqual(diffPackageJsonDeps(local, upstream), ['consumer-extra']);
  });

  it('identical deps → empty array', () => {
    const pkg = { dependencies: { express: '^4.0.0' }, devDependencies: { mocha: '^10.0.0' } };
    assert.deepEqual(diffPackageJsonDeps(pkg, pkg), []);
  });

  it('consumer added devDependency not in upstream → returned', () => {
    const local    = { devDependencies: { jest: '^29.0.0' } };
    const upstream = { devDependencies: {} };
    const diff = diffPackageJsonDeps(local, upstream);
    assert.ok(diff.includes('jest'));
  });

  it('upstream has dep not in local → not reported (local-only diff)', () => {
    const local    = { dependencies: { express: '^4.0.0' } };
    const upstream = { dependencies: { express: '^4.0.0', 'upstream-extra': '^1.0.0' } };
    assert.deepEqual(diffPackageJsonDeps(local, upstream), []);
  });

  it('empty packages → empty array', () =>
    assert.deepEqual(diffPackageJsonDeps({}, {}), []));

  it('local dep present in upstream devDependencies is NOT reported (cross-section match)', () => {
    const local    = { dependencies: { 'js-yaml': '^4.0.0' } };
    const upstream = { devDependencies: { 'js-yaml': '^4.1.0' } };
    assert.deepEqual(diffPackageJsonDeps(local, upstream), []);
  });

  it('multiple extra local deps → all returned', () => {
    const local    = { dependencies: { a: '1', b: '2', c: '3' }, devDependencies: { d: '4' } };
    const upstream = { dependencies: { a: '1' } };
    const diff = diffPackageJsonDeps(local, upstream);
    assert.equal(diff.length, 3);
    assert.ok(diff.includes('b'));
    assert.ok(diff.includes('c'));
    assert.ok(diff.includes('d'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 (Part B — logical): Regression — contamination scenario via planUpdate
// ─────────────────────────────────────────────────────────────────────────────

describe('REGRESSION: .squad/decisions.md contamination — pure logic proof', () => {
  it('upstream decisions.md is in skippedPersonal, NOT in toSync', () => {
    // Reproduces the original bug scenario: author accidentally ships their
    // .squad/decisions.md in the upstream repo. Old blind merge would pull it in.
    const fakeUpstream = [
      'skills/new.md',           // framework → should sync
      '.squad/decisions.md',     // personal  → must be skipped
    ];
    const fakeLocal = [
      'skills/existing.md',
      '.squad/decisions.md',     // consumer's private decisions
    ];
    const result = planUpdate(fakeUpstream, fakeLocal, MANIFEST);

    assert.ok(result.toSync.includes('skills/new.md'),
      'framework file must be in toSync');
    assert.ok(!result.toSync.includes('.squad/decisions.md'),
      '.squad/decisions.md must NOT be in toSync — old bug would have synced it');
    assert.ok(result.skippedPersonal.includes('.squad/decisions.md'),
      '.squad/decisions.md must be in skippedPersonal');
    assert.ok(!result.toDelete.includes('.squad/decisions.md'),
      '.squad/decisions.md must not be deleted either');
  });

  it('consumer private content cannot be overwritten — classification gate blocks sync', () => {
    // Even if upstream carries D-UPSTREAM-AUTHOR in decisions.md,
    // the file is never in toSync, so D-CONSUMER-PRIVATE is never touched.
    const upstreamFiles = ['.squad/decisions.md', 'skills/new.md'];
    const localFiles    = ['.squad/decisions.md'];
    const result = planUpdate(upstreamFiles, localFiles, MANIFEST);

    assert.ok(!result.toSync.includes('.squad/decisions.md'),
      'Classification gate must prevent upstream decisions.md from entering toSync. ' +
      'Without this gate the old merge=union attribute would concatenate ' +
      'D-UPSTREAM-AUTHOR into D-CONSUMER-PRIVATE.');
  });

  it('all personal_paths entries present upstream are fully skipped', () => {
    // Build a worst-case upstream that ships EVERY personal file
    const allPersonal = [
      '.secops/alerting/escalation.yaml',
      '.secops/alerting/routing.yaml',
      '.secops/compliance/requirements.yaml',
      '.secops/data-sources/data-source-map.yaml',
      '.secops/data-sources/migrations.yaml',
      '.secops/discovery-log.yaml',
      '.secops/environment.yaml',
      '.secops/foundry.yaml',
      '.secops/identity/okta.yaml',
      '.secops/identity/rbac-conventions.yaml',
      '.secops/identity/tenants.yaml',
      '.squad/agents/kima/charter.md',
      '.squad/agents/kima/history.md',
      '.squad/decisions.md',
      '.squad/decisions-archive.md',
      '.squad/routing.md',
      '.squad/team.md',
      'decisions.md',
      'secops-squad.config.json',
    ];
    const result = planUpdate(allPersonal, [], MANIFEST);
    assert.equal(result.toSync.length, 0,
      'No personal file must ever appear in toSync');
    assert.equal(result.skippedPersonal.length, allPersonal.length,
      'Every personal file must appear in skippedPersonal');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5B (Part B — real git): Integration regression with actual git repos
// ─────────────────────────────────────────────────────────────────────────────

const TEMP_DIR = resolve(__dirname, '__test_regression_tmp__');

function execIn(cmd, cwd) {
  return execSync(cmd, { encoding: 'utf8', cwd, timeout: 30000, stdio: 'pipe' }).trim();
}

function cleanTemp() {
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
}

describe('REGRESSION (real git): upstream decisions.md never reaches consumer', () => {
  let upstreamDir, consumerDir;
  let gitAvailable = true;

  before(() => {
    try {
      execSync('git --version', { stdio: 'pipe' });
    } catch {
      gitAvailable = false;
      return;
    }

    cleanTemp();
    upstreamDir = join(TEMP_DIR, 'upstream');
    consumerDir = join(TEMP_DIR, 'consumer');

    // Build fake "upstream" (starter-kit) repo with a framework file AND a personal decisions.md
    mkdirSync(join(upstreamDir, 'skills'), { recursive: true });
    mkdirSync(join(upstreamDir, '.squad'), { recursive: true });
    execIn('git init', upstreamDir);
    execIn('git config user.email "upstream@test.local"', upstreamDir);
    execIn('git config user.name "Upstream Author"', upstreamDir);
    writeFileSync(join(upstreamDir, 'skills', 'new.md'), '# New Framework Skill\n');
    writeFileSync(join(upstreamDir, '.squad', 'decisions.md'), 'D-UPSTREAM-AUTHOR\n');
    execIn('git add .', upstreamDir);
    execIn('git commit -m "upstream init"', upstreamDir);

    // Build consumer repo (separate, unrelated git history)
    mkdirSync(join(consumerDir, '.squad'), { recursive: true });
    execIn('git init', consumerDir);
    execIn('git config user.email "consumer@test.local"', consumerDir);
    execIn('git config user.name "Consumer"', consumerDir);
    writeFileSync(join(consumerDir, '.squad', 'decisions.md'), 'D-CONSUMER-PRIVATE\n');
    execIn('git add .', consumerDir);
    execIn('git commit -m "consumer init"', consumerDir);
  });

  after(cleanTemp);

  it('classifies upstream .squad/decisions.md as personal → skippedPersonal', () => {
    if (!gitAvailable) return;
    const upstreamFiles = execIn('git ls-files', upstreamDir).split('\n').filter(Boolean);
    const result = planUpdate(upstreamFiles, [], MANIFEST);
    assert.ok(!result.toSync.includes('.squad/decisions.md'),
      '.squad/decisions.md from upstream must NOT be in toSync');
    assert.ok(result.skippedPersonal.includes('.squad/decisions.md'),
      '.squad/decisions.md must be in skippedPersonal');
    assert.ok(result.toSync.includes('skills/new.md'),
      'skills/new.md (framework) must be in toSync');
  });

  it('consumer .squad/decisions.md still contains D-CONSUMER-PRIVATE only', () => {
    if (!gitAvailable) return;
    // The sync plan excludes decisions.md (proven above), so the consumer file is never written.
    const content = readFileSync(join(consumerDir, '.squad', 'decisions.md'), 'utf8');
    assert.ok(content.includes('D-CONSUMER-PRIVATE'),
      'consumer decisions.md must contain D-CONSUMER-PRIVATE');
    assert.ok(!content.includes('D-UPSTREAM-AUTHOR'),
      'consumer decisions.md must NOT contain D-UPSTREAM-AUTHOR — old blind merge would have contaminated this');
  });
});
