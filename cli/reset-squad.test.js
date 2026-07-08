/**
 * reset-squad.js — QA Test Suite (T1–T8)
 *
 * Written by Seraph (Tester/QA).
 * Spec: .squad/decisions/inbox/morpheus-install-reset-spec.md § "For Seraph"
 *
 * Placement: cli/reset-squad.test.js
 * Note: spec suggests tests/reset-squad.test.js but the npm test glob covers
 * "lib/**‌/*.test.js" and "cli/**‌/*.test.js" only — tests/ is NOT included.
 * Placing here avoids changing the test script while matching the intended scope.
 *
 * Run: node --test cli/reset-squad.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync,
  copyFileSync, readdirSync, statSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import crypto from 'node:crypto';

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);
const require = createRequire(import.meta.url);

const REPO_ROOT        = resolve(__dirname_local, '..');
const SCRIPT_PATH      = join(REPO_ROOT, 'scripts', 'reset-squad.js');
const MANIFEST_SRC     = join(REPO_ROOT, 'cli', 'framework-manifest.json');
const TEMPLATES_SRC    = join(REPO_ROOT, '.squad', 'templates');
const SCRIBE_CHARTER_SRC = join(REPO_ROOT, '.squad', 'agents', 'scribe', 'charter.md');
const RALPH_CHARTER_SRC  = join(REPO_ROOT, '.squad', 'agents', 'ralph',  'charter.md');

// Real template content — read once at module load
const REAL_ROSTER      = readFileSync(join(TEMPLATES_SRC, 'roster.md'),               'utf8');
const REAL_ROUTING     = readFileSync(join(TEMPLATES_SRC, 'routing.md'),              'utf8');
const REAL_REGISTRY    = readFileSync(join(TEMPLATES_SRC, 'casting-registry.json'),   'utf8');
const REAL_HISTORY_TPL = readFileSync(join(TEMPLATES_SRC, 'casting-history.json'),    'utf8');
const REAL_POLICY      = readFileSync(join(TEMPLATES_SRC, 'casting-policy.json'),     'utf8');
const SCRIBE_CHARTER   = readFileSync(SCRIBE_CHARTER_SRC, 'utf8');
const RALPH_CHARTER    = readFileSync(RALPH_CHARTER_SRC,  'utf8');
const REAL_MANIFEST    = require(MANIFEST_SRC);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(os.tmpdir(), `reset-sq-${crypto.randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write a file, creating parent directories as needed. */
function writeFile(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

/** Copy src → dest, creating parent directories as needed. */
function copyFileTo(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/** Shorthand: join(tmpDir, '.squad', ...parts). */
function sq(tmpDir, ...parts) {
  return join(tmpDir, '.squad', ...parts);
}

/** Copy the five required template files into {tmpDir}/.squad/templates/. */
function seedTemplates(tmpDir) {
  const dest = sq(tmpDir, 'templates');
  mkdirSync(dest, { recursive: true });
  for (const f of [
    'roster.md', 'routing.md',
    'casting-registry.json', 'casting-history.json', 'casting-policy.json',
  ]) {
    copyFileSync(join(TEMPLATES_SRC, f), join(dest, f));
  }
}

/** Copy the real framework-manifest.json into {tmpDir}/cli/. */
function seedManifest(tmpDir) {
  copyFileTo(MANIFEST_SRC, join(tmpDir, 'cli', 'framework-manifest.json'));
}

/** Write a custom manifest object into {tmpDir}/cli/. */
function seedCustomManifest(tmpDir, obj) {
  const dest = join(tmpDir, 'cli', 'framework-manifest.json');
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(obj, null, 2), 'utf8');
}

/** Copy the real scribe and ralph charters (framework_exceptions) into tmpDir. */
function seedFrameworkCharters(tmpDir) {
  copyFileTo(SCRIBE_CHARTER_SRC, sq(tmpDir, 'agents', 'scribe', 'charter.md'));
  copyFileTo(RALPH_CHARTER_SRC,  sq(tmpDir, 'agents', 'ralph',  'charter.md'));
}

/**
 * Recursively collect all files under `dir`.
 * Returns { 'rel/path/to/file': 'file content', ... }.
 */
function collectFiles(dir, base) {
  const root = base ?? dir;
  const result = {};
  if (!existsSync(dir)) return result;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel  = full.slice(root.length + 1).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) {
      Object.assign(result, collectFiles(full, root));
    } else {
      result[rel] = readFileSync(full, 'utf8');
    }
  }
  return result;
}

