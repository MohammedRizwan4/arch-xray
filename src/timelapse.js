'use strict';
// Architecture time-lapse: renders the module graph at each commit and
// produces a self-contained HTML player of the architecture's evolution.

const path = require('path');
const { buildGraph } = require('./extract');
const { snapshot, git } = require('./gitsnap');
const { plainDiagram } = require('./puml');
const { diagramUrl, fetchSvg } = require('./render');

async function buildTimelapse({ repo, ref = 'HEAD', count = 15, server }) {
  const shas = git(repo, ['rev-list', '--first-parent', '-n', String(count), ref])
    .split('\n')
    .filter(Boolean)
    .reverse();

  const frames = [];
  const svgCache = new Map();
  let prevKey = null;

  for (const sha of shas) {
    const [shortSha, date, subject] = git(repo, [
      'show', '-s', '--format=%h%x09%ad%x09%s', '--date=short', sha,
    ]).split('\t');
    const graph = buildGraph(snapshot(repo, sha));
    const key = JSON.stringify(graph);
    let svg = svgCache.get(key);
    if (!svg) {
      svg = await fetchSvg(diagramUrl(server, 'svg', plainDiagram(graph, '')));
      svgCache.set(key, svg);
    }
    const changed = prevKey !== null && key !== prevKey;
    frames.push({ sha: shortSha, date, subject, svg, changed });
    prevKey = key;
    console.log(
      `  frame ${frames.length}/${shas.length}  ${shortSha}  ${changed ? '◆ architecture changed' : '· no change'}  ${subject}`
    );
  }

  return timelapseHtml(path.basename(path.resolve(repo)), frames);
}

function timelapseHtml(repoName, frames) {
  const data = JSON.stringify(frames).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ArchXray time-lapse — ${repoName}</title>
<style>
  :root { color-scheme: light dark; --ink:#1c1c1c; --mut:#6b6b6b; --card:#fff; --bg:#f6f7f9; --line:#e3e5e8; --acc:#c62828; }
  @media (prefers-color-scheme: dark) { :root { --ink:#eaeaea; --mut:#9a9a9a; --card:#1d1f23; --bg:#131417; --line:#2c2f34; } }
  body { margin:0; font-family:"Segoe UI", system-ui, sans-serif; background:var(--bg); color:var(--ink); }
  .wrap { max-width:1100px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:24px; margin:0 0 4px; } h1 .x { color:var(--acc); }
  .sub { color:var(--mut); margin-bottom:18px; }
  .controls { display:flex; align-items:center; gap:10px; margin-bottom:10px; flex-wrap:wrap; }
  button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
  button:hover { border-color:var(--acc); }
  input[type=range] { flex:1; min-width:200px; accent-color: var(--acc); }
  .meta { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 16px; margin-bottom:12px; display:flex; gap:16px; align-items:baseline; flex-wrap:wrap; }
  .meta .sha { font-family:Consolas,monospace; color:var(--acc); font-weight:700; }
  .meta .changed { font-size:12px; padding:2px 8px; border-radius:99px; background:var(--acc); color:#fff; }
  .meta .same { font-size:12px; padding:2px 8px; border-radius:99px; background:var(--line); color:var(--mut); }
  .canvas { background:#fff; border:1px solid var(--line); border-radius:12px; padding:18px; overflow:auto; min-height:300px; }
  .canvas svg { max-width:100%; height:auto; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🎞️ Arch<span class="x">Xray</span> time-lapse</h1>
  <div class="sub">${repoName} — watch the architecture evolve, one commit at a time</div>
  <div class="controls">
    <button id="first">⏮</button>
    <button id="prev">◀</button>
    <button id="play">▶ play</button>
    <button id="next">▶</button>
    <button id="last">⏭</button>
    <input type="range" id="slider" min="0" value="0">
    <span id="pos"></span>
  </div>
  <div class="meta">
    <span class="sha" id="sha"></span>
    <span id="date"></span>
    <span id="subject" style="flex:1"></span>
    <span id="badge"></span>
  </div>
  <div class="canvas" id="canvas"></div>
</div>
<script>
  const frames = ${data};
  let i = 0, timer = null;
  const slider = document.getElementById('slider');
  slider.max = frames.length - 1;
  function show(n) {
    i = Math.max(0, Math.min(frames.length - 1, n));
    const f = frames[i];
    document.getElementById('canvas').innerHTML = f.svg;
    document.getElementById('sha').textContent = f.sha;
    document.getElementById('date').textContent = f.date;
    document.getElementById('subject').textContent = f.subject;
    document.getElementById('badge').innerHTML = f.changed
      ? '<span class="changed">architecture changed</span>'
      : '<span class="same">no structural change</span>';
    document.getElementById('pos').textContent = (i + 1) + ' / ' + frames.length;
    slider.value = i;
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; document.getElementById('play').textContent = '▶ play'; } }
  document.getElementById('first').onclick = () => { stop(); show(0); };
  document.getElementById('last').onclick = () => { stop(); show(frames.length - 1); };
  document.getElementById('prev').onclick = () => { stop(); show(i - 1); };
  document.getElementById('next').onclick = () => { stop(); show(i + 1); };
  slider.oninput = () => { stop(); show(+slider.value); };
  document.getElementById('play').onclick = function () {
    if (timer) return stop();
    this.textContent = '⏸ pause';
    if (i >= frames.length - 1) show(0);
    timer = setInterval(() => { if (i >= frames.length - 1) stop(); else show(i + 1); }, 1100);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { stop(); show(i + 1); }
    if (e.key === 'ArrowLeft') { stop(); show(i - 1); }
    if (e.key === ' ') { e.preventDefault(); document.getElementById('play').click(); }
  });
  show(0);
</script>
</body>
</html>
`;
}

module.exports = { buildTimelapse };
