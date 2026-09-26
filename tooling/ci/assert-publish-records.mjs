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
// 6. A record step that the job can SKIP: a NARROWING step-level `if:`, or
//    `continue-on-error: true`. "Ends without writing one" is D-9's own wording,
//    and a conditional step is exactly how a job ends without writing one while
//    the YAML still contains the call. (A JOB-level `if:` is fine and is not
//    flagged — it gates the publish step and the record step together.)
//
// ── 🔴 RULE 6 COULD NOT FAIL AGAINST THE REAL TREE UNTIL 2026-08-09 ──────────
// `stepGuards` set `inStep = true` on the first `- name:`/`- uses:`/`- run:`/
// `- id:` it met and `break`-ed on the SECOND, so it only ever inspected a job's
// FIRST STEP and returned `[]` for every line after it. A record step is the
// LAST step of every deploy job in this repository, so the rule was dead on
// every real lane. Mutation-proven on the shipping tree: giving deploy-web.yml's
// record step `if: github.actor == 'nobody'` — a condition that is never true —
// still printed `ok  publish records`.
//
// 📌 AND ITS FOUR FIXTURE TESTS ALL PASSED, because the fixture job's record
// step is its ONLY step. This is `assert-seams-wired.mjs` repeating exactly:
// a fixture written by the hand that wrote the scan encodes the same
// misunderstanding, and only mutating the REAL tree exposes it. The fixture for
// rule 6 now puts the record step LAST, behind two other steps, which is the
// shape every real lane has.
//
// ── WHAT RULE 6 NOW ALLOWS, AND WHY THAT IS NOT A WEAKENING ─────────────────
// One `if:` form is accepted: `always() && steps.<id>.outcome == 'success'`
// (any number of such conjuncts), where every `<id>` is declared by a step
// EARLIER in the same job. That form is a STRICT WIDENING of the default
// condition every step inherits. The default is `success()` — "every preceding
// step is green" — which already implies those earlier steps are green, so
// every run that recorded before still records, and runs that deployed and then
// failed later record too. There is no input on which it records less.
//
// It exists because the narrow reading of rule 6 cost a real deploy its
// provenance. deploy-web run 144 (2026-08-08) uploaded to Cloudflare Pages
// successfully, lost the CDN propagation race in the post-deploy smoke 51 s
// later, and therefore SKIPPED the record on the inherited `success()` — leaving
// a build that served real users with nothing in the ledger naming it, repaired
// afterwards by a hand-written attestation (PR #266). A provenance record must
// be conditioned on the ACT it describes, never on a later verdict about that
// act.
//
// Everything else still fails, and each of these has a test:
//   · `always()` alone            — would record a deploy step that FAILED.
//   · `github.ref == …`, `success() && …`, any non-conjunct — narrowing.
//   · `steps.<id>.outcome != 'skipped'`, `!= 'failure'` — not the accepted
//     predicate; a weaker one is a wider door than this rule wants to hold open.
//   · an id no earlier step declares — GitHub resolves `steps.typo.outcome` to
//     null rather than erroring, so the record silently never runs and the job
//     is green. A renamed `id:` on the deploy step is exactly that mistake.
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
// ── 🔴 2026-08-26 — THE PARAGRAPH THAT USED TO SIT HERE WAS FALSE, AND IT WAS
//    THIS GUARD'S OWN FAILURE MODE WEARING THIS GUARD'S OWN WORDS ────────────
// It read, verbatim:
//
//   "⚠️ THE PUBLISH BRANCH HAS NO INSTANCES TODAY AND THE GUARD SAYS SO ON EVERY
//    RUN rather than passing quietly. All six submission invocations are
//    rehearsals; no publisher account exists ([10]D-4 / OWNER_QUEUE A-2, A-3,
//    A-4 CLOSED 2026-08-31, A-6), so a real submission is owner-gated and cannot be produced by any
//    amount of agent work. Printing the census is what keeps rule 2 from being an
//    assertion that cannot fail: the moment a `--dry-run` is removed, the count
//    moves and the rule bites."
//
// Every clause about owner-gating is still true. The claim that made it false is
// "all six submission invocations are rehearsals". There were SEVEN, and two of
// them were real: `submit-play.yml` and `submit-snap.yml` each carry a `submit:`
// job whose last step runs its script with `--submit` and no `--dry-run`, and
// NEITHER WROTE A RECORD. The census could not see them because it ranged over
// the register's `submission.job` — "dry-run" — instead of over the jobs of the
// declared submission WORKFLOW. So rule 2 had zero instances, printed that it had
// zero instances, and that printout was the reassurance that stopped anybody
// looking. See the block above the submittable loop for the full account.
//
// WHAT IS TRUE NOW: the census ranges over every job of each declared submission
// workflow and LISTS the jobs it ranged over; both `submit:` jobs write a
// `[10]D-9` record as their last step; rule 2 has two instances and is graded on
// every run. When the count IS zero the run says "RULE 2 WAS NOT EXERCISED" out
// loud and stamps the ok line with it, because a rule that cannot fail prints
// exactly what a rule that passed prints, and those two must never look alike
// here again.
//
// Usage:  node tooling/ci/assert-publish-records.mjs [repoRoot]
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// ⏱ 2026-09-24 — P-A1: the lanes are read through parseResolvedWorkflows, so a
// record or submit step behind `uses: ./.github/actions/<x>` or a local reusable
// workflow is graded where it lives. The flat self-check below stays on
// parseAllWorkflows: it is the deliberately different reader.
import { parseAllWorkflows, parseResolvedWorkflows, lineAt, placeOf, refusalText, shellSegments, RECORD_CALL, expandMatrixEnvironment, storePublishSteps, laneRunHost, laneRefusalText } from './workflow-scan.mjs';
import { resolveEnvironment, STATES, SUBMIT_TIME_STATES, STATE_MEANING } from './deployment-record.mjs';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const REGISTER_REL = 'tooling/channel-register.json';
const APPS_REL = 'catalog/apps.json';
const RECORDER = 'record-deployment.mjs';

const problems = [];
const prints = [];

