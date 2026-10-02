// autopilot-contract.test.mjs — tooling/autopilot/contract.json is the ONE place the
// failover's names and numbers live (lane autopilot-outage, O-LAPTOP-OUTAGE-READS-AS-RED).
//
//   C1  the contract holds the heartbeat, the claim staleness, the labels, the routines
//       and the pipeline-driver switch at the values the lead's brief fixed
//   C2  docs/autopilot/contract.md names every one of them, at the contract's value
//   C3  no tooling/autopilot/*.mjs (bar #1163's two queue modules, named) hard-codes a label name or a threshold the contract
//       holds (a string literal equal to a label; `NAME = <number>` for a threshold)
//   C4  red controls: a planted label literal, a planted threshold, and a doc value
//       that disagrees are each reported
//
// Run:  node --test "tooling/ci/test/autopilot-contract.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripSourceComments } from '../text-reductions.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DIR = join(ROOT, 'tooling/autopilot');
const CONTRACT = JSON.parse(readFileSync(join(DIR, 'contract.json'), 'utf8'));
const DOC = readFileSync(join(ROOT, 'docs/autopilot/contract.md'), 'utf8');

/** Every label the contract defines: private fixed + prefixes, public PR + issue labels. */
export function contractLabels(c) {
  return [...c.labels.fixed, ...c.labels.prefixed, ...c.publicLabels.pr, ...c.publicLabels.issue];
}

/** Every threshold name the contract defines (UPPER_SNAKE keys of its number groups). */
export function contractThresholds(c) {
  const up = (o) => Object.keys(o).filter((k) => /^[A-Z][A-Z0-9_]+$/.test(k));
  return [...up(c.thresholds), ...up(c.heartbeat), ...up(c.claimStaleness), ...up(c.watch ?? {}), ...up(c.runner ?? {})];
}

/** One source file → findings. Comments are stripped first; a literal in prose is fine. */
export function hardcodedFindings(rel, source, c) {
  const code = stripSourceComments(source, '.mjs');
  const f = [];
  const labels = new Set(contractLabels(c));
  for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n$]|\\.)*)\1/g)) {
    if (labels.has(m[2])) f.push(`${rel}: hard-coded label ${JSON.stringify(m[2])} — read it from contract.json`);
  }
  for (const t of contractThresholds(c)) {
    if (new RegExp(`\\b${t}\\s*[:=]\\s*\\d`).test(code)) f.push(`${rel}: hard-coded threshold ${t} — read it from contract.json`);
  }
  return f;
}

/** The doc against the contract → findings. */
export function docFindings(doc, c) {
  const f = [];
  for (const l of contractLabels(c)) if (!doc.includes(`\`${l}`)) f.push(`label ${l} is not named in the doc`);
  const numbers = { ...c.thresholds, ...Object.fromEntries(Object.entries(c.heartbeat).filter(([k]) => /^[A-Z]/.test(k))), ...c.claimStaleness, ...(c.watch ?? {}), ...Object.fromEntries(Object.entries(c.runner ?? {}).filter(([k]) => /^[A-Z]/.test(k))) };
  for (const [k, v] of Object.entries(numbers)) {
    const m = new RegExp(`\`${k}\`\\s*=\\s*(\\d+)`).exec(doc);
    if (!m) f.push(`threshold ${k} is not stated as \`${k}\` = <value> in the doc`);
    else if (Number(m[1]) !== v) f.push(`threshold ${k}: the doc says ${m[1]}, the contract ${v}`);
  }
  for (const r of c.routines) {
    const row = new RegExp(`\\| \`${r.id}\` \\| Acct${r.account} \\| :${String(r.minute).padStart(2, '0')} \\|`);
    if (!row.test(doc)) f.push(`routine ${r.id} (Acct${r.account}, :${r.minute}) is not in the doc's routine table`);
  }
  if (!doc.includes(`\`${c.heartbeat.ref}\``) || !doc.includes(`\`${c.heartbeat.file}\``)) f.push('the heartbeat ref or file is not named');
  for (const s of c.heartbeat.states) if (!doc.includes(`\`${s}\``)) f.push(`state ${s} is not named`);
  if (!doc.includes(`\`pipelineDriverFallback\`: ${c.pipelineDriverFallback}`)) f.push('pipelineDriverFallback is not stated at its value');
  return f;
}

/** The lane-queue modules of autopilot-queue-issues (#1163), stacked under this club and
 *  not this club's to edit: they spell their queue labels as literals. Named here, not
 *  pattern-matched, so a NEW module is always scanned; the test below reds if one of these
 *  disappears (the exemption must then be deleted, never left to cover a stranger). */
export const QUEUE_LANE_MODULES = Object.freeze(['issue-queue.mjs', 'queue-migrate.mjs']);

const sources = () => readdirSync(DIR).filter((n) => n.endsWith('.mjs') && !QUEUE_LANE_MODULES.includes(n)).map((n) => ({ rel: `tooling/autopilot/${n}`, text: readFileSync(join(DIR, n), 'utf8') }));

