#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-e2e-proof-fresh.mjs — the nightly golden-path proof must be RECENT,
// SCHEDULED, and must still be running the suite it claims to run.
//
// [pipeline N-6, clauses 1 and 3] Private/requirements/ (was pipeline/06-app-build.md,
// folded into that JSON spec 2026-08-15)
//
// N-6 as originally drafted asked that a done-record NAME an end-to-end test and
// that a workflow CLAIM it. Both were true on 2026-07-29 of a suite that had been
// red for three consecutive nights, and stayed true through six. The criterion
// could not fail, which is the defect this whole stage exists to remove: an
// undated proof is not a proof, it is a memory with a tick next to it.
//
// This is the SIBLING of assert-platform-proof-fresh.mjs, deliberately built to
// the same shape and the same vocabulary rather than as a second dialect. That
// guard solves this exact problem for `build-platforms.yml`; the plan
// (Private/plans/06-app-build-plan.md, increment 7) offered either generalising
// it to a table of workflows or a sibling, and the sibling is what landed:
// `assert-platform-proof-fresh.mjs` belongs to stage 1 ([1]F-4) and its
// MAX_AGE_DAYS is under a standing owner lock, so widening it here would mean
// editing another stage's constant to carry this stage's meaning.
//
// ── WHY THIS COULD NOT LAND BEFORE TODAY, AND WHAT CHANGED ──────────────────
// PR #121 deferred exactly this guard, and was right to. At that moment the last
// SIX scheduled runs had all failed (2026-07-27 → 2026-08-01) and the only
// successes were `workflow_dispatch`, which this guard family refuses to count on
// purpose. Landing a freshness clause then would have blocked every merge in the
// repository on a pre-existing product defect — a guard that goes red on arrival
// teaches people to delete guards.
//
// PR #111 fixed the root cause: `ConsentGate`'s `barrierDismissible: false` dialog
// (that widget was superseded by the inline `_ConsentPrompt` in app.dart and the
// class itself deleted 2026-08-10 — the history below is why the clause exists)
// installed a ModalBarrier over onboarding and silently swallowed the `tap('Skip')`
// beneath it, so both tests died several lines later reporting
// `Found 0 widgets with text "Welcome back"` — a login-screen message for a dialog
// problem. The 2026-08-02T06:13Z scheduled run is SUCCESS, the first green
// scheduled run since 2026-07-26. Verified with
// `gh run list --workflow=e2e.yml --json event,conclusion,createdAt` before this
// guard was written; the deferral reason is discharged, not forgotten.
//
// ── MAX_AGE_DAYS = 3 — DERIVED FROM THE CRON, NOT CHOSEN ────────────────────
// [plan R-9] forbids inventing this number, and records that
// assert-platform-proof-fresh.mjs's own 14 is arbitrary AND SAYS SO. Copying the
// honesty rather than the number means deriving this one from the only source
// there is: the cadence e2e.yml actually declares.
//
//   e2e.yml `schedule: - cron: '17 3 * * *'`  →  cadence = 1 day.
//
//   1 day   the cadence itself. On a healthy nightly the newest green scheduled
//           run is never as much as one day old.
//   +1 day  ONE tolerated bad night. A single red or missed run must not block
//           every merge in the repository; that is the failure mode that gets a
//           check disabled rather than fixed.
//   +1 day  the boundary must not land ON the cron time. Measured over the ten
//           scheduled runs from 2026-07-24 to 2026-08-02, GitHub started this
//           workflow between 05:58Z and 06:44Z against a 03:17Z cron — 2h41m to
//           3h27m late, and the lateness VARIES by up to 46 minutes night to
//           night. With a two-day ceiling the pass/fail edge falls exactly where
//           that jitter lives, so the scheduler's queue depth would decide
//           whether CI is green. A third day moves the edge a full cadence clear
//           of it.
//   = 3 days.
//
// THE DERIVATION IS ENFORCED, NOT JUST DOCUMENTED. `assertWatchedWorkflowIntact`
// below re-reads the cron on every run and fails if it is no longer DAILY,
// because the moment the cadence changes this constant stops describing anything.
// A number derived from a source that has moved is an invented number wearing the
// derivation's clothes.
//
// ⚠️ Do NOT copy this to assert-platform-proof-fresh.mjs and do NOT raise its 14.
// That ceiling is under a standing owner lock. This one is derived from a
// different cron and means something different.
//
// ── THE RUN WINDOW IS LOAD-BEARING — `per_page` IS NOT A TIDYING KNOB ────────
// RUNS_PAGE_SIZE is 100, matching assert-platform-proof-fresh.mjs. It read 20
// until 2026-08-26, and the whole reason that was a CLIFF is one word in the
// query string: `status=success`.
//
// The window is therefore a window over SUCCESSES, not over runs. Every green
// hand-pressed `workflow_dispatch` permanently occupies a slot in it, and
// nothing ages a slot out except a NEWER success. So the long red streak this
// guard exists to detect is also the condition that fills the page: a failing
// nightly is exactly what makes people press dispatch, over and over, and each
// one that goes green consumes a row above the last scheduled success. Push
// enough of them and that scheduled success falls off the end of the page. The
// guard then sees a success list with no `event === 'schedule'` in it at all and
// HARD-FAILS ci-gate saying the timer has stopped — a verdict indistinguishable,
// from the outside, from a genuinely dead cron. It was measured at the shipped
// width before this change: with a scheduled success ONE DAY OLD at position 25,
// per_page=20 reported "20 successful run(s), but NONE was triggered by the
// schedule" and exited 1.
//
// Note the asymmetry, and note exactly how far it reaches, because it bounds
// what this can corrupt: truncation drops the rows at the END of the page, and
// the page is ordered by `created_at` DESCENDING. So a short page can hide a
// scheduled run ENTIRELY — that is the cliff above.
//
// ⚠️ IT DOES NOT FOLLOW THAT A STALE-AGE VERDICT IS WINDOW-PROOF, AND THIS FILE
// CLAIMED IT DID UNTIL 2026-08-26. The page is ordered by `created_at`; this
// guard grades freshness by `updated_at` (see `evaluateFreshness`). Those are
// two different orderings, and a run CREATED earlier can UPDATE later — a slow
// run finishes after a fast one that started behind it. A scheduled run
// truncated by `created_at` could therefore hold a NEWER `updated_at` than any
// scheduled run left on the page, making the newest visible one look older than
// the newest one really is. The old "therefore never a window artifact" inferred
// recency from page position, and page position is not recency here.
//
// MEASURED, because this is not a claim to settle from the API docs. Over the
// full retained success history on main (27 rows, 2026-08-26): the page IS
// `created_at` DESC, and the `created_at` and `updated_at` orderings agree
// EXACTLY — zero inversions. The margin is wide, too: the smallest gap between
// adjacent runs is 9,303s while the entire spread of run DURATIONS is 175s, so
// nothing observed comes within ~53x of overtaking its neighbour.
//
// ⛔ THAT IS A BOUND, NOT A LAW. 27 agreeing rows cannot establish a "never",
// and the state that breaks it — two runs created close together with very
// different durations — is exactly what a debugging burst produces, which this
// header documents a few lines up. So the claim is NOT restored on the strength
// of the measurement; the CAVEAT is extended instead. Both the zero-scheduled
// branch AND the stale-age branch now report window saturation when the page
// came back full.
//
// ⛔ THE VERDICT IS UNCHANGED IN BOTH BRANCHES. This splits the DIAGNOSIS only —
// `ok` is still `ageDays <= maxAgeDays`. Nothing here makes the guard pass in
// any case where it previously failed.
//
// §7.10 item 5 of Private/notes/HANDOFF-2026-08-26.md is where this change was
// ORDERED, and is the ONLY place `per_page` occurs in that handoff: it records
// this guard reading `per_page=20` "where its sibling reads 100" and names the
// consequence — "Enough dispatch runs push the last scheduled success off the
// page and hard-fail `ci-gate`."
//
// 🔴 DO NOT CITE §7.1 FOR THIS, and do not trust §7.10's own pointer to it.
// §7.10 item 5 calls this "the SAME cliff §7.1 just fixed", but §7.1 is titled
// "§1'S DEADLINE IS DISCHARGED — A SECOND CRON, NOT A RAISED CEILING": it adds a
// Thursday slot to build-platforms.yml with MAX_AGE_DAYS untouched at 14, is
// about CADENCE, and mentions no page, window or `per_page` anywhere. The
// sibling's own 20→100 is real but happened 2026-08-11 in 4384ab6, as a side
// effect of dropping `branch=main` — not this week, and not a saturation cliff
// anybody hit. An earlier draft of this header cited §7.1 here and was wrong on
// all three counts. Private/notes/DEAD-CITATIONS-2026-08-26.md exists because of
// this class of defect, and a guard header nobody re-reads for years is the
// worst place to leave one.
//
// ⚠️ WIDENING MOVES THE CLIFF; IT DOES NOT REMOVE ONE, and this file would rather
// say so than declare the problem solved. `per_page` is capped at 100 on this
// endpoint — removing the cliff outright needs PAGINATION, and pagination is not
// what landed. What was actually measured, live, on 2026-08-26
// (`gh run list --workflow=e2e.yml --branch main --status success --limit 200`):
//   · 27 successes in the ENTIRE retained history on main — 20 `schedule` and
//     7 `workflow_dispatch`. The whole list is smaller than a single page.
//   · the deepest run of consecutive dispatch successes sitting above a
//     scheduled one, anywhere in that history: 2 — the streaks are [1],[2],[2],
//     [1]. (A fifth lone dispatch is the OLDEST row in the whole history and
//     sits above no scheduled run at all, so it is not one of these; counting it
//     changes nothing, it is length 1.) RE-MEASURED 2026-08-26 — an earlier
//     draft of this header said 3, which no streak in the history reaches. The
//     old width of 20 was therefore carrying 18 rows of headroom, not the 17
//     that a 3 implies, and not the 0 that a red would imply.
//   · the worst burst genuinely observed: 4 green dispatches in 3 days, while
//     the 2026-08-08…08-11 red streak was being debugged.
// Exhausting 100 needs ~100 green dispatches with not one green scheduled run
// among them — on the order of seventy-five days at that peak burst rate,
// against a 90-day run retention that today holds 27 successes in total. That is
// not a reachable state. It is a BOUND, though, not a proof, and the honest
// description of this change is "the cliff is five times further away and it
// announces itself when reached", not "fixed".
//
// AND IF IT IS EVER REACHED, IT NOW SAYS SO. `evaluateFreshness` reports
// `windowSaturated` when the page came back FULL. "No scheduled run in the
// window" and "no scheduled run exists" are DIFFERENT FACTS and only the second
// is a finding about the cron. ⛔ The VERDICT is unchanged — it still fails,
// because a guard that cannot see the timer must never certify the timer — this
// splits the DIAGNOSIS only. Nothing here makes the guard pass in any case where
// it previously failed.
//
// ── WHAT HAPPENS ON THE DAY THE NIGHTLY LEGITIMATELY FAILS ──────────────────
// Stated here because a merge-blocking guard whose subject is an unattended cron
// owes an explicit answer, and because "it went red and nobody knew why" is the
// same class of bug as the six silent nights this exists to catch.
//
//   · one red night      → this guard still PASSES (age ~1 day).
//   · two red nights     → still PASSES (age ~2 days).
//   · from ~3 days after the last green scheduled run → RED, and it blocks merges.
//
// THAT IS THE POINT, NOT A BUG. Against the real 2026-07-27…08-01 outage this
// guard would have gone red on 2026-07-29 and stayed red until the 2026-08-02
// green — four days of blocked merges over a product defect in the deployed app
// against live Supabase, the live Worker and live D1. Four days of friction is
// the correct price for six unattended red nights that nothing responded to.
//
// The remedy is never to raise the ceiling. It is to read the `alert` job's
// GitHub issue, or the `::error::` annotations at the top of the run page that
// PR #111 added (screenshots went 1 → 21 in the same change), and fix the app.
//
// FAILS CLOSED. No token, a non-200, malformed JSON, or zero successful scheduled
// runs are all failures. "I could not tell" must never read as "it is fine" —
// that is exactly how the original claim became unfalsifiable. Locally, with no
// GH_TOKEN in the environment, this guard therefore exits non-zero by design,
// identically to assert-platform-proof-fresh.mjs.
//
// Offline testing: --runs-file <json> --now <iso> injects fixture data so the
// decision logic is genuinely exercised without network. It prints a loud banner
// so its presence in a real CI log is unmistakable.
//
// LANE-BOUND: e2e.yml — the subject is the nightly LIVE end-to-end proof, and there is exactly one of
// it. e2e.yml is not a channel lane at all: it appears in no `lane` block of tooling/channel-register.json
// and ships no artifact, so there is nothing to derive the name from. A second live-e2e workflow would
// need its own freshness row with its own cadence, not a share of this one — an age check quantified over
// a SET reports the newest run and hides a dead sibling. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-e2e-proof-fresh.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = 'e2e.yml';
const BRANCH = 'main';
const MAX_AGE_DAYS = 3;
// 🔴 REPOINTED 2026-08-20. This read `Nikatru_Android_Apps_Public`, which
// `gh repo list` shows is NOT A LIVE REPOSITORY — the owner renamed it again after
// the 2026-08-19 pass that put it here. A RENAME FREES THE OLD NAME. GitHub follows
// rename redirects, so a read against the freed name answers 200 and this looked
// fine; the day somebody re-claims it, this guard reads a STRANGER'S repository and
// reports on it as if it were ours. Verify a repo name with `gh repo list`, never
// with `gh api repos/<owner>/<name>` — the redirect makes the dead name answer.
const DEFAULT_REPO = 'globalonlinedeveloper/Nikatru_Platform_Public';
// 🔴 LOAD-BEARING, NOT COSMETIC — read 'THE RUN WINDOW IS LOAD-BEARING' in the
// header before touching this. The query filters `status=success`, so this sizes
// a window over SUCCESSES: every green hand-press consumes a slot and can push
// the last scheduled success off the page, at which point this guard reports a
// dead cron that is not dead. Was 20 until 2026-08-26; now matches
// assert-platform-proof-fresh.mjs. 100 is this endpoint's MAXIMUM — it cannot be
// raised, and tidying it back down re-opens the cliff.
export const RUNS_PAGE_SIZE = 100;

