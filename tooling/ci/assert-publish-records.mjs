#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-publish-records.mjs — [pipeline 10]D-9's WORKFLOW LIMB.
//
// D-9: "For each channel in an app's declared set, a recorded marker names what
// is live; a submission or upload workflow that ends without writing one fails."
//
// 🔴 THE SECOND LIMB'S RECORDED REASON FOR BEING GREEN HAD EXPIRED, AND THAT IS
// WHY THIS FILE EXISTS. The status in 10-distribution-store.md says the limb
// "quantifies over an empty set — there are no submission or upload workflows".
// That was true when it was written. Four have landed since (`submit-play.yml`,
// `submit-appstore.yml`, `submit-snap.yml`, `submit-windows-store.yml`), none of
// them writes a record, and NOTHING NOTICED — because no guard read workflow YAML
// looking for the call. A green built on a premise that has since become false is
// indistinguishable from a green built on a check, right up until it matters.
//
// ── WHAT IT PARSES ───────────────────────────────────────────────────────────
// tooling/channel-register.json is the SUBJECT SET, never a list in this file.
// A hand-typed list of publishing workflows shrinks silently: it covers what
// somebody remembered, and the day a fifth store lane lands it covers four.
//
//   · every row with `served: true`      → its `lane.workflow` + `lane.job`
//                                          must record every {app}-expansion of
//                                          its `deploymentEnvironment`.
//   · every row with `submittable: true` → its `submission.workflow` +
//                                          `submission.job` + `submission.script`.
//
// The workflows are read through tooling/ci/workflow-scan.mjs — the same parse
// four other guards use, which already knows that `run: >` folds one command
// over a dozen lines and `run: |` is a dozen commands. A line-anchored regex
// over `submit-play.yml` sees `--build-number=${{` and nothing else.
//
// ── WHAT MAKES IT FAIL ───────────────────────────────────────────────────────
// 1. A SERVED channel's lane job contains no `record-deployment.mjs` call for
//    one of its environments. (Recorded failing case: delete the "Record the
//    deployed SHA" step from deploy-web.yml ⇒ exit 1. Run against the real tree,
//    not a fixture — see the note at the bottom of this header.)
// 2. A submission step that CAN PUBLISH — i.e. its shell segment does not carry
//    a literal `--dry-run` — in a job that can finish without a record step.
//    Fail-closed: a mode assembled from `${{ … }}` is NOT statically a rehearsal
//    and is graded as publishing. That is the whole mechanism by which this
//    guard stops being vacuous the instant a real submission becomes possible.
// 3. A REHEARSAL job that writes a record anyway. A `--dry-run` contacts nobody;
//    a ledger row for it is a fiction, and a fiction in this ledger is worse
//    than a gap, because a gap is visible.
// 4. A record step whose `--state` is not one a SUBMITTING RUN may assert.
//    `SUBMIT_TIME_STATES` lives in deployment-record.mjs and is `['in_review']`:
//    an upload finishing means *we submitted*, never *the store approved*. See
//    that file for the argument; this is where it is enforced.
// 5. A record step for a STORE environment with no `--listing-url` — the static
//    mirror of record-deployment.mjs's runtime refusal, so it is caught in CI
//    rather than in the middle of the one submission that mattered.
// 6. A record step that the job can SKIP: a step-level `if:`, or
//    `continue-on-error: true`. "Ends without writing one" is D-9's own wording,
//    and a conditional step is exactly how a job ends without writing one while
//    the YAML still contains the call. (A JOB-level `if:` is fine and is not
//    flagged — it gates the publish step and the record step together.)
//
// ── THE FLOOR ────────────────────────────────────────────────────────────────
// REQUIRED_COVERAGE is derived from the register, never typed, and every part of
// it must be > 0. The failure this repo keeps re-learning is not a broken check,
// it is a check that ranges over nothing and prints ok — so: zero served rows,
// zero submittable rows, zero expanded environments, or any submittable row whose
// declared script cannot be found in its declared job, are all COVERAGE LOST
// rather than a pass. Plus an accounting identity: a deliberately different FLAT
// regex over every workflow must attribute every `record-deployment.mjs` it finds
// to a call this parse also found. A parser that silently stops seeing lines is
// the one failure mode a parser-based guard cannot self-diagnose any other way.
//
// ⚠️ THE PUBLISH BRANCH HAS NO INSTANCES TODAY AND THE GUARD SAYS SO ON EVERY
// RUN rather than passing quietly. All six submission invocations are rehearsals;
// no publisher account exists ([10]D-4 / OWNER_QUEUE A-2, A-3, A-4, A-6), so a
// real submission is owner-gated and cannot be produced by any amount of agent
// work. Printing the census is what keeps rule 2 from being an assertion that
// cannot fail: the moment a `--dry-run` is removed, the count moves and the rule
// bites.
//
// Usage:  node tooling/ci/assert-publish-records.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow, parseAllWorkflows, shellSegments, RECORD_CALL, expandMatrixEnvironment } from './workflow-scan.mjs';
import { resolveEnvironment, STATES, SUBMIT_TIME_STATES, STATE_MEANING } from './deployment-record.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_REL = 'sites/_shared/_data/apps.json';
const RECORDER = 'record-deployment.mjs';

