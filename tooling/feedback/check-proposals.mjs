#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-proposals.mjs — grade one triage run's output against the TOOL LAYER
// before the lead reads it (lane feedback-triage, Do 1 and 7).
//
//   node tooling/feedback/check-proposals.mjs --pulled <dir>/reports.json --proposals <dir>/proposals.json
//
// The routine writes proposals.json (docs/ops/feedback-triage.prompt.md, the
// output format). This refuses any kind outside PROPOSAL_KINDS (there is no
// write kind to refuse into), any report id that was not pulled in this run,
// any field a kind does not take, and any link in a proposal's text. It prints
// counts and the refusals' positions, never a proposal's text.
//
// Exit: 0 every proposal is in the tool layer · 1 refused · 2 a file is unreadable.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProposals } from './lib.mjs';

export function check(pulledPath, proposalsPath, log = console.log) {
  let pulled;
  let doc;
  try {
    pulled = JSON.parse(readFileSync(pulledPath, 'utf8'));
    doc = JSON.parse(readFileSync(proposalsPath, 'utf8'));
  } catch (err) {
    log(`check-proposals: COVERAGE LOST — could not read both files (${err?.code ?? err?.name ?? 'Error'})`);
    return 2;
  }
  if (!Array.isArray(pulled)) {
    log('check-proposals: COVERAGE LOST — the pulled file is not an array of reports');
    return 2;
  }
  const v = validateProposals(doc, pulled.map((r) => r?.id));
  if (!v.ok) {
    for (const e of v.errors) log(`check-proposals: ${e}`);
    log(`check-proposals: REFUSED — ${v.errors.length} finding(s); nothing in this output reaches the lead's queue.`);
    return 1;
  }
  const byKind = {};
  for (const p of v.proposals) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
  log(`check-proposals: ok — ${v.proposals.length} proposal(s) over ${pulled.length} report(s): ${JSON.stringify(byKind)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const at = (k) => a[a.indexOf(k) + 1];
  if (!a.includes('--pulled') || !a.includes('--proposals')) {
    console.log('usage: node tooling/feedback/check-proposals.mjs --pulled <reports.json> --proposals <proposals.json>');
    process.exit(2);
  }
  process.exit(check(at('--pulled'), at('--proposals')));
}
