#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// runner.mjs — the decisions a cloud runner routine (runner-a, runner-b) makes, each
// a CLI subcommand over JSON on stdin, each PURE and unit-tested in
// tooling/ci/test/autopilot-runner.test.mjs. docs/autopilot/runner.prompt.md is the
// routine's complete instructions; this file is where it asks.
//
// ⏱ 2026-10-02 · lane autopilot-runners, row O-LANES-LAUNCH-ONLY-FROM-THE-LAPTOP.
// The laptop dispatcher is PRIMARY. A runner acts only while the laptop heartbeat is
// stale, and — since a routine cannot create routines — runs the lane in its own
// session. The queue and its claim protocol are tooling/autopilot/issue-queue.mjs
// (autopilot-queue-issues), imported here and never redefined.
//
//   standby        {beat}                                     → ACT | DRY | STANDBY <reason>
//   inflight       {issues, owner, now, openPRs}              → CAP <n> | ROOM <n>
//   next           {issues, mergedPRs, openPRs, owner, now, mode} → <issue number> | NONE
//   claim-verdict  {comments, me, owner}                      → WIN | YIELD
//   housekeeping   {issues, mergedPRs, openPRs, owner, now}   → JSON ops (at most RUNNER_HOUSEKEEPING_OPS)
//   land-ok?       {pr, pushedHead}                           → YES | NO <reason>
// `issues` are REST issues from the PRIVATE repo, each with its `comments` array.
// Exit 0 = answered. 2 = the input could not be read (no answer is a guess).
// ─────────────────────────────────────────────────────────────────────────────
import { CONTRACT, isMain, readStdin } from './cli.mjs';
import { laptopState, parseBeat } from './heartbeat.mjs';
import { parseIssue, nextReady, factsFrom, claimState, claimWinner, housekeepingPlan, lanePrUpdatedAt, isOwner } from './issue-queue.mjs';
import { gateVerdict } from '../ops/land-rules.mjs';
import { gateRuns } from '../ci/land-next.mjs';

const [FRESH, STALE, HANDOVER, DRILL_STALE] = CONTRACT.heartbeat.states;
const DRILL = CONTRACT.labels.fixed[6];
const [, LAND_HOLD, NEEDS_REVIEW] = CONTRACT.publicLabels.pr;
const RESULT = CONTRACT.runner.resultVerb;
/** The cloud runner ids: the routines whose id names a runner. */
export const CLOUD_RUNNERS = Object.freeze(CONTRACT.routines.map((r) => r.id).filter((id) => id.startsWith('runner-')));

/** standby: the heartbeat → ACT (stale/handover), DRY (drill-stale), or STANDBY <reason>. */
export function standby(input, now = Date.now()) {
  const beat = typeof input?.beat === 'string' ? parseBeat(input.beat) : parseBeat(input?.beat ? JSON.stringify(input.beat) : null);
  const s = laptopState(beat, Number.isFinite(input?.now) ? input.now : now);
  if (s.state === STALE || s.state === HANDOVER) return `ACT (${s.state}: ${s.why})`;
  if (s.state === DRILL_STALE) return `DRY (${s.why})`;
  return `STANDBY ${s.state === FRESH ? 'the laptop is primary' : 'the laptop state is unknown'}: ${s.why}`;
}

const hasResult = (comments, owner) => (comments ?? []).some((c) => isOwner(c, owner) && new RegExp(`^${RESULT} `).test(String(c.body ?? '')));

/** Parse what parses; a malformed issue is skipped (never launched), never thrown. */
function parsedIssues(issues, owner) {
  const out = [];
  for (const i of issues ?? []) {
    try {
      out.push({ ...parseIssue(i, i.comments ?? [], { owner }), comments: i.comments });
    } catch {
      /* not a v1 lane issue: never a candidate */
    }
  }
  return out;
}

