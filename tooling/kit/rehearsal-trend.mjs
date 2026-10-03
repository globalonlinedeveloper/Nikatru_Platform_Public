#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// rehearsal-trend.mjs — what changed between two app #2 rehearsals.
// [lane app2-dryrun] Row: O-TIME-TO-SHIP-UNMEASURED.
//
// One rehearsal is a snapshot; the question is the TREND: did shipping app #2
// get faster, and did a manual step become automatic? This reads two
// rehearsal JSONs (tooling/kit/rehearse-app2.mjs --out) and prints, by step
// name: what got faster or slower (by more than 10% AND 5 s, so runner noise is
// not news), what became manual, what became automated, what appeared and what
// disappeared, and the time-to-ship fact before and after.
//
// Usage: node tooling/kit/rehearsal-trend.mjs <previous.json> <newest.json> [--json]
//   The weekly workflow uploads each run as the `app2-rehearsal` artifact; the
//   previous one is `gh run download <run id> -n app2-rehearsal`.
// Exit 0 always for a readable pair (a trend is a report, not a gate); 2 when a
// file is unreadable or is not a rehearsal.
// Tests: tooling/ci/test/rehearse-app2.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOISE_RATIO = 0.1;
const NOISE_SECONDS = 5;

/** The differences between two rehearsal reports, by step name. */
export function trend(prev, next) {
  const before = new Map(prev.steps.map((s) => [s.name, s]));
  const after = new Map(next.steps.map((s) => [s.name, s]));
  const out = { faster: [], slower: [], newlyManual: [], newlyAutomated: [], added: [], removed: [], newlyFailing: [], newlyPassing: [] };
  for (const [name, b] of after) {
    const a = before.get(name);
    if (!a) {
      out.added.push(name);
      continue;
    }
    if (!a.manual && b.manual) out.newlyManual.push(name);
    if (a.manual && !b.manual) out.newlyAutomated.push(name);
    if (a.result !== 'fail' && b.result === 'fail') out.newlyFailing.push(name);
    if (a.result === 'fail' && b.result === 'pass') out.newlyPassing.push(name);
    if (!a.manual && !b.manual && a.result === 'pass' && b.result === 'pass') {
      const d = b.seconds - a.seconds;
      if (Math.abs(d) > NOISE_SECONDS && Math.abs(d) > NOISE_RATIO * a.seconds) (d < 0 ? out.faster : out.slower).push({ name, from: a.seconds, to: b.seconds });
    }
  }
  for (const name of before.keys()) if (!after.has(name)) out.removed.push(name);
  out.timeToShip = { from: prev.totals?.timeToShip ?? null, to: next.totals?.timeToShip ?? null };
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [p, n] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let prev;
  let next;
  try {
    prev = JSON.parse(readFileSync(p, 'utf8'));
    next = JSON.parse(readFileSync(n, 'utf8'));
    if (!Array.isArray(prev.steps) || !Array.isArray(next.steps)) throw new Error('no `steps` array');
  } catch (e) {
    console.error(`rehearsal-trend: COVERAGE LOST — usage: rehearsal-trend.mjs <previous.json> <newest.json> (${e.message})`);
    process.exit(2);
  }
  const t = trend(prev, next);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(t, null, 2));
  } else {
    const ts = (x) => (x ? `${x.value} ${x.unit} (asOf ${x.asOf})` : 'unrecorded');
    console.log(`rehearsal-trend: ${prev.id} (${prev.ranAt}) → ${next.id} (${next.ranAt})`);
    console.log(`  time-to-ship: ${ts(t.timeToShip.from)} → ${ts(t.timeToShip.to)}`);
    for (const s of t.newlyAutomated) console.log(`  ✅ NEWLY AUTOMATED  ${s}`);
    for (const s of t.newlyManual) console.log(`  ✋ NEWLY MANUAL     ${s}`);
    for (const s of t.newlyFailing) console.log(`  ✗ NEWLY FAILING    ${s}`);
    for (const s of t.newlyPassing) console.log(`  ✓ NEWLY PASSING    ${s}`);
    for (const s of t.faster) console.log(`  ⇣ faster           ${s.name}: ${s.from}s → ${s.to}s`);
    for (const s of t.slower) console.log(`  ⇡ slower           ${s.name}: ${s.from}s → ${s.to}s`);
    for (const s of t.added) console.log(`  + new step         ${s}`);
    for (const s of t.removed) console.log(`  - gone             ${s}`);
  }
}
