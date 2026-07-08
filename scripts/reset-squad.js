#!/usr/bin/env node
// reset-squad.js — strips maintainer dev cast for fresh consumer install
// Uses Node.js built-ins ONLY (fs, path, os). No npm deps required.
// Runs before `npm install`, so no node_modules are available.

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[reset-squad]';

function log(action, filePath) {
  console.log(`${LOG_PREFIX} ${action}: ${filePath}`);
}

function warn(msg) {
  console.warn(`${LOG_PREFIX} WARNING: ${msg}`);
}

function squadPath(targetDir, ...parts) {
  return path.resolve(targetDir, '.squad', ...parts);
}

function assertUnderSquad(targetDir, resolvedPath) {
  const squadRoot = path.resolve(targetDir, '.squad') + path.sep;
  const normalized = resolvedPath.endsWith(path.sep)
    ? resolvedPath
    : resolvedPath + path.sep;
  if (!normalized.startsWith(squadRoot)) {
    throw new Error(`SAFETY: path outside .squad/: ${resolvedPath}`);
  }
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function removeFileIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
    log('removed', filePath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

function removeDirIfExists(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    log('removed dir', dirPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

function wipeGlob(targetDir, dirPart, fileName) {
  // Remove .squad/{dirPart}/*/fileName for all subdirs
  const parent = squadPath(targetDir, dirPart);
  if (!fs.existsSync(parent)) return;
  for (const entry of fs.readdirSync(parent)) {
    const candidate = path.join(parent, entry, fileName);
    assertUnderSquad(targetDir, candidate);
    removeFileIfExists(candidate);
  }
}

function wipeDirContents(targetDir, ...parts) {
  // Remove all files/dirs INSIDE a dir but keep the dir itself
  const dir = squadPath(targetDir, ...parts);
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    assertUnderSquad(targetDir, full);
    fs.rmSync(full, { recursive: true, force: true });
    log('removed', full);
  }
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').toLowerCase();
}

// --------------------------------------------------------------------------
// MAIN
// --------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node scripts/reset-squad.js <target-dir>');
  console.log('  target-dir: the install directory to reset (INSTALL_DIR)');
  process.exit(0);
}

const targetDir = path.resolve(args[0]);

// Step 1 — Load manifest
const manifestPath = path.join(targetDir, 'cli', 'framework-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`${LOG_PREFIX} ERROR: manifest not found: ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`${LOG_PREFIX} ERROR: invalid JSON in manifest: ${e.message}`);
  process.exit(1);
}

// Build preserve set from framework_exceptions
let frameworkExceptions = manifest.framework_exceptions;
if (!Array.isArray(frameworkExceptions)) {
  warn('framework_exceptions missing or not array — treating as empty');
  frameworkExceptions = [];
}
const preserveSet = new Set(frameworkExceptions.map(p => normalizePath(p)));

// Track summary counters
let chartersRemoved = 0;
let castingReset = 0;

// Step 2 — Reset team.md and routing.md
const rosterTemplate = squadPath(targetDir, 'templates', 'roster.md');
const teamMd = squadPath(targetDir, 'team.md');
assertUnderSquad(targetDir, teamMd);
copyFile(rosterTemplate, teamMd);
log('reset', teamMd);

const routingTemplate = squadPath(targetDir, 'templates', 'routing.md');
const routingMd = squadPath(targetDir, 'routing.md');
assertUnderSquad(targetDir, routingMd);
copyFile(routingTemplate, routingMd);
log('reset', routingMd);

// Step 3 — Reset agent charters
const agentsDir = squadPath(targetDir, 'agents');
if (fs.existsSync(agentsDir)) {
  for (const agentName of fs.readdirSync(agentsDir)) {
    const agentDir = path.join(agentsDir, agentName);
    if (!fs.statSync(agentDir).isDirectory()) continue;

    const charterPath = path.join(agentDir, 'charter.md');
    const relativeNorm = normalizePath(
      path.relative(targetDir, charterPath).replace(/\\/g, '/')
    );

    assertUnderSquad(targetDir, charterPath);

    if (preserveSet.has(relativeNorm)) {
      log('preserved (framework_exception)', charterPath);
      continue;
    }

    removeFileIfExists(charterPath);
    if (fs.existsSync(charterPath)) continue; // just in case
    chartersRemoved++;

    // Remove empty agent dir — except scribe/ralph (always preserved by name fallback)
    const lowerName = agentName.toLowerCase();
    if (lowerName === 'scribe' || lowerName === 'ralph') continue;

    const remaining = fs.readdirSync(agentDir).filter(f => f !== '.gitkeep');
    if (remaining.length === 0) {
      assertUnderSquad(targetDir, agentDir);
      removeDirIfExists(agentDir);
    }
  }
}

// Step 4 — Reset casting state
const castingFiles = [
  { template: 'casting-registry.json', dest: path.join('casting', 'registry.json') },
  { template: 'casting-history.json',  dest: path.join('casting', 'history.json') },
  { template: 'casting-policy.json',   dest: path.join('casting', 'policy.json') },
];

for (const { template, dest } of castingFiles) {
  const templatePath = squadPath(targetDir, 'templates', template);
  const destPath = squadPath(targetDir, dest);
  assertUnderSquad(targetDir, destPath);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, destPath);
    log('reset casting', destPath);
  } else {
    warn(`template missing: ${templatePath} — writing {} fallback`);
    fs.writeFileSync(destPath, '{}', 'utf8');
    log('fallback casting', destPath);
  }
  castingReset++;
}

// Step 5 — Wipe runtime personal state
// decisions.md and decisions-archive.md
removeFileIfExists(squadPath(targetDir, 'decisions.md'));
removeFileIfExists(squadPath(targetDir, 'decisions-archive.md'));

// decisions/inbox/* (keep dir)
wipeDirContents(targetDir, 'decisions', 'inbox');
// decisions/decisions.md
const decisionsDotMd = squadPath(targetDir, 'decisions', 'decisions.md');
assertUnderSquad(targetDir, decisionsDotMd);
removeFileIfExists(decisionsDotMd);

// log/ and orchestration-log/ (entire dirs)
removeDirIfExists(squadPath(targetDir, 'log'));
removeDirIfExists(squadPath(targetDir, 'orchestration-log'));

// identity/now.md and identity/wisdom.md
removeFileIfExists(squadPath(targetDir, 'identity', 'now.md'));
removeFileIfExists(squadPath(targetDir, 'identity', 'wisdom.md'));

// sessions/ and .scratch/ (entire dirs)
removeDirIfExists(squadPath(targetDir, 'sessions'));
removeDirIfExists(squadPath(targetDir, '.scratch'));

// agents/*/history.md and agents/*/history-archive.md
wipeGlob(targetDir, 'agents', 'history.md');
wipeGlob(targetDir, 'agents', 'history-archive.md');

// skills/** (entire dir contents, keep dir)
wipeDirContents(targetDir, 'skills');

// Step 6 — Create .first-run marker
const firstRunPath = squadPath(targetDir, '.first-run');
assertUnderSquad(targetDir, firstRunPath);
fs.writeFileSync(firstRunPath, new Date().toISOString() + '\n', 'utf8');
log('created', firstRunPath);

// Step 7 — Summary
console.log(
  `${LOG_PREFIX} Squad cast reset complete: team.md ← skeleton, routing.md ← skeleton, ` +
  `${chartersRemoved} charter(s) removed, ${castingReset} casting file(s) reset, ` +
  `runtime state wiped, .first-run created.`
);
