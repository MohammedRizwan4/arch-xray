'use strict';

const edgeKey = (e) => `${e.from}->${e.to}`;

// An existing edge counts as "strengthened" only when its import count clearly
// jumps (>= 2x and +3) — a single new import inside an existing dependency is
// normal work, not an architectural signal.
function isStrengthened(baseCount, headCount) {
  return headCount >= baseCount * 2 && headCount - baseCount >= 3;
}

function diffGraphs(base, head) {
  const baseNodes = new Set(base.nodes);
  const headNodes = new Set(head.nodes);
  const baseEdges = new Map(base.edges.map((e) => [edgeKey(e), e]));
  const headEdges = new Set(head.edges.map(edgeKey));

  const keptEdges = head.edges
    .filter((e) => baseEdges.has(edgeKey(e)))
    .map((e) => ({ ...e, baseCount: baseEdges.get(edgeKey(e)).count }));

  const d = {
    addedNodes: head.nodes.filter((n) => !baseNodes.has(n)),
    removedNodes: base.nodes.filter((n) => !headNodes.has(n)),
    addedEdges: head.edges.filter((e) => !baseEdges.has(edgeKey(e))),
    removedEdges: base.edges.filter((e) => !headEdges.has(edgeKey(e))),
    keptNodes: head.nodes.filter((n) => baseNodes.has(n)),
    keptEdges,
    strengthenedEdges: keptEdges.filter((e) => isStrengthened(e.baseCount, e.count)),
  };
  d.changed =
    d.addedNodes.length + d.removedNodes.length + d.addedEdges.length +
    d.removedEdges.length + d.strengthenedEdges.length > 0;
  return d;
}

// Heat per module: files changed inside it + structural churn touching it.
// Score = files changed + edges added + edges removed (each edge heats both endpoints).
function computeHeat(diff, changedFilesByModule) {
  const heat = new Map();
  const bump = (mod, n) => heat.set(mod, (heat.get(mod) || 0) + n);
  for (const [mod, files] of changedFilesByModule) bump(mod, files);
  for (const e of [...diff.addedEdges, ...diff.removedEdges]) {
    bump(e.from, 1);
    bump(e.to, 1);
  }
  return heat;
}

module.exports = { diffGraphs, computeHeat, edgeKey };
