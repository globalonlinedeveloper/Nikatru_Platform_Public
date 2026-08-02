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
//   1. ABSENT   — no row for a declared job inside 1.5× its declared cron
//                 interval. The 1.5 ratio is the one the backup chain already
//                 uses, and its reasoning is recorded in backup-liveness.md:
//                 tight enough to catch a dead timer within one cycle, loose
//                 enough that a single late run is not an alarm.
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

/** The ratio the backup chain already uses; see the header. One constant. */
const STALENESS_RATIO = 1.5;

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
 * The decision, kept pure. `rows` are the newest-first heartbeat rows for ONE
 * job; `intervalHours` is that job's declared cron interval.
 */
export function evaluateJob(job, rows, intervalHours, nowMs) {
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
  const ceiling = intervalHours * STALENESS_RATIO;
  if (ageHours > ceiling) {
    return {
      ok: false,
      kind: 'absent',
      ageHours,
      reason:
        `${job}: newest heartbeat is ${ageHours.toFixed(1)}h old and the ceiling is ${ceiling.toFixed(1)}h ` +
        `(${intervalHours}h interval x ${STALENESS_RATIO}). The timer has stopped, or the job can no longer write.`,
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
  return { ok: true, ageHours, reason: `${job}: fresh (${ageHours.toFixed(1)}h old) and ok=1` };
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
    const intervalHours = cronIntervalHours(crons[0]);
    if (intervalHours === null) {
      problems.push(`${row.id}: cron expression \`${crons[0]}\` is not one this reader can turn into an interval, so the staleness window is UNKNOWN — failing closed rather than guessing.`);
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
      jobs.push({ id: row.id, job, intervalHours, databaseId: dbId, cron: crons[0] });
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
    const verdict = evaluateJob(j.job, rows, j.intervalHours, nowMs);
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
