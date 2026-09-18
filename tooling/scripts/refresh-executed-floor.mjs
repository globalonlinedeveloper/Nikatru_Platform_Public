#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// refresh-executed-floor.mjs — the ONLY writer of tooling/ci/test/executed-floor.json.
//
// Register row: O-COVERAGE-MANIFEST-LOOP-CASES, option (1).
//
// The executed floor is a LINUX measurement: per suite, how many cases the
// guard-meta job (ubuntu-24.04) REPORTED running. It is read by
// tooling/ci/assert-case-count-honest.mjs --executed-floor, which reds when a
// suite runs fewer cases than its floor — the loop-generated case the declared
// floor (coverage-manifest.json) cannot see.
//
// So this script never measures anything itself. It takes the junit ARTIFACT
// (guard-tests-junit) of a ci.yml run it has VERIFIED is:
//     workflow .github/workflows/ci.yml · branch main · event push ·
//     status completed · conclusion success · same repository (not a fork)
// and a junit written on a Windows host is refused outright. A local run can
// therefore never write the floor, and the Windows/Linux gap stops mattering.
//
// The merge (mergeExecutedFloor, pure, tested):
//   · each floored suite keeps MAX(old, new) — a flaky low run never lowers it
//   · a suite new to the report joins at its executed count
//   · a floored suite ABSENT from the run is a refusal, never a silent drop
//   · `--lower <suite> --reason "…"` sets that suite to the run's count (or
//     removes it when the run no longer has it) and changes NOTHING else, so a
//     lowered floor is its own commit (AGENTS.md: re-base a floor ALONE). The
//     reason is recorded in the file's "lowered" list beside the run id.
//
// The junit is parsed with parseJunitCases/tallyByBasename from
// assert-case-count-honest.mjs — the same parser the guard uses, never a rival.
//
// Usage:  node tooling/scripts/refresh-executed-floor.mjs <run-id> [--lower <suite> --reason "…"]…
// Needs `gh` authenticated for this repository (an agent/dev step, never CI's).
// Exit 0 = floor written.  1 = the run is not a green ci.yml push to main, or a
// merge was refused.  2 = COVERAGE LOST (bad arguments, missing/empty/Windows artifact).
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXECUTED_FLOOR_REL,
  isWindowsPath,
  parseJunitCases,
  readExecutedFloor,
  serializeExecutedFloor,
  tallyByBasename,
} from '../ci/assert-case-count-honest.mjs';

export const ARTIFACT_NAME = 'guard-tests-junit';
export const JUNIT_FILE = 'guard-tests.junit.xml';
// Compared to the `path` field of the GitHub API's run object — this script never opens a workflow
// file, so it is not a reader for tooling/workflow-readers.json (the bare-prefix shape R1 exempts).
const WORKFLOWS_PREFIX = '.github/workflows/';
export const WORKFLOW_PATH = `${WORKFLOWS_PREFIX}ci.yml`;

/** `<run-id>` plus repeated `--lower <suite> --reason "…"` pairs. Pure. */
export function parseRefreshArgs(argv) {
  const out = { runId: null, lowers: [], errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lower') {
      const suite = argv[i + 1];
      if (!suite || suite.startsWith('--')) {
        out.errors.push('--lower needs a suite basename');
        continue;
      }
      i++;
      if (argv[i + 1] !== '--reason' || !argv[i + 2] || !argv[i + 2].trim()) {
        out.errors.push(`--lower ${suite} needs --reason "<why>" right after it`);
        continue;
      }
      out.lowers.push({ suite, reason: argv[i + 2].trim() });
      i += 2;
    } else if (/^\d+$/.test(a) && out.runId === null) {
      out.runId = Number(a);
    } else {
      out.errors.push(`unrecognised argument ${JSON.stringify(a)}`);
    }
  }
  if (out.runId === null) out.errors.push('no numeric <run-id> was given');
  return out;
}

