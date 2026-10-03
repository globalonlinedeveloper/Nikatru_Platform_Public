// ─────────────────────────────────────────────────────────────────────────────
// scheduled.ts — the feedback Worker's nightly cron (lane feedback-intake, Do 7
// and 8).
//
// THREE LIMBS, each in its own try so one failing does not stop the others, and
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
//             and the next night this limb deletes what they pointed at.
//   windows   the rate-limit windows and their salts, once ended.
// ─────────────────────────────────────────────────────────────────────────────
import { allRows, run } from './lib/d1';
import { DAY_MS, HOUR_MS, ORPHAN_PAGE, PURGE_BATCH, PURGE_MAX_PASSES } from './lib/limits';
import { pruneWindows } from './lib/window-limiter';
import type { Env } from './types';

export const FEEDBACK_CRON_JOB = 'feedback_purge';

interface PurgeRow {
  id: string;
  app_id: string;
  app_version: string | null;
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
      env.PLATFORM_DB.prepare(
        'SELECT id, app_id, app_version, category, status, created_at, screenshot_key FROM feedback_reports ' +
          'WHERE purge_at <= ? ORDER BY purge_at LIMIT ?',
      ).bind(now, PURGE_BATCH),
    );
    // The object first: a row deleted before its object would leave the object
    // for the orphan limb, but an object deleted before its row is never orphaned.
    for (const r of rows) if (r.screenshot_key) await env.SCREENSHOTS.delete(r.screenshot_key);
    if (rows.length > 0) {
      // Two set statements in ONE transaction, never one per row: a Worker
      // invocation is held to D1's per-invocation query ceiling. The id set is
      // the rows just read, so the count and the delete name the same reports.
      const ids = rows.map((r) => r.id);
      const inIds = `id IN (${ids.map(() => '?').join(', ')})`;
      await env.PLATFORM_DB.batch([
        env.PLATFORM_DB.prepare(
          'INSERT INTO feedback_counts (day, app_id, app_version, category, status, n) ' +
            `SELECT substr(created_at, 1, 10), app_id, COALESCE(app_version, ''), category, status, COUNT(*) FROM feedback_reports WHERE ${inIds} ` +
            'GROUP BY substr(created_at, 1, 10), app_id, COALESCE(app_version, \'\'), category, status ' +
            'ON CONFLICT (day, app_id, app_version, category, status) DO UPDATE SET n = n + excluded.n',
        ).bind(...ids),
        env.PLATFORM_DB.prepare(`DELETE FROM feedback_reports WHERE ${inIds}`).bind(...ids),
      ]);
    }
    purged += rows.length;
    full = rows.length >= PURGE_BATCH;
  }
  return { purged, capped: full };
}

/** Delete every screenshot no report row names any more. Returns the count. */
export async function sweepOrphans(env: Env): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    // ORPHAN_PAGE keys a page: D1 binds at most 100 parameters to one statement.
    const page = await env.SCREENSHOTS.list({ prefix: 'shots/', cursor, limit: ORPHAN_PAGE });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) {
      const named = new Set(
        (
          await allRows<{ screenshot_key: string }>(
            env.PLATFORM_DB.prepare(
              `SELECT screenshot_key FROM feedback_reports WHERE screenshot_key IN (${keys.map(() => '?').join(', ')})`,
            ).bind(...keys),
          )
        ).map((r) => r.screenshot_key),
      );
      for (const k of keys) {
        if (named.has(k)) continue;
        await env.SCREENSHOTS.delete(k);
        deleted++;
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
  return deleted;
}

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
export async function runFeedbackCron(env: Env, nowMs: number = Date.now()): Promise<void> {
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
