#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// check-heartbeats.mjs — the READER for the run records nothing was reading.
//
// [pipeline O-4] "The absence or wrongness of a run alarms, from OUTSIDE the
// system being watched."
//
// 🔴 THE STATE THIS WAS BUILT AGAINST, MEASURED ON THE REAL PRODUCTION TABLE.
// `platform_db.cron_heartbeat` had been carrying `ok = 0` — "HTTP 401 —
// REJECTED … no SUPABASE_ANON_KEY configured" — for three consecutive nights,
// and `grep -rn cron_heartbeat` across the whole tree returned the DDL, the
// INSERT, two comments and a test comment. ZERO READERS. The instrument had
// already been repaired (the `ok` semantics bug is fixed in scheduled.ts) and
// nobody had plugged anything into it. A dial nobody looks at is not monitoring.
//
// The keep-alive matters beyond the guard: it is the only thing standing between
// the shared Supabase auth project and a ~7-day idle pause, and a paused auth
// project takes sign-in down across the whole portfolio.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS RUNS ON GITHUB ACTIONS AND NOT ON THE CLOUDFLARE CRON IT WATCHES.
// Deliberately a DIFFERENT PROVIDER. A watcher hosted inside the system it
// watches goes down with it and reports nothing, which is indistinguishable from
// "everything is fine" — the whole class of bug this file exists to end. The one
// provably complete alarm chain in this portfolio (backup script → GlitchTip
// heartbeat monitor → alert rule → email) has exactly this shape, and it is the
// template being copied rather than a new mechanism being invented.
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE WAYS TO BE RED, AND THE THIRD IS THE ONE THAT MATTERS.
//
//   1. ABSENT   — the job's most recent SCHEDULED OCCURRENCE WHOSE GRACE HAS
//                 EXPIRED left no row (⏱ 2026-09-24: "whose grace has expired"
//                 moved into the choice of occurrence; see evaluateJob). Anchored
//                 on when the run was DUE, not on how old the newest row is.
//                 🔴 It was the latter until 2026-08-06 — "older than 1.5× the
//                 interval" — and that rule is GREEN ON A SINGLE MISSED NIGHTLY
//                 RUN, because a daily reader looking at a daily cron sees a
//                 ~28h-old row the morning after a miss and 28 < 36. It was not
//                 reasoned wrong, it was MEASURED wrong: the Worker's 06:00Z
//                 cron did not fire on 2026-08-06 and ops-watch run
//                 31091922078 reported healthy that morning. See
//                 MISSED_RUN_GRACE_HOURS for the full arithmetic and evidence.
//   2. RED      — the newest row for a job carries the failing value.
//                 ⚠️ `ok = 1` IS NO LONGER A SAFE PROXY FOR "A ROW EXISTS". Now
//                 that the semantics are correct, a check that merely asserts
//                 "a heartbeat landed today" is GREEN ON A FAILING KEEP-ALIVE.
//                 Assert on the outcome column, not on the row's presence.
//   2b. CAPPED  — ⏱ 2026-10-01: a retention job whose newest N rows are all ok=1
//                 and all say a store was still full when its budget ran out
//                 (`cappedNightsRed` in the register). Graded as RED: exit 1.
//   3. UNKNOWN  — no token, a non-200, unparseable JSON, an unrecognised cron
//                 expression. ALL FAIL CLOSED. "I could not tell" must never
//                 read as "it is fine"; that is precisely how the original claim
//                 became unfalsifiable.
//   ⬜ NOT YET DUE — not a fourth red: a job with NO row at all whose first slot
//                 after the instant the register began watching it
//                 (`watchedJobsDeclaredAt`) has not yet ended its grace. It
//                 PRINTS, and becomes ABSENT at that instant by arithmetic.
//
// ⏱ 2026-10-03 · A SLOT IS OWED BY THE SCHEDULE THAT WAS LIVE WHEN IT FELL DUE.
// The register on main says which cron each job keeps NOW; the Worker runs
// whatever release was deployed. Ops watch 37137496614 judged seven jobs ABSENT
// for slots (06:10-06:40Z, and 12:00Z for the two probes) that no live release
// had ever scheduled: #1165 moved them onto new crons, merged 15:29:59Z, and the
// Worker carrying that split went live 16:17:38Z. Every one had run inside the
// 06:00Z firing, ok=1. So each slot is now judged by the job's crons in the
// register AT THE RELEASE LIVE WHEN IT FELL DUE, read from the deploy ledger
// (deploy-workers.yml's `record-deployment.mjs <worker>` rows: sha + time) and
// `git show <sha>:tooling/ops/register.json`. See `owedSlot` and `jobTimeline`.
// A ledger or a register that cannot be read falls back to main's schedule —
// the stricter reading, the one this reader always used — and says so.
//
// EXIT CODES (INV6, 2026-09-11): 0 every duty fresh or not yet due · 1 a duty is
// ABSENT or RED · 2 COVERAGE LOST — the watched set could not be derived, the
// heartbeat table could not be READ (no token, a non-200, not JSON, no results
// array), or an input could not be parsed. 2 beats 1. Until 2026-09-11 a read
// failure printed "scheduled duty is not reporting healthy" and exited 1, and
// through ops-watch that false red reached every merge (REVIEW-guards-2026-09-10 #1).
//
// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE SELF-CHECK, because a watcher watching a name nothing writes is the
// exact defect this repo keeps re-finding. The job names come from the register,
// and each one must APPEAR IN THE WORKER'S OWN SOURCE. Renaming
// `KEEPALIVE_JOB` in scheduled.ts without updating the register would otherwise
// leave this querying a job that never writes a row — which is "absent" forever,
// or, if the absence limb were ever softened, green forever.
//
// Offline testing: --rows-file <json> --now <iso> injects fixture rows so every
// decision branch is exercised without network. It prints a loud banner so its
// presence in a real log is unmistakable.
//
// Usage:  node tooling/ops/check-heartbeats.mjs [--root <repoRoot>] [--releases-file <json>]
// Env:    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; GITHUB_TOKEN (+ GITHUB_REPOSITORY)
//         for the deploy ledger. `--releases-file` stands in for it offline:
//         { "ledger": { "<worker>": [{ sha, created_at }] }, "registers": { "<sha>": <register> } }
//         (a sha with no `registers` entry is read with `git show`). With `--rows-file`
//         and no releases file the ledger is not read: main's schedule judges every slot.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CouldNotLook, classifyThrown, transientLook, isTransientStatus, retryAfterMs, readWithBoundedRetry } from './bounded-retry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTER_REL = 'tooling/ops/register.json';

/**
 * How long after a SCHEDULED OCCURRENCE a missing row is still merely late.
 *
 * 🔴 THIS REPLACED A `1.5 x interval` STALENESS CEILING ON 2026-08-06, AND THE
 * CEILING WAS MEASURED WRONG BY A REAL EVENT RATHER THAN ARGUED WRONG.
 *
 * The old rule: red when the newest row is older than `interval x 1.5`. Its
 * stated reasoning — "tight enough to catch a dead timer within one cycle" —
 * was inherited verbatim from the backup chain and never re-derived for THIS
 * chain. It is false here, and the arithmetic is not subtle:
 *
 *   the cron is `0 6 * * *`             -> interval 24h, ceiling 36h
 *   this reader runs from ops-watch.yml -> ONCE A DAY
 *
 * so on the morning after a missed run the newest row is ~28h old, which is
 * INSIDE 36h, and the next day either the cron recovered (a fresh row, green)
 * or it did not (49h, red). **A single missed nightly run could therefore never
 * alarm at all** — the watcher had to miss twice in a row to say anything.
 *
 * That is not a hypothesis. On 2026-08-06 the platform Worker's 06:00Z cron did
 * not fire (proven: zero `eventType: cron` events in Cloudflare's own
 * observability log for 05:55–06:05Z, against three on 08-05, with 20 fetch
 * events from the same script inside the same window proving the query could
 * see). `ops-watch` run 31091922078 ran at 10:06Z that morning and went GREEN.
 * The watcher built to make an absent run visible reported health through the
 * only absent run it has ever had to see.
 *
 * ── WHY AN OCCURRENCE, NOT A BIGGER RATIO ────────────────────────────────────
 * Shrinking 1.5 to 1.1 would move the ceiling to 26.4h and appear to fix it.
 * It does not: the ceiling is measured from the LAST SUCCESS, so it drifts with
 * whatever time the previous run happened to land, and it still answers "how
 * stale is the newest row" when the question is "did the run that was supposed
 * to happen, happen". Those come apart precisely when a schedule stops. So the
 * limb now names the occurrence: the most recent time the cron was DUE, and
 * whether a row exists at or after it.
 *
 * The grace is what keeps a LATE run from being an alarm — the property the old
 * ratio was really buying, now bought explicitly and at a tenth of the cost.
 * Two hours: Cloudflare documents cron triggers as best-effort and this one is
 * consistently ~36s late, while `ops-watch` itself lands 2.5–4h after its own
 * `30 7` schedule (GitHub queue delay, measured across six runs), so the reader
 * always looks well after the grace has expired on a genuinely missed run.
 */
