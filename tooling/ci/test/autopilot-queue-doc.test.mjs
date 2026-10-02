// autopilot-queue-doc.test.mjs — docs/autopilot/queue.md says only what
// tooling/autopilot/contract.json holds (lane autopilot-queue-issues).
//
//   QD1  every label in the doc's Labels table is a contract label, and the reverse
//   QD2  every threshold the doc names (UPPER_SNAKE) is in the contract, at the value the
//        doc states beside it, and every contract threshold is named
//   QD3  the priorities, accounts, verbs and body limit the doc states are the contract's
//   QD4  red controls: an invented label, a renamed threshold and a wrong value, each
//        planted into the real doc's text in memory, are each reported
//
// Run:  node --test "tooling/ci/test/autopilot-queue-doc.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = readFileSync(resolve(ROOT, 'docs/autopilot/queue.md'), 'utf8');
const CONTRACT = JSON.parse(readFileSync(resolve(ROOT, 'tooling/autopilot/contract.json'), 'utf8'));

const section = (doc, heading) => {
  const at = doc.indexOf(`\n## ${heading}\n`);
  if (at < 0) return null;
  const rest = doc.slice(at + heading.length + 5);
  const end = rest.search(/\n## /);
  return end < 0 ? rest : rest.slice(0, end);
};

/** The doc against the contract → findings (empty when they agree). */
function docFindings(doc, contract) {
  const f = [];
  const labels = section(doc, 'Labels');
  if (labels === null) return ['the doc has no "## Labels" section'];
  const rows = [...labels.matchAll(/^\| `([^`]+)` \|(.*)\|$/gm)];
  if (rows.length === 0) f.push('the Labels table has no rows');
  const named = new Set();
  for (const [, label, meaning] of rows) {
    const m = /^([a-z]+:)<[^>]+>$/.exec(label);
    if (m) {
      if (!contract.labels.prefixed.includes(m[1])) f.push(`label ${label}: prefix ${m[1]} is not in the contract`);
      named.add(m[1]);
      if (m[1] === 'prio:') {
        const listed = /one of ([\d., ]+)/.exec(meaning)?.[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (JSON.stringify(listed) !== JSON.stringify(contract.priorities)) f.push(`prio values ${JSON.stringify(listed)} are not the contract's ${JSON.stringify(contract.priorities)}`);
      }
      if (m[1] === 'acct:') {
        const listed = [...meaning.matchAll(/\b(\d+)\b/g)].map((x) => x[1]);
        if (JSON.stringify(listed) !== JSON.stringify(contract.accounts)) f.push(`acct values ${JSON.stringify(listed)} are not the contract's ${JSON.stringify(contract.accounts)}`);
      }
    } else {
      if (!contract.labels.fixed.includes(label)) f.push(`label ${label} is not in the contract`);
      named.add(label);
    }
  }
  for (const l of [...contract.labels.fixed, ...contract.labels.prefixed]) if (!named.has(l)) f.push(`contract label ${l} is missing from the doc's Labels table`);

  const thresholds = new Set();
  for (const m of doc.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`(?:\s*\(([\d,]+)[^)]*\))?/g)) {
    const [, name, value] = m;
    thresholds.add(name);
    if (!(name in contract.thresholds)) { f.push(`threshold ${name} is not in the contract`); continue; }
    if (value !== undefined && Number(value.replace(/,/g, '')) !== contract.thresholds[name]) f.push(`threshold ${name}: the doc says ${value}, the contract ${contract.thresholds[name]}`);
  }
  for (const t of Object.keys(contract.thresholds)) if (!thresholds.has(t)) f.push(`contract threshold ${t} is not named in the doc`);

  const limit = /`bodyLimit` \(([\d,]+) characters\)/.exec(doc)?.[1];
  if (Number(String(limit).replace(/,/g, '')) !== contract.bodyLimit) f.push(`the doc's body limit ${limit} is not the contract's ${contract.bodyLimit}`);
  for (const v of contract.verbs) if (!doc.includes(`\`${v}`) && !new RegExp(`\\b${v}\\b`).test(doc)) f.push(`verb ${v} is not described`);
  if (!doc.includes(`\`${contract.laptopRunner}\``)) f.push(`the laptop runner id ${contract.laptopRunner} is not named`);
  return f;
}

test('QD1–QD3 the real doc and the real contract agree', () => {
  assert.deepEqual(docFindings(DOC, CONTRACT), []);
});

test('QD4 red controls: each planted disagreement is reported', () => {
  const invented = DOC.replace('| `drill` |', '| `drill` | x |\n| `nonsense-label` |');
  assert.ok(docFindings(invented, CONTRACT).some((x) => /nonsense-label is not in the contract/.test(x)));
  const renamed = DOC.replace('`CLAIM_SETTLE_S` (90', '`CLAIM_SETTLE_SECS` (90');
  assert.notEqual(renamed, DOC);
  const r = docFindings(renamed, CONTRACT);
  assert.ok(r.some((x) => /CLAIM_SETTLE_SECS is not in the contract/.test(x)), r.join('\n'));
  assert.ok(r.some((x) => /contract threshold CLAIM_SETTLE_S is not named/.test(x)));
  const wrong = DOC.replace('`CLAIM_STALE_H`\n   (6 hours)', '`CLAIM_STALE_H`\n   (8 hours)');
  assert.notEqual(wrong, DOC);
  assert.ok(docFindings(wrong, CONTRACT).some((x) => /CLAIM_STALE_H: the doc says 8, the contract 6/.test(x)));
  const dropped = { ...CONTRACT, labels: { ...CONTRACT.labels, fixed: [...CONTRACT.labels.fixed, 'paused'] } };
  assert.ok(docFindings(DOC, dropped).some((x) => /contract label paused is missing/.test(x)));
  const prio = DOC.replace('one of 0.5, 1, 1.5, 2, 2.5, 3', 'one of 1, 2, 3');
  assert.ok(docFindings(prio, CONTRACT).some((x) => /prio values/.test(x)));
});
