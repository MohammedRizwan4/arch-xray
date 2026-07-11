'use strict';
// Architecture guardrails: forbidden dependencies (archrules.json) and new cycles.
// Only edges ADDED by the PR are judged — pre-existing debt is baseline, not blame.

function loadRules(headFiles, baseFiles) {
  const raw = headFiles.get('archrules.json') || (baseFiles && baseFiles.get('archrules.json'));
  if (!raw) return { forbid: [] };
  try {
    const parsed = JSON.parse(raw);
    return { forbid: Array.isArray(parsed.forbid) ? parsed.forbid : [] };
  } catch {
    console.warn('archxray: archrules.json is not valid JSON — ignoring rules');
    return { forbid: [] };
  }
}

const matches = (pattern, name) => pattern === '*' || pattern === name;

function findViolations(rules, addedEdges) {
  const out = [];
  for (const edge of addedEdges) {
    for (const rule of rules.forbid) {
      if (matches(rule.from, edge.from) && matches(rule.to, edge.to)) out.push({ edge, rule });
    }
  }
  return out;
}

// A cycle through an added edge cannot have existed before the PR.
function findNewCycles(addedEdges, headGraph) {
  const adj = new Map();
  for (const e of headGraph.edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const cycles = [];
  const seen = new Set();
  for (const e of addedEdges) {
    const back = bfsPath(adj, e.to, e.from);
    if (!back) continue;
    const cycle = [e.from, ...back]; // from -> to -> ... -> from
    const sig = [...new Set(cycle)].sort().join('|');
    if (!seen.has(sig)) {
      seen.add(sig);
      cycles.push(cycle);
    }
  }
  return cycles;
}

function bfsPath(adj, start, goal) {
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) {
      const path = [];
      for (let n = goal; n !== null; n = prev.get(n)) path.unshift(n);
      return path;
    }
    for (const next of adj.get(cur) || []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  return null;
}

module.exports = { loadRules, findViolations, findNewCycles };
