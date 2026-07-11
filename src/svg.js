'use strict';
// Static SVG for the PR comment, drawn from the shared ELK layout — no browser.
// Same colors and positions as the interactive report.

const COLORS = {
  kept: { stroke: '#94a3b8', fill: '#f8fafc', text: '#334155' },
  added: { stroke: '#16a34a', fill: '#f0fdf4', text: '#166534' },
  removed: { stroke: '#9ca3af', fill: '#f3f4f6', text: '#9ca3af' },
  edgeKept: '#94a3b8',
  edgeAdded: '#16a34a',
  edgeRemoved: '#c2c7cf',
  edgeForbidden: '#dc2626',
  edgeCycle: '#f59e0b',
  edgeStrengthened: '#7c3aed',
};

// Interpolates white → warm red by heat ratio (heatmap fill).
function heatColor(ratio) {
  if (ratio <= 0) return null;
  const stops = [
    [0.0, [241, 245, 249]],
    [0.25, [254, 240, 138]],
    [0.5, [253, 186, 116]],
    [0.75, [248, 113, 113]],
    [1.0, [220, 38, 38]],
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (ratio >= stops[i][0] && ratio <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const t = (ratio - lo[0]) / (hi[0] - lo[0] || 1);
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

const edgeWidth = (count) => Math.min(1.5 + (count - 1) * 0.9, 7);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function edgeColor(e) {
  if (e.forbidden) return COLORS.edgeForbidden;
  if (e.inCycle) return COLORS.edgeCycle;
  if (e.status === 'added') return COLORS.edgeAdded;
  if (e.status === 'removed') return COLORS.edgeRemoved;
  if (e.status === 'strengthened') return COLORS.edgeStrengthened;
  return COLORS.edgeKept;
}

function pathFrom(points) {
  if (!points.length) return '';
  const r = 8; // rounded corners on orthogonal bends
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i], prev = points[i - 1], next = points[i + 1];
    const inV = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) };
    const outV = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) };
    const before = { x: p.x - inV.x * r, y: p.y - inV.y * r };
    const after = { x: p.x + outV.x * r, y: p.y + outV.y * r };
    d += ` L ${before.x} ${before.y} Q ${p.x} ${p.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

function buildSvg(layout, { title = '', heatmap = true } = {}) {
  const { nodes, edges, width, height, maxHeat } = layout;
  const titleH = title ? 44 : 0;
  const legendH = 42;
  const W = Math.max(width + 48, 560);
  const H = height + titleH + legendH + 24;

  const parts = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, system-ui, sans-serif">`
  );
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // arrowhead markers, one per color in use
  const colors = [...new Set(edges.map(edgeColor))];
  parts.push('<defs>');
  for (const c of colors) {
    const id = 'arr' + c.replace(/[^a-z0-9]/gi, '');
    parts.push(
      `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
        `<path d="M 0 1 L 9 5 L 0 9 z" fill="${c}"/></marker>`
    );
  }
  parts.push('</defs>');

  if (title) {
    parts.push(
      `<text x="${W / 2}" y="28" text-anchor="middle" font-size="17" font-weight="700" fill="#1e293b">${esc(title)}</text>`
    );
  }

  const ox = (W - width) / 2;
  const oy = titleH + 8;
  parts.push(`<g transform="translate(${ox},${oy})">`);

  // edges under nodes
  for (const e of edges) {
    if (!e.points.length) continue;
    const c = edgeColor(e);
    const wpx = edgeWidth(e.count);
    const dash = e.status === 'removed' ? ' stroke-dasharray="6 5"' : e.forbidden ? ' stroke-dasharray="2 3"' : '';
    const markerId = 'arr' + c.replace(/[^a-z0-9]/gi, '');
    parts.push(
      `<path d="${pathFrom(e.points)}" fill="none" stroke="${c}" stroke-width="${wpx}"${dash} marker-end="url(#${markerId})" opacity="${e.status === 'removed' ? 0.65 : 1}"/>`
    );
    // badge at edge midpoint for notable edges
    const badge = e.forbidden ? '🚫' : e.inCycle ? '🔄' : e.status === 'strengthened' ? `×${e.count}` : null;
    if (badge) {
      const mid = e.points[Math.floor(e.points.length / 2)];
      const isText = !/[🚫🔄]/u.test(badge);
      parts.push(
        `<g><rect x="${mid.x - 16}" y="${mid.y - 11}" width="32" height="20" rx="10" fill="#fff" stroke="${c}" stroke-width="1.2"/>` +
          `<text x="${mid.x}" y="${mid.y + 4}" text-anchor="middle" font-size="${isText ? 11 : 12}" ${isText ? `fill="${c}" font-weight="700"` : ''}>${badge}</text></g>`
      );
    }
  }

  // nodes
  for (const n of nodes) {
    const c = COLORS[n.status];
    const heatFill = heatmap && n.status !== 'removed' ? heatColor(n.heat / maxHeat) : null;
    const fill = heatFill || c.fill;
    const strokeW = n.status === 'kept' ? 1.4 : 2.2;
    const dash = n.status === 'removed' ? ' stroke-dasharray="5 4"' : '';
    parts.push(
      `<g opacity="${n.status === 'removed' ? 0.62 : 1}">` +
        `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="10" fill="${fill}" stroke="${c.stroke}" stroke-width="${strokeW}"${dash}/>` +
        `<text x="${n.x + n.w / 2}" y="${n.y + n.h / 2 + 5}" text-anchor="middle" font-size="14" font-weight="600" fill="${c.text}">${esc(n.id)}</text>` +
        (n.status === 'removed'
          ? `<line x1="${n.x + 12}" y1="${n.y + n.h / 2}" x2="${n.x + n.w - 12}" y2="${n.y + n.h / 2}" stroke="${c.text}" stroke-width="1.6"/>`
          : '') +
        (n.status === 'added'
          ? `<circle cx="${n.x + n.w - 2}" cy="${n.y + 2}" r="9" fill="#16a34a"/><text x="${n.x + n.w - 2}" y="${n.y + 6}" text-anchor="middle" font-size="12" fill="#fff" font-weight="700">+</text>`
          : '') +
        `</g>`
    );
  }
  parts.push('</g>');

  // legend
  const ly = H - legendH + 14;
  const legend = [
    ['#16a34a', 'added'],
    ['#9ca3af', 'removed'],
    ['#dc2626', 'forbidden'],
    ['#f59e0b', 'cycle'],
    ['#7c3aed', 'strengthened'],
  ];
  let lx = 24;
  parts.push(`<g font-size="12" fill="#64748b">`);
  for (const [c, label] of legend) {
    parts.push(`<rect x="${lx}" y="${ly}" width="14" height="14" rx="4" fill="${c}"/>`);
    parts.push(`<text x="${lx + 20}" y="${ly + 11}">${label}</text>`);
    lx += 30 + label.length * 7 + 18;
  }
  if (heatmap) {
    parts.push(`<text x="${lx}" y="${ly + 11}">heat:</text>`);
    lx += 38;
    for (let i = 0; i <= 4; i++) {
      parts.push(`<rect x="${lx + i * 16}" y="${ly}" width="16" height="14" fill="${heatColor(i / 4) || '#f1f5f9'}"/>`);
    }
    parts.push(`<text x="${lx + 5 * 16 + 6}" y="${ly + 11}">churn</text>`);
  }
  parts.push('</g>');

  parts.push('</svg>');
  return parts.join('\n');
}

module.exports = { buildSvg, heatColor, edgeWidth, COLORS };