const MISSED_RUN_GRACE_HOURS = 2;

// `indexOf` returns -1 when absent, and -1 + 1 === 0 silently selects argv[0].
// That off-by-one shipped once in this repo and blocked both production deploys
// with the SHA plainly in the command line. Never repeat it.
function flag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  return process.argv[i + 1] ?? null;
}

const ROOT = resolve(flag('--root') ?? join(HERE, '..', '..'));

export function parseJsonc(text) {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    const c2 = text[i + 1];
    if (inStr) {
      if (c === '\\') { out += c + (c2 ?? ''); i += 2; continue; }
      if (c === '"') inStr = false;
      out += c; i++; continue;
    }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2; continue;
    }
    out += c; i++;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Cron expression → interval in hours. DELIBERATELY NARROW: it recognises only
 * the shapes this repo actually uses and returns null for everything else,
 * which the caller treats as UNKNOWN and therefore RED. A generous parser that
 * guessed would be a silent source of a wrong window, and a wrong window is a
 * staleness check that cannot fire.
 *
 * ⏱ 2026-09-24 (O-OPS-WATCHDOG-STUCK-RUNS-HOURLY): THREE SHAPES, NOT TWO. A
 * literal minute and hour, daily or on one weekday, as before; and exactly
 * `<literal minute 0-59> * * * *`, hourly, for the platform Worker's stuck-run
 * check. Every other `*` hour — a step, a list, a range, a `*` minute, an hourly
 * shape with any day or month field — is still refused, by both parsers.
 */
export function cronIntervalHours(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const literal = (v) => /^\d+$/.test(v);
  if (hour === '*') return literal(min) && Number(min) <= 59 && dom === '*' && mon === '*' && dow === '*' ? 1 : null;
  if (!literal(min) || !literal(hour)) return null;
  if (mon !== '*') return null;
  if (dom === '*' && dow === '*') return 24;
  if (dom === '*' && literal(dow)) return 24 * 7;
  return null;
}

/**
 * Cron expression → the most recent time it was DUE, at or before `nowMs`.
 *
 * Deliberately as narrow as `cronIntervalHours` and rejecting the same shapes,
 * so the two never disagree about what this reader understands: a widened
 * parser here would silently compute an occurrence for a schedule the interval
 * limb had already refused, and the two answers would drift apart unseen.
 * ⏱ 2026-09-24: both were widened TOGETHER, by the one hourly shape
 * `<literal minute 0-59> * * * *` and nothing else (see `cronIntervalHours`);
 * `deriveWatchedJobs` still asks both, and heartbeats.test.mjs holds the refusals.
 *
 * All arithmetic is UTC. `cron_heartbeat.ran_at` is written with `toISOString()`
 * and Cloudflare's scheduler is UTC, so introducing a local timezone anywhere on
 * this path would move the expected fire by hours on this machine and by zero in
 * CI — a difference that shows up as a flaky alarm rather than a wrong answer.
 */
export function lastExpectedFireMs(expr, nowMs) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const literal = (v) => /^\d+$/.test(v);
  if (hour === '*') {
    if (!literal(min) || Number(min) > 59 || dom !== '*' || mon !== '*' || dow !== '*') return null;
    // This hour's minute once it has passed, else the previous hour's. UTC has no
    // DST, so stepping back one hour is exact.
    const now = new Date(nowMs);
    const thisHour = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), Number(min), 0, 0);
    return thisHour <= nowMs ? thisHour : thisHour - 3_600_000;
  }
  if (!literal(min) || !literal(hour)) return null;
  if (mon !== '*') return null;
  const m = Number(min);
  const h = Number(hour);
  if (m > 59 || h > 23) return null;

  const now = new Date(nowMs);
  const at = (dayShift) =>
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayShift, h, m, 0, 0);

  if (dom === '*' && dow === '*') {
    const today = at(0);
    return today <= nowMs ? today : at(-1);
  }
  if (dom === '*' && literal(dow)) {
    const want = Number(dow);
    // Walk back at most a full week; the first matching weekday whose time has
    // already passed is the occurrence.
    //
    // ⚠️ NO `if (want > 6) return null` HERE, AND ITS ABSENCE IS A MEASURED
    // RESULT, NOT AN OVERSIGHT. That check was written, then mutation-tested:
    // widening it to `want > 99` changed NO test outcome, because the bounded
    // walk below already returns null for any `want` no weekday can equal. A
    // redundant guard inflates apparent coverage while asserting nothing, so it
    // was removed rather than kept for comfort — the same call this repo made on
    // the Ed25519 length checks. `'0 6 * * 9'` is still negative-tested.
    for (let back = 0; back <= 7; back++) {
      const t = at(-back);
      if (t <= nowMs && new Date(t).getUTCDay() === want) return t;
    }
    return null;
  }
  return null;
}

/**
 * Cron expression → the FIRST time it is due strictly AFTER `fromMs`, or null.
 *
 * Built on `lastExpectedFireMs`, so the two can never disagree about the grammar:
 * exactly one occurrence falls in any half-open period after `fromMs`, so the
 * latest occurrence at or before `fromMs + interval` is the first one after it.
 * It answers ONE question — "has the first slot after this job was declared come
 * and gone?" — which is what lets an empty record be NOT YET DUE rather than ABSENT.
 */
export function firstFireAfterMs(expr, fromMs) {
  const hours = cronIntervalHours(expr);
  if (hours === null || !Number.isFinite(fromMs)) return null;
  const t = lastExpectedFireMs(expr, fromMs + hours * 3_600_000);
  return t !== null && t > fromMs ? t : null;
}

/**
 * ⏱ 2026-10-03 · THE NEWEST SLOT THE RELEASE LIVE AT IT OWED, past its grace.
 *
 * `timeline` is one job's schedule per release: `[{ fromMs, crons, sha }]`, each
 * entry the job's cron list in the register of the release that went live at
 * `fromMs` (the oldest entry's `fromMs` is -Infinity: everything before it is
 * taken to have run it). A slot of cron `c` is owed only when it falls inside an
 * entry whose `crons` holds `c`. One entry from -Infinity with main's crons is
 * exactly the rule this reader always applied.
 *
 * Returns `{ dueMs, cron, sha, fromMs }`, `{ unreadable: cron }` when ANY entry
 * names an expression this reader cannot read (refused, never skipped — the
 * same rule as before), or `null` when no entry owed a slot yet.
 *
 * 🔴 IT CANNOT HIDE A MISSED SLOT OF A LIVE SCHEDULE. A slot is dropped only when
 * the release running at that instant did not schedule the job on that cron, so
 * the Worker could not have run it then. After the deploy, the new crons own every
 * slot (heartbeats.test.mjs, the red control).
 */
export function owedSlot(timeline, nowMs) {
  const segs = (Array.isArray(timeline) ? timeline : []).filter((s) => s && Array.isArray(s.crons));
  for (const s of segs) {
    for (const c of s.crons) {
      if (cronIntervalHours(c) === null || lastExpectedFireMs(c, nowMs) === null) return { unreadable: c };
    }
  }
  const sorted = [...segs].sort((a, b) => a.fromMs - b.fromMs);
  const asOf = nowMs - MISSED_RUN_GRACE_HOURS * 3_600_000;
  let best = null;
  for (let i = 0; i < sorted.length; i++) {
    const { fromMs, crons } = sorted[i];
    // A slot AT the next release's instant belongs to the next release.
    const until = Math.min(asOf, i + 1 < sorted.length ? sorted[i + 1].fromMs - 1 : Infinity);
    if (until < fromMs) continue;
    for (const c of crons) {
      const s = lastExpectedFireMs(c, until);
      if (s !== null && s >= fromMs && (best === null || s > best.dueMs)) {
        best = { dueMs: s, cron: c, sha: sorted[i].sha ?? null, fromMs };
      }
    }
  }
  return best;
}