const problems = [];
const prints = [];

/** Structural failure — the scan itself is broken, so nothing it reports means
 *  anything. Exits immediately rather than joining the problem list, because a
 *  guard that under-reaches and then lists zero problems reads as a pass. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  process.exit(1);
}

function readJson(rel) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) coverageLost([`${rel} does not exist, so the subject set cannot be derived at all.`]);
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch (e) {
    coverageLost([`${rel} does not parse (${e.message}), so the subject set cannot be derived.`]);
  }
}

// ── THE SUBJECT SET, DERIVED ─────────────────────────────────────────────────
const register = readJson(REGISTER_REL);
const apps = readJson(APPS_REL);
const rows = Array.isArray(register?.channels) ? register.channels : [];
const servedRows = rows.filter((r) => r?.served === true);
const submittableRows = rows.filter((r) => r?.submittable === true);

/** The app slugs a matrix-parameterised record call expands over — the SAME
 *  catalogue `expandEnvironments` below builds the required set from, so a lane
 *  written as `${{ matrix.app }}-web` is compared against the identical
 *  right-hand side rather than a second reading of the app set. */
const APP_SLUGS = (Array.isArray(apps) ? apps : []).map((a) => a?.slug).filter((s) => typeof s === 'string');

/** `{app}-web` × the apps that actually declare that channel's platforms. The
 *  join is the register's own template, so the required set grows the day a
 *  channel is served or an app is stamped, and cannot be shrunk to the ones that
 *  already pass. */
function expandEnvironments(row) {
  const tpl = row?.deploymentEnvironment;
  if (typeof tpl !== 'string' || !tpl.includes('{app}')) return null;
  const platforms = Array.isArray(row.platforms) ? row.platforms : [];
  return (Array.isArray(apps) ? apps : [])
    .filter((a) => typeof a?.slug === 'string' && Array.isArray(a.platforms) && platforms.some((p) => a.platforms.includes(p)))
    .map((a) => tpl.replace('{app}', a.slug));
}

const REQUIRED_COVERAGE = {
  servedRows: servedRows.length,
  submittableRows: submittableRows.length,
  requiredEnvironments: servedRows.flatMap((r) => expandEnvironments(r) ?? []).length,
};
for (const [what, n] of Object.entries(REQUIRED_COVERAGE)) {
  if (n > 0) continue;
  coverageLost([
    `REQUIRED_COVERAGE.${what} is 0, so this guard would range over nothing and print ok.`,
    `Derived from ${REGISTER_REL}${what === 'requiredEnvironments' ? ` × ${APPS_REL}` : ''}.`,
    'A publishing-record guard with no publishing lanes is the exact shape [10]D-9 sat in for a month.',
  ]);
}

