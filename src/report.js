'use strict';
// Builds the PR comment (markdown) and the local interactive report (HTML).

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
  for (const n of diff.removedNodes) lines.push(`- ➖ removed module \`${n}\``);
  for (const e of diff.removedEdges) lines.push(`- ➖ removed dependency \`${e.from} → ${e.to}\``);
  return lines;
}

function buildComment(ctx) {
  const { base, head, diff, violations, cycles, narration, pngUrl, editUrl } = ctx;
  const v = verdict(violations, cycles);
  const bullets = changeBullets(diff, violations, cycles);
  const shown = bullets.slice(0, 20);
  if (bullets.length > 20) shown.push(`- …and ${bullets.length - 20} more`);

  const md = [
    '## 🩻 Architecture X-Ray',
    '',
    `${v.emoji} ${v.bad ? `**${v.text}**` : v.text}`,
    '',
    `![architecture diff](${pngUrl})`,
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
    `<sub>ArchXray compared \`${base}\` → \`${head}\` · red = added, struck out = removed · ` +
      `silent when the architecture is untouched · <a href="${editUrl}">open diagram in editor</a></sub>`,
    ''
  );
  return md.join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReport(ctx) {
  const { repoName, base, head, diff, violations, cycles, narration, svgs, pngUrl, editUrl } = ctx;
  const v = verdict(violations, cycles);

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
  ].join('\n');

  const svgPanel = (svg, fallbackLabel) =>
    svg
      ? `<div class="canvas">${svg}</div>`
      : `<div class="canvas empty">Rendering server unreachable — open <code>${fallbackLabel}</code> ` +
        `in any PlantUML viewer, or <a href="${editUrl}">view online</a>.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchXray — ${escapeHtml(repoName)}</title>
<style>
  :root { color-scheme: light dark; --bad:#c62828; --ok:#2e7d32; --ink:#1c1c1c; --mut:#6b6b6b; --card:#fff; --bg:#f6f7f9; --line:#e3e5e8; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eaeaea; --mut:#9a9a9a; --card:#1d1f23; --bg:#131417; --line:#2c2f34; } }
  * { box-sizing: border-box; }
  body { margin:0; font-family: "Segoe UI", system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 26px; margin: 0 0 4px; } h1 .x { color: var(--bad); }
  .sub { color: var(--mut); margin-bottom: 20px; }
  .verdict { padding: 12px 16px; border-radius: 10px; font-weight: 600; margin-bottom: 20px; border: 1px solid var(--line); background: var(--card); }
  .verdict.bad { border-color: var(--bad); color: var(--bad); }
  .verdict.ok { border-color: var(--ok); color: var(--ok); }
  .stats { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 18px; min-width:110px; }
  .stat .num { font-size:24px; font-weight:700; } .stat .lbl { font-size:12px; color:var(--mut); }
  .stat.add .num { color:var(--bad); } .stat.del .num { color:var(--mut); }
  .stat.viol .num { color:var(--bad); }
  .ai { border-left: 4px solid #7c4dff; background:var(--card); padding: 12px 16px; border-radius: 0 10px 10px 0; margin-bottom:20px; }
  .ai b { color:#7c4dff; }
  ul.problems { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 14px 14px 34px; margin:0 0 20px; }
  ul.problems li { margin: 4px 0; }
  ul.problems li.bad { color: var(--bad); }
  .tabs { display:flex; gap:8px; margin-bottom:12px; }
  .tabs button { font: inherit; padding:8px 16px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  .tabs button.active { background:var(--ink); color:var(--bg); border-color:var(--ink); }
  .panel { display:none; } .panel.active { display:block; }
  .canvas { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; overflow-x:auto; }
  .canvas svg { max-width:100%; height:auto; }
  .canvas.empty { color:var(--mut); background:var(--card); }
  code { background: rgba(128,128,128,.15); padding: 1px 5px; border-radius: 4px; }
  .foot { color:var(--mut); font-size:12px; margin-top:24px; }
  a { color:#7c4dff; }
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

  <div class="tabs">
    <button class="active" data-p="diff">Impact</button>
    <button data-p="before">Before</button>
    <button data-p="after">After</button>
  </div>
  <div class="panel active" id="p-diff">${svgPanel(svgs && svgs.diff, 'diff.puml')}</div>
  <div class="panel" id="p-before">${svgPanel(svgs && svgs.before, 'before.puml')}</div>
  <div class="panel" id="p-after">${svgPanel(svgs && svgs.after, 'after.puml')}</div>

  <div class="foot">Generated by ArchXray · red = added by this PR · struck out = removed ·
    <a href="${editUrl}">open diagram in PlantUML editor</a> · <a href="${pngUrl}">PNG</a></div>
</div>
<script>
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.panel').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      document.getElementById('p-' + b.dataset.p).classList.add('active');
    });
  });
</script>
</body>
</html>
`;
}

module.exports = { buildComment, buildReport, verdict, changeBullets };