/** Structural failure — the scan itself is broken, so nothing it reports means
 *  anything. Exits immediately rather than joining the problem list, because a
 *  guard that under-reaches and then lists zero problems reads as a pass. */
function coverageLost(lines) {
  console.error(`✗ COVERAGE LOST — ${lines[0]}`);
  for (const l of lines.slice(1)) console.error(`  ${l}`);
  // ⏱ 2026-09-16 — exit 2, not 1: COVERAGE LOST is "did not check enough to be evidence", never a
  // finding (AGENTS.md exit-code convention; O-EXIT2-CONVENTION-GAP). This helper exited 1 until today.
  process.exit(2);
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

/**
 * Every STEP of a job, in order — its opening `- <key>:` line, the lines that
 * belong to it, its `id:`, its step-level `if:` and its `continue-on-error:`.
 *
 * 🔴 THIS REPLACED A SCAN THAT COULD ONLY EVER SEE A JOB'S FIRST STEP (see the
 * header). The list starts at the job's own `steps:` key, so `needs:` block
 * entries and `strategy.matrix` values can never be mistaken for steps, and the
 * step's key column is LOCKED to the first step's — which is what keeps an `id:`
 * or an `if:` nested inside a `with:` mapping from being read as the step's own.
 *
 * It lives here rather than in workflow-scan.mjs because it has exactly one
 * consumer. The day a second guard needs steps, move it there rather than
 * copying it — the four disagreeing copies of `RECORD_CALL` written up in that
 * file are what a second copy becomes.
 */
function stepsOf(job) {
  const at = job.logical.findIndex((l) => /^ {4}steps:\s*$/.test(l.text));
  if (at === -1) return [];
  const steps = [];
  let indent = null;
  for (const l of job.logical.slice(at + 1)) {
    const open = l.text.match(/^(\s*)-\s+[A-Za-z_][A-Za-z0-9_-]*:/);
    if (open && (indent === null || open[1].length === indent)) {
      indent = open[1].length;
      steps.push({ n: l.n, lines: [], id: null, stepIf: null, continueOnError: null });
    }
    const cur = steps[steps.length - 1];
    if (!cur) continue;
    cur.lines.push(l);
    // A step key sits either on the `- ` line itself or two columns right of it.
    const key = l.text.match(/^(\s*)(?:-\s+)?([A-Za-z_][A-Za-z0-9_-]*):\s*(\S.*?)?\s*$/);
    if (!key) continue;
    const onDash = /^\s*-\s/.test(l.text);
    if (!onDash && key[1].length !== indent + 2) continue;
    if (key[2] === 'id' && cur.id === null) cur.id = (key[3] ?? '').replace(/^['"]|['"]$/g, '');
    if (key[2] === 'if' && cur.stepIf === null && key[3]) cur.stepIf = { n: l.n, cond: key[3] };
    if (key[2] === 'continue-on-error' && cur.continueOnError === null && /^true\b/.test(key[3] ?? '')) {
      cur.continueOnError = { n: l.n };
    }
  }
  return steps;
}

/** One conjunct of the accepted widening form. `==` and `===` are both legal
 *  GitHub expression syntax; the quotes may be single or double. */
const OUTCOME_SUCCESS = /^steps\.([A-Za-z_][A-Za-z0-9_-]*)\.outcome\s*===?\s*(['"])success\2$/;

/**
 * Is this step-level `if:` the one form D-9 tolerates on a record step — a
 * STRICT WIDENING of the inherited `success()` — or is it a narrowing that lets
 * the job end without writing a record? Returns `null` when it is acceptable,
 * or the reason it is not. See the header for the argument.
 */
function narrowingReason(cond) {
  const body = cond.trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  const parts = body.split('&&').map((s) => s.trim());
  if (parts[0] !== 'always()') {
    return `it does not begin with \`always()\`, so it can only ever run on FEWER inputs than the \`success()\` every step inherits`;
  }
  if (parts.length < 2) {
    return 'a bare `always()` records even when the deploy step FAILED, which files a ledger entry for something that never shipped';
  }
  const ids = [];
  for (const p of parts.slice(1)) {
    const m = p.match(OUTCOME_SUCCESS);
    if (!m) return `the conjunct \`${p}\` is not \`steps.<id>.outcome == 'success'\``;
    ids.push(m[1]);
  }
  return { ids };
}

/**
 * The ONE triggering event a step-level `if:` pins, or `null`. ⏱ 2026-09-23.
 * Pinned means a top-level conjunct `github.event_name == '<event>'` in a
 * condition with no `||` anywhere: a disjunction, a negation or a parenthesised
 * clause could admit a second event, so it pins nothing and the step is read as
 * reachable from every event — the fail-closed reading.
 */
function pinnedEvent(stepIf) {
  if (!stepIf) return null;
  const body = stepIf.cond.trim().replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '').trim();
  if (body.includes('||')) return null;
  for (const p of body.split('&&').map((s) => s.trim())) {
    const m = p.match(/^github\.event_name\s*===?\s*(['"])([A-Za-z_]+)\1$/);
    if (m) return m[2];
  }
  return null;
}

/** The step a given line belongs to, plus the ids every EARLIER step declares.
 *  `null` when the line belongs to no step at all — which means this parse has
 *  lost the job's step structure, and the caller must treat it as COVERAGE LOST
 *  rather than as "no guards found". Returning an empty list for a line it could
 *  not place is precisely how the previous version reported a dead rule as a
 *  passing one. */
function stepContext(job, lineNumber) {
  const steps = stepsOf(job);
  const i = steps.findIndex((s) => s.lines.some((l) => l.n === lineNumber));
  if (i === -1) return null;
  return { step: steps[i], index: i, total: steps.length, priorIds: new Set(steps.slice(0, i).map((s) => s.id).filter(Boolean)) };
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
          ctx: stepContext(job, line.n),
        });
      }
    }
  }
  return out;
}

const resolved = parseResolvedWorkflows(ROOT);
if (resolved.refusal !== null) {
  coverageLost([
    refusalText(resolved.refusal),
    'A record or submit step behind that reference would be graded as absent, and absent reads as clean.',
  ]);
}
const resolvedByRel = new Map(resolved.workflows.map((w) => [w.rel, w]));

function openWorkflow(rel, why) {
  const wf = resolvedByRel.get(rel) ?? null;
  if (wf === null && existsSync(join(ROOT, rel))) {
    coverageLost([
      `${REGISTER_REL} names ${rel} as ${why}, and that file only runs when another workflow calls it.`,
      'Name the calling workflow and its call job: that is where the lane runs, with the caller\'s triggers.',
    ]);
  }
  if (wf === null) coverageLost([`${REGISTER_REL} names ${rel} as ${why}, and that file does not exist.`]);
  // ⏱ P-A1: a workflow whose jobs are all calls to a local reusable workflow has
  // no step bullet of its own; its steps are the callee's, read into child jobs.
  const calleeSteps = [...wf.jobs.values()]
    .filter((j) => j.calledBy !== undefined)
    .reduce((sum, j) => sum + j.lines.filter((l) => /^\s+-\s+(name|run|uses):/.test(l.text)).length, 0);
  if (wf.rawStepCount + calleeSteps === 0) {
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

/** A register-named job and, when it is a `uses: ./.github/workflows/<x>` call,
 *  the callee jobs it runs (`<job>/<calleeJob>`). The steps of a call job live
 *  in its callees, so a lane graded on the call job alone would find nothing. */
function withCallees(wf, job) {
  return [job, ...[...wf.jobs.values()].filter((j) => j.calledBy === job.name)];
}

/** ⏱ 2026-09-25 [ADR 095 §4] — a served lane whose register row names its OWN
 *  file after that file became `on: workflow_call` only (deploy-web.yml, called
 *  by ci.yml after ci-gate). WHERE it runs is workflow-scan's laneRunHost, the
 *  one derivation every lane reader imports: a file that runs as itself opens
 *  through openWorkflow/openJob as before; a file exactly one call job runs is
 *  graded as that host's child `<callJob>/<laneJob>`, in the caller, under the
 *  caller's `on:` and `needs`; a refusal (orphan-callee, ambiguous-callee,
 *  missing) is COVERAGE LOST in laneRefusalText's words. Submission rows keep
 *  openWorkflow's refusal of a lane naming a callee (P-A1). */
function openServedLane(rel, jobName, why) {
  const host = laneRunHost(resolved, rel);
  if (host.refusal) {
    const absent = host.refusal.kind === 'missing' && !existsSync(join(ROOT, rel));
    coverageLost([
      `${REGISTER_REL} names ${rel} job "${jobName}" as ${why}, and ${absent ? 'that file does not exist' : 'no one call job runs it'}.`,
      laneRefusalText(host.refusal),
    ]);
  }
  if (host.callJob === null) {
    const wf = openWorkflow(rel, why);
    return { wf, job: openJob(wf, jobName, `${why} job`) };
  }
  const wf = resolvedByRel.get(host.workflow);
  const childName = `${host.callJob}/${jobName}`;
  const job = host.children.find((j) => j.name === childName);
  if (!job) {
    coverageLost([
      `${REGISTER_REL} names ${rel} job "${jobName}" as ${why}; that file runs only as ${host.workflow} call job "${host.callJob}", and its child "${childName}" is not there.`,
      `Children present: ${host.children.map((j) => j.name).join(', ') || '(none)'}.`,
    ]);
  }
  return { wf, job };
}

// ── 1. SERVED CHANNELS — the deploy lane must record what it shipped ─────────
const seenRecordLines = new Set();
/** Mark every RAW line a record call occupies as reached. ⏱ 2026-09-22 — a call
 *  inside a `run: |` block is ONE logical line numbered at its `run:` key, while
 *  the flat reader below numbers it at its own raw line (extensions.yml:1637 sits
 *  three lines under its `run: |` at :1634; re-measured 2026-09-24). Marking only the logical number
 *  reported a call the census HAD read as one it never reached — COVERAGE LOST
 *  the moment arming the amo row made extensions.yml a declared submission
 *  workflow. The span runs to the line before the job's next logical line. */
function markRecordLinesSeen(wf, job, calls) {
  const starts = job.logical.map((l) => l.n).sort((x, y) => x - y);
  const lastRaw = job.lines.length ? job.lines[job.lines.length - 1].n : null;
  for (const c of calls) {
    const next = starts.find((n) => n > c.n);
    // ⏱ 2026-09-24 — P-A1: the span is the job's own lines up to the next logical
    // line, keyed by where each really is. A callee's line numbers are fractional
    // in the caller and its flat hit is `<callee>.yml:<line>`; `n++` from a
    // fractional start marks nothing the flat reader can name.
    const end = next !== undefined ? next : (lastRaw ?? c.n) + 1;
    for (const l of job.lines) if (l.n >= c.n && l.n < end) seenRecordLines.add(placeOf(wf, l.n));
  }
}
let deployRecordCalls = 0;
/** Rule 6's own coverage. `stepsGraded` counts the record steps this parse
 *  actually located and graded — it is the number the previous version could
 *  never have raised above 0 on the real tree, so it is the number that proves
 *  the rule is alive. `wideningsAccepted` counts the accepted `always() &&
 *  steps.<id>.outcome == 'success'` conditions, printed rather than swallowed. */
let stepsGraded = 0;
let wideningsAccepted = 0;

/**
 * RULE 6, for one record call — the served lane's and the store submission's
 * record steps are graded by the same function on purpose. "A job that ships and
 * then ends without a record" is one failure with two spellings, and two copies
 * of the rule would be two chances for one of them to quietly stop applying.
 *
 * `subject` names the step in the failure text; `what` names the thing recorded.
 */
function gradeSkippability(wf, jobName, call, subject, what) {
  if (call.ctx === null) {
    coverageLost([
      `${wf.rel}: the record call for ${what} at ${lineAt(wf, call.n)} belongs to no step this parse could find.`,
      'Rule 6 (a skippable record step) is graded from the step containing the call, so a call this reader',
      'cannot place is a rule it cannot apply — and it would otherwise report "no guards found", which is',
      'the exact shape the previous `stepGuards` shipped in for a month. Fix the step splitter, not the workflow.',
    ]);
  }
  stepsGraded++;
  if (call.ctx.step.continueOnError) {
    problems.push(
      `[10]D-9 · ${placeOf(wf, call.ctx.step.continueOnError.n)} — ${subject} carries \`continue-on-error: true\`, so the ` +
        'job can finish GREEN having shipped and not recorded. D-9\'s wording is "ends without writing one fails"; ' +
        "swallowing the recorder's own failure is how a job ends without writing one while the call is still in the YAML.",
    );
  }
  if (!call.ctx.step.stepIf) return;
  const verdict = narrowingReason(call.ctx.step.stepIf.cond);
  if (typeof verdict === 'string') {
    problems.push(
      `[10]D-9 · ${placeOf(wf, call.ctx.step.stepIf.n)} — ${subject} carries a NARROWING step-level \`if:\` ` +
        `(\`${call.ctx.step.stepIf.cond}\`): ${verdict}. So the job can finish having shipped and not recorded, ` +
        'which is D-9\'s "ends without writing one". The one accepted form is ' +
        "`always() && steps.<publishing-step-id>.outcome == 'success'` — a strict WIDENING of the `success()` every " +
        'step inherits, so the record follows the ACT rather than a later verdict about the act.',
    );
    return;
  }
  const unknown = verdict.ids.filter((id) => !call.ctx.priorIds.has(id));
  if (unknown.length) {
    problems.push(
      `[10]D-9 · ${placeOf(wf, call.ctx.step.stepIf.n)} — ${subject} is conditioned on step id(s) ` +
        `\`${unknown.join('`, `')}\` that NO EARLIER step in job "${jobName}" declares ` +
        `(earlier ids: ${[...call.ctx.priorIds].map((i) => `\`${i}\``).join(', ') || 'none'}). GitHub resolves ` +
        '`steps.<unknown>.outcome` to null instead of erroring, so this record would silently never be written and ' +
        'the run would still be green — a renamed or deleted `id:` on the publishing step is exactly that.',
    );
    return;
  }
  wideningsAccepted++;
  prints.push(
    `[10]D-9 · ${placeOf(wf, call.ctx.step.stepIf.n)} — ${what} is recorded on \`${call.ctx.step.stepIf.cond}\`: a WIDENING ` +
      'of the inherited `success()` (that step being green was already required), so the record survives a ' +
      'post-deploy smoke that fails after the bytes shipped. Run 144, 2026-08-08.',
  );
}

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
  const { wf, job } = openServedLane(rel, row.lane.job, `the served "${row.id}" channel's lane`);
  const calls = withCallees(wf, job).flatMap((j) => {
    const own = recordCalls(j);
    markRecordLinesSeen(wf, j, own);
    return own;
  });
  deployRecordCalls += calls.length;

  for (const env of envs) {
    const hit = calls.find((c) => c.environment === env);
    if (!hit) {
      problems.push(
        `[10]D-9 · the "${row.id}" channel is SERVED and ${wf.rel} job "${job.name}" never records "${env}". ` +
          `A deploy that ships and records nothing makes "what is live?" answerable only by inference, which is ` +
          `the state this requirement abolishes. Add a step running \`node tooling/ci/${RECORDER} ${env} <url>\`. ` +
          `(Found ${calls.length} record call(s) in that job: ${calls.map((c) => `${c.environment}@${lineAt(wf, c.n)}`).join(', ') || 'none'}.)`,
      );
      continue;
    }
    gradeSkippability(wf, job.name, hit, `the step recording "${env}"`, `"${env}"`);
  }

  // ⏱ 2026-09-25 · D3a (row O-APEX-SITE-DEPLOYS-OUTSIDE-THE-PIPELINE). A served lane's
  // file can run a SECOND publishing job beside the channel's: deploy-web.yml's `site`
  // job records `nikatru-site`, a `siteEnvironments` row. Its record calls are reached
  // here, through the same run host the lane opened by, and rule 6 grades them like the
  // lane's own, but only when the environment resolves to a row with no app in it (a
  // service or a site). A sibling job recording a CHANNEL environment is left
  // unattributed, and the accounting identity below still refuses it.
  const host = laneRunHost(resolved, rel);
  const siblings = (host.callJob === null ? [...wf.jobs.values()] : host.children).filter((j) => j !== job && j.calledBy !== job.name);
  for (const j of siblings) {
    for (const c of recordCalls(j)) {
      if (seenRecordLines.has(placeOf(wf, c.n))) continue;
      const r = resolveEnvironment(register, c.environment);
      if (r === null || r.app !== null) continue;
      markRecordLinesSeen(wf, j, [c]);
      gradeSkippability(wf, j.name, c, `the step recording "${c.environment}"`, `"${c.environment}"`);
      prints.push(
        `[10]D-9 · ${placeOf(wf, c.n)} — reached in job "${j.name}" beside the "${row.id}" lane; it records ` +
          `"${c.environment}", a kind "${r.channel.kind}" row and not a channel, so rule 1 does not ask for it and rule 6 grades it.`,
      );
    }
  }
}

// ── 2. SUBMITTABLE CHANNELS — rehearsal vs. real, and what each may claim ────
//
// 🔴 THE CENSUS RANGES OVER EVERY JOB OF THE DECLARED SUBMISSION WORKFLOW, AND
// UNTIL 2026-08-26 IT RANGED OVER EXACTLY ONE — WHICH IS HOW THIS FILE ENDED UP
// SITTING IN THE TRAP ITS OWN HEADER DESCRIBES.
//
// `submission.job` in the register names the job a channel's submission is
// DECLARED in. For all five submittable rows that value is "dry-run", and this
// loop read that job and nothing else. But `submit-play.yml` and
// `submit-snap.yml` each carry a SECOND job — `submit:` — whose last step runs
//
//     node tooling/release/submit-play.mjs --submit --app subscriptiontracker …
//     node tooling/release/submit-snap.mjs --submit --app subscriptiontracker …
//
// with no `--dry-run` anywhere on the command, gated on an `environment:` and a
// typed confirmation rather than on anything static. Neither job wrote a record.
// So rule 2 — "a step that CAN PUBLISH, in a job that can finish without a
// record" — had ZERO INSTANCES, and the guard PRINTED that it had zero instances
// on every run as evidence that the branch was honestly empty, while the two
// real publish paths sat one job away, invisible to the census reporting on them.
//
// A branch with no instances is a rule that CANNOT FAIL, and the output of a rule
// that cannot fail is byte-identical to the output of a rule that passed. That is
// the failure mode this whole file exists to catch, and the census was the shape
// of it.
//
// The register's declaration is still load-bearing and is still checked: the
// COVERAGE LOST below is asserted against the DECLARED job, so a register
// pointing at a job that runs nothing is still a broken register. What changed is
// that the declaration is now a FLOOR under the census rather than its ceiling.
let rehearsals = 0;
let publishing = 0;
const censusByRow = [];
/** Which (workflow, job) pairs the census actually ranged over — LISTED, never
 *  counted. A matching count is not a matching set, and the defect above was
 *  exactly a job missing from the set while every printed number looked sane. */
const censusJobsListed = [];
/** Rules 4 and 5 now see every record call in every censused job of a submission
 *  workflow. Two register rows can declare the SAME workflow (both Apple rows
 *  do), so a line already graded is not graded twice into two identical problems. */
const gradedRecordLines = new Set();

for (const row of submittableRows) {
  const sub = row?.submission;
  if (!sub || typeof sub.script !== 'string' || typeof sub.workflow !== 'string' || typeof sub.job !== 'string') {
    coverageLost([
      `submittable channel "${row.id}" has no complete \`submission\` block (script + workflow + job).`,
      'Without it there is no step to classify, and this guard would silently cover one channel fewer.',
    ]);
  }
  const wf = openWorkflow(sub.workflow, `the "${row.id}" channel's submission workflow`);
  const declaredJob = openJob(wf, sub.job, `the "${row.id}" channel's submission job`);
  const scriptName = sub.script.split('/').pop();

  /** Every invocation of THIS ROW's submission script inside ONE job. */
  const invocationsIn = (job) => {
    const out = [];
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
        out.push({ n: line.n, canPublish: !(literalDryRun && !interpolated), literalDryRun, interpolated, seg: seg.trim() });
      }
    }
    return out;
  };

  if (withCallees(wf, declaredJob).every((j) => invocationsIn(j).length === 0)) {
    coverageLost([
      `${REGISTER_REL} says the "${row.id}" channel submits via ${sub.script} in ${wf.rel} job "${sub.job}", and no step there runs it.`,
      'Either the register points at nothing or this parse has stopped seeing run steps. Both are the scan breaking, not the tree.',
    ]);
  }

  /** EVERY job of the declared workflow whose `run:` lines name this script —
   *  the declared one included, and it is no longer privileged. */
  const censusJobs = [...wf.jobs.values()]
    .filter((job) => jobRunLines(job).some((l) => l.text.includes(scriptName)))
    .map((job) => ({ job, invocations: invocationsIn(job) }));

  // ── THE CENSUS'S OWN REACH, CHECKED BY A DELIBERATELY DIFFERENT READER ──────
  // `wf.lines` is the comment-blanked WHOLE FILE: no job structure, no shell
  // splitting, no block-scalar folding. Every line of it that names this row's
  // script and falls inside SOME job must fall inside a job the structured
  // reader above also reached. The two disagree exactly when `jobRunLines` or
  // `joinBlockScalars` has stopped seeing lines — and an invocation the census
  // cannot see is a publish path rule 2 cannot grade, which this guard would then
  // report as an EMPTY BRANCH. That report is indistinguishable from a pass,
  // which is why this is COVERAGE LOST and not a printed note.
  const jobOfLine = new Map();
  for (const j of wf.jobs.values()) for (const l of j.lines) jobOfLine.set(l.n, j.name);
  const reachedJobNames = new Set(censusJobs.map((e) => e.job.name));
  const unreachedInvocationLines = wf.lines
    .filter((l) => l.text.includes(scriptName) && jobOfLine.has(l.n) && !reachedJobNames.has(jobOfLine.get(l.n)))
    .map((l) => `${placeOf(wf, l.n)} — inside job "${jobOfLine.get(l.n)}"`);
  if (unreachedInvocationLines.length > 0) {
    coverageLost([
      `${unreachedInvocationLines.length} line(s) of ${wf.rel} name ${scriptName} inside a job this census never reached:`,
      ...unreachedInvocationLines,
      `Jobs censused for "${row.id}": ${[...reachedJobNames].map((j) => `"${j}"`).join(', ') || '(none)'}.`,
      'A flat read of the file can see them and the structured read cannot, so the parse is broken, not the tree.',
    ]);
  }

  const rowEnvTemplate = row.deploymentEnvironment;
  const perJob = [];

  for (const { job, invocations } of censusJobs) {
    censusJobsListed.push(`${wf.rel}#${job.name}`);
    const calls = recordCalls(job);
    markRecordLinesSeen(wf, job, calls);

    for (const inv of invocations) {
      if (!inv.canPublish) {
        rehearsals++;
        const after = calls.filter((c) => c.n !== null);
        if (after.length > 0 && !invocations.some((i) => i.canPublish)) {
          problems.push(
            `[10]D-9 · ${placeOf(wf, after[0].n)} — job "${job.name}" writes a deployment record, and its only ` +
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
          `[10]D-9 · ${placeOf(wf, inv.n)} — job "${job.name}" can perform a REAL submission on the "${row.id}" ` +
            `channel (${inv.interpolated ? 'its mode is assembled from a `${{ … }}` expression, so it is not statically a rehearsal' : 'no `--dry-run` on this command'}) ` +
            `and no later step records it. Add, as the last step of the job:\n` +
            `      run: node tooling/ci/${RECORDER} ${String(rowEnvTemplate).replace('{app}', '<app>')} --state ${SUBMIT_TIME_STATES[0]} --listing-url <url>`,
        );
        continue;
      }
      gradeSkippability(wf, job.name, record, `the record step for a real "${row.id}" submission`, `the "${row.id}" submission`);
    }

    // Rules 4 and 5 apply to EVERY record call in a submission workflow, whether
    // or not this run classified a publishing invocation — the overstatement is
    // wrong in a rehearsal lane too, and cheaper to catch before it is copied.
    // ⏱ 2026-09-23 — ONE EXCEPTION, AND IT IS A FACT ABOUT RUNS, NOT A WAIVER: a
    // record step pinned to one event, in a job whose EVERY publishing invocation
    // is pinned to a DIFFERENT event, can never run in a submitting run, so it
    // is not a submitting run's claim. extensions.yml's release job is the
    // shape: the tag-PUSH origin loop (`pending_manual_publish`) beside the
    // dispatch-only AMO submit. Any unpinned side keeps the step graded.
    const publishEvents = invocations
      .filter((i) => i.canPublish)
      .map((i) => pinnedEvent(stepContext(job, i.n)?.step.stepIf ?? null));
    for (const c of calls) {
      const key = placeOf(wf, c.n);
      if (gradedRecordLines.has(key)) continue;
      gradedRecordLines.add(key);
      const recordEvent = pinnedEvent(c.ctx?.step.stepIf ?? null);
      if (
        recordEvent !== null &&
        publishEvents.length > 0 &&
        publishEvents.every((e) => e !== null && e !== recordEvent)
      ) {
        prints.push(
          `[10]D-9 · ${placeOf(wf, c.n)} — not graded as a "${row.id}" submission record: its step runs only on ` +
            `\`${recordEvent}\`, and every publishing invocation in job "${job.name}" runs only on ` +
            `${[...new Set(publishEvents)].map((e) => `\`${e}\``).join(', ')}, so no submitting run reaches it.`,
        );
        continue;
      }
      if (c.state !== null && !SUBMIT_TIME_STATES.includes(c.state) && !/\$\{\{/.test(c.state)) {
        problems.push(
          `[10]D-9 · ${placeOf(wf, c.n)} records \`--state ${c.state}\` from the "${row.id}" SUBMISSION workflow. ` +
            `A submitting run knows one fact — it submitted — and "${SUBMIT_TIME_STATES[0]}" is the only state that ` +
            `says it. "${c.state}": ${STATE_MEANING[c.state] ?? 'not a state at all — expected one of ' + STATES.join(', ')} ` +
            'A later run (a status poll, or a dispatch a human triggers on the review email) writes that transition.',
        );
      }
      if (c.state === null) {
        problems.push(
          `[10]D-9 · ${placeOf(wf, c.n)} records a store environment with no \`--state\`. There is no default for a ` +
            'store channel on purpose: a forgotten flag must not be the difference between "we submitted it" and ' +
            '"the store approved it".',
        );
      }
      if (c.listingUrl === null) {
        problems.push(
          `[10]D-9 · ${placeOf(wf, c.n)} records a store environment with no \`--listing-url\`. A store record whose ` +
            'listing nobody can open says something shipped and gives no way to look at it — and [12]\'s cross-promo ' +
            'and G-31\'s openStoreListing() fallback both consume exactly that field.',
        );
      }
    }

    if (invocations.length > 0) {
      perJob.push(
        `job "${job.name}" ${invocations.length} invocation(s), ` +
          `${invocations.filter((i) => i.canPublish).length} PUBLISHING / ${invocations.filter((i) => !i.canPublish).length} rehearsal`,
      );
    }
  }
  censusByRow.push(`${row.id}: ${perJob.join(' + ') || 'no invocation in any job'}`);
}