test('C1 the contract holds the brief’s values', () => {
  assert.equal(CONTRACT.heartbeat.ref, 'refs/lead/heartbeat', 'a full ref name, never a branch (refs/heads/ starts a Pages build every beat)');
  assert.equal(CONTRACT.heartbeat.file, 'beat.json');
  assert.equal(CONTRACT.heartbeat.schemaVersion, 1);
  assert.deepEqual(CONTRACT.heartbeat.modes, ['primary', 'handover', 'drill']);
  assert.equal(CONTRACT.heartbeat.host, 'laptop');
  assert.equal(CONTRACT.thresholds.HEARTBEAT_STALE_MIN, 30, 'STALE_MIN');
  assert.equal(CONTRACT.heartbeat.FUTURE_SKEW_MIN, 5);
  assert.equal(CONTRACT.heartbeat.DEGRADED_MAX_H, 72);
  assert.equal(CONTRACT.thresholds.CLAIM_STALE_H, 6);
  assert.equal(CONTRACT.thresholds.CLAIM_SETTLE_S, 90);
  assert.deepEqual(CONTRACT.claimStaleness, { REVIEW_CLAIM_STALE_H: 2, FIX_CLAIM_STALE_H: 3, RUNNER_INFLIGHT_MAX: 3 });
  assert.deepEqual(CONTRACT.publicLabels.pr, ['land-ok', 'land-hold', 'needs-review', 'review:approve', 'review:changes', 'fix-first']);
  for (const l of ['land-freeze', 'laptop-off']) assert.ok(CONTRACT.publicLabels.issue.includes(l), l);
  for (const l of ['cloud-lane', 'ready', 'blocked', 'pr-open', 'done', 'failed', 'drill']) assert.ok(CONTRACT.labels.fixed.includes(l), l);
  for (const l of ['claimed:', 'prio:', 'acct:']) assert.ok(CONTRACT.labels.prefixed.includes(l), l);
  assert.deepEqual(CONTRACT.routines.map((r) => `${r.id}/${r.account}/${r.minute}`), ['reviewer/1/5', 'runner-a/3/20', 'fixer/3/35', 'runner-b/1/50']);
  assert.equal(CONTRACT.pipelineDriverFallback, false);
});

test('C2 docs/autopilot/contract.md names every label, threshold, routine and state at its value', () => {
  assert.deepEqual(docFindings(DOC, CONTRACT), []);
});

test('C3 no tooling/autopilot/*.mjs hard-codes a contract label or threshold', () => {
  const all = sources();
  for (const m of ['cli.mjs', 'heartbeat.mjs']) assert.ok(all.some((s) => s.rel.endsWith(`/${m}`)), `COVERAGE LOST: ${m} was not scanned`);
  assert.deepEqual(all.flatMap((s) => hardcodedFindings(s.rel, s.text, CONTRACT)), []);
});

test('C3b the exemption names only modules that exist, and every other module is scanned', () => {
  const all = readdirSync(DIR).filter((n) => n.endsWith('.mjs'));
  for (const m of QUEUE_LANE_MODULES) assert.ok(all.includes(m), `${m} is exempt but gone: delete it from QUEUE_LANE_MODULES`);
  assert.equal(sources().length, all.length - QUEUE_LANE_MODULES.length);
});

test('C4 red controls: a planted label, a planted threshold and a wrong doc value are each reported', () => {
  const hb = sources().find((s) => s.rel.endsWith('/heartbeat.mjs'));
  assert.ok(hb, 'heartbeat.mjs is scanned');
  const label = hardcodedFindings(hb.rel, `${hb.text}\nconst L = 'needs-review';\n`, CONTRACT);
  assert.ok(label.some((x) => /hard-coded label "needs-review"/.test(x)), label.join('\n'));
  const thr = hardcodedFindings(hb.rel, `${hb.text}\nconst RUNNER_INFLIGHT_MAX = 3;\n`, CONTRACT);
  assert.ok(thr.some((x) => /hard-coded threshold RUNNER_INFLIGHT_MAX/.test(x)), thr.join('\n'));
  // A label in a comment is prose, not code.
  assert.deepEqual(hardcodedFindings(hb.rel, `${hb.text}\n// 'needs-review' is a label\n`, CONTRACT), []);
  const wrong = DOC.replace(/`FIX_CLAIM_STALE_H` = 3/, '`FIX_CLAIM_STALE_H` = 4');
  assert.notEqual(wrong, DOC);
  assert.ok(docFindings(wrong, CONTRACT).some((x) => /FIX_CLAIM_STALE_H: the doc says 4/.test(x)));
  const noRoutine = DOC.replace(/\| `fixer` \| Acct3 \| :35 \|/, '| `fixer` | Acct1 | :35 |');
  assert.notEqual(noRoutine, DOC);
  assert.ok(docFindings(noRoutine, CONTRACT).some((x) => /routine fixer/.test(x)));
});
