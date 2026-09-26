#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// assert-e2e-proof-fresh.mjs — the nightly golden-path proof must be RECENT,
// TIMER-DRIVEN, and must still be running the suite it claims to run.
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
// (Private/pre-minimal-2026-09-08:plans/06-app-build-plan.md, increment 7) offered either generalising
// it to a table of workflows or a sibling, and the sibling is what landed:
// `assert-platform-proof-fresh.mjs` belongs to stage 1 ([1]F-4) and its
// MAX_AGE_DAYS is under a standing owner lock, so widening it here would mean
// editing another stage's constant to carry this stage's meaning.
//
// ── 2026-09-06: TWO RECORDS, NOT ONE EVENT FILTER ───────────────────────────
// [ADR 067] phase 2, unit `e2e-proof-fresh-d1`. Until today this guard graded
// the run history for an `event: schedule` row, and that ONE filter was carrying
// TWO different claims at once: that the TIMER fired, and that the RUN passed.
//
// GitHub delivers this repository's scheduled runs 10.1% on time — 899 of 8,928,
// measured across the portfolio (Private research/76 §E). The timer half of the
// fused claim therefore froze the merge queue three times while the workflow
// itself was perfectly healthy (~18h 2026-08-10, ~46h 2026-09-02, and again
// 2026-09-03 into 09-04, where a `workflow_dispatch` on the SAME COMMIT went
// green 44 minutes after the scheduled run failed). A merge-blocking guard whose
// red means "GitHub's queue is busy tonight" is a guard people delete.
//
// 🔴 THE FIX IS NOT TO ACCEPT `workflow_dispatch` AS PROOF OF A TIMER. A
// dispatched run is indistinguishable from a hand-press, so counting one would
// make freshness green on somebody being awake — the exact defect this family
// exists to prevent, and the reason every paragraph below about the 2026-08-01
// outage is left standing word for word. The two claims are SPLIT onto two
// records instead, and BOTH must be fresh:
//
//   · THE TIMER — the `cron_heartbeat` row the platform Worker writes when it
//     dispatches this workflow (`GITHUB_DISPATCH_JOB = 'github_dispatch'` in
//     services/platform/src/scheduled.ts; target `Nikatru_Platform_Public/e2e.yml`).
//     Only a timer writes that row: it is written from inside the Worker's own
//     cron handler, and no browser tab can produce one.
//   · THE OUTCOME — the run history, event filter DROPPED, `head_branch` now
//     MANDATORY. The branch guarantee used to ride on the event filter, because
//     GitHub fires schedules only on the default branch; dropping one without
//     naming the other would have widened this guard to "a green run on any
//     branch", and this workflow HAS green runs on feature branches — four on
//     `feat/e2e-login-via-magic-link`, measured 2026-09-04.
//
// THE DUTY IS ONLY AS FRESH AS ITS STALER LIMB. Both records are graded against
// the same derived ceiling, both are PRINTED on every run — pass or fail — and a
// green verdict names both. tooling/ops/register.json's `duty.workflow.e2e.yml`
// row declares this same pair as `recordQuery` and `recordQuery.timer`, and
// `assertTimerRecordDeclared` below re-reads that declaration every run: the
// constants here and the register are checked AGAINST EACH OTHER rather than
// trusted to stay in step, the same way the cron derivation is.
//
// ⚠️ NARROWED BY JOB **AND** TARGET, AND THAT IS NOT TIDINESS. Measured live
// 2026-09-06: job `github_dispatch` wrote `(dispatcher)` and
// `Nikatru_Platform_Public/ops-watch.yml` on all four daily firings, and
// `Nikatru_Platform_Public/e2e.yml` on exactly ONE of them (that target declares
// `everyHours: 20`). The newest row for the JOB is therefore an ops-watch row
// three firings out of four, so grading e2e's timer on it would let a healthy
// unrelated dispatch vouch for a dispatcher that had not fired in a week.
// assert-ops-register.mjs refuses a `recordQuery.timer` narrowed by neither
// `job` nor `target` for precisely this reason, and the narrowing is applied
// TWICE: in the SQL, and again over the rows that come back, so a widened query
// cannot silently widen the verdict.
//
// ⚠️ e2e.yml KEEPS ITS `schedule:` SLOT and `assertWatchedWorkflowIntact` still
// fails the build if that cron stops being daily. The slot costs a duplicate run
// on the ~40% of nights GitHub delivers, and it is the ROLLBACK: revert this
// change and the old evidence is still being written. MAX_AGE_DAYS is still
// DERIVED from that cron and is UNCHANGED at 3.
//
// ⛔ THIS DOES NOT CLOSE O-E2E-UNPROVEN, AND SAYING SO IS PART OF THE CHANGE.
// That item asks for TEN consecutive green nights, or ~1000 authenticated
// requests before and after — a claim about whether the live path WORKS. This
// guard has only ever asserted that a proof is RECENT and TIMER-DRIVEN: it
// grades the freshness of the evidence, never the evidence itself, and changing
// how it reads the timer cannot advance a count of green nights. What this DOES
// close is the last GitHub-scheduler dependency in a duty
// reader — and it advances O-GITHUB-SCHEDULER.
//
// ── EXIT CODES IN THIS FILE ─────────────────────────────────────────────────
//   0  both records were read and both are inside the ceiling.
//   1  a record was READ and it FAILS — stale, on the wrong branch, no green run
//      at all, or a dispatcher row that records `ok = 0`.
//   2  COVERAGE LOST — a record could NOT BE READ, so nothing was graded: no
//      token, a non-200, an answer that is not JSON, no row at all for the
//      narrowed job+target, the watched workflow gone, its cron no longer daily,
//      the suite ripped out of it, or the register no longer declaring the timer
//      record. [C-COVERAGE-LOST-IS-NOT-PASS] — "I could not tell" must never
//      share an exit code with "every floor holds". Since 2026-09-24 (trap
//      ci-48) also: a request past the shared per-request ceiling, and a run
//      page the cross-read PROVED STALE whose union with the cross-read is still
//      not fresh (a stale page whose cross-read holds a fresh run is exit 0).
//
// ⚠️ ONE DELIBERATE EXCEPTION, AND IT IS NOT A DRAFTING SLIP. `evaluateFreshness`
// prints "COVERAGE LOST" inside two window-saturation DIAGNOSES that still exit
// 1. Those are not unread records: a run list WAS read and graded, and the
// sentence means "the page came back full, so a row you cannot see might be
// newer than the one this verdict names". The finding stands either way — this
// file has said since 2026-08-26 that saturation splits the DIAGNOSIS and never
// the VERDICT — so the exit code follows the verdict, not the wording.
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
// guard then saw a success list with no `event: schedule` row in it at all and
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
// §7.10 item 5 of Private/pre-minimal-2026-09-08:archive/2026-09-05/HANDOFF-ARCHIVE/HANDOFF-2026-08-26.md is where this change was
// ORDERED (the handoff was archived UNEDITED on 2026-08-31; only its path moved),
// and is the ONLY place `per_page` occurs in that handoff: it records
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
// all three counts. Private/pre-minimal-2026-09-08:notes/DEAD-CITATIONS-2026-08-26.md exists because of
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
// FAILS CLOSED, ON BOTH RECORDS. No token, a non-200, malformed JSON, or no
// readable row at all is COVERAGE LOST (exit 2) for the limb that could not be
// read; zero green runs on `main`, or a dispatcher row recording `ok = 0`, is a
// finding (exit 1). "I could not tell" must never read as "it is fine" — that is
// exactly how the original claim became unfalsifiable. Locally, with no
// GH_TOKEN and no CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in the
// environment, this guard therefore exits non-zero by design, identically to
// assert-platform-proof-fresh.mjs.
//
// 🔴 AND A TOKEN THAT IS ABSENT IN SOME CONTEXT MUST YIELD 2, NEVER 0. Both
// credentials are wired into the ONE ci.yml step that runs this guard; the
// assert-ops-register step beside it has carried the same Cloudflare pair since
// the Worker-cron move. A future job that forgets one gets a loud COVERAGE LOST
// naming the missing variable, not a green tick over an unread record.
//
// Offline testing: --runs-file <json> --timer-file <json> --now <iso> injects
// fixture data for BOTH records so the decision logic is genuinely exercised
// without network. It prints a loud banner so its presence in a real CI log is
// unmistakable. Since 2026-09-24 the runs file is an array (a page, no
// cross-read) or { "page": [...], "cross": [...] }, so the stale-page union is
// reachable offline too.
//
// ⚠️ THE TWO FIXTURE FLAGS ARE ALL-OR-NOTHING, and that is a coverage rule, not
// ergonomics. A half-fixture would exercise one limb offline and send the other
// to the live API — or, worse, invite a "skip the limb we have no fixture for"
// branch, which is the shape of every guard that reports green over something it
// never looked at. Supplying one without the other is COVERAGE LOST.
//
// LANE-BOUND: e2e.yml — the subject is the nightly LIVE end-to-end proof, and there is exactly one of
// it. e2e.yml is not a channel lane at all: it appears in no `lane` block of tooling/channel-register.json
// and ships no artifact, so there is nothing to derive the name from. A second live-e2e workflow would
// need its own freshness row with its own cadence, not a share of this one — an age check quantified over
// a SET reports the newest run and hides a dead sibling. [pipeline 9]R-1 limb B.
//
// Usage:  node tooling/ci/assert-e2e-proof-fresh.mjs
//         (needs GITHUB_TOKEN plus CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// 🔴 IMPORTED, NEVER COPIED. tooling/ops/check-heartbeats.mjs owns the one HTTP
// read of `cron_heartbeat` in this tree; a second hand-written copy of that
// query is how two transports drift apart with nobody watching the one that
// moved. `parseJsonc` is the same file's wrangler parser, for the same reason.
import { parseJsonc, queryD1 } from '../ops/check-heartbeats.mjs';
// The run history is read through the SHARED anchored reader (trap ci-48): the
// stale-page anchor, the cross-read, the union and the per-request ceiling.
import { anchoredRunRead, gradeUnion, describeRead } from './anchored-run-read.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW = 'e2e.yml';
const BRANCH = 'main';
const MAX_AGE_DAYS = 3;
// ── THE TIMER RECORD, AND THE ONE PLACE IT IS NAMED ─────────────────────────
// 🔴 DECLARED HERE **AND** CROSS-CHECKED AGAINST THE REGISTER. These three
// constants say what record carries the cadence claim;
// tooling/ops/register.json's `duty.workflow.e2e.yml` row says the same thing to
// ops-watch. Two copies of one fact drift, and the copy that drifts is always
// the one nobody runs — so `assertTimerRecordDeclared` below re-reads the
// register on every run and refuses to grade anything if the two disagree. This
// is the same shape as `assertWatchedWorkflowIntact`: the derivation is
// ENFORCED, not merely documented.
export const TIMER_TABLE = 'cron_heartbeat';
export const TIMER_JOB = 'github_dispatch';
export const TIMER_TARGET = 'Nikatru_Platform_Public/e2e.yml';
const REGISTER_REL = 'tooling/ops/register.json';
const TIMER_ROW_ID = 'duty.workflow.e2e.yml';

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