/** How far back the deploy ledger is turned into schedule entries: a weekly
 *  cron's period plus its grace, and a day to spare. Older releases cannot hold
 *  the newest owed slot of any shape `cronIntervalHours` accepts. */
export const SCHEDULE_LOOKBACK_MS = (24 * 7 + MISSED_RUN_GRACE_HOURS + 24) * 3_600_000;

/**
 * ⏱ 2026-10-03 · One job's `owedSlot` timeline, from the deploy ledger.
 *
 * `releases` are ledger rows `{ sha, liveFromMs }` (any order); `registerAt(sha)`
 * answers the parsed tooling/ops/register.json at that commit, or null. A release
 * whose register — or whose row `rowId`, or whose watchedJobs MAP — cannot be
 * read is judged by `headCrons` (main's) and named in `notes`: the stricter
 * reading, never a skip. A release whose register does not watch `job` owed it
 * nothing. Only releases live inside SCHEDULE_LOOKBACK_MS of `nowMs` are read,
 * and the oldest kept one is taken back to -Infinity.
 *
 * Returns `{ timeline: null }` when the ledger names no release: the caller then
 * judges by main's schedule, as before.
 */
export function jobTimeline(rowId, job, headCrons, releases, registerAt, nowMs) {
  const notes = [];
  const sorted = (Array.isArray(releases) ? releases : [])
    .filter((r) => r && typeof r.sha === 'string' && Number.isFinite(r.liveFromMs))
    .sort((a, b) => a.liveFromMs - b.liveFromMs);
  if (!sorted.length) return { timeline: null, notes };
  // The newest release live at the window's start, and every one after it.
  let first = 0;
  for (let i = 0; i < sorted.length; i++) if (sorted[i].liveFromMs <= nowMs - SCHEDULE_LOOKBACK_MS) first = i;
  const timeline = sorted.slice(first).map((r, i) => {
    const reg = registerAt(r.sha);
    const row = Array.isArray(reg?.rows) ? reg.rows.find((x) => x?.id === rowId) : null;
    const wj = row?.watchedJobs;
    let crons;
    if (!wj || typeof wj !== 'object' || Array.isArray(wj)) {
      notes.push(
        `release ${r.sha.slice(0, 12)} (live ${new Date(r.liveFromMs).toISOString()}) — its register ` +
          `${!reg ? 'could not be read' : !row ? `has no row ${rowId}` : 'has no watchedJobs MAP'}, so its slots are judged by main's schedule.`,
      );
      crons = headCrons;
    } else {
      // Absent: the job did not exist at that release, so it owed nothing. Present
      // and not a list cannot be read, so it is judged by main's, like the rest.
      crons = Array.isArray(wj[job]) ? wj[job] : Object.prototype.hasOwnProperty.call(wj, job) ? headCrons : [];
    }
    return { fromMs: i === 0 ? -Infinity : r.liveFromMs, crons, sha: r.sha };
  });
  return { timeline, notes };
}

/**
 * The integer a heartbeat `detail` carries as `<name>=<n>`, or null. The token
 * must open the detail or follow whitespace, so `capped` never reads the number
 * inside `prune_capped=`.
 */
export function detailToken(detail, name) {
  const m = new RegExp(`(?:^|\\s)${name}=(\\d+)(?![\\w.])`).exec(String(detail ?? ''));
  return m ? Number(m[1]) : null;
}

/**
 * ⏱ 2026-10-01. The targets whose newest `nights` rows ALL carry `token` above 0.
 * Fewer than `nights` rows for a target is not enough history to say so, and a
 * row without the token (a run that failed before it could count) breaks the
 * streak rather than extending it: that run is graded by the outcome limb.
 */
export function cappedTargets(rows, token, nights) {
  const byTarget = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const key = r.target ?? '(none)';
    if (!byTarget.has(key)) byTarget.set(key, []);
    byTarget.get(key).push(r);
  }
  const stuck = [];
  for (const [target, list] of byTarget) {
    const newest = [...list].sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at)).slice(0, nights);
    if (newest.length === nights && newest.every((r) => (detailToken(r.detail, token) ?? 0) > 0)) stuck.push(target);
  }
  return stuck;
}

/**
 * The decision, kept pure. `rows` are the newest-first heartbeat rows for ONE
 * job; `cronExpr` is that job's declared cron expression; `capped`, when the
 * register declares one for the job, is `{ token, nights }` (cappedNightsRed).
 *
 * ⚠️ It takes the EXPRESSION, not a precomputed interval, and that is the whole
 * repair: an interval can only answer "how old is the newest row", which is a
 * different question from "did the run that was due actually run". See
 * MISSED_RUN_GRACE_HOURS for the real event that separated them.
 */