// ── RULE 2b · EVERY OTHER STORE PUBLISH STEP IS RECORDED TOO ────────────────
// ⏱ 2026-09-24 (EXT-3, O-STORE-PUBLISH-STEP-DEFINED-THREE-WAYS). Rule 2 ranges
// over the register's SUBMITTABLE rows. The Chrome and Edge submit steps belong
// to rows that are `submittable: false` until EXT-6 arms them, so they sat outside
// it: either step could upload and nothing required a record after it. This rule's
// domain is workflow-scan.mjs `storePublishSteps()`, the one definition limb 2 of
// assert-publish-steps-guarded.mjs and limb 4 of assert-release-provenance.mjs
// also read. A store publish step running a row's `publishScript`, for a row
// rule 2 does not already cover, must be followed in its job by a record of that
// row's environment, under rule 6's skippability test.
let storeStepsGraded = 0;
const storeSteps = storePublishSteps(resolved.workflows, register);
for (const { wf, job, step, scripts } of storeSteps) {
  const bases = scripts.map((x) => x.split('/').pop());
  const owners = rows.filter(
    (r) => r?.submittable !== true && typeof r?.publishScript === 'string' && bases.includes(r.publishScript.split('/').pop()),
  );
  if (owners.length === 0) continue;
  const calls = recordCalls(job);
  markRecordLinesSeen(wf, job, calls);
  for (const row of owners) {
    storeStepsGraded++;
    const record = calls.find((c) => {
      const r = resolveEnvironment(register, c.environment);
      return r !== null && r.channel?.id === row.id && c.n > step.n;
    });
    if (!record) {
      problems.push(
        `[10]D-9 · ${placeOf(wf, step.n)} — job "${job.name}" runs the "${row.id}" store publish ${JSON.stringify(step.name ?? '(unnamed)')} ` +
          `and no later step records it. Add, after it:\n` +
          `      run: node tooling/ci/${RECORDER} ${String(row.deploymentEnvironment).replace('{app}', '<app>')} --state ${SUBMIT_TIME_STATES[0]} --listing-url <url>`,
      );
      continue;
    }
    gradeSkippability(wf, job.name, record, `the record step for a "${row.id}" store publish`, `the "${row.id}" submission`);
  }
}