// 🔴 A SEPARATE EXIT CODE, BECAUSE THEY ARE SEPARATE FACTS. 1 means a record was
// read and it is bad; 2 means a record could not be read at all, so nothing was
// graded. [C-COVERAGE-LOST-IS-NOT-PASS] An assertion that cannot fail is worse
// than none, and one that cannot tell you it never looked is the same defect.
// 2 outranks 1: once a record is unread, the run's verdict is unknown, not bad.
function coverageLost(msg) {
  console.error(`COVERAGE LOST  ${msg}`);
  process.exitCode = 2;
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


// COVERAGE SELF-CHECK, SECOND RECORD. The timer claim lives in a table this
// guard reaches over the network, and the only thing that says WHICH row means
// "the nightly was dispatched" is a declaration. If that declaration moves and
// these constants do not, this guard would read a row that means something else
// and report it as the nightly's timer — the exact fusion the 2026-09-04 split
// exists to undo, wearing a different hat.
//
// So the register's own `recordQuery.timer` is compared field by field with the
// constants above, and the D1 database is resolved from the `wrangler` path THAT
// ROW NAMES rather than from a second hard-coded path. Anything missing or
// disagreeing is COVERAGE LOST: nothing has been graded.
export function assertTimerRecordDeclared(root = ROOT) {
  const regPath = resolve(root, REGISTER_REL);
  if (!existsSync(regPath)) {
    return { error: `COVERAGE LOST — ${REGISTER_REL} does not exist, so nothing declares which ${TIMER_TABLE} row carries this workflow's cadence claim.` };
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(regPath, 'utf8'));
  } catch (e) {
    return { error: `COVERAGE LOST — ${REGISTER_REL} could not be parsed (${e.message}), so the timer record cannot be resolved.` };
  }
  const row = (reg.rows ?? []).find((r) => r && r.id === TIMER_ROW_ID);
  if (!row) {
    return {
      error:
        `COVERAGE LOST — ${REGISTER_REL} declares no row \`${TIMER_ROW_ID}\`. That row is where the two records this ` +
        'guard grades are declared; without it the register and this guard have stopped describing the same duty.',
    };
  }
  const t = row?.mechanism?.recordQuery?.timer;
  if (!t || typeof t !== 'object') {
    return {
      error:
        `COVERAGE LOST — ${TIMER_ROW_ID} declares no \`recordQuery.timer\`. The cadence claim would then rest on the run ` +
        'history alone, which is the fusion this guard stopped making on 2026-09-06: a dispatched run cannot tell a timer ' +
        'from a hand-press. Restore the timer limb, or re-derive what this guard should grade.',
    };
  }
  const disagreements = [];
  if (t.reader !== 'cloudflare-d1-heartbeat') disagreements.push(`reader is ${JSON.stringify(t.reader)}, this guard reads \`cloudflare-d1-heartbeat\``);
  if (t.table !== TIMER_TABLE) disagreements.push(`table is ${JSON.stringify(t.table)}, this guard reads \`${TIMER_TABLE}\``);
  if (t.job !== TIMER_JOB) disagreements.push(`job is ${JSON.stringify(t.job)}, this guard reads \`${TIMER_JOB}\``);
  if (t.target !== TIMER_TARGET) disagreements.push(`target is ${JSON.stringify(t.target)}, this guard reads \`${TIMER_TARGET}\``);
  if (typeof t.wrangler !== 'string' || t.wrangler.length === 0) disagreements.push('no `wrangler` path, so the database cannot be resolved');
  if (disagreements.length) {
    return {
      error:
        `COVERAGE LOST — ${TIMER_ROW_ID}'s \`recordQuery.timer\` and this guard no longer name the same record: ` +
        `${disagreements.join('; ')}. One of the two moved. Fix whichever is wrong IN THE SAME CHANGE — a guard grading ` +
        'a row the register does not declare is reporting on something nobody wrote down.',
    };
  }
  const wranglerPath = resolve(root, t.wrangler);
  if (!existsSync(wranglerPath)) {
    return { error: `COVERAGE LOST — ${TIMER_ROW_ID} resolves its heartbeat database through ${t.wrangler}, which does not exist.` };
  }
  let cfg;
  try {
    cfg = parseJsonc(readFileSync(wranglerPath, 'utf8'));
  } catch (e) {
    return { error: `COVERAGE LOST — ${t.wrangler} could not be parsed (${e.message}), so the database that owns ${TIMER_TABLE} cannot be resolved.` };
  }
  const databaseId = (cfg?.d1_databases ?? []).find((d) => d && d.migrations_dir)?.database_id ?? null;
  if (!databaseId) {
    return {
      error:
        `COVERAGE LOST — ${t.wrangler} has no D1 binding carrying \`migrations_dir\`, so the database that owns ` +
        `${TIMER_TABLE} cannot be resolved. This is the same resolution tooling/ops/check-heartbeats.mjs performs; ` +
        'if it moved, both readers moved.',
    };
  }
  return { error: null, databaseId, wrangler: t.wrangler };
}

