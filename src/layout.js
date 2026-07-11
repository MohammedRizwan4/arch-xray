'use strict';
// One ELK layout of the MERGED (before ∪ after) graph, computed once in Node.
// The same coordinates drive both the static SVG and the interactive report,
// so the comment image is a pixel-sibling of the report and layouts are
// deterministic across runs.

const ELK = require('elkjs');

const NODE_H = 44;
const nodeWidth = (label) => Math.max(96, 26 + label.length * 9.5);

// Builds the merged scene: every node/edge tagged with its diff status.
function mergeScene(diff, violations, cycles, heat) {
  const violKeys = new Set(violations.map((v) => `${v.edge.from}->${v.edge.to}`));
  const cycleEdges = new Set();
  for (const c of cycles) {
    for (let i = 0; i < c.length - 1; i++) cycleEdges.add(`${c[i]}->${c[i + 1]}`);
  }

  const nodes = [
    ...diff.keptNodes.map((id) => ({ id, status: 'kept' })),
    ...diff.addedNodes.map((id) => ({ id, status: 'added' })),
    ...diff.removedNodes.map((id) => ({ id, status: 'removed' })),
  ].map((n) => ({ ...n, heat: (heat && heat.get(n.id)) || 0 }));

  const strengthened = new Set(diff.strengthenedEdges.map((e) => `${e.from}->${e.to}`));
  const tagEdge = (e, status) => ({
    from: e.from,
    to: e.to,
    count: e.count || 1,
    baseCount: e.baseCount,
    status: status === 'kept' && strengthened.has(`${e.from}->${e.to}`) ? 'strengthened' : status,
    forbidden: violKeys.has(`${e.from}->${e.to}`),
    inCycle: cycleEdges.has(`${e.from}->${e.to}`),
  });

  const edges = [
    ...diff.keptEdges.map((e) => tagEdge(e, 'kept')),
    ...diff.addedEdges.map((e) => tagEdge(e, 'added')),
    ...diff.removedEdges.map((e) => tagEdge(e, 'removed')),
  ];

  const maxHeat = Math.max(1, ...nodes.map((n) => n.heat));
  return { nodes, edges, maxHeat };
}

// Runs ELK layered layout; returns the scene with x/y/w/h on nodes and
// route points on edges, plus overall width/height.
async function layoutScene(scene) {
  const elk = new ELK();
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '70',
      'elk.spacing.nodeNode': '46',
      'elk.spacing.edgeNode': '24',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
    },
    children: scene.nodes.map((n) => ({ id: n.id, width: nodeWidth(n.id), height: NODE_H })),
    edges: scene.edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
  };

  const laid = await elk.layout(graph);
  const pos = new Map(laid.children.map((c) => [c.id, c]));

  const nodes = scene.nodes.map((n) => {
    const p = pos.get(n.id);
    return { ...n, x: p.x, y: p.y, w: p.width, h: p.height };
  });

  const edges = scene.edges.map((e, i) => {
    const le = laid.edges[i];
    const sec = le.sections && le.sections[0];
    const points = sec
      ? [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint]
      : [];
    return { ...e, points };
  });

  return { nodes, edges, width: laid.width, height: laid.height, maxHeat: scene.maxHeat };
}

module.exports = { mergeScene, layoutScene, nodeWidth, NODE_H };