export function evaluateJob(job, rows, cronExpr, nowMs, declaredAtMs = null, capped = null, timeline = null) {
  if (!Array.isArray(rows)) {
    return { ok: false, kind: 'unknown', reason: `${job}: the query result was not an array — an unreadable answer is a failure, not a pass` };
  }
  if (rows.length === 0) {
    // ⬜ NOT YET DUE, 2026-09-11. An empty record is owed nothing until the first
    // slot after the job was DECLARED has passed its grace. Bounded three ways: it
    // applies only to ZERO rows (a job that has ever written is graded as always),
    // only from a declaration instant `deriveWatchedJobs` refuses in the future,
    // and it expires by arithmetic at one period plus the grace.
    const cronList = Array.isArray(cronExpr) ? cronExpr : [cronExpr];
    const firsts = Number.isFinite(declaredAtMs) ? cronList.map((c) => firstFireAfterMs(c, declaredAtMs)) : [];
    if (firsts.length && firsts.every((t) => t !== null)) {
      const firstMs = Math.min(...firsts);
      const graceEndsMs = firstMs + MISSED_RUN_GRACE_HOURS * 3_600_000;
      const iso = (ms) => new Date(ms).toISOString();
      if (nowMs <= graceEndsMs) {
        return {
          ok: true,
          pending: true,
          kind: 'pending',
          reason:
            `${job}: NOT YET DUE — no heartbeat row has been written and none is owed yet. The register began watching it ` +
            `${iso(declaredAtMs)}; its first slot after that is ${iso(firstMs)} (cron \`${cronList.join('` `')}\`), and the ` +
            `${MISSED_RUN_GRACE_HOURS}h grace on that slot ends ${iso(graceEndsMs)}. From that instant an empty record is ` +
            'ABSENT, whether or not anybody edits the row.',
        };
      }
      return {
        ok: false,
        kind: 'absent',
        reason:
          `${job}: NO heartbeat row has ever been written, and the first slot after the register began watching it ` +
          `(${iso(declaredAtMs)} -> ${iso(firstMs)}) ended its ${MISSED_RUN_GRACE_HOURS}h grace ` +
          `${((nowMs - graceEndsMs) / 3_600_000).toFixed(1)}h ago. The job has never run, or it cannot write its own record.`,
      };
    }
    return { ok: false, kind: 'absent', reason: `${job}: NO heartbeat row has ever been written. The job has never run, or it cannot write its own record.` };
  }
  const newest = rows.reduce((a, b) => (Date.parse(b.ran_at) > Date.parse(a.ran_at) ? b : a));
  const stamp = Date.parse(newest.ran_at);
  if (Number.isNaN(stamp)) {
    return { ok: false, kind: 'unknown', reason: `${job}: newest row has an unparseable ran_at (${newest.ran_at})` };
  }
  const ageHours = (nowMs - stamp) / 3_600_000;

  // ── THE ABSENCE LIMB, ANCHORED ON THE OCCURRENCE ─────────────────────────
  // An unparseable expression is UNKNOWN, never a pass: `deriveWatchedJobs`
  // already refuses to build a job from a cron this reader cannot read, so
  // reaching here with one means the two parsers disagree — which is exactly
  // the state that must fail closed rather than be assumed benign.
  // 🔴 ONE JOB MAY KEEP SEVERAL SCHEDULES, and the occurrence that matters is
  // the MOST RECENT one due across all of them. `github_dispatch` fires on both
  // of the Worker's crons while the nightly limbs fire on one; judging it
  // against the 06:00 expression alone would call it absent every evening.
  // A string is still accepted so the 50-odd single-cron cases read unchanged.
  //
  // ⏱ 2026-09-24 (O-OPS-WATCHDOG-STUCK-RUNS-HOURLY) — THE ANCHOR IS THE NEWEST
  // OCCURRENCE WHOSE GRACE HAS ENDED, for every job. It was the newest occurrence,
  // judged only once its own grace had passed, and that asked about one slot:
  // the newest. An hourly job's newest slot is never more than an hour old, so
  // it could never be ABSENT however long it had been dead; and a 6-hourly job
  // that missed 18:00 read green at 00:30, graded on the 00:00 slot half an hour
  // past due. Stepping back by the grace first grades the newest slot that is
  // OWED a row, so a late run inside its grace is still not an alarm.
  const cronList = Array.isArray(cronExpr) ? cronExpr : [cronExpr];
  // ⏱ 2026-10-03 · THE SLOT IS THE ONE THE RELEASE LIVE AT IT OWED (`owedSlot`).
  // Without a ledger timeline it is one entry, main's crons from -Infinity, which
  // is the rule below exactly as it stood.
  const fromLedger = Array.isArray(timeline) && timeline.length > 0;
  const owed = owedSlot(fromLedger ? timeline : [{ fromMs: -Infinity, crons: cronList, sha: null }], nowMs);
  // ⚠️ ANY unreadable expression is refused, not skipped: taking the max over
  // "the ones that parsed" would quietly judge a job against a subset of its own
  // schedule, which is the shape of every silent narrowing in this file.
  const dueMs = owed === null || owed.unreadable !== undefined ? null : owed.dueMs;
  // No release has owed a slot yet — only reachable from a ledger timeline (main's
  // own crons from -Infinity always owe one). The outcome limbs below still grade
  // the rows; the absence limb has nothing to grade.
  const notOwedYet = fromLedger && owed === null;
  if (dueMs === null && !notOwedYet) {
    return {
      ok: false,
      kind: 'unknown',
      ageHours,
      reason:
        `${job}: cron expression \`${fromLedger && owed?.unreadable !== undefined ? owed.unreadable : cronList.join('` `')}\` yields no computable occurrence, so "was the run that was due missed?" ` +
        'cannot be asked. Failing closed rather than falling back to a staleness guess.',
    };
  }
  const sinceDueHours = (nowMs - dueMs) / 3_600_000;
  // Which release owed the slot, when the ledger said. Printed so a red names the
  // schedule it was judged by, not only main's.
  const owedBy =
    fromLedger && owed?.sha
      ? `, owed by release ${owed.sha.slice(0, 12)}${Number.isFinite(owed.fromMs) ? ` live since ${new Date(owed.fromMs).toISOString()}` : ''}`
      : '';
  if (!notOwedYet && stamp < dueMs) {
    return {
      ok: false,
      kind: 'absent',
      ageHours,
      reason:
        `${job}: the run due at ${new Date(dueMs).toISOString()} (cron \`${fromLedger ? owed.cron : cronList.join('` `')}\`${owedBy}) left NO row. ` +
        `It is now ${sinceDueHours.toFixed(1)}h past due, beyond the ${MISSED_RUN_GRACE_HOURS}h grace, and the newest row is ` +
        `${new Date(stamp).toISOString()} (${ageHours.toFixed(1)}h old) — written BEFORE that occurrence. ` +
        'The timer did not fire, or the job can no longer write. ' +
        'A staleness ceiling of 1.5x the interval is green on exactly this, which is how the 2026-08-06 miss went unreported.',
    };
  }
  // ⚠️ Presence is NOT the assertion. The outcome column is.
  //
  // 🔴 AND IT IS ASKED PER TARGET, BECAUSE A FAN-OUT JOB IS SEVERAL DUTIES UNDER
  // ONE NAME. `recordHeartbeat` writes one row per target and stamps the whole
  // batch with a SINGLE `ran_at`, so a fan-out job's rows are not merely close
  // in time — they are IDENTICAL in time. Asking `newest.ok` then asked about
  // whichever row the reduce happened to keep, which for equal stamps is
  // whichever the query returned first: a FAILING TARGET COULD BE HIDDEN BY A
  // SUCCEEDING ONE, decided by SQLite's row order.
  //
  // Latent until 2026-09-03 — `supabase_keepalive` and `renewals` are fan-outs
  // with one target each, so no two rows ever shared a stamp. Adding
  // `ops-watch.yml` beside `renovate.yml` under `github_dispatch` made it live,
  // and the target it could hide was the workflow whose lateness froze this
  // repository twice.
  //
  // ⬜ THE RESIDUAL, STATED RATHER THAN LEFT TO BE FOUND: a target that stops
  // being written ENTIRELY is still invisible here. Its last row stays newest
  // FOR THAT TARGET and green, while the job's overall freshness is carried by
  // the targets that do still write. Closing that needs a DECLARED target set to
  // compare against — the register names jobs, not targets — and without one a
  // removed target would be permanently absent and permanently red.
  const newestPerTarget = new Map();
  for (const r of rows) {
    const key = r.target ?? '(none)';
    const prev = newestPerTarget.get(key);
    if (!prev || Date.parse(r.ran_at) > Date.parse(prev.ran_at)) newestPerTarget.set(key, r);
  }
  const failing = [...newestPerTarget.entries()].filter(([, r]) => Number(r.ok) !== 1);
  if (failing.length > 0) {
    return {
      ok: false,
      kind: 'red',
      ageHours,
      reason:
        `${job}: the newest heartbeat is FRESH and says the job FAILED — ` +
        `${failing.length} of ${newestPerTarget.size} target(s): ` +
        failing
          .map(([t, r]) => `target ${t}: ok=${r.ok}${r.detail ? `, detail: ${String(r.detail).slice(0, 200)}` : ''}`)
          .join(' · ') +
        '. A check that only asked "did a row land today" would be green on exactly this, and one that asked ' +
        'only about the newest ROW would be green whenever another target of the same job succeeded.',
    };
  }
  // ⏱ 2026-10-01 · O-NIGHTLY-CRON-INVOCATION-BUDGET-UNSUMMED — A RETENTION JOB
  // THAT KEEPS FALLING BEHIND IS RED. Every row above says ok=1, and that is true:
  // the sweep ran. What it cannot say in `ok` is that a store is still FULL when
  // its per-run budget runs out, night after night, so a declared period has
  // stopped being kept. `capped` comes from the register's `cappedNightsRed`
  // (see deriveWatchedJobs), and its `_cappedNightsRedWhy` states the slack.
  if (capped && typeof capped.token === 'string') {
    const stuck = cappedTargets(rows, capped.token, capped.nights);
    if (stuck.length > 0) {
      return {
        ok: false,
        kind: 'capped',
        ageHours,
        reason:
          `${job}: ${stuck.map((t) => `target ${t}`).join(', ')} carried \`${capped.token}=\` above 0 on each of its newest ` +
          `${capped.nights} runs. Every run SUCCEEDED (ok=1) and still left expired rows behind, so the declared retention ` +
          'period is no longer being kept. Clear the backlog (or raise the per-run budget with its arithmetic), then let a ' +
          `run print \`${capped.token}=0\`.`,
      };
    }
  }
  // The green line names the occurrence it covered, so a reader can check the
  // pass rather than take it. "fresh (28.1h old)" was literally true on the
  // morning of the miss and told nobody anything.
  if (notOwedYet) {
    return {
      ok: true,
      pending: true,
      kind: 'pending',
      ageHours,
      reason:
        `${job}: NOT YET OWED — no release in the deploy ledger has scheduled a slot of this job whose ` +
        `${MISSED_RUN_GRACE_HOURS}h grace has ended (main keeps \`${cronList.join('` `')}\`). Newest row ` +
        `${new Date(stamp).toISOString()} (${ageHours.toFixed(1)}h old), ok=1. The first slot a live release schedules owes a row.`,
    };
  }
  return {
    ok: true,
    ageHours,
    reason:
      `${job}: the run due ${new Date(dueMs).toISOString()}${fromLedger ? ` (cron \`${owed.cron}\`${owedBy})` : ''} is recorded — newest row ${new Date(stamp).toISOString()} ` +
      `(${ageHours.toFixed(1)}h old), ok=1`,
  };
}

// ── ⏱ 2026-09-28 · THE DECLARATION INSTANT IS MAIN'S, NOT A DRAFT'S ────────
// Ops watch 36416498456 went red on `reminder_mail`: "NO heartbeat row has ever
// been written … (2026-09-28T03:25:45Z -> 2026-09-28T06:00:00Z) ended its 2h
// grace". 03:25:45Z was a cloud drafter's SANDBOX commit, which never existed on
// main; the first MAIN commit carrying the name was the squash merge 74b5dfbf at
// 11:33:25Z. So the register owed a 06:00Z slot the job could not have run in,
// and nothing checked the instant against main — only that it was not future.
//
// THE RULE (`--declared-vs-main`, run by ci.yml's guards-platform on a full
// clone): the first slot owed after a job's declared instant may not be EARLIER
// than the first slot after the first commit on HEAD's first-parent (main) line
// whose register contains that job. Slots, not instants: a drafter cannot know
// the squash date, so a declared instant is right when it owes the same slot.
// A job the change under test introduces is bounded by max(that commit, now) —
// it cannot reach main before the run that is judging it.
//
// Pure. `crons` is the job's cron list; both instants are ms.
export function judgeDeclaredOnMain(job, crons, declaredAtMs, onMainMs) {
  const cronList = Array.isArray(crons) ? crons : [crons];
  const first = (from) => {
    const f = cronList.map((c) => firstFireAfterMs(c, from));
    return f.length && f.every((t) => t !== null) ? Math.min(...f) : null;
  };
  const owed = Number.isFinite(declaredAtMs) ? first(declaredAtMs) : null;
  const possible = Number.isFinite(onMainMs) ? first(onMainMs) : null;
  const iso = (ms) => new Date(ms).toISOString();
  if (owed === null || possible === null) {
    return { lost: `COVERAGE LOST — ${job}: no first slot could be computed (cron \`${cronList.join('` `')}\`, declared ${declaredAtMs}, on main ${onMainMs}), so its declared instant is judged against nothing.` };
  }
  if (owed < possible) {
    return {
      finding:
        `${job}: watchedJobsDeclaredAt is ${iso(declaredAtMs)}, which owes the slot ${iso(owed)} — but the job reached main ` +
        `no earlier than ${iso(onMainMs)}, whose first slot is ${iso(possible)}. An empty record would read ABSENT for a ` +
        'slot the job could not have run in. Set it to the committer date of the first MAIN commit whose register ' +
        `contains "${job}" (the _watchedJobsDeclaredAtWhy command), never a draft's sandbox date.`,
    };
  }
  return { ok: `${job}: declared ${iso(declaredAtMs)} owes ${iso(owed)}, no earlier than main's first slot ${iso(possible)}` };
}