/** Invoke reset-squad.js synchronously against the given tmpDir. */
function runReset(tmpDir) {
  return spawnSync(process.execPath, [SCRIPT_PATH, tmpDir], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// T1 — Happy path: fresh install simulation (20 assertions)
// ─────────────────────────────────────────────────────────────────────────────
describe('T1 — Happy path: fresh install simulation', () => {
  let tmpDir;
  let result;

  before(() => {
    tmpDir = makeTmpDir();
    seedManifest(tmpDir);
    seedTemplates(tmpDir);

    // Maintainer team.md + routing.md with real names
    writeFile(sq(tmpDir, 'team.md'),
      '# Team\n\n## Members\n\nMorpheus — Lead\nTank — Builder\nThe Matrix cast\n');
    writeFile(sq(tmpDir, 'routing.md'),
      '# Routing\n\nRoute everything to Morpheus.\n');

    // Wire-cast dev charters (should all be removed)
    for (const name of ['morpheus', 'tank', 'keymaker', 'seraph']) {
      writeFile(sq(tmpDir, 'agents', name, 'charter.md'),
        `# ${name} charter\n\nThis agent is part of The Matrix cast.\n`);
    }

    // Framework charters — must survive
    seedFrameworkCharters(tmpDir);

    // Casting state with maintainer content
    writeFile(sq(tmpDir, 'casting', 'registry.json'),
      JSON.stringify({ agents: { morpheus: { universe: 'The Matrix' } } }));
    writeFile(sq(tmpDir, 'casting', 'history.json'),
      JSON.stringify({ history: ['session-1'] }));
    writeFile(sq(tmpDir, 'casting', 'policy.json'),
      JSON.stringify({ policy: 'custom-maintainer' }));

    // Runtime personal state — all should be wiped
    writeFile(sq(tmpDir, 'decisions.md'),
      '## Decisions\n\n- Morpheus decided to use The Matrix.\n');
    writeFile(sq(tmpDir, 'agents', 'morpheus', 'history.md'),
      '## History\n\nMorpheus session 1\n');
    writeFile(sq(tmpDir, 'skills', 'custom-skill.md'),
      '# Custom Skill\n\nOrg-specific.\n');
    writeFile(sq(tmpDir, 'identity', 'now.md'),
      '# Now\n\nActive: Morpheus\n');

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with code 0', () =>
    assert.equal(result.status, 0, `stderr: ${result.stderr}`));

  it('team.md matches templates/roster.md exactly', () =>
    assert.equal(readFileSync(sq(tmpDir, 'team.md'), 'utf8'), REAL_ROSTER));

  it('routing.md matches templates/routing.md exactly', () =>
    assert.equal(readFileSync(sq(tmpDir, 'routing.md'), 'utf8'), REAL_ROUTING));

  it('agents/morpheus/charter.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'morpheus', 'charter.md')), false));

  it('agents/tank/charter.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'tank', 'charter.md')), false));

  it('agents/keymaker/charter.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'keymaker', 'charter.md')), false));

  it('agents/seraph/charter.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'seraph', 'charter.md')), false));

  it('agents/scribe/charter.md EXISTS', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'scribe', 'charter.md'))));

  it('agents/scribe/charter.md is unchanged (framework content preserved)', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'agents', 'scribe', 'charter.md'), 'utf8'),
      SCRIBE_CHARTER
    ));

  it('agents/ralph/charter.md EXISTS', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'ralph', 'charter.md'))));

  it('agents/ralph/charter.md is unchanged (framework content preserved)', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'agents', 'ralph', 'charter.md'), 'utf8'),
      RALPH_CHARTER
    ));

  it('casting/registry.json matches casting-registry.json template exactly', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'casting', 'registry.json'), 'utf8'),
      REAL_REGISTRY
    ));

  it('casting/history.json matches casting-history.json template exactly', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'casting', 'history.json'), 'utf8'),
      REAL_HISTORY_TPL
    ));

  it('casting/policy.json matches casting-policy.json template exactly', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'casting', 'policy.json'), 'utf8'),
      REAL_POLICY
    ));

  it('decisions.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'decisions.md')), false));

  it('agents/morpheus/history.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'morpheus', 'history.md')), false));

  it('skills/custom-skill.md does NOT exist (skills dir wiped)', () =>
    assert.equal(existsSync(sq(tmpDir, 'skills', 'custom-skill.md')), false));

  it('identity/now.md does NOT exist', () =>
    assert.equal(existsSync(sq(tmpDir, 'identity', 'now.md')), false));

  it('.first-run EXISTS', () =>
    assert.ok(existsSync(sq(tmpDir, '.first-run'))));

  it('T1-20: team.md contains no maintainer strings (Morpheus / Tank / The Matrix)', () => {
    const content = readFileSync(sq(tmpDir, 'team.md'), 'utf8');
    // The skeleton roster.md has {Name} placeholders, not real names
    assert.ok(!content.includes('Morpheus'),   'team.md must not contain "Morpheus"');
    assert.ok(!content.includes('Tank'),       'team.md must not contain "Tank"');
    assert.ok(!content.includes('The Matrix'), 'team.md must not contain "The Matrix"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T2 — Idempotency: running reset twice yields identical state
// ─────────────────────────────────────────────────────────────────────────────
describe('T2 — Idempotency: two consecutive resets produce identical state', () => {
  let tmpDir;
  let run1, run2;
  let filesAfterRun1, filesAfterRun2;

  before(() => {
    tmpDir = makeTmpDir();
    seedManifest(tmpDir);
    seedTemplates(tmpDir);
    seedFrameworkCharters(tmpDir);
    writeFile(sq(tmpDir, 'team.md'),    '# Team\n\nMorpheus\n');
    writeFile(sq(tmpDir, 'routing.md'), '# Routing\n\nMorpheus routes.\n');
    writeFile(sq(tmpDir, 'agents', 'morpheus', 'charter.md'), '# Morpheus');
    writeFile(sq(tmpDir, 'decisions.md'), '# Decisions');
    writeFile(sq(tmpDir, 'casting', 'registry.json'), '{"agents":{}}');

    run1 = runReset(tmpDir);
    // Collect state after first run.
    // Exclude .first-run: it contains a timestamp (new Date().toISOString()) written by the
    // script, so its byte content necessarily differs between runs. Its PRESENCE is idempotent
    // and is verified separately below.
    const snap1 = collectFiles(sq(tmpDir));
    filesAfterRun1 = Object.fromEntries(
      Object.entries(snap1).filter(([k]) => k !== '.first-run')
    );

    run2 = runReset(tmpDir);
    const snap2 = collectFiles(sq(tmpDir));
    filesAfterRun2 = Object.fromEntries(
      Object.entries(snap2).filter(([k]) => k !== '.first-run')
    );
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('run 1 exits with code 0', () =>
    assert.equal(run1.status, 0, `run1 stderr: ${run1.stderr}`));

  it('run 2 exits with code 0', () =>
    assert.equal(run2.status, 0, `run2 stderr: ${run2.stderr}`));

  it('same set of files present after both runs', () =>
    assert.deepEqual(
      Object.keys(filesAfterRun1).sort(),
      Object.keys(filesAfterRun2).sort()
    ));

  it('file contents are identical after both runs', () => {
    for (const [rel, content] of Object.entries(filesAfterRun1)) {
      assert.equal(
        filesAfterRun2[rel],
        content,
        `Content differs on run 2 for: ${rel}`
      );
    }
  });

  it('.first-run exists after both runs (idempotent presence)', () =>
    assert.ok(existsSync(sq(tmpDir, '.first-run'))));
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 — Manifest missing → non-zero exit, team.md untouched
// ─────────────────────────────────────────────────────────────────────────────
describe('T3 — Manifest missing → abort with non-zero exit', () => {
  let tmpDir;
  let originalTeamContent;
  let result;

  before(() => {
    tmpDir = makeTmpDir();
    // Intentionally NO manifest — cli/ directory absent entirely
    seedTemplates(tmpDir);
    seedFrameworkCharters(tmpDir);
    originalTeamContent = '# Team\n\nMorpheus — real maintainer content that must survive\n';
    writeFile(sq(tmpDir, 'team.md'), originalTeamContent);

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with non-zero code when manifest is missing', () =>
    assert.notEqual(result.status, 0,
      'Expected non-zero exit when manifest absent, but got exit code 0'));

  it('team.md is NOT modified after aborted reset', () =>
    assert.equal(
      readFileSync(sq(tmpDir, 'team.md'), 'utf8'),
      originalTeamContent
    ));
});

// ─────────────────────────────────────────────────────────────────────────────
// T4 — Dynamic framework_exceptions: third exception (testbot) is preserved
// ─────────────────────────────────────────────────────────────────────────────
describe('T4 — Dynamic framework_exceptions: testbot preserved; no hardcoded names', () => {
  let tmpDir;
  let result;

  before(() => {
    tmpDir = makeTmpDir();
    const manifest = {
      ...REAL_MANIFEST,
      framework_exceptions: [
        ...REAL_MANIFEST.framework_exceptions,
        '.squad/agents/testbot/charter.md',
      ],
    };
    seedCustomManifest(tmpDir, manifest);
    seedTemplates(tmpDir);
    seedFrameworkCharters(tmpDir);
    writeFile(sq(tmpDir, 'team.md'),    '# Team\n');
    writeFile(sq(tmpDir, 'routing.md'), '# Routing\n');
    writeFile(sq(tmpDir, 'agents', 'morpheus', 'charter.md'), '# Morpheus charter');
    writeFile(sq(tmpDir, 'agents', 'testbot',  'charter.md'),
      '# Testbot charter\n\nFramework agent added dynamically.\n');

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with code 0', () =>
    assert.equal(result.status, 0, `stderr: ${result.stderr}`));

  it('agents/testbot/charter.md still EXISTS (preserved via dynamic exception)', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'testbot', 'charter.md'))));

  it('agents/morpheus/charter.md was removed (not in exceptions)', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'morpheus', 'charter.md')), false));

  it('agents/scribe/charter.md still EXISTS', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'scribe', 'charter.md'))));

  it('agents/ralph/charter.md still EXISTS', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'ralph', 'charter.md'))));
});