/** The timer decision, kept pure so it can be tested without network.
 *
 *  🔴 THE NARROWING IS APPLIED TWICE, ON PURPOSE. The SQL already asks for one
 *  job and one target, and this filter asks again over what came back. That is
 *  not belt-and-braces for its own sake: the query lives in another file
 *  (tooling/ops/check-heartbeats.mjs, shared with ops-watch), so a widening
 *  there — dropping the target clause, or adding a second target — would silently
 *  widen this verdict. Measured live 2026-09-06, the job's newest row is an
 *  ops-watch dispatch three firings out of four, so a widened read does not fail
 *  loudly; it passes, wrongly, on somebody else's healthy job.
 *
 *  ⚠️ `ok = 0` IS A FINDING, NOT A COVERAGE LOSS. The Worker writes a row on
 *  every path — no token, no targets, a 404, a network error — precisely so a
 *  dispatcher that quietly does nothing is distinguishable from one that works.
 *  A row saying the dispatch FAILED is therefore a record that was read and is
 *  bad news, which is exit 1. No row at all is a record that could not be read,
 *  which is exit 2. */
export function evaluateTimer(rows, nowMs, maxAgeDays = MAX_AGE_DAYS) {
  if (!Array.isArray(rows)) {
    return { ok: false, coverageLost: true, reason: `the ${TIMER_TABLE} answer was not an array — treating an unreadable answer as unread, not as healthy` };
  }
  const mine = rows.filter((r) => r && r.job === TIMER_JOB && r.target === TIMER_TARGET && r.ran_at);
  if (mine.length === 0) {
    return {
      ok: false,
      coverageLost: true,
      reason:
        `COVERAGE LOST — no ${TIMER_TABLE} row for job \`${TIMER_JOB}\` target \`${TIMER_TARGET}\`. The Worker writes a row ` +
        'on EVERY dispatch path including its own failures, so an empty answer is not "the dispatch failed" — it is this ' +
        'guard reading a record that is not being written. Check the Worker deployed, that the target is still declared in ' +
        'services/platform/src/scheduled.ts, and that the row names are spelled the same in both places.',
    };
  }
  const green = mine.filter((r) => r.ok === 1 || r.ok === true);
  if (green.length === 0) {
    const newestBad = mine.reduce((a, b) => (Date.parse(b.ran_at) > Date.parse(a.ran_at) ? b : a));
    return {
      ok: false,
      coverageLost: false,
      reason:
        `${mine.length} ${TIMER_TABLE} row(s) for job \`${TIMER_JOB}\` target \`${TIMER_TARGET}\` and NONE records ok = 1 — ` +
        `newest ${newestBad.ran_at}${newestBad.detail ? ` (${String(newestBad.detail).slice(0, 160)})` : ''}. ` +
        'The dispatcher ran and could not fire this workflow, which is a live failure of the alarm clock itself.',
    };
  }
  const newest = green.reduce((a, b) => (Date.parse(b.ran_at) > Date.parse(a.ran_at) ? b : a));
  const stamp = Date.parse(newest.ran_at);
  if (Number.isNaN(stamp)) {
    return { ok: false, coverageLost: true, reason: `COVERAGE LOST — the newest ${TIMER_TABLE} row has an unparseable ran_at: ${newest.ran_at}` };
  }
  const ageDays = (nowMs - stamp) / 86_400_000;
  const stale = ageDays > maxAgeDays;
  return {
    ok: !stale,
    coverageLost: false,
    ageDays,
    ranAt: newest.ran_at,
    reason: stale
      ? `the newest successful \`${TIMER_JOB}\` dispatch of \`${TIMER_TARGET}\` is ${ageDays.toFixed(1)} days old, ceiling is ${maxAgeDays} — ` +
        'the Cloudflare alarm clock has stopped firing this workflow. That is a Worker-cron failure, not a GitHub one: read ' +
        'the ops-watch run and the Worker logs before touching this ceiling, which is DERIVED (see the header).'
      : null,
  };
}