/** Why a run's metadata (GET /actions/runs/<id>) disqualifies it; [] = acceptable. Pure. */
export function runRefusals(run) {
  const r = [];
  if (!run || typeof run !== 'object') return ['the run metadata could not be read'];
  if (run.path !== WORKFLOW_PATH) r.push(`workflow is ${JSON.stringify(run.path)}, not ${WORKFLOW_PATH}`);
  if (run.head_branch !== 'main') r.push(`branch is ${JSON.stringify(run.head_branch)}, not main`);
  if (run.event !== 'push') r.push(`event is ${JSON.stringify(run.event)}, not push`);
  if (run.status !== 'completed') r.push(`status is ${JSON.stringify(run.status)}, not completed`);
  if (run.conclusion !== 'success') r.push(`conclusion is ${JSON.stringify(run.conclusion)}, not success`);
  const head = run.head_repository?.full_name;
  const base = run.repository?.full_name;
  if (!head || head !== base) r.push(`head repository ${JSON.stringify(head)} is not ${JSON.stringify(base)}`);
  return r;
}

/**
 * The merge. Pure.
 *   old    — the current floor's suites (`{}` when unfilled)
 *   counts — Map suite → executed, from the verified run
 *   lowers — [{ suite, reason }]
 * Returns { suites, raised, joined, lowered, errors }. With `lowers`, ONLY the
 * named suites change; without, every suite takes MAX(old, new) and new suites join.
 */
export function mergeExecutedFloor(old, counts, lowers = []) {
  const errors = [];
  const raised = [];
  const joined = [];
  const lowered = [];
  const suites = { ...old };
  if (lowers.length) {
    for (const { suite, reason } of lowers) {
      if (!Object.hasOwn(old, suite)) {
        errors.push(`--lower ${suite}: it has no executed floor to lower`);
        continue;
      }
      const now = counts.get(suite);
      if (now !== undefined && now >= old[suite]) {
        errors.push(`--lower ${suite}: the run executed ${now}, not below its floor ${old[suite]} — nothing to lower`);
        continue;
      }
      if (now === undefined) delete suites[suite];
      else suites[suite] = now;
      lowered.push({ suite, from: old[suite], to: now ?? null, reason });
    }
    return { suites, raised, joined, lowered, errors };
  }
  for (const [suite, floor] of Object.entries(old)) {
    const now = counts.get(suite);
    if (now === undefined) {
      errors.push(`${suite} has floor ${floor} but is ABSENT from the run — retire it with --lower ${suite} --reason "…"`);
    } else if (now > floor) {
      suites[suite] = now;
      raised.push({ suite, from: floor, to: now });
    }
  }
  for (const [suite, now] of counts) {
    if (!Object.hasOwn(old, suite)) {
      suites[suite] = now;
      joined.push({ suite, to: now });
    }
  }
  return { suites, raised, joined, lowered, errors };
}

function die(code, first, ...more) {
  console.error(`✗ ${code === 2 ? 'COVERAGE LOST — ' : ''}${first}`);
  for (const m of more) console.error(`    ${m}`);
  console.error('refresh-executed-floor: nothing written');
  process.exit(code);
}

