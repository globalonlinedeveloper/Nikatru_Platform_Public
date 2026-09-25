// ─────────────────────────────────────────────────────────────────────────────
// ops-register.test.mjs — assert-ops-register.mjs must be able to FAIL.
//
// [pipeline O-1] the operations register is complete, bounded, and still
// describes the tree it claims to describe · [O-8] cannot-revert needs a named
// mitigation that is itself a row · [O-13] every past-tense claim expires ·
// [O-14] the access intersection is computed over two independently written
// lists · [O-11] every expiring thing has a date or a named gap · [O-20] Day 0
// prints pending and is never fabricated.
//
// ⚠️ REAL-TREE MUTATIONS, RE-RUN FROM SCRATCH ON 2026-08-02 against a COPY of
// this worktree (the earlier claim in this header was inherited from an agent
// that died before verifying anything, so none of it was trusted). Fifteen for
// this guard, each: baseline green -> mutate -> exit 1 with the intended message
// -> restore FROM MEMORY -> byte-compare -> re-verify green. A crash or a
// SyntaxError is explicitly NOT counted as a catch. A fixture you wrote encodes
// the same misunderstanding as the guard you wrote — assert-seams-wired.mjs
// shipped with a check that could not fail while all six of its fixture tests
// passed.
//
//   M1  a workflow a duty row anchors at is deleted        -> COVERAGE LOST
//   M2  a new workflow with no duty row                    -> "has NO `duty` row"
//   M3  triggers.crons emptied in the anchored config      -> COVERAGE LOST
//   M4  the DELEGATED hostname register is deleted         -> COVERAGE LOST
//   M5  the delegate exists but its `hosts` array is empty -> COVERAGE LOST
//   M6  the delegate stops seeing a deployed custom domain -> "is not among the"
//   M7  a row names a reader that does not exist           -> "which is not in the tree"
//   M8  lastDrill backdated to 2020 against a 120d cadence -> "the same fact expires"
//   M9  cannot-revert row loses its mitigation             -> "no named `mitigation`"
//   M10 a free-text access provider                        -> "not in the fixed vocabulary"
//   M11 _requiredCoverage.ids emptied                      -> COVERAGE LOST
//   M12 degradedUntil backdated                            -> "has PASSED and the gap is still open"
//   M13 a duty row anchored at a workflow that is gone     -> COVERAGE LOST
//   M14 the register itself deleted                        -> COVERAGE LOST
//   M15 a recovery path widened until it needs the very
//       provider its failure row takes down                -> "THE RESPONSE PATH
//                                                             DEPENDS ON THE THING
//                                                             THAT IS DOWN"
//   15/15 caught, none crashed, every restore byte-identical and green again.
//
// ── [14]O-3 / O-11 / O-17 · REAL-TREE MUTATIONS RUN 2026-08-06 ──────────────
// 🔴 THE FALSIFIER WAS TRUE AND THE GUARD WAS GREEN, and it was one defect three
// times: an acceptance limb whose domain is empty. O-3's cadence limb queried NO
// record (it checked that a row NAMED one); O-11's lead-window arithmetic had
// executed ZERO times across twelve rows, every one `expires: null`; O-17's
// deleting-job limb ranged over ZERO stores out of nineteen. All three printed ok.
//
// O-3 NEEDED NO SYNTHETIC NEGATIVE TEST — THE TREE PROVIDES IT. Measured on the
// owner's laptop while the old guard exited 0:
//     ClaudeTranscriptBackup  LastRun 2026-08-06 02:00:01  LastTaskResult 1
//     NikatruProjectBackup    LastRun 2026-08-06 02:30:01  LastTaskResult 1
//     NIKATRU daily backup    LastRun 2026-08-06 10:00:01  LastTaskResult 0
// The repaired guard queries Task Scheduler and reddens on the first two while
// passing the third — one substrate, opposite outcomes, which is the argument
// this requirement was written on.
//
// Ten further mutations against the COMMITTED register (each: mutate -> run ->
// intended message -> restore from the pre-mutation buffer -> byte-compare).
// ⚠️ NOT `git checkout --`: the change under test was uncommitted, so checkout
// would have reverted the work instead of the mutation. 10/10 caught, none
// crashed, restore byte-identical (sha256 eac7da12…), guard back to its
// baseline of exactly the two failing laptop duties.
//
//   N1  a 13th `expires: null` row                -> "and the ceiling is 12"
//   N2  `expiryKnownAt` stripped from origin-ca   -> "must carry `expiryKnownAt`"
//   N3  a 4th `period-undeclared` row             -> "and the ceiling is 3"
//       ⚠️ THE CEILING IS NOW 2, ratcheted 2026-08-09 when the signup KV's
//       period was declared (365 days) and its row moved to `rule: ttl`. N3 was
//       re-run against the new number the same day — signup row flipped back to
//       `period-undeclared` -> "3 retention row(s) carry `rule: period-undeclared`
//       and the ceiling is 2", problem count 3 -> 4, restored byte-identical and
//       back to 3. The ratchet is not decoration: leaving a cap at its old value
//       after a gap closes lets the closed gap fund a new one silently.
//   N4  the signup KV declares a period, no job   -> "`rule: period` with no `deletingJob`"
//   N5  `recordQuery` deleted from e2e.yml's row  -> "no `mechanism.recordQuery.reader`"
//   N6  a 6th duty declared `unreachable`         -> "and the ceiling is 5"
//   N7  EVERY scheduled duty `unreachable`        -> COVERAGE LOST
//   N8  every `expiring` row deleted              -> COVERAGE LOST
//   N9  a Windows task name that does not exist   -> "DOES NOT EXIST: no scheduled
//       (the `missing` path, against the real host)   task named …"
//   N10 a declared reader no row uses             -> "is declared and no row uses it"
//
// 🔴 AND ONE FOUND BY THE HARNESS ITSELF, worth more than any of the ten: on the
// first pass the probe's 15 s timeout was shorter than a COLD `powershell` start
// plus the ScheduledTasks module autoload. It did not crash — it reported
// `unreadable`, and THE GUARD EXITED 0 WITH TWO FAILING DUTIES ON THE MACHINE.
// That is this limb's own defect returning as a timeout. Local probes now get
// their own 90 s ceiling, separate from the 15 s network one.
//
// ── THE LEAD-WINDOW LIMB, REAL-TREE MUTATIONS RUN 2026-08-04 ─────────────────
// Same protocol, against this worktree's own tooling/ops/register.json, each
// restored with `git checkout --` and re-verified green (`git status` clean,
// guard exit 0). A stack trace is NOT counted as a catch — every one of these
// printed the guard's own intended message.
//
//   S1  `degradedLeadDays` stripped from the live row  -> "no positive integer
//                                                          `degradedLeadDays`"
//   S2  degradedUntil moved to 2026-08-10, inside the
//       row's own 14-day window                        -> exit 1, "FIRES IN 6
//                                                          DAY(S), inside its own
//                                                          14-day lead window"
//   S3  degradedUntil backdated to 2026-07-01          -> exit 1, "has PASSED …
//                                                          It went red 14 day(s)
//                                                          before this"
//   S4  the tripwire disarmed entirely (both keys      -> exit 1, "\"Never done\"
//       removed)                                          must cost something",
//                                                          and the printed count
//                                                          fell to `0 dated
//                                                          tripwire(s) armed`
//   4/4 caught. S4 is the one that matters most: it proves the COUNT moves, so
//   an empty tripwire domain cannot pass as a clean register.
//
// Run:  node --test "tooling/ci/test/*.test.mjs"
// ─────────────────────────────────────────────────────────────────────────────
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseAllWorkflows, parseWorkflow, postGateJobs } from '../workflow-scan.mjs';

import {
  evaluate,
  evaluateRunRecords,
  classifyRunRecord,
  effectiveMultiplier,
  cadenceDays,
  parseJsonc,
  findWranglerConfigs,
  stripComments,
  DURABLE_ID,
  readScheduledTaskProbe,
  classifyScheduledTaskRow,
  formatTaskResult,
  classifyGlitchtipChecks,
  classifyRunHistoryAnswer,
  newestOnPage,
  reconcileRunReads,
  splitRunFilters,
  selectRuns,
  RUN_READ_RACE_MS,
  combineLimbProbes,
  describeNarrowing,
  dispatchTargetsFromSource,
  checkTimerTargetsAgainstDispatcher,
  deriveUnreadableCeiling,
  redSinceDomain,
  classifyRedSince,
  evaluateRedSince,
  diedOnlyOnInstallationQuota,
  hostWorkflowFile,
  dispatchableWorkflows,
  gateTopology,
  gateCheckName,
  workflowRunsScript,
  feedsTheGate,
  GATE_SCRIPT_REL,
  GUARD_SCRIPT_REL,
  redSinceTriggerCensus,
  redSinceTriggerShape,
  rowWorkflowFile,
  PROPOSAL_EVENTS,
  RUN_UNIT,
  workflowEventsByFile,
  hostPolicy,
  jobSteps,
  unitNeedsGuard,
  unitNeedsHosts,
  routeLiveVerdicts,
  unitOf,
  describeUnit,
  apiJobMatcher,
  unitConclusion,
  decideUnitFreshness,
  decideUnitRedSince,
  checkRunUnits,
  checkLiveVerdictScopes,
  githubDarkness,
  LIVE_READS_NOT_MADE,
  localImportClosure,
  liveReadInputs,
  proposalChangedFiles,
  liveReadPlan,
  isCallJob,
  G4_UNMEASURED,
  collectRunJobs,
  RUN_JOB_PAGES,
  gateJobOf,
  postGateAdmission,
  postGateUnit,
} from '../assert-ops-register.mjs';

const CI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = join(CI_DIR, 'assert-ops-register.mjs');

/** Escape EVERY RegExp metacharacter, backslash included. A class of `[.\/]`
 *  reads as complete and is not — it leaves `\` unescaped, which is the whole
 *  of `js/incomplete-sanitization`. These inputs are constants in this tree, so
 *  nothing here was exploitable; the rule is still right, and a half-escape
 *  copied out of a test is how the real one gets written. */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

let TMP;
before(() => { TMP = mkdtempSync(join(tmpdir(), 'nikatru-ops-')); });
after(() => { rmSync(TMP, { recursive: true, force: true }); });

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-11 · THE REPLAY STUB. A spawned guard reads GitHub, GlitchTip and D1
// over `fetch`; this module, loaded with `node --import`, answers every one of
// those reads from a JSON state file and pins `Date.now` to that file's `now`.
// It lives in the TEST and never in the guard: the guard has no fixture flag, no
// replay mode and no environment switch of its own (INV5), and what it runs
// against here is the same `fetch` a CI runner gives it. It is serialised from a
// real function, so it is parsed with the rest of this file.
// ─────────────────────────────────────────────────────────────────────────────
function replayStub(readFileSync, writeFileSync, fs) {
  const F = JSON.parse(readFileSync(process.env.OPS_REPLAY_FILE, 'utf8'));
  const NOW_MS = Date.parse(F.now);
  Date.now = () => NOW_MS;
  // ⏱ 2026-09-20 · the drill-date replay fixture — the THIRD face of the
  // past-world/present-register split, and the first one that is a dated RECORD
  // rather than a missing ANSWER, so there is no `fetch` answer to supply: the
  // register the guard opens is itself the later world. `OPS_REPLAY_REGISTER_FILE`
  // names the copy this replay serves in its place (built by `replayRegisterFile`
  // below, out of the committed register — the real file is never written). One
  // path, exactly `tooling/ops/register.json`, and nothing else is intercepted.
  const REG_FILE = process.env.OPS_REPLAY_REGISTER_FILE;
  if (REG_FILE) {
    const realRead = fs.readFileSync;
    const isRegister = (p) => typeof p === 'string' && /[\\/]tooling[\\/]ops[\\/]register\.json$/.test(p);
    fs.readFileSync = (p, ...rest) => realRead(isRegister(p) ? REG_FILE : p, ...rest);
  }
  const ghStatus = Number(process.env.OPS_REPLAY_GITHUB_STATUS || 200);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const replaySha = (id) => String(id).padStart(40, '0');
  // ⏱ 2026-09-11 — EVERY REQUEST THE GUARD MAKES IS COUNTED, by provider, and
  // written on exit when OPS_REPLAY_COUNT_FILE names a file. The quota a CI run
  // spends is a number, so the change that cuts it is proven by a number.
  const counts = { github: 0, glitchtip: 0, cloudflare: 0, other: 0 };
  if (process.env.OPS_REPLAY_COUNT_FILE) {
    process.on('exit', () => writeFileSync(process.env.OPS_REPLAY_COUNT_FILE, JSON.stringify(counts)));
  }
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'api.github.com') counts.github += 1;
    else if (url.hostname.startsWith('glitchtip')) counts.glitchtip += 1;
    else if (url.hostname === 'api.cloudflare.com') counts.cloudflare += 1;
    else counts.other += 1;
    if (url.hostname === 'api.github.com') {
      if (ghStatus !== 200) return json({ message: 'replayed refusal' }, ghStatus);
      const wfAt = parts.indexOf('workflows');
      if (wfAt !== -1 && parts[wfAt + 2] === 'runs') {
        const wf = decodeURIComponent(parts[wfAt + 1]);
        const sp = url.searchParams;
        const want = sp.get('status');
        // ⏱ 2026-09-18 — THE RUN THAT IS READING IS ON THE PAGE, as it is live: a
        // guard inside run GITHUB_RUN_ID of this workflow on main sees that run,
        // in progress, in an unfiltered history of it (the self-run anchor in
        // run-page-anchor.mjs depends on exactly that). It has no conclusion, so
        // it answers no success/failure/completed question.
        const selfRef = String(process.env.GITHUB_WORKFLOW_REF ?? '');
        const self = process.env.GITHUB_RUN_ID && selfRef.split('@')[0].endsWith(`/.github/workflows/${wf}`) && process.env.GITHUB_REF === 'refs/heads/main'
          ? [[Number(process.env.GITHUB_RUN_ID), process.env.GITHUB_EVENT_NAME ?? 'schedule', null, F.now, 'in_progress']]
          : [];
        const rows = [...(F.runs[wf] ?? []), ...self.filter(([id]) => !(F.runs[wf] ?? []).some((r) => r[0] === id))]
          .map(([id, event, conclusion, updatedAt, status = 'completed']) => ({ id, event, conclusion, status, updated_at: updatedAt, created_at: updatedAt, head_branch: 'main', head_sha: replaySha(id) }))
          .filter((r) => !sp.get('branch') || r.head_branch === sp.get('branch'))
          .filter((r) => !sp.get('created') || !sp.get('created').startsWith('>=') || r.created_at >= sp.get('created').slice(2))
          .filter((r) => !sp.get('event') || r.event === sp.get('event'))
          .filter((r) => !want || want === 'completed' || r.conclusion === want)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return json({ total_count: rows.length, workflow_runs: rows.slice(0, Number(sp.get('per_page') || 30)) });
      }
      // ⏱ 2026-09-18 — the branch-head anchor (run-page-anchor.mjs). Every run
      // carries a replay sha derived from its id, and main HEAD is the newest
      // ci.yml run's commit, dated when that run finished — the shape a live
      // push-triggered history has, so the anchor is exercised, not bypassed.
      if (parts[3] === 'commits' && parts.length === 5) {
        const ci = (F.runs['ci.yml'] ?? []).slice().sort((a, b) => b[0] - a[0])[0];
        return json({ sha: replaySha(ci ? ci[0] : 0), commit: { message: 'replay', committer: { date: ci ? ci[3] : F.now } } });
      }
      // ⏱ 2026-09-18 — the repository-wide run list, the stale-page cross-read
      // (assert-ops-register.mjs anchoredBranchPage): every workflow's runs, each
      // carrying its `path`, newest first.
      if (parts.length === 5 && parts[3] === 'actions' && parts[4] === 'runs') {
        const rows = Object.entries(F.runs ?? {})
          .flatMap(([wf, list]) => list.map(([id, event, conclusion, updatedAt]) => ({ id, event, conclusion, status: 'completed', updated_at: updatedAt, created_at: updatedAt, head_branch: 'main', head_sha: replaySha(id), path: `.github/workflows/${wf}` })))
          .filter((r) => !url.searchParams.get('branch') || r.head_branch === url.searchParams.get('branch'))
          .sort((a, b) => b.id - a.id);
        return json({ total_count: rows.length, workflow_runs: rows.slice(0, Number(url.searchParams.get('per_page') || 30)) });
      }
      const runAt = parts.indexOf('runs');
      if (runAt !== -1 && parts[runAt + 2] === 'jobs') {
        const list = F.jobs?.[parts[runAt + 1]] ?? [];
        return json({
          total_count: list.length,
          jobs: list.map(([name, conclusion, steps, jobId]) => ({ id: jobId, name, status: 'completed', conclusion, steps: (steps ?? []).map(([n, c]) => ({ name: n, conclusion: c })) })),
        });
      }
      // ⏱ 2026-09-11 — a failed job's check-run annotations, `annotations[jobId]`
      // rows `[level, message]`; a job with none recorded is a 404, as it is live.
      const crAt = parts.indexOf('check-runs');
      if (crAt !== -1 && parts[crAt + 2] === 'annotations') {
        const rows = F.annotations?.[parts[crAt + 1]];
        if (!rows) return json({ message: 'Not Found' }, 404);
        return json(rows.map(([level, message]) => ({ annotation_level: level, message })));
      }
      if (url.pathname === '/search/issues') {
        const hit = Object.entries(F.issues ?? {}).find(([t]) => (url.searchParams.get('q') ?? '').includes(t));
        return json({ items: hit ? [{ number: hit[1][0], title: hit[0], updated_at: hit[1][1] }] : [] });
      }
      return json({ message: 'Not Found' }, 404);
    }
    if (url.hostname.startsWith('glitchtip')) {
      const monAt = parts.indexOf('monitors');
      const g = monAt === -1 ? null : (F.glitchtip ?? {})[parts[monAt + 1]];
      if (!g) return json({ detail: 'Not found.' }, 404);
      const [newestUp, interval, checks, misses] = g;
      if (parts[monAt + 2] !== 'checks') return json({ id: Number(parts[monAt + 1]), monitorType: 'Heartbeat', interval });
      const up = Date.parse(newestUp);
      const out = [{ isUp: true, startCheck: newestUp }];
      for (let i = 1; i < checks; i += 1) out.push({ isUp: i <= checks - 1 - misses, startCheck: new Date(up - i * interval * 1000).toISOString() });
      return json(out);
    }
    if (url.hostname === 'api.cloudflare.com') {
      const body = JSON.parse(init.body ?? '{}');
      let results;
      if (String(body.sql ?? '').includes('GROUP BY job')) {
        results = Object.entries(F.d1?.jobs ?? {}).map(([job, ranAt]) => ({ job, ran_at: ranAt }));
      } else {
        const [job, target] = body.params ?? [];
        results = [{ job, target, ran_at: (F.d1?.targets ?? {})[target] ?? null }];
      }
      return json({ success: true, result: [{ results }] });
    }
    return json({ message: `the replay has no answer for ${url.href}` }, 599);
  };
}
let replayStubHref = null;
function replayStubUrl() {
  if (replayStubHref === null) {
    const p = join(TMP, 'ops-replay-stub.mjs');
    // ⏱ 2026-09-20 — `node:fs` is reached through `createRequire` and NEVER through
    // `import { readFileSync } from 'node:fs'` here, and that is load-bearing, not
    // style. An ESM named import of a builtin instantiates that builtin's ESM
    // facade and SYNCS its bindings there and then; a later write to the CJS
    // export object is not re-synced, so the register substitution below would be
    // invisible to the guard's own `import { readFileSync }`. MEASURED on Node
    // v24.18.0: wrapper imports fs as ESM -> the spawned module reads the REAL
    // file; wrapper takes it by `createRequire` only -> it reads the substitute.
    // The stub keeps the ORIGINAL functions as parameters, so its own reads and
    // its exit-time count write are never routed through its own patch.
    writeFileSync(
      p,
      `import { createRequire } from 'node:module';\nconst fs = createRequire(import.meta.url)('node:fs');\n(${replayStub.toString()})(fs.readFileSync, fs.writeFileSync, fs);\n`,
    );
    replayStubHref = pathToFileURL(p).href;
  }
  return replayStubHref;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-15 · O-HEARTBEAT-DUTY-BREAKS-REPLAY-FIXTURE. THE FREEZE FIXTURE IS A
// PAST WORLD AND THE REGISTER IS THE PRESENT ONE. The replay grades the CURRENT
// register, so every glitchtip-heartbeat duty added after 2026-09-11 named a
// monitor the fixture had no answer for; the stub answered 404, the guard read
// "the monitor is gone", and a correct register change read as a failing test
// until somebody hand-wrote an answer into the fixture (monitors 37 and 38 were).
//
// So the answers are now SPLIT BY PROVENANCE:
//   · `glitchtipMonitorsAtFreeze` lists the monitors grading run 34546423386
//     actually read. Each one is answered ONLY by the fixture, with the value
//     that run printed. A missing answer for one of them is NOT filled in — it
//     stays a 404, and the replay goes red (the control below proves it).
//   · every OTHER monitor the register's glitchtip-heartbeat rows name is
//     derived here, from the register, as one clean beat at the fixture's `now`,
//     so a new duty changes nothing any original answer decided.
// The derivation lives in the TEST, never in the guard (INV5).
// ─────────────────────────────────────────────────────────────────────────────
const REPLAY_REGISTER = join(resolve(CI_DIR, '..', '..'), 'tooling', 'ops', 'register.json');

/** The world a replay serves: the fixture, plus a derived answer for each
 *  register-declared heartbeat monitor the freeze never had. Pure. */
function replayWorld(fixture, register) {
  const atFreeze = new Set((fixture.glitchtipMonitorsAtFreeze ?? []).map(String));
  const glitchtip = { ...(fixture.glitchtip ?? {}) };
  const derived = [];
  const beat = new Date(Date.parse(fixture.now)).toISOString();
  for (const row of register.rows ?? []) {
    const q = row?.mechanism?.recordQuery;
    if (q?.reader !== 'glitchtip-heartbeat') continue;
    const id = String(q.monitor);
    if (atFreeze.has(id) || Object.hasOwn(glitchtip, id)) continue;
    glitchtip[id] = [beat, 3600, 1, 0];
    derived.push(id);
  }
  // ⏱ 2026-09-16 · O-D1-HEARTBEAT-REPLAY-HAND-LIST. The same split for D1. The
  // fixture's `d1.jobs` / `d1.targets` answer ONLY what run 34546423386 read
  // (`d1JobsAtFreeze` / `d1TargetsAtFreeze`); every other job or target the
  // register's cloudflare-d1-heartbeat reads name — a cron row's `watchedJobs`, a
  // narrowed read's `job`, a timer limb's `target` — gets one clean beat at `now`.
  // MEASURED before this: a throwaway timer target read `holds NO SUCCESSFUL RUN
  // AT ALL` and turned INV1 and INV2 red; a throwaway watched job stayed green
  // only because the unnarrowed read never names a job that has no row
  // (erasure_retry and boxb_reachability were already in that state).
  const d1 = { jobs: { ...(fixture.d1?.jobs ?? {}) }, targets: { ...(fixture.d1?.targets ?? {}) } };
  const derivedD1 = { jobs: [], targets: [] };
  const d1AtFreeze = { jobs: new Set(fixture.d1JobsAtFreeze ?? []), targets: new Set(fixture.d1TargetsAtFreeze ?? []) };
  const answerD1 = (kind, key) => {
    if (key === undefined) return;
    const k = String(key);
    if (d1AtFreeze[kind].has(k) || Object.hasOwn(d1[kind], k)) return;
    d1[kind][k] = beat;
    derivedD1[kind].push(k);
  };
  for (const row of register.rows ?? []) {
    const q = row?.mechanism?.recordQuery;
    for (const limb of [q, q?.timer]) {
      if (limb?.reader !== 'cloudflare-d1-heartbeat') continue;
      answerD1('jobs', limb.job);
      answerD1('targets', limb.target);
      if (limb === q) for (const job of Object.keys(row.watchedJobs ?? {})) answerD1('jobs', job);
    }
  }
  // ⏱ 2026-09-24 · the same split for a SCHEDULED WORKFLOW the freeze never read.
  // `githubWorkflowsAtFreeze` lists the nine run histories run 34546423386 read,
  // and each is answered ONLY by the fixture. A scheduled workflow added since —
  // duty.workflow.name-clearance.yml was the first — named a history the stub
  // answered EMPTY, so the replay read "holds NO SUCCESSFUL RUN AT ALL" for a
  // correct row. It gets one clean run of its own event at `now`, newest id on the
  // page. Only `unit: "run"` and only a TIME cadence: a jobs or step unit would
  // need a jobs answer this does not invent, and a `trigger` row (RED-SINCE
  // graded, redeploy-stranded.yml) already reads an empty history as it is live.
  const wfAtFreeze = new Set(fixture.githubWorkflowsAtFreeze ?? []);
  const runs = { ...(fixture.runs ?? {}) };
  const derivedRuns = [];
  let nextId = Math.max(0, ...Object.values(runs).flat().map((r) => Number(r[0]) || 0)) + 1;
  for (const row of register.rows ?? []) {
    const q = row?.mechanism?.recordQuery;
    if (q?.reader !== 'github-run-history' || q.unit !== 'run') continue;
    if (!/^\d+[hd]$/.test(String(row.cadence ?? ''))) continue;
    const wf = String(q.workflow);
    if (wfAtFreeze.has(wf) || Object.hasOwn(runs, wf)) continue;
    runs[wf] = [[nextId, q.event ?? 'schedule', 'success', beat]];
    nextId += 1;
    derivedRuns.push(wf);
  }
  return { world: { ...fixture, glitchtip, d1, runs }, derived, derivedD1, derivedRuns };
}

/** Writes `replayWorld(fixture, register)` to a file a spawned guard can read.
 *  `mutate(world)` edits the world first — the red controls use it. */
function replayWorldFile(fixturePath, mutate = null) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
  const { world } = replayWorld(fixture, register);
  if (mutate) mutate(world);
  const p = join(TMP, `replay-world-${seq++}.json`);
  writeFileSync(p, JSON.stringify(world));
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-20 · the drill-date replay fixture — the SAME split, applied to
// the register's own DATED RECORDS. #765 and #791 split the fixture's ANSWERS by
// provenance; a record has no answer to split, so the split is on the DATE:
//   · a record dated AT OR BEFORE the freeze is what run 34546423386 graded, and
//     it is handed to the guard byte for byte.
//   · a record dated AFTER the freeze happened in the world that has since gone
//     past, and the past world cannot judge it: to a clock pinned at
//     2026-09-11T00:26:07Z it reads `is in the FUTURE`, which is a verdict about
//     the FIXTURE's age and never about the register. It is normalised to the
//     fixture's own day, the freshest thing this world can say — "it had
//     happened by now" — so the record's SHAPE (how, evidence, durable id) is
//     still graded in full and only its anachronism is removed.
//   · a record dated past the REAL clock is normalised by NOTHING. That is the
//     defect the FUTURE limb exists for — the live guard reds on it — so the
//     replay must red on it too, and the two cases below hold that line.
// Only the fields the guard itself refuses for being in the future are touched:
// `absenceWatcher.downTransitionDrill.date` and the per-kind HUMAN_DATED field
// (assert-ops-register.mjs:300). `drillDue`, `degradedUntil` and `expires` are
// dated tripwires that are SUPPOSED to be in the future and are never rewritten.
// Pure, and in the TEST, never in the guard (INV5).
// ─────────────────────────────────────────────────────────────────────────────

/** The guard's HUMAN_DATED map (assert-ops-register.mjs:300): the kinds whose
 *  "when was this last done" is a hand-written date rather than a machine record. */
const REPLAY_HUMAN_DATED = new Map([
  ['recovery-path', 'lastDrill'],
  ['revert', 'lastDone'],
  ['failure-mode', 'lastDone'],
]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The register a replay serves: the committed one, with every past-tense date
 *  that the freeze cannot have seen — and that the REAL clock has — moved to the
 *  fixture's own day. Returns the rewrites it made, so a test can assert them. */
function replayRegister(register, fixtureNow, realNowMs) {
  const fixtureMs = Date.parse(fixtureNow);
  const day = String(fixtureNow).slice(0, 10);
  const normalised = [];
  const rebased = [];
  const later = (date) => {
    if (typeof date !== 'string' || !ISO_DAY.test(date)) return false;
    const t = Date.parse(`${date}T00:00:00Z`);
    return t > fixtureMs && t <= realNowMs;
  };
  const rows = (register.rows ?? []).map((row) => {
    let out = row;
    const drill = row?.absenceWatcher?.downTransitionDrill;
    if (drill && typeof drill === 'object' && later(drill.date)) {
      normalised.push(`${row.id} · absenceWatcher.downTransitionDrill.date ${drill.date} -> ${day}`);
      out = { ...out, absenceWatcher: { ...out.absenceWatcher, downTransitionDrill: { ...drill, date: day } } };
    }
    const field = REPLAY_HUMAN_DATED.get(row?.kind);
    if (field && later(row[field])) {
      normalised.push(`${row.id} · ${field} ${row[field]} -> ${day}`);
      out = { ...out, [field]: day };
    }
    // ⏱ 2026-09-24 · a BOOTSTRAP is judged at the distance the REAL clock sees.
    // The guard refuses a `recordQuery.firstDue` more than one cadence window
    // ahead of `Date.now()`, and the stub pins that to the freeze, so a bootstrap
    // written on 2026-09-24 read 22 days ahead in the past world and every replay
    // went red on a correct row. It is moved back by exactly the gap between the
    // real clock and the fixture's, so "how far ahead" is the live guard's number:
    // a firstDue the live guard refuses is still refused here, and one it has let
    // expire has expired here too. The real clock, not `realNowMs`: that parameter
    // pins the drill rule above, and a bootstrap is only ever legal relative to now.
    const q = row?.mechanism?.recordQuery;
    if (typeof q?.firstDue === 'string' && !Number.isNaN(Date.parse(q.firstDue))) {
      const moved = new Date(Date.parse(q.firstDue) - (Date.now() - fixtureMs)).toISOString();
      rebased.push(`${row.id} · recordQuery.firstDue ${q.firstDue} -> ${moved}`);
      out = { ...out, mechanism: { ...out.mechanism, recordQuery: { ...q, firstDue: moved } } };
    }
    return out;
  });
  return { register: { ...register, rows }, normalised, rebased };
}

/** Writes `replayRegister(committed, fixture.now, Date.now())` to a file the
 *  stub serves in place of `tooling/ops/register.json`. `mutate(register)` edits
 *  the committed copy FIRST — that is how a lane's unlanded records, and the
 *  red controls, are replayed without ever writing the real register. */
function replayRegisterFile(fixturePath, { mutate = null, realNowMs = Date.now(), normalise = replayRegister } = {}) {
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
  if (mutate) mutate(register);
  const { register: served } = normalise(register, fixture.now, realNowMs);
  const p = join(TMP, `replay-register-${seq++}.json`);
  writeFileSync(p, JSON.stringify(served));
  return p;
}

/** A child environment with every inherited GitHub, GlitchTip, Cloudflare and
 *  replay variable removed — a guard-meta job runs this suite INSIDE a
 *  pull_request run, and a spawned guard must not inherit that host by accident. */
function scrubbedEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (!/^(GITHUB_|GH_TOKEN$|GLITCHTIP_|CLOUDFLARE_|OPS_REPLAY_)/.test(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

let seq = 0;

const NOW = Date.parse('2026-08-02T00:00:00Z');

/** The smallest register that PASSES, so every mutation below is proven to fail
 *  for its own reason rather than for a defect it inherited from the fixture. */
function baseRegister() {
  return {
    _kinds: ['surface', 'duty', 'expiring', 'recovery-path', 'revert', 'retention', 'review', 'failure-mode'],
    _providers: ['github', 'google', 'cloudflare', 'laptop', 'oci'],
    // [14]O-4. Kept to the three substrates the fixture rows actually reach: an
    // unexercised key is an error, on purpose, so this map cannot accumulate
    // mappings about nothing while looking like coverage.
    _substrateHosts: { 'github-actions': 'github', 'windows-task-scheduler': 'laptop', 'glitchtip-heartbeat': 'oci' },
    _maxCadenceDays: { surface: 7, duty: 31, expiring: 180, 'recovery-path': 180, revert: 365, retention: 365, review: 120, 'failure-mode': 365 },
    // [14]O-3/O-11/O-17. The four ceilings are set to the fixture's own state,
    // not to the real register's, so a test that adds one more null expiry or
    // one more undeclared period trips the ratchet rather than sailing past it.
    // `_recordReaders` is read by evaluateRunRecords (which main() calls), never
    // by evaluate(), so it matters only to the SPAWNED fixture roots below.
    _recordReaders: {
      _maxUnreachable: 1,
      _maxUnreadable: 1,
      _windowMultiplier: 1.5,
      'github-run-history': { queries: 'the newest successful scheduled run', needs: 'GITHUB_TOKEN' },
      unreachable: { queries: 'nothing', needs: 'n/a' },
    },
    _expiryCoverage: { _maxNull: 1 },
    _retentionCoverage: { _maxUndeclared: 1 },
    _requiredCoverage: { ids: ['recovery.bundles'] },
    rows: [
      {
        id: 'duty.workflow.ci.yml',
        kind: 'duty',
        what: 'the gate',
        detector: 'a red check',
        response: 'fix before merge',
        cadence: 'trigger',
        trigger: 'every push',
        mechanism: { substrate: 'github-actions', anchor: '.github/workflows/ci.yml', record: 'run history', failingValue: 'conclusion = failure', readBy: 'branch protection' },
        accessProviders: ['github'],
        source: 'verified',
      },
      {
        id: 'recovery.bundles',
        kind: 'recovery-path',
        what: 'restore from the offsite bundles',
        detector: 'this row',
        response: 'follow the runbook',
        cadence: '120d',
        lastDrill: '2026-07-26',
        mechanism: { substrate: 'google-drive', anchor: 'Private/runbooks/backup-liveness.md', record: 'a dated file', failingValue: 'a stale date', readBy: 'the backup script' },
        accessProviders: ['google'],
        source: 'verified',
      },
      {
        id: 'failure.laptop',
        kind: 'failure-mode',
        what: 'the laptop is gone',
        detector: 'self-evident',
        response: 'recovery.bundles',
        cadence: '365d',
        lastDone: '2026-07-26',
        takesDown: ['laptop'],
        respondsVia: 'recovery.bundles',
        // 🔴 DELIBERATELY `nikatru/` WHILE THE ROW ABOVE IS `Private/`. `OUTSIDE_CI` holds TWO
        // prefixes, and the `unverifiableAnchors` assertion below counts 2 — so this fixture is
        // the only thing making that count span BOTH branches. With both rows on one prefix the
        // other branch would be exercised by nothing and could be deleted in silence, which is
        // this repo's most repeated defect (a check that quietly stopped checking). One fixture
        // per prefix costs nothing and is not a new stored test.
        mechanism: { substrate: 'google-drive', anchor: 'nikatru/OWNER_QUEUE.md', record: 'a dated file', failingValue: 'an intersection', readBy: 'this guard' },
        accessProviders: ['google'],
        source: 'verified',
      },
      // [14]O-4's domain is duties ON A CLOCK, and the three rows above are not
      // on one. Appended (never inserted) so every rows[N] index above still
      // points where its test thinks it does, and anchored OUTSIDE Private/ and
      // nikatru/ so the unverifiableAnchors count assertion is untouched.
      {
        id: 'duty.laptop.backup',
        kind: 'duty',
        what: 'the 8-hourly offsite bundle push',
        detector: 'a heartbeat monitor on another host',
        response: 'run it by hand and read its log',
        cadence: '8h',
        mechanism: {
          substrate: 'windows-task-scheduler',
          anchor: 'renovate.json',
          record: 'LastTaskResult + the heartbeat monitor',
          failingValue: 'the heartbeat not arriving inside its grace window',
          readBy: 'the monitor, from outside the laptop',
        },
        absenceWatcher: {
          substrate: 'glitchtip-heartbeat',
          what: 'heartbeat monitor 6, on a host the laptop cannot take down',
          signal: 'no POST inside the interval -> Down -> the alert rule -> email',
          margin: 'interval 12h against an 8h cadence = 1.5x, so one late run is not an alarm',
          downTransitionDrill: {
            date: '2026-07-30',
            how: 'shrank the window and enqueued the PRODUCTION check task, then restored it',
            evidence: 'delivery record 4133761a-4c83-48eb-88e0-7af79aa2e8cc at 08:56:23Z',
          },
        },
        accessProviders: ['laptop'],
        source: 'verified',
      },
    ],
  };
}

/** The one scheduled duty, by name rather than by index. */
const sched = (r) => r.rows.find((x) => x.id === 'duty.laptop.backup');

const tree = { workflows: ['ci.yml'], paths: new Set(['.github/workflows/ci.yml', 'renovate.json']) };
const run = (reg) => evaluate(reg, tree, NOW);
const messages = (reg) => run(reg).errors.join(' | ');

describe('assert-ops-register — the fixture itself must be green, or nothing below means anything', () => {
  test('the base register passes', () => {
    assert.deepEqual(run(baseRegister()).errors, []);
  });
});

describe('assert-ops-register — cadence is bounded and its escape hatches cost something', () => {
  test('a duration above the per-kind stage maximum FAILS', () => {
    const r = baseRegister();
    r.rows[1].cadence = '3650d';
    assert.match(messages(r), /exceeds the stage maximum/);
  });

  test('`on-demand` with no `why` FAILS — the word that disabled the staleness limb per row', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'on-demand';
    delete r.rows[0].trigger;
    assert.match(messages(r), /with no `why`/);
  });

  test('`on-demand` WITH a why passes, and is counted so shrinking coverage is visible', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'on-demand';
    r.rows[0].why = 'submission is event-driven; the walkability half runs on every push';
    delete r.rows[0].trigger;
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.onDemand, 1);
  });

  test('`trigger` with no named event FAILS', () => {
    const r = baseRegister();
    delete r.rows[0].trigger;
    assert.match(messages(r), /no named `trigger` event/);
  });

  test('an unparseable cadence FAILS rather than being treated as absent', () => {
    const r = baseRegister();
    r.rows[0].cadence = 'sometimes';
    assert.match(messages(r), /must be a duration/);
  });

  test('cadenceDays converts hours and days and refuses everything else', () => {
    assert.equal(cadenceDays('8h'), 1 / 3);
    assert.equal(cadenceDays('120d'), 120);
    assert.equal(cadenceDays('0d'), null);
    assert.equal(cadenceDays('on-demand'), null);
    assert.equal(cadenceDays(undefined), null);
  });
});

describe('assert-ops-register — O-13: a past-tense claim expires', () => {
  test('a drill older than its own cadence FAILS', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = '2020-01-01';
    assert.match(messages(r), /the same fact expires/);
  });

  test('a drill dated in the FUTURE fails — a drill that has not happened cannot be dated', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = '2099-01-01';
    assert.match(messages(r), /is in the FUTURE/);
  });

  test('a null drill date with neither an ownerGap nor a dated tripwire FAILS', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = null;
    assert.match(messages(r), /"Never done" must cost something/);
  });

  test('a null drill date WITH an ownerGap passes and is printed, never blocking', () => {
    const r = baseRegister();
    r.rows[1].lastDrill = null;
    r.rows[1].ownerGated = true;
    r.rows[1].ownerGap = 'only a human performs a drill; this one never has been';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.gaps.length, 1);
  });

  test('omitting the date KEY entirely fails — that is how a claim becomes true forever', () => {
    const r = baseRegister();
    delete r.rows[1].lastDrill;
    assert.match(messages(r), /must carry `lastDrill`/);
  });
});

describe('assert-ops-register — O-8: cannot-revert needs a mitigation that can itself go stale', () => {
  const withRevert = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'revert.client',
      kind: 'revert',
      what: 'a shipped binary',
      detector: 'the mitigation must be a row',
      response: 'ship forward',
      cadence: '365d',
      lastDone: null,
      ownerGated: true,
      ownerGap: 'nothing has shipped yet',
      path: 'cannot-revert',
      mechanism: { substrate: 'app-stores', anchor: 'renovate.json', record: 'the tracks', failingValue: 'no recall', readBy: 'nothing' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('cannot-revert with no mitigation FAILS', () => {
    assert.match(messages(withRevert({})), /no named `mitigation`/);
  });

  test('a mitigation naming a row that does not exist FAILS', () => {
    assert.match(messages(withRevert({ mitigation: 'revert.imaginary' })), /is not a row in this register/);
  });

  test('a mitigation with no cadence of its own FAILS — that is what makes it a sentence again', () => {
    const r = withRevert({ mitigation: 'recovery.bundles' });
    assert.match(messages(r), /is kind `recovery-path`, not `revert`/);
  });

  test('a real mitigation row passes, and the cannot-revert COUNT is printed', () => {
    const r = withRevert({ mitigation: 'revert.mitigation.force-update' });
    r.rows.push({
      id: 'revert.mitigation.force-update',
      kind: 'revert',
      what: 'the force-update kill switch',
      detector: 'its own cadence',
      response: 'raise the minimum version',
      cadence: '365d',
      lastDone: '2026-07-26',
      path: 'config minimum version',
      mechanism: { substrate: 'cloudflare-worker-route', anchor: 'renovate.json', record: 'the config payload', failingValue: 'a client that does not pick it up', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.cannotRevert, 1);
  });
});

describe('assert-ops-register — O-14: the intersection is over TWO independently written lists', () => {
  test('a response path that needs the downed provider FAILS', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = ['google', 'laptop'];
    assert.match(messages(r), /THE RESPONSE PATH DEPENDS ON THE THING THAT IS DOWN/);
  });

  test('the SAME clash produced from the failure row instead FAILS identically', () => {
    const r = baseRegister();
    r.rows[2].takesDown = ['google'];
    assert.match(messages(r), /THE RESPONSE PATH DEPENDS ON THE THING THAT IS DOWN/);
  });

  test('a respondsVia that is not a recovery-path FAILS', () => {
    const r = baseRegister();
    r.rows[2].respondsVia = 'duty.workflow.ci.yml';
    assert.match(messages(r), /is kind `duty`, not `recovery-path`/);
  });

  test('an empty accessProviders FAILS as "cannot be checked", never passes', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = [];
    assert.match(messages(r), /cannot be checked against any failure/);
  });

  test('a provider outside the fixed vocabulary FAILS — free text makes the intersection uncomputable', () => {
    const r = baseRegister();
    r.rows[1].accessProviders = ['Google LLC'];
    assert.match(messages(r), /not in the fixed vocabulary/);
  });

  test('a failure with no takesDown FAILS', () => {
    const r = baseRegister();
    delete r.rows[2].takesDown;
    assert.match(messages(r), /must name the providers it `takesDown`/);
  });
});

describe('assert-ops-register — mechanism, source and the Private/ blind spot', () => {
  test('an anchor that is not in the tree FAILS', () => {
    const r = baseRegister();
    r.rows[0].mechanism.anchor = '.github/workflows/gone.yml';
    assert.match(messages(r), /is not in the tree/);
  });

  test('an anchor under Private/ is ACCEPTED and COUNTED, because CI cannot read it', () => {
    const v = run(baseRegister());
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.unverifiableAnchors, 2);
  });

  test('a mechanism with no reachable failing value FAILS', () => {
    const r = baseRegister();
    r.rows[0].mechanism.failingValue = '';
    assert.match(messages(r), /`mechanism.failingValue` is empty/);
  });

  test('`source: unverified` with no reason FAILS, and with one is counted', () => {
    const r = baseRegister();
    r.rows[1].source = 'unverified';
    assert.match(messages(r), /with no `unverifiedWhy`/);
    r.rows[1].unverifiedWhy = 'corroborated only by this repo\'s own runbook';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.unverified, 1);
  });

  test('a source that is neither verified nor unverified FAILS', () => {
    const r = baseRegister();
    r.rows[1].source = 'probably';
    assert.match(messages(r), /must be `verified` or `unverified`/);
  });

  test('`ownerGated` with no `ownerGap` FAILS — a gap nobody describes is a waiver', () => {
    const r = baseRegister();
    r.rows[1].ownerGated = true;
    assert.match(messages(r), /with no `ownerGap`/);
  });
});

describe('assert-ops-register — the dated tripwire cannot rot', () => {
  /** A well-formed tripwire, so each mutation below fails for its own reason. */
  const withTripwire = (extra = {}) => {
    const r = baseRegister();
    Object.assign(r.rows[1], {
      degradedUntil: '2099-01-01',
      degradedWhy: 'another stage owns the fix',
      degradedLeadDays: 14,
      ...extra,
    });
    return r;
  };

  test('a degradedUntil in the past FAILS', () => {
    assert.match(messages(withTripwire({ degradedUntil: '2020-01-01' })), /has PASSED and the gap is still open/);
  });

  test('the PASSED message says the row already went red, and refuses the date-moving exit', () => {
    const m = messages(withTripwire({ degradedUntil: '2020-01-01' }));
    assert.match(m, /went red 14 day\(s\) before this/);
    assert.match(m, /Moving the date is the one move this field exists to refuse/);
  });

  // ⏱ 2026-09-24 (the PR 913 review, L2): this guard's date check read
  // `Date.parse(s)` alone, and V8 parses `2026-02-31` as 3 March. It imports the
  // one round-trip check from tooling/app-yaml/schema-validate.mjs now.
  test('a degradedUntil that is not a calendar day (2099-02-31) FAILS as not an ISO date', () => {
    assert.match(messages(withTripwire({ degradedUntil: '2099-02-31' })), /`degradedUntil` must be an ISO date/);
    assert.deepEqual(run(withTripwire({ degradedUntil: '2096-02-29' })).errors, [], 'green control: a real leap day far out is a date');
  });

  test('a degradedUntil far in the future PRINTS and does not block', () => {
    const v = run(withTripwire());
    assert.deepEqual(v.errors, []);
    assert.equal(v.prints.filter((p) => p.includes('DEGRADED')).length, 1);
  });

  test('the print says how many days remain before it goes RED, not just the final date', () => {
    // A signal that never changes is a signal nobody reads: the row this limb
    // was written for printed the identical line at T-27 and at T-1.
    const v = run(withTripwire());
    assert.match(v.prints.find((p) => p.includes('DEGRADED')), /Goes RED in \d+ day\(s\) \(14-day lead window\)/);
  });

  // ── THE LIMB THIS FILE GAINED ON 2026-08-04 ───────────────────────────────
  test('INSIDE the lead window it goes RED, with time still left to act', () => {
    // NOW is 2026-08-02 in this suite; 10 days out sits inside a 14-day window.
    const m = messages(withTripwire({ degradedUntil: '2026-08-12', degradedLeadDays: 14 }));
    assert.match(m, /FIRES IN \d+ DAY\(S\)/);
    assert.match(m, /inside its own 14-day lead window/);
  });

  test('OUTSIDE the lead window it does not block — the warning is a window, not a second deadline', () => {
    const v = run(withTripwire({ degradedUntil: '2026-08-12', degradedLeadDays: 3 }));
    assert.deepEqual(v.errors, []);
  });

  test('the red message names the gap AND the recorded response, so it is actionable', () => {
    const m = messages(withTripwire({ degradedUntil: '2026-08-12' }));
    assert.match(m, /THE GAP: another stage owns the fix/);
    assert.match(m, /THE RESPONSE ON RECORD:/);
  });

  test('a degradedUntil with NO lead window FAILS — this is the shape that detonated', () => {
    const r = baseRegister();
    r.rows[1].degradedUntil = '2099-01-01';
    r.rows[1].degradedWhy = 'another stage owns the fix';
    assert.match(messages(r), /no positive integer `degradedLeadDays`/);
  });

  test('a zero or negative lead window is not a lead window', () => {
    assert.match(messages(withTripwire({ degradedLeadDays: 0 })), /no positive integer `degradedLeadDays`/);
    assert.match(messages(withTripwire({ degradedLeadDays: -5 })), /no positive integer `degradedLeadDays`/);
  });

  test('a non-integer lead window is refused', () => {
    assert.match(messages(withTripwire({ degradedLeadDays: 14.5 })), /no positive integer `degradedLeadDays`/);
    assert.match(messages(withTripwire({ degradedLeadDays: '14' })), /no positive integer `degradedLeadDays`/);
  });

  test('a degradedUntil with no reason FAILS — a deadline with no reason is one somebody extends', () => {
    const r = baseRegister();
    r.rows[1].degradedUntil = '2099-01-01';
    r.rows[1].degradedLeadDays = 14;
    assert.match(messages(r), /with no `degradedWhy`/);
  });

  test('armed tripwires are COUNTED, so zero and one cannot read alike', () => {
    // An empty domain that prints nothing is this repo's most repeated defect.
    assert.equal(run(withTripwire()).stats.datedTripwires, 1);
    assert.equal(run(baseRegister()).stats.datedTripwires, 0);
  });
});

describe('assert-ops-register — O-11 expiring and O-20 review', () => {
  const withExpiring = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'expiring.domain',
      kind: 'expiring',
      what: 'a domain registration',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      // [14]O-11, 2026-08-06: the price of the null tolerance. Not optional in
      // the fixture either — a fixture that opts out of the field under test is
      // how a guard ships with a check its own tests never exercise.
      expiryKnownAt: 'the registrar console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'cloudflare-registrar', anchor: 'Private/runbooks/operations.md', record: 'the console', failingValue: 'auto-renew off', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('an expiry inside its own lead window FAILS', () => {
    const soon = new Date(NOW + 5 * 86_400_000).toISOString().slice(0, 10);
    assert.match(messages(withExpiring({ expires: soon, ownerGated: false, ownerGap: undefined })), /inside its own 30-day lead window/);
  });

  test('an expiry in the past FAILS', () => {
    assert.match(messages(withExpiring({ expires: '2020-01-01', ownerGated: false, ownerGap: undefined })), /is in the PAST/);
  });

  test('an expiry that is not a calendar day (2027-04-31) FAILS as not an ISO date', () => {
    assert.match(messages(withExpiring({ expires: '2027-04-31', ownerGated: false, ownerGap: undefined })), /`expires` is not an ISO date: "2027-04-31"/);
  });

  test('an expiry comfortably beyond the lead window passes', () => {
    const far = new Date(NOW + 300 * 86_400_000).toISOString().slice(0, 10);
    assert.deepEqual(run(withExpiring({ expires: far, ownerGated: false, ownerGap: undefined })).errors, []);
  });

  test('a null expiry with no ownerGap and no satisfiedBy FAILS', () => {
    assert.match(messages(withExpiring({ ownerGated: false, ownerGap: undefined })), /An unknown expiry is a gap, not an absence/);
  });

  test('a leadDays of zero FAILS — a lead time is what makes an expiry actionable', () => {
    assert.match(messages(withExpiring({ leadDays: 0 })), /`leadDays` must be a positive integer/);
  });

  test('`satisfiedBy` whose duty no longer clears the margin FAILS — the silent re-arming', () => {
    const r = withExpiring({ ownerGated: false, ownerGap: undefined, satisfiedBy: 'duty.slow', windowDays: 180 });
    r.rows.push({
      id: 'duty.slow',
      kind: 'duty',
      what: 'a backup that used to run every 8 hours and now runs monthly',
      detector: 'a heartbeat',
      response: 'run it',
      cadence: '30d',
      mechanism: { substrate: 'windows-task-scheduler', anchor: 'Private/runbooks/backup-liveness.md', record: 'LastTaskResult', failingValue: '!= 0', readBy: 'a monitor' },
      accessProviders: ['laptop'],
      source: 'verified',
    });
    assert.match(messages(r), /no longer satisfies this by construction/);
  });

  test('a review row PRINTS Day 0 pending and never invents a date', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.kill-or-keep',
      kind: 'review',
      what: 'the 90-day kill-or-keep review',
      detector: 'this row',
      response: 'keep, change, or withdraw',
      cadence: 'trigger',
      trigger: 'the paywall going live',
      dayCount: 90,
      day0: null,
      outcomes: { keep: 'no action', kill: 'execute the retirement contract' },
      ownerGated: true,
      ownerGap: 'gates all revenue',
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
      accessProviders: ['github'],
      source: 'verified',
    });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.match(v.prints.join(' '), /Day 0 PENDING/);
  });

  test('once Day 0 exists and the day count has elapsed with no review, it FAILS', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.kill-or-keep',
      kind: 'review',
      what: 'the 90-day kill-or-keep review',
      detector: 'this row',
      response: 'keep, change, or withdraw',
      cadence: '120d',
      dayCount: 90,
      day0: '2025-01-01',
      outcomes: { keep: 'no action', kill: 'withdraw' },
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'the decisions log', failingValue: 'day 90 with no review', readBy: 'this guard' },
      accessProviders: ['github'],
      source: 'verified',
    });
    assert.match(messages(r), /has passed with no recorded review/);
  });

  test('a review with fewer than two outcomes FAILS', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'review.one-way',
      kind: 'review',
      what: 'a review that can only say yes',
      detector: 'this row',
      response: 'keep',
      cadence: 'trigger',
      trigger: 'never',
      dayCount: 90,
      day0: null,
      ownerGated: true,
      ownerGap: 'pending',
      outcomes: { keep: 'no action' },
      mechanism: { substrate: 'owner-decision', anchor: 'nikatru/OWNER_QUEUE.md', record: 'x', failingValue: 'y', readBy: 'z' },
      accessProviders: ['github'],
      source: 'verified',
    });
    assert.match(messages(r), /at least two named actions/);
  });
});

describe('assert-ops-register — retention rules, whose DOMAIN is assert-retention-coverage\'s', () => {
  const withRetention = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'retention.d1.x',
      kind: 'retention',
      store: 'd1:x:y',
      what: 'a table',
      detector: 'the retention guard',
      response: 'n/a',
      cadence: '365d',
      rule: 'keep',
      keepWhy: 'it is the purchase record',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'renovate.json', record: 'the table', failingValue: 'n/a', readBy: 'the retention guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('`keep` with no written reason FAILS', () => {
    assert.match(messages(withRetention({ keepWhy: undefined })), /with no `keepWhy`/);
  });

  test('an unknown rule FAILS', () => {
    assert.match(messages(withRetention({ rule: 'forever' })), /`rule` must be one of/);
  });

  test('`period` with no periodDays FAILS', () => {
    assert.match(messages(withRetention({ rule: 'period', keepWhy: undefined })), /needs a positive integer `periodDays`/);
  });

  test('`period-undeclared` that is not owner-gated FAILS — an undeclared period is a gap somebody owns', () => {
    assert.match(messages(withRetention({ rule: 'period-undeclared', keepWhy: undefined })), /must be `ownerGated`/);
  });

  test('a retention row with no store FAILS', () => {
    assert.match(messages(withRetention({ store: '' })), /must name the `store` it covers/);
  });
});

// ── [14]O-10 · a cadence is a claim until something reads it ────────────────
// ⚠️ MUTATION-PROVEN ON THE REAL TREE FIRST (2026-08-03), and the run found a
// defect in the guard: repointing `duty.workflow.build-platforms.yml`'s
// `readBy` at `assert-e2e-proof-fresh.mjs` returned exit 0, because that
// guard's HEADER names `build-platforms.yml` four times while explaining why it
// is a sibling. A comment satisfied a check about behaviour. Comments are
// stripped now, and the last case below is that exact input.
describe('assert-ops-register — O-10: a cadence must be READ, not merely declared', () => {
  const scheduled = (over = {}) => {
    const reg = baseRegister();
    reg.rows.push({
      id: 'duty.workflow.nightly.yml',
      kind: 'duty',
      what: 'a nightly proof',
      detector: 'a guard',
      response: 'fix it',
      cadence: '1d',
      mechanism: {
        substrate: 'github-actions',
        anchor: '.github/workflows/nightly.yml',
        record: 'run history',
        failingValue: 'no scheduled success',
        readBy: 'tooling/ci/assert-nightly-fresh.mjs',
        ...over.mechanism,
      },
      // [14]O-4 applies to this row too — it is on a clock. Given the same
      // shape the real build-platforms.yml and e2e.yml rows have: a push-driven
      // reader on the very provider that runs the schedule, which is a real gap
      // and is declared as one rather than dressed up as an off-host watcher.
      absenceWatcher: {
        substrate: 'github-actions',
        what: 'a push-triggered freshness guard on the same provider as the schedule',
        ownerGated: true,
        gap: 'an off-host absence signal needs a monitor only the owner can create',
      },
      accessProviders: ['github'],
      source: 'verified',
      ...over.row,
    });
    return reg;
  };
  const withReader = (src) =>
    evaluate(
      scheduled(),
      {
        workflows: ['ci.yml', 'nightly.yml'],
        paths: new Set([...tree.paths, '.github/workflows/nightly.yml', 'tooling/ci/assert-nightly-fresh.mjs']),
        readerSource: new Map([['tooling/ci/assert-nightly-fresh.mjs', src]]),
      },
      NOW,
    );

  test('PASSES when the named reader exists and names the workflow in code', () => {
    const v = withReader("const WORKFLOW = 'nightly.yml';");
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.ok(v.prints.some((p) => /O-10 — 1 scheduled workflow duty/.test(p)));
  });

  test('🔴 FAILS when `readBy` is a SENTENCE rather than a file that exists', () => {
    const v = evaluate(
      scheduled({ mechanism: { readBy: 'somebody remembering to look' } }),
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.match(v.errors.join(' | '), /names no in-tree file that exists/);
  });

  test('a declared `freshnessGap` PRINTS instead, and never blocks', () => {
    const v = evaluate(
      scheduled({ mechanism: { readBy: 'nothing yet' }, row: { freshnessGap: 'needs a monitor only the owner can create' } }),
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /has NO in-tree freshness reader: needs a monitor/);
  });

  test('🔴 FAILS when the reader exists but names ANOTHER workflow', () => {
    const v = withReader("const WORKFLOW = 'some-other.yml';");
    assert.match(v.errors.join(' | '), /never mentions `nightly\.yml`/);
  });

  test('🔴 a COMMENT naming the workflow does not count — the real-tree defect', () => {
    const v = withReader("// this is the sibling of the guard that watches nightly.yml\nconst WORKFLOW = 'some-other.yml';");
    assert.match(v.errors.join(' | '), /never mentions `nightly\.yml`/);
  });

  test('a `trigger` duty owes no reader — it has no timer that can die', () => {
    const reg = scheduled({ row: { cadence: 'trigger', trigger: 'on push' }, mechanism: { readBy: 'a red check' } });
    const v = evaluate(
      reg,
      { workflows: ['ci.yml', 'nightly.yml'], paths: new Set([...tree.paths, '.github/workflows/nightly.yml']), readerSource: new Map() },
      NOW,
    );
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
  });
});

// ── [14]O-7 · a deploy is not trusted until the live surface agrees ──────────
// ⚠️ MUTATION-PROVEN ON THE REAL TREE FIRST: renaming the smoke invocation in
// `.github/workflows/deploy-web.yml` produced
// "deploy-web records a deployment for `subscriptiontracker-web` and never probes it".
describe('assert-ops-register — O-7: every recorded deployment is probed', () => {
  const withJobs = (deployJobs, exemptions) => {
    const reg = baseRegister();
    if (exemptions) reg._deploySmokeExemptions = exemptions;
    return evaluate(reg, { ...tree, deployJobs }, NOW);
  };

  test('PASSES when the job that records also probes', () => {
    const v = withJobs([{ workflow: 'deploy-web.yml', job: 'deploy-web', environment: 'subscriptiontracker-web', smokes: 1 }]);
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /1 deploy job\(s\) derived .*1 probe the surface they ship/);
  });

  test('🔴 FAILS when a job records a deployment and probes nothing', () => {
    const v = withJobs([{ workflow: 'deploy-web.yml', job: 'deploy-web', environment: 'subscriptiontracker-web', smokes: 0 }]);
    assert.match(v.errors.join(' | '), /records a deployment for `subscriptiontracker-web` and never probes it/);
  });

  test('🔴 a smoke in a SIBLING job does not cover this one', () => {
    // deploy-workers.yml ships two independent Workers; a file-level check would
    // certify both while touching one.
    const v = withJobs([
      { workflow: 'deploy-workers.yml', job: 'platform', environment: 'platform', smokes: 1 },
      { workflow: 'deploy-workers.yml', job: 'subscriptiontracker-api', environment: 'subscriptiontracker-api', smokes: 0 },
    ]);
    assert.match(v.errors.join(' | '), /records a deployment for `subscriptiontracker-api`/);
    assert.doesNotMatch(v.errors.join(' | '), /`platform`/);
  });

  test('a WRITTEN exemption prints instead of failing', () => {
    const v = withJobs([{ workflow: 'sites/nikatru', job: '(no job)', environment: 'site:nikatru', smokes: 0 }], {
      'site:nikatru': 'Cloudflare Git integration; covered by the external prober.',
    });
    assert.equal(v.errors.length, 0, v.errors.join(' | '));
    assert.match(v.prints.join(' | '), /exempt: Cloudflare Git integration/);
  });

  test('an EMPTY exemption is not an exemption', () => {
    const v = withJobs([{ workflow: 'sites/x', job: '(no job)', environment: 'site:x', smokes: 0 }], { 'site:x': '   ' });
    assert.match(v.errors.join(' | '), /records a deployment for `site:x`/);
  });

  test('the exemption COUNT ignores the block\'s own prose keys', () => {
    // `0 exemptions` and `3 exemptions` must not read alike, and `_why` is not
    // an exemption.
    const v = withJobs([{ workflow: 'sites/x', job: '(no job)', environment: 'site:x', smokes: 0 }], {
      _why: ['a paragraph'],
      'site:x': 'covered by the prober',
    });
    assert.match(v.prints.join(' | '), /1 written exemption\(s\)/);
  });
});

describe('assert-ops-register — structural refusals', () => {
  test('a register with no rows is refused', () => {
    const r = baseRegister();
    r.rows = [];
    assert.match(run(r).errors.join(' '), /non-empty array/);
  });

  test('duplicate ids are refused — one of them is never read', () => {
    const r = baseRegister();
    r.rows.push({ ...r.rows[0] });
    assert.match(messages(r), /duplicate row id/);
  });

  test('an unknown kind is refused rather than skipped', () => {
    const r = baseRegister();
    r.rows[0].kind = 'vibes';
    assert.match(messages(r), /is not one of/);
  });

  test('a missing top-level key is refused', () => {
    const r = baseRegister();
    delete r._providers;
    assert.match(run(r).errors.join(' '), /has no `_providers`/);
  });

  test('a workflow with no duty row anchored at it FAILS', () => {
    const v = evaluate(baseRegister(), { workflows: ['ci.yml', 'brand-new.yml'], paths: tree.paths }, NOW);
    assert.match(v.errors.join(' '), /has NO `duty` row anchored at it/);
  });
});

describe('assert-ops-register — the helpers it depends on', () => {
  test('parseJsonc strips comments without eating the // inside a URL', () => {
    const o = parseJsonc('{\n// a comment\n"u": "https://x.example/y", /* block */ "n": 1,\n}');
    assert.equal(o.u, 'https://x.example/y');
    assert.equal(o.n, 1);
  });

  test('findWranglerConfigs separates live configs from the brick TEMPLATE', () => {
    const root = join(TMP, `w${seq++}`);
    mkdirSync(join(root, 'services/a'), { recursive: true });
    mkdirSync(join(root, 'tooling/bricks/app/__brick__/svc'), { recursive: true });
    writeFileSync(join(root, 'services/a/wrangler.jsonc'), '{}');
    writeFileSync(join(root, 'tooling/bricks/app/__brick__/svc/wrangler.jsonc'), '{}');
    const { found, excluded } = findWranglerConfigs(root);
    assert.deepEqual(found, ['services/a/wrangler.jsonc']);
    assert.equal(excluded.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 `stripComments` WAS A REGEX PAIR, AND IT SWALLOWED 103 LINES OF A REAL FILE.
//
// Measured 2026-08-07 against the committed tree. The old body ran the block
// regex FIRST and only then blanked `//` lines:
//
//     s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(...))
//
// so a `/*` sitting INSIDE a line comment was read as a block opener.
// tooling/ci/assert-ceiling-budget.mjs:32 is
//
//     //   3. every `const NAME = <number>` in services/*/src/ is annotated
//
// and the `/*` in `services/*/src/` opened a phantom block that ran to the next
// `*/` — blanking lines 32–134, INCLUDING the real code at :121
// `const CEILINGS = 'tooling/ceilings.json';`. Pre-fix, over that file:
//   raw includes 'ceilings.json' = true · stripped includes 'ceilings.json' = FALSE.
//
// [14]O-10 feeds this function's output to `readerSrc.includes(wfFile)`, so a
// reader whose only mention of its workflow lived in a swallowed region is
// reported as never mentioning it — a FALSE VERDICT from a guard that reads.
// Exactly the family assert-platform-register.mjs already paid for, where
// `app.use('/v1/plan/*', …)` hid 5 of 12 route mounts.
//
// THE FIX IS NOT A BETTER REGEX. Comments, strings and regex literals are one
// grammar and must be walked in ONE pass; this now delegates to
// text-reductions.mjs's `stripSourceComments`, which is the tokenizer nine
// guards already share, rather than becoming a fourth hand-rolled copy.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — stripComments is a tokenizer, not a pair of regexes', () => {
  test('🔴 a `/*` inside a LINE comment does not open a block', () => {
    const src = ['// scan services/*/src/ for ceilings', "const CEILINGS = 'tooling/ceilings.json';", 'let after = 1; /* real */ let tail = 2;'].join('\n');
    const out = stripComments(src);
    assert.match(out, /ceilings\.json/, 'the line comment ended at the newline; the code below it is code');
    assert.match(out, /let tail = 2;/, 'and everything up to the next `*/` was NOT swallowed');
    assert.doesNotMatch(out, /scan services/, 'the line comment itself is still gone');
  });

  test('🔴 THE REAL FILE: assert-ceiling-budget.mjs keeps its ceilings.json constant', () => {
    // The tree is the fixture. A fixture I wrote encodes the same
    // misunderstanding as the function I wrote; this one does not.
    const real = readFileSync(join(CI_DIR, 'assert-ceiling-budget.mjs'), 'utf8');
    assert.ok(real.includes("const CEILINGS = 'tooling/ceilings.json';"), 'premise: the constant is really there');
    assert.match(stripComments(real), /const CEILINGS = 'tooling\/ceilings\.json';/);
  });

  test('a `//` inside a string literal does not start a comment', () => {
    // ⚠️ `'https://x'` is NOT the falsifying input — the old regex required the
    // `//` to follow whitespace or a line start, and in `https://` it follows a
    // colon, so that probe passed against the broken function. An assertion that
    // cannot fail inflates coverage. A SPACE before the `//` is what fires it.
    const out = stripComments("bad('run node guard.mjs // then read it'); const n = 1;");
    assert.match(out, /then read it/, 'the message is a string, not a comment');
    assert.match(out, /const n = 1;/, 'and the statement after it is still code');
  });

  test('a `/*` inside a string literal does not open a block', () => {
    // The assert-platform-register.mjs defect, verbatim: a Hono route path whose
    // wildcard reads as a block opener, closed by a `*/` inside a LATER string.
    const out = stripComments(
      ["app.use('/v1/plan/*', platformAuth);", "app.route('/v1', cancellation);", "const note = 'the span closes here */';"].join('\n'),
    );
    assert.match(out, /cancellation/, 'the route after the `/*`-bearing path must survive');
    assert.match(out, /\/v1\/plan\/\*/);
  });

  test('a real block comment is still stripped', () => {
    const out = stripComments('/* app.route(ghost); */ real();');
    assert.doesNotMatch(out, /ghost/);
    assert.match(out, /real\(\);/);
  });

  test('a real line comment is still stripped — full-line and trailing', () => {
    assert.doesNotMatch(stripComments('// app.route(ghost);\nreal();'), /ghost/);
    assert.match(stripComments('// app.route(ghost);\nreal();'), /real\(\);/);
    assert.doesNotMatch(stripComments('real(); // ghost\n'), /ghost/);
  });

  test('the extension decides the comment grammar — and both grammars in the register REDUCE', () => {
    // An extension text-reductions.mjs does not know is returned VERBATIM. Every
    // `mechanism.readBy` in the real register is .mjs or .yml; assert both are
    // really reduced, so "unknown extension = identity" can never become a
    // silent no-op here without this test going red.
    const yaml = "on:\n  push:\n# ghost-workflow.yml\n    branches: ['main'] # ghost-trailing\n";
    const outY = stripComments(yaml, '.yml');
    assert.doesNotMatch(outY, /ghost-workflow\.yml/, '.yml must be read with `#` comments');
    assert.doesNotMatch(outY, /ghost-trailing/);
    assert.match(outY, /branches: \['main'\]/);
    assert.doesNotMatch(stripComments('// ghost\nreal();', '.mjs'), /ghost/);
  });
});

describe('assert-ops-register — [14]O-3 · the record-query limb, whose domain must never be empty', () => {
  // 🔴 WHAT THIS SUITE IS ABOUT. Until 2026-08-06 the cadence limb checked that
  // a duty row NAMED a `record`, a `readBy` and a `failingValue` — three
  // assertions about prose — while ClaudeTranscriptBackup and NikatruProjectBackup
  // returned LastTaskResult = 1 every night and this guard exited 0. The
  // acceptance asks for "a query against that mechanism's own record"; the real
  // negative test is the tree itself, and it is recorded in this file's footer.
  // What is exercised here is the CLASSIFICATION and the anti-vacuity rules,
  // which no probe can demonstrate.
  const NOW3 = Date.parse('2026-08-06T12:00:00Z');
  const readers = () => ({
    _maxUnreachable: 1,
    _maxUnreadable: 1,
    _windowMultiplier: 1.5,
    'windows-scheduled-task': { queries: 'Get-ScheduledTaskInfo', needs: 'win32' },
    unreachable: { queries: 'nothing', needs: 'n/a' },
  });
  const duty = (id, cadence, recordQuery) => ({
    id,
    kind: 'duty',
    what: 'a scheduled duty',
    detector: 'x',
    response: 'y',
    cadence,
    mechanism: { substrate: 'windows-task-scheduler', anchor: 'renovate.json', record: 'r', failingValue: 'f', readBy: 'b', recordQuery },
  });
  const reg3 = (rows, over = {}) => ({ _recordReaders: { ...readers(), ...over }, rows });
  const two = () => [
    duty('duty.win', '1d', { reader: 'windows-scheduled-task', task: 'T' }),
    duty('duty.box', '1d', { reader: 'unreachable', why: 'on a host nothing here can reach' }),
  ];
  const probesOf = (o) => new Map(Object.entries(o));

  test('a reachable record with a fresh SUCCESS passes, and the pass is counted', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.pass, 1);
  });

  test('🔴 THE REAL TREE\'S CASE: a reachable record whose only result is a FAILURE is RED, not stale-but-tolerated', () => {
    const r = evaluateRunRecords(
      reg3(two()),
      probesOf({ 'duty.win': { lastSuccessMs: NaN, detail: 'LastTaskResult = 1 at 2026-08-06T02:00:01Z.' } }),
      NOW3,
    );
    assert.match(r.errors.join(' | '), /duty\.win — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
  });

  test('a success OUTSIDE the 1.5x window is RED, and one INSIDE it is not — the margin is real', () => {
    const stale = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 37 * 3_600_000, detail: 'd' } }), NOW3);
    assert.match(stale.errors.join(' | '), /newest SUCCESSFUL run is 37\.0h old, outside its own window \[1d x 1\.5 = 36\.0h\]/);
    const fresh = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 35 * 3_600_000, detail: 'd' } }), NOW3);
    assert.deepEqual(fresh.errors, []);
  });

  test('a reader that could not run here PRINTS and never fails — "I could not tell" is not "it is fine", and not a build break either', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { unreadable: true, why: 'this runner is linux' } }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.match(r.prints.join(' | '), /could not run here: this runner is linux/);
    assert.match(r.prints.join(' | '), /🔴 THE RECORD-QUERY LIMB ANSWERED ZERO QUERIES ON THIS RUN/);
  });

  // ── the held observation, which is what makes the verdict bind PER ROW ─────
  // 🔴 THE DEFECT THIS REPLACES, MEASURED. `_maxUnreadable` counts how many
  // readers are dark; it cannot see WHICH. On the Linux runner exactly 2 of 13
  // rows go unreadable against a ceiling of 7, so the ceiling never approaches —
  // and one of those 2 is the Windows backup, which is genuinely failing. The
  // guard was green because the only broken duty was the one nobody looked at.
  const OBS_FAIL = { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688 (0xFFFD0000) — not 0.' };
  const heldRows = (lastObserved) => {
    const rows = two();
    rows[0].mechanism.recordQuery = { reader: 'windows-scheduled-task', task: 'T', ...(lastObserved ? { lastObserved } : {}) };
    return rows;
  };
  const dark = { unreadable: true, why: 'this runner is linux' };

  test('🔴 THE HEADLINE: a dark reader on a row LAST SEEN FAILING is an ERROR, while the identical dark reader on a row holding nothing still only prints', () => {
    const held = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': dark }), NOW3);
    assert.match(held.errors.join(' | '), /duty\.win — reader `windows-scheduled-task` could not run here: this runner is linux AND the register holds its last readable observation as FAILING/);
    assert.match(held.errors.join(' | '), /4294770688/, 'the held evidence travels with the verdict, so the reader is not asked to take it on trust');
    assert.equal(held.stats.unreadable, 0, 'a known-bad row that went dark is counted as FAILING, not as unreadable');

    const unheld = evaluateRunRecords(reg3(heldRows(null)), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(unheld.errors, [], 'SAME probe, SAME ceiling: without a held failure this is still "I could not tell"');
  });

  test('a held PASS does not redden a dark reader — the field is a memory of what was read, not a switch that fails the row', () => {
    const rows = heldRows({ verdict: 'pass', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 0 at 02:00:01 UTC.' });
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.unreadable, 1);
  });

  // ── C-6, applied to the sticky-fail branch with the register's own convention ──
  // The gate lifts the BLOCK on a runner that could not read the record. It does
  // not lift the verdict, the word, or the count: `tally.fail` is the same
  // counter either way, so the summary can never read `0 FAILING` about a duty
  // this register knows is failing.
  const gatedRows = (over = { ownerGated: true, ownerGap: 'CI cannot see a laptop.' }) => {
    const rows = heldRows(OBS_FAIL);
    Object.assign(rows[0], over);
    return rows;
  };

  test('🔴 THE GATE: an `ownerGated` row with a written `ownerGap` PRINTS its held failure instead of blocking — and the print names it FAILING, not merely unreadable', () => {
    const r = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': dark }), NOW3);
    assert.deepEqual(r.errors, [], 'owner-only work must not redden every runner — CLAUDE.md C-6');
    const p = r.prints.join(' | ');
    assert.match(p, /🔴 KNOWN FAILING, NOT BLOCKING HERE: duty\.win — reader `windows-scheduled-task` could not run here/);
    assert.match(p, /holds its last readable observation as FAILING/, 'a gated line that said only "unreadable" would give back the visibility the gate is paid for');
    assert.match(p, /4294770688/, 'the held evidence travels with the printed verdict too');
    assert.match(p, /OWNER-GATED, so it prints here and does not block \(CLAUDE\.md C-6\): CI cannot see a laptop\./);
  });

  test('🔴 THE COUNT IS THE SAME COUNTER: a gated failure is still inside `FAILING`, and the summary says how many of them are gated — a gate that shrank the number would be the old `0 FAILING` by another route', () => {
    const r = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': dark }), NOW3);
    assert.equal(r.stats.fail, 1, 'gating changes the exit code, never the verdict');
    assert.equal(r.stats.gatedFail, 1);
    assert.equal(r.stats.unreadable, 0, 'a known-bad row is never laundered back into "could not tell"');
    const summary = r.prints.find((l) => /\[14\]O-3 — scheduled=\d+ ·/.test(l));
    assert.match(summary, /failing=1 \(owner-gated=1: printed, not blocking\)/);
    assert.doesNotMatch(summary, /failing=0/);
  });

  test('🔴 THE TEETH SURVIVE: the SAME dark reader and the SAME held failure still BLOCK without the gate — absent, half-declared, or on a readable failure the gate never reaches', () => {
    const ungated = evaluateRunRecords(reg3(gatedRows({})), probesOf({ 'duty.win': dark }), NOW3);
    assert.match(ungated.errors.join(' | '), /duty\.win — reader `windows-scheduled-task` could not run here/, 'no `ownerGated`: sticky-fail keeps its teeth');

    for (const half of [{ ownerGated: true }, { ownerGated: true, ownerGap: '   ' }, { ownerGated: 'true', ownerGap: 'a gap' }]) {
      const r = evaluateRunRecords(reg3(gatedRows(half)), probesOf({ 'duty.win': dark }), NOW3);
      assert.equal(r.errors.length, 1, `a gap nobody wrote is a waiver: ${JSON.stringify(half)}`);
      assert.equal(r.stats.gatedFail, 0);
    }

    // The gate is scoped to the DARK branch alone. On the host that CAN read the
    // record, an owner-gated row fails exactly as it did before — which is why
    // this change leaves the Windows runner red on the real backup duty.
    const readable = evaluateRunRecords(reg3(gatedRows()), probesOf({ 'duty.win': { lastSuccessMs: NaN, detail: 'LastTaskResult 4294770688 (0xFFFD0000).' } }), NOW3);
    assert.match(readable.errors.join(' | '), /its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
    assert.equal(readable.stats.gatedFail, 0, 'gating a READABLE failure would be the weakening this is not');
  });

  test('🔴 A HELD FAILURE IS CLEARED ONLY WHERE THE RECORD CAN BE READ — a live healthy read FAILS until the row is updated, so the sticky state cannot rot into a permanent red', () => {
    const r = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.match(r.errors.join(' | '), /its record was QUERIED and is healthy .* still reads FAILING/);
    assert.match(r.errors.join(' | '), /Clear it HERE, on the host that can read this record/);
  });

  test('a held observation must carry a LOOKUP-ABLE detail and a real verdict — an adjective holds nothing, and this field is the whole per-row guarantee', () => {
    const bad = [
      { verdict: 'broken', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688.' },
      { verdict: 'fail', at: '', detail: 'LastTaskResult 4294770688.' },
      { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'it was failing' },
      { verdict: 'fail', at: '2026-08-06T02:00:01Z' },
      'fail',
    ];
    for (const o of bad) {
      const r = evaluateRunRecords(reg3(heldRows(o)), probesOf({ 'duty.win': dark }), NOW3);
      assert.match(r.errors.join(' | '), /`recordQuery\.lastObserved` must be/, `must refuse ${JSON.stringify(o)}`);
    }
    const good = evaluateRunRecords(reg3(heldRows(OBS_FAIL)), probesOf({ 'duty.win': dark }), NOW3);
    assert.doesNotMatch(good.errors.join(' | '), /`recordQuery\.lastObserved` must be/);
  });

  test('a held observation on an `unreachable` row FAILS — nothing ever read that record, so there is no observation to hold', () => {
    const rows = two();
    rows[1].mechanism.recordQuery.lastObserved = OBS_FAIL;
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': { lastSuccessMs: NOW3 - 3_600_000, detail: 'ok' } }), NOW3);
    assert.match(r.errors.join(' | '), /duty\.box — `recordQuery\.lastObserved` on a row whose reader is `unreachable`/);
  });

  test('🔴 THE REAL TREE ON THE REAL CI RUNNER: with Task Scheduler absent, the shipped register\'s backup duty is RED — the state that printed clean in run 33001960316', () => {
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const T = /^\d+[hd]$/;
    const scheduled = real.rows.filter((r) => r.kind === 'duty' && T.test(String(r.cadence ?? '')));
    const win = scheduled.filter((r) => r.mechanism?.recordQuery?.reader === 'windows-scheduled-task');
    // ⚠️ `win` IS LEGITIMATELY EMPTY SINCE 2026-09-02 and this test must not
    // demand otherwise. Its last member, duty.laptop.nikatru-daily-backup, moved
    // to `glitchtip-heartbeat` so the duty could be read from the Linux runner
    // this test is named after, and `windows-scheduled-task` is parked in
    // `_retiredReaders`. Re-asserting `win.length > 0` here would make the
    // register's own remedy — "delete it, or point a row at it" — impossible to
    // apply, which is a test holding a design in place rather than protecting a
    // property.
    //
    // 🔴 WHAT THE PROPERTY ACTUALLY WAS, AND WHERE IT LIVES NOW. This test's
    // subject is NOT Task Scheduler: it is "a duty last seen FAILING does not go
    // green by going dark on a runner that cannot read it". That is still
    // asserted, twice over — on fixtures at `a dark reader on a row held FAILING
    // …` above, and on the real committed row in the `glitchtip-heartbeat`
    // describe below, which drives the shipped register through a stale, a
    // miss-only and a 404 probe and requires RED for each. So the guarantee is
    // kept and only the reader carrying it changed. The loop below still runs
    // over every remaining member, and reddens the day one is re-declared and
    // starts holding a failure.
    if (win.length === 0) return;
    // The guard's own non-Windows branch, driven by argument rather than by host,
    // so this assertion means the same thing on the laptop and on the runner.
    const byTask = readScheduledTaskProbe(win.map((r) => r.mechanism.recordQuery.task), { platform: 'linux' });
    const probes = new Map();
    for (const r of win) probes.set(r.id, byTask.get(r.mechanism.recordQuery.task));
    // Every other reader answers healthy, so nothing below can be a side effect.
    for (const r of scheduled) if (!probes.has(r.id)) probes.set(r.id, { lastSuccessMs: NOW3 - 3_600_000, detail: 'stubbed healthy' });
    const r = evaluateRunRecords(real, probes, NOW3);
    for (const row of win) {
      const held = row.mechanism.recordQuery.lastObserved?.verdict === 'fail';
      if (!held) continue;
      // NOT GOING GREEN BY GOING DARK is the property; BLOCKING is only one of
      // its two channels. An `ownerGated` row prints the same verdict under the
      // KNOWN FAILING marker and does not block (CLAUDE.md C-6) — so the channel
      // is chosen by the row's own declaration, and the WORD is asserted either way.
      const gated = row.ownerGated === true;
      const channel = (gated ? r.prints : r.errors).join(' | ');
      const idRe = row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // every metacharacter, not only the dot (CodeQL #28)
      assert.match(channel, new RegExp(`${gated ? '🔴 KNOWN FAILING, NOT BLOCKING HERE: ' : ''}${idRe} — reader \`windows-scheduled-task\``), `${row.id} must not go green by going dark on a Linux runner`);
      assert.match(channel, new RegExp(`${idRe}[^|]*holds its last readable observation as FAILING`), `${row.id} must be named FAILING, not merely unreadable`);
      if (gated) assert.doesNotMatch(r.errors.join(' | '), new RegExp(idRe), `${row.id} declares \`ownerGated\`, so it must not block CI on work only the owner can do`);
    }
    // The summary is the line a reader scans, and it is what said `0 FAILING`
    // through run 33001960316 while this duty was failing every night.
    const summary = r.prints.find((l) => /\[14\]O-3 — scheduled=\d+ ·/.test(l));
    // Domain asked of the REGISTER, not of the guard's own output: with no held
    // failure left, `0 FAILING` is the true count and demanding otherwise lies.
    if (win.some((row) => row.mechanism.recordQuery.lastObserved?.verdict === 'fail')) {
      assert.doesNotMatch(summary, /failing=0/, 'the shipped register knows a duty is failing; the count must say so on the Linux runner too');
    }
  });

  test('a query that ANSWERS "the mechanism does not exist" is a hard failure — a stale row reads as coverage', () => {
    const r = evaluateRunRecords(reg3(two()), probesOf({ 'duty.win': { missing: true, why: 'no scheduled task named "T"' } }), NOW3);
    assert.match(r.errors.join(' | '), /DOES NOT EXIST: no scheduled task named "T"/);
  });

  test('a scheduled duty with NO reader at all FAILS — it would be inside the count and outside the query', () => {
    const rows = two();
    delete rows[0].mechanism.recordQuery;
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /no `mechanism\.recordQuery\.reader`/);
  });

  test('an undeclared reader name FAILS — free text would let a row invent a reader nothing implements', () => {
    const rows = two();
    rows[0].mechanism.recordQuery = { reader: 'telepathy' };
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /is not declared in `_recordReaders`/);
  });

  test('`unreachable` with no `why` FAILS — "nothing can read it" may be recorded, never passed over', () => {
    const rows = two();
    rows[1].mechanism.recordQuery = { reader: 'unreachable' };
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /`reader: "unreachable"` with no `why`/);
  });

  test('🔴 EVERY duty declared unreachable is COVERAGE LOST — the escape hatch may not become the domain', () => {
    const rows = [duty('duty.a', '1d', { reader: 'unreachable', why: 'w' }), duty('duty.b', '1d', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows, { _maxUnreachable: 9 }), new Map(), NOW3);
    assert.ok(r.coverageLost, 'an all-unreachable register must be COVERAGE LOST');
    assert.match(r.coverageLost.join(' '), /Every outcome would then be a print, this limb could not fail/);
  });

  test('one more `unreachable` than the ceiling FAILS — the ratchet only goes down', () => {
    const rows = [...two(), duty('duty.box2', '1d', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /2 duty row\(s\) declare `reader: "unreachable"` and the ceiling is 1/);
  });

  test('one more `unreadable` than ITS ceiling FAILS — "could not tell" gets a limit too, and it is a failure above it', () => {
    const rows = [...two(), duty('duty.win2', '1d', { reader: 'windows-scheduled-task', task: 'T2' })];
    const dark = { unreadable: true, why: 'this runner is linux' };
    const r = evaluateRunRecords(reg3(rows), probesOf({ 'duty.win': dark, 'duty.win2': dark }), NOW3);
    assert.match(r.errors.join(' | '), /2 scheduled duty\(ies\) went UNREADABLE on this runner and the ceiling is 1/);
    assert.match(r.prints.join(' | '), /ANSWERED ZERO QUERIES/, 'the print stays; what changed is that it no longer stands alone');
    assert.equal(r.stats.unreachable, 1, 'the OTHER ceiling is untouched: one unreachable row, ceiling 1, no error about it');
    assert.doesNotMatch(r.errors.join(' | '), /declare `reader: "unreachable"` and the ceiling/);
  });

  test('🔴 DELETING `_maxUnreadable` is COVERAGE LOST, never "no limit" — an absent ceiling is the same defect one verdict over', () => {
    const readersNoCap = readers();
    delete readersNoCap._maxUnreadable;
    for (const bad of [undefined, 0.5, '3', -1, null]) {
      const over = bad === undefined ? readersNoCap : { ...readers(), _maxUnreadable: bad };
      const r = evaluateRunRecords({ _recordReaders: over, rows: two() }, probesOf({ 'duty.win': { unreadable: true, why: 'linux' } }), NOW3);
      assert.ok(r.coverageLost, `_maxUnreadable = ${String(bad)} must refuse, not soften`);
      assert.match(r.coverageLost.join(' '), /`_recordReaders\._maxUnreadable` is missing, or is not a non-negative integer/);
      assert.equal(r.errors, undefined, 'a structural refusal does not also return a problem list to be filtered down to nothing');
    }
  });

  test('`_maxUnreadable: 0` is a legal ceiling — a register may declare that NOTHING may go unread', () => {
    const r = evaluateRunRecords(reg3(two(), { _maxUnreadable: 0 }), probesOf({ 'duty.win': { unreadable: true, why: 'linux' } }), NOW3);
    assert.equal(r.coverageLost, undefined);
    assert.match(r.errors.join(' | '), /1 scheduled duty\(ies\) went UNREADABLE on this runner and the ceiling is 0/);
  });

  test('a declared reader no row uses FAILS — a reader with no member is code that cannot fail', () => {
    const r = evaluateRunRecords(reg3(two(), { 'file-stamp': { queries: 'an mtime', needs: 'the file' } }), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /`_recordReaders\.file-stamp` is declared and no row uses it/);
  });

  test('NO duty on a clock at all is COVERAGE LOST — moving every duty off a timer must not satisfy O-3', () => {
    const rows = [duty('duty.x', 'on-demand', { reader: 'unreachable', why: 'w' })];
    const r = evaluateRunRecords(reg3(rows), new Map(), NOW3);
    assert.ok(r.coverageLost);
    assert.match(r.coverageLost.join(' '), /ranges over the empty set/);
  });

  test('deleting `_recordReaders` entirely is COVERAGE LOST, not a silent return to checking prose', () => {
    const r = evaluateRunRecords({ rows: two() }, new Map(), NOW3);
    assert.ok(r.coverageLost);
    assert.match(r.coverageLost.join(' '), /`_recordReaders` is missing/);
  });

  test('a window multiplier under 1 FAILS — a window shorter than the cadence reports a healthy duty dead', () => {
    const r = evaluateRunRecords(reg3(two(), { _windowMultiplier: 0.5 }), new Map(), NOW3);
    assert.match(r.errors.join(' | '), /_windowMultiplier` must be a number >= 1/);
  });

  // ═══ 🔴 THE WINDOW AND THE RULE, WHICH DISAGREED FOR A MONTH ═══════════════
  // `_windowMultiplier: 1.5` was documented as "One missed run is not an alarm;
  // two are." Put the last success at t=0 and the runs due at C, 2C, 3C: at age
  // C ONE run has been missed, at age 2C two have, and the alarm fires when
  // `age > window`. 1.5C therefore fires on the FIRST miss — the opposite of the
  // sentence. These cases pin the arithmetic in BOTH directions, so neither half
  // can be edited alone again.
  //
  // ⬜ THE NUMBER DID NOT MOVE AND MUST NOT: 1.5 is exactly the M=0 window, "a
  // LATE run is not an alarm; a MISSED one is". What changed is that the budget
  // is now declared per row and ADDED to the base, which keeps every window
  // strictly inside ((M+1)C, (M+2)C) — so a row alarms on exactly M+1 misses.
  const budgeted = (b, why) =>
    duty('duty.win', '1d', {
      reader: 'windows-scheduled-task',
      task: 'T',
      missedRunsTolerated: b,
      ...(why === undefined ? {} : { missedRunsToleratedWhy: why }),
    });
  const WHY = 'MEASURED: 12 gaps, worst 41h, re-take it against run 34299058966.';
  const budgetReg = (b, why, over = {}) =>
    reg3([budgeted(b, why), two()[1]], { _maxMissedRunsTolerated: 4, ...over });
  const aged = (h) => ({ 'duty.win': { lastSuccessMs: NOW3 - h * 3_600_000, detail: `fixture: ${h}h` } });

  test('🔴 THE BASE WINDOW IS THE M=0 RULE, MEASURED AT ITS EDGE: 1d x 1.5 = 36h — 35h is GREEN, 37h is RED', () => {
    assert.deepEqual(evaluateRunRecords(reg3(two()), probesOf(aged(35)), NOW3).errors, []);
    const red = evaluateRunRecords(reg3(two()), probesOf(aged(37)), NOW3);
    assert.match(red.errors.join(' | '), /duty\.win — its record IS reachable and the newest SUCCESSFUL run is 37\.0h old, outside its own window/);
    assert.equal(red.stats.fail, 1);
  });

  test('🔴 A BUDGET WIDENS ONE ROW AND STILL GOES RED WHEN THE DUTY GENUINELY STOPS — 1d + 1 tolerated = 60h, so 59h is GREEN and 61h is RED', () => {
    // The whole point of the per-row budget: it buys slack, it does NOT buy an
    // alarm that cannot fire. A window that never fires is not an alarm, so the
    // RED half of this case is the one that matters.
    assert.deepEqual(evaluateRunRecords(budgetReg(1, WHY), probesOf(aged(59)), NOW3).errors, []);
    const red = evaluateRunRecords(budgetReg(1, WHY), probesOf(aged(61)), NOW3);
    assert.equal(red.stats.fail, 1, 'a budgeted duty whose record has genuinely stopped must still be RED');
    assert.match(red.errors.join(' | '), /outside its own window/);
  });

  test('🔴 THE SLACK IS PRINTED ON EVERY LINE THE ROW EMITS — a wider window that did not say so is an invisible waiver', () => {
    const r = evaluateRunRecords(budgetReg(1, WHY), probesOf(aged(10)), NOW3);
    const line = r.prints.find((l) => /duty\.win/.test(l));
    assert.match(line, /1d x 2\.5 = 60\.0h \(base 1\.5 \+ 1 missed run\(s\) TOLERATED on this row\)/);
  });

  test('an UNBUDGETED row keeps the base window while a sibling is budgeted — the slack is per row, never register-wide', () => {
    const rows = [budgeted(1, WHY), duty('duty.two', '1d', { reader: 'windows-scheduled-task', task: 'U' }), two()[1]];
    const reg = reg3(rows, { _maxMissedRunsTolerated: 4 });
    const probes = probesOf({
      'duty.win': { lastSuccessMs: NOW3 - 40 * 3_600_000, detail: '40h' },
      'duty.two': { lastSuccessMs: NOW3 - 40 * 3_600_000, detail: '40h' },
    });
    const r = evaluateRunRecords(reg, probes, NOW3);
    assert.equal(r.stats.fail, 1, 'exactly the unbudgeted row is RED at 40h');
    assert.match(r.errors.join(' | '), /duty\.two —/);
    assert.doesNotMatch(r.errors.join(' | '), /duty\.win —/);
  });

  test('🔴 A BUDGET ABOVE THE DECLARED CEILING FAILS — the ratchet goes down, and raising the ceiling to fit a row is how every window gets widened', () => {
    const r = evaluateRunRecords(budgetReg(5, WHY), probesOf(aged(1)), NOW3);
    assert.match(r.errors.join(' | '), /missedRunsTolerated: 5` is above the declared ceiling of 4/);
  });

  test('🔴 A BUDGET WITH NO DECLARED CEILING FAILS — an undeclared ceiling reads as no ceiling, and this is the one field that widens an alarm', () => {
    const r = evaluateRunRecords(reg3([budgeted(1, WHY), two()[1]]), probesOf(aged(1)), NOW3);
    assert.match(r.errors.join(' | '), /_maxMissedRunsTolerated` is missing or not a non-negative integer/);
  });

  test('a budget that is not a whole number FAILS — it counts missed runs, and a fraction of a missed run is not a thing a window can mean', () => {
    for (const bad of [2.5, -1, '1', null]) {
      const r = evaluateRunRecords(budgetReg(bad, WHY), probesOf(aged(1)), NOW3);
      assert.match(r.errors.join(' | '), /must be a non-negative INTEGER/, `${JSON.stringify(bad)} must be refused`);
    }
  });

  test('🔴 A BUDGET WITHOUT A MEASUREMENT FAILS — "it misses sometimes" is an adjective, and only an observation may buy slack', () => {
    assert.match(evaluateRunRecords(budgetReg(1), probesOf(aged(1)), NOW3).errors.join(' | '), /with no `missedRunsToleratedWhy` carrying a MEASUREMENT/);
    assert.match(evaluateRunRecords(budgetReg(1, 'it misses sometimes'), probesOf(aged(1)), NOW3).errors.join(' | '), /carrying a MEASUREMENT/);
    assert.deepEqual(evaluateRunRecords(budgetReg(1, WHY), probesOf(aged(1)), NOW3).errors, [], 'a measurement a later reader can re-take is accepted');
  });

  test('a budget on an `unreachable` row FAILS — no query is made, so no window applies and nothing could be tolerated', () => {
    const rows = [two()[0], duty('duty.box', '1d', { reader: 'unreachable', why: 'nothing here can reach it', missedRunsTolerated: 1 })];
    const r = evaluateRunRecords(reg3(rows, { _maxMissedRunsTolerated: 4 }), probesOf(aged(1)), NOW3);
    assert.match(r.errors.join(' | '), /missedRunsTolerated` on a row whose reader is `unreachable`/);
  });

  test('a justification with no budget FAILS — it reads as slack the row does not actually have', () => {
    const rows = [duty('duty.win', '1d', { reader: 'windows-scheduled-task', task: 'T', missedRunsToleratedWhy: WHY }), two()[1]];
    const r = evaluateRunRecords(reg3(rows, { _maxMissedRunsTolerated: 4 }), probesOf(aged(1)), NOW3);
    assert.match(r.errors.join(' | '), /missedRunsToleratedWhy` with no `missedRunsTolerated`/);
  });

  test('🔴 THE SHIPPED REGISTER: every budget it declares is inside the ceiling, measured, and on a row a reader can actually query', () => {
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const decl = real._recordReaders;
    assert.equal(decl._windowMultiplier, 1.5, 'the base is the M=0 window and correcting the PROSE must not have moved it');
    assert.ok(Number.isInteger(decl._maxMissedRunsTolerated) && decl._maxMissedRunsTolerated >= 0);
    const budgeted2 = real.rows.filter((r) => r?.mechanism?.recordQuery?.missedRunsTolerated > 0);
    assert.ok(budgeted2.length > 0, 'if no row uses the field, delete it rather than carry code that cannot fail');
    for (const r of budgeted2) {
      const q = r.mechanism.recordQuery;
      assert.ok(q.missedRunsTolerated <= decl._maxMissedRunsTolerated, `${r.id} exceeds the ceiling`);
      assert.notEqual(q.reader, 'unreachable', `${r.id} budgets a window nothing queries`);
      assert.match(q.missedRunsToleratedWhy, DURABLE_ID, `${r.id} must carry a measurement a later reader can re-take`);
      // The budget must be REACHED by a real stop: a window is only an alarm if
      // ageing past it is RED.
      const days = cadenceDays(r.cadence);
      const mult = effectiveMultiplier(r, decl._windowMultiplier);
      const past = classifyRunRecord(r, { lastSuccessMs: NOW3 - days * 86_400_000 * mult - 3_600_000, detail: 'fixture' }, NOW3, decl._windowMultiplier);
      assert.equal(past.verdict, 'fail', `${r.id} must go RED once its own window lapses`);
      const inside = classifyRunRecord(r, { lastSuccessMs: NOW3 - days * 86_400_000 * mult + 3_600_000, detail: 'fixture' }, NOW3, decl._windowMultiplier);
      assert.equal(inside.verdict, 'pass', `${r.id} must stay GREEN inside its own window`);
    }
  });
});

describe('assert-ops-register — [14]O-3 · the Windows scheduled-task probe, and THE INVERSION it used to perform', () => {
  // ══ 🔴 WHAT THIS SUITE PINS · MEASURED ON THE LAPTOP 2026-08-26 ═════════════
  // `probeWindowsTasks` emitted `result=[int]$i.LastTaskResult`. `LastTaskResult`
  // is a System.UInt32 holding an HRESULT-shaped value, and this host's real
  // value for "NIKATRU daily backup" is 4294770688 (0xFFFD0000).
  //
  //     [int]4294770688  ->  THROWS "Value was either too large or too small
  //                          for an Int32."
  //
  // The throw landed in the probe's OWN catch, the catch wrote `found=$false`,
  // and the guard printed `no scheduled task named "NIKATRU daily backup"
  // exists on this host` — while Get-ScheduledTask showed it Ready at TaskPath
  // `\` with LastRunTime 2026-08-26 10:00:00 and NextRunTime the same evening.
  //
  // 🔴 THE INVERSION, which is what these cases exist to pin: a task that
  // SUCCEEDS carries a small result (0) that casts fine and reports healthy; a
  // task that FAILS carries a large HRESULT that overflowed and was reported as
  // NOT EXISTING. The probe was reliable ONLY while nothing was wrong. It
  // converted its most important possible finding — "your scheduled duty is
  // running and failing" — into a quieter and WRONG one, "you never set it up",
  // which sends a reader off to create a task that already exists.
  //
  // These drive the PURE seam (`readScheduledTaskProbe` / `classifyScheduledTaskRow`)
  // with fixture rows, exactly as the block above drives `evaluateRunRecords`
  // with `probesOf`. NOTHING here touches this host's real Task Scheduler:
  // `probeWindowsTasks` short-circuits on `process.platform !== 'win32'` and CI
  // runs on Linux, so a suite that depended on a real task would be vacuous
  // there and non-deterministic here.
  // ═══════════════════════════════════════════════════════════════════════════

  const NAME = 'NIKATRU daily backup';
  // The exact JSON the fixed PowerShell emitter produces, per state.
  const spawnOf = (rows) => ({ platform: 'win32', error: null, status: 0, stdout: JSON.stringify(rows) });
  const probeOne = (row, names = [NAME]) => readScheduledTaskProbe(names, spawnOf([row])).get(names[0]);

  test('🔴 THE REGRESSION THAT MATTERS — a LastTaskResult too large for Int32 is "EXISTS AND IS FAILING", NEVER "missing". RED before the [int]->[long] fix: [int]4294770688 threw, the throw hit the probe\'s own catch, and 0xFFFD0000 was reported as an absent task.', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    assert.equal(p.missing, undefined, 'a FAILING task reported as MISSING is the whole defect — it sends a reader to create a task that already exists');
    assert.equal(p.unreadable, undefined, 'the query answered; this is not "I could not tell"');
    assert.ok(Number.isNaN(p.lastSuccessMs), 'a non-zero result is no successful run');
    assert.match(p.detail, /EXISTS AND IS FAILING/);
    assert.match(p.detail, /THIS IS NOT A MISSING TASK/);
    assert.match(p.detail, /RAN at 2026-08-26T04:30:00\.0000000Z/, 'the run time proves the schedule fired — "dead" and "firing and failing" are different facts');
  });

  test('🔴 the decimal ALONE is unactionable — the failing verdict prints the HRESULT shape 0xFFFD0000 beside it, and claims nothing about what the code means', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    assert.match(p.detail, /4294770688 \(0xFFFD0000\)/);
    assert.equal(formatTaskResult(4294770688), '4294770688 (0xFFFD0000)');
    assert.equal(formatTaskResult(0), '0 (0x00000000)');
    assert.equal(formatTaskResult(267011), '267011 (0x00041303)');
    // A signed Int32 carrying the same bit pattern decodes to the SAME hex, which
    // is the point of [long]: both shapes survive and print identically.
    assert.equal(formatTaskResult(-131072), '-131072 (0xFFFE0000)');
  });

  test('🔴 THE OTHER END OF THE RANGE, which `[uint32]` would have reintroduced: a NEGATIVE Int32 result is also "exists and failing", not missing and not unreadable', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: -131072, why: null });
    assert.equal(p.missing, undefined);
    assert.match(p.detail, /EXISTS AND IS FAILING/);
    assert.match(p.detail, /-131072 \(0xFFFE0000\)/);
  });

  test('STATE 1 — the task does not exist: an ANSWERED ObjectNotFound is `missing`, the hard failure a stale register row deserves', () => {
    const p = probeOne({ task: NAME, state: 'absent', lastRun: null, result: null, why: 'CimException: The system cannot find the file specified.' });
    assert.equal(p.missing, true);
    assert.equal(p.unreadable, undefined);
    assert.match(p.why, /no scheduled task named "NIKATRU daily backup" exists on this host/);
    assert.match(p.why, /answered ObjectNotFound, it did not merely fail to be read/);
  });

  test('STATE 2 — the task exists and its last result is 0: the ONLY healthy outcome, and it carries a real lastSuccessMs', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 0, why: null });
    assert.equal(p.missing, undefined);
    assert.equal(p.unreadable, undefined);
    assert.equal(p.lastSuccessMs, Date.parse('2026-08-26T04:30:00Z'));
    assert.match(p.detail, /SUCCEEDED \(LastTaskResult = 0 \(0x00000000\)\)/);
  });

  test('STATE 3 — the task exists and has NEVER RUN: 267011 = SCHED_S_TASK_HAS_NOT_RUN is not a failure and not an absence, and it is named as itself', () => {
    const byCode = probeOne({ task: NAME, state: 'read', lastRun: '1899-12-30T00:00:00Z', result: 267011, why: null });
    assert.equal(byCode.missing, undefined);
    assert.equal(byCode.unreadable, undefined);
    assert.ok(Number.isNaN(byCode.lastSuccessMs));
    assert.match(byCode.detail, /HAS NEVER RUN/);
    // 267011 with a plausible LastRunTime must still read as never-run: the code
    // is the authority, not the timestamp.
    const codeWins = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 267011, why: null });
    assert.match(codeWins.detail, /HAS NEVER RUN — LastTaskResult = 267011 \(0x00041303\) = SCHED_S_TASK_HAS_NOT_RUN/);
    // And a missing LastRunTime is never-run even with no code at all.
    const noTime = probeOne({ task: NAME, state: 'read', lastRun: null, result: null, why: null });
    assert.match(noTime.detail, /HAS NEVER RUN — it reports no usable LastRunTime/);
    assert.equal(noTime.unreadable, undefined, 'a null LastTaskResult with a null LastRunTime is "never ran", not "unreadable"');
  });

  test('🔴 STATE 0 — a catch that is NOT "no such task" is `unreadable` WITH the message, never `missing`. This is the collapse that let an overflow impersonate an absent task.', () => {
    const p = probeOne({ task: NAME, state: 'threw', lastRun: null, result: null, why: 'InvalidCastException: Value was either too large or too small for an Int32.' });
    assert.equal(p.missing, undefined, '"something else threw" must NEVER be reported as "the task does not exist"');
    assert.equal(p.unreadable, true);
    assert.match(p.why, /was NOT "no such task"/);
    assert.match(p.why, /Value was either too large or too small for an Int32/, 'the message must survive, or the next reader cannot tell what broke');
    assert.match(p.why, /neither "it is fine" nor "it is absent"/);
  });

  test('a row with NO recognisable state at all is `unreadable` — the row-classifier has no default that means "fine" and none that means "absent"', () => {
    for (const bad of [undefined, null, '', 'found', true]) {
      const p = classifyScheduledTaskRow({ task: NAME, state: bad, lastRun: null, result: null, why: null });
      assert.equal(p.unreadable, true, 'state=' + JSON.stringify(bad ?? null) + ' must be unreadable');
      assert.equal(p.missing, undefined);
      assert.equal(p.lastSuccessMs, undefined);
      assert.match(p.why, /no usable state for "NIKATRU daily backup"/);
    }
  });

  test('powershell unavailable is `unreadable` for every name — a probe that could not run is not a probe that found nothing', () => {
    const byError = readScheduledTaskProbe([NAME, 'Other'], { platform: 'win32', error: new Error('spawnSync powershell ENOENT'), status: null, stdout: '' });
    for (const n of [NAME, 'Other']) {
      assert.equal(byError.get(n).unreadable, true);
      assert.equal(byError.get(n).missing, undefined);
      assert.match(byError.get(n).why, /powershell could not be run here \(spawnSync powershell ENOENT\)/);
    }
    const byStatus = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 1, stdout: '' });
    assert.match(byStatus.get(NAME).why, /powershell could not be run here \(exit 1\)/);
  });

  test('a NON-WINDOWS runner is `unreadable`, which is why this suite never asks the host for a real task — CI runs on Linux and would otherwise assert nothing', () => {
    const p = readScheduledTaskProbe([NAME], { platform: 'linux' });
    assert.equal(p.get(NAME).unreadable, true);
    assert.equal(p.get(NAME).missing, undefined);
    assert.match(p.get(NAME).why, /this runner is linux, and Task Scheduler exists only on the Windows host/);
  });

  test('output that is not the expected JSON is `unreadable`, in BOTH its shapes — unparseable, and parseable-but-not-an-array', () => {
    const junk = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 0, stdout: 'Get-ScheduledTaskInfo : boom' });
    assert.equal(junk.get(NAME).unreadable, true);
    assert.match(junk.get(NAME).why, /output was not JSON/);
    const notArray = readScheduledTaskProbe([NAME], { platform: 'win32', error: null, status: 0, stdout: '{"task":"x"}' });
    assert.equal(notArray.get(NAME).unreadable, true);
    assert.match(notArray.get(NAME).why, /parsed as JSON but was not the array of task rows/);
  });

  test('🔴 SILENCE ABOUT A NAME IS `unreadable`, NOT `missing` — a dropped row must not impersonate an absent task any more than an overflow may', () => {
    const p = readScheduledTaskProbe([NAME, 'Never mentioned'], spawnOf([{ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: 0, why: null }]));
    assert.equal(p.get(NAME).lastSuccessMs, Date.parse('2026-08-26T04:30:00Z'));
    assert.equal(p.get('Never mentioned').unreadable, true);
    assert.equal(p.get('Never mentioned').missing, undefined);
    assert.match(p.get('Never mentioned').why, /returned no row for "Never mentioned" at all/);
  });

  test('🔴 A RESULT THAT ARRIVES AS A STRING IS `unreadable`, NOT a failure — `=== 0` against "0" is silently false and would report a HEALTHY task as failing', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: '0', why: null });
    assert.equal(p.unreadable, true);
    assert.equal(p.missing, undefined);
    assert.ok(!('lastSuccessMs' in p), 'no verdict may be produced from a value that cannot be compared');
    assert.match(p.why, /arrived as a string \("0"\) rather than a number/);
  });

  test('a task that RAN but returned no LastTaskResult at all is `unreadable` — "it ran" without "how it ended" is not a success', () => {
    const p = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00Z', result: null, why: null });
    assert.equal(p.unreadable, true);
    assert.equal(p.missing, undefined);
    assert.match(p.why, /no LastTaskResult came back at all/);
  });

  test('🔴 END TO END THROUGH `evaluateRunRecords`: the overflowing result reaches the guard as a RED "no successful run", and the printed line says EXISTS AND IS FAILING rather than DOES NOT EXIST', () => {
    const NOWW = Date.parse('2026-08-26T12:00:00Z');
    const readers = {
      _maxUnreachable: 1,
      _maxUnreadable: 1,
      _windowMultiplier: 1.5,
      'windows-scheduled-task': { queries: 'Get-ScheduledTaskInfo', needs: 'win32' },
      unreachable: { queries: 'nothing', needs: 'n/a' },
    };
    const row = (id, recordQuery) => ({
      id,
      kind: 'duty',
      what: 'a scheduled duty',
      detector: 'x',
      response: 'y',
      cadence: '1d',
      mechanism: { substrate: 'windows-task-scheduler', anchor: 'renovate.json', record: 'r', failingValue: 'f', readBy: 'b', recordQuery },
    });
    const reg = {
      _recordReaders: readers,
      rows: [
        row('duty.laptop.nikatru-daily-backup', { reader: 'windows-scheduled-task', task: NAME }),
        row('duty.box', { reader: 'unreachable', why: 'on a host nothing here can reach' }),
      ],
    };
    const probe = probeOne({ task: NAME, state: 'read', lastRun: '2026-08-26T04:30:00.0000000Z', result: 4294770688, why: null });
    const r = evaluateRunRecords(reg, new Map([['duty.laptop.nikatru-daily-backup', probe]]), NOWW);
    const joined = r.errors.join(' | ');
    assert.match(joined, /duty\.laptop\.nikatru-daily-backup — its record IS reachable and holds NO SUCCESSFUL RUN AT ALL/);
    assert.match(joined, /EXISTS AND IS FAILING/);
    assert.match(joined, /4294770688 \(0xFFFD0000\)/);
    assert.doesNotMatch(joined, /DOES NOT EXIST/, 'THE INVERSION: the old code path put this exact row here, as an absent task');
  });
});

describe('assert-ops-register — [14]O-11 / [14]O-17 · a tolerance that cannot fail is not a tolerance', () => {
  // Both requirements shipped BUILT with an empty domain: twelve `expiring` rows
  // and zero executed lead-window comparisons; nineteen `retention` rows and
  // zero declared periods. The decision was to KEEP both tolerances — the dates
  // and the periods are genuinely not this repository's to know — and to make
  // each cost something that can go red.
  const withExpiry = (extra) => {
    const r = baseRegister();
    r.rows.push({
      id: 'expiring.thing',
      kind: 'expiring',
      what: 'a thing that expires',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      expiryKnownAt: 'a vendor console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'x', anchor: 'Private/runbooks/operations.md', record: 'r', failingValue: 'f', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
      ...extra,
    });
    return r;
  };

  test('a null expiry with no `expiryKnownAt` FAILS — the tolerance must name its source', () => {
    assert.match(messages(withExpiry({ expiryKnownAt: undefined })), /must carry `expiryKnownAt`/);
  });

  test('one more null expiry than the ceiling FAILS — the ratchet only goes down', () => {
    const r = withExpiry({});
    r.rows.push({ ...r.rows[r.rows.length - 1], id: 'expiring.second' });
    assert.match(messages(r), /2 `expiring` row\(s\) carry `expires: null` and the ceiling is 1/);
  });

  test('the executed-comparison count PRINTS, and reads 0 while every date is null', () => {
    const p = run(withExpiry({})).prints.join(' | ');
    assert.match(p, /\[14\]O-11 — 1 expiring row\(s\) · 0 lead-window comparison\(s\) ACTUALLY EXECUTED · 1 expiry UNREAD/);
    assert.match(p, /THE LEAD-WINDOW ARITHMETIC RAN ZERO TIMES ON THIS RUN/);
  });

  test('once a real date lands the count moves — the print is measuring, not decorating', () => {
    const far = new Date(NOW + 300 * 86_400_000).toISOString().slice(0, 10);
    const p = run(withExpiry({ expires: far, ownerGated: false, ownerGap: undefined })).prints.join(' | ');
    assert.match(p, /1 lead-window comparison\(s\) ACTUALLY EXECUTED · 0 expiry UNREAD/);
    assert.doesNotMatch(p, /RAN ZERO TIMES/);
  });

  test('a declared `period` with no `deletingJob` FAILS — O-17 is "deleted on schedule, BY A JOB"', () => {
    const r = baseRegister();
    r.rows.push({
      id: 'retention.events',
      kind: 'retention',
      store: 'd1:platform_db:events',
      what: 'analytics events',
      rule: 'period',
      periodDays: 365,
      detector: 'the coverage guard',
      response: 'the sweep',
      cadence: '365d',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'Private/runbooks/operations.md', record: 'the table', failingValue: 'a row older than the period', readBy: 'the coverage guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    assert.match(messages(r), /`rule: period` with no `deletingJob`/);
  });

  test('one more undeclared period than the ceiling FAILS, and the count prints while it is 0 declared', () => {
    const r = baseRegister();
    const row = (id) => ({
      id,
      kind: 'retention',
      store: `kv:${id}`,
      what: 'a store',
      rule: 'period-undeclared',
      detector: 'the coverage guard',
      response: 'stage 8 owns the number',
      cadence: '365d',
      ownerGated: true,
      ownerGap: 'the period is a policy decision',
      mechanism: { substrate: 'cloudflare-kv', anchor: 'Private/runbooks/operations.md', record: 'the store', failingValue: 'a key older than the period', readBy: 'the coverage guard' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    r.rows.push(row('retention.one'));
    assert.match(run(r).prints.join(' | '), /\[14\]O-17 — 1 retention row\(s\) · 0 declare a PERIOD/);
    r.rows.push(row('retention.two'));
    assert.match(messages(r), /2 retention row\(s\) carry `rule: period-undeclared` and the ceiling is 1/);
  });
});

describe('assert-ops-register — a named READER must exist, not merely be named', () => {
  // The register's first draft named `tooling/ci/assert-update-coverage.mjs` as
  // the reader for the dependency duty. That file has never existed — so the row
  // asserted a live reader for a duty nothing reads, which is the "zero readers"
  // defect reproduced inside the file written to end it. `.anchor` was checked;
  // `.readBy` — the field carrying the claim that matters — was not.
  const withPath = (field, value) => {
    const r = baseRegister();
    if (field.startsWith('mechanism.')) r.rows[0].mechanism[field.slice(10)] = value;
    else r.rows[0][field] = value;
    return r;
  };

  test('a `mechanism.readBy` naming a guard that does not exist FAILS', () => {
    assert.match(messages(withPath('mechanism.readBy', 'tooling/ci/assert-imaginary.mjs')), /which is not in the tree/);
  });

  test('a `detector` naming a guard that does not exist FAILS', () => {
    assert.match(messages(withPath('detector', 'checked by tooling/ci/assert-nope.mjs on every push')), /which is not in the tree/);
  });

  test('a `mechanism.record` naming a workflow that does not exist FAILS', () => {
    assert.match(messages(withPath('mechanism.record', 'the run history of .github/workflows/gone.yml')), /which is not in the tree/);
  });

  test('a reader that DOES exist passes', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'renovate.json')).errors, []);
  });

  test('prose with no path in it is left alone — this is not a spell-checker', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'a human reading the Dependency Dashboard issue')).errors, []);
  });

  test('a Private/ path is NOT treated as a missing file, because CI cannot see Private/', () => {
    assert.deepEqual(run(withPath('mechanism.readBy', 'Private/runbooks/operations.md §0')).errors, []);
  });
});

describe('assert-ops-register — end to end, against the real repository', () => {
  // 🔴 THIS TEST USED TO ASSERT `status === 0` AND THAT IS NO LONGER A CLAIM IT
  // MAY MAKE. From 2026-08-06 the [14]O-3 limb QUERIES each mechanism's own run
  // record, and on the Windows host two of the three Task Scheduler duties are
  // genuinely returning LastTaskResult = 1 — so a red run there is the guard
  // working, not the register being malformed. On a Linux runner that reader is
  // DARK, which on a row last seen FAILING is red too — the second shape below.
  //
  // Asserting 0 would therefore be asserting "no duty is currently failing",
  // which is a fact about the owner's laptop rather than about this file, and
  // the fix everybody reaches for when it goes red is to delete the query.
  // Asserting nothing would be worse. So the claim is the one that IS this
  // file's: THE REGISTER IS STRUCTURALLY SOUND — every problem, if any, must be
  // a record-query verdict about a failing duty, never a schema, coverage or
  // delegation error. A structural break still reddens this test on every OS.
  // ⏱ 2026-09-11 — THIS SPAWN SPENT THE CI QUOTA IT WAS NOT HERE TO MEASURE.
  // It used to inherit the guard-meta job's environment, GITHUB_TOKEN included,
  // and it ran once per test below: three live runs of the guard per CI run, 56
  // GitHub requests each — 168, COUNTED under a pass-through fetch counter on
  // origin/main 90414b02, against a token allowed 1,000 an hour for the whole
  // repository. None of these tests is about the live world: they assert that
  // the COMMITTED register is structurally sound and that each limb runs and
  // prints its counts. So the guard now runs ONCE, against the committed tree,
  // with every read answered by the replay stub from the 2026-09-11 freeze
  // fixture (the same answers the INV1..INV6 suite below replays), from a
  // scrubbed environment in the local host, where every read is made and every
  // limb runs. The replay counts what the guard asked; the O-3 test requires
  // that count, so a guard that stopped querying and a spawn that went back to
  // the live API are both RED.
  /** ⏱ 2026-09-12 — the ratchet on this guard's share of the hourly API quota.
   *  Measured live: 56 before, 20 after. See the test at the foot of this block.
   *  2026-09-23: 26 → 28, the documented "tenth workflow costs 2" raise.
   *  duty.workflow.redeploy-stranded.yml is dispatchable, so it is RED-SINCE
   *  graded like the two deploy lanes it re-enters; its run history is one new
   *  page plus one cross-check. The replay measured 27 after the row.
   *  2026-09-24: 28 → 30, the same documented raise for the tenth scheduled
   *  workflow, duty.workflow.name-clearance.yml. The replay measured 29 after
   *  the row (its history is answered by replayWorld's derived run). */
  const OPS_GITHUB_REQUEST_CEILING = 30;
  const REPLAY_FIXTURE = join(CI_DIR, 'test', 'fixtures', 'ops-freeze-2026-09-11.json');
  let realRun = null;
  const realGuard = () => {
    if (realRun) return realRun;
    const countFile = join(TMP, `real-guard-count-${seq++}.json`);
    const env = scrubbedEnv({
      OPS_REPLAY_FILE: replayWorldFile(REPLAY_FIXTURE),
      // ⏱ 2026-09-20 — the committed register, with any record dated after the
      // freeze normalised to the freeze's own day (the drill-date replay
      // fixture). On a register whose dates are all at or before the freeze this
      // is byte-for-byte the committed file, so what this test grades is
      // unchanged; it is what stops a LATER correct record reading as a break.
      OPS_REPLAY_REGISTER_FILE: replayRegisterFile(REPLAY_FIXTURE),
      OPS_REPLAY_COUNT_FILE: countFile,
      GITHUB_TOKEN: 'replay',
      GLITCHTIP_TOKEN: 'replay',
      CLOUDFLARE_API_TOKEN: 'replay',
      CLOUDFLARE_ACCOUNT_ID: 'replay',
      GITHUB_REPOSITORY: 'globalonlinedeveloper/Nikatru_Platform_Public',
    });
    const r = spawnSync(process.execPath, ['--import', replayStubUrl(), GUARD], { cwd: resolve(CI_DIR, '..', '..'), encoding: 'utf8', env });
    const counts = existsSync(countFile) ? JSON.parse(readFileSync(countFile, 'utf8')) : null;
    realRun = { code: r.status, out: `${r.stdout}\n${r.stderr}`, counts };
    return realRun;
  };

  /** The record-query verdicts that ARE "a duty is failing": a reachable record
   *  with no success (or none inside the window), a mechanism that is gone, and
   *  a dark reader on a row held FAILING. */
  // 🔴 `RED SINCE` JOINED THIS SET ON 2026-09-07, WITH THE LIMB THAT EMITS IT.
  // It is a fourth shape of "a duty is failing" and it is the one the register
  // was blind to: the watched workflow's newest run on its own branch FAILED and
  // no success has landed since. Without it here, the very first red `main`
  // would have made this test call the new limb doing exactly its job a
  // "structural break" — and the reflex fix for that is to delete the limb.
  // ⏱ 2026-09-11 — the fifth shape joined with INV6: a watched workflow with
  // FAILED runs and no success at all is a live verdict at exit 2 now, not a
  // separate COVERAGE LOST return, so it can appear among the problems.
  const DUTY_IS_FAILING = /its record IS reachable and (holds NO SUCCESSFUL RUN AT ALL|the newest SUCCESSFUL run)|the mechanism its `recordQuery` names DOES NOT EXIST|reader `[^`]+` .+ AND the register holds its last readable observation as FAILING \(|— RED SINCE \d{4}-\d{2}-\d{2}T|has FAILED runs \(newest is run \d+ at [^)]+\) and NO successful run at all/;

  // ── 🔴 THE FIFTH SHAPE, AND WHY IT IS DELIBERATELY NOT IN THE SET ABOVE ────
  // `classifyRunRecord` emits one more failing shape — HELD-BUT-HEALTHY — the
  // first time a host READS A SUCCESS while `recordQuery.lastObserved` still
  // says `fail`. MEASURED 2026-08-27 by driving the guard's own classifier with
  // the committed duty.laptop.nikatru-daily-backup row and a healthy probe:
  // verdict `fail`, no `gated` flag (so it BLOCKS), and its line matched NONE of
  // the four shapes above. So on the day 0xFFFD0000 is repaired, this test would
  // have gone red on the laptop calling a guard doing exactly its job a
  // "structural break".
  //
  // THE JUDGEMENT, so the next reader need not re-derive it: held-but-healthy is
  // NOT a duty that is failing — the record was queried and holds a fresh
  // success — so widening DUTY_IS_FAILING to swallow it would make this
  // describe's own sentence false. It is A REGISTER TO REPAIR: one stale field,
  // in the very file this test is about. The VERDICT (red) was already right;
  // only the MESSAGE was wrong, and the message is what decides whether the next
  // reader deletes one field or deletes the check.
  const HELD_BUT_HEALTHY = /its record was QUERIED and is healthy .+ still reads FAILING \(/;

  test('the committed register is STRUCTURALLY sound — any failure is a duty that is failing, not a malformed register', () => {
    const { code, out } = realGuard();
    if (code === 0) return;
    const problems = out
      .split('\n')
      .filter((l) => /^ {4}\S/.test(l))
      .map((l) => l.trim());
    // ⏱ 2026-09-11 — exit 2 with no itemised problem is a MEASUREMENT state
    // (INV6): this runner could not read enough of the world — no GLITCHTIP_TOKEN
    // or no GITHUB_TOKEN on a laptop. That is neither a structural break nor a duty
    // failing, and the guard must say which it is.
    if (code === 2 && problems.length === 0) {
      assert.match(out, /✗ COVERAGE LOST — \d+ measurement failure\(s\)/, `exit 2 with neither a problem nor a measurement failure:\n${out}`);
      return;
    }
    assert.ok(problems.length > 0, `exit ${code} with no itemised problems:\n${out}`);
    // The structural claim is checked over EVERY line FIRST.
    const stale = problems.filter((p) => HELD_BUT_HEALTHY.test(p));
    for (const p of problems) {
      if (stale.includes(p)) continue;
      // ⏱ 2026-09-11 — a newest failure that died ONLY on the installation quota is
      // COVERAGE LOST about one row: a measurement, not a malformed register.
      if (/failed ONLY on `API rate limit exceeded for installation`/.test(p)) continue;
      assert.match(
        p,
        DUTY_IS_FAILING,
        `a NON-record problem in the committed register — this is a structural break and must be fixed, not tolerated:\n${p}`,
      );
    }
    assert.equal(
      stale.length,
      0,
      'A HELD FAILURE HAS OUTLIVED THE FAILURE IT RECORDS, AND THE GUARD IS WORKING. This duty\'s record was ' +
        'queried and holds a fresh success; what is stale is one field of tooling/ops/register.json. THE REPAIR ' +
        'IS A DELETION, on a host that can read this record: remove ' +
        '`mechanism.recordQuery.lastObserved` from the row named below. Do NOT delete the `recordQuery`, and do ' +
        `NOT widen the accepted-shape pattern:\n${stale.join('\n')}`,
    );
  });

  test('🔴 held-but-healthy is CLASSIFIED, not forgotten — the two patterns partition it, and neither may quietly swallow it', () => {
    // The state fires no earlier than the day the backup is repaired, so the
    // subject is BUILT, not found: a committed scheduled row with a FAILING
    // observation attached, and the probe that host returns once 0xFFFD0000 is
    // gone. Built, so the deletion the test above orders cannot empty this test.
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const readable = real.rows.filter(
      (r) =>
        r.kind === 'duty' &&
        /^\d+[hd]$/.test(String(r.cadence ?? '')) &&
        typeof r?.mechanism?.recordQuery?.reader === 'string' &&
        r.mechanism.recordQuery.reader !== 'unreachable',
    );
    assert.ok(readable.length > 0, 'no committed duty row carries a readable record query, so nothing here could be classified');
    const built = JSON.parse(JSON.stringify(readable[0]));
    built.mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-06T02:00:01Z', detail: 'LastTaskResult 4294770688.' };
    const held = real.rows.filter((r) => r?.mechanism?.recordQuery?.lastObserved?.verdict === 'fail');
    const NOWH = Date.parse('2026-08-27T04:00:00Z');
    for (const row of [built, ...held]) {
      const c = classifyRunRecord(
        row,
        { lastSuccessMs: NOWH - 2 * 3_600_000, detail: 'LastTaskResult 0.' },
        NOWH,
        real._recordReaders._windowMultiplier,
      );
      assert.equal(c.verdict, 'fail', `${row.id}: a live healthy read must still fail while the held failure stands`);
      assert.match(c.line, HELD_BUT_HEALTHY, `${row.id}: the repair branch must own this line, or the message reverts to "structural break"`);
      assert.doesNotMatch(c.line, DUTY_IS_FAILING, `${row.id}: held-but-healthy is not a duty that is failing, and accepting it here would make this describe's own claim false`);
    }
  });

  test('🔴 A MALFORMED REGISTER IS STILL REJECTED — seven real mutations of the committed file, none reaching either accepting branch', () => {
    // The half that matters about the branch above: it must not have become an
    // escape hatch. Every line below is the GUARD'S OWN, harvested by mutating
    // the committed register and running the real limb over it — not prose a
    // fixture author wrote to match a pattern they also wrote.
    const NOWM = Date.parse('2026-08-27T04:00:00Z');
    const real = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const byId = (reg, id) => {
      const row = reg.rows.find((x) => x.id === id);
      assert.ok(row, `${id} is gone from the register, so this mutation would range over nothing`);
      return row;
    };
    const healthyProbes = (reg) => {
      const m = new Map();
      for (const r of reg.rows) if (r.kind === 'duty' && /^\d+[hd]$/.test(String(r.cadence ?? ''))) m.set(r.id, { lastSuccessMs: NOWM - 2 * 3_600_000, detail: 'stubbed healthy' });
      return m;
    };
    const cases = [
      ['a scheduled duty loses its query', (r) => { delete byId(r, 'duty.workflow.e2e.yml').mechanism.recordQuery; }, /no `mechanism\.recordQuery\.reader`/],
      ['a reader nothing declares', (r) => { byId(r, 'duty.workflow.e2e.yml').mechanism.recordQuery.reader = 'invented-reader'; }, /is not declared in `_recordReaders`/],
      ['a held observation stated as an adjective', (r) => { byId(r, 'duty.laptop.nikatru-daily-backup').mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-27T03:34:00Z', detail: 'it was failing' }; }, /`recordQuery\.lastObserved` must be/],
      ['a held observation on a row nothing has ever read', (r) => { byId(r, 'duty.oci.disk-alert').mechanism.recordQuery.lastObserved = { verdict: 'fail', at: '2026-08-27T03:34:00Z', detail: 'LastTaskResult 4294770688.' }; }, /on a row whose reader is `unreachable`/],
      ['`unreachable` with no `why`', (r) => { delete byId(r, 'duty.oci.disk-alert').mechanism.recordQuery.why; }, /`reader: "unreachable"` with no `why`/],
      ['a declared reader no row uses', (r) => { r._recordReaders['file-stamp'] = { queries: 'an mtime', needs: 'the file' }; }, /is declared and no row uses it/],
      ['the unreachable ceiling breached', (r) => { r._recordReaders._maxUnreachable = 0; }, /and the ceiling is 0/],
    ];
    for (const [name, mutate, expected] of cases) {
      const reg = real();
      mutate(reg);
      const errs = evaluateRunRecords(reg, healthyProbes(reg), NOWM).errors ?? [];
      const hit = errs.find((e) => expected.test(e));
      assert.ok(hit, `${name}: the guard did not emit its own ${expected} — the mutation landed on nothing:\n${errs.join('\n')}`);
      assert.doesNotMatch(hit, HELD_BUT_HEALTHY, `${name}: the held-but-healthy repair branch must not swallow a structural problem:\n${hit}`);
      assert.doesNotMatch(hit, DUTY_IS_FAILING, `${name}: a structural problem must not read as a failing duty:\n${hit}`);
    }
  });

  test('the [14]O-3 record limb actually ran, and says how many records it queried', () => {
    // Without this the previous test is satisfiable by a guard that stopped
    // querying entirely — the defect the whole limb replaces, one level up.
    const { out, counts } = realGuard();
    assert.match(out, /\[14\]O-3 — scheduled=\d+ · queried_ok=\d+ · failing=\d+/);
    // ⏱ 2026-09-11 — AND IT QUERIED THROUGH THE REPLAY, NEVER THE LIVE API. The
    // replay stub writes what the guard asked, by provider, when it exits; no
    // count file means the stub was not loaded and every read went to the network
    // on the guard-meta job's token (168 requests per CI run, counted). A count
    // of zero GitHub reads means the record limb stopped asking.
    assert.ok(counts, `the end-to-end run left no replay count, so its reads were not answered by the replay:\n${out}`);
    assert.ok(counts.github > 0, `the end-to-end run made no GitHub read through the replay (${JSON.stringify(counts)}), so the record limb did not query:\n${out}`);
    assert.equal(counts.other, 0, `the end-to-end run asked a host the replay does not serve (${JSON.stringify(counts)}):\n${out}`);
    // 🔴 THE LABELS ARE PART OF THE ASSERTION. The previous shape of this line put
    // `22 record(s) QUERIED` and `(ceiling 12)` in one sentence with the unreadable
    // count between them, and on 2026-09-09 two reading passes filed "22 unreadable
    // duties against a ceiling of 12" off a run that had QUERIED 22 and failed to read
    // 0. A count whose label can be misattached is a false alarm waiting to be filed,
    // so every number here is bound to its own name.
    assert.match(out, /unreadable=\d+\/ceiling \d+ · unreachable=\d+\/ceiling \d+/);
  });

  // ── ⏱ 2026-09-12 · THE QUOTA THIS GUARD SPENDS IS A NUMBER, SO IT IS RATCHETED ──
  //
  // 🔴 MEASURED under a counting `fetch` preload against the LIVE API, on
  // origin/main db68b1f4 and again on this branch: 56 GitHub requests became 20.
  // 44 of the 56 were run-list reads — 22 questions, each asked at per_page=1 and
  // per_page=30, about exactly NINE workflows on ONE branch. They are now ONE
  // page per workflow (per_page=100) plus ONE cross-check (per_page=1): 18, plus
  // one job list and one issue search. Every verdict was identical across the two
  // runs, run id for run id; only the elapsed-hours drifted between them.
  //
  // The ceiling is what stops the next question from buying its own pair of reads
  // again. It is above the replay's measured count on purpose — a register row
  // added tomorrow may legitimately reach a TENTH workflow, which costs 2 — and
  // far below the 56 it replaces, so the shape that caused 2026-09-11's
  // `API rate limit exceeded for installation` cannot come back unnoticed.
  test('[14]O-3 · the whole guard spends a BOUNDED number of GitHub requests', () => {
    const { out, counts } = realGuard();
    assert.ok(counts, `no replay count file, so nothing was measured:\n${out}`);
    assert.ok(
      counts.github <= OPS_GITHUB_REQUEST_CEILING,
      `this run made ${counts.github} GitHub requests, over the ceiling of ${OPS_GITHUB_REQUEST_CEILING}. ` +
        'Before 2026-09-12 every run-history QUESTION bought its own pair of reads and one run cost 56, ' +
        'about 1,600 of a morning\'s 2,225 on a token allowed 1,000 an hour — which is how every lane died on ' +
        '`API rate limit exceeded for installation` on 2026-09-11. If a new row genuinely needs a tenth ' +
        'workflow, raise the ceiling by 2 and say so here; if a read went back to asking per question, do not.',
    );
  });

  test('the [14]O-11 and [14]O-17 execution counts print on every run', () => {
    const { out } = realGuard();
    assert.match(out, /\[14\]O-11 — \d+ expiring row\(s\) · \d+ lead-window comparison\(s\) ACTUALLY EXECUTED/);
    assert.match(out, /\[14\]O-17 — \d+ retention row\(s\) · \d+ declare a PERIOD/);
  });

  test('a repository with no operations register is COVERAGE LOST, not a quiet pass', () => {
    const root = join(TMP, `e${seq++}`);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: CI\n');
    const r = spawnSync(process.execPath, [GUARD, root], { encoding: 'utf8' });
    assert.equal(r.status, 2, 'COVERAGE LOST is exit 2 — never 1, which is a finding (INV6)');
    assert.match(`${r.stdout}\n${r.stderr}`, /COVERAGE LOST/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE DIGEST THAT READ THIS GUARD AND REPORTED THE OPPOSITE OF WHAT IT SAID.
//
// ops-watch.yml's `digest` job collects three readers into one weekly issue. Two
// of them were written correctly; the third — this guard — was one piped line:
//
//     node tooling/ci/assert-ops-register.mjs 2>&1 | grep -E '^(⬜|⚠)' || echo '(none printed)'
//
// It was wrong twice, in the same direction:
//   · A PIPELINE'S STATUS IS ITS LAST STAGE'S. The digest recorded grep's exit,
//     never the guard's — the exact `$?`-after-a-pipe trap CLAUDE.md records
//     costing three guard checks on 2026-08-05.
//   · THE FILTER DROPPED EVERY FAILURE LINE. This guard writes problems as
//     `✗ …` with indented detail; neither shape starts with ⬜ or ⚠. So a
//     register in COVERAGE LOST rendered in the weekly digest as one line:
//     "(none printed)" — the most reassuring possible presentation of a red check.
//
// MEASURED before the repair, with a stub reader that prints a `✗` line and
// exits 1: the old form printed `exit: 0` and no failure line; the new form
// printed the failure lines and `exit: 1`.
//
// The cases below are STRUCTURAL, against the real workflow, and that is a
// deliberate limit: the defect is a shell property, and executing the fragment
// would make this suite depend on `bash` being on PATH — which it is on the CI
// runner and is not reliably on the owner's Windows host, so the test would fail
// for the wrong reason on half the machines that run it. What they encode is
// exactly the two halves above, each of which reddens if the piped form returns.
// ─────────────────────────────────────────────────────────────────────────────
describe('the weekly digest must report this guard\'s verdict, not grep\'s', () => {
  const OPS_WATCH = resolve(CI_DIR, '..', '..', '.github', 'workflows', 'ops-watch.yml');
  const yaml = () => readFileSync(OPS_WATCH, 'utf8');
  /** The digest's collector step, comments removed, so prose about the old form
   *  can never satisfy an assertion about the new one. */
  const collector = () => {
    const text = yaml();
    const at = text.indexOf('- name: Collect what the readers say');
    assert.ok(at > 0, 'the digest collector step must exist — this whole block is about it');
    const end = text.indexOf('- name: Deliver it to one durable issue', at);
    assert.ok(end > at, 'the collector must be followed by the delivery step');
    return text
      .slice(at, end)
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
  };

  test('the register reader is not piped — a pipeline reports its LAST stage, never the guard', () => {
    const body = collector();
    assert.match(body, /assert-ops-register\.mjs/, 'the digest must still read this guard');
    for (const line of body.split('\n')) {
      if (!line.includes('assert-ops-register.mjs')) continue;
      assert.doesNotMatch(line, /\|/, `the reader is piped, so the digest records the pipe's status:\n${line}`);
    }
  });

  test('the status is captured on its OWN line and echoed', () => {
    const lines = collector().split('\n').map((l) => l.trim());
    const at = lines.findIndex((l) => l.includes('assert-ops-register.mjs'));
    assert.ok(at !== -1);
    assert.match(lines[at], /^out="\$\(node tooling\/ci\/assert-ops-register\.mjs 2>&1\)"$/);
    assert.equal(lines[at + 1], 'code=$?', '`$?` must be read before ANY other command runs, or it is that command\'s status');
    assert.ok(
      lines.slice(at).some((l) => /^echo "exit: \$code"$/.test(l)),
      'the digest must print the guard\'s exit, or a red register is indistinguishable from a quiet week',
    );
  });

  test('a NON-ZERO exit prints the guard\'s output unfiltered — the ⬜/⚠ filter drops every `✗` line', () => {
    const body = collector();
    // The filter may still run, but only on the branch where there is nothing to
    // hide. On the failure branch the whole output has to survive.
    assert.match(body, /if \[ "\$code" -eq 0 \]; then/);
    const elseAt = body.indexOf('else');
    assert.ok(elseAt > 0, 'there must be a failure branch at all');
    const failureBranch = body.slice(elseAt, body.indexOf('fi', elseAt));
    assert.match(failureBranch, /printf '%s\\n' "\$out"/);
    assert.doesNotMatch(failureBranch, /grep/, 'filtering the failure branch is the defect, one level down');
  });

  test('the two sibling readers still report their own exits — the shape this one was repaired to match', () => {
    const body = collector();
    assert.match(body, /node tooling\/ops\/status\.mjs 2>&1\n\s*echo "exit: \$\?"/);
    assert.match(body, /node tooling\/ops\/check-heartbeats\.mjs 2>&1\n\s*echo "exit: \$\?"/);
  });
});

describe('assert-ops-register — HOSTNAMES ARE DELEGATED, and the delegation can fail', () => {
  // This register deliberately holds no hostname rows: [11]E-9's
  // monitor-register.json owns that set, with a wider derivation. "Delegated" is
  // only a different thing from "unowned" if the pointer is verified — so these
  // exercise the pointer being absent, dangling, empty, and blind.
  const fixtureRoot = (mutate = () => {}) => {
    const root = join(TMP, `d${seq++}`);
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling/ops'), { recursive: true });
    mkdirSync(join(root, 'services/svc'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'name: CI\n');
    writeFileSync(join(root, 'services/svc/wrangler.jsonc'), JSON.stringify({ name: 'svc' }));
    // The `cloudflare-cron` confinement limb reads this file to confirm the
    // coupling it guards still exists, so a fixture root without it is an
    // INCOMPLETE model of the subject and reports COVERAGE LOST — which is the
    // limb working, not a fixture bug. Copy the REAL reader rather than writing
    // a stub containing the literal: a stub would encode the assumption the
    // limb exists to check, and would keep passing after the real file changed.
    writeFileSync(
      join(root, 'tooling/ops/check-heartbeats.mjs'),
      readFileSync(resolve(CI_DIR, '..', 'ops', 'check-heartbeats.mjs'), 'utf8'),
    );

    const reg = baseRegister();
    reg._delegated = { hostnames: 'tooling/monitor-register.json' };
    reg.rows[1].mechanism.anchor = 'renovate.json';
    reg.rows[2].mechanism.anchor = 'renovate.json';
    reg.rows[1].mechanism.readBy = 'the backup script';
    reg.rows[2].mechanism.readBy = 'this guard';
    writeFileSync(join(root, 'renovate.json'), '{}');

    // ── what main() now demands and evaluate() does not ──────────────────────
    // These four additions all exist because of the 2026-08-06 [14]O-3/O-11/O-17
    // repair, and each models the SHAPE the real register has rather than the
    // minimum that makes the guard quiet:
    //  · the one scheduled duty declares a reader (an unreachable one, with a why)
    //  · a second scheduled duty uses the OTHER declared reader, because a reader
    //    no row uses is an error — and because a register whose every duty is
    //    `unreachable` is COVERAGE LOST, which is the anti-vacuity rule itself
    //  · one `expiring` row and one `retention` row, because a register holding
    //    none of either makes [14]O-11 and [14]O-17 range over the empty set
    sched(reg).mechanism.recordQuery = { reader: 'unreachable', why: 'the fixture laptop is not reachable from a test runner' };
    reg.rows.push({
      id: 'duty.workflow.nightly',
      kind: 'duty',
      what: 'a nightly scheduled workflow',
      detector: 'its own alert job',
      response: 'read the issue it files',
      cadence: '1d',
      mechanism: {
        substrate: 'github-actions',
        anchor: 'renovate.json',
        record: 'GitHub Actions run history, filtered to event = schedule',
        failingValue: 'conclusion = failure on event = schedule',
        readBy: 'this guard, by querying the run history',
        recordQuery: { reader: 'github-run-history', workflow: 'ci.yml', unit: 'run', event: 'schedule', headBranch: 'main' },
      },
      // [14]O-10 wants an IN-TREE freshness reader or a written gap. This
      // fixture root has no guards in it, so the gap is the honest answer — and
      // it exercises the print-don't-fail path rather than routing round it.
      freshnessGap: 'the fixture root contains no in-tree guards; [14]O-10 is exercised against the real repository elsewhere.',
      absenceWatcher: {
        substrate: '(none)',
        what: 'NOTHING — a push-triggered reader cannot catch the provider dying, because it is on that provider.',
        ownerGated: true,
        gap: 'needs a watcher off GitHub; recorded so the count carries it.',
      },
      accessProviders: ['github'],
      source: 'verified',
    });
    reg.rows.push({
      id: 'expiring.fixture-domain',
      kind: 'expiring',
      what: 'a domain registration',
      detector: 'this row',
      response: 'renew it',
      cadence: '180d',
      leadDays: 30,
      expires: null,
      expiryKnownAt: 'the registrar console',
      ownerGated: true,
      ownerGap: 'console-only',
      mechanism: { substrate: 'cloudflare-registrar', anchor: 'renovate.json', record: 'the console', failingValue: 'auto-renew off', readBy: 'nothing yet' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });
    reg.rows.push({
      id: 'retention.fixture-table',
      kind: 'retention',
      store: 'd1:fixture_db:heartbeat',
      what: 'an append-only heartbeat table',
      rule: 'keep',
      keepWhy: 'append-only by design; the additive-only schema rule forbids dropping it',
      detector: 'assert-retention-coverage.mjs',
      response: 'n/a',
      cadence: '365d',
      mechanism: { substrate: 'cloudflare-d1', anchor: 'renovate.json', record: 'the table itself', failingValue: 'a row older than the period, once one exists', readBy: 'assert-retention-coverage.mjs' },
      accessProviders: ['cloudflare'],
      source: 'verified',
    });

    const state = { reg, monitor: { hosts: [{ hostname: 'example.test' }] } };
    mutate(state, root);
    writeFileSync(join(root, 'tooling/ops/register.json'), JSON.stringify(state.reg));
    if (state.monitor !== null) writeFileSync(join(root, 'tooling/monitor-register.json'), JSON.stringify(state.monitor));
    return root;
  };
  // 🔴 THE CREDENTIALS ARE SCRUBBED ON PURPOSE. [14]O-3's readers really do
  // leave the machine, so a developer who happens to have GITHUB_TOKEN exported
  // would run a DIFFERENT test from CI — and the one that passes locally and
  // fails in CI (or the reverse) is the test everybody learns to ignore. With
  // them absent the reader is deterministically `unreadable`, which is a print,
  // so these tests measure the delegation limb and nothing else.
  // ⏱ 2026-09-11 — AND THEN REPLAYED, because INV6 made the scrubbed state RED:
  // a runner that can read NONE of the GitHub reads is COVERAGE LOST, exit 2
  // (REVIEW-guards-2026-09-10 #2). So the fixture root's one watched workflow is
  // answered by `replayStub` with one green scheduled run an hour old, which is
  // just as deterministic across machines and no longer a false green.
  const runRoot = (root) => {
    const state = join(TMP, `root-replay-${seq++}.json`);
    const now = new Date().toISOString();
    writeFileSync(
      state,
      JSON.stringify({ now, runs: { 'ci.yml': [[101, 'schedule', 'success', new Date(Date.parse(now) - 3_600_000).toISOString()]] }, jobs: {}, glitchtip: {}, d1: { jobs: {}, targets: {} }, issues: {} }),
    );
    const env = scrubbedEnv({ OPS_REPLAY_FILE: state, GITHUB_TOKEN: 'replay', GITHUB_REPOSITORY: 'o/r' });
    const r = spawnSync(process.execPath, ['--import', replayStubUrl(), GUARD, root], { encoding: 'utf8', env });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };

  test('the fixture root is green first, or nothing below means anything', () => {
    const r = runRoot(fixtureRoot());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /delegated to tooling\/monitor-register\.json \(1 hosts\)/);
  });

  // ── ⏱ 2026-09-24 · [14]O-11 · THE GUARD PRINTS WHAT IT GRADED (O-APPLE-SIGNING-EXPIRY-UNWATCHED) ──
  // Until this date a green run said only "N expiring row(s) · M comparison(s)":
  // no row and no date, so "read the guard output listing the rows with their
  // dates" could not be done off any log. These three spawn the REAL guard on the
  // fixture root, so the line is proven to leave main() on green AND on red.
  // O1 was run FIRST against the unmodified guard and was RED (R0).
  test('O1 · [14]O-11 prints one DATED line per graded expiry — the row, its date, the days left and its lead', () => {
    const at = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    const r = runRoot(fixtureRoot((s) => {
      const row = s.reg.rows.find((x) => x.id === 'expiring.fixture-domain');
      assert.ok(row, 'the fixture lost the row this case dates');
      Object.assign(row, { expires: at, ownerGated: false });
      delete row.ownerGap;
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, new RegExp(`\\[14\\]O-11 · expiring\\.fixture-domain · expires ${at} · (199|200) day\\(s\\) left · lead 30`));
  });

  test('🔴 O2 · the closes\' red control on a fixture ROOT — an expiry 10 days out with a 30-day lead is exit 1, and its dated line still prints', () => {
    const at = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const r = runRoot(fixtureRoot((s) => {
      const row = s.reg.rows.find((x) => x.id === 'expiring.fixture-domain');
      assert.ok(row, 'the fixture lost the row this case dates');
      Object.assign(row, { expires: at, leadDays: 30, ownerGated: false });
      delete row.ownerGap;
    }));
    assert.equal(r.code, 1, `a date inside its own lead window is a FINDING, exit 1:\n${r.out}`);
    assert.match(r.out, new RegExp(`expiring\\.fixture-domain — \`expires: ${at}\` is (9|10) day\\(s\\) away, inside its own 30-day lead window\\. Renew it\\.`));
    assert.match(r.out, new RegExp(`\\[14\\]O-11 · expiring\\.fixture-domain · expires ${at} · (9|10) day\\(s\\) left · lead 30`), 'the red run must still list the date it graded');
  });

  test('🔴 O3 · a NEW `expiring` row arriving with `expires: null` trips the `_maxNull` ratchet through the real guard', () => {
    // Why a machine-written row may only ever arrive WITH its date: the ceiling
    // ratchets down, so one undated row more than it is exit 1, not a quiet gap.
    const r = runRoot(fixtureRoot((s) => {
      const row = s.reg.rows.find((x) => x.id === 'expiring.fixture-domain');
      assert.ok(row, 'the fixture lost the row this case copies');
      s.reg.rows.push({ ...row, id: 'expiring.cert.fixture-undated' });
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /2 `expiring` row\(s\) carry `expires: null` and the ceiling is 1/);
  });

  // ── [14]O-3b · THE EXIT CODE, PROVEN BY SPAWNING THE GUARD ────────────────
  // The pure suite above proves the verdicts. These two prove the WIRING: that
  // a green fixture really returns 0 with the limb having run, and that the
  // empty-domain refusal really reaches `process.exit(2)`. A limb whose verdict
  // is right and whose exit code never leaves main() is a limb nothing enforces.
  // No network is involved in either: the fixture root's one watched workflow
  // goes `unreadable` with the credentials scrubbed, and the empty-domain case
  // refuses before a socket is opened.
  test('[14]O-3b ran on the green fixture root, and printed its domain size beside its verdict', () => {
    const r = runRoot(fixtureRoot());
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[14\]O-3b — RED SINCE: 1 workflow duty\(ies\) graded \(1 on a clock · 0 `trigger` row\(s\)/);
    assert.match(r.out, /· 1 whose newest run on their own branch is GREEN · 0 RED/, 'the replayed history is read and ordered, so the limb must say it ordered a pair');
    assert.doesNotMatch(r.out, /ORDERED ZERO PAIRS ON THIS RUN/);
    // ⏱ 2026-09-09 — THE WIRING OF THE DERIVATION, not just of the verdict. The
    // fixture root's `duty.workflow.ci.yml` is a `trigger` row and its
    // `.github/workflows/ci.yml` declares no `workflow_dispatch`, so main() must
    // have READ that file to say so. This is what proves `dispatchableWorkflows`
    // is actually called from main() rather than only from the pure suite.
    assert.match(r.out, /NOT GRADED · duty\.workflow\.ci\.yml — `\.github\/workflows\/ci\.yml` declares NO `workflow_dispatch`/);
    assert.match(r.out, /green only by MERGING/, 'the exclusion must carry its reason at the line, never leave it to be inferred');
  });

  test('🔴 [14]O-3b with an EMPTY domain exits **2** — COVERAGE LOST, which is neither a pass nor a finding', () => {
    // The register keeps its `github-run-history` row (so [14]O-3 stays happy and
    // the declared reader still has a member) and the row simply stops being a
    // `duty.workflow.*` one — the smallest edit that empties the redness domain
    // without breaking anything else, which is exactly why it must not be quiet.
    const root = fixtureRoot((s) => {
      const row = s.reg.rows.find((x) => x.id === 'duty.workflow.nightly');
      assert.ok(row, 'the fixture lost the row this mutation ranges over');
      row.id = 'duty.nightly';
    });
    const r = runRoot(root);
    assert.equal(r.code, 2, `COVERAGE LOST must not share an exit code with a pass or a finding:\n${r.out}`);
    assert.match(r.out, /COVERAGE LOST/);
    assert.match(r.out, /ranges over the EMPTY SET/);
  });

  test('no `_delegated.hostnames` at all is COVERAGE LOST — the surfaces would be owned by nobody', () => {
    const r = runRoot(fixtureRoot((s) => { delete s.reg._delegated; }));
    assert.equal(r.code, 2, 'COVERAGE LOST is exit 2 (INV6)');
    assert.match(r.out, /`_delegated.hostnames` is missing/);
  });

  test('a delegate that does not exist is COVERAGE LOST, not a silent pass-through', () => {
    const r = runRoot(fixtureRoot((s) => { s.monitor = null; }));
    assert.equal(r.code, 2, 'COVERAGE LOST is exit 2 (INV6)');
    assert.match(r.out, /which does not exist/);
  });

  test('a delegate with an EMPTY host set is COVERAGE LOST — an empty delegate is worse than none', () => {
    const r = runRoot(fixtureRoot((s) => { s.monitor = { hosts: [] }; }));
    assert.equal(r.code, 2, 'COVERAGE LOST is exit 2 (INV6)');
    assert.match(r.out, /could not be read as a host register/);
  });

  test('a delegate blind to a custom domain this repo deploys FAILS — a pointer at a smaller set', () => {
    const r = runRoot(fixtureRoot((s, root) => {
      writeFileSync(
        join(root, 'services/svc/wrangler.jsonc'),
        JSON.stringify({ name: 'svc', routes: [{ pattern: 'api.example.test', custom_domain: true }] }),
      );
    }));
    assert.equal(r.code, 1);
    assert.match(r.out, /is not among the 1 host\(s\)/);
  });

  // ── [14]O-7 · the deploy-job domain, DERIVED in main() — through the real guard ──
  // The O-7 cases in the pure suite inject `deployJobs` into `evaluate` directly,
  // and the real-tree run asserts no count, so the derivation from the workflow
  // tree was graded by nothing. These plant a deploy workflow the guard has never
  // seen into the green fixture root and require main() to have FOUND it.
  const DEPLOY_WF = (recordArg, { smoke }) => [
    'name: Deploy fixture',
    'on:',
    '  workflow_dispatch:',
    'jobs:',
    '  ship:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: echo upload',
    ...(smoke ? ['      - run: node tooling/ops/post-deploy-smoke.mjs https://example.test'] : []),
    `      - run: node tooling/ops/record-deployment.mjs ${recordArg}`,
    '',
  ].join('\n');
  /** Plants the workflow AND the duty row every workflow must carry, so the only
   *  thing a case below can be red about is the O-7 verdict it names. */
  const plantDeploy = (s, root, text) => {
    writeFileSync(join(root, '.github/workflows/zz-deploy.yml'), text);
    s.reg.rows.push({
      id: 'duty.workflow.zz-deploy.yml',
      kind: 'duty',
      what: 'a fixture deploy lane',
      detector: 'a red run',
      response: 'redeploy',
      cadence: 'on-demand',
      why: 'dispatched by hand in the fixture; it has no clock to miss',
      mechanism: { substrate: 'github-actions', anchor: '.github/workflows/zz-deploy.yml', record: 'run history', failingValue: 'conclusion = failure', readBy: 'branch protection' },
      accessProviders: ['github'],
      source: 'verified',
    });
  };

  test('[14]O-7 CONTROL — a planted deploy job that probes what it ships is DERIVED, counted, and green', () => {
    const r = runRoot(fixtureRoot((s, root) => {
      plantDeploy(s, root, DEPLOY_WF('zz-planted-env', { smoke: true }));
    }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /\[14\]O-7 — 1 deploy job\(s\) derived from record-deployment calls; 1 probe the surface they ship/);
  });

  test('🔴 [14]O-7 — a planted deploy job that records and never probes is FOUND by main() and named', () => {
    const r = runRoot(fixtureRoot((s, root) => {
      plantDeploy(s, root, DEPLOY_WF('zz-planted-env', { smoke: false }));
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /zz-deploy\.yml:ship records a deployment for `zz-planted-env` and never probes it/);
    assert.match(r.out, /✗ tooling\/ops\/register\.json — 1 problem\(s\):/, 'the O-7 finding must be the ONLY problem, or this case could be red for another reason');
  });

  test('🔴 [14]O-7 — a MATRIX-LEG environment is expanded over catalog/apps.json, and each leg is named', () => {
    const r = runRoot(fixtureRoot((s, root) => {
      mkdirSync(join(root, 'catalog'), { recursive: true });
      writeFileSync(join(root, 'catalog/apps.json'), JSON.stringify([{ slug: 'zz-app-one' }, { slug: 'zz-app-two' }]));
      plantDeploy(s, root, DEPLOY_WF('${{ matrix.app }}-web', { smoke: false }));
    }));
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /records a deployment for `zz-app-one-web` and never probes it/);
    assert.match(r.out, /records a deployment for `zz-app-two-web` and never probes it/);
    assert.match(r.out, /✗ tooling\/ops\/register\.json — 2 problem\(s\):/, 'one finding per expanded leg, and nothing else');
  });

  // ── ⏱ 2026-09-11 · THE LIVE READS ARE NOT MADE WHERE THEIR VERDICT CANNOT BLOCK ──
  // Measured the same day: 56 GitHub requests per run of this guard, in every CI
  // run, on a token allowed 1,000 an hour. On a pull_request host every live
  // verdict prints and none blocks (INV1), so the reads are skipped there — unless
  // the proposal changes a file they are built from, or git cannot say what it
  // changes. These build, in a REAL git repository, the commit actions/checkout
  // gives a pull_request run — a two-parent `Merge <head> into <base>` with
  // origin/main fetched — and COUNT every request the guard makes.
  const git = (cwd, ...args) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', ...args],
      { cwd, encoding: 'utf8' },
    );
    assert.equal(r.status, 0, `git ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
    return r.stdout.trim();
  };
  /** A ci.yml that makes the fixture a GUARD HOST declaring both events, so the
   *  policy is ADVISORY on pull_request and ENFORCING on push by derivation. The
   *  fixture duty is judged by job `nightly`, which does not run this guard: a
   *  whole-run unit on a guard host is refused by [INV4] ("No host requires
   *  itself"), which is the guard working, not the fixture failing. */
  const HOST_CI = [
    'name: CI',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    'jobs:',
    '  nightly:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - run: echo the duty itself',
    '  guards:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - name: Every failure has a detector, a response and a cadence',
    '        run: node tooling/ci/assert-ops-register.mjs',
    '',
  ].join('\n');
  const hostRoot = () =>
    fixtureRoot((s, root) => {
      const row = s.reg.rows.find((x) => x.id === 'duty.workflow.nightly');
      assert.ok(row, 'the fixture lost the duty the host tests are judged by');
      row.mechanism.recordQuery.unit = { jobs: ['nightly'] };
      writeFileSync(join(root, '.github/workflows/ci.yml'), HOST_CI);
    });
  /** Commits `root` as main, makes `change` on a branch, checks out the merge. Returns HEAD. */
  const asPullRequest = (root, change) => {
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    const base = git(root, 'rev-parse', 'HEAD');
    git(root, 'update-ref', 'refs/remotes/origin/main', base);
    git(root, 'checkout', '-q', '-b', 'proposal');
    change(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'proposal');
    const head = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '--detach', base);
    git(root, 'merge', '-q', '--no-ff', '-m', `Merge ${head} into ${base}`, head);
    return git(root, 'rev-parse', 'HEAD');
  };
  const ON_PR = (sha) => ({
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '7', GITHUB_WORKFLOW: 'CI', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/7/merge',
    GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/ci.yml@refs/pull/7/merge', GITHUB_BASE_REF: 'main', GITHUB_SHA: sha,
  });
  const ON_PUSH = (sha) => ({
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '8', GITHUB_WORKFLOW: 'CI', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/ci.yml@refs/heads/main', GITHUB_BASE_REF: '', GITHUB_SHA: sha,
  });
  const TOUCH_README = (root) => writeFileSync(join(root, 'README.md'), 'a proposal that touches nothing the live reads are built from\n');
  const TOUCH_REGISTER = (root) => {
    const p = join(root, 'tooling/ops/register.json');
    writeFileSync(p, `${JSON.stringify(JSON.parse(readFileSync(p, 'utf8')), null, 2)}\n`);
  };
  const TOUCH_WORKFLOW = (root) => writeFileSync(join(root, '.github/workflows/ci.yml'), `${HOST_CI}# touched by the proposal\n`);
  /** `runRoot` as a named host, with every request counted. `ageHours` is how old the one green run is. */
  const runCounted = (root, host, extra = {}, ageHours = 1) => {
    const state = join(TMP, `root-replay-${seq++}.json`);
    const countFile = join(TMP, `root-count-${seq++}.json`);
    const now = new Date().toISOString();
    writeFileSync(
      state,
      JSON.stringify({
        now,
        runs: { 'ci.yml': [[101, 'schedule', 'success', new Date(Date.parse(now) - ageHours * 3_600_000).toISOString()]] },
        jobs: { 101: [['nightly', 'success', []], ['guards', 'success', []]] },
        glitchtip: {},
        d1: { jobs: {}, targets: {} },
        issues: {},
      }),
    );
    const env = scrubbedEnv({ OPS_REPLAY_FILE: state, OPS_REPLAY_COUNT_FILE: countFile, GITHUB_TOKEN: 'replay', GITHUB_REPOSITORY: 'o/r', ...host, ...extra });
    const r = spawnSync(process.execPath, ['--import', replayStubUrl(), GUARD, root], { encoding: 'utf8', env });
    const out = `${r.stdout}\n${r.stderr}`;
    const counts = JSON.parse(readFileSync(countFile, 'utf8'));
    const lines = out.split('\n');
    const at = lines.findIndex((l) => /^✗ tooling\/ops\/register\.json — \d+ problem\(s\):$/.test(l));
    const problems = at === -1 ? [] : lines.slice(at + 1).filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim());
    return { code: r.status, out, counts, problems };
  };
  const NONE = { github: 0, glitchtip: 0, cloudflare: 0, other: 0 };

  // ⏱ 2026-09-11 · A NEWEST FAILURE THAT DIED ONLY ON THE INSTALLATION QUOTA.
  // CodeQL runs 34570837477 and 34577720776 on main failed in one step whose
  // only failure annotation was `API rate limit exceeded for installation`, and
  // [14]O-3b called duty.workflow.codeql.yml RED SINCE. These drive the real
  // guard, in the local (enforcing) host, over a history whose newest run on main
  // FAILED an hour after a success, and differ ONLY in what the failed job's
  // check run recorded — so the verdict can come from nowhere but that read.
  const runRedPair = (root, annotations) => {
    const state = join(TMP, `root-replay-${seq++}.json`);
    const now = new Date().toISOString();
    const ago = (h) => new Date(Date.parse(now) - h * 3_600_000).toISOString();
    writeFileSync(
      state,
      JSON.stringify({
        now,
        runs: { 'ci.yml': [[101, 'schedule', 'success', ago(3)], [102, 'push', 'failure', ago(1)]] },
        jobs: { 101: [['nightly', 'success', [], 9101], ['guards', 'success', [], 9102]], 102: [['nightly', 'failure', [], 9201], ['guards', 'success', [], 9202]] },
        annotations,
        glitchtip: {},
        d1: { jobs: {}, targets: {} },
        issues: {},
      }),
    );
    const env = scrubbedEnv({ OPS_REPLAY_FILE: state, GITHUB_TOKEN: 'replay', GITHUB_REPOSITORY: 'o/r' });
    const r = spawnSync(process.execPath, ['--import', replayStubUrl(), GUARD, root], { encoding: 'utf8', env });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const QUOTA_REFUSAL = 'API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 2838:D9887:2019C45:67AA8DC:6AA3A2EE and timestamp 2026-09-11 06:42:54 UTC.';

  test('CONTROL — a newest failure that failed on its own work is RED SINCE, exit 1, through the real guard', () => {
    const r = runRedPair(hostRoot(), { 9201: [['failure', 'Process completed with exit code 1.']] });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /duty\.workflow\.nightly — RED SINCE /);
    assert.doesNotMatch(r.out, /failed ONLY on `API rate limit exceeded for installation`/);
  });

  test('🔴 a newest failure that died ONLY on the installation quota is COVERAGE LOST, exit 2 — never RED SINCE', () => {
    const r = runRedPair(hostRoot(), { 9201: [['warning', 'Node.js 20 is deprecated.'], ['failure', QUOTA_REFUSAL], ['warning', QUOTA_REFUSAL]] });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /duty\.workflow\.nightly — ci\.yml on main.* run 102 \([^)]+\) FAILED, and job "nightly" failed ONLY on `API rate limit exceeded for installation`/);
    assert.match(r.out, /COVERAGE LOST for this row/);
    assert.doesNotMatch(r.out, /duty\.workflow\.nightly — RED SINCE /);
  });

  test('CONTROL — the fixture pull request is a real guard host: ADVISORY on pull_request, ENFORCING on push, green on both', () => {
    const root = hostRoot();
    const sha = asPullRequest(root, TOUCH_REGISTER);
    const pr = runCounted(root, ON_PR(sha));
    assert.equal(pr.code, 0, pr.out);
    assert.match(pr.out, /HOST POLICY — ADVISORY: ci\.yml on `pull_request`/);
    const push = runCounted(root, ON_PUSH(sha));
    assert.equal(push.code, 0, push.out);
    assert.match(push.out, /HOST POLICY — ENFORCING: ci\.yml on `push`/);
  });

  test('pull_request, a change that touches none of the live reads\' inputs — ZERO requests, one plain line, exit 0, and the structural limbs still ran', () => {
    const root = hostRoot();
    const r = runCounted(root, ON_PR(asPullRequest(root, TOUCH_README)));
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.counts, NONE, r.out);
    const line = r.out.split('\n').filter((l) => l.startsWith('⬜  [LIVE] NOT READ ON THIS HOST — '));
    assert.equal(line.length, 1, `exactly one plain line says the reads were not made:\n${r.out}`);
    assert.match(line[0], /no GitHub, GlitchTip or Cloudflare request was made\. On a pull request a live verdict cannot block \(INV1\)/);
    assert.match(line[0], /The push run on main makes every one of them and enforces its verdict \(INV2\)\.$/);
    assert.match(r.out, /⬜ {2}register: \d+ rows/);
    assert.match(r.out, /\[14\]O-3b — (TRIGGER ROWS|NOT GRADED)/, 'the redness census is a fact about the tree and still prints');
    assert.doesNotMatch(r.out, /\[14\]O-3 — scheduled=|\[14\]O-3b — RED SINCE: \d+/, 'no tally may be printed over reads that were not made');
  });

  test('…so a GitHub that refuses every request cannot redden that proposal: nothing asks it', () => {
    const root = hostRoot();
    const r = runCounted(root, ON_PR(asPullRequest(root, TOUCH_README)), { OPS_REPLAY_GITHUB_STATUS: '403' });
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(r.counts, NONE, r.out);
    assert.doesNotMatch(r.out, /COVERAGE LOST/);
  });

  test('pull_request that changes tooling/ops/register.json — the reads ARE made, and a GitHub that refuses them is still COVERAGE LOST (INV6)', () => {
    const root = hostRoot();
    const sha = asPullRequest(root, TOUCH_REGISTER);
    const r = runCounted(root, ON_PR(sha));
    assert.equal(r.code, 0, r.out);
    assert.ok(r.counts.github > 0, `no GitHub request was made for a register change:\n${r.out}`);
    assert.match(r.out, /\[LIVE\] reads made on this host: this change touches 1 file\(s\) the live reads are built from \(tooling\/ops\/register\.json\)/);
    assert.match(r.out, /\[14\]O-3 — scheduled=\d+ · queried_ok=1/);
    const dark = runCounted(root, ON_PR(sha), { OPS_REPLAY_GITHUB_STATUS: '403' });
    assert.equal(dark.code, 2, dark.out);
  });

  test('pull_request that changes a workflow file — the reads ARE made', () => {
    const root = hostRoot();
    const r = runCounted(root, ON_PR(asPullRequest(root, TOUCH_WORKFLOW)));
    assert.equal(r.code, 0, r.out);
    assert.ok(r.counts.github > 0, r.out);
    assert.match(r.out, /this change touches 1 file\(s\) the live reads are built from \(\.github\/workflows\/ci\.yml\)/);
  });

  test('pull_request whose changed files git cannot establish — HEAD is an ordinary one-parent commit, not the merge — the reads are made, as before', () => {
    const root = hostRoot();
    git(root, 'init', '-q');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'base');
    git(root, 'update-ref', 'refs/remotes/origin/main', git(root, 'rev-parse', 'HEAD'));
    TOUCH_README(root);
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'a commit on top of main, checked out directly');
    const sha = git(root, 'rev-parse', 'HEAD');
    const r = runCounted(root, ON_PR(sha));
    assert.equal(r.code, 0, r.out);
    assert.ok(r.counts.github > 0, r.out);
    assert.match(r.out, /\[LIVE\] reads made on this host: which files this change touches could not be established \(HEAD has 1 parent\(s\)/);
  });

  test('pull_request with no GITHUB_BASE_REF — unknown, so the reads are made', () => {
    const root = hostRoot();
    const r = runCounted(root, { ...ON_PR(asPullRequest(root, TOUCH_README)), GITHUB_BASE_REF: '' });
    assert.ok(r.counts.github > 0, r.out);
    assert.match(r.out, /could not be established \(GITHUB_BASE_REF is not set/);
  });

  test('push — the same merge commit reads exactly what a tree with no git at all reads, and a stale duty still BLOCKS there while the proposal is not blocked', () => {
    const root = hostRoot();
    const sha = asPullRequest(root, TOUCH_README);
    const withGit = runCounted(root, ON_PUSH(sha));
    const noGit = runCounted(hostRoot(), ON_PUSH(sha));
    assert.equal(withGit.code, 0, withGit.out);
    assert.ok(withGit.counts.github > 0, withGit.out);
    assert.deepEqual(withGit.counts, noGit.counts, 'the push host must not read less because a merge commit is checked out');
    assert.doesNotMatch(withGit.out, /\[LIVE\] (NOT READ|reads made)/, 'an enforcing host prints nothing new');
    // A duty whose newest success is 50 hours old on a 1d cadence (window 36h).
    // Each run replays its own `now`, so only the replayed instant is masked.
    const instant = (ps) => ps.map((p) => p.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<replayed instant>'));
    const stalePush = runCounted(root, ON_PUSH(sha), {}, 50);
    const staleNoGit = runCounted(hostRoot(), ON_PUSH(sha), {}, 50);
    assert.equal(stalePush.code, 1, stalePush.out);
    assert.ok(stalePush.problems.some((p) => p.startsWith('duty.workflow.nightly —')), stalePush.problems.join('\n'));
    assert.deepEqual(instant(stalePush.problems), instant(staleNoGit.problems), 'the push verdict is the verdict a run with no git gives');
    const stalePr = runCounted(root, ON_PR(sha), {}, 50);
    assert.equal(stalePr.code, 0, stalePr.out);
    assert.deepEqual(stalePr.counts, NONE, stalePr.out);
  });
});

describe('⏱ 2026-09-11 · which runs make the live reads — the pure half', () => {
  const REPO_ROOT = resolve(CI_DIR, '..', '..');
  const readReal = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');
  const realReg = () => JSON.parse(readReal('tooling/ops/register.json'));
  const ADVISORY = (event = 'pull_request') => ({ host: 'ci.yml', event, mode: 'advisory', why: 'test' });
  const ENFORCING = { host: 'ci.yml', event: 'push', mode: 'enforcing', why: 'test' };
  const inputsOfReal = () => liveReadInputs(realReg(), localImportClosure(GUARD_SCRIPT_REL, readReal));
  const known = (files) => ({ known: true, base: 'main', head: 'h', first: 'f', files });
  const namedWranglers = (reg) =>
    [...new Set(reg.rows.flatMap((r) => [r?.mechanism?.recordQuery?.wrangler, r?.mechanism?.recordQuery?.timer?.wrangler]).filter(Boolean))];

  test('the inputs are DERIVED from the real tree: register, guard, every module it imports, the gate script, every workflow, every wrangler a query names', () => {
    const inputs = inputsOfReal();
    assert.ok(inputs, 'the real guard\'s import closure could not be derived — every pull request would read, silently');
    for (const f of ['tooling/ops/register.json', GUARD_SCRIPT_REL, GATE_SCRIPT_REL]) assert.ok(inputs.files.has(f), `${f} is not a live-read input`);
    // Read independently of the closure's own pattern: each relative import the guard declares.
    const declared = [...readReal(GUARD_SCRIPT_REL).matchAll(/^import [^;]*? from '\.\/([^']+)';$/gms)].map((m) => `tooling/ci/${m[1]}`);
    assert.ok(declared.length >= 3, `found only ${declared.length} relative imports in the guard`);
    for (const f of declared) assert.ok(inputs.files.has(f), `${f} is imported by the guard and is not a live-read input`);
    const wranglers = namedWranglers(realReg());
    assert.ok(wranglers.length >= 1, 'no record query names a wrangler config, so this limb of the derivation ranges over nothing');
    for (const w of wranglers) assert.ok(inputs.files.has(w), `${w} is named by a record query and is not a live-read input`);
    assert.deepEqual(inputs.prefixes, ['.github/workflows/']);
  });

  test('localImportClosure follows relative imports transitively, survives a cycle, and is null — never smaller — when a module cannot be read', () => {
    const src = {
      'a/x.mjs': "import { y } from './y.mjs';\nimport z from '../b/z.mjs';\n",
      'a/y.mjs': "export * from './x.mjs';\nimport fs from 'node:fs';\n",
      'b/z.mjs': "const w = await import('./w.mjs');\n",
      'b/w.mjs': '',
    };
    const read = (rel) => {
      if (!(rel in src)) throw new Error(`ENOENT ${rel}`);
      return src[rel];
    };
    assert.deepEqual([...localImportClosure('a/x.mjs', read)].sort(), ['a/x.mjs', 'a/y.mjs', 'b/w.mjs', 'b/z.mjs']);
    const lost = localImportClosure('a/x.mjs', (rel) => {
      if (rel === 'b/w.mjs') throw new Error('ENOENT');
      return read(rel);
    });
    assert.equal(lost, null);
    assert.equal(liveReadInputs(realReg(), null), null);
  });

  test('proposalChangedFiles believes git only when every link holds — base named, HEAD is GITHUB_SHA, two parents, first parent on origin/<base>', () => {
    const M = 'a'.repeat(40);
    const F = 'b'.repeat(40);
    const H = 'c'.repeat(40);
    const gitOf = ({ parents = `${M} ${F} ${H}\n`, revList = 0, ancestor = 0, diff = { status: 0, stdout: 'README.md\0tooling/ops/register.json\0' } } = {}) => {
      const calls = [];
      const fn = (args) => {
        calls.push(args);
        if (args[0] === 'rev-list') return { status: revList, stdout: parents };
        if (args[0] === 'merge-base') return { status: ancestor, stdout: '' };
        if (args[0] === 'diff') return diff;
        return { status: 99, stdout: '' };
      };
      fn.calls = calls;
      return fn;
    };
    const ENV = { GITHUB_BASE_REF: 'main', GITHUB_SHA: M };
    const g = gitOf();
    const ok = proposalChangedFiles(ENV, g);
    assert.equal(ok.known, true, ok.why);
    assert.deepEqual(ok.files, ['README.md', 'tooling/ops/register.json']);
    assert.deepEqual(g.calls[1], ['merge-base', '--is-ancestor', F, 'refs/remotes/origin/main']);
    assert.deepEqual(g.calls[2], ['diff', '--name-only', '--no-renames', '-z', F, M]);
    for (const [env, git, why] of [
      [{ ...ENV, GITHUB_BASE_REF: '' }, gitOf(), /GITHUB_BASE_REF is not set/],
      [{ ...ENV, GITHUB_BASE_REF: '--output=x' }, gitOf(), /is not a branch name this guard will hand to git/],
      [{ ...ENV, GITHUB_BASE_REF: 'main..evil' }, gitOf(), /is not a branch name/],
      [{ ...ENV, GITHUB_SHA: H }, gitOf(), /is not GITHUB_SHA/],
      [{ ...ENV, GITHUB_SHA: '' }, gitOf(), /is not GITHUB_SHA \(unset\)/],
      [ENV, gitOf({ revList: 128 }), /rev-list --parents -n 1 HEAD` exited 128/],
      [ENV, gitOf({ parents: `${M} ${F}\n` }), /HEAD has 1 parent\(s\)/],
      [ENV, gitOf({ parents: `${M} ${F} ${H} ${'d'.repeat(40)}\n` }), /HEAD has 3 parent\(s\)/],
      [ENV, gitOf({ ancestor: 1 }), /is not shown to be on origin\/main \(`git merge-base --is-ancestor` exited 1\)/],
      [ENV, gitOf({ ancestor: 128 }), /exited 128/],
      [ENV, gitOf({ diff: { status: null, stdout: '' } }), /exited without a status/],
    ]) {
      const r = proposalChangedFiles(env, git);
      assert.equal(r.known, false, `believed: ${JSON.stringify(env)}`);
      assert.match(r.why, why);
    }
  });

  test('liveReadPlan — an enforcing host always reads and prints nothing new; an advisory one skips ONLY on a known change that touches no input', () => {
    const inputs = inputsOfReal();
    const reads = (plan) => assert.equal(plan.read, true, plan.line);
    assert.deepEqual(liveReadPlan(ENFORCING, known(['README.md']), inputs), { read: true, line: null, touched: [] });
    assert.deepEqual(liveReadPlan(ENFORCING, null, null), { read: true, line: null, touched: [] });
    for (const ev of ['pull_request_target', 'merge_group']) {
      const p = liveReadPlan(ADVISORY(ev), known(['README.md']), inputs);
      reads(p);
      assert.match(p.line, /is not `pull_request`/);
    }
    reads(liveReadPlan(ADVISORY(), { known: false, why: 'no base' }, inputs));
    reads(liveReadPlan(ADVISORY(), null, inputs));
    reads(liveReadPlan(ADVISORY(), known(['README.md']), null));
    const wrangler = namedWranglers(realReg())[0];
    for (const f of ['tooling/ops/register.json', '.github/workflows/ops-watch.yml', 'tooling/ci/workflow-scan.mjs', GUARD_SCRIPT_REL, GATE_SCRIPT_REL, wrangler]) {
      const p = liveReadPlan(ADVISORY(), known(['README.md', f]), inputs);
      reads(p);
      assert.deepEqual(p.touched, [f]);
    }
    for (const files of [['README.md', 'apps/x/lib/main.dart', 'tooling/ci/assert-no-do-alarms.mjs'], []]) {
      const p = liveReadPlan(ADVISORY(), known(files), inputs);
      assert.equal(p.read, false, `${files.join(' ')} made the reads`);
      assert.match(p.line, /^\[LIVE\] NOT READ ON THIS HOST — .*The push run on main makes every one of them and enforces its verdict \(INV2\)\.$/);
    }
  });

  test('handed LIVE_READS_NOT_MADE, both evaluators still run every structural check they own, and classify nothing', () => {
    const now = Date.now();
    const rec = evaluateRunRecords(realReg(), LIVE_READS_NOT_MADE, now);
    assert.equal(rec.coverageLost, undefined, rec.coverageLost?.join(' '));
    assert.deepEqual([rec.live, rec.measurement], [[], []]);
    assert.ok(!rec.prints.some((p) => /scheduled=\d+/.test(p)), 'a tally over reads that were not made');

    const broken = realReg();
    broken._recordReaders['never-used-reader'] = { why: 'declared, and no row uses it' };
    const skipped = evaluateRunRecords(broken, LIVE_READS_NOT_MADE, now);
    const read = evaluateRunRecords(broken, new Map(), now);
    assert.ok(skipped.errors.some((e) => /`_recordReaders\.never-used-reader` is declared and no row uses it/.test(e)), skipped.errors.join('\n'));
    for (const e of skipped.errors) assert.ok(read.errors.includes(e), `a structural error only the skip path reports: ${e}`);

    const dispatchable = dispatchableWorkflows(REPO_ROOT);
    const red = evaluateRedSince(realReg(), LIVE_READS_NOT_MADE, dispatchable);
    assert.deepEqual(red.live, []);
    assert.ok(red.prints.some((p) => /\[14\]O-3b — TRIGGER ROWS/.test(p)), red.prints.join('\n'));
    assert.ok(!red.prints.some((p) => /RED SINCE: \d+/.test(p)));
    const redRead = evaluateRedSince(realReg(), new Map(), dispatchable);
    for (const p of red.prints) assert.ok(redRead.prints.includes(p), `a census line the read path does not print: ${p}`);
    const emptied = realReg();
    emptied.rows = emptied.rows.filter((r) => !String(r.id).startsWith('duty.workflow.'));
    assert.ok(evaluateRedSince(emptied, LIVE_READS_NOT_MADE, dispatchable).coverageLost, 'the empty-domain refusal was skipped with the reads');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// [14]O-4 — SOMETHING ON DIFFERENT INFRASTRUCTURE NOTICES THE SILENCE.
//
// The property under test is not "a watcher is named". It is: the watcher is on
// a DIFFERENT MACHINE, and somebody has SEEN IT FIRE. Both halves have already
// failed in production here — the four Oracle crontab duties are watched by a
// GlitchTip on the Oracle box (different word, same machine), and monitor 6 was
// configured, enabled, drawn red and silent for nine days behind a null foreign
// key. So every test below asks whether the guard can still fail, never whether
// the register happens to be well-formed today.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — [14]O-4 · the absence of a scheduled duty must be noticed from elsewhere', () => {
  test('the base register is green AND the limb really ran — one proven watcher, counted', () => {
    const v = run(baseRegister());
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.scheduled, 1);
    assert.equal(v.stats.absence.proven, 1);
    assert.equal(v.stats.absence.gaps.length, 0);
  });

  test('a scheduled duty with NO absenceWatcher FAILS — its own record is written by the thing that dies', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher;
    assert.match(messages(r), /and no `absenceWatcher`/);
  });

  test('🔴 A WATCHER ON THE SAME HOST FAILS — and the two substrates are spelled DIFFERENTLY', () => {
    // The Oracle case, in miniature: `oci-cron` and `glitchtip-heartbeat` are
    // different words for one box. A string comparison would call this
    // "different infrastructure"; only resolving both to a host catches it.
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    assert.match(messages(r), /THE WATCHER RUNS ON THE THING IT WATCHES/);
  });

  test('a same-host watcher is ACCEPTED when ownerGated with a written gap, and the gap NAMES the shape', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    const aw = sched(r).absenceWatcher;
    aw.ownerGated = true;
    aw.gap = 'closing it needs a monitor on a second provider — console-only work';
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.proven, 0);
    assert.equal(v.stats.absence.gaps.length, 1);
    assert.match(v.stats.absence.gaps[0], /ITS WATCHER SHARES THE DUTY'S HOST/);
  });

  test('`ownerGated` with no written gap FAILS — a gap nobody describes is a waiver', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    sched(r).absenceWatcher.ownerGated = true;
    assert.match(messages(r), /`absenceWatcher.ownerGated: true` with no written `gap`/);
  });

  test('substrate `(none)` FAILS unless it is owner-gated — "nothing watches it" may be recorded, never passed over', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    aw.substrate = '(none)';
    delete aw.downTransitionDrill;
    assert.match(messages(r), /is only an honest answer alongside `ownerGated: true`/);
  });

  test('substrate `(none)` WITH a gap passes and is printed as NOTHING WATCHES IT AT ALL, distinct from a shared host', () => {
    // Three gaps, three repairs. Rolling them into one count is how the Oracle
    // rows' shared-host problem hid behind "it has a watcher".
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    aw.substrate = '(none)';
    delete aw.downTransitionDrill;
    aw.ownerGated = true;
    aw.gap = 'an event reporter with no heartbeat; the absence half is on-box work';
    // …and the mapping it used to reach must go with it, which is the unused-key
    // rule doing its job: `(none)` reaches nothing, so nothing may point at it.
    delete r._substrateHosts['glitchtip-heartbeat'];
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.match(v.stats.absence.gaps[0], /NOTHING WATCHES ITS ABSENCE AT ALL/);
  });

  // ── the drill: a declaration is not a behaviour ────────────────────────────
  test('🔴 AN OFF-HOST WATCHER WITH NO DRILL AND NO DATED drillDue FAILS — this is the whole limb', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher.downTransitionDrill;
    assert.match(messages(r), /neither a `downTransitionDrill` nor a dated `drillDue`/);
  });

  test('drill evidence that is the WORD "verified" FAILS — monitor 6 was "verified" while telling nobody', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.downTransitionDrill.evidence = 'verified';
    assert.match(messages(r), /names nothing a later reader can look up/);
  });

  test('drill evidence carrying a durable id in ANY of the accepted shapes passes', () => {
    for (const evidence of ['issue #151 at 10:08:00Z', 'OPS-3 and OPS-4 resolved', 'run 30899326549']) {
      const r = baseRegister();
      sched(r).absenceWatcher.downTransitionDrill.evidence = evidence;
      assert.deepEqual(run(r).errors, [], evidence);
    }
  });

  test('a drill dated in the FUTURE fails — a transition that has not happened cannot be dated', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.downTransitionDrill.date = '2099-01-01';
    assert.match(messages(r), /is in the FUTURE/);
  });

  test('a drill with no `how` fails — the half a later reader needs to repeat it', () => {
    const r = baseRegister();
    delete sched(r).absenceWatcher.downTransitionDrill.how;
    assert.match(messages(r), /`downTransitionDrill.how` is empty/);
  });

  test('an owner-gated watcher does NOT licence an unverifiable drill sitting next to it', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'laptop';
    const aw = sched(r).absenceWatcher;
    aw.ownerGated = true;
    aw.gap = 'console-only';
    aw.downTransitionDrill.evidence = 'tested';
    assert.match(messages(r), /names nothing a later reader can look up/);
  });

  // ── the drillDue tripwire, with the lead window degradedUntil taught ───────
  test('`drillDue` far out PRINTS and never blocks; the count of pending drills moves', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2099-01-01', drillLeadDays: 14, drillGap: 'the transport is proven and this limb is not' });
    const v = run(r);
    assert.deepEqual(v.errors, []);
    assert.equal(v.stats.absence.pending, 1);
    assert.equal(v.stats.absence.proven, 0);
    assert.match(v.prints.join(' | '), /off-host but UNDRILLED/);
  });

  test('`drillDue` with no positive `drillLeadDays` FAILS — the 2026-08-04 finding, applied one level down', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2099-01-01', drillGap: 'still unobserved' });
    assert.match(messages(r), /no positive integer `drillLeadDays`/);
  });

  test('`drillDue` INSIDE its own lead window is RED, with time left to act', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    // NOW is 2026-08-02; six days out, inside a 14-day window.
    Object.assign(aw, { drillDue: '2026-08-08', drillLeadDays: 14, drillGap: 'still unobserved' });
    assert.match(messages(r), /FIRES IN 6 DAY\(S\), inside its own 14-day lead window/);
  });

  test('a PASSED `drillDue` is a hard failure that refuses the one move it exists to refuse', () => {
    const r = baseRegister();
    const aw = sched(r).absenceWatcher;
    delete aw.downTransitionDrill;
    Object.assign(aw, { drillDue: '2026-07-01', drillLeadDays: 14, drillGap: 'still unobserved' });
    const m = messages(r);
    assert.match(m, /has PASSED and the down-transition is still unobserved/);
    assert.match(m, /Moving the date is the one move this field exists to refuse/);
  });

  // ── the host map is itself checkable ──────────────────────────────────────
  test('a watcher substrate with no `_substrateHosts` entry FAILS as "cannot be checked"', () => {
    const r = baseRegister();
    sched(r).absenceWatcher.substrate = 'carrier-pigeon';
    assert.match(messages(r), /has no `_substrateHosts` entry, so whether it shares/);
  });

  test('a DUTY substrate with no `_substrateHosts` entry FAILS — the left-hand side matters too', () => {
    const r = baseRegister();
    delete r._substrateHosts['github-actions'];
    assert.match(messages(r), /this duty's HOST is\s+unknown/);
  });

  test('a host outside the fixed provider vocabulary FAILS — free text makes it a spelling comparison', () => {
    const r = baseRegister();
    r._substrateHosts['glitchtip-heartbeat'] = 'that one box in the corner';
    assert.match(messages(r), /is not in the fixed provider vocabulary/);
  });

  test('a `_substrateHosts` key no row reaches FAILS — a mapping about nothing inflates the domain', () => {
    const r = baseRegister();
    r._substrateHosts['fax-machine'] = 'laptop';
    assert.match(messages(r), /is reached by no duty row and by no absence watcher/);
  });

  // ── COVERAGE LOST: the domain may not empty itself ────────────────────────
  test('🔴 MOVING EVERY DUTY OFF A CLOCK IS COVERAGE LOST, NOT A PASS', () => {
    // The vacuity escape. `on-demand` already costs a `why`, but without this
    // the O-4 domain could still be emptied one row at a time while the guard
    // went on printing ok — this repository's single most repeated defect.
    const r = baseRegister();
    const d = sched(r);
    d.cadence = 'on-demand';
    d.why = 'escaping the O-4 domain by leaving the clock';
    delete d.absenceWatcher;
    r._substrateHosts = { 'github-actions': 'github', 'windows-task-scheduler': 'laptop' };
    assert.match(messages(r), /COVERAGE LOST — not one `duty` row carries a TIME cadence/);
  });

  test('a register with NO duty row at all is COVERAGE LOST', () => {
    const r = baseRegister();
    r.rows = r.rows.filter((x) => x.kind !== 'duty');
    r._requiredCoverage = { ids: ['recovery.bundles'] };
    r._substrateHosts = {};
    assert.match(messages(r), /COVERAGE LOST — this register declares NO `duty` row at all/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // `cloudflare-cron` CONFINEMENT — the other side of the `kind === 'duty'` filter.
  //
  // check-heartbeats.mjs derives its watched set with
  // `kind === 'duty' && substrate === 'cloudflare-cron'`, and this guard's own
  // `anchored` map is built from `kind === 'duty'` alone. A NON-duty row carrying
  // that substrate is therefore invisible to BOTH — it names a Cloudflare cron
  // whose outcome nothing reads, and before 2026-08-07 every limb passed it.
  //
  // Found by mutation, not by reading: a `cloudflare-cron` substrate on an
  // `expiring` row produced no COVERAGE LOST from either reader. The premise
  // that it would was stated in a brief and was WRONG IN THE DANGEROUS DIRECTION.
  // ───────────────────────────────────────────────────────────────────────────
  test('a NON-duty row declaring `cloudflare-cron` FAILS — nothing would ever read its outcome', () => {
    const r = baseRegister();
    // ANY non-duty kind, not a named one. The first draft looked for `expiring`
    // and this fixture has none — the assert below caught it rather than the
    // test silently passing over an absent victim, which is the whole reason it
    // is written as a guard and not as a comment.
    const victim = r.rows.find((x) => x.kind !== 'duty' && x.mechanism);
    assert.ok(victim, 'fixture must contain a NON-duty row with a mechanism, or this test asserts nothing');
    victim.mechanism.substrate = 'cloudflare-cron';
    assert.match(messages(r), /declares `mechanism\.substrate: "cloudflare-cron"`/);
    assert.match(messages(r), new RegExp(`${victim.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} —`) /* CodeQL #29 */);
  });

  test('the confinement scan has a NON-EMPTY domain and prints its size', () => {
    // A confinement rule over zero rows is the vacuous pass this repo keeps
    // re-finding. The count is asserted, not just the absence of an error.
    const v = run(baseRegister());
    const line = v.prints.find((p) => p.includes('`cloudflare-cron` confinement'));
    assert.ok(line, `no confinement line printed; prints were: ${v.prints.join(' | ')}`);
    const n = Number(line.match(/(\d+) non-duty row\(s\) scanned/)?.[1] ?? 0);
    assert.ok(n > 0, `confinement scanned ${n} rows — an empty domain passes forever`);
  });

  test('a DUTY row declaring `cloudflare-cron` is fine — the rule confines, it does not ban', () => {
    // The mutation that proves the rule is not simply "reject this substrate".
    const r = baseRegister();
    sched(r).mechanism.substrate = 'cloudflare-cron';
    assert.doesNotMatch(messages(r), /declares `mechanism\.substrate: "cloudflare-cron"`/);
  });

  test('the scoping is REAL: `trigger` and `on-demand` duties need no watcher, and both counts print', () => {
    // Scoped for the reason [14]O-10 records — a trigger duty has no timer that
    // can silently die. The scoped-OUT count is printed too, so shrinking the
    // domain is visible rather than silent.
    const v = run(baseRegister());
    assert.equal(v.stats.absence.duties, 2);
    assert.equal(v.stats.absence.scheduled, 1);
    assert.match(v.prints.join(' | '), /1 on a CLOCK \(the O-4 domain\) · 1 on `trigger`\/`on-demand`/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REQUIRED_COVERAGE for the two written-procedure rows — [14]O-19 + [10]D-12.
//
// 🔴 THE HOLE THIS CLOSES, AND WHY NO OTHER TEST IN THIS FILE REACHES IT.
// `_requiredCoverage.ids ⊆ rows` is enforced by the guard, so deleting a ROW
// while its id stays in the list fails loudly (mutation M-A, run against the
// real tree on 2026-08-06: exit 1, "_requiredCoverage names
// `recovery.app-retirement` and no row has that id"). But deleting the row AND
// its id together passes CLEAN — the domain shrinks and the guard reports ok,
// because nothing anywhere says WHICH ids the external half must contain. That
// is check-migrations.mjs's 5-files-to-4 defect exactly, and these two rows are
// the likeliest victims of it: both are pure-`Private/` procedures whose entire
// machine-readable existence is the register line.
//
// So the list is pinned HERE, against the REAL register, rather than against a
// fixture — a fixture would encode the same misunderstanding as the row. Adding
// a row is free; REMOVING one of these is a deliberate edit to this file.
//
// NEGATIVE-TESTED, not assumed: dropping either id from a copy of the real
// `_requiredCoverage.ids` reddens `pinned` below; dropping either row reddens
// `resolves`. Both were run before this suite was committed.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — the two written-procedure rows cannot vanish quietly', () => {
  const REAL = JSON.parse(
    readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'),
  );

  /** [14]O-19's contract half and [10]D-12's whole document. Neither is visible
   *  to any tree walk — `Private/` is gitignored — so the register row is the
   *  only handle CI will ever have on them. */
  const PINNED = ['recovery.app-retirement', 'recovery.store-enforcement-response'];

  for (const id of PINNED) {
    test(`\`${id}\` is pinned in the external half (_requiredCoverage.ids)`, () => {
      assert.ok(
        REAL._requiredCoverage.ids.includes(id),
        `${id} is not in _requiredCoverage.ids. Without it, deleting the row and the id together ` +
          'shrinks the register silently and the guard still prints ok.',
      );
    });

    test(`\`${id}\` resolves to a row anchored in Private/runbooks/`, () => {
      const row = REAL.rows.find((r) => r.id === id);
      assert.ok(row, `${id} is named in _requiredCoverage.ids and is not a row.`);
      assert.equal(row.kind, 'recovery-path');
      assert.match(
        row.mechanism.anchor,
        /* FLATTENED 2026-08-15. This pattern was `^company\/runbooks\/` and had been
           stale since the MORNING of the same day, when company/ moved under Private/ —
           it survived the citation sweep precisely because it does NOT carry a
           `Private/` prefix, so a scan for `Private/company/` (deleted 2026-08-15) could never see it.
           A stale pattern that names no current directory is invisible to exactly the
           search you would run to find it. */
        /^Private\/runbooks\/.+\.md$/,
        'The anchor must stay a runbook. Repointing it at an in-tree file CI can read would make ' +
          'the row look verifiable while the procedure it stands for stayed unwritten.',
      );
    });
  }

  test('🔴 the retirement contract is NOT recorded as executed — lastDrill stays null until it is', () => {
    // [14]O-19's acceptance is "a checklist exists AND has been executed end to
    // end at least once". Writing Private/runbooks/app-retirement.md discharges
    // the first half only. This assertion exists so that setting the date is a
    // DELIBERATE act that also edits this line — the built-vs-working confusion
    // this repo keeps paying for arrives precisely as a quiet field change.
    // ⚠️ When the procedure IS executed: set lastDrill, append the runbook's §8
    // entry, and change this test to assert the date instead of the null.
    const row = REAL.rows.find((r) => r.id === 'recovery.app-retirement');
    assert.equal(row.lastDrill, null);
    assert.equal(row.ownerGated, true, 'a null drill must cost a printed gap');
    assert.ok(row.ownerGap && row.ownerGap.trim().length > 0);
  });

  test('[10]D-12 limb (d): the enforcement runbook carries a real last-reviewed date on a clock', () => {
    // The dated half of D-12's acceptance. Unlike the row above this one IS
    // dated, because its drill is "re-read the four stores' published pages",
    // which was genuinely performed on the date recorded. The guard turns that
    // date into a build failure once it passes the cadence — which is the only
    // limb of D-12 a machine can hold at all.
    const row = REAL.rows.find((r) => r.id === 'recovery.store-enforcement-response');
    assert.match(row.lastDrill, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(cadenceDays(row.cadence), 180);
    assert.equal(
      row.source,
      'unverified',
      'Three of four appeal deadlines could not be established from a primary page. `unverified` ' +
        'with an `unverifiedWhy` is how this register records that, and it is counted and printed.',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A RETIRED ROW IS OUT OF BOTH LIVE SETS, OR IT IS NOT RETIRED.
//
// `_retiredRows` is a RECORD and no guard reads it — that is the point of
// retiring rather than editing in place, and tooling/legal/provider-register.json
// says exactly the same of `retiredDisclosureGaps`. What CAN go wrong is half a
// retirement, and the two halves fail very differently:
//
//   the ID left in `_requiredCoverage.ids` — assert-ops-register.mjs already
//       fails ("_requiredCoverage names `x` and no row has that id"), so that
//       half is held by the guard and needs nothing here.
//   the ROW left in `rows`                 — NOTHING fails. Every limb keeps
//       enforcing a store this same file records as gone, and its `ownerGap`
//       keeps printing on every run, asking the owner for work already done.
//
// That second state is not hypothetical: it is retention.kv.ratel-cache's whole
// history. The namespace was deleted, nothing re-read the account, and the row
// went on being enforced and printed until 2026-08-11. A record saying "retired"
// beside a row still being enforced is worse than no record, because it reads as
// the cleanup having happened.
//
// The evidence limb reuses the guard's own DURABLE_ID rather than a second regex
// with the same idea in it: "we decided to stop tracking it" is a deletion, and
// only a reading of the thing ITSELF — timestamped, re-runnable — makes it a
// retirement. Retiring must never become the cheap way to shrink the domain.
//
// NEGATIVE-TESTED ON THE REAL TREE, not on a fixture — the mutations and their
// output are in the increment report.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — a retired row is gone from BOTH live sets, with evidence', () => {
  const REAL = JSON.parse(
    readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'),
  );
  // 🔴 NO `?? []` HERE, AND THE FIRST DRAFT HAD ONE. With the default, deleting
  // `_retiredRows.rows` outright left `retired` an empty array — the shape test
  // below passed on it, the per-entry tests ranged over nothing, and the suite
  // printed 153 green. Measured, not reasoned about: mutation M5 against the real
  // register was CAUGHT ONLY after this line lost its default. A fallback on the
  // value being checked is how an assertion stops being able to fail.
  const retiredRaw = REAL._retiredRows?.rows;
  const retired = Array.isArray(retiredRaw) ? retiredRaw : [];
  const liveIds = new Set(REAL.rows.map((r) => r.id));
  const requiredIds = new Set(REAL._requiredCoverage.ids);

  /** Same reasoning as PINNED above, one register-section over: an ENTRY deleted
   *  from `_retiredRows` takes with it the only evidence of how long the row
   *  stood and what made it stop, and nothing else in the tree would notice.
   *  Adding a retirement is free; erasing one is a deliberate edit to this file. */
  const PINNED_RETIRED = ['retention.kv.ratel-cache'];

  test('`_retiredRows.rows` exists as an array, so the limbs below have a domain', () => {
    assert.ok(Array.isArray(retiredRaw), '`_retiredRows.rows` is missing or is not an array.');
  });

  for (const id of PINNED_RETIRED) {
    test(`the retirement of \`${id}\` is still recorded — history is not erased on a later edit`, () => {
      assert.ok(
        retired.some((e) => e?.id === id),
        `${id} was retired and its record is gone. Deleting the entry removes the dated evidence that the ` +
          'store it covered no longer exists, which is the only thing separating a retirement from a deletion.',
      );
    });
  }

  for (const entry of retired) {
    const id = entry?.id ?? '<no id>';

    test(`\`${id}\` is retired, so it is NOT in \`rows\``, () => {
      assert.ok(
        !liveIds.has(id),
        `${id} is recorded as retired AND is still a live row. Every guard would keep enforcing it — ` +
          'and if it is owner-gated, keep printing its gap — while this file says it was retired.',
      );
    });

    test(`\`${id}\` is retired, so it is NOT in \`_requiredCoverage.ids\``, () => {
      assert.ok(
        !requiredIds.has(id),
        `${id} is recorded as retired and is still named in _requiredCoverage.ids, which requires a row ` +
          'to exist for it. The two halves of the retirement disagree.',
      );
    });

    test(`\`${id}\` carries a date, a reason, and evidence a later reader can re-check`, () => {
      assert.match(entry.retiredOn ?? '', /^\d{4}-\d{2}-\d{2}$/, `${id} — \`retiredOn\` must be an ISO date.`);
      assert.ok((entry.retiredWhy ?? '').trim().length > 0, `${id} — \`retiredWhy\` is empty.`);
      assert.match(
        entry.evidence ?? '',
        DURABLE_ID,
        `${id} — \`evidence\` carries nothing a later reader can look up. The same rule the guard applies ` +
          'to drill evidence: a timestamp, a run id, an issue number — not an adjective.',
      );
      assert.equal(entry.row?.id, id, `${id} — the preserved \`row\` must be the row that was retired, verbatim.`);
    });
  }
});

describe('assert-ops-register — [14]O-3 · the GlitchTip heartbeat reader, and THE PROPERTY IT WAS BUILT TO KEEP', () => {
  // ── WHY THIS SUITE IS LONGER THAN THE READER IT TESTS ──────────────────────
  // The reader exists because `duty.laptop.nikatru-daily-backup` moved off
  // `windows-scheduled-task` on 2026-09-02: that reader is structurally
  // unreadable on every Linux runner, so once the backup was repaired and its
  // held failure was correctly cleared to `pass`, the row fell through to plain
  // `unreadable` and took the count past its ceiling.
  //
  // 🔴 THE DANGER IN THAT FIX IS OBVIOUS AND IT IS WHAT THESE CASES GUARD: the
  // easy way to make a row readable is to make it readable AND ALWAYS GREEN. A
  // reader that answered "fine" whenever it could reach GlitchTip would drop the
  // unreadable count, unblock the merge, and silently retire the only automated
  // check that the laptop backup still runs. So the cases below are weighted
  // toward the RED outcomes: a stale heartbeat, a page of nothing but misses, an
  // empty page, a monitor that stopped being a Heartbeat, and a monitor that is
  // gone. Every one of them must be a FAILURE, and none of them may be a print.
  const MON = { monitorType: 'Heartbeat', interval: 43200 };
  const Q = { org: 'nikatru', monitor: 6 };
  const upAt = (iso) => ({ startCheck: iso, isUp: true, reason: null });
  const downAt = (iso) => ({ startCheck: iso, isUp: false, reason: 'no heartbeat' });

  test('a fresh heartbeat is the duty\'s last successful run, and the detail names the monitor and the timestamp', () => {
    const r = classifyGlitchtipChecks(MON, [upAt('2026-09-02T13:42:42.162Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42.162Z'));
    assert.equal(r.unreadable, undefined);
    assert.equal(r.missing, undefined);
    assert.match(r.detail, /monitor 6 \(Heartbeat, interval 43200s\)/);
    assert.match(r.detail, /newest SUCCESSFUL heartbeat at 2026-09-02T13:42:42\.162Z/);
  });

  test('the NEWEST success wins even when the page is not ordered, so this never depends on the API\'s sort order', () => {
    const r = classifyGlitchtipChecks(MON, [upAt('2026-09-01T01:00:00Z'), upAt('2026-09-02T13:42:42Z'), upAt('2026-08-30T01:00:00Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42Z'));
  });

  test('misses on the page do not hide a real success — they are COUNTED and reported beside it', () => {
    const r = classifyGlitchtipChecks(MON, [downAt('2026-09-02T20:00:00Z'), downAt('2026-09-02T18:00:00Z'), upAt('2026-09-02T13:42:42Z')], Q);
    assert.equal(r.lastSuccessMs, Date.parse('2026-09-02T13:42:42Z'));
    assert.match(r.detail, /3 check\(s\) on the newest page \(2 of them recording a miss\)/);
  });

  test('🔴 THE HEARTBEAT STOPPED — a page of nothing but misses is NO SUCCESSFUL RUN, which is a failure and never a print', () => {
    const r = classifyGlitchtipChecks(MON, [downAt('2026-09-03T02:00:00Z'), downAt('2026-09-02T14:00:00Z')], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs), 'must be NaN so classifyRunRecord routes it to the NO SUCCESSFUL RUN branch');
    assert.equal(r.unreadable, undefined, 'a duty that is failing must not be reported as a duty that could not be read');
    assert.match(r.detail, /contain NO successful heartbeat/);
  });

  test('🔴 THE MONITOR HAS NO CHECKS AT ALL — also a failure, for the same reason: absence of evidence is not evidence of a run', () => {
    const r = classifyGlitchtipChecks(MON, [], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs));
    assert.equal(r.unreadable, undefined);
  });

  test('a check with an unparseable timestamp is not a success — a success this reader cannot date cannot be compared to a window', () => {
    const r = classifyGlitchtipChecks(MON, [{ startCheck: 'whenever', isUp: true }], Q);
    assert.ok(Number.isNaN(r.lastSuccessMs));
  });

  test('🔴 `isUp` MUST BE STRICTLY TRUE — a truthy string or a 1 is not a heartbeat GlitchTip recorded as up', () => {
    for (const bad of ['true', 1, {}, null, undefined]) {
      const r = classifyGlitchtipChecks(MON, [{ startCheck: '2026-09-02T13:42:42Z', isUp: bad }], Q);
      assert.ok(Number.isNaN(r.lastSuccessMs), `isUp: ${JSON.stringify(bad)} must not count as a success`);
    }
  });

  test('🔴 A MONITOR THAT STOPPED BEING A HEARTBEAT IS `missing`, NOT a pass — a GET monitor answers a different question forever', () => {
    const r = classifyGlitchtipChecks({ monitorType: 'GET', interval: 60 }, [upAt('2026-09-02T13:42:42Z')], Q);
    assert.equal(r.missing, true);
    assert.equal(r.lastSuccessMs, undefined, 'a fresh-looking check on the wrong monitor type must not become a success');
    assert.match(r.why, /not "Heartbeat"/);
  });

  test('a payload that is not an array is `unreadable` — refusing to read is not reading a failure', () => {
    for (const bad of [null, undefined, { detail: 'Not found.' }, 'nope']) {
      const r = classifyGlitchtipChecks(MON, bad, Q);
      assert.equal(r.unreadable, true, `${JSON.stringify(bad)} must be unreadable`);
      assert.equal(r.lastSuccessMs, undefined, 'an unread payload must never assert that the duty failed');
    }
  });

  // ── AND THE END-TO-END HALF: the register's own row, through the guard's own
  // classifier, on a runner that is not Windows. This is the claim the fix rests
  // on and it is asserted rather than believed.
  const realRegister = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
  const NOWG = Date.parse('2026-09-02T15:30:00Z');

  test('THE SHIPPED ROW IS READABLE FROM LINUX — the whole point of the move, asserted against the committed register', () => {
    const reg = realRegister();
    const row = reg.rows.find((r) => r.id === 'duty.laptop.nikatru-daily-backup');
    assert.ok(row, 'the row this reader was built for must still exist');
    assert.equal(row.mechanism.recordQuery.reader, 'glitchtip-heartbeat');
    assert.ok(reg._recordReaders['glitchtip-heartbeat'], 'the reader must be DECLARED, or the row names one nothing implements');
    // No platform gate anywhere in the path: the same inputs give the same
    // verdict on Windows, Linux and macOS, which `windows-scheduled-task` could
    // never say.
    const fresh = classifyGlitchtipChecks(MON, [upAt('2026-09-02T13:42:42.162Z')], row.mechanism.recordQuery);
    const v = classifyRunRecord(row, fresh, NOWG, reg._recordReaders._windowMultiplier);
    assert.equal(v.verdict, 'pass', v.line);
  });

  test('🔴 AND IT STILL GOES RED WHEN THE HEARTBEAT STOPS — the property the whole change had to preserve, on the REAL row', () => {
    const reg = realRegister();
    const row = reg.rows.find((r) => r.id === 'duty.laptop.nikatru-daily-backup');
    const mult = reg._recordReaders._windowMultiplier;

    // 1 · STALE. The duty's own cadence window (8h x 1.5 = 12h) has passed with
    //     no new POST. This is what "the laptop stopped backing up" looks like.
    const stale = classifyGlitchtipChecks(MON, [upAt('2026-09-01T00:00:00Z')], row.mechanism.recordQuery);
    const vStale = classifyRunRecord(row, stale, NOWG, mult);
    assert.equal(vStale.verdict, 'fail', vStale.line);
    assert.match(vStale.line, /newest SUCCESSFUL run is [\d.]+h old, outside its own window/);

    // 2 · NOTHING BUT MISSES on the newest page.
    const missed = classifyGlitchtipChecks(MON, [downAt('2026-09-02T15:00:00Z')], row.mechanism.recordQuery);
    const vMissed = classifyRunRecord(row, missed, NOWG, mult);
    assert.equal(vMissed.verdict, 'fail', vMissed.line);
    assert.match(vMissed.line, /holds NO SUCCESSFUL RUN AT ALL/);

    // 3 · THE MONITOR IS GONE. A stale register row is worse than an absent one.
    const gone = { missing: true, why: 'GlitchTip has no monitor 6 in organisation `nikatru` — the id the register names returns 404' };
    const vGone = classifyRunRecord(row, gone, NOWG, mult);
    assert.equal(vGone.verdict, 'fail', vGone.line);
    assert.match(vGone.line, /DOES NOT EXIST/);

    // 4 · AND NONE OF THE THREE IS OWNER-GATED INTO A PRINT. The row carries
    //     `ownerGated: true`, which lifts the block ONLY on the held-failure
    //     branch; a query that RAN and answered must still block. If this ever
    //     flips, the duty is being watched by something that cannot say no.
    for (const v of [vStale, vMissed, vGone]) {
      assert.notEqual(v.gated, true, `a READ failure must never be gated into a print: ${v.line}`);
    }
  });

  // ── `firstDue`: the bootstrap gate, and every way it must NOT work ────────
  // It is the only thing in this limb that lifts a block on a query that RAN
  // and answered, so it gets the same treatment the held-failure gate got: the
  // one case it may cover, and four it may not.
  describe('recordQuery.firstDue — the bootstrap gate', () => {
    const REAL = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    // The schema half lives inside `evaluateRunRecords`, so it is exercised the
    // way the guard exercises it: no probes, which makes every reader dark and
    // raises its own unreadable-ceiling error. Filter to the claim under test.
    const limbErrors = (reg) => evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
    const NOWF = Date.parse('2026-09-03T06:00:00Z');
    const MULT = () => REAL()._recordReaders._windowMultiplier;
    const EMPTY = { lastSuccessMs: NaN, detail: 'globalonlinedeveloper/X has NO successful `schedule` run of w.yml in its run history at all.' };
    const rowWith = (firstDue) => ({
      id: 'duty.workflow.test.yml',
      kind: 'duty',
      cadence: '7d',
      mechanism: { recordQuery: { reader: 'github-run-history', workflow: 'w.yml', event: 'schedule', ...(firstDue === undefined ? {} : { firstDue }) } },
    });

    test('a duty declared before its first slot PRINTS instead of blocking — the deadlock this field exists to break', () => {
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), EMPTY, NOWF, MULT());
      assert.equal(c.verdict, 'fail', 'it is still counted as FAILING — the gate lifts the block, never the verdict');
      assert.equal(c.gated, true, c.line);
      assert.match(c.line, /NOT YET DUE/);
      assert.match(c.line, /2026-09-05T12:00:00Z/, 'the date must be in the line, or nobody can tell when it stops printing');
    });

    test('🔴 AND IT BLOCKS THE MOMENT THE DATE PASSES, with nobody editing the row', () => {
      const row = rowWith('2026-09-05T12:00:00Z');
      const after = Date.parse('2026-09-05T12:00:01Z');
      const c = classifyRunRecord(row, EMPTY, after, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true, 'one second past its own date the gate must be gone: this is what makes it a wait and not a waiver');
      assert.match(c.line, /has PASSED, so it gates nothing: delete the field/);
    });

    test('🔴 IT NEVER GATES A STALE SUCCESS — a duty that ran and then stopped is exactly what this limb is for', () => {
      const stale = { lastSuccessMs: NOWF - 400 * 3_600_000, detail: 'run 1 (schedule) succeeded.' };
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), stale, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true, 'a record WITH a success is past its bootstrap; gating staleness would be the weakening');
      assert.match(c.line, /outside its own window/);
    });

    test('🔴 IT NEVER GATES A MISSING MECHANISM — a workflow that has been deleted is not a workflow waiting to start', () => {
      const gone = { missing: true, why: 'the workflow the register names returns 404' };
      const c = classifyRunRecord(rowWith('2026-09-05T12:00:00Z'), gone, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true);
      assert.match(c.line, /DOES NOT EXIST/);
    });

    test('a row with NO firstDue is unchanged — the gate is opt-in and the default is still red', () => {
      const c = classifyRunRecord(rowWith(undefined), EMPTY, NOWF, MULT());
      assert.equal(c.verdict, 'fail');
      assert.notEqual(c.gated, true);
      assert.match(c.line, /holds NO SUCCESSFUL RUN AT ALL/);
      assert.doesNotMatch(c.line, /firstDue/);
    });

    test('an unparseable firstDue gates nothing — a field that lifts a block is a timestamp or it is nothing', () => {
      for (const bad of ['soon', '', 'next monday', null]) {
        const c = classifyRunRecord(rowWith(bad), EMPTY, NOWF, MULT());
        assert.notEqual(c.gated, true, `${JSON.stringify(bad)} must not gate`);
      }
    });

    // ── and the schema half: the guard must REFUSE the shapes that would turn
    //    the wait into a waiver. Run through the real limb, over the real file
    //    PLUS one row this file builds.
    // 🔴 THE SUBJECT IS SYNTHESISED, NOT BORROWED FROM THE COMMITTED REGISTER,
    //    AND THAT IS THE WHOLE POINT OF THIS FIELD. A `firstDue` exists to be
    //    DELETED the moment its record lands — its own text says so — so the set
    //    of live bootstraps is always on its way to empty, and a control that
    //    ranges over it expires with them. Two earlier shapes both broke on
    //    exactly that: pinning one row id and one literal date died on
    //    2026-09-05 when `duty.workflow.renovate.yml`'s spent bootstrap was
    //    removed after its first scheduled run landed; the `find the first row
    //    with a firstDue` replacement then made every mutation below depend on
    //    the register still happening to carry one, which is a control whose
    //    domain a correct edit elsewhere can empty. The fixture below cannot be
    //    emptied by anybody's cleanup, so these four cases keep failing for the
    //    reason they were written. The committed values are still held — by the
    //    last case in this block, which reads the real file and nothing else.
    // ⚠️ `firstDue` is measured against `Date.now()`, so the legal value is
    //    computed at run time. A literal would age into the very "parked in the
    //    future" red this fixture has to be clean of.
    const FIXTURE_ID = 'duty.fixture.bootstrap-probe';
    const withFixture = (mutate) => {
      const reg = REAL();
      const row = {
        id: FIXTURE_ID,
        kind: 'duty',
        cadence: '1d',
        mechanism: {
          recordQuery: {
            reader: 'github-run-history',
            workflow: 'fixture.yml',
            event: 'schedule',
            headBranch: 'main',
            firstDue: new Date(Date.now() + 3_600_000).toISOString(),
          },
        },
      };
      reg.rows.push(row);
      if (mutate) mutate(row.mechanism.recordQuery, row);
      return reg;
    };
    /** Only this row's errors. The empty probe map makes every reader dark,
     *  which raises its own (correct) ceiling error about the whole register. */
    const fixtureErrors = (reg) => limbErrors(reg).filter((e) => e.startsWith(FIXTURE_ID));

    test('the fixture is LEGAL as built — the green control the four mutations below are measured against', () => {
      const out = fixtureErrors(withFixture());
      assert.deepEqual(out, [], 'a fixture that is already red proves nothing when a mutation reddens it: ' + out.join(' | '));
    });

    test('🔴 THE SCHEMA REFUSES A DATE PARKED IN THE FUTURE — the one way this becomes permanent', () => {
      const out = fixtureErrors(withFixture((q) => { q.firstDue = '2030-01-01T00:00:00Z'; }));
      assert.ok(
        out.some((e) => /more than one cadence window/.test(e)),
        `a firstDue four years out must be refused; got:\n${out.join('\n')}`,
      );
    });

    test('the schema refuses an unparseable firstDue', () => {
      const out = fixtureErrors(withFixture((q) => { q.firstDue = 'soon'; }));
      assert.ok(out.some((e) => /not a parseable instant/.test(e)), 'got: ' + out.join(' | '));
    });

    test('the schema refuses a firstDue on an `unreachable` reader — nothing is waiting for a record nothing reads', () => {
      const out = fixtureErrors(withFixture((q) => {
        q.reader = 'unreachable';
        q.why = 'built for this mutation only';
        delete q.workflow;
        delete q.event;
        delete q.headBranch;
      }));
      assert.ok(out.some((e) => /reader is `unreachable`/.test(e)), 'got: ' + out.join(' | '));
    });

    test('🔴 the schema refuses a firstDue beside a PASS already observed — that is a waiver wearing a wait\'s clothes', () => {
      const out = fixtureErrors(withFixture((q) => {
        q.lastObserved = { verdict: 'pass', at: '2026-09-01T00:00:00Z', detail: 'run 1 (schedule) succeeded.' };
      }));
      assert.ok(
        out.some((e) => /already held a success is past its bootstrap/.test(e)),
        'the third schema branch had no case at all until the fixture made one cheap; got: ' + out.join(' | '),
      );
    });

    test('the committed register raises NO firstDue error of its own — the mutations above are the only red', () => {
      // NOT `errors === []`: with an empty probe map every reader is dark, which
      // is its own (correct) error about the unreadable ceiling. The claim here
      // is narrower and is the one that matters — the committed value is legal.
      const mine = limbErrors(REAL()).filter((e) => /firstDue/.test(e));
      assert.deepEqual(mine, [], 'the committed firstDue must be legal: ' + mine.join(' | '));
    });
  });

  // ── the BRANCH half of a run-history read ───────────────────────────────
  // Added 2026-09-03. Today every row pairs `headBranch` with `event: schedule`
  // and GitHub fires schedules only on the default branch, so none of this
  // changes a verdict — which is exactly why the cases exist: the guarantee is
  // real, implied, and would vanish silently the day Phase 2 widens the event
  // filter. These are what make it survive that edit.
  describe('recordQuery.headBranch — the guarantee that was only ever implied', () => {
    const Q = { workflow: 'e2e.yml', event: 'schedule', headBranch: 'main' };
    const run = (over = {}) => ({ id: 7, updated_at: '2026-09-03T04:00:00Z', head_branch: 'main', ...over });

    test('a run on the named branch is accepted, and the branch is IN the detail', () => {
      const r = classifyRunHistoryAnswer(Q, run(), 'owner/repo');
      assert.equal(r.lastSuccessMs, Date.parse('2026-09-03T04:00:00Z'));
      assert.match(r.detail, /on main/, 'a reader must be able to see which branch the verdict is about');
    });

    test('🔴 A RUN ON ANOTHER BRANCH IS REFUSED — the API filter is a REQUEST, this is the ANSWER', () => {
      // The case that matters: a `branch=` parameter silently ignored by a future
      // API version would widen this guard with nothing to notice it. Checking
      // what came BACK is the difference between asking and knowing.
      const r = classifyRunHistoryAnswer(Q, run({ head_branch: 'feat/something' }), 'owner/repo');
      assert.equal(r.unreadable, true, 'a run from another branch must not satisfy a claim about main — and it is UNREADABLE (INV6, REVIEW-guards-2026-09-10 #8)');
      assert.equal(r.lastSuccessMs, undefined, 'a NaN here is what graded an unheld filter as "no successful run at all", exit 1');
      assert.match(r.why, /branch filter did not hold/);
      assert.match(r.why, /feat.something/, 'the branch that came back must be named, or nobody can debug it');
    });

    test('a missing head_branch is refused too — absent is not "probably main"', () => {
      const r = classifyRunHistoryAnswer(Q, run({ head_branch: undefined }), 'owner/repo');
      assert.equal(r.unreadable, true);
      assert.match(r.why, /branch filter did not hold/);
    });

    test('with NO headBranch declared the answer is unchanged — the field is opt-in at this layer', () => {
      const { headBranch, ...noBranch } = Q;
      const r = classifyRunHistoryAnswer(noBranch, run({ head_branch: 'anything' }), 'owner/repo');
      assert.equal(r.lastSuccessMs, Date.parse('2026-09-03T04:00:00Z'));
      assert.doesNotMatch(r.detail, / on /);
    });

    test('an empty history says so, and names the branch it looked on', () => {
      const r = classifyRunHistoryAnswer(Q, undefined, 'owner/repo');
      assert.ok(Number.isNaN(r.lastSuccessMs));
      assert.match(r.detail, /NO successful/);
      assert.match(r.detail, /on main/);
    });

  });

  // ─────────────────────────────────────────────────────────────────────────
  // 🔴 A `per_page=1` ANSWER BELIEVED ON SIGHT — the staleness cross-check.
  // Added 2026-09-09. The filter checks above validate WHAT came back; nothing
  // validated WHEN. Measured live inside run 34351841295: the same query
  // answered run 32560795997 from 2026-08-22 (436.7h stale) and run
  // 34332836726 from that morning. These are the cases that make the refusal
  // real — a GREEN CONTROL first, then the stale page.
  // ─────────────────────────────────────────────────────────────────────────
  describe('run-history reads are cross-checked for staleness, not just for shape', () => {
    const NOW = Date.parse('2026-09-09T12:00:00Z');
    const run = (id, at) => ({ id, updated_at: at, head_branch: 'main', conclusion: 'success' });
    const FRESH = run(34332836726, '2026-09-09T09:08:21Z');
    const STALE = run(32560795997, '2026-08-22T00:00:00Z');

    // ── newestOnPage: the page's order is a promise, not a check ────────────
    test('GREEN CONTROL — newestOnPage returns the only run on a one-entry page', () => {
      assert.equal(newestOnPage([FRESH]).id, FRESH.id);
    });

    test('🔴 newestOnPage takes the NEWEST, not entry zero — sort order is not trusted', () => {
      // A page served newest-last would otherwise decide the verdict.
      assert.equal(newestOnPage([STALE, FRESH]).id, FRESH.id, 'entry zero was stale and must not win');
    });

    test('newestOnPage on an empty or absent page is null, never a throw', () => {
      assert.equal(newestOnPage([]), null);
      assert.equal(newestOnPage(undefined), null);
      assert.equal(newestOnPage([{ id: 1 }]), null, 'a run with no updated_at cannot be newest');
    });

    // ── ⏱ 2026-09-12 · splitRunFilters / selectRuns — the two halves of "one
    //    page per workflow". `branch` stays GitHub's question; `event` and
    //    `status` are answered here, off the page that was already fetched.
    //    Anything this split does not RECOGNISE must fall back to a targeted
    //    read rather than be dropped, or a filter would silently stop applying.
    test('splitRunFilters separates the server-side branch from the locally selected event and status', () => {
      assert.deepEqual(splitRunFilters(['event=schedule', 'branch=main', 'status=success']), {
        branch: 'main', event: 'schedule', status: 'success', unknown: [],
      });
      assert.deepEqual(splitRunFilters(['branch=main', 'status=completed']), {
        branch: 'main', event: null, status: 'completed', unknown: [],
      });
      assert.deepEqual(splitRunFilters(['', null, undefined, 'branch=release%2Fv1']).branch, 'release/v1', 'the value is decoded, as it was encoded');
    });

    test('🔴 a filter splitRunFilters does not recognise is UNKNOWN, never dropped', () => {
      // The caller falls back to the targeted two-width read when `unknown` is
      // non-empty. Without this, adding `actor=` to a query would quietly widen
      // the answer to every actor while the page read on regardless.
      const s = splitRunFilters(['branch=main', 'actor=dependabot', 'status=failure']);
      assert.deepEqual(s.unknown, ['actor=dependabot']);
    });

    test('selectRuns answers event and conclusion questions off one page', () => {
      const page = [
        { id: 1, event: 'push', status: 'completed', conclusion: 'failure', updated_at: '2026-09-11T10:00:00Z' },
        { id: 2, event: 'schedule', status: 'completed', conclusion: 'success', updated_at: '2026-09-11T09:00:00Z' },
        { id: 3, event: 'schedule', status: 'completed', conclusion: 'failure', updated_at: '2026-09-11T08:00:00Z' },
      ];
      assert.deepEqual(selectRuns(page, { status: 'success' }).map((r) => r.id), [2]);
      assert.deepEqual(selectRuns(page, { status: 'failure' }).map((r) => r.id), [1, 3]);
      assert.deepEqual(selectRuns(page, { event: 'schedule' }).map((r) => r.id), [2, 3]);
      assert.deepEqual(selectRuns(page, { event: 'schedule', status: 'success' }).map((r) => r.id), [2]);
      assert.deepEqual(selectRuns(page, {}).map((r) => r.id), [1, 2, 3], 'no filter selects the whole page');
    });

    test('🔴 a run that has not CONCLUDED answers no conclusion question, and is not "completed" either', () => {
      // The old reads asked GitHub for `status=success` / `status=failure`, so a
      // run still in flight could never come back. Selecting locally, it can —
      // and a `conclusion: null` counted as either would let a run that has not
      // finished clear a red or start one.
      const page = [
        { id: 9, event: 'schedule', status: 'in_progress', conclusion: null, updated_at: '2026-09-11T11:00:00Z' },
        // ⚠️ `status: completed` WITH `conclusion: null` is a real shape, not an
        // invented one: the API reports it in the window between a run finishing
        // and its conclusion being written. The unit scan below takes the newest
        // completed run and asks its jobs, so a run with no conclusion arriving
        // first would be graded on a job list that is not final.
        { id: 8, event: 'schedule', status: 'completed', conclusion: null, updated_at: '2026-09-11T10:30:00Z' },
        { id: 2, event: 'schedule', status: 'completed', conclusion: 'success', updated_at: '2026-09-11T09:00:00Z' },
      ];
      assert.deepEqual(selectRuns(page, { status: 'success' }).map((r) => r.id), [2]);
      assert.deepEqual(selectRuns(page, { status: 'failure' }).map((r) => r.id), []);
      assert.deepEqual(selectRuns(page, { status: 'completed' }).map((r) => r.id), [2]);
    });

    test('selectRuns skips a run with no updated_at — the field every answer is ordered by', () => {
      assert.deepEqual(selectRuns([{ id: 4, status: 'completed', conclusion: 'success' }], { status: 'success' }), []);
      assert.deepEqual(selectRuns(undefined, { status: 'success' }), []);
    });

    // ── reconcileRunReads: agreement passes, staleness refuses ──────────────
    test('GREEN CONTROL — two reads that agree return that run and never throw', () => {
      assert.equal(reconcileRunReads(FRESH, FRESH, 'what', NOW).id, FRESH.id);
    });

    test('GREEN CONTROL — two reads that both saw no run at all return null', () => {
      assert.equal(reconcileRunReads(null, null, 'what', NOW), null);
    });

    test('🔴 THE MUTATION — a stale narrow page beside a fresh wide one REFUSES', () => {
      // This is the measured defect, fed in as data: per_page=1 answered the
      // 2026-08-22 run, per_page=30 answered that morning's. Before this fix
      // the stale answer was returned and the duty read as 436.7h stale.
      assert.throws(
        () => reconcileRunReads(STALE, FRESH, 'the newest successful schedule run of ops-watch.yml on main', NOW),
        (e) => {
          assert.match(e.message, /disagreed, and the gap is not a race/);
          assert.match(e.message, /32560795997/, 'the stale run must be named or nobody can debug it');
          assert.match(e.message, /34332836726/, 'the fresh run must be named too');
          assert.match(e.message, /NO verdict is available/);
          return true;
        },
      );
    });

    test('🔴 AND THE OTHER DIRECTION — a stale WIDE page refuses just the same', () => {
      // The limb that HIDES a red: a stale failure read makes a broken main
      // grade green. Symmetry is the property, so it is asserted, not assumed.
      assert.throws(() => reconcileRunReads(FRESH, STALE, 'what', NOW), /gap is not a race/);
    });

    test('🔴 a read that saw NOTHING beside one that saw a run is a disagreement too', () => {
      // "No successful run at all" is the strongest possible claim this guard
      // makes; it must never come from the emptier of two disagreeing pages.
      assert.throws(() => reconcileRunReads(null, STALE, 'what', NOW), /per_page=1 answered NO run/);
    });

    test('a run that completed seconds ago IS accepted — a real race is not staleness', () => {
      // The bounded exception. Two concurrent requests can straddle a run
      // finishing; refusing that would red the queue on a normal event.
      const justNow = run(999, new Date(NOW - 5_000).toISOString());
      assert.equal(reconcileRunReads(FRESH, justNow, 'what', NOW).id, 999, 'the newer run wins inside the race window');
    });

    test('🔴 the race window is a BOUNDARY, and just past it refuses', () => {
      // Green control at the edge, then one millisecond over it.
      const atEdge = run(1000, new Date(NOW - RUN_READ_RACE_MS).toISOString());
      assert.equal(reconcileRunReads(FRESH, atEdge, 'what', NOW).id, 1000);
      const overEdge = run(1001, new Date(NOW - RUN_READ_RACE_MS - 1).toISOString());
      assert.throws(() => reconcileRunReads(FRESH, overEdge, 'what', NOW), /gap is not a race/);
    });

    test('the refusal names the question, so a persistent one is debuggable from the print', () => {
      assert.throws(
        () => reconcileRunReads(STALE, FRESH, 'the newest failure run of build-platforms.yml on main', NOW),
        /the newest failure run of build-platforms\.yml on main/,
      );
    });
  });

  describe('recordQuery.headBranch — the schema half', () => {
    // ── the field cannot be dropped, and cannot be put
    //    where nothing would apply it.
    test('🔴 the schema REFUSES a github-run-history row with no headBranch — this is the ratchet', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'github-run-history');
      assert.ok(row, 'no committed row reads run history, so this ratchet would be vacuous');
      delete row.mechanism.recordQuery.headBranch;
      const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
      assert.ok(errs.some((e) => /with no `headBranch`/.test(e)), 'dropping headBranch must fail; got: ' + errs.join(' | '));
    });

    test('the schema refuses headBranch on a reader that reads no run history', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const row = reg.rows.find((r) => {
        const q = r?.mechanism?.recordQuery;
        return q && q.reader !== 'github-run-history' && q.reader !== 'unreachable';
      });
      assert.ok(row, 'no committed row uses another readable reader');
      row.mechanism.recordQuery.headBranch = 'main';
      const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
      assert.ok(errs.some((e) => /which reads no run history/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('EVERY committed run-history row names a branch — the guarantee is total, not sampled', () => {
      const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
      const rows = reg.rows.filter((r) => r?.mechanism?.recordQuery?.reader === 'github-run-history');
      assert.ok(rows.length >= 5, `expected the five workflow rows and Renovate; found ${rows.length}`);
      for (const r of rows) assert.equal(r.mechanism.recordQuery.headBranch, 'main', r.id);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // WORKER CRON PHASE 2 — the two-limb read.
  //
  // The thing being defended is narrow and worth stating: `event: schedule` was
  // carrying TWO claims (the timer fired, the run passed) and Phase 2 separates
  // them. Every test below is a way that separation could be done WRONGLY and
  // still look finished — an event filter dropped with nothing put in its place,
  // a dispatch accepted as a cadence claim, a timer limb so wide that any
  // healthy job vouches for any workflow. Each has a recorded failing case.
  // ───────────────────────────────────────────────────────────────────────────
  describe('assert-ops-register — the TIMER/OUTCOME split, and the ways it could be faked', () => {
    const registerCopy = () => JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const e2eRow = (reg) => reg.rows.find((r) => r.id === 'duty.workflow.e2e.yml');
    const errsOf = (reg) => evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];

    // ── the SCHEMA half: neither limb can be moved without the other ─────────
    test('🔴 dropping the event filter with NO timer limb is REFUSED — this is the whole ratchet', () => {
      const reg = registerCopy();
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.event);
      assert.ok(row, 'no committed row still filters on an event, so this ratchet would be vacuous');
      delete row.mechanism.recordQuery.event;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /no `event` and no `timer` limb/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('🔴 naming workflow_dispatch as the event is REFUSED — a hand-press is not a cadence claim', () => {
      const reg = registerCopy();
      const row = e2eRow(reg);
      row.mechanism.recordQuery.event = 'workflow_dispatch';
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /pressed a button; it is not a cadence claim/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('🔴 a timer limb narrowed by NEITHER job NOR target is REFUSED — any healthy job would vouch', () => {
      const reg = registerCopy();
      const q = e2eRow(reg).mechanism.recordQuery;
      delete q.timer.job;
      delete q.timer.target;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /narrows by neither `job` nor `target`/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb reading anything but the D1 heartbeat is refused — only a timer writes that table', () => {
      const reg = registerCopy();
      e2eRow(reg).mechanism.recordQuery.timer.reader = 'github-run-history';
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /timer\.reader` must be/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb that loses its wrangler anchor is refused — it would go permanently unreadable', () => {
      const reg = registerCopy();
      delete e2eRow(reg).mechanism.recordQuery.timer.wrangler;
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /needs both `table` and `wrangler`/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('a timer limb on a row that reads no run history is refused — there is nothing to split', () => {
      const reg = registerCopy();
      const row = reg.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'cloudflare-d1-heartbeat');
      assert.ok(row, 'no committed row reads the heartbeat directly');
      row.mechanism.recordQuery.timer = { reader: 'cloudflare-d1-heartbeat', table: 'cron_heartbeat', wrangler: 'x', job: 'j' };
      const errs = errsOf(reg);
      assert.ok(errs.some((e) => /has nothing to split/.test(e)), 'got: ' + errs.join(' | '));
    });

    test('the committed e2e row IS on the split, narrowed to the dispatcher and to its own workflow', () => {
      const q = e2eRow(registerCopy()).mechanism.recordQuery;
      assert.equal(q.event, undefined, 'the event filter must be gone, or the timer limb is decoration');
      assert.equal(q.headBranch, 'main', 'the branch guarantee rode on the event filter and must now be explicit');
      assert.equal(q.timer.reader, 'cloudflare-d1-heartbeat');
      assert.equal(q.timer.job, 'github_dispatch');
      // 🔴 DERIVED FROM THE WORKER, NOT TYPED OUT. The first version of this
      // assertion read `'e2e.yml'` — a hand-written expectation checked against a
      // hand-written register, i.e. two copies of one belief. The Worker actually
      // writes `${repo}/${workflow}`, so the row it was "confirming" matched ZERO
      // heartbeat rows and the duty would have gone red the moment `firstDue`
      // expired. An expectation that does not come from the producer cannot fail
      // when the producer is what you got wrong.
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const { targets } = dispatchTargetsFromSource(src);
      assert.ok(targets.includes(q.timer.target), `the dispatcher writes ${targets.join(', ')}; the row declares ${q.timer.target}`);
      assert.match(q.timer.target, /e2e\.yml$/, 'a timer row for ANOTHER workflow would prove nothing about this one');
    });

    // ── the guard that would have caught the above, negative-tested ──────────
    test('🔴 a target the dispatcher does NOT write is REFUSED — the bug that shipped', () => {
      const reg = registerCopy();
      e2eRow(reg).mechanism.recordQuery.timer.target = 'e2e.yml'; // the shipped mistake, verbatim
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const probs = checkTimerTargetsAgainstDispatcher(reg, src);
      assert.equal(probs.length, 1, 'exactly the e2e row should fail; got: ' + probs.join(' | '));
      assert.match(probs[0], /is not a target the dispatcher writes/);
      assert.match(probs[0], /EXACT equality/, 'the message must say WHY a near-miss is silent, or the next reader repeats it');
    });

    test('the committed build-platforms row is on the split too, with its own qualified target', () => {
      const reg = registerCopy();
      const q = reg.rows.find((r) => r.id === 'duty.workflow.build-platforms.yml').mechanism.recordQuery;
      assert.equal(q.event, undefined);
      assert.equal(q.headBranch, 'main');
      assert.equal(q.timer.job, 'github_dispatch');
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      assert.ok(dispatchTargetsFromSource(src).targets.includes(q.timer.target));
    });

    // ── the ceiling that went stale the day after it was written ────────────
    describe('_maxUnreadable is DERIVED, and the derivation is enforced', () => {
      test('the committed ceiling equals the derivation', () => {
        const reg = registerCopy();
        assert.equal(reg._recordReaders._maxUnreadable, deriveUnreadableCeiling(reg).ceiling);
      });

      test('🔴 a ceiling ABOVE the derivation FAILS — that is the weakening direction', () => {
        const reg = registerCopy();
        reg._recordReaders._maxUnreadable = deriveUnreadableCeiling(reg).ceiling + 1;
        const errs = evaluateRunRecords(reg, new Map(), Date.now()).errors ?? [];
        assert.ok(errs.some((e) => /ABOVE the register/.test(e)), 'got: ' + errs.join(' | '));
      });

      test('a ceiling BELOW it PRINTS and does not block — stricter is legal, silent staleness is not', () => {
        const reg = registerCopy();
        reg._recordReaders._maxUnreadable = 0;
        const out = evaluateRunRecords(reg, new Map(), Date.now());
        assert.ok(!(out.errors ?? []).some((e) => /_maxUnreadable/.test(e)), 'stricter must not fail the build');
        assert.ok((out.prints ?? []).some((p) => /NO LONGER HOLDS/.test(p)), 'but it must SAY so');
      });

      test('🔴 a timer limb counts against BOTH providers — under-counting is what staled it', () => {
        const reg = registerCopy();
        const before = deriveUnreadableCeiling(reg);
        const cf = before.perProvider.find(([p]) => p === 'cloudflare')[1];
        // Strip the timer limbs and Cloudflare must lose exactly those rows.
        for (const r of reg.rows) {
          const q = r?.mechanism?.recordQuery;
          if (q?.timer) delete q.timer;
        }
        const after = deriveUnreadableCeiling(reg);
        const cfAfter = (after.perProvider.find(([p]) => p === 'cloudflare') ?? ['cloudflare', 0])[1];
        assert.ok(cfAfter < cf, `timer limbs must contribute to the cloudflare count; ${cf} -> ${cfAfter}`);
      });

      test('GitHub is excluded on purpose — its rows are MEANT to break the ceiling together', () => {
        const reg = registerCopy();
        assert.ok(
          !deriveUnreadableCeiling(reg).perProvider.some(([p]) => p === 'github'),
          'counting GitHub would let a lost GITHUB_TOKEN raise the ceiling instead of failing the build',
        );
      });

      // 🔴 THE PROVIDER IS ASKED FOR, NEVER NAMED. This case used to clone
      // `duty.workflow.e2e.yml` — a Cloudflare-backed row — and assert the
      // ceiling rose by one. That holds only while CLOUDFLARE is the provider
      // the ceiling is derived from, which was a hidden premise about the
      // register's contents and not a property of the rule under test. On
      // 2026-09-06 five `glitchtip-heartbeat` rows for the auth box's crons took
      // glitchtip from 3 to 8; cloudflare stayed at 3, cloning a cloudflare row
      // moved nothing, and the case failed `9 !== 10` against a register that
      // was entirely correct. The rule is `worst non-github provider + 1`, so
      // the subject is whichever provider is worst RIGHT NOW: `perProvider[0]`
      // is the derivation's own answer to that. The row to clone is then found
      // by re-running the derivation per candidate rather than by consulting a
      // reader→provider table this file would have to keep in sync with the
      // guard — the same reason the dispatcher cases above read `scheduled.ts`.
      test('adding a row for the LARGEST provider RAISES the derivation — the coupling is real', () => {
        const base = deriveUnreadableCeiling(registerCopy());
        assert.ok(
          base.perProvider.length > 0,
          'COVERAGE LOST — no non-GitHub provider is counted at all, so no clone below could raise anything.',
        );
        const [top, topCount] = base.perProvider[0];

        // A row could in principle contribute to one provider twice, which would
        // raise the ceiling by two, so the candidate is chosen by MEASURING its
        // effect rather than by reading its shape.
        let after = null;
        let clonedFrom = null;
        for (const row of registerCopy().rows ?? []) {
          const reg = registerCopy();
          reg.rows.push({ ...JSON.parse(JSON.stringify(row)), id: 'duty.invented.ceiling-probe' });
          const d = deriveUnreadableCeiling(reg);
          if ((d.perProvider.find(([p]) => p === top) ?? [top, 0])[1] === topCount + 1) {
            after = d;
            clonedFrom = row.id;
            break;
          }
        }
        assert.ok(
          clonedFrom,
          `COVERAGE LOST — no row adds exactly one to \`${top}\`, the provider this ceiling is derived from, ` +
            'so this case would range over nothing and pass.',
        );
        assert.equal(
          after.ceiling,
          base.ceiling + 1,
          `cloning ${clonedFrom} took ${top} from ${topCount} to ${topCount + 1}; the ceiling must follow it`,
        );
      });
    });

    test('the committed register AGREES with the dispatcher — the bijection, not a spot check', () => {
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      assert.deepEqual(checkTimerTargetsAgainstDispatcher(registerCopy(), src), []);
    });

    test('a dispatcher whose target TEMPLATE changed is COVERAGE LOST, not a silent pass', () => {
      const r = dispatchTargetsFromSource('const target = `${t.workflow}`;\nGITHUB_DISPATCH_TARGETS = [\n];');
      assert.ok(r.error, 'a template this guard cannot reproduce must be an error');
      assert.match(r.error, /does not know how to reproduce/);
    });

    test('a dispatcher with ZERO parsed targets is an error — an empty set would pass vacuously', () => {
      const r = dispatchTargetsFromSource('const target = `${t.repo}/${t.workflow}`;\nexport const GITHUB_DISPATCH_TARGETS: X = [\n];');
      assert.ok(r.error);
      assert.match(r.error, /ZERO entries/);
    });

    test('the targets are read from the source, and COMMENTED-OUT ones do not count', () => {
      const src = readFileSync(resolve(CI_DIR, '..', '..', 'services', 'platform', 'src', 'scheduled.ts'), 'utf8');
      const { targets, error } = dispatchTargetsFromSource(src);
      assert.equal(error, undefined);
      assert.ok(targets.length >= 3, `expected renovate, ops-watch and e2e at least; got ${targets.join(', ')}`);
      for (const t of targets) assert.match(t, /^[\w-]+\/[\w.-]+\.yml$/, `target ${t} is not repo/workflow shaped`);
    });

    // ── the VERDICT half: pure, so every branch is reachable with no network ──
    const ok = (ms, detail = 'd') => ({ lastSuccessMs: ms, detail });
    const T0 = Date.parse('2026-09-04T00:00:00Z');

    test('the duty is only as fresh as its STALER limb, and the answer says which', () => {
      const staleTimer = combineLimbProbes(ok(T0), ok(T0 - 40 * 3_600_000));
      assert.equal(staleTimer.lastSuccessMs, T0 - 40 * 3_600_000);
      assert.match(staleTimer.detail, /STALER limb is the TIMER/);
      const staleOutcome = combineLimbProbes(ok(T0 - 40 * 3_600_000), ok(T0));
      assert.equal(staleOutcome.lastSuccessMs, T0 - 40 * 3_600_000);
      assert.match(staleOutcome.detail, /STALER limb is the OUTCOME/);
    });

    test('🔴 A HEALTHY OUTCOME CANNOT CARRY A DEAD TIMER — the failure this split exists to catch', () => {
      // Before Phase 2 this state was unrepresentable: one query answered both.
      // A workflow going green on hand-presses while its cron is dead is exactly
      // what "counting manual runs let a never-firing cron look healthy" means.
      const r = combineLimbProbes(ok(T0), ok(T0 - 200 * 3_600_000));
      assert.equal(r.lastSuccessMs, T0 - 200 * 3_600_000, 'the dead timer must win, not be averaged away');
    });

    test('an unreadable limb is UNREADABLE, names which one, and never reads as fresh', () => {
      const t = combineLimbProbes(ok(T0), { unreadable: true, why: 'no CF token' });
      assert.ok(t.unreadable);
      assert.match(t.why, /timer limb/);
      assert.match(t.why, /no CF token/);
      const o = combineLimbProbes({ unreadable: true, why: 'no GH token' }, ok(T0));
      assert.ok(o.unreadable);
      assert.match(o.why, /outcome limb/);
      assert.equal(t.lastSuccessMs, undefined, 'an unreadable answer must carry no timestamp at all');
    });

    test('a missing mechanism outranks a fresh sibling — a query that answered "it is gone" is not a pass', () => {
      const r = combineLimbProbes(ok(T0), { missing: true, why: 'the table is gone' });
      assert.ok(r.missing);
      assert.match(r.why, /timer limb/);
    });

    test('unreadable outranks missing — "I could not tell" must never be reported as "it is gone"', () => {
      const r = combineLimbProbes({ missing: true, why: 'gone' }, { unreadable: true, why: 'no token' });
      assert.ok(r.unreadable, 'a dark reader beside a missing one must not be reported as a definite absence');
    });

    test('🔴 AN EMPTY TIMER RECORD PROPAGATES AS BOOTSTRAP, not as the outcome\'s healthy timestamp', () => {
      // This is the case on the very first run after the row is repointed: the
      // workflow has years of green runs and the dispatcher has written nothing
      // yet. Reporting the OUTCOME's timestamp would hide the gap completely.
      const r = combineLimbProbes(ok(T0), { lastSuccessMs: NaN, detail: 'no row.' });
      assert.ok(Number.isNaN(r.lastSuccessMs));
      assert.match(r.detail, /TIMER/);
      assert.match(r.detail, /OUTCOME/, 'both limbs must be named, or a reader cannot tell which one is empty');
    });

    test('a limb that produced no result at all is unreadable, not a silent pass', () => {
      assert.ok(combineLimbProbes(ok(T0), undefined).unreadable);
      assert.ok(combineLimbProbes(undefined, ok(T0)).unreadable);
    });

    test('describeNarrowing names both halves, so a stale line says WHICH claim went stale', () => {
      assert.equal(describeNarrowing({ job: 'github_dispatch', target: 'e2e.yml' }), 'job `github_dispatch` + target `e2e.yml`');
      assert.equal(describeNarrowing({ job: 'j' }), 'job `j`');
    });
  });

  test('every reader the committed register DECLARES is one the guard actually dispatches', () => {
    // The schema check next door proves a row cannot name an undeclared reader.
    // Nothing proved the other direction: a reader could be declared, used by a
    // row, and never dispatched by `probeRunRecords` — in which case the row
    // gets no probe at all and silently degrades to `unreadable`, which prints.
    // That is how this limb would go quiet without the number moving.
    const declared = Object.keys(realRegister()._recordReaders).filter((k) => !k.startsWith('_'));
    const src = readFileSync(resolve(CI_DIR, 'assert-ops-register.mjs'), 'utf8');
    for (const name of declared) {
      if (name === 'unreachable') continue; // by declaration, dispatched by nobody
      assert.ok(
        src.includes(`q.reader === '${name}'`),
        `\`${name}\` is declared in _recordReaders and no branch of probeRunRecords dispatches it, so every row using it would go unreadable`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 [14]O-3b · RED SINCE — the limb that grades a FAILED run.
//
// WHAT THIS SUITE IS ABOUT, and it is a measured defect rather than a worry.
// `probeGithubRun` asks GitHub for `status=success`, so until 2026-09-07 a
// failed run did not merely get ignored by the verdict logic — IT NEVER
// ARRIVED. The only thing that could notice `main` going red was the staleness
// window expiring: `duty.workflow.build-platforms.yml` is `7d` against a
// `7d x 1.5 = 252h` window, i.e. a failure was invisible for up to ten and a
// half days, and then surfaced as "the newest SUCCESSFUL run is old", which
// reads like a quiet week. TRAPS `ci-38`. It bit this repository for three days
// in the week of 2026-09-01.
//
// EVERY CASE BELOW IS DRIVEN THROUGH THE PURE FUNCTIONS, so each branch is
// reachable with no network and no red branch on the real repository — the
// same rule the [14]O-3 suite above states: a limb whose only evidence is "it
// was green against production today" has no recorded failing case, and this
// file's standard is that an assertion which cannot fail is worse than none.
// The GREEN CONTROL IS FIRST in each pair, so every red below is proven to fail
// for its own reason rather than for a defect inherited from the fixture.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — [14]O-3b · RED SINCE: a failed run is graded, not merely a missing successful one', () => {
  const OK_OLD = { id: 111, at: '2026-09-05T00:00:00Z' };
  const OK_NEW = { id: 222, at: '2026-09-07T12:00:00Z' };
  const BAD = { id: 333, at: '2026-09-06T06:00:00Z' };

  const wfDuty = (id, over = {}) => ({
    id,
    kind: 'duty',
    what: 'a nightly scheduled workflow',
    detector: 'its own alert job',
    response: 'read the issue it files',
    cadence: '1d',
    mechanism: {
      substrate: 'github-actions',
      anchor: 'renovate.json',
      record: 'GitHub Actions run history',
      failingValue: 'conclusion = failure',
      readBy: 'this guard',
      recordQuery: { reader: 'github-run-history', workflow: 'nightly.yml', event: 'schedule', headBranch: 'main' },
    },
    ...over,
  });
  const regOf = (...rows) => ({ rows });
  const probesOf = (o) => new Map(Object.entries(o));
  const ID = 'duty.workflow.nightly';

  // ── the two green controls, first ─────────────────────────────────────────
  test('GREEN CONTROL — the newest success is newer than the newest failure: no error, and the pair is COUNTED', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { success: OK_NEW, failure: BAD } }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.coverageLost, undefined);
    assert.equal(r.stats.green, 1);
    assert.equal(r.stats.red, 0);
    assert.equal(r.stats.domain, 1);
    assert.ok(r.prints.some((p) => /RED SINCE: 1 workflow duty\(ies\) graded \(1 on a clock · 0 `trigger` row\(s\)[^·]*\) · 1 whose newest run/.test(p)));
  });

  test('GREEN CONTROL — a workflow that has never failed at all is green, and says so rather than saying nothing', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { success: OK_NEW, failure: null } }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.green, 1);
    assert.ok(r.prints.some((p) => /no FAILED run in its history at all/.test(p)));
  });

  // ── the mutation this limb exists for ─────────────────────────────────────
  test('🔴 MUTATION — a failure NEWER than the last success is RED SINCE, it BLOCKS, and it names the workflow', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { success: OK_OLD, failure: BAD } }));
    assert.equal(r.errors.length, 1, `the red went somewhere other than errors:\n${JSON.stringify(r, null, 1)}`);
    assert.match(r.errors[0], /RED SINCE 2026-09-06T06:00:00Z/);
    assert.match(r.errors[0], /nightly\.yml on main/, 'the finding must name the workflow and the branch, or nobody can act on it');
    assert.match(r.errors[0], /run 333 FAILED/);
    assert.match(r.errors[0], /run 111 at 2026-09-05T00:00:00Z/, 'and the success it is being compared against');
    assert.equal(r.stats.red, 1);
    assert.equal(r.stats.green, 0);
    assert.equal(r.coverageLost, undefined, 'a red branch is a FAILING duty, not coverage lost');
  });

  test('the RED line states the elapsed hours and the remedy — a finding nobody can clear is one somebody deletes', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { success: OK_OLD, failure: BAD } }));
    assert.match(r.errors[0], /30\.0h EARLIER/);
    assert.match(r.errors[0], /A success of ANY event on that branch clears it/);
  });

  test('one hour is enough — the comparison is an ORDERING, not a window, and it has no grace of its own', () => {
    // The staleness limb has 1.5x its cadence, deliberately, because one late
    // run is not an alarm. A FAILED run is not a late run: it is the failing
    // value the row itself declares, so there is nothing to be tolerant of.
    const r = evaluateRedSince(
      regOf(wfDuty(ID)),
      probesOf({ [ID]: { success: { id: 1, at: '2026-09-07T10:00:00Z' }, failure: { id: 2, at: '2026-09-07T11:00:00Z' } } }),
    );
    assert.equal(r.stats.red, 1);
  });

  // ── COVERAGE LOST, twice, for two different reasons ───────────────────────
  test('🔴 COVERAGE LOST — failures and NO success ever: the comparison has one term, and that is not a pass', () => {
    // ⏱ 2026-09-11 — a LIVE verdict at exit 2, routed like every other live
    // verdict, rather than a separate return that stopped the guard in every host:
    // a first-ever failed run on a self-gated lane was a freeze of its own.
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { success: null, failure: BAD } }));
    assert.equal(r.coverageLost, undefined, 'the empty-domain refusal is the only structural return left in this limb');
    assert.equal(r.stats.blind, 1);
    assert.equal(r.live.length, 1, 'a limb that could not order its two terms must not return a pass');
    assert.equal(r.live[0].code, 2, 'and where it blocks it is COVERAGE LOST, exit 2 — not a RED');
    assert.match(r.live[0].line, /HAS NO SECOND TERM/);
    assert.match(r.live[0].line, /nightly\.yml on main/);
    assert.match(r.live[0].line, /the sibling \[14\]O-3 limb still grades/, 'and it must say the duty is still watched, or the next reader deletes the wrong thing');
    assert.ok(r.errors.includes(r.live[0].line));
  });

  test('🔴 COVERAGE LOST — an EMPTY domain, which is the one way this limb could be disabled without deleting it', () => {
    // Moving every workflow duty to `trigger`, to `on-demand`, to `unreachable`
    // or off `github-run-history` would leave this function ranging over nothing
    // and printing a serene `0 RED`. That is the [14]O-3 defect one limb over.
    const trig = wfDuty(ID, { cadence: 'trigger', trigger: 'every push' });
    delete trig.mechanism.recordQuery;
    const r = evaluateRedSince(regOf(trig), new Map());
    assert.ok(r.coverageLost);
    assert.match(r.coverageLost.join(' '), /ranges over the EMPTY SET/);
    assert.match(r.coverageLost.join(' '), /ci-38/);
  });

  // ── "could not tell" is never "it is fine" ────────────────────────────────
  test('an unreadable read PRINTS and does not block — and the ZERO PAIRS line makes that state unmistakable', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), probesOf({ [ID]: { unreadable: true, why: 'no token here' } }));
    assert.deepEqual(r.errors, []);
    assert.equal(r.coverageLost, undefined);
    assert.equal(r.stats.unreadable, 1);
    assert.ok(r.prints.some((p) => /ORDERED ZERO PAIRS ON THIS RUN/.test(p)), 'zero-of-zero must not read like a green branch');
  });

  test('a MISSING probe is unreadable too, never a pass — the shape a row added after the probe loop takes', () => {
    const r = evaluateRedSince(regOf(wfDuty(ID)), new Map());
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.unreadable, 1);
  });

  test('a timestamp that does not parse is UNREADABLE, not green and not red — refusing to read is not reading a pass', () => {
    const c = classifyRedSince(wfDuty(ID), { success: { id: 1, at: 'not-a-date' }, failure: BAD });
    assert.equal(c.verdict, 'unreadable');
    assert.match(c.line, /does not parse/);
  });

  // ── the domain is derived, and both exclusions are deliberate ─────────────
  test('the domain is exactly the SCHEDULED WORKFLOW PROOFS — derived from the register, never listed', () => {
    const rows = [
      wfDuty('duty.workflow.nightly'),
      // `trigger` rows are excluded ON PURPOSE and the reason is a deadlock, not
      // taste: `ci.yml`'s newest run on `main` can be made green only BY
      // MERGING, so blocking merges on it would have no exit at all.
      wfDuty('duty.workflow.ci.yml', { cadence: 'trigger', trigger: 'every push' }),
      // A row that reads a workflow's run history but is not a `duty.workflow.*`
      // row is excluded because it would double-report the SAME workflow: this
      // register carries two such rows against ops-watch.yml, and three findings
      // naming one red workflow is how a real alarm gets skimmed past.
      wfDuty('duty.analytics-silence-judgment'),
    ];
    delete rows[1].mechanism.recordQuery;
    const d = redSinceDomain({ rows });
    assert.deepEqual(d.map((r) => r.id), ['duty.workflow.nightly']);
  });

  test('a `duty.workflow.*` row that loses its headBranch leaves the domain — and an EMPTY domain is caught above', () => {
    // Not a hole: [14]O-3's own schema limb already REFUSES a github-run-history
    // read with no `headBranch`, so this row cannot reach a green build. What is
    // asserted here is that the redness domain does not silently include a row
    // whose branch it would have to guess.
    const row = wfDuty(ID);
    delete row.mechanism.recordQuery.headBranch;
    assert.deepEqual(redSinceDomain({ rows: [row] }), []);
  });

  test('the committed register puts EVERY scheduled workflow proof in this domain — the bijection, restated where it bites', () => {
    // The real negative test is the tree: if a workflow duty is moved off this
    // reader, this assertion is what goes red rather than the alarm quietly
    // shrinking. Read from the committed file, never from a copy.
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const inDomain = redSinceDomain(real).map((r) => r.id).sort();
    const scheduledWorkflowRows = real.rows
      .filter((r) => String(r.id).startsWith('duty.workflow.') && /^\d+[hd]$/.test(String(r.cadence ?? '')))
      .map((r) => r.id)
      .sort();
    assert.ok(inDomain.length > 0, 'the committed register grades no workflow for redness at all');
    assert.deepEqual(inDomain, scheduledWorkflowRows, 'a scheduled workflow duty has fallen out of the RED-SINCE domain');
    // ⏱ 2026-09-09 — and with NO derivation handed in, that is the WHOLE domain:
    // the trigger half fails closed. A caller with no workflow tree admits no
    // clockless row, because admission to a BLOCKING alarm is on evidence that
    // the red has an exit, never on a default.
    assert.equal(
      inDomain.some((id) => /deploy-(web|workers)/.test(id)),
      false,
      'a trigger row was admitted with no `workflow_dispatch` evidence supplied — the fail-closed direction has been inverted',
    );
  });

  // -- THE SECOND SELF-REFERENCE: ops-watch.yml GRADING ITS OWN HOST RUN ------
  //
  // Added 2026-09-08 as a `SELF` skip inside evaluateRedSince: ops-watch.yml runs
  // this guard, so its own row read the conclusion of the run it executed inside,
  // and one red run re-failed every run after it. TRAPS `ci-42`/`ci-43`: A RUN'S
  // OWN CONCLUSION MAY NOT BE AN INPUT TO THE GRADE THAT PRODUCES IT.
  //
  // ⏱ 2026-09-11 — THE SKIP COVERED ONE LIMB, AND THE OTHER ONE FROZE `main`. The
  // freshness limb still read the same whole-run conclusion, and run 34546423386
  // listed `duty.workflow.ops-watch.yml` as STALE inside ops-watch itself. The
  // rule is now INV4, in two halves: the register may not give a row a unit that
  // contains the guard (`checkRunUnits`), and if one ever slips past, the router
  // prints that verdict in its own host with an OWN HOST path (`routeLiveVerdicts`).
  // The pair (a)/(b) is still the proof that nothing was weakened.
  const OPS = 'duty.workflow.ops-watch.yml';
  const OWN_TOPO = () => ({
    selfGated: new Set(['build-platforms.yml']),
    guardHosts: new Set(['ci.yml', 'ops-watch.yml']),
    gateName: 'ci-gate',
    gateWorkflow: 'ci.yml',
    why: [],
  });
  const parsedRepo = () => {
    const all = parseAllWorkflows(resolve(CI_DIR, '..', '..'));
    return { all, byFile: new Map(all.map((wf) => [String(wf.rel).split('/').pop(), wf])) };
  };
  const opsRowWith = (unit) => {
    const r = wfDuty(OPS);
    r.mechanism.recordQuery.workflow = 'ops-watch.yml';
    r.mechanism.recordQuery.unit = unit;
    return r;
  };
  const envOf = (file, event, ref = 'refs/heads/main') => ({
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '34546423386',
    GITHUB_EVENT_NAME: event,
    GITHUB_WORKFLOW: file,
    GITHUB_REF: ref,
    GITHUB_WORKFLOW_REF: `o/r/.github/workflows/${file}@${ref}`,
  });
  const policyIn = (file, event, ref) => hostPolicy(envOf(file, event, ref), OWN_TOPO(), workflowEventsByFile(parsedRepo().all));
  const RED_OPS = () => [{ id: OPS, line: `${OPS} — RED SINCE 2026-09-06T06:00:00Z: ops-watch.yml on main run 333 FAILED`, code: 1 }];

  test('(a) OWN HOST - a red row whose unit CONTAINS the guard never blocks its own host, and PRINTS the path by name', () => {
    const r = routeLiveVerdicts(RED_OPS(), policyIn('ops-watch.yml', 'schedule'), OWN_TOPO(), regOf(opsRowWith('run')), parsedRepo().byFile);
    assert.deepEqual(r.blocking, [], 'a verdict whose recovery needs its own host green must not be able to fail that host');
    assert.equal(r.printed.length, 1, 'and it must be PRINTED, never dropped — a deferral that is silent is a shrink');
    assert.match(r.printed[0].line, /ops-watch\.yml on main run 333 FAILED/, 'the verdict itself is unchanged');
    assert.match(r.printed[0].why, /OWN HOST/);
    assert.match(r.printed[0].why, /the whole run includes job heartbeats, which runs tooling\/ci\/assert-ops-register\.mjs/);
    assert.match(r.printed[0].why, /INV4/);
  });

  test('(b) MUTATION CONTROL - the SAME red row still BLOCKS from ci.yml on push, and off Actions', () => {
    const reg = regOf(opsRowWith('run'));
    const push = routeLiveVerdicts(RED_OPS(), policyIn('ci.yml', 'push'), OWN_TOPO(), reg, parsedRepo().byFile);
    assert.equal(push.blocking.length, 1, 'ci.yml on push MUST still block on a red ops-watch - that is the whole reason the deferral is safe');
    assert.equal(push.printed.length, 0);
    const off = routeLiveVerdicts(RED_OPS(), hostPolicy({}, OWN_TOPO(), new Map()), OWN_TOPO(), reg, parsedRepo().byFile);
    assert.equal(off.blocking.length, 1, 'off Actions no host resolves, so nothing is exempt');
  });

  // ⏱ 2026-09-18 · O-LAPTOP-ROUTINES-DIE-OVERNIGHT — PAGE-ONLY rows (owner decision).
  const DRIVER = 'duty.laptop.nikatru-pipeline-driver';
  const WHY = 'laptop-bound work: writes the remote-less Private repo, so a closed lid pages but must not freeze deploys';
  const laptopRow = (scope) => ({ id: DRIVER, kind: 'duty', cadence: '1d', ...(scope === undefined ? {} : { liveVerdictScope: scope }) });
  const PAGE_ONLY = () => ({ blocks: 'page-only', page: 'ops-watch.yml', why: WHY });
  const RED_DRIVER = () => [{ id: DRIVER, line: `${DRIVER} — no heartbeat for 9.4 h`, code: 1 }];

  test('PAGE-ONLY - a red laptop verdict PRINTS on main\'s ci.yml push, and still BLOCKS in the page (ops-watch)', () => {
    const reg = regOf(laptopRow(PAGE_ONLY()));
    const push = routeLiveVerdicts(RED_DRIVER(), policyIn('ci.yml', 'push'), OWN_TOPO(), reg, parsedRepo().byFile);
    assert.deepEqual(push.blocking, [], 'the deploy gate must not freeze on a closed laptop lid');
    assert.equal(push.printed.length, 1, 'and it is PRINTED, never dropped');
    assert.match(push.printed[0].why, /PAGE-ONLY/);
    const page = routeLiveVerdicts(RED_DRIVER(), policyIn('ops-watch.yml', 'schedule'), OWN_TOPO(), reg, parsedRepo().byFile);
    assert.equal(page.blocking.length, 1, 'the page still goes red - the miss is not hidden');
  });

  test('PAGE-ONLY MUTATION CONTROL - the SAME red row WITHOUT the scope still blocks main\'s ci.yml push', () => {
    const push = routeLiveVerdicts(RED_DRIVER(), policyIn('ci.yml', 'push'), OWN_TOPO(), regOf(laptopRow()), parsedRepo().byFile);
    assert.equal(push.blocking.length, 1);
  });

  test('PAGE-ONLY is refused STRUCTURALLY off duty.laptop.*, with another scope, a page that never runs the guard, or no reason', () => {
    const topo = OWN_TOPO();
    const ok = checkLiveVerdictScopes(regOf(laptopRow(PAGE_ONLY())), topo);
    assert.deepEqual(ok.errors, []);
    assert.match(ok.prints[0], /PAGE-ONLY · duty\.laptop\.nikatru-pipeline-driver/);
    const notLaptop = checkLiveVerdictScopes(regOf({ ...laptopRow(PAGE_ONLY()), id: 'duty.workflow.ci.yml' }), topo);
    assert.match(notLaptop.errors[0] ?? '', /not a duty\.laptop\.\* row/);
    const wrongScope = checkLiveVerdictScopes(regOf(laptopRow({ ...PAGE_ONLY(), blocks: 'nowhere' })), topo);
    assert.match(wrongScope.errors[0] ?? '', /the only scope is "page-only"/);
    const deadPage = checkLiveVerdictScopes(regOf(laptopRow({ ...PAGE_ONLY(), page: 'deploy-web.yml' })), topo);
    assert.match(deadPage.errors[0] ?? '', /block NOWHERE/);
    const noWhy = checkLiveVerdictScopes(regOf(laptopRow({ ...PAGE_ONLY(), why: 'because' })), topo);
    assert.match(noWhy.errors[0] ?? '', /must say why/);
  });

  // ⏱ 2026-09-18 (later) — PIN MOVED DELIBERATELY from [DRIVER] to the three laptop
  // routines. #802 moved the PORTABLE half of nikatru-ops-check and nikatru-watchdog
  // onto the platform Worker cron (duty.platform-ops-watchdog-beat, GlitchTip monitor
  // 40); the owner chose that what stays on the laptop (backup-task poll, Drive-bundle
  // tags, dirty local trees, corpus live-assert) pages and does not block deploys.
  // The set is pinned EXACTLY, so a fourth scoped row, or one of these losing its
  // scope, is a deliberate edit here and never a silent drift.
  const LAPTOP_PAGE_ONLY = ['duty.laptop.nikatru-ops-check', 'duty.laptop.nikatru-watchdog', DRIVER];
  test('PAGE-ONLY - the committed register scopes exactly the three laptop routines, and it holds', () => {
    const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const scoped = reg.rows.filter((r) => r.liveVerdictScope !== undefined).map((r) => r.id);
    assert.deepEqual(scoped, LAPTOP_PAGE_ONLY);
    assert.deepEqual(checkLiveVerdictScopes(reg, OWN_TOPO()).errors, []);
    const byId = new Map(reg.rows.map((r) => [r.id, r]));
    for (const id of LAPTOP_PAGE_ONLY) assert.equal(byId.get(id).liveVerdictScope.page, 'ops-watch.yml', `${id} pages in ops-watch.yml`);
    for (const id of LAPTOP_PAGE_ONLY.slice(0, 2)) assert.match(byId.get(id).liveVerdictScope.why, /#802/, `${id} must say its portable half moved to the Worker`);
  });

  // ⏱ 2026-09-18 — the Worker half of the watchdog is its OWN watched duty, shaped
  // exactly like duty.platform-cron-beat (the model), reading monitor 40.
  test('the Worker ops watchdog beat is a watched duty shaped like duty.platform-cron-beat, on monitor 40', () => {
    const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const byId = new Map(reg.rows.map((r) => [r.id, r]));
    const model = byId.get('duty.platform-cron-beat');
    const beat = byId.get('duty.platform-ops-watchdog-beat');
    assert.ok(beat, 'duty.platform-ops-watchdog-beat must exist');
    assert.deepEqual(Object.keys(beat), Object.keys(model));
    assert.deepEqual(Object.keys(beat.mechanism), Object.keys(model.mechanism));
    assert.deepEqual(Object.keys(beat.mechanism.recordQuery), Object.keys(model.mechanism.recordQuery));
    assert.equal(beat.kind, 'duty');
    assert.equal(beat.cadence, '6h');
    assert.equal(beat.mechanism.substrate, model.mechanism.substrate);
    assert.equal(beat.mechanism.anchor, 'services/platform/src/ops-watchdog.ts');
    assert.equal(beat.mechanism.recordQuery.reader, 'glitchtip-heartbeat');
    assert.equal(beat.mechanism.recordQuery.monitor, 40);
    assert.equal(beat.absenceWatcher.substrate, 'glitchtip-heartbeat');
    const chains = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'alarm-chains.json'), 'utf8'));
    assert.ok(chains.expectedMonitors.some((m) => m.id === 40), 'monitor 40 must be declared in alarm-chains.json expectedMonitors');
  });

  // ⏱ 2026-09-20 — THE THIRD BACKUP COPY IS A WATCHED DUTY. It shipped the same day with no alarm
  // at all: /opt/backup/06-oci-third-copy.sh wrote a status file and nothing read it. This is the
  // reader that makes the row an obligation rather than a paragraph — it is shaped off
  // duty.restic-snapshot (the leg it copies) key for key, so a row that drifts out of that shape,
  // loses its monitor, or loses its declaration in the alarm ledger is RED here.
  //
  // 🔴 IT ASSERTS THE MONITOR ID AND THE LEDGER ENTRY TOGETHER, on purpose. Creating the monitor
  // and declaring it are ONE change: a monitor missing from `expectedMonitors` is invisible to
  // verify-alarm-chains.mjs's canary, which is the same "declared but unwatched" half-state
  // monitor 6 spent nine days in.
  test('the third backup copy is a watched duty shaped like duty.restic-snapshot, on monitor 41', () => {
    const reg = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const byId = new Map(reg.rows.map((r) => [r.id, r]));
    const model = byId.get('duty.restic-snapshot');
    const third = byId.get('duty.restic-third-copy');
    assert.ok(third, 'duty.restic-third-copy must exist');
    assert.deepEqual(Object.keys(third), Object.keys(model));
    assert.deepEqual(Object.keys(third.mechanism), Object.keys(model.mechanism));
    assert.deepEqual(Object.keys(third.mechanism.recordQuery), Object.keys(model.mechanism.recordQuery));
    assert.equal(third.kind, 'duty');
    assert.equal(third.cadence, '1d');
    // the same crontab as the leg it copies — a substrate names a ROLE, never a box
    assert.equal(third.mechanism.substrate, model.mechanism.substrate);
    assert.equal(third.mechanism.recordQuery.reader, 'glitchtip-heartbeat');
    assert.equal(third.mechanism.recordQuery.monitor, 41);
    assert.equal(third.absenceWatcher.substrate, 'glitchtip-heartbeat');
    // a DECLARED watcher is not a proven one: this row carries a forced, dated transition
    assert.equal(third.absenceWatcher.downTransitionDrill.date, '2026-09-20');
    for (const id of ['9PS2DLnF3Kmv', 'vOztqaOIjl0Y']) {
      assert.ok(
        third.absenceWatcher.downTransitionDrill.evidence.includes(id),
        `the drill record must name ntfy message id ${id} — the delivery record, not the word "verified"`,
      );
    }
    assert.ok(reg._requiredCoverage.ids.includes('duty.restic-third-copy'), 'the row must be in _requiredCoverage.ids so it cannot be silently dropped');
    const chains = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'alarm-chains.json'), 'utf8'));
    assert.ok(chains.expectedMonitors.some((m) => m.id === 41), 'monitor 41 must be declared in alarm-chains.json expectedMonitors');
  });

  test('the OWN HOST edge is ONE row, never the domain - a red SIBLING still blocks on the host run', () => {
    const sibling = wfDuty('duty.workflow.extensions.yml');
    sibling.mechanism.recordQuery.workflow = 'extensions.yml';
    sibling.mechanism.recordQuery.unit = 'run';
    const live = [...RED_OPS(), { id: sibling.id, line: `${sibling.id} — RED SINCE 2026-09-06T06:00:00Z: extensions.yml on main`, code: 1 }];
    const r = routeLiveVerdicts(live, policyIn('ops-watch.yml', 'schedule'), OWN_TOPO(), regOf(opsRowWith('run'), sibling), parsedRepo().byFile);
    assert.equal(r.blocking.length, 1, 'the host run still blocks on every workflow whose recovery does not need it');
    assert.match(r.blocking[0].line, /extensions\.yml on main/);
    assert.equal(r.printed.length, 1);
  });

  test('INV4 in the register - `checkRunUnits` REFUSES every unit that contains the guard, and the committed ops-watch rows hold', () => {
    const { byFile } = parsedRepo();
    const topo = gateTopology(resolve(CI_DIR, '..', '..'));
    // ⏱ 2026-09-25 [ADR 095 §4]: a one-row register leaves ci.yml's post-gate call
    // jobs unowned, which is the register-wide INV3 completeness finding, held by
    // its own tests. This case is about the ops-watch unit, so that one is set aside.
    const UNOWNED_POST_GATE = /post-gate job\(s\) .* are the unit of no row\. \[INV3\]/;
    const errsOf = (unit) => checkRunUnits(regOf(opsRowWith(unit)), byFile, topo).errors.filter((e) => !UNOWNED_POST_GATE.test(e));
    assert.ok(checkRunUnits(regOf(opsRowWith('run')), byFile, topo).errors.some((e) => UNOWNED_POST_GATE.test(e)), 'the set-aside finding must still be raised, or this filter hides nothing and should go');
    assert.ok(errsOf('run').some((e) => /the whole run contains this guard's own verdict/.test(e)), errsOf('run').join('\n'));
    assert.ok(errsOf({ jobs: ['heartbeats'] }).some((e) => /job heartbeats runs tooling\/ci\/assert-ops-register\.mjs/.test(e)));
    const guardStep = errsOf({ job: 'heartbeats', step: 'The whole ops register — every duty, not just the heartbeat-backed ones' });
    assert.ok(guardStep.some((e) => /IS the step in job heartbeats that runs/.test(e)), guardStep.join('\n'));
    // ⏱ 2026-09-23 — this case used the COMMITTED heartbeat step as its example of
    // "a step with no !cancelled() after the guard", and that shape was the defect
    // O-OPS-WATCH-HEARTBEAT-READER-SKIPPED (the heartbeat read skipped in every red
    // register run). The step now carries `if: ${{ !cancelled() }}`, so the refusal
    // is held on the committed workflow with that one line removed.
    const HB_STEP = 'Read the heartbeat table from OUTSIDE Cloudflare';
    const wfText = readFileSync(resolve(CI_DIR, '..', '..', '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    const hbIf = new RegExp(`(\\n {6}- name: ${HB_STEP}\\r?\\n) {8}if: \\$\\{\\{ !cancelled\\(\\) \\}\\}\\r?\\n`);
    assert.match(wfText, hbIf, 'the committed heartbeat step must carry `if: ${{ !cancelled() }}` directly under its name');
    const mutantRoot = join(TMP, `hb-if-${seq++}`);
    mkdirSync(join(mutantRoot, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(mutantRoot, '.github', 'workflows', 'ops-watch.yml'), wfText.replace(hbIf, '$1'));
    const mutantByFile = new Map(byFile);
    mutantByFile.set('ops-watch.yml', parseWorkflow(mutantRoot, '.github/workflows/ops-watch.yml'));
    const skipped = checkRunUnits(regOf(opsRowWith({ job: 'heartbeats', step: HB_STEP })), mutantByFile, topo).errors;
    assert.ok(skipped.some((e) => /SKIPPED whenever this guard fails/.test(e)), 'a step with no !cancelled() after the guard is skipped by its failure: ' + skipped.join('\n'));
    assert.deepEqual(errsOf({ job: 'heartbeats', step: HB_STEP }), [], 'the committed heartbeat step runs whatever the guard concluded, so it no longer contains its verdict');
    const alert = errsOf({ jobs: ['alert'] });
    assert.deepEqual(alert, [], 'the alert job needs heartbeats but runs on failure(), so its conclusion does not contain the guard');
    // GREEN CONTROL, the shape the committed register uses.
    assert.deepEqual(errsOf({ job: 'heartbeats', step: "Judge whether the analytics rail's silence is a FAULT" }), []);
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    assert.deepEqual(checkRunUnits(real, byFile, topo).errors, [], 'the committed register must hold every unit rule');
    for (const row of real.rows.filter((x) => x?.mechanism?.recordQuery?.workflow === 'ops-watch.yml')) {
      assert.equal(unitNeedsGuard(byFile.get('ops-watch.yml'), unitOf(row.mechanism.recordQuery)), null, `${row.id}: its unit contains the guard`);
    }
  });

  test('the EMPTY-DOMAIN refusal is untouched - moving every workflow duty off the reader is still COVERAGE LOST', () => {
    const trig = wfDuty(OPS, { cadence: 'trigger', trigger: 'every push' });
    delete trig.mechanism.recordQuery;
    const gone = evaluateRedSince(regOf(trig), new Map());
    assert.ok(gone.coverageLost, 'an empty domain must still refuse');
    assert.match(gone.coverageLost.join(' '), /ranges over the EMPTY SET/);
  });

  test('hostWorkflowFile FAILS CLOSED - it names a FILE or it names nothing, and nothing means grade everything', () => {
    // GITHUB_WORKFLOW is the workflow's `name:` ("Ops watch"), not its file, so
    // the ref is the authoritative read. A name-only environment resolves to
    // null and every row is graded - the deadlock returns loudly rather than a
    // row being deferred on a run that could not prove it was the host.
    assert.equal(
      hostWorkflowFile({ GITHUB_WORKFLOW: 'Ops watch', GITHUB_RUN_ID: '1', GITHUB_WORKFLOW_REF: 'o/r/.github/workflows/ops-watch.yml@refs/heads/main' }),
      'ops-watch.yml',
    );
    assert.equal(hostWorkflowFile({ GITHUB_WORKFLOW: '.github/workflows/ops-watch.yml' }), 'ops-watch.yml', 'an unnamed workflow gets its PATH in GITHUB_WORKFLOW');
    assert.equal(hostWorkflowFile({ GITHUB_WORKFLOW: 'Ops watch', GITHUB_RUN_ID: '1' }), null, 'a name that is not a file must NOT be matched against a workflow file');
    assert.equal(hostWorkflowFile({}), null, 'off GitHub Actions there is no host and nothing is deferred');
    assert.equal(hostWorkflowFile({ GITHUB_WORKFLOW: '' }), null);
  });

  test('the committed ops-watch workflow really does run this guard - the reason the OWN HOST rule exists at all', () => {
    // A prose rule that no guard reads is a rule that rots (TRAPS ci-43). If
    // ops-watch.yml ever stops running this file, the rule is dead code and this
    // is what says so; if it keeps running it, the rule is load-bearing.
    const wf = readFileSync(resolve(CI_DIR, '..', '..', '.github', 'workflows', 'ops-watch.yml'), 'utf8');
    assert.match(wf, /assert-ops-register\.mjs/, 'ops-watch.yml no longer runs this guard - re-read INV4 before trusting it');
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const selfRows = redSinceDomain(real).filter((r) => r.mechanism.recordQuery.workflow === 'ops-watch.yml');
    assert.equal(selfRows.length, 1, 'the committed register must still put ops-watch.yml in this domain, or the rule guards nothing');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ 2026-09-09 · THE TRIGGER ROWS WITH A NON-MERGE EXIT.
  //
  // THE MEASURED DEFECT: run 34315492291, `deploy-web.yml` on `main`, sha
  // 43ab0224, conclusion FAILURE at 2026-09-09T05:35Z. The web deploy lane was
  // red on the default branch and NOTHING alarmed — the row is `cadence:
  // trigger`, the domain above was `TIME_CADENCE` rows only, and the [14]O-3
  // freshness limb does not range over a clockless row either. The exclusion
  // existed for `ci.yml`, whose newest run on main can be made green only BY
  // MERGING; it was being applied to three rows it was never argued for.
  //
  // THE ADMISSION IS DERIVED, and these tests hold that: the evidence is the
  // `workflow_dispatch:` line in the workflow file, read through the shared
  // parser, so a row joins and leaves this alarm on a fact about the tree rather
  // than on a list somebody can shorten. GREEN CONTROL FIRST in each pair.
  // ───────────────────────────────────────────────────────────────────────────
  const REPO_ROOT = resolve(CI_DIR, '..', '..');
  const trigDuty = (id, workflow, over = {}) => ({
    id,
    kind: 'duty',
    what: 'a deploy lane',
    detector: 'a red deploy job on the push that triggered it',
    response: 'redeploy or roll back',
    cadence: 'trigger',
    trigger: 'push to main, or a manual dispatch',
    mechanism: {
      substrate: 'github-actions',
      anchor: `.github/workflows/${workflow}`,
      record: 'GitHub Deployments + the run history',
      failingValue: 'conclusion = failure',
      readBy: 'this guard',
      recordQuery: { reader: 'github-run-history', workflow, headBranch: 'main', event: 'push' },
    },
    ...over,
  });
  const WEB = 'duty.workflow.deploy-web.yml';

  test('GREEN CONTROL — a `trigger` row whose workflow declares `workflow_dispatch` IS in the domain and IS graded green', () => {
    const dispatchable = new Set(['deploy-web.yml']);
    const reg = regOf(trigDuty(WEB, 'deploy-web.yml'));
    assert.deepEqual(redSinceDomain(reg, dispatchable).map((r) => r.id), [WEB]);
    const r = evaluateRedSince(reg, probesOf({ [WEB]: { success: OK_NEW, failure: BAD } }), dispatchable);
    assert.deepEqual(r.errors, []);
    assert.equal(r.stats.green, 1);
    assert.equal(r.stats.trigger, 1, 'the trigger half of the domain is counted SEPARATELY, or a lost deploy row hides inside the total');
    assert.equal(r.stats.clocked, 0);
  });

  test('🔴 MUTATION — the SAME row with the newest run FAILING is RED SINCE, it BLOCKS, and it names the lane', () => {
    // This is the run that alarmed nothing on 2026-09-09. Same shape, graded.
    const dispatchable = new Set(['deploy-web.yml']);
    const r = evaluateRedSince(
      regOf(trigDuty(WEB, 'deploy-web.yml')),
      probesOf({ [WEB]: { success: OK_OLD, failure: { id: 34315492291, at: '2026-09-09T05:35:00Z' } } }),
      dispatchable,
    );
    assert.equal(r.errors.length, 1, `a red deploy lane did not block:\n${JSON.stringify(r, null, 1)}`);
    assert.match(r.errors[0], /RED SINCE 2026-09-09T05:35:00Z/);
    assert.match(r.errors[0], /deploy-web\.yml on main/);
    assert.match(r.errors[0], /run 34315492291 FAILED/);
    assert.match(r.errors[0], /A success of ANY event on that branch clears it/, 'the exit must be named, and for this row it is a dispatch rather than a merge');
    assert.equal(r.stats.red, 1);
  });

  test('🔴 `ci.yml` IS STILL NOT GRADED — it declares no `workflow_dispatch`, so its only exit is a merge', () => {
    // The deadlock the original exclusion was argued for, and the one thing this
    // change must not touch. The derivation reaches it on its own: `ci.yml` is
    // simply absent from the dispatchable set.
    const dispatchable = new Set(['deploy-web.yml', 'deploy-workers.yml']);
    const ci = trigDuty('duty.workflow.ci.yml', 'ci.yml');
    const reg = regOf(trigDuty(WEB, 'deploy-web.yml'), ci);
    assert.deepEqual(redSinceDomain(reg, dispatchable).map((r) => r.id), [WEB], '`ci.yml` must not be in the RED-SINCE domain — grading it deadlocks the merge queue');
    const r = evaluateRedSince(
      reg,
      probesOf({
        [WEB]: { success: OK_NEW, failure: BAD },
        'duty.workflow.ci.yml': { success: OK_OLD, failure: BAD },
      }),
      dispatchable,
    );
    assert.deepEqual(r.errors, [], 'a red `ci.yml` must NOT block: the only way to make it green is the merge this would be blocking');
    assert.equal(r.stats.domain, 1);
    // …and the exclusion is a NAMED PRINT carrying its reason, never a silence.
    const line = r.prints.filter((p) => /NOT GRADED · duty\.workflow\.ci\.yml/.test(p));
    assert.equal(line.length, 1, `the exclusion must be printed by name:\n${JSON.stringify(r.prints, null, 1)}`);
    assert.match(line[0], /declares NO `workflow_dispatch`/);
    assert.match(line[0], /green only by MERGING/);
    assert.match(line[0], /ci-18/, 'and it must cite the incident, or the next reader re-derives the argument');
  });

  test('the DERIVATION is the admission — removing `workflow_dispatch` from the file removes the row, LOUDLY', () => {
    // The anti-shrink property. A hand-set boolean on the row could be flipped
    // to close an alarm; so could a list. The evidence is the workflow file, and
    // when the file stops carrying it the row leaves the domain WITH A PRINTED
    // SENTENCE rather than as a number that got smaller.
    const reg = regOf(trigDuty(WEB, 'deploy-web.yml'));
    const gone = evaluateRedSince(reg, probesOf({ [WEB]: { success: OK_OLD, failure: BAD } }), new Set(['other.yml']));
    assert.equal(gone.stats, undefined, 'with the only row gone the domain is EMPTY and that is coverage lost, not a pass');
    assert.ok(gone.coverageLost, 'an empty domain must still refuse');
    assert.match(gone.coverageLost.join(' '), /ranges over the EMPTY SET/);

    // With a sibling to keep the domain non-empty, the shrink is a print.
    const sib = trigDuty('duty.workflow.deploy-workers.yml', 'deploy-workers.yml');
    const shrunk = evaluateRedSince(
      regOf(trigDuty(WEB, 'deploy-web.yml'), sib),
      probesOf({ 'duty.workflow.deploy-workers.yml': { success: OK_NEW, failure: BAD } }),
      new Set(['deploy-workers.yml']),
    );
    assert.equal(shrunk.stats.domain, 1);
    const line = shrunk.prints.filter((p) => new RegExp(`NOT GRADED · ${WEB}`).test(p));
    assert.equal(line.length, 1, 'a row leaving this alarm must say so on the run it leaves');
    assert.match(line[0], /declares NO `workflow_dispatch`/);
  });

  test('NO derivation supplied FAILS CLOSED — no trigger row is admitted, and the run SAYS it was not', () => {
    const reg = regOf(trigDuty(WEB, 'deploy-web.yml'), wfDuty(ID));
    assert.deepEqual(redSinceDomain(reg).map((r) => r.id), [ID], 'admission to a blocking alarm may never default to yes');
    const r = evaluateRedSince(reg, probesOf({ [ID]: { success: OK_NEW, failure: BAD } }));
    assert.equal(r.stats.trigger, 0);
    assert.ok(
      r.prints.some((p) => /NOT GRADED · duty\.workflow\.deploy-web\.yml — no workflow-dispatch derivation was supplied/.test(p)),
      'failing closed in silence is the same shrink wearing a safer hat',
    );
  });

  // ── the split: REDNESS is graded, STALENESS is not ─────────────────────────
  test('🔴 a `trigger` row may NOT carry the vocabulary of a clock — the staleness fields are REFUSED', () => {
    // `cadenceDays("trigger")` is null, so every one of these is arithmetic with
    // no operand. Inert today is not the argument: the danger is a later limb
    // widening its domain and finding a window it can believe.
    for (const [field, value] of [
      ['missedRunsTolerated', 2],
      ['firstDue', '2026-12-01T00:00:00Z'],
      ['timer', { reader: 'cloudflare-d1-heartbeat', table: 'cron_heartbeat', wrangler: 'w.jsonc', job: 'x' }],
    ]) {
      const row = trigDuty(WEB, 'deploy-web.yml');
      row.mechanism.recordQuery[field] = value;
      const errs = redSinceTriggerShape(regOf(row));
      assert.equal(errs.length, 1, `\`${field}\` on a clockless row was accepted`);
      assert.match(errs[0], new RegExp(`recordQuery\\.${field}\`? on a`));
      assert.match(errs[0], /grades\s+REDNESS/);
      assert.match(errs[0], /never staleness/);
    }
    // GREEN CONTROL: the shape the committed rows actually use passes.
    assert.deepEqual(redSinceTriggerShape(regOf(trigDuty(WEB, 'deploy-web.yml'))), []);
  });

  test('🔴 `event: workflow_dispatch` is refused on a trigger row too — a hand-press is never a duty\'s evidence', () => {
    // [14]O-3 makes this refusal on a SCHEDULED row and never sees a trigger one.
    // Stated here so the field cannot be carried in on a clockless row and then
    // land in the freshness limb whole when somebody flips the cadence.
    const row = trigDuty(WEB, 'deploy-web.yml');
    row.mechanism.recordQuery.event = 'workflow_dispatch';
    const errs = redSinceTriggerShape(regOf(row));
    assert.equal(errs.length, 1);
    assert.match(errs[0], /somebody pressed a button/);

    const noBranch = trigDuty(WEB, 'deploy-web.yml');
    delete noBranch.mechanism.recordQuery.headBranch;
    assert.match(redSinceTriggerShape(regOf(noBranch))[0], /names no `workflow` and\/or no `headBranch`/);

    const wrongReader = trigDuty(WEB, 'deploy-web.yml');
    wrongReader.mechanism.recordQuery.reader = 'glitchtip-heartbeat';
    assert.match(redSinceTriggerShape(regOf(wrongReader))[0], /only record a clockless workflow duty has is its RUN HISTORY/);
  });

  test('the shape errors REACH `errors`, so a malformed trigger row fails the build rather than printing', () => {
    const row = trigDuty(WEB, 'deploy-web.yml');
    row.mechanism.recordQuery.firstDue = '2026-12-01T00:00:00Z';
    const r = evaluateRedSince(regOf(row, wfDuty(ID)), probesOf({ [ID]: { success: OK_NEW, failure: BAD } }), new Set(['deploy-web.yml']));
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0], /recordQuery\.firstDue/);
  });

  // ── the tree, which is the only place the derivation can be wrong ─────────
  test('the COMMITTED tree really does put both deploy lanes in this domain, and keeps ci.yml out', () => {
    // The ratchet. If a deploy call job stops being post-gate (its `needs:` or its
    // `if:` drifts), or a deploy row loses its `recordQuery`, THIS is what goes
    // red rather than the alarm quietly shrinking to the seven nightly proofs.
    // ⏱ 2026-09-25 [ADR 095 §4]: the two deploy lanes are call jobs of ci.yml now,
    // admitted because their unit is post-gate jobs of the gate workflow — no
    // longer because their own file declares `workflow_dispatch` (it declares none).
    const dispatchable = dispatchableWorkflows(REPO_ROOT);
    const byFile = new Map(parseAllWorkflows(REPO_ROOT).map((wf) => [String(wf.rel).split('/').pop(), wf]));
    const postGate = postGateAdmission(byFile, gateTopology(REPO_ROOT));
    assert.ok(postGate, 'the gate workflow or its gate job could not be derived — the post-gate admission is gone');
    assert.deepEqual([...postGate.jobs].sort(), ['deploy-web', 'deploy-workers'], 'the post-gate jobs of ci.yml have changed');
    assert.equal(dispatchable.has('deploy-web.yml'), false, 'deploy-web.yml has grown a `workflow_dispatch` — a second way to start the lane that skips the gate');
    assert.equal(dispatchable.has('deploy-workers.yml'), false, 'deploy-workers.yml has grown a `workflow_dispatch` — same');
    assert.equal(dispatchable.has('ci.yml'), false, 'ci.yml has grown a `workflow_dispatch` — re-read the deadlock argument before letting it into this domain');
    assert.equal(dispatchable.has('site-drift-repair.yml'), false, 'site-drift-repair.yml has grown a `workflow_dispatch` — same re-read');

    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const ids = redSinceDomain(real, dispatchable, postGate).map((r) => r.id);
    assert.ok(ids.includes('duty.workflow.deploy-web.yml'), 'the web deploy lane has fallen out of the RED-SINCE domain — the 2026-09-09 defect is back');
    assert.ok(ids.includes('duty.workflow.deploy-workers.yml'), 'the workers deploy lane has fallen out of the RED-SINCE domain');
    assert.equal(ids.includes('duty.workflow.ci.yml'), false);
    assert.equal(ids.includes('duty.workflow.site-drift-repair.yml'), false);
    const without = redSinceDomain(real, dispatchable).map((r) => r.id);
    assert.equal(without.includes('duty.workflow.deploy-web.yml'), false, 'without the post-gate admission the web lane must be out — else this test proves nothing about it');

    // 2026-09-23: the recovery lane that re-enters both deploy lanes is itself
    // dispatchable, so it is admitted too — a red recovery run is the silent
    // strand it exists to end, and it must be graded like the lanes it serves.
    assert.ok(dispatchable.has('redeploy-stranded.yml'), '.github/workflows/redeploy-stranded.yml no longer declares `workflow_dispatch`');
    const census = redSinceTriggerCensus(real, dispatchable, postGate);
    assert.deepEqual(census.admitted.sort(), ['duty.workflow.deploy-web.yml', 'duty.workflow.deploy-workers.yml', 'duty.workflow.redeploy-stranded.yml']);
    assert.equal(census.admittedBy['duty.workflow.deploy-web.yml'], 'post-gate');
    assert.equal(census.admittedBy['duty.workflow.deploy-workers.yml'], 'post-gate');
    assert.equal(census.admittedBy['duty.workflow.redeploy-stranded.yml'], 'workflow_dispatch');
    // Every post-gate job of ci.yml is the unit of EXACTLY ONE admitted row.
    const byId = new Map((real.rows ?? []).map((r) => [r.id, r]));
    for (const j of postGate.jobs) {
      const owners = census.admitted.filter((id) => {
        const q = byId.get(id)?.mechanism?.recordQuery;
        return q?.workflow === postGate.gateWorkflow && Array.isArray(q?.unit?.jobs) && q.unit.jobs.includes(j);
      });
      assert.equal(owners.length, 1, `post-gate job ${j} is the unit of ${owners.length} admitted row(s): ${owners.join(', ') || 'none'}`);
    }
    // ⏱ 2026-09-24: three. duty.workflow.extensions-ci.yml joined them — a called
    // workflow declares no `workflow_dispatch` (it runs only as a call), so a merge
    // is its only exit and it is excluded by the same derived reason.
    // ⏱ 2026-09-24: four. duty.workflow.lane-workers.yml, the first ci.yml lane moved
    // into a callee (ADR 095), is excluded for the same reason.
    assert.equal(census.excluded.length, 4, 'the committed register has exactly four trigger rows with no non-merge exit');
    assert.ok(census.excluded.some((l) => /duty\.workflow\.extensions-ci\.yml/.test(l)), 'the extensions CI callee is excluded by derivation');
    assert.ok(census.excluded.some((l) => /duty\.workflow\.lane-workers\.yml/.test(l)), 'the workers lane callee is excluded by derivation');
    assert.ok(census.excluded.every((l) => /declares NO `workflow_dispatch`/.test(l)), 'every exclusion must carry the derived reason');
  });

  test('`rowWorkflowFile` reads the anchor when there is no recordQuery — so an unqueried row still gets a REASON', () => {
    // `duty.workflow.ci.yml` carries no `recordQuery`, and "this row names no
    // workflow" would be a uselessly true exclusion line. The anchor is what
    // lets the census say WHY ci.yml is out rather than merely that it is.
    assert.equal(rowWorkflowFile({ mechanism: { anchor: '.github/workflows/ci.yml' } }), 'ci.yml');
    assert.equal(rowWorkflowFile({ mechanism: { anchor: 'renovate.json' } }), null);
    assert.equal(rowWorkflowFile({ mechanism: { anchor: '.github/workflows/x.yml', recordQuery: { workflow: 'y.yml' } } }), 'y.yml', 'the query wins: it is what the probe actually reads');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE LIVELOCK: A RED VERDICT THAT ABORTS ITS OWN REMEDY.
  // Added 2026-09-09, coverage unit `red-since-self-gate`.
  //
  // Measured on `main`, not reasoned: `build-platforms.yml` run 34351523027
  // FAILED at 12:45:45Z → this limb routed it into `errors` → the guard exited 1
  // in `ci.yml`'s `guards-platform` job → `ci-gate` went red (runs 34354769442,
  // 34355401877) → `build-platforms.yml`'s FIRST step is
  // `node tooling/ci/assert-gate-passed.mjs`, which refused ("✗ ci-gate concluded
  // \"failure\" for ddfc63d4 — refusing to deploy", run 34355529015) → no green
  // run is possible → RED SINCE never clears. And a SECOND LAP through
  // `ops-watch.yml`, which runs this same guard (run 34354893475).
  //
  // ⏱ 2026-09-11 — THE RULE LEFT evaluateRedSince FOR `routeLiveVerdicts`, which
  // routes the live verdicts of BOTH limbs through one needs-graph; the host
  // context is `hostPolicy` over a fabricated ENVIRONMENT — never an argument a
  // caller may choose, because a flag is a waiver. Every property this block
  // proved is still proved below; the second lap is now a PATH.
  // GREEN CONTROLS FIRST throughout.
  // ───────────────────────────────────────────────────────────────────────────
  describe('a RED verdict may not be routed into `errors` by the very gate the graded workflow needs to recover', () => {
    const BP = 'duty.workflow.build-platforms.yml';
    const OPS = 'duty.workflow.ops-watch.yml';
    const OPS_JOBS = { jobs: ['status', 'supabase-drift', 'prod-provenance', 'runner-budget', 'glitchtip', 'alert', 'digest'] };
    const wfRow = (id, workflow, cadence, unit = 'run') => ({
      id,
      kind: 'duty',
      what: 'a scheduled proof',
      detector: 'its own alert job',
      response: 'read the issue it files',
      cadence,
      mechanism: {
        substrate: 'github-actions',
        anchor: `.github/workflows/${workflow}`,
        record: 'GitHub Actions run history',
        failingValue: 'conclusion = failure',
        readBy: 'this guard',
        recordQuery: { reader: 'github-run-history', workflow, unit, event: 'schedule', headBranch: 'main' },
      },
    });
    // The measured runs, so the fixture is the incident rather than a sketch.
    const BP_FAIL = { id: 34351523027, at: '2026-09-09T12:45:45Z' };
    const OPS_FAIL = { id: 34354893475, at: '2026-09-09T13:06:44Z' };

    const TOPO = () => ({
      selfGated: new Set(['build-platforms.yml']),
      guardHosts: new Set(['ci.yml', 'ops-watch.yml']),
      gateName: 'ci-gate',
      gateWorkflow: 'ci.yml',
      why: [],
    });
    const parsed = () => {
      const all = parseAllWorkflows(REPO_ROOT);
      return { all, byFile: new Map(all.map((wf) => [String(wf.rel).split('/').pop(), wf])) };
    };
    // The environment of a `ci.yml` run and of an `ops-watch.yml` run. Nothing
    // below passes a host directly: it is derived from these, exactly as the
    // guard derives it from `process.env`.
    const envFor = (file, event, ref = 'refs/heads/main') => ({
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '1',
      GITHUB_EVENT_NAME: event,
      GITHUB_WORKFLOW: file === 'ci.yml' ? 'CI' : 'Ops watch',
      GITHUB_REF: ref,
      GITHUB_WORKFLOW_REF: `o/r/.github/workflows/${file}@${ref}`,
    });
    const policyFor = (file, event, topo = TOPO(), ref) => hostPolicy(envFor(file, event, ref), topo, workflowEventsByFile(parsed().all));
    const CI_HOST = () => hostWorkflowFile(envFor('ci.yml', 'push'));
    const OPS_HOST = () => hostWorkflowFile(envFor('ops-watch.yml', 'schedule'));
    const IN_CI = () => policyFor('ci.yml', 'push');
    const IN_OPS = () => policyFor('ops-watch.yml', 'schedule');
    const redOf = (id, file, run) => ({ id, line: `${id} — RED SINCE ${run.at}: ${file} on main run ${run.id} FAILED`, code: 1 });
    const BP_RED = () => redOf(BP, 'build-platforms.yml', BP_FAIL);
    const OPS_RED = () => redOf(OPS, 'ops-watch.yml', OPS_FAIL);
    const reg2 = (opsUnit = OPS_JOBS) => regOf(wfRow(BP, 'build-platforms.yml', '7d'), wfRow(OPS, 'ops-watch.yml', '1d', opsUnit));
    const route = (live, policy, topo = TOPO(), reg = reg2()) => routeLiveVerdicts(live, policy, topo, reg, parsed().byFile);

    // ── the derivation, over the real tree ──────────────────────────────────
    test('GREEN CONTROL — the COMMITTED tree derives the gate, the self-gated lanes and the guard hosts', () => {
      // The ratchet. If the gate is renamed, if a deploy lane drops its gate step,
      // or if this guard moves out of a workflow, THIS goes red rather than the
      // exemption silently widening or the freeze silently returning.
      const t = gateTopology(REPO_ROOT);
      assert.deepEqual(t.why, [], `the derivation must be complete on the committed tree:\n${t.why.join('\n')}`);
      assert.equal(t.gateName, 'ci-gate', `${GATE_SCRIPT_REL} no longer waits for a check named ci-gate`);
      assert.equal(t.gateWorkflow, 'ci.yml', 'the workflow declaring the gate job is no longer ci.yml');
      assert.ok(t.selfGated.has('build-platforms.yml'), 'build-platforms.yml no longer runs the gate script — re-read the livelock before trusting this');
      // ⏱ 2026-09-25 [ADR 095 §4]: the deploy lanes are post-gate call jobs of ci.yml now.
      // ci-gate is their `needs:`, so they run no gate step and are NOT self-gated.
      assert.ok(t.selfGated.has('extensions.yml'));
      assert.equal(t.selfGated.has('deploy-web.yml'), false, 'deploy-web.yml runs the gate script again — it is a post-gate callee');
      assert.equal(t.selfGated.has('deploy-workers.yml'), false, 'deploy-workers.yml runs the gate script again — it is a post-gate callee');
      const ci = parseAllWorkflows(REPO_ROOT).find((wf) => String(wf.rel).split('/').pop() === 'ci.yml');
      assert.deepEqual(postGateJobs(ci, t.gateName).sort(), ['deploy-web', 'deploy-workers'], 'the post-gate jobs of ci.yml have changed');
      for (const j of ['deploy-web', 'deploy-workers']) {
        const needs = ci.jobs.get(j)?.needs ?? [];
        assert.ok(needs.includes(t.gateName), `${j} no longer needs ${t.gateName}`);
      }
      for (const s of ['submit-appstore.yml', 'submit-play.yml', 'submit-snap.yml', 'submit-windows-store.yml']) {
        assert.ok(t.selfGated.has(s), `${s} carries the gate step and must be in the self-gated set`);
      }
      assert.equal(t.selfGated.has('ci.yml'), false, 'ci.yml must NOT be self-gated: it PRODUCES the gate');
      assert.equal(t.selfGated.has('ops-watch.yml'), false, 'ops-watch.yml is gated on nothing — that is why blocking there cannot deadlock');
      assert.deepEqual([...t.guardHosts].sort(), ['ci.yml', 'ops-watch.yml'], `the workflows running ${GUARD_SCRIPT_REL} have changed`);
      assert.equal(gateCheckName(REPO_ROOT), 'ci-gate');
    });

    test('🔴 "MENTIONS" IS NOT "RUNS" — a `paths:` filter naming the gate script does not make a workflow self-gated', () => {
      const filterOnly = { lines: [{ n: 1, text: "      - 'tooling/ci/assert-gate-passed.mjs'" }] };
      assert.equal(workflowRunsScript(filterOnly, GATE_SCRIPT_REL), false, 'a paths: entry is not an invocation');
      const invoked = { lines: [{ n: 1, text: '        run: node tooling/ci/assert-gate-passed.mjs ${{ github.sha }}' }] };
      assert.equal(workflowRunsScript(invoked, GATE_SCRIPT_REL), true);
      const quoted = { lines: [{ n: 1, text: '        run: node tooling/ci/assert-gate-passed.mjs "$GITHUB_SHA"' }] };
      assert.equal(workflowRunsScript(quoted, GATE_SCRIPT_REL), true, 'extensions.yml writes it this way');
      assert.equal(workflowRunsScript({ lines: [] }, GATE_SCRIPT_REL), false);
      assert.equal(workflowRunsScript(null, GATE_SCRIPT_REL), false);
    });

    test('🔴 the gate name is READ from the gate script\'s own `const GATE` — a planted different name comes back, a moved one is null', () => {
      // The GREEN CONTROL above asserts 'ci-gate' on the real tree only, which a
      // hard-coded 'ci-gate' would also satisfy. This plants a gate script under
      // a name nothing in this guard spells, and requires that name back.
      const root = join(TMP, `gate-name-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const abs = join(root, ...GATE_SCRIPT_REL.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, "#!/usr/bin/env node\n// const GATE = 'a-comment-is-not-the-constant';\nconst GATE = 'zz-planted-gate';\n");
      assert.equal(gateCheckName(root), 'zz-planted-gate');
      // The constant moved out of the shape the reader reads: `null`, which exempts nothing.
      writeFileSync(abs, "#!/usr/bin/env node\nlet GATE = 'zz-planted-gate';\n");
      assert.equal(gateCheckName(root), null);
      // The file gone: `null` again, never a default.
      rmSync(abs);
      assert.equal(gateCheckName(root), null);
    });

    test('the CONTEXT comes from the environment — `feedsTheGate` needs the gate producer AND a guard host', () => {
      const t = TOPO();
      assert.equal(feedsTheGate(CI_HOST(), t), true, 'a ci.yml run is the run whose exit code decides ci-gate');
      assert.equal(feedsTheGate(OPS_HOST(), t), false, 'ops-watch decides nothing that gates anything');
      assert.equal(feedsTheGate(hostWorkflowFile({}), t), false, 'off Actions there is no host');
      assert.equal(feedsTheGate(CI_HOST(), null), false, 'no derivation, no gate');
      assert.equal(feedsTheGate(CI_HOST(), { ...t, guardHosts: new Set(['ops-watch.yml']) }), false, 'a host that does not run this guard cannot be the reason the gate is red');
      assert.equal(feedsTheGate(CI_HOST(), { ...t, gateWorkflow: null }), false);
    });

    // ── the green control that proves the exemption does not leak ───────────
    test('GREEN CONTROL — with NO self-gated lane red, a red ops-watch STILL BLOCKS inside ci.yml on push', () => {
      const r = route([OPS_RED()], IN_CI());
      assert.equal(r.blocking.length, 1, `a genuinely red ops-watch must block:\n${JSON.stringify(r, null, 1)}`);
      assert.equal(r.printed.length, 0, 'nothing was deadlocked, so nothing may be exempt');
    });

    // ── the defect itself ──────────────────────────────────────────────────
    test('🔴 THE LIVELOCK — a RED on a SELF-GATED workflow does not block the run that decides the gate', () => {
      const r = route([BP_RED()], IN_CI());
      assert.equal(r.blocking.length, 0, `build-platforms.yml is self-gated on ci-gate; blocking ci-gate on its redness is the livelock:\n${JSON.stringify(r, null, 1)}`);
      assert.equal(r.printed.length, 1, 'it is still RED — the verdict is unchanged, only where it is routed');
    });

    test('🔴 LOUDNESS — the exempt RED keeps its whole line and carries the reason beside it', () => {
      const [p] = route([BP_RED()], IN_CI()).printed;
      assert.match(p.line, /build-platforms\.yml on main run 34351523027 FAILED/, 'the failing run id must be named');
      assert.match(p.line, /RED SINCE 2026-09-09T12:45:45Z/, 'the timestamp must be named');
      assert.match(p.why, /SELF-GATED/);
      assert.match(p.why, new RegExp(reEscape(GATE_SCRIPT_REL)), 'the reason must name the step that makes the remedy unreachable');
      assert.match(p.why, /UNREACHABLE from that host/);
    });

    test('🔴 THE SECOND LAP IS A PATH — a red row whose unit contains the ops-watch guard is exempt in ci.yml ONLY while a self-gated lane is red', () => {
      const lap = route([BP_RED(), OPS_RED()], IN_CI(), TOPO(), reg2('run'));
      assert.equal(lap.blocking.length, 0, `the loop survives through the ops-watch row:\n${JSON.stringify(lap, null, 1)}`);
      const why = lap.printed.find((p) => p.id === OPS).why;
      assert.match(why, /CYCLE of 3 edges back to ci\.yml/);
      assert.match(why, /OWN HOST/);
      assert.match(why, /ops-watch\.yml blocks on duty\.workflow\.build-platforms\.yml, which is red/);
      assert.match(why, /SELF-GATED/);
      const alone = route([OPS_RED()], IN_CI(), TOPO(), reg2('run'));
      assert.equal(alone.blocking.length, 1, 'with no self-gated lane red there is no cycle, so the same row blocks — the exemption states its own expiry by construction');
    });

    test('🔴 AND A UNIT THAT DOES NOT CONTAIN THE GUARD HAS NO SECOND LAP AT ALL — its red is its own', () => {
      const r = route([BP_RED(), OPS_RED()], IN_CI());
      assert.deepEqual(r.blocking.map((v) => v.id), [OPS], 'judged by jobs that do not run this guard, a red ops-watch is a real red and blocks');
      assert.deepEqual(r.printed.map((v) => v.id), [BP]);
    });

    // ── and the half that must not move ────────────────────────────────────
    test('🔴 STILL BLOCKING IN OPS-WATCH — the self-gated RED fails the host that is gated on nothing', () => {
      const r = route([BP_RED(), OPS_RED()], IN_OPS());
      assert.equal(r.printed.length, 0, 'no exemption may exist in a host that feeds no gate and needs no self');
      assert.equal(r.blocking.length, 2);
    });

    test('🔴 STILL BLOCKING OFF ACTIONS — no host resolves, so every RED blocks exactly as before', () => {
      const r = route([BP_RED(), OPS_RED()], hostPolicy({}, TOPO(), new Map()));
      assert.equal(r.blocking.length, 2, 'a local run of this guard grades both rows hard');
    });

    // ── fail-closed, in every direction ────────────────────────────────────
    test('🔴 FAIL-CLOSED — a COLLAPSED derivation exempts nothing and SAYS the freeze may return', () => {
      const empty = { selfGated: new Set(), guardHosts: new Set(['ci.yml']), gateName: 'ci-gate', gateWorkflow: 'ci.yml', why: ['no workflow under .github/workflows runs tooling/ci/assert-gate-passed.mjs, so no lane is self-gated'] };
      const r = route([BP_RED(), OPS_RED()], IN_CI(), empty);
      assert.equal(r.blocking.length, 2, 'an unproven exemption is no exemption');
      assert.ok(r.notes.some((n) => /NO LIVE VERDICT WAS EXEMPTED/.test(n) && /never on a missing answer/.test(n)), JSON.stringify(r.notes, null, 1));
      const none = routeLiveVerdicts([BP_RED()], IN_CI(), null, reg2(), parsed().byFile);
      assert.equal(none.blocking.length, 1, 'with no topology supplied at all, nothing is exempt');
    });

    test('🔴 TWO workflows answering to the gate name is a GUESS, and a guess exempts nothing', () => {
      const ambiguous = { ...TOPO(), gateWorkflow: null, why: ['2 workflows declare a job named `ci-gate`'] };
      const r = route([BP_RED()], IN_CI(), ambiguous);
      assert.equal(r.blocking.length, 1);
      assert.equal(r.printed.length, 0);
    });

    test('the exemption is a DERIVATION, never a caller flag — the environment and the tree are the only inputs', () => {
      // There is no `--allow-deadlock`, no register field and no boolean a caller
      // may set. The arities are asserted so a flag cannot be added quietly.
      assert.equal(routeLiveVerdicts.length, 5);
      assert.equal(hostPolicy.length, 3);
      const events = workflowEventsByFile(parsed().all);
      const spoofed = hostPolicy(envFor('ops-watch.yml', 'pull_request'), TOPO(), events);
      assert.equal(spoofed.mode, 'enforcing', 'ops-watch.yml declares no pull_request, so the event in the environment is not believed');
      assert.match(spoofed.why, /declares no `pull_request`/);
      const notAHost = hostPolicy({ ...envFor('e2e.yml', 'pull_request'), GITHUB_WORKFLOW: 'E2E' }, TOPO(), events);
      assert.equal(notAHost.mode, 'enforcing', 'a workflow that does not run this guard is not its proposal gate');
      assert.deepEqual(unitNeedsHosts(wfRow(BP, 'build-platforms.yml', '7d'), TOPO(), parsed().byFile).map((n) => n.host), ['ci.yml']);
      assert.deepEqual(unitNeedsHosts(wfRow('duty.workflow.e2e.yml', 'e2e.yml', '1d'), TOPO(), parsed().byFile), [], 'a lane neither self-gated nor hosting the guard needs no host');
    });

    test('INV1 — the HOST POLICY is ADVISORY only on a proposal event, in a host that runs this guard and declares that event', () => {
      const events = workflowEventsByFile(parsed().all);
      const pr = hostPolicy(envFor('ci.yml', 'pull_request', 'refs/pull/620/merge'), TOPO(), events);
      assert.equal(pr.mode, 'advisory');
      assert.match(pr.why, /INV1/);
      assert.match(pr.why, /BLOCKS on push to the default branch/);
      const adv = route([BP_RED(), OPS_RED()], pr);
      assert.equal(adv.blocking.length, 0);
      assert.equal(adv.printed.length, 2, 'advisory PRINTS every verdict; it never drops one');
      for (const ev of ['push', 'schedule', 'workflow_dispatch']) {
        assert.equal(hostPolicy(envFor('ci.yml', ev), TOPO(), events).mode, 'enforcing', `${ev} is not a proposal`);
      }
      assert.match(IN_CI().why, /INV2/);
      assert.equal(IN_OPS().mode, 'enforcing');
      assert.match(IN_OPS().why, /page/);
      assert.equal(hostPolicy({}, TOPO(), events).mode, 'enforcing');
      assert.equal(hostPolicy({ ...envFor('ci.yml', 'pull_request'), GITHUB_EVENT_NAME: '' }, TOPO(), events).mode, 'enforcing', 'an unnamed event is not a proposal');
      assert.deepEqual([...PROPOSAL_EVENTS].sort(), ['merge_group', 'pull_request', 'pull_request_target']);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⛔ THE 2026-09-11 FREEZE, REPLAYED — every invariant proved against the exact
// answers the grading run received, through the REAL guard on the REAL tree.
//
// Run 34546423386 (ops-watch.yml, schedule, main 543b3220) listed EIGHT problems
// at 2026-09-11T00:26:07Z, and ci.yml ran the same guard on every pull request,
// so the PRs fixing the two real bugs could not merge (FINDING-permanent-freeze-
// 2026-09-11). tooling/ci/test/fixtures/ops-freeze-2026-09-11.json holds that
// run's world: every run history cut at that instant, the job and step
// conclusions of the 31 newest ops-watch runs, and the GlitchTip, D1 and issue
// values the run printed. `replayStub` serves it over `fetch`.
//
// ⚠️ THE HARNESS WAS PROVED BEFORE THE FIX, NOT AFTER: the same fixture served to
// the unmodified guard at origin/main 543b3220 reproduced all eight problems in
// the ops-watch host (exit 1) and seven in a pull_request host (exit 1). A replay
// that only ever ran against the fixed guard would prove nothing about the freeze.
//
// The four TRUE verdicts that survive INV3 are real and must keep their bite:
// e2e.yml's outcome limb is stale and e2e.yml is RED SINCE (the nightly is broken),
// build-platforms.yml is RED SINCE (the Android release build is broken), and the
// laptop pipeline-driver has not beaten since 2026-09-09T04:21Z.
// ─────────────────────────────────────────────────────────────────────────────
describe('assert-ops-register — [14]O-3b · a run that died ONLY on the installation quota is COVERAGE LOST, not RED (2026-09-11)', () => {
  // The annotation text and the job are the ones GitHub recorded on CodeQL run
  // 34577720776 (job 103193893384), read from /check-runs/{id}/annotations.
  const QUOTA = 'API rate limit exceeded for installation. If you reach out to GitHub Support for help, please include the request ID 8038:1078A0:41122:D7FF2:6AA3B7DC and timestamp 2026-09-11 08:12:12 UTC.';
  const JOB = { id: 103193893384, name: 'Analyze JavaScript and TypeScript', conclusion: 'failure' };
  const annotationsOf = (m) => (id) => m[id] ?? null;
  const row = {
    id: 'duty.workflow.codeql.yml',
    kind: 'duty',
    what: 'the scheduled code scan',
    detector: 'this guard',
    response: 'read the failed run',
    cadence: '1d',
    mechanism: {
      substrate: 'github-actions',
      anchor: 'renovate.json',
      record: 'GitHub Actions run history',
      failingValue: 'conclusion = failure',
      readBy: 'this guard',
      recordQuery: { reader: 'github-run-history', workflow: 'codeql.yml', unit: 'run', event: 'schedule', headBranch: 'main' },
    },
  };
  const OK = { id: 34540000001, at: '2026-09-10T20:53:00Z' };
  const failOf = (over = {}) => ({ id: 34577720776, at: '2026-09-11T08:12:30Z', ...over });
  const probesOf = (failure, success = OK) => new Map([[row.id, { success, failure }]]);
  const quotaCause = () => diedOnlyOnInstallationQuota([JOB], annotationsOf({ [JOB.id]: [{ annotation_level: 'warning', message: 'Node.js 20 is deprecated.' }, { annotation_level: 'failure', message: QUOTA }] }));

  test('GREEN CONTROL — a failed job whose failure annotation is its own error is NOT quota-only', () => {
    const c = diedOnlyOnInstallationQuota([JOB], annotationsOf({ [JOB.id]: [{ annotation_level: 'failure', message: 'Process completed with exit code 1.' }] }));
    assert.equal(c.quotaOnly, false);
    assert.match(c.why, /failed on: Process completed with exit code 1\./);
  });

  test('🔴 every failure annotation of every failed job is the refusal: quota-only, and the job is named', () => {
    const c = quotaCause();
    assert.equal(c.quotaOnly, true);
    assert.equal(c.why, 'job "Analyze JavaScript and TypeScript" failed ONLY on `API rate limit exceeded for installation`');
  });

  test('🔴 NOT PROVEN is never quota — mixed failures, an unread list, no failure annotation, no failed job, no job list', () => {
    const second = { id: 2, name: 'second', conclusion: 'failure' };
    const quotaList = [{ annotation_level: 'failure', message: QUOTA }];
    assert.equal(diedOnlyOnInstallationQuota([JOB], annotationsOf({ [JOB.id]: [...quotaList, { annotation_level: 'failure', message: 'boom' }] })).quotaOnly, false, 'a real failure beside the refusal');
    assert.equal(diedOnlyOnInstallationQuota([JOB, second], annotationsOf({ [JOB.id]: quotaList, 2: [{ annotation_level: 'failure', message: 'boom' }] })).quotaOnly, false, 'a second failed job that failed on its own work');
    assert.equal(diedOnlyOnInstallationQuota([JOB, second], annotationsOf({ [JOB.id]: quotaList })).quotaOnly, false, 'a failed job whose annotations could not be read');
    assert.equal(diedOnlyOnInstallationQuota([JOB], annotationsOf({ [JOB.id]: [{ annotation_level: 'warning', message: QUOTA }] })).quotaOnly, false, 'a refusal recorded only as a warning');
    assert.equal(diedOnlyOnInstallationQuota([{ ...JOB, conclusion: 'success' }], annotationsOf({ [JOB.id]: quotaList })).quotaOnly, false, 'no failed job');
    assert.equal(diedOnlyOnInstallationQuota(null, annotationsOf({})).quotaOnly, false, 'no job list');
  });

  test('CONTROL — a newest failure with no quota cause is still RED SINCE at exit 1', () => {
    const r = evaluateRedSince({ rows: [row] }, probesOf(failOf({ quotaOnly: false, cause: 'job "Analyze" failed on: boom' })));
    assert.equal(r.stats.red, 1);
    assert.equal(r.stats.quota, 0);
    assert.equal(r.live.length, 1);
    assert.equal(r.live[0].code, 1);
    assert.match(r.live[0].line, /RED SINCE 2026-09-11T08:12:30Z/);
  });

  test('🔴 a quota-only newest failure is COVERAGE LOST at exit 2, counted apart from RED', () => {
    const c = quotaCause();
    const r = evaluateRedSince({ rows: [row] }, probesOf(failOf({ quotaOnly: c.quotaOnly, cause: c.why })));
    assert.equal(r.stats.red, 0);
    assert.equal(r.stats.quota, 1);
    assert.equal(r.live.length, 1);
    assert.equal(r.live[0].code, 2, 'COVERAGE LOST is exit 2 — never 1, which is "the duty is failing" (INV6)');
    assert.match(r.live[0].line, /run 34577720776 \(2026-09-11T08:12:30Z\) FAILED, and job "Analyze JavaScript and TypeScript" failed ONLY on `API rate limit exceeded for installation`/);
    assert.match(r.live[0].line, /COVERAGE LOST for this row/);
    assert.match(r.live[0].line, /the newest success is run 34540000001/);
    assert.doesNotMatch(r.live[0].line, /RED SINCE/);
    assert.ok(r.errors.includes(r.live[0].line));
    assert.ok(r.prints.some((p) => /· 1 whose newest failure died ONLY on the installation rate limit \(COVERAGE LOST\)/.test(p)), r.prints.join('\n'));
  });

  test('🔴 with NO success at all, a quota-only failure is still the quota verdict, not the blind one', () => {
    const c = quotaCause();
    const r = evaluateRedSince({ rows: [row] }, probesOf(failOf({ quotaOnly: true, cause: c.why }), null));
    assert.equal(r.stats.blind, 0);
    assert.equal(r.stats.quota, 1);
    assert.equal(r.live[0].code, 2);
    assert.match(r.live[0].line, /no success exists to compare against/);
  });

  test('a quota-only failure OLDER than the newest success changes nothing: the branch is green', () => {
    const r = evaluateRedSince({ rows: [row] }, probesOf(failOf({ at: '2026-09-09T00:00:00Z', quotaOnly: true, cause: 'x' })));
    assert.equal(r.stats.green, 1);
    assert.equal(r.stats.quota, 0);
    assert.deepEqual(r.live, []);
  });
});

describe('the 2026-09-11 freeze, replayed — INV1..INV6 against the exact answers run 34546423386 received', () => {
  const REPO = resolve(CI_DIR, '..', '..');
  const FIXTURE = join(CI_DIR, 'test', 'fixtures', 'ops-freeze-2026-09-11.json');
  const R = 'globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows';
  const HOST = {
    PR: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '1', GITHUB_EVENT_NAME: 'pull_request', GITHUB_WORKFLOW: 'CI', GITHUB_REF: 'refs/pull/620/merge', GITHUB_WORKFLOW_REF: `${R}/ci.yml@refs/pull/620/merge` },
    PUSH: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '2', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW: 'CI', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: `${R}/ci.yml@refs/heads/main` },
    OPS: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '34546423386', GITHUB_EVENT_NAME: 'schedule', GITHUB_WORKFLOW: 'Ops watch', GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: `${R}/ops-watch.yml@refs/heads/main` },
    OFF: {},
  };
  const LIVE_PRINT = '⬜  [LIVE] 🔴 FAILING, NOT BLOCKING IN THIS HOST — ';
  let worldFile = null;
  let registerFile = null;
  const replay = (host, extra = {}) => {
    worldFile ??= replayWorldFile(FIXTURE);
    registerFile ??= replayRegisterFile(FIXTURE);
    const env = scrubbedEnv({
      OPS_REPLAY_FILE: worldFile,
      OPS_REPLAY_REGISTER_FILE: registerFile,
      GITHUB_TOKEN: 'replay',
      GLITCHTIP_TOKEN: 'replay',
      CLOUDFLARE_API_TOKEN: 'replay',
      CLOUDFLARE_ACCOUNT_ID: 'replay',
      GITHUB_REPOSITORY: 'globalonlinedeveloper/Nikatru_Platform_Public',
      ...host,
      ...extra,
    });
    const r = spawnSync(process.execPath, ['--import', replayStubUrl(), GUARD], { cwd: REPO, encoding: 'utf8', env });
    const out = `${r.stdout}\n${r.stderr}`;
    const lines = out.split('\n');
    const at = lines.findIndex((l) => /^✗ tooling\/ops\/register\.json — \d+ problem\(s\):$/.test(l));
    const problems = at === -1 ? [] : lines.slice(at + 1).filter((l) => /^ {4}\S/.test(l)).map((l) => l.trim());
    const printedAt = lines.map((l, i) => (l.startsWith(LIVE_PRINT) ? i : -1)).filter((i) => i !== -1);
    const printed = printedAt.map((i) => ({ line: lines[i].slice(LIVE_PRINT.length), why: String(lines[i + 1] ?? '') }));
    return { code: r.status, out, problems, printed };
  };
  const E2E_STALE = /^duty\.workflow\.e2e\.yml — its record IS reachable and the newest SUCCESSFUL run is 40\.1h old/;
  const PIPELINE = /^duty\.laptop\.nikatru-pipeline-driver — its record IS reachable and the newest SUCCESSFUL run is 44\.1h old/;
  const BP_RED = /^duty\.workflow\.build-platforms\.yml — RED SINCE 2026-09-10T11:10:59Z: build-platforms\.yml on main run 34468887825 FAILED/;
  const E2E_RED = /^duty\.workflow\.e2e\.yml — RED SINCE 2026-09-10T08:16:33Z: e2e\.yml on main run 34453685391 FAILED/;
  const TRUE_FOUR = [E2E_STALE, PIPELINE, BP_RED, E2E_RED];
  const WAS_STALE = ['duty.analytics-silence-judgment', 'duty.d1-statement-acceptance', 'duty.pages-deployment-landed', 'duty.workflow.ops-watch.yml'];
  const has = (lines, re) => lines.some((l) => re.test(l));
  const printedLines = (r) => r.printed.map((p) => p.line);

  test('the fixture IS the grading run\'s world — its run ids, events and timestamps are the ones the finding names', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    assert.equal(f.now, '2026-09-11T00:26:07Z');
    assert.equal(f.hostRun.id, 34546423386);
    const ops = f.runs['ops-watch.yml'];
    assert.equal(ops.some(([id]) => id === 34546423386), false, 'the grading run was in flight, so it must not be in its own history');
    const lastGreen = ops.find(([, , c]) => c === 'success');
    assert.deepEqual(lastGreen.slice(0, 3), [34443764295, 'workflow_dispatch', 'success'], 'the last ops-watch success before the freeze');
    assert.ok(ops.filter(([, , , at]) => at > lastGreen[3]).every(([, , c]) => c === 'failure'), 'every ops-watch run after it failed');
    assert.deepEqual(ops.find(([, e, c]) => e === 'schedule' && c === 'success').slice(0, 4), [34332836726, 'schedule', 'success', '2026-09-09T09:08:21Z'], 'the run the whole-run reader aged four duties from');
    assert.deepEqual(f.runs['e2e.yml'].find(([, , c]) => c === 'failure').slice(0, 1), [34453685391]);
    assert.deepEqual(f.runs['e2e.yml'].find(([, , c]) => c === 'success').slice(0, 1), [34327705272]);
    assert.deepEqual(f.runs['build-platforms.yml'].find(([, , c]) => c === 'failure').slice(0, 1), [34468887825]);
    assert.deepEqual(f.runs['build-platforms.yml'].find(([, , c]) => c === 'success').slice(0, 1), [34367696898]);
    assert.equal(f.glitchtip['33'][0], '2026-09-09T04:21:13.968Z');
    // …and the fact INV3 turns on, read out of the real job lists: in the newest
    // SCHEDULED run before the grading run, the register step failed and the steps
    // and job that perform the other duties succeeded.
    const [heartbeats] = f.jobs['34533663312'].filter(([n]) => n.startsWith('Every declared duty is fresh'));
    assert.equal(heartbeats[1], 'failure');
    const step = (name) => heartbeats[2].find(([n]) => n === name)?.[1];
    assert.equal(step('The whole ops register — every duty, not just the heartbeat-backed ones'), 'failure');
    assert.equal(step("Judge whether the analytics rail's silence is a FAULT"), 'success');
    assert.equal(step('Live D1 still runs every statement the Workers send it'), 'success');
    assert.equal(f.jobs['34533663312'].find(([n]) => n.startsWith('The Cloudflare Pages builds'))[1], 'success');
  });

  test('O-HEARTBEAT-DUTY-BREAKS-REPLAY-FIXTURE · the fixture answers EXACTLY the monitors the grading run read — no hand-added answer for a later monitor', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const atFreeze = f.glitchtipMonitorsAtFreeze.map(String).sort();
    assert.deepEqual(atFreeze, ['19', '22', '23', '24', '25', '26', '27', '29', '30', '33', '6'], 'the monitors run 34546423386 printed, and no other');
    assert.deepEqual(Object.keys(f.glitchtip).sort(), atFreeze, 'an answer for a monitor the freeze never read is a hand list again; the register derives those');
  });

  test('O-HEARTBEAT-DUTY-BREAKS-REPLAY-FIXTURE · a heartbeat duty added after the freeze is answered FROM THE REGISTER, and no original answer moves', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
    const template = register.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'glitchtip-heartbeat');
    const throwaway = structuredClone(template);
    throwaway.id = 'duty.replay-throwaway-heartbeat';
    const free = String(1 + Math.max(...register.rows.map((r) => Number(r?.mechanism?.recordQuery?.monitor) || 0)));
    throwaway.mechanism.recordQuery.monitor = Number(free);
    const before = replayWorld(f, register);
    const after = replayWorld(f, { ...register, rows: [...register.rows, throwaway] });
    assert.deepEqual(after.derived, [...before.derived, free], 'the new monitor is derived, and nothing else changes');
    assert.deepEqual(after.world.glitchtip[free], [new Date(Date.parse(f.now)).toISOString(), 3600, 1, 0], 'one clean beat at the replayed instant');
    for (const id of f.glitchtipMonitorsAtFreeze.map(String)) {
      assert.deepEqual(after.world.glitchtip[id], f.glitchtip[id], `monitor ${id} still carries exactly what run 34546423386 received`);
    }
  });

  test('O-HEARTBEAT-DUTY-BREAKS-REPLAY-FIXTURE · RED CONTROL — a MISSING answer for a monitor the freeze had is NOT filled in, and the replay goes red on it', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
    const { 19: _dropped, ...rest } = f.glitchtip;
    const pure = replayWorld({ ...f, glitchtip: rest }, register);
    assert.equal(Object.hasOwn(pure.world.glitchtip, '19'), false, 'the derivation must never answer a monitor the freeze read');
    const missing = replay(HOST.OPS, { OPS_REPLAY_FILE: replayWorldFile(FIXTURE, (w) => { delete w.glitchtip['19']; }) });
    const clean = replay(HOST.OPS);
    assert.equal(has(clean.problems, /GlitchTip has no monitor 19 /), false, 'green control: the clean world answers monitor 19');
    assert.equal(missing.code, 1, missing.out.slice(-3000));
    assert.ok(has(missing.problems, /GlitchTip has no monitor 19 /), `the dropped answer must be a PROBLEM:\n${missing.problems.join('\n')}`);
  });

  test('O-D1-HEARTBEAT-REPLAY-HAND-LIST · the fixture answers EXACTLY the D1 jobs and targets the grading run read', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    assert.deepEqual(Object.keys(f.d1.jobs).sort(), [...f.d1JobsAtFreeze].sort(), 'a D1 job answer the freeze never read is a hand list again; the register derives those');
    assert.deepEqual(Object.keys(f.d1.targets).sort(), [...f.d1TargetsAtFreeze].sort(), 'a D1 target answer the freeze never read is a hand list again');
    assert.equal(f.d1JobsAtFreeze.includes('erasure_retry'), false, 'erasure_retry joined watchedJobs after the freeze (PR #762), so the freeze cannot have read it');
  });

  test('O-D1-HEARTBEAT-REPLAY-HAND-LIST · every D1 job and target the register names is answered, and a throwaway of each is DERIVED with no original answer moving', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
    const cron = register.rows.find((r) => r?.mechanism?.recordQuery?.reader === 'cloudflare-d1-heartbeat' && r.watchedJobs);
    assert.ok(cron, 'the register has no cloudflare-d1-heartbeat row with watchedJobs — this case reads nothing');
    const timed = register.rows.find((r) => r?.mechanism?.recordQuery?.timer?.target);
    assert.ok(timed, 'the register has no timer limb with a target — this case reads nothing');

    const before = replayWorld(f, register);
    for (const job of Object.keys(cron.watchedJobs)) assert.ok(Object.hasOwn(before.world.d1.jobs, job), `watched job ${job} has no answer`);
    assert.ok(Object.hasOwn(before.world.d1.targets, timed.mechanism.recordQuery.timer.target));

    const withJob = structuredClone(register);
    withJob.rows.find((r) => r.id === cron.id).watchedJobs.replay_throwaway_job = ['0 6 * * *'];
    const throwawayTimer = structuredClone(timed);
    throwawayTimer.id = 'duty.replay-throwaway-timer';
    throwawayTimer.mechanism.recordQuery.timer.target = 'Nikatru_Platform_Public/replay-throwaway.yml';
    withJob.rows.push(throwawayTimer);
    const after = replayWorld(f, withJob);
    const beat = new Date(Date.parse(f.now)).toISOString();
    assert.deepEqual(after.derivedD1.jobs, [...before.derivedD1.jobs, 'replay_throwaway_job']);
    assert.deepEqual(after.derivedD1.targets, [...before.derivedD1.targets, 'Nikatru_Platform_Public/replay-throwaway.yml']);
    assert.equal(after.world.d1.jobs.replay_throwaway_job, beat, 'one clean beat at the replayed instant');
    assert.equal(after.world.d1.targets['Nikatru_Platform_Public/replay-throwaway.yml'], beat);
    for (const job of f.d1JobsAtFreeze) assert.equal(after.world.d1.jobs[job], f.d1.jobs[job], `job ${job} still carries what run 34546423386 received`);
    for (const t of f.d1TargetsAtFreeze) assert.equal(after.world.d1.targets[t], f.d1.targets[t], `target ${t} still carries what run 34546423386 received`);
  });

  test('O-D1-HEARTBEAT-REPLAY-HAND-LIST · RED CONTROL — a MISSING answer for a target the freeze read is NOT filled in, and the replay goes red on it', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
    const T = 'Nikatru_Platform_Public/e2e.yml';
    const J = 'renewals';
    const { [T]: _t, ...targets } = f.d1.targets;
    const { [J]: _j, ...jobs } = f.d1.jobs;
    const pure = replayWorld({ ...f, d1: { jobs, targets } }, register);
    assert.equal(Object.hasOwn(pure.world.d1.targets, T), false, 'the derivation must never answer a target the freeze read');
    assert.equal(Object.hasOwn(pure.world.d1.jobs, J), false, 'the derivation must never answer a job the freeze read');
    const missing = replay(HOST.OPS, { OPS_REPLAY_FILE: replayWorldFile(FIXTURE, (w) => { delete w.d1.targets[T]; }) });
    const TIMER_GONE = /^duty\.workflow\.e2e\.yml — .*holds no row with ok = 1/;
    const clean = replay(HOST.OPS);
    assert.equal(has(clean.problems, TIMER_GONE), false, `green control: the clean world answers ${T}`);
    assert.equal(missing.code, 1, missing.out.slice(-3000));
    assert.ok(has(missing.problems, TIMER_GONE), `the dropped answer must be a PROBLEM:\n${missing.problems.join('\n')}`);
  });

  // ── ⏱ 2026-09-20 · the drill-date replay fixture ─────────────────────
  // The third instance of the class, and the first that is a dated RECORD rather
  // than a missing ANSWER. MEASURED by the alarm-drill lane on 2026-09-20: with
  // its three `absenceWatcher.downTransitionDrill` records in the register this
  // file went from exit 0 / zero failures to exit 1 / three failures — `the
  // committed register is STRUCTURALLY sound` (a FUTURE-date problem matches
  // neither DUTY_IS_FAILING nor either carve-out), INV1's exit-0 floor, and
  // INV2's `off.problems.length` 7 against 4 — all three about the fixture's age
  // and none about the records. The three below carry that lane's dates and the
  // delivery ids it read, so what replays here is the change, not a shape.
  const LANE_DRILLS = {
    'duty.laptop.nikatru-ops-check': {
      date: '2026-09-17',
      how: 'observed, not forced: no POST reached monitor 29 inside its 50400 s window and the monitor transitioned Down on its own',
      evidence: 'GlitchTip Down check 17:01:23 UTC; alert email 1a0b050ef3dac88a internalDate 1789664487000; ntfy nikatru-page 1aP2i4heTNt1',
    },
    'duty.laptop.nikatru-watchdog': {
      date: '2026-09-17',
      how: 'observed, not forced: six consecutive failing checks against monitor 30 from 10:57:41Z, then recovery',
      evidence: 'GlitchTip Down check 10:57:41 UTC; alert email 1a0af03f37fcab28 internalDate 1789642665000; ntfy nikatru-page f7dG9ua3o1Iy',
    },
    'duty.laptop.nikatru-pipeline-driver': {
      date: '2026-09-20',
      how: 'forced: full-replace PUT took monitor 33 to interval 60 / confirmationThreshold 1, then restored both after 56 s out of configuration',
      evidence: 'GlitchTip Down check 00:13:36 UTC; alert email 1a0bc295a6c9656d internalDate 1789863220000; ntfy nikatru-page ycYxHbG3raex',
    },
  };
  /** Puts those records into a COPY of the committed register — the real file is
   *  never written — so a lane's unlanded change can be replayed before it lands. */
  const withLaneDrills = (over = {}) => (register) => {
    for (const [id, drill] of Object.entries({ ...LANE_DRILLS, ...over })) {
      const row = (register.rows ?? []).find((r) => r.id === id);
      assert.ok(row?.absenceWatcher, `${id} must be a row that declares an absenceWatcher`);
      row.absenceWatcher.downTransitionDrill = drill;
    }
  };
  /** Pinned, because the rule below turns on the REAL clock and a test whose
   *  verdict changes with the hour it runs at is not a test. */
  const REAL_NOW = Date.parse('2026-09-20T23:59:59Z');

  test('drill-date replay fixture · a record the freeze CANNOT have seen is dated at the freeze; one it did see, and every dated tripwire, is untouched', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const input = {
      rows: [
        { id: 'later', absenceWatcher: { downTransitionDrill: { date: '2026-09-17', how: 'forced', evidence: 'run 34546423386' } } },
        { id: 'atFreeze', absenceWatcher: { downTransitionDrill: { date: '2026-08-05', how: 'forced', evidence: 'run 34546423386' } } },
        { id: 'humanLater', kind: 'recovery-path', lastDrill: '2026-09-18' },
        { id: 'humanBefore', kind: 'revert', lastDone: '2026-07-26' },
        { id: 'tripwire', absenceWatcher: { drillDue: '2026-10-09', drillLeadDays: 14 }, kind: 'duty', expires: '2027-01-01', degradedUntil: '2026-12-01' },
      ],
    };
    const { register, normalised } = replayRegister(input, f.now, REAL_NOW);
    const row = (id) => register.rows.find((r) => r.id === id);
    assert.equal(row('later').absenceWatcher.downTransitionDrill.date, '2026-09-11', 'a later record is dated at the fixture\'s own day');
    assert.equal(row('later').absenceWatcher.downTransitionDrill.how, 'forced', 'and NOTHING else about it moves — the shape is still graded in full');
    assert.equal(row('atFreeze').absenceWatcher.downTransitionDrill.date, '2026-08-05', 'a record run 34546423386 graded is handed over as it is');
    assert.equal(row('humanLater').lastDrill, '2026-09-11');
    assert.equal(row('humanBefore').lastDone, '2026-07-26');
    const t = row('tripwire');
    assert.deepEqual(
      [t.absenceWatcher.drillDue, t.expires, t.degradedUntil],
      ['2026-10-09', '2027-01-01', '2026-12-01'],
      'a dated TRIPWIRE is SUPPOSED to be in the future: rewriting one would make an armed deadline read as passed',
    );
    assert.equal(normalised.length, 2, normalised.join(' | '));
    assert.equal(input.rows[0].absenceWatcher.downTransitionDrill.date, '2026-09-17', 'the committed register the caller holds is never mutated');
  });

  test('drill-date replay fixture · a date the REAL clock has NOT reached is normalised by NOTHING — the replay cannot hide the defect the FUTURE limb exists for', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const input = { rows: [{ id: 'defect', kind: 'recovery-path', lastDrill: '2099-01-01', absenceWatcher: { downTransitionDrill: { date: '2099-01-01', how: 'forced', evidence: 'run 34546423386' } } }] };
    const { register, normalised } = replayRegister(input, f.now, REAL_NOW);
    assert.deepEqual(normalised, [], 'nothing past the real clock is a "later world" record — it is a claim about a thing that has not happened');
    assert.equal(register.rows[0].absenceWatcher.downTransitionDrill.date, '2099-01-01');
    assert.equal(register.rows[0].lastDrill, '2099-01-01');
  });

  test('drill-date replay fixture · the three drills dated 2026-09-17 and 2026-09-20 replay GREEN, and the guard READS each one as an observed down-transition', () => {
    const clean = replay(HOST.PR);
    assert.equal(clean.code, 0, `green control: today's register replays clean\n${clean.problems.join('\n')}`);
    const r = replay(HOST.PR, { OPS_REPLAY_REGISTER_FILE: replayRegisterFile(FIXTURE, { mutate: withLaneDrills(), realNowMs: REAL_NOW }) });
    assert.equal(r.code, 0, `a record written after the freeze must not read as a break:\n${r.problems.join('\n')}\n${r.out.slice(-3000)}`);
    assert.deepEqual(r.problems, []);
    // …and NOT vacuously: each drill is read, graded and PRINTED. Without the
    // substitution reaching the guard these three lines say `UNDRILLED`, which is
    // what the committed register still says on all three rows.
    for (const id of Object.keys(LANE_DRILLS)) {
      assert.match(
        r.out,
        new RegExp(`\\[14\\]O-4 — ${reEscape(id)}: .*down-transition observed 2026-09-11 \\(0d ago\\)`),
        `${id} must be read as observed:\n${r.out.split('\n').filter((l) => l.includes(id)).join('\n')}`,
      );
    }
  });

  test('drill-date replay fixture · RED CONTROL — a drill dated past the REAL clock is NOT normalised and the spawned replay goes red on it', () => {
    const over = { 'duty.laptop.nikatru-pipeline-driver': { ...LANE_DRILLS['duty.laptop.nikatru-pipeline-driver'], date: '2099-01-01' } };
    const r = replay(HOST.PR, { OPS_REPLAY_REGISTER_FILE: replayRegisterFile(FIXTURE, { mutate: withLaneDrills(over), realNowMs: REAL_NOW }) });
    assert.equal(r.code, 1, `a date nothing has reached must still BLOCK:\n${r.out.slice(-3000)}`);
    assert.equal(r.problems.length, 1, `the other two records — later than the freeze, earlier than the clock — must still be clean:\n${r.problems.join('\n')}`);
    assert.match(
      r.problems[0],
      /^duty\.laptop\.nikatru-pipeline-driver — `downTransitionDrill\.date` is in the FUTURE \(2099-01-01\)/,
      'the FUTURE limb must be the finding',
    );
  });

  test('O-NAME-CLEARANCE-SWEEP-RUN-BY-NOTHING · a scheduled workflow the freeze never read gets ONE clean run; a history it read is never filled in', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const register = JSON.parse(readFileSync(REPLAY_REGISTER, 'utf8'));
    const { world, derivedRuns } = replayWorld(f, register);
    assert.deepEqual(derivedRuns, ['name-clearance.yml'], 'only the scheduled workflow added after the freeze is derived');
    assert.equal(world.runs['name-clearance.yml'].length, 1);
    assert.equal(world.runs['name-clearance.yml'][0][1], 'schedule', 'the run carries the event the row filters on');
    assert.equal(world.runs['name-clearance.yml'][0][2], 'success');
    assert.equal(world.runs['name-clearance.yml'][0][3], new Date(Date.parse(f.now)).toISOString(), 'one clean run at the replayed instant');
    assert.equal(Object.hasOwn(world.runs, 'redeploy-stranded.yml'), false, 'a trigger row reads an empty history as it is live, and is not derived');
    assert.deepEqual(world.runs['trufflehog.yml'], f.runs['trufflehog.yml'], 'a history run 34546423386 read is handed over as it is');
    // RED CONTROL: drop a history the freeze READ, and it stays dropped.
    const { 'trufflehog.yml': _dropped, ...rest } = f.runs;
    const pure = replayWorld({ ...f, runs: rest }, register);
    assert.equal(Object.hasOwn(pure.world.runs, 'trufflehog.yml'), false, 'the derivation must never answer a workflow the freeze read');
    assert.deepEqual(pure.derivedRuns, ['name-clearance.yml']);
  });

  test('O-NAME-CLEARANCE-SWEEP-RUN-BY-NOTHING · a firstDue is replayed at the distance the REAL clock sees, so one the live guard refuses is still refused', () => {
    const f = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const fixtureMs = Date.parse(f.now);
    const ahead = 5 * 86_400_000;
    const committed = new Date(Date.now() + ahead).toISOString();
    const input = { rows: [{ id: 'boot', mechanism: { recordQuery: { reader: 'github-run-history', firstDue: committed } } }] };
    const { register, normalised, rebased } = replayRegister(input, f.now, REAL_NOW);
    const moved = Date.parse(register.rows[0].mechanism.recordQuery.firstDue);
    assert.ok(Math.abs(moved - fixtureMs - ahead) < 60_000, `five days ahead of the real clock is five days ahead of the fixture's: ${register.rows[0].mechanism.recordQuery.firstDue}`);
    assert.equal(rebased.length, 1, rebased.join(' | '));
    assert.deepEqual(normalised, [], 'a bootstrap is not a past-tense record, and is counted apart from them');
    assert.equal(input.rows[0].mechanism.recordQuery.firstDue, committed, 'the committed register the caller holds is never mutated');
    // RED CONTROL: a firstDue far past any cadence window of the REAL clock is
    // still far past it in the replay, so the spawned guard still refuses it.
    const over = (register) => {
      const row = register.rows.find((r) => r.id === 'duty.workflow.name-clearance.yml');
      assert.ok(row?.mechanism?.recordQuery?.firstDue, 'premise: the row carries a bootstrap');
      row.mechanism.recordQuery.firstDue = '2099-01-01T00:00:00Z';
    };
    const r = replay(HOST.PR, { OPS_REPLAY_REGISTER_FILE: replayRegisterFile(FIXTURE, { mutate: over }) });
    assert.equal(r.code, 1, r.out.slice(-3000));
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.match(r.problems[0], /^duty\.workflow\.name-clearance\.yml — `recordQuery\.firstDue: .+` is more than one cadence window/);
  });

  test('INV1 · GREEN CONTROL — ci.yml on pull_request exits 0 on today\'s state, and all four TRUE verdicts still PRINT with their remedy', () => {
    const r = replay(HOST.PR);
    assert.equal(r.code, 0, `a proposal must not be blocked by main's history:\n${r.problems.join('\n')}\n${r.out.slice(-3000)}`);
    assert.deepEqual(r.problems, []);
    for (const re of TRUE_FOUR) assert.ok(has(printedLines(r), re), `${re} must still PRINT in the proposal host:\n${printedLines(r).join('\n')}`);
    assert.ok(printedLines(r).filter((l) => /RED SINCE/.test(l)).every((l) => /dispatch the workflow once the cause is fixed/.test(l)), 'every RED carries its remedy');
    assert.match(r.out, /HOST POLICY — ADVISORY: ci\.yml on `pull_request` judges a PROPOSED CHANGE/);
    assert.match(r.out, /\[LIVE\] 4 live verdict\(s\) about the state of the world on this run: 0 BLOCKING in this host · 4 FAILING and PRINTED/);
  });

  test('INV2 · the SAME state on push to main — the ci-gate every deploy lane polls — still REFUSES, and says why', () => {
    const r = replay(HOST.PUSH);
    assert.equal(r.code, 1, r.out.slice(-3000));
    for (const re of [E2E_STALE, E2E_RED]) assert.ok(has(r.problems, re), `${re} must BLOCK the commit deploys poll:\n${r.problems.join('\n')}`);
    // ⏱ 2026-09-18 — the pipeline driver is PAGE-ONLY by owner decision
    // (O-LAPTOP-ROUTINES-DIE-OVERNIGHT, checkLiveVerdictScopes): a closed laptop
    // lid pages in ops-watch (next test) but no longer holds the deploy gate. It
    // must PRINT here, never vanish.
    assert.equal(has(r.problems, PIPELINE), false, 'the laptop-bound driver must not block the deploy gate (page-only)');
    const drv = r.printed.find((p) => PIPELINE.test(p.line));
    assert.ok(drv, 'and it must PRINT, not vanish');
    assert.match(drv.why, /PAGE-ONLY/);
    assert.equal(has(r.problems, BP_RED), false, 'build-platforms.yml is self-gated on this very check: blocking here is the 2026-09-09 livelock');
    const bp = r.printed.find((p) => BP_RED.test(p.line));
    assert.ok(bp, 'and it must PRINT, not vanish');
    assert.match(bp.why, /SELF-GATED/);
    assert.match(r.out, /HOST POLICY — ENFORCING: ci\.yml on `push` — this run's exit code decides `ci-gate`[\s\S]*refuses to ship that commit unless the check passed[\s\S]*\(INV2\)/);
  });

  test('INV2 · ops-watch — the page — fails on the same state, the self-gated lane included; and off Actions everything blocks', () => {
    const ops = replay(HOST.OPS);
    assert.equal(ops.code, 1, ops.out.slice(-3000));
    for (const re of TRUE_FOUR) assert.ok(has(ops.problems, re), `${re} must fail ops-watch:\n${ops.problems.join('\n')}`);
    assert.deepEqual(ops.printed, [], 'ops-watch feeds no gate, so nothing is exempt there');
    const off = replay(HOST.OFF);
    assert.equal(off.code, 1);
    assert.equal(off.problems.length, 4, off.problems.join('\n'));
  });

  test('INV3 · the four duties aged only by a sibling limb are FRESH in every host, each judged by its OWN unit', () => {
    for (const [name, host] of Object.entries({ PR: HOST.PR, PUSH: HOST.PUSH, OPS: HOST.OPS })) {
      const r = replay(host);
      for (const id of WAS_STALE) {
        assert.equal(r.problems.some((l) => l.startsWith(`${id} —`)), false, `${name}: ${id} is blocking, but the unit that performs it succeeded in the newest scheduled run`);
        assert.equal(r.printed.some((p) => p.line.startsWith(`${id} —`)), false, `${name}: ${id} is still printed as failing`);
        assert.match(r.out, new RegExp(`\\[14\\]O-3 — ${reEscape(id)} — queried: newest success 2\\.7h ago, inside \\[1d x 1\\.5 = 36\\.0h\\]\\. run 34533663312 \\(schedule on main\\)`), `${name}: ${id} must be judged by run 34533663312's unit`);
      }
      assert.match(r.out, /\[INV3\] ops-watch\.yml — 4 duty rows, each judged by its OWN unit/);
    }
  });

  test('INV4 · ops-watch.yml\'s own row needs no green ops-watch — it is fresh INSIDE a red ops-watch run', () => {
    const r = replay(HOST.OPS);
    assert.equal(r.code, 1, 'ops-watch is red for the four true verdicts');
    assert.match(r.out, /\[14\]O-3 — duty\.workflow\.ops-watch\.yml — queried: newest success 2\.7h ago/);
    assert.match(r.out, /\[14\]O-3b — duty\.workflow\.ops-watch\.yml — ops-watch\.yml on main \(job\(s\) status \+ supabase-drift \+ prod-provenance \+ runner-budget \+ glitchtip \+ alert \+ digest of ops-watch\.yml\): the newest run in which that unit reached a verdict is run 34544690996/);
    assert.equal(r.problems.some((l) => l.startsWith('duty.workflow.ops-watch.yml —')), false);
  });

  test('INV5 · a proposal is believed only from a host that declares it — pull_request claimed inside ops-watch.yml still refuses', () => {
    const r = replay({ ...HOST.OPS, GITHUB_EVENT_NAME: 'pull_request' });
    assert.equal(r.code, 1, r.out.slice(-2000));
    assert.match(r.out, /HOST POLICY — ENFORCING: ops-watch\.yml on `pull_request` — but \.github\/workflows\/ops-watch\.yml declares no `pull_request`/);
  });

  test('⏱ 2026-09-11 · COUNTED — push and a pull request with no known base make the SAME requests, so the not-read path has not leaked into either', () => {
    const counted = (host) => {
      const file = join(TMP, `freeze-count-${seq++}.json`);
      const r = replay(host, { OPS_REPLAY_COUNT_FILE: file });
      return { ...r, counts: JSON.parse(readFileSync(file, 'utf8')) };
    };
    const push = counted(HOST.PUSH);
    const pr = counted(HOST.PR);
    assert.ok(push.counts.github > 0, push.out.slice(-2000));
    assert.deepEqual(pr.counts, push.counts, `PR ${JSON.stringify(pr.counts)} vs push ${JSON.stringify(push.counts)}`);
    assert.match(pr.out, /\[LIVE\] reads made on this host: which files this change touches could not be established \(GITHUB_BASE_REF is not set/);
    assert.doesNotMatch(push.out, /\[LIVE\] (NOT READ|reads made)/);
  });

  test('INV6 · a GitHub API that refuses every read is COVERAGE LOST — exit 2 in the proposal host AND on push, never 0 and never 1', () => {
    for (const host of [HOST.PR, HOST.PUSH]) {
      const r = replay(host, { OPS_REPLAY_GITHUB_STATUS: '403' });
      assert.equal(r.code, 2, r.out.slice(-3000));
      assert.match(r.out, /✗ COVERAGE LOST — \d+ measurement failure\(s\)/);
      // 9 → 10 on 2026-09-23: duty.workflow.redeploy-stranded.yml is RED-SINCE graded.
      // 10 → 11 on 2026-09-24: so is duty.workflow.name-clearance.yml, a workflow on a clock.
      assert.match(r.out, /every one of the 11 RED-SINCE read\(s\) against the GitHub API was unreadable on this run \(first reason: the query threw: GitHub API returned 403/);
    }
  });

  test('a TRUE failure still fails — e2e.yml genuinely red on main, no repair in flight, blocks the push gate and the page and names its exit', () => {
    for (const host of [HOST.PUSH, HOST.OPS]) {
      const r = replay(host);
      const red = r.problems.find((l) => E2E_RED.test(l));
      assert.ok(red, r.problems.join('\n'));
      assert.match(red, /24\.0h EARLIER/);
      assert.match(red, /dispatch the workflow once the cause is fixed/);
    }
  });
});

describe('INV3 · a duty is judged by the unit that performs it — the pure half', () => {
  const REPO = resolve(CI_DIR, '..', '..');
  const byFile = () => new Map(parseAllWorkflows(REPO).map((wf) => [String(wf.rel).split('/').pop(), wf]));
  const OPS_WF = () => byFile().get('ops-watch.yml');
  const q = (unit, over = {}) => ({ reader: 'github-run-history', workflow: 'ops-watch.yml', event: 'schedule', headBranch: 'main', unit, ...over });
  const RUN = { id: 34533663312, conclusion: 'failure', updated_at: '2026-09-10T21:44:41Z', head_branch: 'main' };
  const job = (name, conclusion, steps) => ({ name, status: 'completed', conclusion, steps });
  const HB = 'Every declared duty is fresh — the heartbeat rail AND the register';
  const JOBS = (over = {}) => [
    job(HB, 'failure', [
      { name: 'The whole ops register — every duty, not just the heartbeat-backed ones', conclusion: 'failure' },
      { name: 'Read the heartbeat table from OUTSIDE Cloudflare', conclusion: 'skipped' },
      { name: 'Live D1 still runs every statement the Workers send it', conclusion: 'success' },
      { name: "Judge whether the analytics rail's silence is a FAULT", conclusion: 'success' },
    ]),
    job('The Cloudflare Pages builds nobody else can see actually landed', over.pages ?? 'success'),
    job('Every enumerated surface produced its expected output', over.status ?? 'success'),
    job('The live auth config still matches what the repo recorded', over.drift ?? 'success'),
    job('Every row in production traces to a released build', 'success'),
    job('Actions quota cannot silently stop the scheduled proofs', 'success'),
    job('The live ops half — monitors, alarm chains, provider parity, GCP scope', 'success'),
    job('Weekly digest', over.digest ?? 'skipped'),
    job('Open or refresh the ops-watch issue', 'success'),
  ];
  const OPS_UNIT = { jobs: ['status', 'supabase-drift', 'prod-provenance', 'runner-budget', 'glitchtip', 'alert', 'digest'] };

  test('GREEN CONTROL — a step that succeeded inside a job that FAILED is a success of THAT step', () => {
    const c = unitConclusion(q({ job: 'heartbeats', step: "Judge whether the analytics rail's silence is a FAULT" }), RUN, JOBS(), OPS_WF());
    assert.equal(c.verdict, 'success', c.detail);
  });

  test('🔴 the WHOLE RUN of the same answer is a FAILURE — the reading that aged four duties at once', () => {
    assert.equal(unitConclusion(q('run'), RUN, JOBS(), OPS_WF()).verdict, 'failure');
  });

  test('a jobs unit: all green is success (a job skipped by its OWN `if:` is neutral), one failure fails it, a job skipped with no `if:` says nothing', () => {
    assert.equal(unitConclusion(q(OPS_UNIT), RUN, JOBS(), OPS_WF()).verdict, 'success', 'digest is skipped by its own if: and must not sink the unit');
    const red = unitConclusion(q(OPS_UNIT), RUN, JOBS({ drift: 'failure' }), OPS_WF());
    assert.equal(red.verdict, 'failure');
    assert.match(red.detail, /job supabase-drift concluded failure/);
    assert.equal(unitConclusion(q(OPS_UNIT), RUN, JOBS({ status: 'skipped' }), OPS_WF()).verdict, 'neutral', 'status has no if:, so a skip means something ahead of it failed or was cancelled — no verdict');
    assert.equal(unitConclusion(q(OPS_UNIT), RUN, JOBS({ status: 'cancelled' }), OPS_WF()).verdict, 'neutral', 'a cancelled job renders no verdict');
    assert.equal(unitConclusion(q({ jobs: ['pages-deployments'] }), RUN, JOBS({ pages: 'timed_out' }), OPS_WF()).verdict, 'failure');
  });

  test('a step or job the run never reported renders no verdict — absent is never success', () => {
    assert.equal(unitConclusion(q({ job: 'heartbeats', step: 'Read the heartbeat table from OUTSIDE Cloudflare' }), RUN, JOBS(), OPS_WF()).verdict, 'neutral', 'a skipped step did not perform its duty');
    assert.equal(unitConclusion(q({ job: 'heartbeats', step: 'No such step' }), RUN, JOBS(), OPS_WF()).verdict, 'neutral');
    assert.equal(unitConclusion(q({ jobs: ['pages-deployments'] }), RUN, [], OPS_WF()).verdict, 'neutral');
    assert.equal(unitConclusion(q({ jobs: ['pages-deployments'] }), RUN, undefined, OPS_WF()).verdict, 'neutral');
    assert.equal(unitConclusion(q({ jobs: ['pages-deployments'] }), RUN, JOBS(), null).verdict, 'neutral', 'an unparsed workflow matches nothing');
  });

  test('apiJobMatcher reads a display name, a matrix leg and an expression the way the API reports them', () => {
    assert.equal(apiJobMatcher('build', { displayName: 'Build' })('Build'), true);
    assert.equal(apiJobMatcher('build', { displayName: 'Build' })('Build (android)'), true, 'a matrix leg carries its values in parentheses');
    assert.equal(apiJobMatcher('build', { displayName: 'Build' })('Builder'), false);
    assert.equal(apiJobMatcher('pkg', { displayName: 'package · ${{ matrix.tool }} · ${{ matrix.os }}' })('package · cli · ubuntu'), true);
    assert.equal(apiJobMatcher('pkg', { displayName: 'package · ${{ matrix.tool }}' })('packages · cli'), false);
    assert.equal(apiJobMatcher('gate', { displayName: null })('gate'), true, 'a job with no name: is reported by its id');
  });

  test('decideUnitFreshness / decideUnitRedSince — the newest DECISIVE run decides, and a full page is measured, not assumed', () => {
    const e = (id, at, verdict) => ({ run: { id, updated_at: at }, c: { verdict, detail: `run ${id}` } });
    const fresh = decideUnitFreshness(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'neutral'), e(2, '2026-09-10T19:00:00Z', 'success')], false, 'o/r');
    assert.equal(fresh.lastSuccessMs, Date.parse('2026-09-10T19:00:00Z'));
    const full = decideUnitFreshness(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'failure'), e(2, '2026-09-08T19:00:00Z', 'failure')], true, 'o/r');
    assert.ok(Number.isNaN(full.lastSuccessMs));
    assert.equal(full.noSuccessSinceMs, Date.parse('2026-09-08T19:00:00Z'));
    assert.match(full.detail, /NO success of job\(s\) status/);
    assert.equal(decideUnitFreshness(q(OPS_UNIT), [], false, 'o/r').noSuccessSinceMs, undefined, 'an empty history is "never", and says so');

    const green = decideUnitRedSince(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'neutral'), e(2, '2026-09-10T19:00:00Z', 'success'), e(1, '2026-09-10T17:00:00Z', 'failure')], false);
    assert.equal(green.failure, null);
    assert.equal(green.newestDecisive, true);
    assert.equal(classifyRedSince({ id: 'x', mechanism: { recordQuery: q(OPS_UNIT) } }, green).verdict, 'green');
    const red = decideUnitRedSince(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'failure'), e(2, '2026-09-10T19:00:00Z', 'success')], false);
    assert.deepEqual([red.failure.id, red.success.id], [3, 2]);
    assert.equal(classifyRedSince({ id: 'x', mechanism: { recordQuery: q(OPS_UNIT) } }, red).verdict, 'red');
    const beyond = decideUnitRedSince(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'failure'), e(2, '2026-09-08T19:00:00Z', 'failure')], true);
    const c = classifyRedSince({ id: 'x', mechanism: { recordQuery: q(OPS_UNIT) } }, beyond);
    assert.equal(c.verdict, 'red', 'a full page of failures is RED, never blind');
    assert.match(c.line, /RED SINCE 2026-09-10T21:00:00Z AT THE LATEST/);
    const blind = decideUnitRedSince(q(OPS_UNIT), [e(3, '2026-09-10T21:00:00Z', 'failure')], false);
    assert.equal(classifyRedSince({ id: 'x', mechanism: { recordQuery: q(OPS_UNIT) } }, blind).verdict, 'blind');
  });

  test('classifyRunRecord — a full page with no success of its unit measures the silence back to its oldest run', () => {
    const NOWU = Date.parse('2026-09-11T00:26:07Z');
    const row = { id: 'duty.unit', cadence: '1d', mechanism: { recordQuery: { reader: 'github-run-history' } } };
    const stale = classifyRunRecord(row, { lastSuccessMs: NaN, noSuccessSinceMs: NOWU - 40 * 3_600_000, detail: 'd' }, NOWU, 1.5);
    assert.equal(stale.verdict, 'fail');
    assert.match(stale.line, /the newest SUCCESSFUL run is older than every run it read, which reach back 40\.0h — outside its own window/);
  });

  test('checkRunUnits REFUSES every shape that would let one duty age another — and the committed register holds', () => {
    const files = byFile();
    const topo = gateTopology(REPO);
    const row = (id, unit, workflow = 'ops-watch.yml') => ({ id, kind: 'duty', cadence: '1d', mechanism: { recordQuery: q(unit, { workflow }) } });
    const errs = (...rows) => checkRunUnits({ rows }, files, topo).errors.join('\n');
    assert.match(errs(row('a', undefined, 'e2e.yml')), /names no `unit`/);
    assert.match(errs(row('a', 'run', 'e2e.yml'), row('b', 'run', 'e2e.yml')), /A run that performs several duties is the unit of none of them/);
    assert.match(errs(row('a', { jobs: ['nope'] })), /names job\(s\) `nope`, which \.github\/workflows\/ops-watch\.yml does not declare/);
    assert.match(errs(row('a', { job: 'heartbeats', step: 'Judge whether the analytics rail is a fault' })), /is not the name of a step in job heartbeats/);
    assert.match(errs(row('a', { jobs: [] })), /`unit\.jobs` is EMPTY/);
    assert.match(errs(row('a', { jobs: 'status' })), /is not "run", \{ "jobs"/);
    assert.match(errs(row('a', { jobs: ['status'] }), row('b', { jobs: ['status'] })), /job status of ops-watch\.yml is already the unit of a/);
    assert.match(errs(row('a', { jobs: ['heartbeats'] }), row('b', { job: 'heartbeats', step: "Judge whether the analytics rail's silence is a FAULT" })), /the units overlap/);
    assert.match(errs(row('a', { jobs: ['status'] }), row('b', { jobs: ['pages-deployments'] })), /job\(s\) supabase-drift · prod-provenance · runner-budget · glitchtip · alert · digest are the unit of none/);
    const real = JSON.parse(readFileSync(resolve(CI_DIR, '..', 'ops', 'register.json'), 'utf8'));
    const out = checkRunUnits(real, files, topo);
    assert.deepEqual(out.errors, []);
    const runRows = real.rows.filter((r) => r?.mechanism?.recordQuery?.reader === 'github-run-history');
    assert.ok(runRows.length >= 12, `expected every workflow row and the three ops-watch duties; found ${runRows.length}`);
    for (const r of runRows) assert.ok(unitOf(r.mechanism.recordQuery).declared, `${r.id} names no unit`);
    assert.ok(out.prints.some((p) => /\[INV3\] ops-watch\.yml — 4 duty rows/.test(p)), 'the shared workflow and its units must print on every run');
  });

  test('jobSteps reads the committed heartbeats job the way the API names its steps', () => {
    const steps = jobSteps(OPS_WF().jobs.get('heartbeats'));
    const named = steps.filter((s) => s.name);
    assert.deepEqual(named.map((s) => s.name), [
      'The whole ops register — every duty, not just the heartbeat-backed ones',
      'Read the heartbeat table from OUTSIDE Cloudflare',
      'Live D1 still runs every statement the Workers send it',
      "Judge whether the analytics rail's silence is a FAULT",
      'Every name-clearance record is inside its 30-day ceiling',
    ]);
    assert.deepEqual(named.map((s) => s.runsGuard), [true, false, false, false, false]);
    // ⏱ 2026-09-23 — this pinned `null`, the defect itself: with no condition the
    // heartbeat read was SKIPPED in every red register run (O-OPS-WATCH-HEARTBEAT-
    // READER-SKIPPED). It now runs whatever the register concluded.
    assert.match(named[1].cond, /!cancelled\(\)/, 'O-OPS-WATCH-HEARTBEAT-READER-SKIPPED: the heartbeat reader must carry !cancelled()');
    assert.match(named[2].cond, /!cancelled\(\)/);
    assert.match(named[4].cond, /!cancelled\(\)/, 'the name-clearance ceiling must be read after a red register too');
    assert.equal(describeUnit({ workflow: 'w.yml', unit: RUN_UNIT }), 'the whole w.yml run');
  });

  test('INV6 · githubDarkness — every RED-SINCE read unreadable is COVERAGE LOST; one readable read is not', () => {
    const dark = new Map([['a', { unreadable: true, why: 'GitHub API returned 401' }], ['b', { unreadable: true, why: 'x' }]]);
    assert.match(githubDarkness(dark), /every one of the 2 RED-SINCE read\(s\)/);
    assert.equal(githubDarkness(new Map([['a', { unreadable: true, why: 'x' }], ['b', { success: null, failure: null }]])), null);
    assert.equal(githubDarkness(new Map()), null, 'an empty domain is refused by its own limb, not by this one');
  });
});

// ⏱ 2026-09-25 [ADR 095 §4] · the deploy lanes as post-gate CALL jobs of the gate
// workflow. A fixture tree, not the real one: the real ci.yml gains its call jobs
// in the commit that moves the lanes, and these rules must hold before it does.
describe('post-gate call jobs of the gate workflow — read, graded, admitted (ADR 095 §4)', () => {
  const CI_YML = [
    'name: CI',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  guards:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: The ops register',
    '        run: node tooling/ci/assert-ops-register.mjs',
    '  ci-gate:',
    '    name: ci-gate',
    '    if: always()',
    '    needs: [guards]',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo gate',
    '  deploy-web:',
    '    needs: [ci-gate]',
    "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    '    uses: ./.github/workflows/deploy-web.yml',
    '    secrets: inherit',
    '  deploy-workers:',
    '    needs: [ci-gate]',
    "    if: github.event_name == 'push' && github.ref == 'refs/heads/main'",
    '    uses: ./.github/workflows/deploy-workers.yml',
    '    secrets: inherit',
    '  late:',
    '    needs: [ci-gate]',
    "    if: github.event_name == 'push'",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo late',
    '',
  ].join('\n');
  const CALLEE = (name) => [`name: ${name}`, 'on:', '  workflow_call:', 'jobs:', `  ${name}:`, '    runs-on: ubuntu-latest', '    steps:', '      - run: echo deploy', ''].join('\n');
  let root;
  let files;
  let topo;
  before(() => {
    root = join(TMP, 'post-gate');
    mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
    mkdirSync(join(root, 'tooling', 'ci'), { recursive: true });
    writeFileSync(join(root, '.github', 'workflows', 'ci.yml'), CI_YML);
    writeFileSync(join(root, '.github', 'workflows', 'deploy-web.yml'), CALLEE('deploy-web'));
    writeFileSync(join(root, '.github', 'workflows', 'deploy-workers.yml'), CALLEE('deploy-workers'));
    writeFileSync(join(root, 'tooling', 'ci', 'assert-gate-passed.mjs'), "const GATE = 'ci-gate';\n");
    files = new Map(parseAllWorkflows(root).map((wf) => [String(wf.rel).split('/').pop(), wf]));
    topo = gateTopology(root);
  });
  const CI = () => files.get('ci.yml');
  const q = (jobs, over = {}) => ({ reader: 'github-run-history', workflow: 'ci.yml', event: 'push', headBranch: 'main', unit: { jobs }, ...over });
  const row = (id, jobs, over = {}) => ({ id, kind: 'duty', cadence: 'trigger', mechanism: { recordQuery: q(jobs, over) } });
  const RUN = { id: 3843, conclusion: 'success', updated_at: '2026-09-25T08:00:00Z', head_branch: 'main', event: 'push' };
  const j = (name, conclusion) => ({ name, status: 'completed', conclusion });
  const GATE_OK = j('ci-gate', 'success');

  test('the fixture reads as intended: ci.yml is the gate workflow, its gate job is ci-gate, and exactly the two call jobs are post-gate', () => {
    assert.equal(topo.gateWorkflow, 'ci.yml', topo.why.join(' · '));
    assert.ok(topo.guardHosts.has('ci.yml'));
    assert.equal(gateJobOf(CI(), topo), 'ci-gate');
    assert.equal(gateJobOf(files.get('deploy-web.yml'), topo), null, 'only the gate workflow has a gate job');
    const pg = postGateAdmission(files, topo);
    assert.deepEqual([pg.gateWorkflow, pg.gateJob, [...pg.jobs]], ['ci.yml', 'ci-gate', ['deploy-web', 'deploy-workers']], '`late` needs the gate with a wider `if:`, so it is not post-gate');
    assert.equal(postGateAdmission(files, { ...topo, gateName: 'no-such-gate' }), null);
    assert.equal(isCallJob(CI().jobs.get('deploy-web')), true);
    assert.equal(isCallJob(CI().jobs.get('guards')), false, 'a `uses:` inside a step is not a call job');
  });

  test('the call-job arm of apiJobMatcher: the lone entry and every `<callJob> / …` child, and no other job', () => {
    const web = apiJobMatcher('deploy-web', CI().jobs.get('deploy-web'));
    assert.equal(web('deploy-web'), true);
    assert.equal(web('deploy-web / deploy-web'), true);
    assert.equal(web('deploy-web / Build and publish'), true);
    assert.equal(web('deploy-workers / deploy-workers'), false);
    assert.equal(web('deploy-webx / deploy-web'), false);
    assert.equal(apiJobMatcher('guards', CI().jobs.get('guards'))('guards / x'), false, 'a job that calls nothing has no children');
  });

  test('G4 shape 1 — children present: the children are graded', () => {
    const ok = unitConclusion(q(['deploy-web']), RUN, [GATE_OK, j('deploy-web / deploy-web', 'success')], CI());
    assert.equal(ok.verdict, 'success', ok.detail);
    const red = unitConclusion(q(['deploy-web']), RUN, [GATE_OK, j('deploy-web / deploy-web', 'success'), j('deploy-web / smoke', 'failure')], CI());
    assert.equal(red.verdict, 'failure');
    assert.match(red.detail, /job deploy-web concluded failure/);
  });

  test('G4 shape 2 — exactly one entry named just the call job, `skipped`: the lane was skipped, which says nothing', () => {
    const c = unitConclusion(q(['deploy-web']), RUN, [GATE_OK, j('deploy-web', 'skipped')], CI());
    assert.equal(c.verdict, 'neutral', c.detail);
  });

  test('G4 shape 3 — ZERO entries for the call job: COVERAGE LOST (exit 2), naming the unmeasured claim, through every layer', () => {
    const c = unitConclusion(q(['deploy-web']), RUN, [GATE_OK, j('deploy-workers / deploy-workers', 'success')], CI());
    assert.equal(c.verdict, 'lost', c.detail);
    assert.ok(c.detail.includes(G4_UNMEASURED), c.detail);
    assert.equal(G4_UNMEASURED, 'G4: whole-call-job skip shape unmeasured (cloud-drafts/pd2b/d2b2-ruling-verify.md)');
    // Any other own-entry shape is unmeasured too: one entry, not skipped, no child.
    assert.equal(unitConclusion(q(['deploy-web']), RUN, [j('deploy-web', 'success')], CI()).verdict, 'lost');
    assert.equal(unitConclusion(q(['deploy-web']), RUN, [j('deploy-web', 'skipped'), j('deploy-web', 'skipped')], CI()).verdict, 'lost');

    const e = (id, at, verdict) => ({ run: { id, updated_at: at }, c: { verdict, detail: verdict === 'lost' ? c.detail : `run ${id}` } });
    const probe = decideUnitRedSince(q(['deploy-web']), [e(3, '2026-09-25T08:00:00Z', 'lost'), e(2, '2026-09-25T07:00:00Z', 'success')], false);
    assert.equal(probe.lost.id, 3);
    const r = row('duty.workflow.deploy-web.yml', ['deploy-web']);
    const cl = classifyRedSince(r, probe);
    assert.equal(cl.verdict, 'lost');
    assert.match(cl.line, /COVERAGE LOST for this row, neither a pass nor a RED/);
    const out = evaluateRedSince({ rows: [r] }, new Map([[r.id, probe]]), new Set(), postGateAdmission(files, topo));
    assert.deepEqual(out.live.map((l) => [l.id, l.code]), [[r.id, 2]], 'a lost row is a live verdict with exit 2, never a pass');
    assert.ok(out.errors.some((l) => l.includes(G4_UNMEASURED)));
    assert.equal(out.stats.lost, 1);

    // A lost run OLDER than a failure already found cannot un-red it: the scan reads past it for the success term.
    const red = decideUnitRedSince(q(['deploy-web']), [e(4, '2026-09-25T09:00:00Z', 'failure'), e(3, '2026-09-25T08:00:00Z', 'lost'), e(2, '2026-09-25T07:00:00Z', 'success')], false);
    assert.deepEqual([red.failure.id, red.success.id, red.lost], [4, 2, undefined]);
    assert.equal(classifyRedSince(r, red).verdict, 'red');
  });

  // ⏱ 2026-09-25 [ADR 095 §4] PD2B2-4 · THE THREE NEUTRAL ARMS of the zero-entry shape.
  // RUN_3848 is main CI run 3848 (id 36106900356, c02e6d33) as the /jobs list gave
  // it: 31 jobs, ci-gate success, no deploy entry — the run every RED-SINCE read
  // reaches first after the merge. Names and conclusions only.
  const RUN_3848_JOBS = [
    ['Guards — the guards can still fail', 'success'],
    ['Guards — platform, data and ops', 'success'],
    ['Shared site build', 'success'],
    ['App brick (stamp both variants + analyze + validate the clone contract)', 'success'],
    ['Guards — privacy, legal and money', 'success'],
    ['extensions / secrets-scan', 'success'],
    ['extensions / The shared contract has not drifted', 'success'],
    ['Design tokens (build + drift, all three outputs)', 'success'],
    ['Static sites (functions parse + required files)', 'success'],
    ['Workspace gate (melos analyze + test)', 'success'],
    ['extensions / Gate self-test (do the gates bite?)', 'success'],
    ['extensions / The extensions are still build-free', 'success'],
    ['extensions / Proof freshness (is the weekly cron alive?)', 'success'],
    ['extensions / Discover affected tools', 'success'],
    ['extensions / Gate inventory (which gates exist)', 'success'],
    ['extensions / templates parse (the tree every future tool is stamped from)', 'success'],
    ['extensions / catalogue', 'success'],
    ['extensions / gates · ${{ matrix.tool }}', 'skipped'],
    ['extensions / sims · ${{ matrix.tool }} · node ${{ matrix.node }}', 'skipped'],
    ['Android artifacts (built, inspected, discarded) (subscriptiontracker)', 'success'],
    ['extensions / ci-required', 'success'],
    ['extensions / package · ${{ matrix.tool }} · ${{ matrix.target }} · ${{ matrix.os }}', 'skipped'],
    ['Content pipeline (recipe -> pack -> sign -> gate)', 'success'],
    ['Guards — store, release and versioning', 'success'],
    ['Security — secret and workflow scanners', 'success'],
    ['Derive the Android app set from the pub workspace', 'success'],
    ['subscriptiontracker-api Worker (typecheck + test + dry-run)', 'success'],
    ['extensions / core sims', 'success'],
    ['platform Worker (typecheck + test + dry-run)', 'success'],
    ['Guards — chassis, app surface and packages', 'success'],
    ['ci-gate', 'success'],
  ].map(([name, conclusion]) => j(name, conclusion));
  const REF = (file) => ({ path: `globalonlinedeveloper/Nikatru_Platform_Public/.github/workflows/${file}@c02e6d3304b4024208ac3c69b25654f0bf923f00` });
  const RUN_3848 = { id: 36106900356, conclusion: 'success', updated_at: '2026-09-25T07:53:19Z', head_branch: 'main', event: 'push', referenced_workflows: [REF('extensions-ci.yml')] };

  test('RC-a — run 3848 predates the call (referenced_workflows names only extensions-ci.yml), a push to main: neutral, where it was lost', () => {
    assert.equal(RUN_3848_JOBS.length, 31);
    assert.equal(RUN_3848_JOBS.find((x) => x.name === 'ci-gate')?.conclusion, 'success');
    for (const id of ['deploy-web', 'deploy-workers']) {
      const c = unitConclusion(q([id]), RUN_3848, RUN_3848_JOBS, CI());
      assert.equal(c.verdict, 'neutral', c.detail);
      assert.ok(c.detail.includes(`(a) its referenced_workflows name no "/.github/workflows/${id}.yml@"`), c.detail);
    }
  });

  test('RC-a2 — the same list, referenced_workflows ALSO naming deploy-web.yml: lost (G4 fail-closed)', () => {
    const run = { ...RUN_3848, referenced_workflows: [REF('extensions-ci.yml'), REF('deploy-web.yml')] };
    const c = unitConclusion(q(['deploy-web']), run, RUN_3848_JOBS, CI());
    assert.equal(c.verdict, 'lost', c.detail);
    assert.ok(c.detail.includes(G4_UNMEASURED), c.detail);
    assert.equal(unitConclusion(q(['deploy-workers']), run, RUN_3848_JOBS, CI()).verdict, 'neutral', 'deploy-workers.yml is still unreferenced');
  });

  test('RC-a3 — no referenced_workflows key at all: lost, because arm (a) cannot fire for it', () => {
    const { referenced_workflows: _drop, ...run } = RUN_3848;
    assert.equal('referenced_workflows' in run, false);
    const c = unitConclusion(q(['deploy-web']), run, RUN_3848_JOBS, CI());
    assert.equal(c.verdict, 'lost', c.detail);
    assert.equal(unitConclusion(q(['deploy-web']), { ...run, referenced_workflows: null }, RUN_3848_JOBS, CI()).verdict, 'lost', 'a non-array is not an array');
  });

  test('RC-b — the post-gate if: cannot hold (a schedule run, or a push off main), zero entries: neutral', () => {
    const refs = [REF('extensions-ci.yml'), REF('deploy-web.yml')];
    const sched = unitConclusion(q(['deploy-web']), { ...RUN_3848, event: 'schedule', referenced_workflows: refs }, RUN_3848_JOBS, CI());
    assert.equal(sched.verdict, 'neutral', sched.detail);
    assert.match(sched.detail, /\(b\) its `if:` is POST_GATE_IF and the run is "schedule" on "main"/);
    const branch = unitConclusion(q(['deploy-web']), { ...RUN_3848, head_branch: 'feature', referenced_workflows: refs }, RUN_3848_JOBS, CI());
    assert.equal(branch.verdict, 'neutral', branch.detail);
  });

  test('RC-c — ci-gate did not pass, the callee referenced, zero entries: neutral (that red is the gate row)', () => {
    const run = { ...RUN_3848, conclusion: 'failure', referenced_workflows: [REF('deploy-web.yml'), REF('deploy-workers.yml')] };
    const jobs = RUN_3848_JOBS.map((x) => (x.name === 'ci-gate' ? j('ci-gate', 'failure') : x));
    const c = unitConclusion(q(['deploy-web']), run, jobs, CI());
    assert.equal(c.verdict, 'neutral', c.detail);
    assert.match(c.detail, /\(c\) the job it needs, ci-gate, came back "failure"/);
    assert.equal(unitConclusion(q(['deploy-web']), { ...run, conclusion: 'success' }, RUN_3848_JOBS, CI()).verdict, 'lost', 'the same run with ci-gate success stays lost');
  });

  test('collectRunJobs walks every page to total_count, and a list that does not add up THROWS', async () => {
    const JOB = (n) => Array.from({ length: n }, (_, i) => j(`job ${i}`, 'success'));
    const pages = [];
    const two = await collectRunJobs(1, async (p) => { pages.push(p); return p === 1 ? { total_count: 101, jobs: JOB(100) } : { total_count: 101, jobs: JOB(1) }; });
    assert.equal(two.length, 101);
    assert.deepEqual(pages, [1, 2]);
    const reads = [];
    assert.equal((await collectRunJobs(1, async (p) => { reads.push(p); return { total_count: 3, jobs: JOB(3) }; })).length, 3);
    assert.deepEqual(reads, [1], 'a one-page list is one read');
    await assert.rejects(collectRunJobs(1, async () => ({ jobs: JOB(3) })), /without a total_count/);
    await assert.rejects(collectRunJobs(1, async () => ({ total_count: 3 })), /without a jobs array/);
    await assert.rejects(collectRunJobs(1, async (p) => ({ total_count: 150, jobs: p === 1 ? JOB(100) : [] })), /page 2 came back empty after 100/);
    await assert.rejects(collectRunJobs(1, async () => ({ total_count: 5000, jobs: JOB(100) })), new RegExp(`more than ${RUN_JOB_PAGES * 100} jobs`));
  });

  test('INV4 — a post-gate job is walked THROUGH the gate aggregator to this guard, and routes OWN HOST', () => {
    const why = unitNeedsGuard(CI(), unitOf(q(['deploy-web'])), topo);
    assert.match(why, /job deploy-web carries the post-gate `if:` and needs ci-gate, the gate aggregator, which RUNS after a failure but does not PASS after one — job ci-gate needs guards and concludes failure when it fails — job guards runs tooling\/ci\/assert-ops-register\.mjs$/);
    assert.equal(unitNeedsGuard(CI(), unitOf(q(['deploy-web']))), null, 'with no topology the walk stops at the always() aggregator, as before');
    const hosts = unitNeedsHosts(row('duty.workflow.deploy-web.yml', ['deploy-web']), topo, files);
    assert.deepEqual(hosts.map((h) => h.host), ['ci.yml']);
    assert.match(hosts[0].why, /^OWN HOST/);
  });

  test('INV4 + INV3 in checkRunUnits: an all-post-gate unit PRINTS its exemption; every post-gate job needs a row', () => {
    const both = [row('duty.workflow.deploy-web.yml', ['deploy-web']), row('duty.workflow.deploy-workers.yml', ['deploy-workers'])];
    const ok = checkRunUnits({ rows: both }, files, topo);
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.prints.filter((p) => /^\[INV4\] duty\.workflow\.deploy-(web|workers)\.yml — every job of its unit .* is post-gate in ci\.yml: .* OWN HOST/.test(p)).length, 2);
    assert.ok(ok.prints.includes('[INV3] ci.yml — 2 post-gate job(s), each the unit of: deploy-web ← duty.workflow.deploy-web.yml · deploy-workers ← duty.workflow.deploy-workers.yml'), ok.prints.join('\n'));

    const one = checkRunUnits({ rows: [both[0]] }, files, topo);
    assert.match(one.errors.join('\n'), /post-gate job\(s\) deploy-workers \(needs `ci-gate`.*\) are the unit of no row\. \[INV3\]/);
    const none = checkRunUnits({ rows: [] }, files, topo);
    assert.match(none.errors.join('\n'), /post-gate job\(s\) deploy-web · deploy-workers .* are the unit of no row/, 'ranged even when no row reads the gate workflow');

    const mixed = checkRunUnits({ rows: [...both, row('duty.x', ['late', 'guards'])] }, files, topo);
    assert.match(mixed.errors.join('\n'), /duty\.x — its unit contains this guard's own verdict: .*\[INV4\] No host requires itself/, 'the exemption is for all-post-gate units only');
  });

  test('RED-SINCE admission: a trigger row judged by post-gate jobs only is admitted by `post-gate`; a unit with any other job is excluded, and says which', () => {
    const pg = postGateAdmission(files, topo);
    const web = row('duty.workflow.deploy-web.yml', ['deploy-web']);
    const wide = row('duty.workflow.late', ['late']);
    const mix = row('duty.workflow.mix', ['deploy-workers', 'guards']);
    const reg = { rows: [web, wide, mix] };
    assert.deepEqual(postGateUnit(web.mechanism.recordQuery, pg), { ok: true });
    assert.deepEqual(postGateUnit(mix.mechanism.recordQuery, pg), { ok: false, off: ['guards'] });
    assert.equal(postGateUnit({ ...web.mechanism.recordQuery, workflow: 'deploy-web.yml' }, pg), null, 'a row reading another workflow is not this admission\'s business');

    assert.deepEqual(redSinceDomain(reg, new Set(), pg).map((r) => r.id), [web.id]);
    assert.deepEqual(redSinceDomain(reg, null, pg).map((r) => r.id), [web.id], 'the admission is its own derivation, not the dispatch one');
    assert.deepEqual(redSinceDomain(reg, new Set(), null).map((r) => r.id), [], 'no derivation handed in admits nothing: fail closed');

    const census = redSinceTriggerCensus(reg, new Set(), pg);
    assert.deepEqual(census.admitted, [web.id]);
    assert.deepEqual(census.admittedBy, { [web.id]: 'post-gate' });
    assert.equal(census.excluded.length, 2);
    assert.match(census.excluded.find((l) => l.startsWith(wide.id)), /the gate workflow, and job\(s\) late of its unit are not post-gate/);
    assert.match(census.excluded.find((l) => l.startsWith(mix.id)), /job\(s\) guards of its unit are not post-gate/);
    assert.deepEqual(redSinceTriggerCensus(reg, new Set(['ci.yml']), pg).admittedBy, { [web.id]: 'post-gate', [wide.id]: 'workflow_dispatch', [mix.id]: 'workflow_dispatch' }, 'two admissions, each named');

    const printed = evaluateRedSince(reg, LIVE_READS_NOT_MADE, new Set(), pg).prints.join('\n');
    assert.match(printed, /admitted: duty\.workflow\.deploy-web\.yml \(post-gate\)/);
  });
});