/** IO for `judgeDeclaredOnMain`. `git(args)` returns a spawnSync result. A
 *  shallow clone cannot answer "first commit on main", so it is COVERAGE LOST. */
export function firstOnMainMs(job, git, nowMs) {
  const shallow = git(['rev-parse', '--is-shallow-repository']);
  if (shallow.status !== 0) return { lost: `COVERAGE LOST — git could not say whether this clone is shallow (${String(shallow.stderr ?? '').trim()}).` };
  if (shallow.stdout.trim() !== 'false') return { lost: 'COVERAGE LOST — this clone is SHALLOW, so the first main commit carrying a job cannot be found; check out with fetch-depth: 0.' };
  const head = git(['rev-parse', 'HEAD']);
  const log = git(['log', '--first-parent', '--format=%H %ct', `-S"${job}"`, 'HEAD', '--', REGISTER_REL]);
  if (head.status !== 0 || log.status !== 0) return { lost: `COVERAGE LOST — git log failed for "${job}" (${String(log.stderr ?? head.stderr ?? '').trim()}).` };
  const lines = log.stdout.trim().split('\n').filter(Boolean);
  if (!lines.length) return { lost: `COVERAGE LOST — no commit on HEAD's first-parent line adds "${job}" to ${REGISTER_REL}, yet the register names it.` };
  const [sha, ct] = lines[lines.length - 1].split(' ');
  const ms = Number(ct) * 1000;
  if (!Number.isFinite(ms)) return { lost: `COVERAGE LOST — git printed no committer date for "${job}": ${lines[lines.length - 1]}` };
  return sha === head.stdout.trim() ? { ms: Math.max(ms, nowMs), sha, introducedHere: true } : { ms, sha, introducedHere: false };
}

/** The watched set, DERIVED from the register + the wrangler config it anchors,
 *  never from a list in this file. Returns { jobs, problems }. */
