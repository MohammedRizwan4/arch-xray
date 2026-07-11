'use strict';
// Builds the PR comment (markdown) and the self-contained interactive report.
// The report inlines Cytoscape.js and uses the precomputed ELK positions
// (preset layout) so it matches the static SVG exactly.

const fs = require('fs');
const path = require('path');
const { heatColor, edgeWidth, COLORS } = require('./svg');

const COMMENT_MARKER = '<!-- archxray -->';

function plural(n, singular, pluralForm) {
  return `${n} ${n === 1 ? singular : pluralForm || singular + 's'}`;
}

function verdict(violations, cycles) {
  if (violations.length || cycles.length) {
    const parts = [];
    if (violations.length)
      parts.push(plural(violations.length, 'forbidden dependency', 'forbidden dependencies'));
    if (cycles.length) parts.push(plural(cycles.length, 'new dependency cycle', 'new dependency cycles'));
    return { emoji: '🚫', text: `${parts.join(', ')} — this PR needs an architecture review`, bad: true };
  }
  return { emoji: '✅', text: 'The structure changed, but no architecture rules were broken', bad: false };
}

function changeBullets(diff, violations, cycles) {
  const violByKey = new Map(violations.map((v) => [`${v.edge.from}->${v.edge.to}`, v]));
  const lines = [];
  for (const n of diff.addedNodes) lines.push(`- ➕ new module \`${n}\``);
  for (const e of diff.addedEdges) {
    const v = violByKey.get(`${e.from}->${e.to}`);
    if (v) {
      lines.push(
        `- 🚫 new dependency \`${e.from} → ${e.to}\` — **forbidden**${v.rule.reason ? `: ${v.rule.reason}` : ''}`
      );
    } else {
      lines.push(`- ➕ new dependency \`${e.from} → ${e.to}\``);
    }
  }
  for (const c of cycles) lines.push(`- 🔄 new dependency cycle: \`${c.join(' → ')}\``);
  for (const e of diff.strengthenedEdges || [])
    lines.push(`- 📈 dependency \`${e.from} → ${e.to}\` got much heavier: ${e.baseCount} → ${e.count} imports`);
  for (const n of diff.removedNodes) lines.push(`- ➖ removed module \`${n}\``);
  for (const e of diff.removedEdges) lines.push(`- ➖ removed dependency \`${e.from} → ${e.to}\``);
  return lines;
}

