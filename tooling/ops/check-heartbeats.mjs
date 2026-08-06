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
//   1. ABSENT   — the job's most recent SCHEDULED OCCURRENCE left no row, and
//                 the grace on that occurrence has expired. Anchored on when the
//                 run was DUE, not on how old the newest row is.
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
//   3. UNKNOWN  — no token, a non-200, unparseable JSON, an unrecognised cron
//                 expression. ALL FAIL CLOSED. "I could not tell" must never
//                 read as "it is fine"; that is precisely how the original claim
//                 became unfalsifiable.
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
// Usage:  node tooling/ops/check-heartbeats.mjs [--root <repoRoot>]
// Env:    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * the two shapes this repo actually uses and returns null for everything else,
 * which the caller treats as UNKNOWN and therefore RED. A generous parser that
 * guessed would be a silent source of a wrong window, and a wrong window is a
 * staleness check that cannot fire.
 */
export function cronIntervalHours(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const literal = (v) => /^\d+$/.test(v);
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
 * The decision, kept pure. `rows` are the newest-first heartbeat rows for ONE
 * job; `cronExpr` is that job's declared cron expression.
 *
 * ⚠️ It takes the EXPRESSION, not a precomputed interval, and that is the whole
 * repair: an interval can only answer "how old is the newest row", which is a
 * different question from "did the run that was due actually run". See
 * MISSED_RUN_GRACE_HOURS for the real event that separated them.
 */
export function evaluateJob(job, rows, cronExpr, nowMs) {
  if (!Array.isArray(rows)) {
    return { ok: false, kind: 'unknown', reason: `${job}: the query result was not an array — an unreadable answer is a failure, not a pass` };
  }
  if (rows.length === 0) {
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
  const dueMs = lastExpectedFireMs(cronExpr, nowMs);
  if (dueMs === null) {
    return {
      ok: false,
      kind: 'unknown',
      ageHours,
      reason:
        `${job}: cron expression \`${cronExpr}\` yields no computable occurrence, so "was the run that was due missed?" ` +
        'cannot be asked. Failing closed rather than falling back to a staleness guess.',
    };
  }
  const sinceDueHours = (nowMs - dueMs) / 3_600_000;
  if (sinceDueHours > MISSED_RUN_GRACE_HOURS && stamp < dueMs) {
    return {
      ok: false,
      kind: 'absent',
      ageHours,
      reason:
        `${job}: the run due at ${new Date(dueMs).toISOString()} (cron \`${cronExpr}\`) left NO row. ` +
        `It is now ${sinceDueHours.toFixed(1)}h past due, beyond the ${MISSED_RUN_GRACE_HOURS}h grace, and the newest row is ` +
        `${new Date(stamp).toISOString()} (${ageHours.toFixed(1)}h old) — written BEFORE that occurrence. ` +
        'The timer did not fire, or the job can no longer write. ' +
        'A staleness ceiling of 1.5x the interval is green on exactly this, which is how the 2026-08-06 miss went unreported.',
    };
  }
  // ⚠️ Presence is NOT the assertion. The outcome column is.
  if (Number(newest.ok) !== 1) {
    return {
      ok: false,
      kind: 'red',
      ageHours,
      reason:
        `${job}: the newest heartbeat is FRESH and says the job FAILED — ok=${newest.ok}` +
        (newest.detail ? `, detail: ${String(newest.detail).slice(0, 200)}` : '') +
        `${newest.target ? ` (target ${newest.target})` : ''}. ` +
        'A check that only asked "did a row land today" would be green on exactly this.',
    };
  }
  // The green line names the occurrence it covered, so a reader can check the
  // pass rather than take it. "fresh (28.1h old)" was literally true on the
  // morning of the miss and told nobody anything.
  return {
    ok: true,
    ageHours,
    reason:
      `${job}: the run due ${new Date(dueMs).toISOString()} is recorded — newest row ${new Date(stamp).toISOString()} ` +
      `(${ageHours.toFixed(1)}h old), ok=1`,
  };
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
    // BOTH parsers must accept the expression, and they are checked against each
    // other here rather than trusted to stay in step. They are separate functions
    // over the same narrow grammar, so the failure that matters is one of them
    // being widened alone: the reader would then compute an occurrence for a
    // schedule the other had already refused, and nothing would say so.
    const intervalHours = cronIntervalHours(crons[0]);
    const probeDue = lastExpectedFireMs(crons[0], Date.now());
    if (intervalHours === null || probeDue === null) {
      problems.push(
        `${row.id}: cron expression \`${crons[0]}\` is not one this reader can read ` +
          `(interval=${intervalHours === null ? 'refused' : intervalHours + 'h'}, ` +
          `occurrence=${probeDue === null ? 'refused' : 'computable'}), so "was the run that was due missed?" ` +
          'cannot be asked — failing closed rather than guessing.',
      );
      continue;
    }
    const watched = row.watchedJobs;
    if (!Array.isArray(watched) || watched.length === 0) {
      problems.push(`COVERAGE LOST — ${row.id} declares no \`watchedJobs\`, so this reader would query nothing and exit 0.`);
      continue;
    }
    // The self-check: the job name must exist in the Worker's own source.
    const srcDir = join(root, dirname(cfgRel), 'src');
    const src = existsSync(srcDir) ? readSourceTree(srcDir) : '';
    const dbId = (cfg.d1_databases ?? []).find((d) => d.migrations_dir)?.database_id ?? null;
    if (!dbId) {
      problems.push(`COVERAGE LOST — ${cfgRel} has no D1 binding carrying \`migrations_dir\`, so the database that owns the heartbeat table cannot be resolved.`);
      continue;
    }
    for (const job of watched) {
      if (!src.includes(`'${job}'`) && !src.includes(`"${job}"`)) {
        problems.push(
          `COVERAGE LOST — ${row.id} watches job \`${job}\`, and that literal appears NOWHERE in ${dirname(cfgRel)}/src. ` +
            'The reader would query a name nothing writes, which reads as "absent" forever — or, worse, as green if the absence limb were ever softened.',
        );
        continue;
      }
      jobs.push({ id: row.id, job, databaseId: dbId, cron: crons[0] });
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
      if (!watched.includes(job)) {
        problems.push(
          `COVERAGE LOST — the scheduler declares and uses job "${job}" (\`${constName}\`), and ${row.id}.watchedJobs does NOT name it. ` +
            'It runs every night and NOTHING reads its outcome. This is the direction that stayed silent while `analytics_liveness` ' +
            `went unwatched from the day it shipped. Add "${job}" to watchedJobs in ${REGISTER_REL}.`,
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

async function queryD1(databaseId, job) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) {
    throw new Error('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID are not both in the environment — cannot read the heartbeat table, so this fails closed');
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      sql: 'SELECT job, target, ok, detail, ran_at FROM cron_heartbeat WHERE job = ? ORDER BY ran_at DESC LIMIT 20',
      params: [job],
    }),
  });
  if (!res.ok) throw new Error(`the D1 API returned ${res.status} for job ${job}`);
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`the D1 API response for job ${job} was not JSON (${e.message})`);
  }
  if (body?.success !== true) throw new Error(`the D1 API reported failure for job ${job}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);
  const rows = body?.result?.[0]?.results;
  if (!Array.isArray(rows)) throw new Error(`the D1 API response for job ${job} carried no results array`);
  return rows;
}

async function main() {
  const { jobs, problems } = deriveWatchedJobs(ROOT);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }

  const nowFlag = flag('--now');
  const nowMs = nowFlag ? Date.parse(nowFlag) : Date.now();
  if (Number.isNaN(nowMs)) {
    console.error(`✗ --now is not a parseable date: ${nowFlag}`);
    process.exit(1);
  }

  const rowsFile = flag('--rows-file');
  let fixture = null;
  if (rowsFile) {
    console.log('!!  OFFLINE FIXTURE MODE — --rows-file is set. This must NEVER appear in a real ops-watch log.');
    try {
      fixture = JSON.parse(readFileSync(rowsFile, 'utf8'));
    } catch (e) {
      console.error(`✗ could not read fixture ${rowsFile}: ${e.message}`);
      process.exit(1);
    }
  }

  const failures = [];
  const okLines = [];
  for (const j of jobs) {
    let rows;
    try {
      rows = fixture ? (fixture[j.job] ?? []) : await queryD1(j.databaseId, j.job);
    } catch (e) {
      failures.push(`${j.job}: ${e.message}`);
      continue;
    }
    const verdict = evaluateJob(j.job, rows, j.cron, nowMs);
    if (verdict.ok) okLines.push(verdict.reason);
    else failures.push(verdict.reason);
  }

  console.log(`⬜  watching ${jobs.length} cron job(s) derived from ${REGISTER_REL}: ${jobs.map((j) => `${j.job} (${j.cron})`).join(', ')}`);
  for (const l of okLines) console.log(`ok  ${l}`);

  if (failures.length) {
    console.error(`✗ ${failures.length} scheduled duty is not reporting healthy:`);
    for (const f of failures) console.error(`    ${f}`);
    console.error('');
    console.error('    This reader runs on GitHub Actions ON PURPOSE — a different provider from the cron it');
    console.error('    watches, so it survives the outage it is meant to report. [pipeline O-4]');
    process.exit(1);
  }

  console.log(`ok  every declared cron duty is fresh and reporting success [pipeline O-4]`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await main();
}