/** The work the run must still be doing, or its green tick means nothing.
 *
 *  ⚠️ THE TIMER IS NOT THE WORK, and checking only the timer is the mistake
 *  assert-platform-proof-fresh.mjs made until 2026-07-27: it asserted the file
 *  existed and carried a cron, and never looked at what the workflow BUILT, so
 *  deleting every macOS and iOS step returned pass. The equivalent hole here is a
 *  workflow that still runs nightly, still goes green, and no longer drives the
 *  suite — at which point this guard becomes a very reliable check that a cron
 *  fires.
 *
 *  Each entry is an expression that must survive in the comment-stripped
 *  workflow. They are the five things that make a green e2e.yml run mean "the
 *  golden path was walked against production":
 *    · `flutter drive`                        — the suite is actually driven
 *    · the integration target                 — and it is THE named E2E, not some other target
 *    · tooling/e2e/verify_row.mjs             — and the write really reached live D1
 *    · tooling/e2e/verify_purged.mjs          — and the ERASURE really emptied both stores
 *    · tooling/e2e/verify_consent.mjs         — and the CONSENT the user gave was really recorded
 *  Without the third, a green run proves the UI moved and proves nothing landed.
 *
 *  🔴 THE FOURTH WAS ADDED 2026-08-08 WITH leg 6, AND IT GUARDS THE ONE CLAIM
 *  THE SUITE CANNOT MAKE FOR ITSELF. tooling/e2e-leg-register.json now marks
 *  `account-delete-purges` asserted, and its anchors resolve in app_test.dart —
 *  which proves the app SAID "Account deleted". A server that erased nothing and
 *  answered `{ ok: true }` produces the identical screen and the identical green
 *  anchors, so deleting this step from the workflow would leave the register
 *  claiming a leg nothing checks, with assert-e2e-legs.mjs entirely satisfied.
 *  That is precisely the overclaim N-6 was failing on, one layer further out.
 *
 *  🔴 THE FIFTH WAS ADDED 2026-08-09 AND GUARDS THE SAME SHAPE OF CLAIM ONE
 *  LAYER IN. The suite asserts the DPDP consent prompt appears and answers it —
 *  and the upload of the resulting artifact is FIRE-AND-FORGET by design
 *  (`_ConsentPrompt._answer` does not await it; `applyConsentDecision` documents
 *  the transport as best-effort so a network failure cannot make a user's choice
 *  look rejected). A `POST /v1/consent` that never lands therefore produces a
 *  green suite over an EMPTY §6(3) trail. Deleting this step would leave the
 *  prompt assertion looking like proof that consent is recorded, which is the
 *  one thing it cannot see. */
