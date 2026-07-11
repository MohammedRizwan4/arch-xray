'use strict';

const edgeKey = (e) => `${e.from}->${e.to}`;

function diffGraphs(base, head) {
  const baseNodes = new Set(base.nodes);
  const headNodes = new Set(head.nodes);
  const baseEdges = new Set(base.edges.map(edgeKey));
  const headEdges = new Set(head.edges.map(edgeKey));
  const d = {
    addedNodes: head.nodes.filter((n) => !baseNodes.has(n)),
    removedNodes: base.nodes.filter((n) => !headNodes.has(n)),
    addedEdges: head.edges.filter((e) => !baseEdges.has(edgeKey(e))),
    removedEdges: base.edges.filter((e) => !headEdges.has(edgeKey(e))),
    keptNodes: head.nodes.filter((n) => baseNodes.has(n)),
    keptEdges: head.edges.filter((e) => baseEdges.has(edgeKey(e))),
  };
  d.changed =
    d.addedNodes.length + d.removedNodes.length + d.addedEdges.length + d.removedEdges.length > 0;
  return d;
}

module.exports = { diffGraphs, edgeKey };