// The decision, kept pure so it can be tested without network. This is where the
// real defects live — the API call is the boring half.
//
// ⏱ 2026-09-24 (trap ci-48): `read`, when given, is what was read —
// { query, rows, crossRows, saturated } from the shared reader — and the stale
// reason then NAMES the newest run, its `updated_at`, the row count and the
// query. PR #913's CI failed with "5.0 days old, ceiling is 3" and nothing else,
// so a stale page and a real five-day gap read identically. `saturated` comes
// from the PAGE, not from `runs.length`: the runs graded are the union of the
// page and its cross-read, and the cross-read's rows say nothing about the page.
export function evaluateFreshness(runs, nowMs, maxAgeDays = MAX_AGE_DAYS, pageSize = RUNS_PAGE_SIZE, read = null) {
  if (!Array.isArray(runs)) {
    return { ok: false, reason: 'run list was not an array — treating an unreadable answer as a failure' };
  }
  // THE PAGE CAME BACK FULL. Computed ONCE, up here, because it qualifies BOTH
  // failing verdicts and not only the zero-scheduled one. A full page means the
  // API had more successes to give and this query never asked for them — which
  // is a coverage loss in this file's own sense: rows the guard is meant to see
  // and did not.
  const windowSaturated = typeof read?.saturated === 'boolean' ? read.saturated : runs.length >= pageSize;
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
  // ⚠️ THE EVENT FILTER IS GONE — READ 'TWO RECORDS, NOT ONE EVENT FILTER' IN
  // THE HEADER BEFORE PUTTING IT BACK. Everything the paragraphs above say about
  // the 2026-08-01 outage remains true and is why the cadence claim did not
  // simply move to `workflow_dispatch`: it moved to a record only a timer can
  // write (`evaluateTimer`). What is left HERE is the OUTCOME, and the outcome's
  // one remaining guarantee is the BRANCH.
  //
  // 🔴 THE BRANCH USED TO RIDE ON THE EVENT FILTER FOR FREE, because GitHub
  // fires schedules only on the default branch. Dropping one without naming the
  // other would have widened this to "a green run anywhere" — and that is not
  // hypothetical: measured 2026-09-04, this workflow held FOUR green runs on
  // `feat/e2e-login-via-magic-link`, any one of which would then have certified
  // the nightly.
  //
  // `head_branch` is the REST field name. `gh run list --json headBranch` spells
  // the same field in camelCase and this guard calls the REST endpoint directly,
  // so snake_case is what arrives. A row that carries neither is DROPPED rather
  // than trusted — a missing branch is not a matching one.
  const onBranch = successes.filter((r) => r.head_branch === BRANCH);
  if (onBranch.length === 0) {
    // TWO DIFFERENT FACTS, AND ONLY ONE OF THEM IS ABOUT THE WORKFLOW. A page
    // that came back FULL means the API had more successes to give and this
    // query never asked for them, so "no run on main here" is a statement about
    // the WINDOW. A short page IS the whole retained success history, so the same
    // emptiness is a statement about the WORKFLOW.
    return {
      ok: false,
      offBranchCount: successes.length,
      windowSaturated,
      reason: windowSaturated
        ? `COVERAGE LOST — ${successes.length} successful run(s) came back and NONE has \`head_branch: ${BRANCH}\`, but THE PAGE WAS FULL ` +
          `(${runs.length} rows >= per_page ${pageSize}), so older successes exist that this query never saw. ` +
          'That is a statement about the WINDOW, not yet about the workflow. It still FAILS — a guard that cannot see the ' +
          `proof must not certify it — but confirm with \`gh run list --workflow=${WORKFLOW} --branch ${BRANCH} --status success\` first.`
        : `${successes.length} successful run(s), and NONE has \`head_branch: ${BRANCH}\` — every green run is on a side branch. ` +
          'The nightly proves the golden path against production from the DEFAULT branch; a feature branch proves that branch.',
    };
  }
  const newest = onBranch.reduce((a, b) => (Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a));
  const stamp = Date.parse(newest.updated_at);
  if (Number.isNaN(stamp)) {
    return { ok: false, reason: `newest run has an unparseable timestamp: ${newest.updated_at}` };
  }
  const ageDays = (nowMs - stamp) / 86_400_000;
  const stale = ageDays > maxAgeDays;
  // What the stale verdict was read from, in the reason itself (trap ci-48).
  const rows = read?.rows ?? runs.length;
  const readFrom =
    ` — run ${newest.id} (updated_at ${newest.updated_at}) is the newest green run on ${BRANCH} of ${rows} row(s) returned by ` +
    `${read?.query ? `GET ${read.query}` : 'the run list handed to this check'}` +
    (Number.isInteger(read?.crossRows) ? ` and ${read.crossRows} row(s) on its cross-read` : '');

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
          `\`gh run list --workflow=${WORKFLOW} --branch ${BRANCH} --status success\` before blaming the schedule.${readFrom}.`
        : `newest green scheduled run is ${ageDays.toFixed(1)} days old, ceiling is ${maxAgeDays}${readFrom}`,
  };
}

