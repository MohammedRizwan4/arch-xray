'use strict';
// Snapshots a git ref into an in-memory file map without touching the working tree.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SOURCE_EXT, IGNORE_DIRS } = require('./extract');

const EXTRA_FILES = new Set(['archrules.json']);

function wantFile(rel) {
  const p = rel.replace(/\\/g, '/');
  const parts = p.split('/');
  if (parts.some((seg) => IGNORE_DIRS.has(seg))) return false;
  return SOURCE_EXT.has(path.posix.extname(p)) || EXTRA_FILES.has(parts[parts.length - 1]);
}

function readTree(dir, base = dir, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && entry.name !== '.git') readTree(abs, base, out);
    } else if (entry.isFile()) {
      const rel = path.relative(base, abs).replace(/\\/g, '/');
      if (wantFile(rel)) out.set(rel, fs.readFileSync(abs, 'utf8'));
    }
  }
  return out;
}

// ref 'WORKTREE' reads the working directory as-is (uncommitted changes included).
function snapshot(repo, ref) {
  if (ref === 'WORKTREE') return readTree(repo);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archxray-'));
  try {
    const tarPath = path.join(tmp, 'snap.tar');
    execFileSync('git', ['-C', repo, 'archive', '--format=tar', '-o', tarPath, ref]);
    const outDir = path.join(tmp, 'tree');
    fs.mkdirSync(outDir);
    // relative paths: Windows tar reads "C:" in absolute paths as a remote host
    execFileSync('tar', ['-xf', 'snap.tar', '-C', 'tree'], { cwd: tmp });
    return readTree(outDir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

// Source files touched between base and head (three-dot: changes on head's side
// only, like a PR view). head 'WORKTREE' diffs the working tree against base.
function changedFiles(repo, base, head) {
  let out;
  if (head === 'WORKTREE') {
    out = git(repo, ['diff', '--name-only', base]);
  } else {
    try {
      out = git(repo, ['diff', '--name-only', `${base}...${head}`]);
    } catch {
      out = git(repo, ['diff', '--name-only', base, head]);
    }
  }
  return out.split('\n').filter((p) => p && wantFile(p));
}

module.exports = { snapshot, readTree, git, changedFiles };