// ─────────────────────────────────────────────────────────────────────────────
// T5 — Scope safety: files outside .squad/ are never touched
// ─────────────────────────────────────────────────────────────────────────────
describe('T5 — Scope safety: .secops/environment.yaml is never modified', () => {
  let tmpDir;
  let result;
  const envContent = '# Sentinel workspace config\nworkspaceId: abc-123\ntenant: contoso\n';

  before(() => {
    tmpDir = makeTmpDir();
    seedManifest(tmpDir);
    seedTemplates(tmpDir);
    seedFrameworkCharters(tmpDir);
    writeFile(sq(tmpDir, 'team.md'),    '# Team\n');
    writeFile(sq(tmpDir, 'routing.md'), '# Routing\n');
    // File deliberately placed OUTSIDE .squad/ — must be untouched
    writeFile(join(tmpDir, '.secops', 'environment.yaml'), envContent);

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with code 0', () =>
    assert.equal(result.status, 0, `stderr: ${result.stderr}`));

  it('.secops/environment.yaml content is unchanged after reset', () =>
    assert.equal(
      readFileSync(join(tmpDir, '.secops', 'environment.yaml'), 'utf8'),
      envContent
    ));
});

// ─────────────────────────────────────────────────────────────────────────────
// T6 — Partial state: nearly-empty .squad/ → exit 0 (silently skips missing files)
// ─────────────────────────────────────────────────────────────────────────────
describe('T6 — Partial state: nearly-empty .squad/ succeeds without errors', () => {
  let tmpDir;
  let result;

  before(() => {
    tmpDir = makeTmpDir();
    seedManifest(tmpDir);
    seedTemplates(tmpDir);
    // Minimal: only team.md and routing.md — no agents, no casting, no runtime state
    writeFile(sq(tmpDir, 'team.md'),    '# Team\n');
    writeFile(sq(tmpDir, 'routing.md'), '# Routing\n');
    // No agents/, no casting/, no decisions.md, no skills/ — all absent

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with code 0 (missing optional files skipped silently)', () =>
    assert.equal(result.status, 0, `stderr: ${result.stderr}`));

  it('team.md was reset to skeleton', () =>
    assert.equal(readFileSync(sq(tmpDir, 'team.md'), 'utf8'), REAL_ROSTER));

  it('routing.md was reset to skeleton', () =>
    assert.equal(readFileSync(sq(tmpDir, 'routing.md'), 'utf8'), REAL_ROUTING));

  it('.first-run was created', () =>
    assert.ok(existsSync(sq(tmpDir, '.first-run'))));
});

// ─────────────────────────────────────────────────────────────────────────────
// T7 — Windows path normalization: backslash in framework_exceptions
// ─────────────────────────────────────────────────────────────────────────────
describe('T7 — Windows path normalization: backslash in framework_exceptions preserved', () => {
  let tmpDir;
  let result;

  before(() => {
    tmpDir = makeTmpDir();
    // Manifest with Windows-style backslash path for scribe; forward-slash for ralph
    const manifest = {
      ...REAL_MANIFEST,
      framework_exceptions: [
        '.squad\\agents\\scribe\\charter.md',  // Windows backslash separator
        '.squad/agents/ralph/charter.md',       // POSIX separator (unchanged)
      ],
    };
    seedCustomManifest(tmpDir, manifest);
    seedTemplates(tmpDir);
    seedFrameworkCharters(tmpDir);
    writeFile(sq(tmpDir, 'team.md'),    '# Team\n');
    writeFile(sq(tmpDir, 'routing.md'), '# Routing\n');
    writeFile(sq(tmpDir, 'agents', 'morpheus', 'charter.md'), '# Morpheus — should be removed');

    result = runReset(tmpDir);
  });

  after(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('exits with code 0', () =>
    assert.equal(result.status, 0, `stderr: ${result.stderr}`));

  it('scribe charter preserved despite backslash in manifest exception path', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'scribe', 'charter.md'))));

  it('ralph charter preserved (forward-slash reference still works)', () =>
    assert.ok(existsSync(sq(tmpDir, 'agents', 'ralph', 'charter.md'))));

  it('morpheus charter removed (not in exceptions)', () =>
    assert.equal(existsSync(sq(tmpDir, 'agents', 'morpheus', 'charter.md')), false));
});

// ─────────────────────────────────────────────────────────────────────────────
// T8 — update.js regression: classifyPath scoped-update guarantee not regressed
// ─────────────────────────────────────────────────────────────────────────────
describe('T8 — update.js regression: classifyPath personal_paths guard is intact', () => {
  const { classifyPath } = require('./commands/update.js');

  it('classifyPath(.squad/agents/morpheus/charter.md) returns "personal"', () =>
    assert.equal(
      classifyPath('.squad/agents/morpheus/charter.md', REAL_MANIFEST),
      'personal'
    ));

  it('classifyPath(.squad/agents/scribe/charter.md) returns "framework" (exception override)', () =>
    assert.equal(
      classifyPath('.squad/agents/scribe/charter.md', REAL_MANIFEST),
      'framework'
    ));

  it('classifyPath(.squad/team.md) returns "personal"', () =>
    assert.equal(
      classifyPath('.squad/team.md', REAL_MANIFEST),
      'personal'
    ));

  it('classifyPath(.squad/casting/registry.json) returns "personal"', () =>
    assert.equal(
      classifyPath('.squad/casting/registry.json', REAL_MANIFEST),
      'personal'
    ));
});
