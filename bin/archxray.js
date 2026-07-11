#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildGraph } = require('../src/extract');
const { snapshot } = require('../src/gitsnap');
const { diffGraphs } = require('../src/diff');
const { loadRules, findViolations, findNewCycles } = require('../src/rules');
const { plainDiagram, diffDiagram } = require('../src/puml');
const { diagramUrl, fetchSvg, encodeDiagram, DEFAULT_SERVER } = require('../src/render');
const { narrate } = require('../src/narrate');
const { buildComment, buildReport, verdict, changeBullets } = require('../src/report');
const { buildTimelapse } = require('../src/timelapse');

const USAGE = `
🩻 ArchXray — see what a change does to your architecture

Usage:
  archxray diff       --repo <path> --base <ref> --head <ref|WORKTREE> [options]
  archxray timelapse  --repo <path> [--count 15] [options]

Options:
  --repo <path>          target git repository            (default: .)
  --base <ref>           baseline ref                     (default: origin/main)
  --head <ref>           ref to compare, or WORKTREE      (default: HEAD)
  --out <dir>            output directory                 (default: ./archxray-out)
  --server <url>         PlantUML server                  (default: ${DEFAULT_SERVER})
  --ai                   add an AI narration via the local \`claude\` CLI
  --fail-on-violation    exit code 2 when rules are broken or cycles appear (for CI)
  --count <n>            timelapse: number of commits     (default: 15)
`;

function parseArgs(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[key] = argv[++i];
      else opts[key] = true;
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

const shortRef = (r) => String(r).replace(/^origin\//, '');

async function cmdDiff(o) {
  const repo = path.resolve(o.repo || '.');
  const base = o.base || 'origin/main';
  const head = o.head || 'HEAD';
  const server = o.server || DEFAULT_SERVER;
  const outDir = path.resolve(o.out || 'archxray-out');

  console.log(`🩻 ArchXray: ${path.basename(repo)}  ${base} → ${head}`);

  const baseFiles = snapshot(repo, base);
  const headFiles = snapshot(repo, head);
  const baseGraph = buildGraph(baseFiles);
  const headGraph = buildGraph(headFiles);
  const diff = diffGraphs(baseGraph, headGraph);

  if (!diff.changed) {
    console.log('   architecture untouched — staying quiet. (no comment.md written)');
    fs.rmSync(path.join(outDir, 'comment.md'), { force: true });
    return 0;
  }

  const rules = loadRules(headFiles, baseFiles);
  const violations = findViolations(rules, diff.addedEdges);
  const cycles = findNewCycles(diff.addedEdges, headGraph);

  const repoName = path.basename(repo);
  const diffPuml = diffDiagram(
    diff,
    violations,
    `Architecture impact — ${repoName} (${shortRef(base)} → ${shortRef(head)})`
  );
  const beforePuml = plainDiagram(baseGraph, `Before — ${shortRef(base)}`);
  const afterPuml = plainDiagram(headGraph, `After — ${shortRef(head)}`);

  const pngUrl = diagramUrl(server, 'png', diffPuml);
  const editUrl = `${server.replace(/\/$/, '')}/uml/${encodeDiagram(diffPuml)}`;

  let narration = null;
  if (o.ai) {
    process.stdout.write('   🤖 asking Claude for an architectural read... ');
    narration = narrate({
      addedModules: diff.addedNodes,
      removedModules: diff.removedNodes,
      addedDependencies: diff.addedEdges.map((e) => `${e.from} -> ${e.to}`),
      removedDependencies: diff.removedEdges.map((e) => `${e.from} -> ${e.to}`),
      forbiddenDependenciesIntroduced: violations.map((v) => ({
        dependency: `${v.edge.from} -> ${v.edge.to}`,
        reason: v.rule.reason,
      })),
      newCycles: cycles.map((c) => c.join(' -> ')),
    });
    console.log(narration ? 'done' : 'unavailable (is the claude CLI installed?)');
  }

  fs.mkdirSync(outDir, { recursive: true });

  let svgs = null;
  try {
    const [d, b, a] = await Promise.all([
      fetchSvg(diagramUrl(server, 'svg', diffPuml)),
      fetchSvg(diagramUrl(server, 'svg', beforePuml)),
      fetchSvg(diagramUrl(server, 'svg', afterPuml)),
    ]);
    svgs = { diff: d, before: b, after: a };
    fs.writeFileSync(path.join(outDir, 'diff.svg'), d);
  } catch (err) {
    console.warn(`   ⚠️ render server unreachable (${err.message.split('\n')[0]}) — .puml sources written instead`);
  }

  const ctx = { repoName, base, head, diff, violations, cycles, narration, pngUrl, editUrl, svgs };
  fs.writeFileSync(path.join(outDir, 'comment.md'), buildComment(ctx));
  fs.writeFileSync(path.join(outDir, 'report.html'), buildReport(ctx));
  fs.writeFileSync(path.join(outDir, 'diff.puml'), diffPuml);
  fs.writeFileSync(path.join(outDir, 'before.puml'), beforePuml);
  fs.writeFileSync(path.join(outDir, 'after.puml'), afterPuml);
  fs.writeFileSync(
    path.join(outDir, 'diff.json'),
    JSON.stringify({ base, head, diff, violations, cycles }, null, 2)
  );

  const v = verdict(violations, cycles);
  console.log('');
  for (const line of changeBullets(diff, violations, cycles)) console.log('  ' + line.replace(/^- /, ''));
  console.log(`\n   ${v.emoji} ${v.text}`);
  console.log(`   📄 ${path.join(outDir, 'report.html')}`);
  console.log(`   💬 ${path.join(outDir, 'comment.md')}  (ready for: gh pr comment N --body-file ...)`);

  if (o['fail-on-violation'] && (violations.length || cycles.length)) return 2;
  return 0;
}

async function cmdTimelapse(o) {
  const repo = path.resolve(o.repo || '.');
  const server = o.server || DEFAULT_SERVER;
  const outDir = path.resolve(o.out || 'archxray-out');
  const count = parseInt(o.count || '15', 10);

  console.log(`🎞️ ArchXray time-lapse: ${path.basename(repo)} (last ${count} commits)`);
  const html = await buildTimelapse({ repo, count, server });
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'timelapse.html');
  fs.writeFileSync(file, html);
  console.log(`\n   🎬 ${file}`);
  return 0;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = parseArgs(rest);
  if (cmd === 'diff') return cmdDiff(opts);
  if (cmd === 'timelapse') return cmdTimelapse(opts);
  console.log(USAGE.trim());
  return cmd ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`archxray: ${err.message}`);
    process.exitCode = 1;
  });