function gh(args, cwd) {
  return execFileSync('gh', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function main() {
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const FLOOR = join(ROOT, EXECUTED_FLOOR_REL);
  const args = parseRefreshArgs(process.argv.slice(2));
  if (args.errors.length) {
    die(2, args.errors[0], ...args.errors.slice(1),
      'Usage: node tooling/scripts/refresh-executed-floor.mjs <run-id> [--lower <suite> --reason "…"]…');
  }

  let run;
  try {
    run = JSON.parse(gh(['api', `repos/{owner}/{repo}/actions/runs/${args.runId}`], ROOT));
  } catch (e) {
    die(2, `could not read run ${args.runId} with gh (${String(e.message).split('\n')[0]}).`);
  }
  const refusals = runRefusals(run);
  if (refusals.length) {
    die(1, `run ${args.runId} is not a green ci.yml push to main, so its counts are not a floor:`, ...refusals);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'nikatru-execfloor-'));
  // process.exit skips `finally`, so the temp dir is removed BEFORE any refusal.
  let xml = null;
  let failure = null;
  try {
    gh(['run', 'download', String(args.runId), '-n', ARTIFACT_NAME, '-D', tmp], ROOT);
    const junitPath = join(tmp, JUNIT_FILE);
    try {
      xml = readFileSync(junitPath, 'utf8');
    } catch (e) {
      if (!(e && e.code === 'ENOENT')) throw e;
      failure = [`the ${ARTIFACT_NAME} artifact holds ${JSON.stringify(readdirSync(tmp))}, not ${JUNIT_FILE}.`];
    }
  } catch (e) {
    failure = [
      `run ${args.runId} has no downloadable ${ARTIFACT_NAME} artifact (${String(e.message).split('\n')[0]}).`,
      'Runs before the guard-meta upload step carry no junit, and artifacts expire.',
    ];
  }
  rmSync(tmp, { recursive: true, force: true });
  if (failure) die(2, ...failure);

  const { cases, unattributed } = parseJunitCases(xml);
  if (cases.length === 0) die(2, `the ${ARTIFACT_NAME} junit reports no test case at all.`);
  if (unattributed) die(2, `${unattributed} <testcase> element(s) carry no file= attribute; they cannot be credited.`);
  const win = cases.find((c) => isWindowsPath(c.file));
  if (win) die(2, `the junit was written on a WINDOWS host (${JSON.stringify(win.file)}); the floor is a Linux measurement.`);
  const { counts, dirs } = tallyByBasename(cases);
  const collided = [...dirs].filter(([, d]) => d.length > 1).map(([s]) => s);
  if (collided.length) die(2, `suite basename(s) contributed by more than one directory: ${collided.join(', ')}.`);

  let current = { filledFrom: null, lowered: [], suites: {} };
  // One read, not existsSync then readFileSync: CodeQL js/file-system-race (same fix as render-privacy.mjs readIf).
  let floorText = null;
  try {
    floorText = readFileSync(FLOOR, 'utf8');
  } catch (e) {
    if (!(e && e.code === 'ENOENT')) throw e;
  }
  if (floorText !== null) {
    let doc;
    try {
      doc = JSON.parse(floorText);
    } catch (e) {
      die(2, `${EXECUTED_FLOOR_REL} could not be parsed (${e.message}).`);
    }
    const state = readExecutedFloor(doc);
    if (state.state === 'invalid') die(2, `${EXECUTED_FLOOR_REL} is not a valid executed floor: ${state.reason}.`);
    current = { filledFrom: doc.filledFrom ?? null, lowered: Array.isArray(doc.lowered) ? doc.lowered : [], suites: doc.suites };
  }

  const merged = mergeExecutedFloor(current.suites, counts, args.lowers);
  if (merged.errors.length) die(1, 'the merge was refused:', ...merged.errors);

  const filledFrom = args.lowers.length
    ? current.filledFrom
    : { run: args.runId, sha: run.head_sha, at: run.updated_at ?? null };
  const lowered = [
    ...current.lowered,
    ...merged.lowered.map((l) => ({ ...l, run: args.runId })),
  ];
  writeFileSync(FLOOR, serializeExecutedFloor({ filledFrom, lowered, suites: merged.suites }));

  for (const r of merged.raised) console.log(`  raised  ${r.suite}  ${r.from} -> ${r.to}`);
  for (const j of merged.joined) console.log(`  joined  ${j.suite}  ${j.to}`);
  for (const l of merged.lowered) console.log(`  LOWERED ${l.suite}  ${l.from} -> ${l.to ?? '(removed)'}  — ${l.reason}`);
  console.log(
    `ok  ${EXECUTED_FLOOR_REL} written from run ${args.runId} (${run.head_sha}): ${Object.keys(merged.suites).length} suite(s), ` +
      `${merged.raised.length} raised, ${merged.joined.length} joined, ${merged.lowered.length} lowered.` +
      (merged.lowered.length ? ' Commit this lowering ALONE.' : ''),
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) main();