// ── WORKFLOW READING ─────────────────────────────────────────────────────────
/** Every logical `run:` line of one job, as `{ n, text }`. */
function jobRunLines(job) {
  return job.logical.filter((l) => /(^|\s)run:\s*\S/.test(l.text));
}

/** Does the step containing this line carry its own `if:` or
 *  `continue-on-error: true`? Steps begin with `- name:` / `- uses:` / `- run:` /
 *  `- id:`; anything between that marker and the line belongs to the step. */
function stepGuards(job, lineNumber) {
  const found = [];
  let inStep = false;
  for (const l of job.logical) {
    if (/^\s*-\s+(name|uses|run|id):/.test(l.text)) {
      if (inStep) break;
      inStep = true;
      found.length = 0;
    }
    if (!inStep) continue;
    if (/^\s*if:\s*\S/.test(l.text)) found.push({ n: l.n, kind: 'a step-level `if:`' });
    if (/^\s*continue-on-error:\s*true\b/.test(l.text)) found.push({ n: l.n, kind: '`continue-on-error: true`' });
    if (l.n === lineNumber) return found;
  }
  return [];
}

/** Every `record-deployment.mjs <env> …` call in one job, one per shell segment.
 *  Segment-wise because `a ; node record-deployment.mjs x` and a `run: |` block
 *  are the same text to a line matcher and different commands to a shell.
 *
 *  The call-site reader and the matrix expansion are workflow-scan.mjs's — see
 *  the block above `RECORD_CALL` there for the three disagreeing copies this
 *  replaced. A `${{ matrix.app }}-web` step records EVERY app's environment,
 *  which is strictly more than the literal it replaced. */
function recordCalls(job, appSlugs = APP_SLUGS) {
  const out = [];
  for (const line of jobRunLines(job)) {
    for (const seg of shellSegments(line.text)) {
      RECORD_CALL.lastIndex = 0;
      const m = RECORD_CALL.exec(seg);
      if (!m) continue;
      for (const environment of expandMatrixEnvironment(m[1], appSlugs)) {
        out.push({
          n: line.n,
          environment,
          written: m[1],
          state: (seg.match(/--state\s+(\S+)/) ?? [])[1] ?? null,
          listingUrl: (seg.match(/--listing-url\s+(\S+)/) ?? [])[1] ?? null,
          guards: stepGuards(job, line.n),
        });
      }
    }
  }
  return out;
}

function openWorkflow(rel, why) {
  const wf = parseWorkflow(ROOT, rel);
  if (wf === null) coverageLost([`${REGISTER_REL} names ${rel} as ${why}, and that file does not exist.`]);
  if (wf.rawStepCount === 0) {
    coverageLost([`${rel} parsed to ZERO steps, so nothing in it could ever be found.`, 'The parse is broken, not the workflow.']);
  }
  return wf;
}

function openJob(wf, jobName, why) {
  const job = wf.jobs.get(jobName);
  if (!job) {
    coverageLost([
      `${REGISTER_REL} names job "${jobName}" in ${wf.rel} as ${why}, and that job is not there.`,
      `Jobs present: ${[...wf.jobs.keys()].join(', ') || '(none)'}.`,
    ]);
  }
  return job;
}

// ── 1. SERVED CHANNELS — the deploy lane must record what it shipped ─────────
const seenRecordLines = new Set();
let deployRecordCalls = 0;

