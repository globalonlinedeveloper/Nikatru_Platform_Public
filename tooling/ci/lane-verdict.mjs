#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// lane-verdict.mjs — a lane callee's one verdict, and the only licence to skip. [ADR 095]
//
// A lane callee (.github/workflows/lane-<name>.yml) is `on: workflow_call` only.
// ci.yml calls it with no `if:`, and ci-gate needs the call job, whose result is
// the callee's conclusion. Inside the callee the work jobs carry
// `if: needs.detect.outputs.affected == 'true'`, so on a change the lane does not
// care about they report `skipped` — and a skipped job does not fail a workflow.
// Without this job, a detect that wrongly said false, or a work job whose `if:` was
// edited to something that is never true, would conclude the callee `success`, and
// ci-gate's own `skipped` clause (assert-green-means-ran A3) would never see it:
// ci-gate sees ONE call job, not the jobs inside it.
//
// So every callee ends in a job that `needs` every other job in its file, runs
// `if: always()` (green-means-ran A8 asserts both), and runs this over
// `toJSON(needs)`. It is RED when:
//   · any need is `failure` or `cancelled`;
//   · `detect` is not a need, or is not `success`, or its `affected` output is
//     neither 'true' nor 'false' — no verdict from the detector licenses nothing;
//   · a work job is `skipped` although detect said affected=true;
//   · a need reports a result outside success/skipped/failure/cancelled.
// A work job `skipped` with detect's affected=false is the ONE licensed skip. This is
// extensions-ci.yml's `ci-required` licence (a skip only under discover's count=0),
// generalised into one script every lane callee shares.
//
// Usage:  LANE_NEEDS='${{ toJSON(needs) }}' node tooling/ci/lane-verdict.mjs [--detect <job>]
// Exit 0 = every need ran green or was licensed to skip. Exit 1 = red.
// Exit 2 = COVERAGE LOST: LANE_NEEDS is absent or unparseable, or names no work job —
//          a verdict over nothing is never a pass.
// ─────────────────────────────────────────────────────────────────────────────
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KNOWN = new Set(['success', 'skipped', 'failure', 'cancelled']);

/**
 * The verdict over one `toJSON(needs)` object.
 * Returns { lines, problems, lost } — `lost` is a COVERAGE LOST reason or null.
 */
export function verdict(needs, detectJob = 'detect') {
  if (needs === null || typeof needs !== 'object' || Array.isArray(needs)) {
    return { lines: [], problems: [], lost: 'the needs object is not a JSON object' };
  }
  const names = Object.keys(needs);
  const work = names.filter((n) => n !== detectJob);
  if (work.length === 0) {
    return { lines: [], problems: [], lost: `needs names no work job besides "${detectJob}" (got [${names.join(', ')}]), so there is nothing to give a verdict on` };
  }
  const lines = names.map((n) => `${n}=${needs[n]?.result ?? '(no result)'}`);
  const problems = [];

  const d = needs[detectJob];
  let affected = null;
  if (d === undefined) {
    problems.push(`"${detectJob}" is not a need of this job, so no skip below can be licensed. The verdict job must need the callee's detect job.`);
  } else if (d.result !== 'success') {
    problems.push(`"${detectJob}" is ${d.result ?? '(no result)'}, not success: the lane never decided whether it was affected, so its skipped jobs are unlicensed.`);
  } else {
    const a = d.outputs?.affected;
    if (a === 'true' || a === 'false') affected = a === 'true';
    else problems.push(`"${detectJob}" succeeded but its \`affected\` output is ${JSON.stringify(a)}, neither 'true' nor 'false'. A detector that said nothing licenses nothing.`);
    if (d.outputs?.reason) lines.push(`${detectJob}.affected=${a} (${d.outputs.reason})`);
  }

  for (const n of names) {
    const r = needs[n]?.result;
    if (!KNOWN.has(r)) {
      problems.push(`"${n}" reports ${JSON.stringify(r)}, which is not one of success/skipped/failure/cancelled.`);
      continue;
    }
    if (r === 'failure' || r === 'cancelled') {
      problems.push(`"${n}" is ${r}.`);
      continue;
    }
    if (n === detectJob || r !== 'skipped') continue;
    if (affected === false) continue; // THE licensed skip
    problems.push(
      affected === true
        ? `"${n}" was SKIPPED although "${detectJob}" said affected=true. The lane's work did not run on a change it claims — a job-level \`if:\` that is never true, or a need that did not succeed.`
        : `"${n}" was skipped, and with no verdict from "${detectJob}" nothing licenses that skip.`,
    );
  }
  return { lines, problems, lost: null };
}

/** The verdict could not be given: exit 2, never a pass. */
function coverageLost(why) {
  console.error(`FAIL COVERAGE LOST — ${why}.`);
  console.error('\nlane-verdict: RED (exit 2 — no verdict over nothing)');
  process.exitCode = 2;
  return 2;
}

function main(argv, env) {
  const i = argv.indexOf('--detect');
  const detectJob = i === -1 ? 'detect' : argv[i + 1];
  const raw = env.LANE_NEEDS;
  if (raw === undefined || raw.trim() === '') {
    return coverageLost('LANE_NEEDS is unset or empty; pass `${{ toJSON(needs) }}` through env:');
  }
  let needs;
  try {
    needs = JSON.parse(raw);
  } catch (e) {
    return coverageLost(`LANE_NEEDS is not JSON (${e.message})`);
  }
  const { lines, problems, lost } = verdict(needs, detectJob);
  if (lost !== null) return coverageLost(lost);
  for (const l of lines) console.log(l);
  if (problems.length) {
    console.error('');
    for (const p of problems) console.log(`::error title=lane-verdict::${p}`);
    console.error('\nlane-verdict: RED');
    return 1;
  }
  console.log(`ok  lane verdict — ${Object.keys(needs).length} need(s), each green or skipped under detect's affected=false`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
