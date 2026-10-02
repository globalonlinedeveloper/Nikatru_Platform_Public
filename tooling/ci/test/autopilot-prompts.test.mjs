// autopilot-prompts.test.mjs — the cloud routines' prompts (docs/autopilot/*.prompt.md)
// say what tooling/autopilot/contract.json holds, start with the standby check, and
// carry nothing that must never be public (lanes autopilot-reviews, -runners, -fixer).
//
//   P1  every prompt's FIRST step is the standby check (the heartbeat read)
//   P2  every `NAME` (value) the prompt states is the contract's value, and every
//       backticked word the prompt calls a label is a contract label
//   P3  no secret-shaped string, no `C:/Users` (or `C:\Users`) path
//   P4  per prompt: the labels and thresholds it must name; the fixer never tells
//       anyone to merge; the runner carries the DRY rule
//   P5  red controls: each rule, planted into a real prompt's text in memory, is reported
//
// Run:  node --test "tooling/ci/test/autopilot-prompts.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(ROOT, 'docs/autopilot');
const C = JSON.parse(readFileSync(join(ROOT, 'tooling/autopilot/contract.json'), 'utf8'));

const NUMBERS = { ...C.thresholds, ...Object.fromEntries(Object.entries(C.heartbeat).filter(([k]) => /^[A-Z]/.test(k))), ...C.claimStaleness };
const LABELS = new Set([...C.labels.fixed, ...C.labels.prefixed.map((p) => `${p}<`), ...C.publicLabels.pr, ...C.publicLabels.issue]);
const isLabel = (w) => LABELS.has(w) || C.labels.prefixed.some((p) => w.startsWith(p));

/** What each prompt must name. A prompt file that exists and is not listed here is a finding. */
export const REQUIRED = {
  'reviewer.prompt.md': { labels: ['needs-review', 'review:approve', 'review:changes', 'land-ok', 'land-hold', 'drill'], numbers: ['REVIEW_CLAIM_STALE_H'] },
  'runner.prompt.md': { labels: ['cloud-lane', 'ready', 'pr-open', 'failed', 'drill', 'land-ok', 'needs-review', 'land-hold'], numbers: ['CLAIM_SETTLE_S', 'CLAIM_STALE_H', 'RUNNER_INFLIGHT_MAX'] },
  'fixer.prompt.md': { labels: ['land-freeze', 'fix-first', 'land-ok', 'needs-review', 'land-hold', 'drill'], numbers: ['FIX_CLAIM_STALE_H'] },
};

const SECRET = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{32,})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer [A-Za-z0-9._-]{20,}/;