function buildComment(ctx) {
  const { base, head, diff, violations, cycles, narration } = ctx;
  const imageUrl = ctx.imageUrl || './diff.svg';
  const reportUrl = ctx.reportUrl || './report.html';
  const v = verdict(violations, cycles);
  const bullets = changeBullets(diff, violations, cycles);
  const shown = bullets.slice(0, 20);
  if (bullets.length > 20) shown.push(`- …and ${bullets.length - 20} more`);

  const md = [
    COMMENT_MARKER,
    '## 🩻 Architecture X-Ray',
    '',
    `${v.emoji} ${v.bad ? `**${v.text}**` : v.text}`,
    '',
    `[![architecture diff](${imageUrl})](${reportUrl})`,
    '',
    `**[🔍 Open the interactive report](${reportUrl})** — heatmap, animation, dependency strength, filters`,
    '',
    '**What changed structurally**',
    '',
    ...shown,
    '',
  ];
  if (narration) {
    md.push(`> 🤖 **AI read:** ${narration.replace(/\n+/g, ' ')}`, '');
  }
  md.push(
    `<sub>ArchXray compared \`${base}\` → \`${head}\` · green = added, struck out = removed, ` +
      `edge width = import count · silent when the architecture is untouched</sub>`,
    ''
  );
  return md.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cytoscapeSource() {
  return fs.readFileSync(
    path.join(__dirname, '..', 'node_modules', 'cytoscape', 'dist', 'cytoscape.min.js'),
    'utf8'
  );
}

// Turns the laid-out scene into Cytoscape elements with both fills precomputed
// (status color + heat color) so toggles are pure data swaps.
function sceneElements(layout) {
  const { nodes, edges, maxHeat } = layout;
  const els = [];
  for (const n of nodes) {
    const c = COLORS[n.status];
    els.push({
      data: {
        id: n.id,
        label: n.status === 'removed' ? '✕ ' + n.id : n.id,
        status: n.status,
        heat: n.heat,
        statusFill: c.fill,
        heatFill: (n.status !== 'removed' && heatColor(n.heat / maxHeat)) || c.fill,
        stroke: c.stroke,
        text: c.text,
        w: n.w,
        h: n.h,
      },
      position: { x: n.x + n.w / 2, y: n.y + n.h / 2 },
    });
  }
  edges.forEach((e, i) => {
    const color = e.forbidden
      ? COLORS.edgeForbidden
      : e.inCycle
        ? COLORS.edgeCycle
        : e.status === 'added'
          ? COLORS.edgeAdded
          : e.status === 'removed'
            ? COLORS.edgeRemoved
            : e.status === 'strengthened'
              ? COLORS.edgeStrengthened
              : COLORS.edgeKept;
    els.push({
      data: {
        id: `e${i}`,
        source: e.from,
        target: e.to,
        status: e.status,
        count: e.count,
        baseCount: e.baseCount || e.count,
        forbidden: e.forbidden ? 1 : 0,
        inCycle: e.inCycle ? 1 : 0,
        color,
        thick: edgeWidth(e.count),
        thin: 2,
        badge: e.forbidden ? '🚫' : e.inCycle ? '🔄' : e.status === 'strengthened' ? `×${e.count}` : '',
      },
    });
  });
  return els;
}

function buildReport(ctx) {
  const { repoName, base, head, diff, violations, cycles, narration, layout } = ctx;
  const v = verdict(violations, cycles);
  const elements = sceneElements(layout);

  const stat = (label, value, tone) =>
    `<div class="stat ${tone || ''}"><div class="num">${value}</div><div class="lbl">${label}</div></div>`;

  const problemItems = [
    ...violations.map(
      (x) =>
        `<li class="bad">🚫 <code>${escapeHtml(x.edge.from)} → ${escapeHtml(x.edge.to)}</code> — forbidden${
          x.rule.reason ? ': ' + escapeHtml(x.rule.reason) : ''
        }</li>`
    ),
    ...cycles.map((c) => `<li class="warn">🔄 new cycle: <code>${escapeHtml(c.join(' → '))}</code></li>`),
    ...(diff.strengthenedEdges || []).map(
      (e) =>
        `<li class="strong">📈 <code>${escapeHtml(e.from)} → ${escapeHtml(e.to)}</code> strengthened: ${e.baseCount} → ${e.count} imports</li>`
    ),
  ].join('\n');

  const violReasons = {};
  for (const x of violations) violReasons[`${x.edge.from}->${x.edge.to}`] = x.rule.reason || 'forbidden dependency';
  const cyclePaths = cycles.map((c) => c.join(' → '));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchXray — ${escapeHtml(repoName)}</title>
<style>
  :root { color-scheme: light; --bad:#dc2626; --ok:#16a34a; --strong:#7c3aed; --ink:#1e293b; --mut:#64748b; --card:#fff; --bg:#f6f7f9; --line:#e3e5e8; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 20px 40px; }
  h1 { font-size: 24px; margin: 0 0 4px; } h1 .x { color: var(--bad); }
  .sub { color: var(--mut); margin-bottom: 16px; }
  .verdict { padding: 11px 16px; border-radius: 10px; font-weight: 600; margin-bottom: 16px; border: 1px solid var(--line); background: var(--card); }
  .verdict.bad { border-color: var(--bad); color: var(--bad); }
  .verdict.ok { border-color: var(--ok); color: var(--ok); }
  .stats { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 16px; min-width:104px; }
  .stat .num { font-size:22px; font-weight:700; } .stat .lbl { font-size:11px; color:var(--mut); }
  .stat.add .num { color:var(--ok); } .stat.del .num { color:var(--mut); } .stat.viol .num { color:var(--bad); }
  .ai { border-left: 4px solid var(--strong); background:var(--card); padding: 11px 16px; border-radius: 0 10px 10px 0; margin-bottom:16px; }
  .ai b { color:var(--strong); }
  ul.problems { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 12px 12px 32px; margin:0 0 16px; }
  ul.problems li { margin: 4px 0; }
  ul.problems li.bad { color: var(--bad); }
  ul.problems li.strong { color: var(--strong); }
  .controls { display:flex; gap:14px; flex-wrap:wrap; align-items:center; background:var(--card); border:1px solid var(--line); border-radius:12px 12px 0 0; padding:10px 16px; border-bottom:none; }
  .controls label { display:flex; align-items:center; gap:6px; font-size:13px; cursor:pointer; user-select:none; }
  .controls input { accent-color: var(--strong); }
  .controls .play { margin-left:auto; font:inherit; font-weight:600; font-size:13px; padding:7px 18px; border-radius:8px; border:none; background:var(--strong); color:#fff; cursor:pointer; }
  .controls .play:hover { filter:brightness(1.1); }
  #cy { width:100%; height:66vh; min-height:440px; background:#fff; border:1px solid var(--line); border-radius:0 0 12px 12px; }
  .cywrap { position:relative; }
  #info { position:absolute; right:14px; top:14px; width:260px; background:rgba(255,255,255,.97); border:1px solid var(--line); border-radius:10px; padding:12px 14px; font-size:13px; box-shadow:0 4px 14px rgba(0,0,0,.08); display:none; }
  #info h3 { margin:0 0 6px; font-size:14px; } #info .k { color:var(--mut); }
  code { background: rgba(128,128,128,.15); padding: 1px 5px; border-radius: 4px; }
  .foot { color:var(--mut); font-size:12px; margin-top:18px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🩻 Arch<span class="x">Xray</span></h1>
  <div class="sub">${escapeHtml(repoName)} &nbsp;·&nbsp; <code>${escapeHtml(base)}</code> → <code>${escapeHtml(head)}</code></div>

  <div class="verdict ${v.bad ? 'bad' : 'ok'}">${v.emoji} ${escapeHtml(v.text)}</div>

  <div class="stats">
    ${stat('modules added', diff.addedNodes.length, 'add')}
    ${stat('dependencies added', diff.addedEdges.length, 'add')}
    ${stat('modules removed', diff.removedNodes.length, 'del')}
    ${stat('dependencies removed', diff.removedEdges.length, 'del')}
    ${stat('rule violations', violations.length, violations.length ? 'viol' : '')}
    ${stat('new cycles', cycles.length, cycles.length ? 'viol' : '')}
  </div>

  ${narration ? `<div class="ai"><b>🤖 AI read</b><br>${escapeHtml(narration)}</div>` : ''}
  ${problemItems ? `<ul class="problems">${problemItems}</ul>` : ''}

  <div class="controls">
    <label><input type="checkbox" id="t-added" checked> Show Added</label>
    <label><input type="checkbox" id="t-removed" checked> Show Removed</label>
    <label><input type="checkbox" id="t-heatmap" checked> Heatmap</label>
    <label><input type="checkbox" id="t-strength" checked> Dependency Strength</label>
    <label><input type="checkbox" id="t-changed"> Show Only Changed</label>
    <button class="play" id="t-animate">▶ Animate Changes</button>
  </div>
  <div class="cywrap">
    <div id="cy"></div>
    <div id="info"></div>
  </div>

  <div class="foot">Generated by ArchXray · layout precomputed with ELK (deterministic) ·
    green = added · struck out = removed · red = forbidden · amber = cycle · purple = strengthened ·
    click any module or dependency for details</div>
</div>
<script>${cytoscapeSource()}</script>
<script>
var ELEMENTS = ${JSON.stringify(elements)};
var VIOL_REASONS = ${JSON.stringify(violReasons)};
var CYCLES = ${JSON.stringify(cyclePaths)};

var cy = cytoscape({
  container: document.getElementById('cy'),
  elements: ELEMENTS,
  layout: { name: 'preset', fit: true, padding: 30 },
  wheelSensitivity: 0.2,
  style: [
    { selector: 'node', style: {
      'shape': 'round-rectangle',
      'width': 'data(w)', 'height': 'data(h)',
      'background-color': 'data(heatFill)',
      'border-color': 'data(stroke)', 'border-width': 2,
      'label': 'data(label)', 'color': 'data(text)',
      'font-size': 14, 'font-weight': 600,
      'text-valign': 'center', 'text-halign': 'center',
      'font-family': '"Segoe UI", system-ui, sans-serif',
      'transition-property': 'background-color, opacity',
      'transition-duration': '200ms'
    }},
    { selector: 'node[status = "removed"]', style: { 'opacity': 0.55, 'border-style': 'dashed' } },
    { selector: 'node[status = "added"]', style: { 'border-width': 3 } },
    { selector: 'edge', style: {
      'curve-style': 'taxi', 'taxi-direction': 'downward', 'taxi-turn': '40%',
      'target-arrow-shape': 'triangle',
      'width': 'data(thick)',
      'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
      'label': 'data(badge)', 'font-size': 13,
      'text-background-color': '#fff', 'text-background-opacity': 1,
      'text-background-padding': '3px', 'text-background-shape': 'round-rectangle',
      'transition-property': 'opacity', 'transition-duration': '200ms'
    }},
    { selector: 'edge[status = "removed"]', style: { 'line-style': 'dashed', 'opacity': 0.6 } },
    { selector: 'edge[forbidden = 1]', style: { 'line-style': 'dashed' } },
    { selector: '.hidden', style: { 'display': 'none' } },
    { selector: ':selected', style: { 'overlay-color': '#7c3aed', 'overlay-opacity': 0.15, 'overlay-padding': 6 } }
  ]
});

function $(id) { return document.getElementById(id); }

function applyToggles() {
  var showAdded = $('t-added').checked;
  var showRemoved = $('t-removed').checked;
  var heat = $('t-heatmap').checked;
  var strength = $('t-strength').checked;
  var onlyChanged = $('t-changed').checked;

  cy.batch(function () {
    cy.nodes().forEach(function (n) {
      n.style('background-color', heat ? n.data('heatFill') : n.data('statusFill'));
    });
    cy.edges().forEach(function (e) {
      e.style('width', strength ? e.data('thick') : e.data('thin'));
    });
    cy.elements().removeClass('hidden');
    if (!showAdded) cy.elements('[status = "added"]').addClass('hidden');
    if (!showRemoved) cy.elements('[status = "removed"]').addClass('hidden');
    if (onlyChanged) {
      var changed = cy.elements().filter(function (el) { return el.data('status') !== 'kept'; });
      // changed elements + their endpoints/neighbours for context
      var visible = changed.union(changed.edges().connectedNodes()).union(changed.nodes().neighborhood());
      cy.elements().not(visible).addClass('hidden');
    }
  });
  cy.animate({ fit: { eles: cy.elements().not('.hidden'), padding: 40 }, duration: 250 });
}

['t-added', 't-removed', 't-heatmap', 't-strength', 't-changed'].forEach(function (id) {
  $(id).addEventListener('change', applyToggles);
});

// --- presence animation: nodes never move; added grows in, removed shrinks out
var animating = false;
$('t-animate').addEventListener('click', function () {
  if (animating) return;
  animating = true;
  var btn = this; btn.textContent = '⏳ animating…';

  var added = cy.elements('[status = "added"]');
  var removed = cy.elements('[status = "removed"]');
  var strengthened = cy.edges('[status = "strengthened"]');

  // reset: pretend we're at "before"
  removed.style('opacity', 1);
  removed.nodes().style('border-style', 'solid');
  added.style('opacity', 0);
  strengthened.forEach(function (e) { e.style('width', e.data('thin')); });

  var t = 300;
  // 1) removed elements fade/strike out
  setTimeout(function () {
    removed.animate({ style: { opacity: 0.25 } }, { duration: 650, easing: 'ease-in-out' });
  }, t);
  t += 800;
  // 2) added nodes grow in, staggered
  added.nodes().forEach(function (n, i) {
    var w = n.data('w'), h = n.data('h');
    setTimeout(function () {
      n.style({ width: 10, height: 10, opacity: 1 });
      n.animate({ style: { width: w, height: h } }, { duration: 420, easing: 'ease-out-back' });
    }, t + i * 160);
  });
  t += added.nodes().length * 160 + 450;
  // 3) added edges fade in, staggered
  added.edges().forEach(function (e, i) {
    setTimeout(function () {
      e.animate({ style: { opacity: 1 } }, { duration: 320 });
    }, t + i * 110);
  });
  t += added.edges().length * 110 + 350;
  // 4) strengthened edges thicken
  strengthened.forEach(function (e) {
    setTimeout(function () {
      e.animate({ style: { width: e.data('thick') } }, { duration: 500, easing: 'ease-in-out' });
    }, t);
  });
  t += 600;
  setTimeout(function () {
    removed.animate({ style: { opacity: 0.55 } }, { duration: 250 });
    removed.nodes().style('border-style', 'dashed');
    animating = false; btn.textContent = '▶ Animate Changes';
    applyToggles();
  }, t);
});

// --- click for details
var info = $('info');
cy.on('tap', 'node', function (evt) {
  var d = evt.target.data();
  var inCycles = CYCLES.filter(function (c) { return c.indexOf(d.id) !== -1; });
  info.innerHTML = '<h3>' + d.id + '</h3>' +
    '<div><span class="k">status:</span> ' + d.status + '</div>' +
    '<div><span class="k">heat score:</span> ' + d.heat + '</div>' +
    (inCycles.length ? '<div><span class="k">in cycle:</span> ' + inCycles.join('<br>') + '</div>' : '');
  info.style.display = 'block';
});
cy.on('tap', 'edge', function (evt) {
  var d = evt.target.data();
  var key = d.source + '->' + d.target;
  info.innerHTML = '<h3>' + d.source + ' → ' + d.target + '</h3>' +
    '<div><span class="k">status:</span> ' + d.status + '</div>' +
    '<div><span class="k">imports:</span> ' + d.count + (d.baseCount !== d.count ? ' (was ' + d.baseCount + ')' : '') + '</div>' +
    (d.forbidden ? '<div style="color:#dc2626"><b>🚫 forbidden:</b> ' + (VIOL_REASONS[key] || '') + '</div>' : '') +
    (d.inCycle ? '<div style="color:#f59e0b"><b>🔄 part of a new cycle</b></div>' : '');
  info.style.display = 'block';
});
cy.on('tap', function (evt) { if (evt.target === cy) info.style.display = 'none'; });

applyToggles();
</script>
</body>
</html>
`;
}

module.exports = { buildComment, buildReport, verdict, changeBullets, COMMENT_MARKER };