// The rule's floor: a register that declares a non-submittable row WITH a
// publishScript has a store step for this rule to grade, so grading none means the
// definition stopped matching. (A tree with no such row gives rule 2b no subject.)
const rule2bRows = rows.filter((r) => r?.submittable !== true && typeof r?.publishScript === 'string' && r.publishScript.trim() !== '');
if (rule2bRows.length > 0 && storeStepsGraded === 0) {
  coverageLost([
    `rule 2b graded ZERO store publish steps while ${REGISTER_REL} declares ${rule2bRows.map((r) => `"${r.id}"`).join(', ')} with a publishScript.`,
    'workflow-scan.mjs storePublishSteps() has stopped matching them, so this rule ranged over nothing.',
  ]);
}

// Every OTHER job of a declared submission workflow is read by the same
// structured parse, so the accounting identity below compares two complete reads
// of those files. ⏱ 2026-09-24 (EXT-3): extensions.yml's `release` job keeps its
// tag-PUSH origin record (`pending_manual_publish`) while the AMO submit moved to
// `store-publish`; that record is no submission's, and rule 6b grades its `if:`.
for (const rel of new Set(submittableRows.map((r) => r?.submission?.workflow).filter((x) => typeof x === 'string'))) {
  const wf = openWorkflow(rel, 'a declared submission workflow');
  for (const job of wf.jobs.values()) {
    const calls = recordCalls(job);
    const fresh = calls.filter((c) => !seenRecordLines.has(placeOf(wf, c.n)));
    if (fresh.length === 0) continue;
    markRecordLinesSeen(wf, job, fresh);
    prints.push(
      `[10]D-9 · ${fresh.map((c) => placeOf(wf, c.n)).join(', ')} — reached in job "${job.name}", which runs no submission; ` +
        'not a submission record, so rules 2 and 4/5 do not grade it (rule 6b does).',
    );
  }
}