export function deriveWatchedJobs(root) {
  const problems = [];
  const jobs = [];
  const regPath = join(root, REGISTER_REL);
  if (!existsSync(regPath)) {
    problems.push(`COVERAGE LOST — ${REGISTER_REL} does not exist, so there is no declared set of jobs to watch and this reader would watch nothing while exiting 0.`);
    return { jobs, problems };
  }
  let reg;
  try {
    reg = JSON.parse(readFileSync(regPath, 'utf8'));
  } catch (e) {
    problems.push(`COVERAGE LOST — ${REGISTER_REL} could not be parsed (${e.message}).`);
    return { jobs, problems };
  }
  const cronRows = (reg.rows ?? []).filter((r) => r.kind === 'duty' && r?.mechanism?.substrate === 'cloudflare-cron');
  if (cronRows.length === 0) {
    problems.push('COVERAGE LOST — the operations register declares no `cloudflare-cron` duty. The watched set would be empty and every check below vacuously green.');
    return { jobs, problems };
  }
  for (const row of cronRows) {
    const cfgRel = row.mechanism.anchor;
    const cfgPath = join(root, cfgRel);
    if (!existsSync(cfgPath)) {
      problems.push(`COVERAGE LOST — ${row.id} anchors at ${cfgRel}, which does not exist.`);
      continue;
    }
    let cfg;
    try {
      cfg = parseJsonc(readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      problems.push(`COVERAGE LOST — ${cfgRel} could not be parsed (${e.message}).`);
      continue;
    }
    const crons = cfg?.triggers?.crons ?? [];
    if (!crons.length) {
      problems.push(`COVERAGE LOST — ${cfgRel} declares no \`triggers.crons\`, but ${row.id} says it is a cron duty. The register and the config disagree about whether the job exists at all.`);
      continue;
    }
    // 🔴 EVERY DECLARED CRON IS PARSED, NOT JUST THE FIRST. Until 2026-09-03
    // this read `crons[0]` and silently ignored the rest, and the increment
    // before this one turned that into COVERAGE LOST — "teach the register which
    // cron governs which job before adding a second". This is that: `watchedJobs`
    // is a MAP from job to the crons it keeps, so a second schedule is now
    // expressible instead of merely refused. The refusal was the right shape for
    // one increment and is retired by the thing it was holding the door for.
    // BOTH parsers must accept the expression, and they are checked against each
    // other here rather than trusted to stay in step. They are separate functions
    // over the same narrow grammar, so the failure that matters is one of them
    // being widened alone: the reader would then compute an occurrence for a
    // schedule the other had already refused, and nothing would say so.
    const unreadable = crons.filter((c) => cronIntervalHours(c) === null || lastExpectedFireMs(c, Date.now()) === null);
    const intervalHours = unreadable.length ? null : cronIntervalHours(crons[0]);
    const probeDue = unreadable.length ? null : lastExpectedFireMs(crons[0], Date.now());
    if (intervalHours === null || probeDue === null) {
      problems.push(
        `${row.id}: cron expression \`${(unreadable[0] ?? crons[0])}\` is not one this reader can read ` +
          `(interval=${intervalHours === null ? 'refused' : intervalHours + 'h'}, ` +
          `occurrence=${probeDue === null ? 'refused' : 'computable'}), so "was the run that was due missed?" ` +
          'cannot be asked — failing closed rather than guessing.',
      );
      continue;
    }
    // 🔴 A MAP FROM JOB TO THE CRONS IT KEEPS, not a bare list of names. A list
    // could only ever mean "every job runs on crons[0]", which was true by
    // accident while the Worker had one schedule and became a lie the moment it
    // had two. The map makes the pairing a fact somebody wrote down.
    const watched = row.watchedJobs;
    if (!watched || typeof watched !== 'object' || Array.isArray(watched) || Object.keys(watched).length === 0) {
      problems.push(
        `COVERAGE LOST — ${row.id}.watchedJobs must be a non-empty MAP of job -> [cron, ...]` +
          `${Array.isArray(watched) ? ' (it is still an ARRAY: a list of names cannot say which schedule each job keeps)' : ''}. ` +
          'This reader would otherwise query nothing and exit 0.',
      );
      continue;
    }
    // BOTH DIRECTIONS. A job naming a cron the config does not declare is judged
    // against a schedule that does not exist; a declared cron no job names is a
    // schedule that fires with nothing watching what it did. The second is the
    // one that stays silent, so it is checked rather than assumed.
    const claimed = new Set();
    let mapBroken = false;
    for (const [job, jobCrons] of Object.entries(watched)) {
      if (!Array.isArray(jobCrons) || jobCrons.length === 0) {
        problems.push(`COVERAGE LOST — ${row.id}.watchedJobs["${job}"] names no cron, so nothing says when that job is due.`);
        mapBroken = true;
        continue;
      }
      for (const c of jobCrons) {
        if (!crons.includes(c)) {
          problems.push(
            `${row.id}.watchedJobs["${job}"] names cron \`${c}\`, which ${cfgRel} does not declare ` +
              `(it has ${crons.map((x) => `\`${x}\``).join(', ')}). The job would be judged against a schedule that does not exist.`,
          );
          mapBroken = true;
        } else {
          claimed.add(c);
        }
      }
    }
    for (const c of crons) {
      if (!claimed.has(c)) {
        problems.push(
          `COVERAGE LOST — ${cfgRel} declares cron \`${c}\` and no job in ${row.id}.watchedJobs keeps it. ` +
            'That schedule fires and NOTHING watches what it did — the quiet half of this check, which is why it is asked ' +
            'in both directions rather than only "does every job have a cron".',
        );
        mapBroken = true;
      }
    }
    if (mapBroken) continue;
    // ⬜ THE DECLARATION INSTANT, PER JOB (2026-09-11). A job with NO row at all is
    // either NOT YET DUE or ABSENT, and the only fact that separates them is when
    // the register began watching it. Required, an ISO instant, never in the
    // FUTURE: a date parked ahead would keep an empty record "not yet due" for as
    // long as somebody keeps moving it, which is a waiver (INV5).
    const declaredAt = row.watchedJobsDeclaredAt;
    if (!declaredAt || typeof declaredAt !== 'object' || Array.isArray(declaredAt)) {
      problems.push(
        `COVERAGE LOST — ${row.id}.watchedJobsDeclaredAt must be a MAP of job -> the ISO instant the register began ` +
          'watching it. Without it a job with no row at all cannot be told apart: "not yet due" and "never ran" are the ' +
          'same zero rows, and this reader would have to call one of them the other.',
      );
      continue;
    }
    const declaredAtMs = new Map();
    let declBroken = false;
    for (const job of Object.keys(watched)) {
      const at = declaredAt[job];
      const ms = typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? Date.parse(at) : NaN;
      if (Number.isNaN(ms)) {
        problems.push(`COVERAGE LOST — ${row.id}.watchedJobsDeclaredAt["${job}"] is ${JSON.stringify(at ?? null)}, not an ISO instant, so an empty record for "${job}" has no declaration to measure its first slot from.`);
        declBroken = true;
      } else if (ms > Date.now()) {
        problems.push(`COVERAGE LOST — ${row.id}.watchedJobsDeclaredAt["${job}"] is ${at}, in the FUTURE. That is the one way this field becomes a waiver: an empty record would stay "not yet due" for as long as the date is kept ahead (INV5).`);
        declBroken = true;
      } else {
        declaredAtMs.set(job, ms);
      }
    }
    for (const job of Object.keys(declaredAt)) {
      if (!Object.prototype.hasOwnProperty.call(watched, job)) {
        problems.push(`${row.id}.watchedJobsDeclaredAt names job "${job}", which ${row.id}.watchedJobs does not watch — a declaration instant for nothing reads as coverage that does not exist.`);
        declBroken = true;
      }
    }
    if (declBroken) continue;
    // The self-check: the job name must exist in the Worker's own source.
    const srcDir = join(root, dirname(cfgRel), 'src');
    const src = existsSync(srcDir) ? readSourceTree(srcDir) : '';
    const dbId = (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id ?? null;
    if (!dbId) {
      problems.push(`COVERAGE LOST — ${cfgRel} has no D1 binding carrying \`migrations_dir\`, so the database that owns the heartbeat table cannot be resolved.`);
      continue;
    }
    // ⏱ 2026-10-01 · THE CAPPED-NIGHTS RULE (`cappedNightsRed`). Optional per row,
    // but never half-read: a token job the row does not watch, or a token the
    // Worker's source never writes, would be a rule that can never fire.
    const cappedRule = new Map();
    const rule = row.cappedNightsRed;
    if (rule !== undefined) {
      const nights = rule?.nights;
      const tokens = rule?.tokens;
      // ≤ 20: queryD1 reads a job's newest 20 rows, so a longer streak could not be seen.
      if (!Number.isInteger(nights) || nights < 1 || nights > 20 || !tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
        problems.push(`COVERAGE LOST — ${row.id}.cappedNightsRed must be { nights: 1..20, tokens: { job: token } }; it is ${JSON.stringify(rule)}.`);
        continue;
      }
      let ruleBroken = false;
      for (const [job, token] of Object.entries(tokens)) {
        if (!Object.prototype.hasOwnProperty.call(watched, job)) {
          problems.push(`COVERAGE LOST — ${row.id}.cappedNightsRed names job "${job}", which ${row.id}.watchedJobs does not watch: a rule over rows nobody reads.`);
          ruleBroken = true;
        } else if (typeof token !== 'string' || !/^\w+$/.test(token) || !src.includes(`${token}=`)) {
          problems.push(`COVERAGE LOST — ${row.id}.cappedNightsRed reads token \`${token}=\` for "${job}", and ${dirname(cfgRel)}/src never writes it: the rule could never fire.`);
          ruleBroken = true;
        } else {
          cappedRule.set(job, { token, nights });
        }
      }
      if (ruleBroken) continue;
    }
    for (const [job, jobCrons] of Object.entries(watched)) {
      if (!src.includes(`'${job}'`) && !src.includes(`"${job}"`)) {
        problems.push(
          `COVERAGE LOST — ${row.id} watches job \`${job}\`, and that literal appears NOWHERE in ${dirname(cfgRel)}/src. ` +
            'The reader would query a name nothing writes, which reads as "absent" forever — or, worse, as green if the absence limb were ever softened.',
        );
        continue;
      }
      // `worker` is the deploy ledger's environment for this Worker: deploy-workers.yml
      // records each deploy as `record-deployment.mjs <wrangler name> <origin>`.
      jobs.push({ id: row.id, job, databaseId: dbId, cron: jobCrons, declaredAtMs: declaredAtMs.get(job), capped: cappedRule.get(job) ?? null, worker: typeof cfg.name === 'string' ? cfg.name : null });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // [pipeline B-11] THE OTHER DIRECTION, AND IT IS THE ONE THAT WAS MISSING.
    //
    // The loop above asks "does every WATCHED job exist in the source?" — which
    // can only catch a stale register entry. It cannot catch the opposite and
    // far more likely drift: a job the scheduler RUNS that the register never
    // learned about. That is not hypothetical. `analytics_liveness` shipped in
    // stage 11, ran nightly, wrote rows to `cron_heartbeat` — and `watchedJobs`
    // named only `supabase_keepalive`, so nothing on earth was reading its
    // results. The register was "complete" by the only test anyone had.
    //
    // The job set is DERIVED from the declarations rather than kept by hand:
    // every `export const <NAME>_JOB = '<literal>'` in the Worker's source is a
    // job, by the convention scheduled.ts documents. Adding a job therefore
    // fails this check until the register watches it.
    //
    // ⚠️ AND THE DECLARATION MUST BE USED. A constant that is exported and never
    // passed to `recordHeartbeat` writes no rows, so watching it would produce a
    // permanently "absent" job and a red that no code change can clear. This
    // repo has been burned by exactly one symbol matching only its own
    // declaration (`_registerInWorkspace`, six times), so the call-site test
    // strips the declaration line before looking for a usage.
    // ─────────────────────────────────────────────────────────────────────────
    const declared = [...src.matchAll(/export\s+const\s+(\w*_JOB)\s*=\s*['"]([^'"]+)['"]/g)].map(
      (m) => ({ constName: m[1], job: m[2] }),
    );
    if (declared.length === 0) {
      problems.push(
        `COVERAGE LOST — no \`export const <NAME>_JOB = '…'\` declaration was found anywhere in ${dirname(cfgRel)}/src, ` +
          'so the derived job set is EMPTY and the completeness check below compares the register against nothing. ' +
          'Either the naming convention scheduled.ts documents was abandoned, or the source moved.',
      );
      continue;
    }
    // Strip each declaration so a "usage" cannot be the declaration itself.
    const usageSrc = src.replace(/export\s+const\s+\w*_JOB\s*=\s*['"][^'"]+['"]/g, '');
    for (const { constName, job } of declared) {
      if (!new RegExp(`\\b${constName}\\b`).test(usageSrc)) {
        problems.push(
          `${row.id}: \`${constName}\` (job "${job}") is declared in ${dirname(cfgRel)}/src and NEVER USED — it appears nowhere ` +
            'but its own declaration, so no heartbeat row can ever carry that job name. A watched job that nothing writes is ' +
            'permanently absent; an unwatched job that nothing writes is dead code. Wire it to `recordHeartbeat` or delete it.',
        );
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(watched, job)) {
        problems.push(
          `COVERAGE LOST — the scheduler declares and uses job "${job}" (\`${constName}\`), and ${row.id}.watchedJobs does NOT name it. ` +
            'It runs every night and NOTHING reads its outcome. This is the direction that stayed silent while `analytics_liveness` ' +
            `went unwatched from the day it shipped. Add "${job}": ["<cron>"] to watchedJobs in ${REGISTER_REL}.`,
        );
      }
    }
  }
  return { jobs, problems };
}

function readSourceTree(dir) {
  let out = '';
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out += readSourceTree(p);
    else if (/\.(ts|js|mjs)$/.test(e.name)) out += readFileSync(p, 'utf8');
  }
  return out;
}