export function promptFindings(name, text) {
  const f = [];
  const first = /^## (.+)$/m.exec(text);
  if (!first || !/standby check/i.test(first[1])) f.push(`${name}: the first step is "${first?.[1] ?? 'none'}", not the standby check`);
  const firstBody = first ? text.slice(first.index, text.indexOf('\n## ', first.index + 3) === -1 ? undefined : text.indexOf('\n## ', first.index + 3)) : '';
  if (!/heartbeat\.mjs read/.test(firstBody)) f.push(`${name}: the standby check does not run \`heartbeat.mjs read\``);
  for (const m of text.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`(?:\s*\((\d+)[^)]*\))?/g)) {
    if (!(m[1] in NUMBERS)) f.push(`${name}: threshold ${m[1]} is not in the contract`);
    else if (m[2] !== undefined && Number(m[2]) !== NUMBERS[m[1]]) f.push(`${name}: ${m[1]} says ${m[2]}, the contract ${NUMBERS[m[1]]}`);
  }
  for (const m of text.matchAll(/`([a-z][a-z0-9:-]*(?:<[a-z]+>)?)`\s+labels?\b|\blabel(?:led|s)?\s+(?:(?:it|them|with|the PR|the issue)\s+)?`([a-z][a-z0-9:-]*(?:<[a-z]+>)?)`/g)) {
    const w = m[1] ?? m[2];
    if (!isLabel(w)) f.push(`${name}: \`${w}\` is called a label and is not one in the contract`);
  }
  const req = REQUIRED[name];
  if (!req) f.push(`${name}: a prompt with no entry in REQUIRED`);
  for (const l of req?.labels ?? []) if (!text.includes(`\`${l}\``)) f.push(`${name}: does not name the label ${l}`);
  for (const n of req?.numbers ?? []) if (!new RegExp(`\`${n}\` \\(${NUMBERS[n]}\\b`).test(text)) f.push(`${name}: does not state ${n} (${NUMBERS[n]})`);
  const sec = SECRET.exec(text);
  if (sec) f.push(`${name}: a secret-shaped string (${sec[0].slice(0, 6)}…)`);
  if (/C:[\\/]+Users/i.test(text)) f.push(`${name}: a C:/Users path`);
  if (name === 'fixer.prompt.md') {
    for (const line of text.split('\n')) if (/\bmerg(e|es|ed|ing)\b/i.test(line) && !/\bnever\b[^.]*\bmerg/i.test(line)) f.push(`${name}: says merge outside a "never": ${line.trim().slice(0, 80)}`);
  }
  if (name === 'runner.prompt.md' && !/## \d+\. DRY/.test(text)) f.push(`${name}: no DRY / drill rule`);
  return f;
}

const prompts = () => readdirSync(DIR).filter((n) => n.endsWith('.prompt.md')).map((n) => ({ name: n, text: readFileSync(join(DIR, n), 'utf8') }));

test('P1–P4 every routine prompt holds to the contract', () => {
  const all = prompts();
  assert.ok(all.some((p) => p.name === 'reviewer.prompt.md'), 'COVERAGE LOST: the reviewer prompt is missing');
  for (const name of Object.keys(REQUIRED)) if (existsSync(join(DIR, name))) assert.ok(all.some((p) => p.name === name));
  assert.deepEqual(all.flatMap((p) => promptFindings(p.name, p.text)), []);
});

test('P5 red controls, planted into the real reviewer prompt', () => {
  const real = prompts().find((p) => p.name === 'reviewer.prompt.md').text;
  const has = (text, re) => promptFindings('reviewer.prompt.md', text).some((x) => re.test(x));
  const moved = real.replace('## 1. Standby check — always first', '## 0. Pick a PR first\n\nx\n\n## 1. Standby check — always first');
  assert.notEqual(moved, real);
  assert.ok(has(moved, /first step is "0\. Pick a PR first"/));
  assert.ok(has(real.replace('`REVIEW_CLAIM_STALE_H` (2 hours)', '`REVIEW_CLAIM_STALE_H` (4 hours)'), /REVIEW_CLAIM_STALE_H says 4/));
  assert.ok(has(`${real}\nThen label it \`approved-by-bot\`.\n`, /`approved-by-bot` is called a label/));
  assert.ok(has(`${real}\nSee C:/Users/owner/notes.md\n`, /C:\/Users path/));
  assert.ok(has(`${real}\ntoken ${['ghp', 'Z9'.repeat(18)].join('_')}\n`, /secret-shaped/));
  assert.ok(has(real.replaceAll('`land-hold`', '`hold`'), /does not name the label land-hold/));
  const fixer = '## 1. Standby check\n`heartbeat.mjs read`\n\nWhen green, merge it.\n';
  assert.ok(promptFindings('fixer.prompt.md', fixer).some((x) => /says merge outside a "never"/.test(x)));
  assert.ok(!promptFindings('fixer.prompt.md', '## 1. Standby check\n`heartbeat.mjs read`\n- Never merge anything.\n').some((x) => /says merge/.test(x)));
  assert.ok(promptFindings('runner.prompt.md', '## 1. Standby check\n`heartbeat.mjs read`\n').some((x) => /no DRY/.test(x)));
});
