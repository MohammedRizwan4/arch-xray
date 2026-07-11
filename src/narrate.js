'use strict';
// Optional AI narration via the local `claude` CLI — no API key management needed.

const { spawnSync } = require('child_process');

function narrate(summary) {
  const prompt = [
    'You are an architecture reviewer. Below is a JSON summary of how a pull request',
    'changes the module dependency graph of a codebase.',
    'Write 2-3 plain-English sentences a reviewer can read in 10 seconds:',
    'what structurally changed and why it matters (coupling, layering, risk).',
    'No preamble, no markdown, no bullet points.',
    '',
    JSON.stringify(summary, null, 2),
  ].join('\n');
  try {
    const res = spawnSync('claude -p', {
      input: prompt,
      encoding: 'utf8',
      timeout: 120000,
      shell: true,
      windowsHide: true,
    });
    if (res.status === 0 && res.stdout && res.stdout.trim()) return res.stdout.trim();
  } catch {
    /* claude CLI not installed or timed out — narration is optional */
  }
  return null;
}

module.exports = { narrate };