/** The newest run that can satisfy the OUTCOME limb: a success on main, by
 *  `updated_at` — the same selection evaluateFreshness grades. */
export function newestGreenOnBranch(runs) {
  const s = (runs ?? []).filter((r) => r && r.conclusion === 'success' && r.head_branch === BRANCH && !Number.isNaN(Date.parse(r.updated_at ?? '')));
  return s.length ? s.reduce((a, b) => (Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a)) : null;
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

async function fetchRuns(nowMs) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error('no GITHUB_TOKEN / GH_TOKEN in the environment — cannot read run history, so this fails closed');
  const repo = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  return readRunHistory({ repo, token, nowMs });
}

/**
 * 🔴 ONE PAGE WAS NEVER EVIDENCE OF ITS OWN CURRENCY (trap ci-48, 2026-09-24).
 * PR #913's CI run 35967342865 read this query at ~07:01Z and was served a page
 * whose newest green run on main was 5.0 days old while 35962444367 (06:06:58Z
 * that day) existed; the same query at 07:05:34Z returned 73 rows, newest
 * 35962444367. This reader had no anchor, no cross-read and no request ceiling.
 * It now reads through tooling/ci/anchored-run-read.mjs, which it shares with
 * assert-platform-proof-fresh.mjs and extensions/scripts/assert-e2e-proof-fresh.mjs.
 *
 * Anchors that fit THIS reader, measured: the cross-read only. It runs in
 * ci.yml and grades e2e.yml, so the self-run floor never applies; e2e.yml has no
 * push trigger at all, so `pushTriggersBranch` is false and no branch head
 * anchors it. The query is kept exactly: `branch=main&status=success`.
 *
 * Exported with an injectable `read(url, { signal })`, `fixture` and `retry`,
 * so the measured page and a read that never answers are test cases.
 */