/**
 * Read the newest `cron_heartbeat` rows for one job, optionally narrowed to ONE
 * target.
 *
 * 🔴 EXPORTED 2026-09-06 SO A SECOND READER CAN IMPORT IT RATHER THAN COPY IT.
 * `tooling/ci/assert-e2e-proof-fresh.mjs` now grades the nightly proof on this
 * same table, and a second hand-written copy of this query is the shape this
 * corpus keeps paying for: two transports drift, and the one that drifts is
 * always the one nobody is looking at. There is ONE reader of `cron_heartbeat`
 * over HTTP in this tree and this is it.
 *
 * ⚠️ `target` IS NOT A TIDYING PARAMETER — IT IS THE NARROWING THAT MAKES A
 * PER-WORKFLOW VERDICT POSSIBLE. One job writes MANY targets: measured live
 * 2026-09-06, job `github_dispatch` wrote `(dispatcher)` and
 * `Nikatru_Platform_Public/ops-watch.yml` on all four daily firings and
 * `Nikatru_Platform_Public/e2e.yml` on ONE of them (that target carries
 * `everyHours: 20`). So the newest row for the JOB is an ops-watch row on three
 * firings out of four, and a caller grading e2e's timer on it would be reading a
 * healthy unrelated dispatch as proof that e2e was dispatched.
 * `assert-ops-register.mjs` refuses a `recordQuery.timer` narrowed by neither
 * `job` nor `target` for exactly this reason; this parameter is how a caller
 * obeys it.
 *
 * Omitting `target` keeps the original behaviour byte for byte — the job-wide
 * read `main()` below has always done — so this export widens nothing.
 */