for (const row of servedRows) {
  const envs = expandEnvironments(row);
  if (envs === null || envs.length === 0) {
    coverageLost([
      `served channel "${row.id}" expands to NO environment.`,
      `Its \`deploymentEnvironment\` is ${JSON.stringify(row?.deploymentEnvironment)} and it must contain "{app}".`,
    ]);
  }
  const rel = row?.lane?.workflow;
  if (typeof rel !== 'string') {
    coverageLost([`served channel "${row.id}" declares no \`lane.workflow\`, so nothing can be checked for it.`]);
  }
  const wf = openWorkflow(rel, `the served "${row.id}" channel's lane`);
  const job = openJob(wf, row.lane.job, `the served "${row.id}" channel's lane job`);
  const calls = recordCalls(job);
  for (const c of calls) seenRecordLines.add(`${wf.rel}:${c.n}`);
  deployRecordCalls += calls.length;

  for (const env of envs) {
    const hit = calls.find((c) => c.environment === env);
    if (!hit) {
      problems.push(
        `[10]D-9 · the "${row.id}" channel is SERVED and ${wf.rel} job "${row.lane.job}" never records "${env}". ` +
          `A deploy that ships and records nothing makes "what is live?" answerable only by inference, which is ` +
          `the state this requirement abolishes. Add a step running \`node tooling/ci/${RECORDER} ${env} <url>\`. ` +
          `(Found ${calls.length} record call(s) in that job: ${calls.map((c) => `${c.environment}@:${c.n}`).join(', ') || 'none'}.)`,
      );
      continue;
    }
    for (const g of hit.guards) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${g.n} — the step recording "${env}" carries ${g.kind}, so the job can finish ` +
          'having deployed and not recorded. D-9\'s wording is "ends without writing one fails"; a skippable ' +
          'record step is precisely how a job ends without writing one while the call is still in the YAML.',
      );
    }
  }
}

// ── 2. SUBMITTABLE CHANNELS — rehearsal vs. real, and what each may claim ────
let rehearsals = 0;
let publishing = 0;
const censusByRow = [];

for (const row of submittableRows) {
  const sub = row?.submission;
  if (!sub || typeof sub.script !== 'string' || typeof sub.workflow !== 'string' || typeof sub.job !== 'string') {
    coverageLost([
      `submittable channel "${row.id}" has no complete \`submission\` block (script + workflow + job).`,
      'Without it there is no step to classify, and this guard would silently cover one channel fewer.',
    ]);
  }
  const wf = openWorkflow(sub.workflow, `the "${row.id}" channel's submission workflow`);
  const job = openJob(wf, sub.job, `the "${row.id}" channel's submission job`);
  const scriptName = sub.script.split('/').pop();

  const invocations = [];
  for (const line of jobRunLines(job)) {
    for (const seg of shellSegments(line.text)) {
      if (!seg.includes(scriptName)) continue;
      // ONE SCRIPT CAN SERVE TWO ROWS — submit-appstore.mjs takes `--channel`
      // and validates whichever of the two Apple rows it is pointed at, because
      // both authenticate with the same App Store Connect key. A `--channel`
      // naming a DIFFERENT register row is that row's invocation, not this
      // one's; counting it here would grade macOS's rehearsal against iOS twice
      // and inflate the census the emptiness argument rests on.
      const channelFlag = (seg.match(/--channel\s+([A-Za-z0-9._-]+)/) ?? [])[1] ?? null;
      if (channelFlag !== null && channelFlag !== row.id && rows.some((r) => r?.id === channelFlag)) continue;
      const interpolated = /\$\{\{/.test(seg);
      const literalDryRun = /(^|\s)--dry-run(\s|$)/.test(seg);
      invocations.push({ n: line.n, canPublish: !(literalDryRun && !interpolated), literalDryRun, interpolated, seg: seg.trim() });
    }
  }
  if (invocations.length === 0) {
    coverageLost([
      `${REGISTER_REL} says the "${row.id}" channel submits via ${sub.script} in ${wf.rel} job "${sub.job}", and no step there runs it.`,
      'Either the register points at nothing or this parse has stopped seeing run steps. Both are the scan breaking, not the tree.',
    ]);
  }

  const calls = recordCalls(job);
  for (const c of calls) seenRecordLines.add(`${wf.rel}:${c.n}`);
  const rowEnvTemplate = row.deploymentEnvironment;

  for (const inv of invocations) {
    if (!inv.canPublish) {
      rehearsals++;
      const after = calls.filter((c) => c.n !== null);
      if (after.length > 0) {
        problems.push(
          `[10]D-9 · ${wf.rel}:${after[0].n} — job "${sub.job}" writes a deployment record, and its only ` +
            `invocation(s) of ${scriptName} are rehearsals (\`--dry-run\`, which contacts nobody). A ledger row ` +
            'for a submission that never happened is worse than a missing one: a gap is visible, a fiction is not.',
        );
      }
      continue;
    }
    publishing++;
    const record = calls.find((c) => {
      const r = resolveEnvironment(register, c.environment);
      return r !== null && r.channel?.id === row.id && c.n > inv.n;
    });
    if (!record) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${inv.n} — job "${sub.job}" can perform a REAL submission on the "${row.id}" ` +
          `channel (${inv.interpolated ? 'its mode is assembled from a `${{ … }}` expression, so it is not statically a rehearsal' : 'no `--dry-run` on this command'}) ` +
          `and no later step records it. Add, as the last step of the job:\n` +
          `      run: node tooling/ci/${RECORDER} ${String(rowEnvTemplate).replace('{app}', '<app>')} --state ${SUBMIT_TIME_STATES[0]} --listing-url <url>`,
      );
      continue;
    }
    for (const g of record.guards) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${g.n} — the record step for a real "${row.id}" submission carries ${g.kind}, ` +
          'so the job can submit and then end without writing the record.',
      );
    }
  }

  // Rules 4 and 5 apply to EVERY record call in a submission workflow, whether
  // or not this run classified a publishing invocation — the overstatement is
  // wrong in a rehearsal lane too, and cheaper to catch before it is copied.
  for (const c of calls) {
    if (c.state !== null && !SUBMIT_TIME_STATES.includes(c.state) && !/\$\{\{/.test(c.state)) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${c.n} records \`--state ${c.state}\` from the "${row.id}" SUBMISSION workflow. ` +
          `A submitting run knows one fact — it submitted — and "${SUBMIT_TIME_STATES[0]}" is the only state that ` +
          `says it. "${c.state}": ${STATE_MEANING[c.state] ?? 'not a state at all — expected one of ' + STATES.join(', ')} ` +
          'A later run (a status poll, or a dispatch a human triggers on the review email) writes that transition.',
      );
    }
    if (c.state === null) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${c.n} records a store environment with no \`--state\`. There is no default for a ` +
          'store channel on purpose: a forgotten flag must not be the difference between "we submitted it" and ' +
          '"the store approved it".',
      );
    }
    if (c.listingUrl === null) {
      problems.push(
        `[10]D-9 · ${wf.rel}:${c.n} records a store environment with no \`--listing-url\`. A store record whose ` +
          'listing nobody can open says something shipped and gives no way to look at it — and [12]\'s cross-promo ' +
          'and G-31\'s openStoreListing() fallback both consume exactly that field.',
      );
    }
  }

  censusByRow.push(`${row.id}: ${invocations.length} invocation(s), ${invocations.filter((i) => !i.canPublish).length} rehearsal`);
}