export async function readRunHistory({ repo = DEFAULT_REPO, token = null, read = null, fixture = undefined, nowMs = Date.now(), retry = {} } = {}) {
  return anchoredRunRead({
    workflow: WORKFLOW,
    url: buildRunsUrl(repo),
    token,
    read,
    fixture,
    nowMs,
    what: `the successful-run history of ${WORKFLOW} on ${BRANCH}`,
    label: `${WORKFLOW} runs`,
    retry,
  });
}

/** The OUTCOME verdict, graded on the UNION of the page and its cross-read
 *  (decision E2), with the read's own facts carried into the stale reason. */
export function gradeRunHistory(read, nowMs) {
  const ctx = { query: read.query, rows: read.page.length, crossRows: read.cross ? read.cross.runs.length : null, saturated: read.saturated };
  return gradeUnion(read, (runs) => evaluateFreshness(runs, nowMs, MAX_AGE_DAYS, RUNS_PAGE_SIZE, ctx), newestGreenOnBranch);
}

/** The timer-record query, over the SHARED reader.
 *
 *  Errors are thrown, never swallowed: `queryD1` throws on a missing credential,
 *  a non-200 and an answer that is not JSON, and every one of those is a record
 *  this guard could not read. main() turns them into COVERAGE LOST. */
async function fetchTimerRows(databaseId) {
  return queryD1(databaseId, TIMER_JOB, TIMER_TARGET);
}

