'use strict';
// Turns dependency graphs (and graph diffs) into PlantUML source.

const COLORS = {
  addedBack: 'MistyRose',
  addedLine: 'Firebrick',
  removedBack: 'WhiteSmoke',
  removedLine: 'Gray',
  violation: 'Red',
};

const alias = (name) => 'm_' + name.replace(/[^A-Za-z0-9_]/g, '_');
const esc = (s) => String(s).replace(/"/g, "'");

function header(title) {
  const lines = ['@startuml'];
  if (title) lines.push(`title ${esc(title)}`);
  lines.push(
    'left to right direction',
    'skinparam componentStyle rectangle',
    'skinparam shadowing false',
    'skinparam defaultFontName Segoe UI',
    'skinparam ArrowColor #555555',
    'skinparam componentBorderColor #555555',
    ''
  );
  return lines;
}

function plainDiagram(graph, title) {
  const lines = header(title);
  for (const n of graph.nodes) lines.push(`component "${esc(n)}" as ${alias(n)}`);
  lines.push('');
  for (const e of graph.edges) lines.push(`${alias(e.from)} --> ${alias(e.to)}`);
  lines.push('@enduml');
  return lines.join('\n');
}

function diffDiagram(diff, violations, title) {
  const violKeys = new Set(violations.map((v) => `${v.edge.from}->${v.edge.to}`));
  const lines = header(title);

  for (const n of diff.keptNodes) lines.push(`component "${esc(n)}" as ${alias(n)}`);
  for (const n of diff.addedNodes)
    lines.push(
      `component "${esc(n)}" as ${alias(n)} #${COLORS.addedBack};line:${COLORS.addedLine};text:${COLORS.addedLine}`
    );
  for (const n of diff.removedNodes)
    lines.push(
      `component "<s>${esc(n)}</s>" as ${alias(n)} #${COLORS.removedBack};line:${COLORS.removedLine};text:${COLORS.removedLine}`
    );
  lines.push('');

  for (const e of diff.keptEdges) lines.push(`${alias(e.from)} --> ${alias(e.to)}`);
  for (const e of diff.addedEdges) {
    if (violKeys.has(`${e.from}->${e.to}`)) {
      lines.push(
        `${alias(e.from)} -[#${COLORS.violation},bold]-> ${alias(e.to)} : <color:${COLORS.violation}><b>FORBIDDEN</b></color>`
      );
    } else {
      lines.push(
        `${alias(e.from)} -[#${COLORS.addedLine},bold]-> ${alias(e.to)} : <color:${COLORS.addedLine}><b>new</b></color>`
      );
    }
  }
  for (const e of diff.removedEdges)
    lines.push(
      `${alias(e.from)} -[#${COLORS.removedLine},dashed]-> ${alias(e.to)} : <color:${COLORS.removedLine}><s>removed</s></color>`
    );

  lines.push('', 'legend bottom');
  lines.push(`<color:${COLORS.addedLine}>** red = added by this PR **</color>`);
  lines.push(`<color:${COLORS.removedLine}>** gray dashed / struck out = removed by this PR **</color>`);
  if (violations.length)
    lines.push(`<color:${COLORS.violation}>** FORBIDDEN = breaks a rule in archrules.json **</color>`);
  lines.push('endlegend', '@enduml');
  return lines.join('\n');
}

module.exports = { plainDiagram, diffDiagram };
