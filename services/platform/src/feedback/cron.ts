// ─────────────────────────────────────────────────────────────────────────────
// feedback/cron.ts — the "Report a problem" limbs of the platform Worker's 06:40
// firing, after the retention sweep (src/scheduled.ts SPLIT_FIRINGS, RETENTION_CRON;
// lane feedback-intake, Do 7 and 8, and lane feedback-triage, Do 4).
//
// FOUR LIMBS, each in its own try so one failing does not stop the others, and
// each writing one `cron_heartbeat` row (job `feedback_purge`, platform_db's
// table every cron limb writes) so a purge that stops is a red row, not a store
// that quietly grows:
//
//   purge     every report whose `purge_at` has passed: its screenshot object is
//             deleted, an anonymised stub is counted into `feedback_counts` (day,
//             app, version, category, status — no text, no account, no contact),
//             and the ROW is deleted. PURGE_BATCH a pass, again while a pass is
//             full, at most PURGE_MAX_PASSES passes.
//   orphans   every object under `shots/` whose report row no longer names it is
//             deleted. This is how ACCOUNT DELETION reaches the screenshots: the
//             platform's erasure walk deletes the rows (`user_id`, 0025's header),
//             and this limb deletes what they pointed at — ORPHAN_MAX_PAGES pages
//             a night, resuming from a cursor in CONFIG_KV.
//   windows   the rate-limit windows and their salts, once ended.
//   notices   (lane feedback-triage, Do 4) every report at `fixed` whose reporter
//             ticked "tell me when it is fixed": ONE localised mail each, then
//             `notified` (feedback/notify.ts runNotices, claim-then-send). Runs FIRST,
//             so a report fixed on its last day is told before its purge.
// ─────────────────────────────────────────────────────────────────────────────
import { allRows, run } from '../lib/d1';
import { DAY_MS, HOUR_MS, ORPHAN_MAX_PAGES, ORPHAN_PAGE, PURGE_BATCH, PURGE_MAX_PASSES } from './limits';
import { MAX_NOTICES_PER_RUN } from './notify';
import { pruneWindows } from './window-limiter';
import { runNotices } from './notify';
import { mailFor } from '../ports';
import type { MailTransport } from '../../../_shared/src/ports/mail';
import type { Env } from '../types';

export const FEEDBACK_CRON_JOB = 'feedback_purge';
/** Statements in one purge pass's batch: the anonymised count, then the delete. */
// @ceiling none — a fixed statement count per pass; PURGE_MAX_PASSES bounds the passes
export const PURGE_PASS_STATEMENTS = 2;

interface PurgeRow {
  id: string;
  app_id: string;
  reported_version: string | null;
  category: string;
  status: string;
  created_at: string;
  screenshot_key: string | null;
}

/** Purge every report past its `purge_at`. Returns the rows purged. */
export async function purgeExpired(env: Env, nowMs: number): Promise<{ purged: number; capped: boolean }> {
  const now = new Date(nowMs).toISOString();
  let purged = 0;
  let full = true;
  for (let pass = 0; full && pass < PURGE_MAX_PASSES; pass++) {
    const rows = await allRows<PurgeRow>(
      env.PLATFORM_DB.prepare(`SELECT id, app_id, reported_version, category, status, created_at, screenshot_key FROM feedback_reports WHERE purge_at <= ? ORDER BY purge_at LIMIT ?`).bind(now, PURGE_BATCH),
    );
    // The object first: a row deleted before its object would leave the object
    // for the orphan limb, but an object deleted before its row is never orphaned.
    for (const r of rows) if (r.screenshot_key) await env.SCREENSHOTS.delete(r.screenshot_key);
    if (rows.length > 0) {
      // Two set statements in ONE transaction, never one per row: a Worker
      // invocation is held to D1's per-invocation query ceiling. The id set is
      // the rows just read, so the count and the delete name the same reports.
      // The id set is ONE bound JSON array (`json_each(?)`), never a hand-built
      // `IN (?, ?, …)` list: the statement text is fixed, whatever the batch size.
      const ids = JSON.stringify(rows.map((r) => r.id));
      await env.PLATFORM_DB.batch([
        env.PLATFORM_DB.prepare(`INSERT INTO feedback_counts (day, app_id, reported_version, category, status, n) SELECT substr(created_at, 1, 10), app_id, COALESCE(reported_version, ''), category, status, COUNT(*) FROM feedback_reports WHERE id IN (SELECT value FROM json_each(?)) GROUP BY substr(created_at, 1, 10), app_id, COALESCE(reported_version, ''), category, status ON CONFLICT (day, app_id, reported_version, category, status) DO UPDATE SET n = n + excluded.n`).bind(ids),
        env.PLATFORM_DB.prepare('DELETE FROM feedback_reports WHERE id IN (SELECT value FROM json_each(?))').bind(ids),
      ]);
    }
    purged += rows.length;
    full = rows.length >= PURGE_BATCH;
  }
  return { purged, capped: full };
}