// ── SELF-CHECK: the accounting identity ──────────────────────────────────────
// A deliberately different matcher — flat regex, whole file, no job structure —
// over every workflow in the tree. Every `record-deployment.mjs` it finds must
// be one this parse also reached. The two disagree exactly when the structured
// parse has stopped seeing lines, which is the one failure a parser-based guard
// cannot notice from the inside.
const flatHits = [];
const flatFiles = new Set();
for (const wf of parseAllWorkflows(ROOT)) {
  flatFiles.add(wf.rel);
  for (const l of wf.lines) {
    if (l.text.includes(RECORDER) && /run:|^\s+node\s|^\s+\S+\s+node\s/.test(l.text)) flatHits.push(`${wf.rel}:${l.n}`);
  }
}
// 🔴 THE ZERO-CHECK IS ON THE FILES, NOT ON THE HITS, and the distinction was
// bought the hard way. "Zero record calls found ⇒ COVERAGE LOST" reads right and
// is wrong: zero record calls is ALSO exactly what the defect looks like, so the
// check swallowed its own subject — the real-tree mutation that deletes
// deploy-web.yml's record step reported "this scan is not reading the workflows"
// instead of "the web channel records nothing". An absence the guard exists to
// find must never be reported as the guard being broken. What genuinely cannot
// be true is a DECLARED LANE FILE the directory walk did not reach.
const unreached = [...new Set([
  ...servedRows.map((r) => r?.lane?.workflow),
  ...submittableRows.map((r) => r?.submission?.workflow),
].filter(Boolean))].filter((rel) => !flatFiles.has(rel));
if (unreached.length > 0) {
  coverageLost([
    `${unreached.length} register-declared lane file(s) were opened by name but are NOT in the directory walk:`,
    ...unreached,
    `The walk found ${flatFiles.size} workflow file(s). The scan is broken, not the tree.`,
  ]);
}
const unattributed = flatHits.filter((h) => !seenRecordLines.has(h));
const outsideDeclaredLanes = unattributed.filter((h) => {
  const rel = h.slice(0, h.lastIndexOf(':'));
  // A record call in a workflow no register row declares as a lane is not this
  // guard's business (deploy-workers.yml records `serviceEnvironments`, which
  // are Workers, not channels) — but it must be VISIBLE, never silently dropped.
  return !servedRows.some((r) => r?.lane?.workflow === rel) && !submittableRows.some((r) => r?.submission?.workflow === rel);
});
const missedInsideLanes = unattributed.filter((h) => !outsideDeclaredLanes.includes(h));
if (missedInsideLanes.length > 0) {
  coverageLost([
    `${missedInsideLanes.length} \`${RECORDER}\` call(s) sit inside a register-declared lane file and this parse did not reach them:`,
    ...missedInsideLanes,
    'The structured read is missing lines the flat read can see — the parse is broken, not the tree.',
  ]);
}