// ── THE CENSUS FLOOR — a rule that ranged over nothing may not certify ───────
// The declared job is proven non-empty per row above, so this can only fire if
// `wf.jobs` itself came back empty for every row. It is here anyway because the
// number it guards is the number the emptiness report below rests on, and a zero
// here would make that report vacuous rather than merely empty.
if (censusJobsListed.length === 0) {
  coverageLost([
    'the submission census ranged over ZERO jobs, so every statement it is about to make about the publish',
    'branch would be a statement about nothing. That is the shape this limb spent a month in.',
  ]);
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

// ── RULE 6b · A NULL-RESOLVING `if:` ON *ANY* RECORD STEP, LANE OR NOT ───────
// 🔴 RULE 6 ONLY REACHES REGISTER-DECLARED CHANNEL LANES, AND THE 2026-08-09
// CHANGE PUT LOAD-BEARING CONDITIONS OUTSIDE THEM. deploy-workers.yml's two
// record steps write `serviceEnvironments` (the Workers), which no channel row
// declares — so they are printed by the flat scan above and graded by nothing.
// They now carry `always() && steps.deploy.outcome == 'success'`, which means a
// renamed or deleted `id:` on either wrangler deploy step would resolve
// `steps.deploy.outcome` to NULL, skip the record forever, and leave the run
// green. That is the identical failure rule 6 exists to prevent, one file over.
//
// This limb is deliberately NARROWER than rule 6 and carries no policy: it does
// not demand any particular condition, and it never objects to a workflow for
// what it chose to record. It asserts one thing that is unconditionally a bug —
// an `if:` naming a step id that no EARLIER step in the same job declares. There
// is no tree in which that expression does what its author meant, so it cannot
// produce a false red on a correct workflow, which is why it can be applied to
// every record call in the repository rather than only to declared lanes.
const STEP_OUTCOME_REF = /steps\.([A-Za-z_][A-Za-z0-9_-]*)\.(outcome|conclusion)/g;
let danglingChecked = 0;
for (const wf of resolved.workflows) {
  for (const job of wf.jobs.values()) {
    for (const call of recordCalls(job)) {
      if (!call.ctx?.step?.stepIf) continue;
      danglingChecked++;
      const cond = call.ctx.step.stepIf.cond;
      STEP_OUTCOME_REF.lastIndex = 0;
      const referenced = [...new Set([...cond.matchAll(STEP_OUTCOME_REF)].map((m) => m[1]))];
      const dangling = referenced.filter((id) => !call.ctx.priorIds.has(id));
      if (dangling.length === 0) continue;
      problems.push(
        `[10]D-9 · ${placeOf(wf, call.ctx.step.stepIf.n)} — the step recording "${call.environment}" is conditioned on ` +
          `step id(s) \`${dangling.join('`, `')}\` that NO EARLIER step in job "${job.name}" declares ` +
          `(earlier ids: ${[...call.ctx.priorIds].map((i) => `\`${i}\``).join(', ') || 'none'}). GitHub resolves ` +
          '`steps.<unknown>.outcome` to null rather than erroring, so this record would silently never be written ' +
          'and the run would still be GREEN. This limb covers every record call in the tree, including the ' +
          '`serviceEnvironments` ones no channel row declares — rule 6 above cannot see those.',
      );
    }
  }
}

// ── RULE 6's FLOOR ───────────────────────────────────────────────────────────
// The load-bearing half of this floor is inside `gradeSkippability`: a record
// call whose containing step this parse cannot LOCATE is COVERAGE LOST, not
// "no guards found". That is the exact regression the old `stepGuards` shipped —
// it saw a job's first step only, and a record step is the last step of every
// real lane — so a step splitter that ever narrows back to the first step makes
// `stepContext` return null and fails the build instead of printing ok.
//
// This second half catches the other shape: every required environment recorded,
// no problems found, and yet nothing graded — i.e. the rule ran over nothing
// while the guard was about to print a pass.
if (problems.length === 0 && stepsGraded === 0) {
  coverageLost([
    `rule 6 graded 0 record step(s) while ${REQUIRED_COVERAGE.requiredEnvironments} environment(s) are required and no`,
    'problem was found — so the rule ranged over nothing and this run was about to print ok. That is the state it was',
    "actually in until 2026-08-09, when `if: github.actor == 'nobody'` on the real record step still passed.",
  ]);
}

// ── REPORT ───────────────────────────────────────────────────────────────────
for (const p of prints) console.log(`⬜ ${p}`);
console.log(
  `⬜ RULE 6 (a record step the job can SKIP) graded ${stepsGraded} record step(s); ${wideningsAccepted} carry the one ` +
    "accepted widening `always() && steps.<id>.outcome == 'success'`. Recorded failing input, run against the REAL " +
    "tree 2026-08-09: giving deploy-web.yml's record step `if: github.actor == 'nobody'` ⇒ exit 1.",
);
console.log(
  `⬜ RULE 6b (an \`if:\` naming a step id nothing declares) checked ${danglingChecked} conditioned record step(s) ` +
    'across EVERY workflow, including the `serviceEnvironments` ones rule 6 cannot see. Recorded failing input, run ' +
    "against the REAL tree 2026-08-09: renaming deploy-workers.yml's `id: deploy` to `id: deployy` ⇒ exit 1.",
);
// ── THE CENSUS, AND WHETHER RULE 2 WAS EXERCISED AT ALL ──────────────────────
// 🔴 THE JOBS RANGED OVER ARE LISTED, NOT COUNTED. Until 2026-08-26 this block
// printed "the branch has NO instances today and passes over nothing" while two
// `submit:` jobs carrying `--submit` sat in workflows the census never opened.
// The count looked right because the census's SCOPE was wrong, and a count is
// exactly the thing that cannot show a missing subject. So the set is printed.
console.log(
  // De-duplicated for the PRINT only: two register rows can declare the same
  // workflow and the same job (both Apple rows do), and printing that job twice
  // would make the listed set look like something it is not.
  `⬜ SUBMISSION-RECORD CENSUS ranged over ${new Set(censusJobsListed).size} job(s), listed: ${[...new Set(censusJobsListed)].join(', ')}. ` +
    'The register names ONE job per row and that is a floor, not a ceiling: every job of each declared submission ' +
    'workflow whose `run:` lines name the row\'s script is censused.',
);
console.log(
  `⬜ RULE 2b (a store publish step outside every submittable row) graded ${storeStepsGraded} step/row pair(s) of ` +
    `${storeSteps.length} store publish step(s) from workflow-scan.mjs storePublishSteps().`,
);
console.log(
  `⬜ SUBMISSION-RECORD LIMB: ${publishing} of ${rehearsals + publishing} submission invocation(s) can perform a REAL ` +
    `submission. Per channel — ${censusByRow.join(' · ')}.`,
);
if (publishing === 0) {
  // 🔴 NOT AN `ok`. A branch with zero instances is a rule that CANNOT FAIL, and
  // a rule that cannot fail prints exactly what a rule that passed prints. This
  // guard was in that state for the whole of its life until 2026-08-26 and said
  // so in language ("passes over nothing") that read as reassurance. It now
  // reads as what it is: this run made NO statement about the publish branch.
  console.log('⚠️  RULE 2 WAS NOT EXERCISED — ZERO PUBLISHING INVOCATION(S) IN ANY CENSUSED JOB.');
  console.log('    Nothing above certifies that a real submission writes a record. It certifies only that no command');
  console.log('    in any censused job is STATICALLY a real submission today, which is a different and much weaker claim.');
  console.log('    A rule with no instances cannot fail, and its output is indistinguishable from a rule that passed —');
  console.log('    which is why this is printed as a GAP rather than folded into the ok line. If you expected a publish');
  console.log('    path here, the census scope is the first thing to doubt: that is the defect fixed on 2026-08-26.');
} else {
  console.log(
    `⬜ RULE 2 IS LIVE: ${publishing} publishing invocation(s) were graded, each required to be followed IN THE SAME JOB ` +
      'by a record step for its own channel, and each such step then graded by rule 6. A `--dry-run` removed, made ' +
      'conditional, or assembled from a `${{ … }}` expression moves this number.',
  );
}
console.log(
  '⬜ No publisher account exists ([10]D-4 / OWNER_QUEUE A-2 and A-6; A-3 CLOSED 2026-08-04 and A-4 CLOSED 2026-08-31, and the Apple gap is now an unissued certificate rather than an account), so a real submission is still OWNER-GATED and ' +
    'cannot be produced by agent work. That gates the ACT, not this check: the publish branch is graded statically ' +
    'from the YAML, on every run, whether or not anybody can log in.',
);
if (outsideDeclaredLanes.length > 0) {
  // 🔴 THE PARENTHETICAL HERE ASSERTED SOMETHING THIS SCAN NEVER READ, AND IT WAS
  // WRONG ABOUT A REAL LINE. Until 2026-08-26 it said these calls "are
  // `serviceEnvironments` — backend Workers, not release channels". Two of the
  // three are. `build-platforms.yml:458` records `{app}-windows-direct`, which
  // tooling/channel-register.json declares as a `channels` row with
  // `kind: "direct"` — a RELEASE channel. The flat read finds a LINE: it never
  // parsed the argument, so it had no basis for the claim, and the claim it made
  // pointed the opposite way from the register. An unattributed call is evidence
  // that this parse did not reach it, and of nothing else.
  console.log(
    `⬜ ${outsideDeclaredLanes.length} record call(s) sit in a workflow no register row declares as a lane, printed not hidden. ` +
      'This scan reached the LINE and did not attribute it to a channel lane, so it makes NO claim here about what any ' +
      `of them records: ${outsideDeclaredLanes.join(', ')}.`,
  );
}

if (problems.length > 0) {
  console.error(`✗ ${problems.length} publishing lane(s) can finish without a [10]D-9 record:`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

// 🔴 THE OK LINE CARRIES RULE 2's EXERCISE STATE, because this is the line a
// reader scanning a CI log actually sees. "ok" over an unexercised branch is the
// sentence this guard spent its life printing, and the fix is not to stop
// passing — the tree can legitimately hold no publish path — it is to stop
// letting "ok" mean two different things.
console.log(
  `ok  publish records${publishing === 0 ? ' ⚠️ (RULE 2 NOT EXERCISED — 0 publishing invocation(s))' : ` (rule 2 exercised on ${publishing} publishing invocation(s))`} — ` +
    `${REQUIRED_COVERAGE.servedRows} served channel(s) → ${REQUIRED_COVERAGE.requiredEnvironments} ` +
    `required environment(s), all recorded by their declared lane job (${deployRecordCalls} call(s)); ` +
    `${REQUIRED_COVERAGE.submittableRows} submittable channel(s) → ${rehearsals + publishing} submission invocation(s) ` +
    `classified across ${new Set(censusJobsListed).size} censused job(s); ${flatHits.length} record call(s) found flat, all attributed.`,
);