/** Where the orphan sweep resumes: the bucket listing's cursor, in CONFIG_KV. */
export const ORPHAN_CURSOR_KEY = 'feedback:orphan-cursor';

/** Delete the screenshots no report row names any more, ORPHAN_MAX_PAGES pages a
 *  night from where the last night stopped. Returns the count deleted. */
export async function sweepOrphans(env: Env): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined = (await env.CONFIG_KV.get(ORPHAN_CURSOR_KEY)) ?? undefined;
  for (let page = 0; page < ORPHAN_MAX_PAGES; page++) {
    // ORPHAN_PAGE keys a page: one bounded read per page of the bucket listing.
    const listing = await env.SCREENSHOTS.list({ prefix: 'shots/', cursor, limit: ORPHAN_PAGE });
    const keys = listing.objects.map((o) => o.key);
    if (keys.length > 0) {
      const named = new Set(
        (
          await allRows<{ screenshot_key: string }>(
            env.PLATFORM_DB.prepare(
              'SELECT screenshot_key FROM feedback_reports WHERE screenshot_key IN (SELECT value FROM json_each(?))',
            ).bind(JSON.stringify(keys)),
          )
        ).map((r) => r.screenshot_key),
      );
      for (const k of keys) {
        if (named.has(k)) continue;
        await env.SCREENSHOTS.delete(k);
        deleted++;
      }
    }
    cursor = listing.truncated ? listing.cursor : undefined;
    if (cursor === undefined) break;
  }
  // The end of the listing restarts the next night from the top.
  if (cursor === undefined) await env.CONFIG_KV.delete(ORPHAN_CURSOR_KEY);
  else await env.CONFIG_KV.put(ORPHAN_CURSOR_KEY, cursor);
  return deleted;
}

/** The firing's D1 statements, summed from the limb caps (JOB_STATEMENT_BUDGET):
 *  the notices (the read, then per notice the suppression read and the claim, plus
 *  a suppressed row's update), the purge passes (a read and a two-statement batch
 *  each), one read per orphan page, the windows batch, and four heartbeat rows. */
export const FEEDBACK_STATEMENT_BUDGET = 1 + 3 * MAX_NOTICES_PER_RUN + PURGE_MAX_PASSES * (1 + PURGE_PASS_STATEMENTS) + ORPHAN_MAX_PAGES + 2 + 4;

async function heartbeat(env: Env, target: string, ok: boolean, detail: string, nowMs: number): Promise<void> {
  try {
    await run(
      env.PLATFORM_DB.prepare('INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES (?, ?, ?, ?, ?)').bind(
        FEEDBACK_CRON_JOB,
        target,
        ok ? 1 : 0,
        detail.slice(0, 500),
        new Date(nowMs).toISOString(),
      ),
    );
  } catch (err) {
    console.log(`[feedback-cron] heartbeat ${target} not written: ${err instanceof Error ? err.name : typeof err}`);
  }
}

/** The cron's one entry. Never throws: each limb's failure is its heartbeat row. */
export async function runFeedbackCron(
  env: Env,
  nowMs: number = Date.now(),
  deps: { mail?: MailTransport | null } = {},
): Promise<void> {
  try {
    const mail = deps.mail !== undefined ? deps.mail : mailFor('feedback', env);
    const n = await runNotices(env.PLATFORM_DB, mail, new Date(nowMs).toISOString());
    await heartbeat(
      env,
      'notices',
      n.failed === 0,
      n.configured ? `sent=${n.sent} suppressed=${n.suppressed} failed=${n.failed}` : 'not configured (RESEND_API_KEY unset): nothing sent',
      nowMs,
    );
  } catch (err) {
    await heartbeat(env, 'notices', false, String(err), nowMs);
  }
  try {
    const { purged, capped } = await purgeExpired(env, nowMs);
    await heartbeat(env, 'purge', true, `purged=${purged}${capped ? ' capped=1' : ''}`, nowMs);
  } catch (err) {
    await heartbeat(env, 'purge', false, String(err), nowMs);
  }
  try {
    await heartbeat(env, 'orphans', true, `deleted=${await sweepOrphans(env)}`, nowMs);
  } catch (err) {
    await heartbeat(env, 'orphans', false, String(err), nowMs);
  }
  try {
    const n = await pruneWindows(env.PLATFORM_DB, nowMs - 2 * HOUR_MS, nowMs - 2 * DAY_MS);
    await heartbeat(env, 'windows', true, `pruned=${n}`, nowMs);
  } catch (err) {
    await heartbeat(env, 'windows', false, String(err), nowMs);
  }
}