// ── REPORT ───────────────────────────────────────────────────────────────────
for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `⬜ SUBMISSION-RECORD LIMB: ${publishing} of ${rehearsals + publishing} submission invocation(s) can perform a REAL ` +
    `submission${publishing === 0 ? ' — so the "must write a record" branch has NO instances today and passes over nothing' : ''}. ` +
    `Per channel — ${censusByRow.join(' · ')}. No publisher account exists ([10]D-4 / OWNER_QUEUE A-2, A-3, A-4, A-6), ` +
    'so a real submission is OWNER-GATED and cannot be produced by agent work. This branch bites the moment a ' +
    '`--dry-run` is removed or made conditional.',
);
if (outsideDeclaredLanes.length > 0) {
  console.log(
    `⬜ ${outsideDeclaredLanes.length} record call(s) outside any register-declared channel lane, printed not hidden ` +
      `(these are \`serviceEnvironments\` — backend Workers, not release channels): ${outsideDeclaredLanes.join(', ')}.`,
  );
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} publishing lane(s) can finish without a [10]D-9 record:`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

console.log(
  `ok  publish records — ${REQUIRED_COVERAGE.servedRows} served channel(s) → ${REQUIRED_COVERAGE.requiredEnvironments} ` +
    `required environment(s), all recorded by their declared lane job (${deployRecordCalls} call(s)); ` +
    `${REQUIRED_COVERAGE.submittableRows} submittable channel(s) → ${rehearsals + publishing} submission invocation(s) ` +
    `classified in their declared job; ${flatHits.length} record call(s) found flat, all attributed.`,
);
