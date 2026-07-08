"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// ANSI color helpers — no dependencies
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

const REMOTE_NAME = "starter-kit";
const REMOTE_URL = "https://github.com/x3nc0n/secops-squad-starter-kit.git";
const MANIFEST_PATH = path.join(__dirname, "..", "framework-manifest.json");

// ─────────────────────────────────────────────────────────────────────────────
// Pure logic — no git/network side-effects; fully unit-testable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile a single glob pattern into a RegExp.
 * Supports **‌/ (zero-or-more dir segments), ** (any chars), * (non-slash), ? (single non-slash).
 */
function globToRegex(pattern) {
  const regexStr =
    "^" +
    pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex-special chars
      .replace(/\*\*\//g, "\x01")            // **/ → placeholder A
      .replace(/\*\*/g, "\x02")              // ** → placeholder B
      .replace(/\*/g, "[^/]*")               // * → non-slash segment
      .replace(/\?/g, "[^/]")                // ? → single non-slash char
      .replace(/\x01/g, "(?:.+/)?")          // A → optional dir prefix
      .replace(/\x02/g, ".*")                // B → any chars (incl. /)
    + "$";
  return new RegExp(regexStr);
}

/**
 * Test whether a normalized file path matches a glob pattern.
 * Normalizes backslashes to forward slashes before matching.
 */
function matchesGlob(filePath, pattern) {
  return globToRegex(pattern).test(filePath.replace(/\\/g, "/"));
}

/**
 * Classify a path as 'personal' | 'framework' | 'unknown' against a manifest.
 * personal_paths is the guard and WINS: checked before framework_paths.
 */
function classifyPath(filePath, manifest) {
  for (const pattern of manifest.personal_paths) {
    if (matchesGlob(filePath, pattern)) return "personal";
  }
  for (const pattern of manifest.framework_paths) {
    if (matchesGlob(filePath, pattern)) return "framework";
  }
  return "unknown";
}

/**
 * Returns true if the path is framework-owned (not personal, not unknown).
 */
function isFramework(filePath, manifest) {
  return classifyPath(filePath, manifest) === "framework";
}

/**
 * Plan a scoped update given upstream file list, local tracked file list, and manifest.
 * Returns { toSync, toDelete, skippedPersonal } — all plain arrays, no side-effects.
 *
 * - toSync:          upstream framework files to checkout
 * - toDelete:        local framework files absent upstream (deletion candidates)
 * - skippedPersonal: upstream files skipped because they matched personal_paths
 */
function planUpdate(upstreamFiles, localFiles, manifest) {
  const toSync = [];
  const skippedPersonal = [];

  for (const file of upstreamFiles) {
    const cls = classifyPath(file, manifest);
    if (cls === "framework") toSync.push(file);
    else if (cls === "personal") skippedPersonal.push(file);
    // unknown → silently ignored
  }

  const upstreamSet = new Set(upstreamFiles);
  const toDelete = localFiles.filter(
    (f) => !upstreamSet.has(f) && classifyPath(f, manifest) === "framework"
  );

  return { toSync, toDelete, skippedPersonal };
}

/**
 * Compare local and upstream package.json objects; return dep names present
 * in the local copy but absent from the upstream version.
 */
function diffPackageJsonDeps(localPkg, upstreamPkg) {
  const upstreamDeps = {
    ...(upstreamPkg.dependencies || {}),
    ...(upstreamPkg.devDependencies || {}),
  };
  const localAll = {
    ...(localPkg.dependencies || {}),
    ...(localPkg.devDependencies || {}),
  };
  return Object.keys(localAll).filter((k) => !(k in upstreamDeps));
}

// ─────────────────────────────────────────────────────────────────────────────
// Git / filesystem wrappers — thin side-effectful layer
// ─────────────────────────────────────────────────────────────────────────────

function exec(cmd) {
  return execSync(cmd, { encoding: "utf8", timeout: 60000 }).trim();
}

function isGitRepo() {
  try { exec("git rev-parse --is-inside-work-tree"); return true; }
  catch { return false; }
}

function hasUncommittedChanges() {
  try { return exec("git status --porcelain").length > 0; }
  catch { return false; }
}

function remoteExists() {
  try { return exec("git remote").split("\n").includes(REMOTE_NAME); }
  catch { return false; }
}

function addRemote() {
  exec(`git remote add ${REMOTE_NAME} ${REMOTE_URL}`);
}

function fetchRemote() {
  exec(`git fetch ${REMOTE_NAME}`);
}

function getUpstreamFiles() {
  const out = exec(`git ls-tree -r --name-only ${REMOTE_NAME}/main`);
  return out ? out.split("\n").filter(Boolean) : [];
}

function getLocalTrackedFiles() {
  const out = exec("git ls-files");
  return out ? out.split("\n").filter(Boolean) : [];
}

function getUpstreamShortSha() {
  return exec(`git rev-parse --short ${REMOTE_NAME}/main`);
}

/** Checkout a list of paths from upstream in batches of 50. */
function checkoutFiles(filePaths) {
  const BATCH = 50;
  for (let i = 0; i < filePaths.length; i += BATCH) {
    const quoted = filePaths.slice(i, i + BATCH).map((f) => `"${f}"`).join(" ");
    exec(`git checkout ${REMOTE_NAME}/main -- ${quoted}`);
  }
}

/** Remove a file from the index and working tree. */
function deleteFile(filePath) {
  exec(`git rm --force -- "${filePath}"`);
}

/** Returns true when there are staged changes ready to commit. */
function hasStagedChanges() {
  try { execSync("git diff --cached --quiet", { timeout: 5000 }); return false; }
  catch { return true; }
}

function commitUpdate(sha, stats) {
  const title = `secops-squad update: sync framework from starter-kit@${sha}`;
  const body = `Added/updated: ${stats.synced}, removed: ${stats.deleted}, skipped (personal): ${stats.skipped}`;
  exec(`git commit -m "${title}" -m "${body}"`);
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch (err) {
    throw new Error(`Failed to load framework manifest at ${MANIFEST_PATH}: ${err.message}`);
  }
}

function promptUser(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

function printBanner() {
  console.log(`
${c.cyan}${c.bold}  +------------------------------------------+
  |                                          |
  |   secops-squad update                    |
  |   Scoped framework sync                  |
  |                                          |
  +------------------------------------------+${c.reset}
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

async function run(args = []) {
  printBanner();

  const autoConfirm = args.includes("--yes") || args.includes("-y");

  // ── Pre-flight ──────────────────────────────────────────────────────────────
  if (!isGitRepo()) {
    console.error(`${c.red}[ERR] Not a git repository. Run this from your secops-squad project root.${c.reset}`);
    process.exit(1);
  }

  if (hasUncommittedChanges()) {
    console.error(`${c.yellow}[WARN] You have uncommitted changes.${c.reset}`);
    console.error(`${c.dim}  Commit or stash them first:${c.reset}`);
    console.error(`${c.dim}    git add -A && git commit -m "save work before update"${c.reset}\n`);
    process.exit(1);
  }

  // ── Load manifest ───────────────────────────────────────────────────────────
  let manifest;
  try {
    manifest = loadManifest();
  } catch (err) {
    console.error(`${c.red}[ERR] ${err.message}${c.reset}`);
    process.exit(1);
  }

  // ── Ensure remote & fetch ───────────────────────────────────────────────────
  if (!remoteExists()) {
    console.log(`${c.dim}  Adding ${REMOTE_NAME} remote -> ${REMOTE_URL}${c.reset}`);
    try {
      addRemote();
      console.log(`${c.green}  [OK] Remote added${c.reset}`);
    } catch (err) {
      console.error(`${c.red}[ERR] Failed to add remote: ${err.message}${c.reset}`);
      process.exit(1);
    }
  } else {
    console.log(`${c.dim}  Remote ${REMOTE_NAME} already configured${c.reset}`);
  }

  console.log(`${c.dim}  Fetching from ${REMOTE_NAME}...${c.reset}`);
  try {
    fetchRemote();
    console.log(`${c.green}  [OK] Fetched${c.reset}`);
  } catch (err) {
    console.error(`${c.red}[ERR] Failed to fetch from ${REMOTE_NAME}. Check your network connection.${c.reset}`);
    console.error(`${c.dim}  ${err.message}${c.reset}`);
    process.exit(1);
  }

  // ── Enumerate files & plan ──────────────────────────────────────────────────
  let upstreamFiles, localFiles, sha;
  try {
    upstreamFiles = getUpstreamFiles();
    localFiles    = getLocalTrackedFiles();
    sha           = getUpstreamShortSha();
  } catch (err) {
    console.error(`${c.red}[ERR] Failed to enumerate files: ${err.message}${c.reset}`);
    process.exit(1);
  }

  const { toSync, toDelete, skippedPersonal } = planUpdate(upstreamFiles, localFiles, manifest);

  if (toSync.length === 0 && toDelete.length === 0) {
    console.log(`\n${c.green}${c.bold}[OK] Already up to date.${c.reset} Framework files match starter-kit@${sha}.\n`);
    return;
  }

  // ── package.json dep warning ────────────────────────────────────────────────
  if (toSync.includes("package.json")) {
    try {
      const localPkgPath = path.join(process.cwd(), "package.json");
      if (fs.existsSync(localPkgPath)) {
        const upstreamPkgRaw = exec(`git show ${REMOTE_NAME}/main:package.json`);
        const localPkg    = JSON.parse(fs.readFileSync(localPkgPath, "utf8"));
        const upstreamPkg = JSON.parse(upstreamPkgRaw);
        const extraDeps   = diffPackageJsonDeps(localPkg, upstreamPkg);
        if (extraDeps.length > 0) {
          console.log(`\n${c.yellow}${c.bold}[WARN] package.json will be overwritten.${c.reset}`);
          console.log(`${c.yellow}  The following locally-added dependencies will be removed:${c.reset}`);
          for (const dep of extraDeps) console.log(`${c.yellow}    - ${dep}${c.reset}`);
          console.log(`${c.dim}  Re-add them after the update: npm install <package> --save${c.reset}\n`);
        }
      }
    } catch {
      // Non-fatal — skip warning if either package.json is unreadable
    }
  }

  // ── Sync framework files ────────────────────────────────────────────────────
  console.log(`\n${c.cyan}  Syncing ${toSync.length} framework file(s)...${c.reset}`);
  try {
    if (toSync.length > 0) checkoutFiles(toSync);
  } catch (err) {
    console.error(`${c.red}[ERR] Failed to sync files: ${err.message}${c.reset}`);
    process.exit(1);
  }

  // ── Handle deletions ────────────────────────────────────────────────────────
  let deletedCount = 0;
  if (toDelete.length > 0) {
    console.log(`\n${c.yellow}  ${toDelete.length} framework file(s) removed upstream:${c.reset}`);
    for (const f of toDelete) console.log(`${c.dim}    - ${f}${c.reset}`);

    let confirmDelete = autoConfirm;
    if (!confirmDelete) {
      if (process.stdin.isTTY) {
        const answer = await promptUser(`\n${c.yellow}  Delete these files locally? [y/N]: ${c.reset}`);
        confirmDelete = answer === "y" || answer === "yes";
      } else {
        console.log(`${c.dim}  Non-interactive mode — skipping deletion. Re-run with --yes to auto-confirm.${c.reset}`);
      }
    }

    if (confirmDelete) {
      for (const f of toDelete) {
        try { deleteFile(f); deletedCount++; }
        catch (err) { console.error(`${c.yellow}  [WARN] Could not remove ${f}: ${err.message}${c.reset}`); }
      }
      console.log(`${c.green}  [OK] Removed ${deletedCount} file(s)${c.reset}`);
    }
  }

  // ── Commit ───────────────────────────────────────────────────────────────────
  if (!hasStagedChanges()) {
    console.log(`\n${c.green}${c.bold}[OK] Already up to date.${c.reset} Framework files match starter-kit@${sha}.\n`);
    return;
  }

  const stats = { synced: toSync.length, deleted: deletedCount, skipped: skippedPersonal.length };
  try {
    commitUpdate(sha, stats);
  } catch (err) {
    console.error(`${c.red}[ERR] Failed to commit: ${err.message}${c.reset}`);
    process.exit(1);
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log(`\n${c.green}${c.bold}[OK] Framework sync complete!${c.reset}`);
  console.log(`${c.dim}  Synced from starter-kit@${sha}${c.reset}`);
  console.log(
    `  ${c.green}${stats.synced} added/updated${c.reset}` +
    `  ${c.yellow}${stats.deleted} removed${c.reset}` +
    `  ${c.dim}${stats.skipped} personal paths skipped${c.reset}`
  );
  console.log(
    `\n${c.cyan}  Only framework files were synced per the manifest.` +
    ` Your personal .secops/ and .squad/ files were never touched.${c.reset}`
  );
  if (toSync.includes("package.json")) {
    console.log(`\n${c.yellow}  [WARN] package.json was updated. Run ${c.bold}npm install${c.reset}${c.yellow} to reconcile the lockfile.${c.reset}`);
  }
  console.log(`\n${c.dim}  Next: run ${c.reset}${c.cyan}secops-squad doctor${c.reset}${c.dim} to verify your environment.${c.reset}\n`);
}

module.exports = {
  run,
  // Pure-logic exports — unit-testable without git/network (for Carver)
  globToRegex,
  matchesGlob,
  classifyPath,
  isFramework,
  planUpdate,
  diffPackageJsonDeps,
};
