#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildGraph, moduleOfPath } = require('../src/extract');
const { snapshot, changedFiles } = require('../src/gitsnap');
const { diffGraphs, computeHeat } = require('../src/diff');
const { loadRules, findViolations, findNewCycles } = require('../src/rules');
const { mergeScene, layoutScene } = require('../src/layout');
const { buildSvg } = require('../src/svg');
const { DEFAULT_SERVER } = require('../src/render');
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
  --image-url <url>      URL of diff.svg used in comment.md (default: ./diff.svg)
  --report-url <url>     URL of report.html used in comment.md (default: ./report.html)
  --ai                   add an AI narration via the local \`claude\` CLI
  --fail-on-violation    exit code 2 when rules are broken or cycles appear (for CI)
  --server <url>         timelapse: PlantUML server       (default: ${DEFAULT_SERVER})
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

  // heat: files touched per module (best effort — needs git refs)
  const changedByModule = new Map();
  try {
    for (const f of changedFiles(repo, base, head)) {
      const m = moduleOfPath(headGraph.root ?? baseGraph.root, f);
      if (m) changedByModule.set(m, (changedByModule.get(m) || 0) + 1);
    }
  } catch { /* heat degrades gracefully without git diff */ }
  const heat = computeHeat(diff, changedByModule);

  const repoName = path.basename(repo);
  const title = `Architecture impact — ${repoName} (${shortRef(base)} → ${shortRef(head)})`;
  const layout = await layoutScene(mergeScene(diff, violations, cycles, heat));
  const svg = buildSvg(layout, { title });

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

  const ctx = {
    repoName, base, head, diff, violations, cycles, narration, layout,
    imageUrl: o['image-url'], reportUrl: o['report-url'],
  };
  fs.writeFileSync(path.join(outDir, 'diff.svg'), svg);
  fs.writeFileSync(path.join(outDir, 'comment.md'), buildComment(ctx));
  fs.writeFileSync(path.join(outDir, 'report.html'), buildReport(ctx));
  fs.writeFileSync(
    path.join(outDir, 'diff.json'),
    JSON.stringify({ base, head, diff, violations, cycles, heat: Object.fromEntries(heat) }, null, 2)
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
