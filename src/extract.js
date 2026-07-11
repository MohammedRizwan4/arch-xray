'use strict';
// Builds a module-level dependency graph from source files.
// A "module" is a top-level directory under the source root (src/ if present, else repo root).

const path = require('path');

const SOURCE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py']);
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', '.git',
  '__pycache__', '__tests__', 'vendor', 'venv', '.venv', '.idea', '.vscode',
]);

function isSourceFile(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (!SOURCE_EXT.has(path.posix.extname(p))) return false;
  const parts = p.split('/');
  if (parts.some((seg) => IGNORE_DIRS.has(seg))) return false;
  if (/\.(test|spec)\.[a-z]+$/i.test(parts[parts.length - 1])) return false;
  return true;
}

const JS_IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"\n]+)['"]/g,             // import ... from 'x' / export ... from 'x'
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g, // dynamic import('x')
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"\n]+)['"]/g,           // side-effect import 'x'
];

function extractImports(filePath, content) {
  const specs = [];
  if (path.posix.extname(filePath) === '.py') {
    for (const m of content.matchAll(/^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm)) specs.push(m[1]);
    for (const m of content.matchAll(/^[ \t]*import[ \t]+(.+)$/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().split(/\s+/)[0];
        if (/^[\w.]+$/.test(name)) specs.push(name);
      }
    }
  } else {
    for (const re of JS_IMPORT_PATTERNS) {
      for (const m of content.matchAll(re)) specs.push(m[1]);
    }
  }
  return specs;
}

function resolveJs(fromFile, spec, { root, moduleOfTarget }) {
  let target;
  if (spec.startsWith('.')) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
    target = root + spec.slice(2); // common src-root aliases
  } else {
    return null; // external package
  }
  return moduleOfTarget(target);
}

function resolvePython(fromFile, spec, { root, nodes }) {
  if (spec.startsWith('.')) {
    const [, dots, rest] = spec.match(/^(\.+)(.*)$/);
    const dir = path.posix.dirname(fromFile);
    let relDir = dir === '.' ? '' : dir;
    if (root && relDir.startsWith(root)) relDir = relDir.slice(root.length);
    let parts = relDir ? relDir.split('/') : [];
    parts = parts.slice(0, Math.max(0, parts.length - (dots.length - 1)));
    if (rest) parts = parts.concat(rest.split('.'));
    return parts[0] || null;
  }
  const first = spec.split('.')[0];
  return nodes.has(first) ? first : null;
}

function buildGraph(filesMap) {
  const files = new Map();
  for (const [rel, content] of filesMap) {
    const p = rel.replace(/\\/g, '/');
    if (isSourceFile(p)) files.set(p, content);
  }

  const hasSrc = [...files.keys()].some((p) => p.startsWith('src/'));
  const root = hasSrc ? 'src/' : '';

  const moduleOfFile = (p) => {
    if (root && !p.startsWith(root)) return null;
    const rest = p.slice(root.length);
    const i = rest.indexOf('/');
    return i === -1 ? null : rest.slice(0, i); // root-level files are wiring, not modules
  };
  const moduleOfTarget = (t) => {
    if (root && !t.startsWith(root)) return null;
    const seg = t.slice(root.length).split('/')[0];
    return seg || null;
  };

  const nodes = new Set();
  for (const p of files.keys()) {
    const m = moduleOfFile(p);
    if (m) nodes.add(m);
  }

  const edgeCounts = new Map();
  for (const [p, content] of files) {
    const from = moduleOfFile(p);
    if (!from) continue;
    for (const spec of extractImports(p, content)) {
      const isPy = path.posix.extname(p) === '.py';
      const to = isPy
        ? resolvePython(p, spec, { root, nodes })
        : resolveJs(p, spec, { root, moduleOfTarget });
      if (to && to !== from && nodes.has(to)) {
        const k = `${from}\u0000${to}`;
        edgeCounts.set(k, (edgeCounts.get(k) || 0) + 1);
      }
    }
  }

  const edges = [...edgeCounts.entries()]
    .map(([k, count]) => {
      const [from, to] = k.split('\u0000');
      return { from, to, count };
    })
    .sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));

  return { nodes: [...nodes].sort(), edges };
}

module.exports = { buildGraph, isSourceFile, SOURCE_EXT, IGNORE_DIRS };