export const REQUIRED_WORK = [
  'flutter drive',
  'integration_test/app_test.dart',
  'tooling/e2e/verify_row.mjs',
  'tooling/e2e/verify_purged.mjs',
  'tooling/e2e/verify_consent.mjs',
];

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That exact off-by-one shipped in assert-gate-passed.mjs and blocked both
// production deploys with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

// Strip full-line comments before scanning YAML. A grep for '"r2_buckets"' once
// matched the template comment explaining why there is no r2_buckets — and this
// particular workflow's header is 40 lines of prose that NAMES the cron, names
// `flutter drive` and names every path in REQUIRED_WORK. Scanning the raw file
// would pass on a workflow whose entire body had been deleted.
function stripComments(yaml) {
  return yaml
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

/** Every `- cron:` expression in the comment-stripped workflow. */
export function cronExpressions(yaml) {
  return [...yaml.matchAll(/-\s*cron:\s*['"]([^'"]+)['"]/g)].map((m) => m[1].trim());
}

// Is this 5-field cron expression one that fires EVERY day?
//
// Only the last three fields decide it: day-of-month, month, day-of-week. The
// minute and hour say WHEN in the day, which MAX_AGE_DAYS does not depend on.
// A bare `*` and the step form meaning "every 1" both count as every. Anything
// else — `* * * * 1` (Mondays), `17 3 1 * *` (monthly) — is a different cadence,
// and a ceiling derived from a daily one stops describing it.
//
// ⚠️ Written with LINE comments, not a `/** … */` block, on purpose: the step
// form contains the two characters that END a block comment, and writing it
// inside one is an instant SyntaxError. This guard hit exactly that on its first
// real run, which is the difference between a caught mutation and a crash.
export function isDailyCron(expr) {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return false;
  const every = (x) => x === '*' || x === '*/1';
  return every(f[2]) && every(f[3]) && every(f[4]);
}

// COVERAGE SELF-CHECK. This guard reads a workflow by NAME over the network. If
// that workflow is renamed or deleted the API returns an empty list, which is
// indistinguishable from "never run" — and asserting on the cron additionally
// catches the CAUSE rather than waiting three days for the SYMPTOM.
export function assertWatchedWorkflowIntact(root = ROOT) {
  const path = resolve(root, '.github/workflows', WORKFLOW);
  if (!existsSync(path)) {
    return `COVERAGE LOST — ${WORKFLOW} does not exist. This guard is watching a workflow that is gone, so it can only ever report a stale proof for a suite that no longer runs.`;
  }
  const yaml = stripComments(readFileSync(path, 'utf8'));
  if (!/\n\s+schedule:/.test(yaml)) {
    return `COVERAGE LOST — ${WORKFLOW} declares no 'schedule:' trigger. The freshness clause depends on it; without a timer the proof is guaranteed to go stale and this guard becomes a countdown, not a check.`;
  }
  const crons = cronExpressions(yaml);
  if (crons.length === 0) {
    return `COVERAGE LOST — ${WORKFLOW} has a 'schedule:' block with no cron entry.`;
  }

  // THE DERIVATION, RE-CHECKED. MAX_AGE_DAYS is 3 because the cadence is 1 day
  // (see the header). If the cron becomes weekly, a 3-day ceiling is not merely
  // wrong — it is a permanent red that no amount of green nightlies can clear,
  // and the first person to meet it will "fix" it by raising the number. Fail
  // where the reason is still legible instead.
  const daily = crons.filter(isDailyCron);
  if (daily.length === 0) {
    return (
      `COVERAGE LOST — ${WORKFLOW}'s cron is no longer daily (${crons.join(', ')}). ` +
      `MAX_AGE_DAYS = ${MAX_AGE_DAYS} is DERIVED from a one-day cadence — one day for the cadence, one for a ` +
      'tolerated bad night, one to keep the boundary clear of the scheduler jitter measured on this ' +
      'workflow. Against a slower cron that ceiling is an unreachable target, and the tempting repair ' +
      '(raise the number) is exactly the invented constant the derivation exists to prevent. ' +
      'Re-derive it from the new cadence in the same change, or restore the daily cron.'
    );
  }

  // ⚠️ THE ABOVE CHECKS THE TIMER, NOT THE WORK. See REQUIRED_WORK.
  const missing = REQUIRED_WORK.filter((w) => !yaml.includes(w));
  if (missing.length) {
    return (
      `COVERAGE LOST — ${WORKFLOW} no longer contains: ${missing.join(', ')}. ` +
      'A nightly that still fires and no longer drives the suite (or no longer verifies the row reached ' +
      'live D1) goes green forever, and this guard would faithfully report that green as a fresh proof ' +
      'of a golden path nobody walked.'
    );
  }
  return null;
}

// The decision, kept pure so it can be tested without network. This is where the
// real defects live — the API call is the boring half.
export function evaluateFreshness(runs, nowMs, maxAgeDays = MAX_AGE_DAYS, pageSize = RUNS_PAGE_SIZE) {
  if (!Array.isArray(runs)) {
    return { ok: false, reason: 'run list was not an array — treating an unreadable answer as a failure' };
  }
  // THE PAGE CAME BACK FULL. Computed ONCE, up here, because it qualifies BOTH
  // failing verdicts and not only the zero-scheduled one. A full page means the
  // API had more successes to give and this query never asked for them — which
  // is a coverage loss in this file's own sense: rows the guard is meant to see
  // and did not.
  const windowSaturated = runs.length >= pageSize;
  const successes = runs.filter((r) => r && r.conclusion === 'success' && r.updated_at);
  if (successes.length === 0) {
    return { ok: false, reason: `no successful ${WORKFLOW} run found on ${BRANCH}` };
  }

  // FRESHNESS IS A CLAIM ABOUT THE TIMER, so only a scheduled run can satisfy
  // it. Counting manual runs is what let a never-firing cron look healthy — and
  // here it is not hypothetical: on 2026-08-01, in the middle of the six-night
  // outage, TWO `workflow_dispatch` runs went green while every scheduled run
  // was red. A guard that counted them would have reported the nightly healthy
  // on the worst night it ever had.
  //
  // ⚠️ DIVERGENCE FROM assert-platform-proof-fresh.mjs, on purpose. That guard
  // treats "no scheduled run at all" as a DATED tripwire that only prints until
  // 2026-08-10, because its cron had genuinely never fired when it was written
  // and failing would have blocked merges for work that had not had a chance to
  // happen. This workflow's cron has fired every single night from 2026-07-24 to
  // 2026-08-02 inclusive, so here the same state is not a young timer — it is a
  // timer that has STOPPED, and it fails immediately.
  const scheduled = successes.filter((r) => r.event === 'schedule');
  if (scheduled.length === 0) {
    // TWO DIFFERENT FACTS, AND ONLY ONE OF THEM IS ABOUT THE CRON. A page that
    // came back FULL means the API had more successes to give and this query
    // never asked for them, so "no scheduled run here" is a statement about the
    // WINDOW. A short page IS the whole retained success history, so the same
    // emptiness is a statement about the TIMER.
    //
    // ⛔ BOTH STILL FAIL, and that is deliberate. A guard that cannot see the
    // timer must not report the timer healthy — "I could not tell" reading as
    // "it is fine" is the original defect this whole file exists to remove. What
    // changes is only what the operator is sent to look at, which is the
    // difference between fixing a cron and chasing one that was never broken.
    return {
      ok: false,
      manualCount: successes.length,
      windowSaturated,
      reason: windowSaturated
        ? `COVERAGE LOST — ${successes.length} successful run(s) came back and NONE was triggered by the schedule, but THE PAGE WAS FULL ` +
          `(${runs.length} rows >= per_page ${pageSize}), so older successes exist that this query never saw. ` +
          'That is a statement about the WINDOW, not yet about the cron: because the query filters `status=success`, a green ' +
          'scheduled run can be sitting just past the end of the page, pushed there by hand-pressed dispatches. ' +
          'It still FAILS — a guard that cannot see the timer must not certify it — but confirm with ' +
          `\`gh run list --workflow=${WORKFLOW} --branch ${BRANCH} --status success\` before blaming the schedule.`
        : `${successes.length} successful run(s), but NONE was triggered by the schedule — every one was manual. ` +
          'A dead cron is invisible behind a hand-press, which is exactly what freshness exists to detect.',
    };
  }
  const newest = scheduled.reduce((a, b) => (Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a));
  const stamp = Date.parse(newest.updated_at);
  if (Number.isNaN(stamp)) {
    return { ok: false, reason: `newest run has an unparseable timestamp: ${newest.updated_at}` };
  }
  const ageDays = (nowMs - stamp) / 86_400_000;
  const stale = ageDays > maxAgeDays;

  // ⚠️ THE AGE BRANCH CARRIES THE SATURATION CAVEAT TOO, since 2026-08-26. This
  // file used to argue it could never need one: truncation drops the oldest
  // rows, so whichever scheduled run survives must be the newest. That inferred
  // recency from PAGE POSITION — and the page is ordered by `created_at` while
  // `newest` above is chosen by `updated_at`. A run created earlier can update
  // later, so the two orderings can disagree, and a truncated scheduled run can
  // in principle be the genuinely newest one. Measured over the whole retained
  // history they agree exactly (see the header), but that is a BOUND, NOT A LAW,
  // and this guard does not certify what it cannot see.
  //
  // ⛔ `ok` IS UNTOUCHED — still `ageDays <= maxAgeDays`. A stale run stays
  // stale, saturated or not; only the DIAGNOSIS gains a sentence.
  return {
    ok: !stale,
    ageDays,
    runId: newest.id,
    updatedAt: newest.updated_at,
    windowSaturated: stale ? windowSaturated : false,
    reason: !stale
      ? null
      : windowSaturated
        ? `COVERAGE LOST — the newest VISIBLE green scheduled run is ${ageDays.toFixed(1)} days old, ceiling is ${maxAgeDays} — ` +
          `and THE PAGE WAS FULL (${runs.length} rows >= per_page ${pageSize}), so older successes exist that this query never ` +
          'saw. This is a statement about the WINDOW as well as the age: the page is ordered by `created_at` but this age is ' +
          'graded by `updated_at`, and a run created earlier can update later, so a truncated scheduled run could in principle ' +
          'be newer than this one. It still FAILS — a guard that cannot see the timer must not certify it — but confirm with ' +
          `\`gh run list --workflow=${WORKFLOW} --branch ${BRANCH} --status success\` before blaming the schedule.`
        : `newest green scheduled run is ${ageDays.toFixed(1)} days old, ceiling is ${maxAgeDays}`,
  };
}

/** The run-history query.
 *
 *  Exported, and built here rather than written inline, so a test can pin the
 *  window width against the REAL query string. A constant reading 100 beside a
 *  URL still reading 20 is the failure this shape removes: the guard would look
 *  fixed in the place anybody reads and be unfixed in the place it runs. */
export function buildRunsUrl(repo) {
  return `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?branch=${BRANCH}&status=success&per_page=${RUNS_PAGE_SIZE}`;
}

async function fetchRuns() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN / GH_TOKEN in the environment — cannot read run history, so this fails closed');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const url = buildRunsUrl(repo);
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'nikatru-ci',
    },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status} for ${WORKFLOW} runs`);
  const body = await res.json();
  return body.workflow_runs;
}

async function main() {
  const coverage = assertWatchedWorkflowIntact();
  if (coverage) {
    fail(coverage);
    return;
  }

  const runsFile = flag('--runs-file');
  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    fail(`--now is not a parseable date: ${nowFlag}`);
    return;
  }

  let runs;
  if (runsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --runs-file is set. This must NEVER appear in a real CI log.');
    try {
      runs = JSON.parse(readFileSync(runsFile, 'utf8'));
    } catch (e) {
      fail(`could not read fixture ${runsFile}: ${e.message}`);
      return;
    }
  } else {
    try {
      runs = await fetchRuns();
    } catch (e) {
      fail(`${e.message}`);
      return;
    }
  }

  const verdict = evaluateFreshness(runs, nowMs);

  if (!verdict.ok) {
    fail(`the nightly golden-path proof is not fresh — ${verdict.reason}`);
    if (verdict.windowSaturated) {
      console.error('');
      console.error(`      ⚠️ THE RUN PAGE CAME BACK FULL (per_page=${RUNS_PAGE_SIZE}, this endpoint's maximum), so older`);
      console.error('      successes exist that this query never saw. THIS VERDICT MAY BE A WINDOW ARTIFACT.');
      if (verdict.ageDays === undefined) {
        console.error('      HERE THAT MEANS: the query filters `status=success`, so every green hand-press occupies a');
        console.error('      slot and can push the last scheduled success off the end of the page — a cron that fired');
        console.error('      last night can look stopped.');
      } else {
        console.error('      HERE THAT MEANS: the page is ordered by `created_at` but freshness is graded by');
        console.error('      `updated_at`, and a run created earlier can update later — so a scheduled run truncated');
        console.error('      by created_at can hold a newer updated_at than any row left on the page. Measured');
        console.error('      2026-08-26 the two orderings agreed exactly over the whole retained history, but that is');
        console.error('      a BOUND, NOT A LAW, which is why this is printed rather than assumed away.');
      }
      console.error('      It still fails — a guard that cannot see the timer must not certify it — but LOOK AT THE RUN');
      console.error('      LIST before touching the schedule. Closing this properly means paginating, not widening.');
    }
    console.error('');
    console.error(`      The live E2E has not gone green on a SCHEDULED run on ${BRANCH} recently enough.`);
    console.error('      ⚠️ A MANUAL RUN DOES NOT SATISFY THIS. Freshness is a claim about the timer, so');
    console.error('      only a run triggered by `schedule` counts. Two green `workflow_dispatch` runs sat');
    console.error('      inside the 2026-07-27…08-01 outage; counting them would have called it healthy.');
    console.error('');
    console.error('      ⛔ THE REMEDY IS NOT TO RAISE MAX_AGE_DAYS. It is derived from the cron cadence');
    console.error('      (see this file\'s header) and tolerates a bad night already. If it is red, the');
    console.error('      nightly has been failing or silent for about three days.');
    console.error('');
    console.error('      Where to look, in order:');
    console.error('        · the open GitHub issue the `alert` job files and reuses');
    console.error('        · the ::error:: annotations at the top of the red run page');
    console.error('        · the `e2e-screenshots` artifact on that run — one shot per page');
    console.error('      It runs against LIVE Supabase, the live Worker and live D1, so treat a red');
    console.error('      nightly as production being broken until proven a flake. [pipeline N-6]');
    return;
  }

  console.log(
    `ok  nightly golden-path proof fresh — newest green SCHEDULED ${WORKFLOW} run ${verdict.runId} is ` +
      `${verdict.ageDays.toFixed(1)} day(s) old (ceiling ${MAX_AGE_DAYS}, derived from the daily cron)`,
  );
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