/** inflight: fresh cloud-runner claims with no RESULT yet → CAP at RUNNER_INFLIGHT_MAX, else ROOM. */
export function inflight({ issues, owner, now = Date.now(), openPRs = [] }) {
  let n = 0;
  for (const i of parsedIssues(issues, owner)) {
    if (i.state !== 'open') continue;
    const st = claimState(i.comments, { owner, now, prUpdatedAt: lanePrUpdatedAt(i.lander, openPRs) });
    if (st.holder && CLOUD_RUNNERS.includes(st.holder.runner) && st.fresh && !hasResult(i.comments, owner)) n++;
  }
  return n >= CONTRACT.claimStaleness.RUNNER_INFLIGHT_MAX ? `CAP ${n}` : `ROOM ${n}`;
}

/** next: the issue to claim. DRY → only `drill` issues; ACT → never a `drill` issue. */
export function next({ issues, mergedPRs = [], openPRs = [], owner, now = Date.now(), mode = 'ACT' }) {
  const parsed = parsedIssues(issues, owner).filter((i) => (mode === 'DRY' ? i.labels.includes(DRILL) : !i.labels.includes(DRILL)));
  const facts = { ...factsFrom({ issues, mergedPRs }), owner, now, openPRs };
  const ready = nextReady(parsed, facts);
  return ready.length ? String(ready[0].number) : 'NONE';
}

/** claim-verdict: the lowest owner CLAIM id in the window holds the issue. */
export function claimVerdict({ comments, me, owner }) {
  const w = claimWinner(comments, { owner });
  return w && w.runner === me ? 'WIN' : 'YIELD';
}

/** housekeeping: the queue's plan plus stale-claim flags, at most RUNNER_HOUSEKEEPING_OPS. */
export function housekeeping({ issues, mergedPRs = [], openPRs = [], owner, now = Date.now() }) {
  const parsed = parsedIssues(issues, owner);
  const facts = { ...factsFrom({ issues, mergedPRs }), openPRs };
  const ops = housekeepingPlan(parsed, mergedPRs, facts, { max: Infinity });
  for (const i of parsed.filter((x) => x.state === 'open')) {
    const st = claimState(i.comments, { owner, now, prUpdatedAt: lanePrUpdatedAt(i.lander, openPRs) });
    if (st.holder && !st.fresh) ops.push({ op: 'flagStale', number: i.number, runner: st.holder.runner, launched: st.launched });
  }
  return ops.slice(0, CONTRACT.runner.RUNNER_HOUSEKEEPING_OPS);
}

/** land-ok?: may THIS runner add `land-ok` to its own PR? */
export function landOk({ pr, pushedHead }) {
  const labels = (pr?.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  if (pr?.draft) return 'NO draft';
  if (labels.includes(NEEDS_REVIEW)) return `NO \`${NEEDS_REVIEW}\`: the reviewer decides`;
  if (labels.includes(LAND_HOLD)) return `NO \`${LAND_HOLD}\``;
  if (!pushedHead || pr?.headSha !== pushedHead) return `NO the head ${String(pr?.headSha).slice(0, 8)} is not the one this session pushed (${String(pushedHead).slice(0, 8)})`;
  const g = gateVerdict(pr?.checks ?? [], { runs: gateRuns(pr?.runs) });
  if (g.verdict !== 'GREEN') return `NO ci-gate ${g.verdict}: ${g.why}`;
  return 'YES';
}

const COMMANDS = { standby, inflight, next, 'claim-verdict': claimVerdict, housekeeping, 'land-ok?': landOk };

export function run(cmd, text) {
  const f = COMMANDS[cmd];
  if (!f) return { code: 2, out: `usage: runner.mjs ${Object.keys(COMMANDS).join('|')} < input.json` };
  let input;
  try {
    input = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
  } catch {
    return { code: 2, out: 'COULD NOT READ — stdin is not JSON: no answer' };
  }
  try {
    const r = f(input);
    return { code: 0, out: typeof r === 'string' ? r : JSON.stringify(r) };
  } catch (e) {
    return { code: 2, out: `COULD NOT DECIDE — ${e.message}` };
  }
}

if (isMain(import.meta.url)) {
  const r = run(process.argv[2], readStdin());
  console.log(r.out);
  process.exitCode = r.code;
}