export async function queryD1(databaseId, job, target = null) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment — cannot read the heartbeat table, so this fails closed');
  }
  const narrowed = typeof target === 'string' && target.length > 0;
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`;
  const what = narrowed ? `job ${job} target ${target}` : `job ${job}`;
  // ⏱ 2026-09-21 — attempted up to READ_ATTEMPTS times on the shared bounded plan
  // (tooling/ops/bounded-retry.mjs). Un-retried until today, so one dropped TCP
  // connection made a healthy duty read as COVERAGE LOST and reddened ops-watch,
  // which reddens ci-gate on main — row O-PAGES-FETCH-TRANSIENT-NOT-RETRIED, sweep
  // clause. Nothing about the exit code moves: a duty whose read outlives the plan
  // is still `unreadable` below, still exit 2, and still NOT "not reporting healthy".
  //
  // 🔴 A POST THAT IS A READ. The D1 HTTP API takes SELECTs by POST; re-sending one
  // changes nothing, and the decision is recorded here rather than guessed by verb.
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          sql: narrowed
            ? 'SELECT job, target, ok, detail, ran_at FROM cron_heartbeat WHERE job = ? AND target = ? ORDER BY ran_at DESC LIMIT 20'
            : 'SELECT job, target, ok, detail, ran_at FROM cron_heartbeat WHERE job = ? ORDER BY ran_at DESC LIMIT 20',
          params: narrowed ? [job, target] : [job],
        }),
      });
    } catch (e) {
      throw classifyThrown(e, `the D1 API did not answer for ${what} (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (!res.ok) {
      const line = `the D1 API returned ${res.status} for ${what}`;
      throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw classifyThrown(e, `the D1 API response for ${what} was not JSON (${e.message})`);
    }
    if (body?.success !== true) throw new CouldNotLook(`the D1 API reported failure for ${what}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
    const rows = body?.result?.[0]?.results;
    if (!Array.isArray(rows)) throw new CouldNotLook(`the D1 API response for ${what} carried no results array`);
    return rows;
  });
}

/**
 * ⏱ 2026-10-03 · The deploy ledger for one Worker: `[{ sha, liveFromMs }]`, from
 * the GitHub Deployments deploy-workers.yml writes after each successful deploy
 * (tooling/ci/record-deployment.mjs). check-worker-versions.mjs asserts in the
 * same ops-watch run that the newest record is what the Worker serves. 100 rows
 * reach back well past SCHEDULE_LOOKBACK_MS at this repo's deploy rate. Throws
 * CouldNotLook; the caller then judges by main's schedule.
 */
export async function readDeployLedger(environment, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
  if (!repo || !token) throw new CouldNotLook(`no ${!repo ? 'GITHUB_REPOSITORY' : 'GITHUB_TOKEN / GH_TOKEN'} in the environment`);
  const url = `https://api.github.com/repos/${repo}/deployments?environment=${encodeURIComponent(environment)}&per_page=100`;
  return readWithBoundedRetry(async (_attempt, { signal }) => {
    let res;
    try {
      res = await fetchImpl(url, {
        signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'nikatru-check-heartbeats', Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      throw classifyThrown(e, `the ${environment} deploy ledger did not answer (${e?.name ?? 'error'}: ${e?.message ?? e})`);
    }
    if (!res.ok) {
      const line = `the ${environment} deploy ledger answered HTTP ${res.status}`;
      throw isTransientStatus(res.status) ? transientLook(line, { retryAfterMs: retryAfterMs(res) }) : new CouldNotLook(line);
    }
    let body;
    try {
      body = await res.json();
    } catch (e) {
      throw classifyThrown(e, `the ${environment} deploy ledger answer was not JSON (${e.message})`);
    }
    if (!Array.isArray(body)) throw new CouldNotLook(`the ${environment} deploy ledger answer is not a list`);
    return body
      .filter((d) => d && d.environment === environment && /^[0-9a-f]{40}$/.test(String(d.sha)))
      .map((d) => ({ sha: d.sha, liveFromMs: Date.parse(d.created_at) }));
  });
}

/** `git show <sha>:tooling/ops/register.json`, parsed, or null (a shallow clone,
 *  an unknown commit, a file that does not parse). Pure of the network. */
export function gitRegisterAt(root) {
  const cache = new Map();
  return (sha) => {
    if (!/^[0-9a-f]{40}$/.test(String(sha))) return null;
    if (!cache.has(sha)) {
      const r = spawnSync('git', ['-C', root, 'show', `${sha}:${REGISTER_REL}`], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
      let reg = null;
      if (r.status === 0) {
        try {
          reg = JSON.parse(r.stdout);
        } catch {
          reg = null;
        }
      }
      cache.set(sha, reg);
    }
    return cache.get(sha);
  };
}

// ⚠️ `process.exitCode` and return, NEVER `process.exit()`: exiting while a fetch
// handle is still closing aborts Node on Windows with 127 for every outcome
// (tooling/ci/assert-gate-passed.mjs records the measurement).
async function main() {
  const { jobs, problems } = deriveWatchedJobs(ROOT);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    // A watched set that could not be DERIVED is COVERAGE LOST (2); a register that
    // derives and is wrong is a finding (1). 2 beats 1.
    process.exitCode = problems.some((p) => p.startsWith('COVERAGE LOST')) ? 2 : 1;
    return;
  }

  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`✗ COVERAGE LOST — --now is not a parseable date: ${nowFlag}`);
    process.exitCode = 2;
    return;
  }

  // OFFLINE: git history only, no D1. See `judgeDeclaredOnMain`.
  if (process.argv.includes('--declared-vs-main')) {
    const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    const lost = [];
    const findings = [];
    for (const j of jobs) {
      const on = firstOnMainMs(j.job, git, nowMs);
      const v = on.lost ? on : judgeDeclaredOnMain(j.job, j.cron, j.declaredAtMs, on.ms);
      if (v.lost) lost.push(v.lost);
      else if (v.finding) findings.push(v.finding);
      else console.log(`ok  ${v.ok} (${on.sha.slice(0, 8)}${on.introducedHere ? ', introduced by the change under test' : ''})`);
    }
    for (const l of lost) console.error(`✗ ${l}`);
    for (const f of findings) console.error(`✗ ${f}`);
    if (lost.length) process.exitCode = 2;
    else if (findings.length) process.exitCode = 1;
    else console.log(`ok  ${jobs.length} watched-since instant(s) owe no slot before their job reached main [O-4]`);
    return;
  }

  const rowsFile = flag('--rows-file');
  let fixture = null;
  if (rowsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --rows-file is set. This must NEVER appear in a real ops-watch log.');
    try {
      fixture = JSON.parse(readFileSync(rowsFile, 'utf8'));
    } catch (e) {
      console.error(`✗ COVERAGE LOST — could not read fixture ${rowsFile}: ${e.message}`);
      process.exitCode = 2;
      return;
    }
  }

  // ⏱ 2026-10-03 · THE SCHEDULE EACH RELEASE RAN (`owedSlot`). The ledger is read
  // once per Worker; offline it comes from --releases-file, and with --rows-file
  // alone it is not read at all, so every fixture is judged by main's schedule.
  // Every way of not reading it ends in main's schedule — the stricter reading —
  // and prints a ⚠ line; none of them is COVERAGE LOST, since nothing is skipped.
  const releasesFile = flag('--releases-file');
  const ledger = new Map();
  const ledgerNotes = [];
  let registerAt = gitRegisterAt(ROOT);
  if (releasesFile) {
    console.log('!!  OFFLINE LEDGER — --releases-file is set. This must NEVER appear in a real ops-watch log.');
    let rf;
    try {
      rf = JSON.parse(readFileSync(releasesFile, 'utf8'));
    } catch (e) {
      console.error(`✗ COVERAGE LOST — could not read releases fixture ${releasesFile}: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    for (const [worker, list] of Object.entries(rf?.ledger ?? {})) {
      ledger.set(worker, (Array.isArray(list) ? list : []).map((d) => ({ sha: d?.sha, liveFromMs: Date.parse(d?.created_at) })));
    }
    const fromGit = registerAt;
    registerAt = (sha) => (rf?.registers && Object.prototype.hasOwnProperty.call(rf.registers, sha) ? rf.registers[sha] : fromGit(sha));
  } else if (!fixture) {
    for (const worker of new Set(jobs.map((j) => j.worker).filter(Boolean))) {
      try {
        ledger.set(worker, await readDeployLedger(worker));
      } catch (e) {
        ledgerNotes.push(`the ${worker} deploy ledger could not be read (${e.message}), so every slot is judged by main's schedule.`);
      }
    }
  }
  for (const [worker, list] of ledger) {
    const live = list.filter((r) => Number.isFinite(r.liveFromMs) && r.liveFromMs <= nowMs).sort((a, b) => b.liveFromMs - a.liveFromMs);
    console.log(
      `⬜  ${worker}: each slot judged by the schedule of the release live when it fell due — ${list.length} ledger row(s)` +
        (live.length ? `, newest ${live[0].sha.slice(0, 12)} live since ${new Date(live[0].liveFromMs).toISOString()}` : ''),
    );
  }

  const failures = [];
  const unreadable = [];
  const pending = [];
  const okLines = [];
  for (const j of jobs) {
    let rows;
    try {
      rows = fixture ? (fixture[j.job] ?? []) : await queryD1(j.databaseId, j.job);
    } catch (e) {
      // 🔴 A READ FAILURE IS NOT A DUTY FAILURE (INV6). Until 2026-09-11 this line
      // was `failures.push(...)`, so a 401, a 5xx or a missing token printed as
      // "scheduled duty is not reporting healthy" and exited 1.
      unreadable.push(`${j.job}: ${e.message}`);
      continue;
    }
    // Only releases already live at `now` (a --now in the past must not see later ones).
    const releases = (ledger.get(j.worker) ?? []).filter((r) => Number.isFinite(r.liveFromMs) && r.liveFromMs <= nowMs);
    const { timeline, notes } = jobTimeline(j.id, j.job, j.cron, releases, registerAt, nowMs);
    ledgerNotes.push(...notes);
    const verdict = evaluateJob(j.job, rows, j.cron, nowMs, j.declaredAtMs, j.capped, timeline);
    if (verdict.pending) pending.push(verdict.reason);
    else if (verdict.ok) okLines.push(verdict.reason);
    else failures.push(verdict.reason);
  }

  console.log(`⬜  watching ${jobs.length} cron job(s) derived from ${REGISTER_REL}: ${jobs.map((j) => `${j.job} (${j.cron})`).join(', ')}`);
  for (const l of okLines) console.log(`ok  ${l}`);
  for (const l of pending) console.log(`⬜  ${l}`);
  // One line per release, not per job: every job of a Worker reads the same registers.
  for (const l of new Set(ledgerNotes)) console.log(`⚠   ${l}`);

  if (unreadable.length) {
    console.error(
      `✗ COVERAGE LOST — ${unreadable.length} scheduled duty(ies) could not be READ, so NOTHING was judged about them. ` +
        'This is not "not reporting healthy", and it is not healthy either:',
    );
    for (const u of unreadable) console.error(`    ${u}`);
  }
  if (failures.length) {
    console.error(`✗ ${failures.length} scheduled duty is not reporting healthy:`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    console.error('    This reader runs on GitHub Actions ON PURPOSE — a different provider from the cron it');
    console.error('    watches, so it survives the outage it is meant to report. [pipeline O-4]');
  }
  if (unreadable.length) {
    process.exitCode = 2;
    return;
  }
  if (failures.length) {
    process.exitCode = 1;
    return;
  }

  console.log(`ok  every declared cron duty is fresh and reporting success${pending.length ? `, ${pending.length} NOT YET DUE (printed above)` : ''} [pipeline O-4]`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