async function main() {
  const coverage = assertWatchedWorkflowIntact();
  if (coverage) {
    coverageLost(coverage);
    return;
  }

  // The second record's declaration is resolved BEFORE anything is read, so a
  // register that has stopped declaring the timer fails on the declaration
  // rather than on an empty query — which reads like a dead dispatcher.
  const timerDecl = assertTimerRecordDeclared();
  if (timerDecl.error) {
    coverageLost(timerDecl.error);
    return;
  }

  const runsFile = flag('--runs-file');
  const timerFile = flag('--timer-file');
  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    fail(`--now is not a parseable date: ${nowFlag}`);
    return;
  }

  if (Boolean(runsFile) !== Boolean(timerFile)) {
    coverageLost(
      `offline fixture mode was given ${runsFile ? '--runs-file' : '--timer-file'} and not the other. Both records are ` +
        'graded on every run, so a half-fixture would exercise one limb offline and send the other to the live API — or ' +
        'invite a "skip the limb we have no fixture for" branch, which is how a guard comes to report green over something ' +
        'it never looked at. Supply both, or neither.',
    );
    return;
  }

  let read = null;
  let timerRows;
  let runsError = null;
  let timerError = null;
  if (runsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --runs-file and --timer-file are set. This must NEVER appear in a real CI log.');
    // `--runs-file` holds an array (a page, and no cross-read — reported as
    // `not run (fixture has none)`) or { "page": [...], "cross": [...] }
    // (decision E6). Either way it goes through the reader the live path uses,
    // and nothing reaches the network.
    try {
      const doc = JSON.parse(readFileSync(runsFile, 'utf8'));
      read = await readRunHistory({ repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO, fixture: doc, nowMs });
    } catch (e) {
      runsError = `could not read fixture ${runsFile}: ${e.message}`;
    }
    try {
      timerRows = JSON.parse(readFileSync(timerFile, 'utf8'));
    } catch (e) {
      timerError = `could not read fixture ${timerFile}: ${e.message}`;
    }
  } else {
    // 🔴 BOTH READS ARE ATTEMPTED EVEN WHEN THE FIRST FAILS. Returning early on
    // the run-list error would print one line about a missing GITHUB_TOKEN and
    // say nothing at all about the timer, so an operator fixing the first would
    // discover the second only on the next run. Both records are read, both
    // verdicts are printed, and the exit code is the worst of them.
    try {
      read = await fetchRuns(nowMs);
    } catch (e) {
      runsError = e.message;
    }
    try {
      timerRows = await fetchTimerRows(timerDecl.databaseId);
    } catch (e) {
      timerError = e.message;
    }
  }

  const runVerdict = runsError ? { ok: false, coverageLost: true, reason: runsError } : gradeRunHistory(read, nowMs);
  const timerVerdict = timerError ? { ok: false, coverageLost: true, reason: timerError } : evaluateTimer(timerRows, nowMs);

  // ── BOTH LIMBS, SIDE BY SIDE, ON EVERY RUN ────────────────────────────────
  // Printed pass or fail. A guard that prints only what went wrong leaves the
  // reader unable to tell "the other record is healthy" from "the other record
  // was never looked at", and this file's whole subject is that difference.
  const say = (v, label, ok) => (ok ? console.log : console.error)(`      ${label}  ${v}`);
  say(
    runVerdict.ok
      ? `green run ${runVerdict.runId} on ${BRANCH}, ${runVerdict.ageDays.toFixed(1)} day(s) old (ceiling ${MAX_AGE_DAYS})`
      : String(runVerdict.reason),
    'OUTCOME (GitHub run history) :',
    runVerdict.ok,
  );
  // DECISION E3 — WHAT WAS READ, pass or fail: the query, rows, per_page,
  // saturation, the newest green run on main and the cross-read. PR #913's red
  // printed none of it, so a stale page could not be told from a real gap.
  say(read ? describeRead(read, newestGreenOnBranch) : 'nothing was read — see the line above', 'READ    (GitHub run history) :', runVerdict.ok);
  if (runVerdict.stalePageCarried) console.log(runVerdict.stalePageCarried);
  say(
    timerVerdict.ok
      ? `${TIMER_TABLE} row for ${TIMER_JOB} -> ${TIMER_TARGET} at ${timerVerdict.ranAt}, ${timerVerdict.ageDays.toFixed(1)} day(s) old (ceiling ${MAX_AGE_DAYS})`
      : String(timerVerdict.reason),
    'TIMER   (D1 cron_heartbeat) :',
    timerVerdict.ok,
  );

  // THE DUTY IS ONLY AS FRESH AS ITS STALER LIMB, and an unread record outranks
  // a bad one: 2 beats 1 beats 0.
  const lost = (!runVerdict.ok && runVerdict.coverageLost) || (!timerVerdict.ok && timerVerdict.coverageLost);
  const failed = !runVerdict.ok || !timerVerdict.ok;

  if (failed) {
    if (lost) {
      coverageLost('the nightly golden-path proof could not be graded — one of the two records above was not readable.');
    } else {
      fail('the nightly golden-path proof is not fresh — see the two records above.');
    }
    if (runVerdict.windowSaturated) {
      console.error('');
      console.error(`      ⚠️ THE RUN PAGE CAME BACK FULL (per_page=${RUNS_PAGE_SIZE}, this endpoint's maximum), so older`);
      console.error('      successes exist that this query never saw. THIS VERDICT MAY BE A WINDOW ARTIFACT.');
      if (runVerdict.ageDays === undefined) {
        console.error('      HERE THAT MEANS: the query filters `status=success`, so every green hand-press occupies a');
        console.error(`      slot and can push the last green ${BRANCH} run off the end of the page.`);
      } else {
        console.error('      HERE THAT MEANS: the page is ordered by `created_at` but freshness is graded by');
        console.error('      `updated_at`, and a run created earlier can update later — so a run truncated');
        console.error('      by created_at can hold a newer updated_at than any row left on the page. Measured');
        console.error('      2026-08-26 the two orderings agreed exactly over the whole retained history, but that is');
        console.error('      a BOUND, NOT A LAW, which is why this is printed rather than assumed away.');
      }
      console.error('      It still fails — a guard that cannot see the proof must not certify it — but LOOK AT THE RUN');
      console.error('      LIST before touching the schedule. Closing this properly means paginating, not widening.');
    }
    console.error('');
    console.error(`      THE PROOF IS TWO RECORDS AND BOTH MUST BE FRESH: a green ${WORKFLOW} run on ${BRANCH}`);
    console.error(`      (the OUTCOME), and a ${TIMER_TABLE} row written by the Worker that dispatched it (the TIMER).`);
    console.error('      ⚠️ A HAND-PRESSED RUN CANNOT SATISFY THIS EITHER. It can satisfy the outcome limb, which is');
    console.error('      why the cadence claim no longer lives there: only the Worker\'s cron handler writes the');
    console.error(`      \`${TIMER_JOB}\` row for \`${TIMER_TARGET}\`, and that row is graded against the same ceiling.`);
    console.error('');
    console.error('      ⛔ THE REMEDY IS NOT TO RAISE MAX_AGE_DAYS. It is derived from the cron cadence');
    console.error('      (see this file\'s header) and tolerates a bad night already. If it is red, the');
    console.error('      nightly has been failing or silent for about three days.');
    console.error('');
    console.error('      Where to look, in order:');
    console.error('        · if the TIMER limb is red — the ops-watch run and the Worker logs; the alarm clock is');
    console.error('          Cloudflare now, not GitHub, so a frozen GitHub scheduler is no longer the suspect');
    console.error('        · the open GitHub issue the `alert` job files and reuses');
    console.error('        · the ::error:: annotations at the top of the red run page');
    console.error('        · the `e2e-screenshots` artifact on that run — one shot per page');
    console.error('      It runs against LIVE Supabase, the live Worker and live D1, so treat a red');
    console.error('      nightly as production being broken until proven a flake. [pipeline N-6]');
    console.error('');
    console.error('      ⛔ AND A GREEN VERDICT HERE IS NOT A PROOF THAT THE LIVE PATH WORKS. This guard grades');
    console.error('      the FRESHNESS of the evidence, never the evidence; the live-path proof is O-E2E-UNPROVEN.');
    return;
  }

  console.log(
    `ok  nightly golden-path proof fresh on BOTH records — green ${WORKFLOW} run ${runVerdict.runId} on ${BRANCH} is ` +
      `${runVerdict.ageDays.toFixed(1)} day(s) old, and the Worker's ${TIMER_JOB} dispatch of ${TIMER_TARGET} is ` +
      `${timerVerdict.ageDays.toFixed(1)} day(s) old (ceiling ${MAX_AGE_DAYS}, derived from the daily cron). ` +
      'This says the proof is RECENT and TIMER-DRIVEN; it does not close O-E2E-UNPROVEN.',
  );
}

// Only run when executed directly, so the pure halves can be imported by tests.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
