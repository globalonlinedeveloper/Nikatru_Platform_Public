// ─────────────────────────────────────────────────────────────────────────────
// Consolidated nightly cron (see triggers.crons in wrangler.jsonc). ONE cron for
// the whole portfolio (Free-tier 5-cron cap): a platform-wide Supabase keep-alive
// plus a per-app renewals fan-out. Each job contains its own errors.
// ─────────────────────────────────────────────────────────────────────────────
import type { AppTarget, Env } from './types';
import { recomputeRenewals } from './renewals';

/** The job name recorded in `cron_heartbeat`. */
export const KEEPALIVE_JOB = 'supabase_keepalive';

/**
 * Apps the scheduler fans out to. Static today (subly only); as more apps ship,
 * add their APP_DB binding here (or drive it from a platform_db registry).
 */
export function appTargets(env: Env): AppTarget[] {
  return [{ appId: 'subly', db: env.SUBLY_DB }];
}

/**
 * Which Supabase projects to keep awake — CONFIG, not code.
 *
 * WHY GENERIC: the portfolio can hold more than one Supabase project (Free caps
 * at 2), and the previous version pinged exactly one hardcoded `SUPABASE_URL`.
 * Adding a project meant editing and redeploying the Worker — the kind of edit
 * nobody remembers, so a second project would idle and pause with nothing in the
 * repo explaining why.
 *
 * Set `SUPABASE_KEEPALIVE_URLS` to a comma-separated list to control it. Absent,
 * it falls back to the single `SUPABASE_URL`, so an existing deploy is unchanged.
 *
 * Deduped and trailing-slash-normalised: `…co` and `…co/` would otherwise be two
 * targets, doubling requests for no benefit.
 */
export function keepAliveTargets(env: Env): string[] {
  const configured = (env.SUPABASE_KEEPALIVE_URLS ?? '').trim();
  const raw =
    configured.length > 0 ? configured.split(',') : [env.SUPABASE_URL ?? ''];
  const cleaned = raw
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
  return [...new Set(cleaned)];
}

/** One heartbeat row per target per run. Best-effort: never breaks the cron. */
async function recordHeartbeat(
  env: Env,
  rows: { target: string; ok: boolean; detail: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  const ranAt = new Date().toISOString();
  try {
    await env.PLATFORM_DB.batch(
      rows.map((r) =>
        env.PLATFORM_DB.prepare(
          'INSERT INTO cron_heartbeat (job, target, ok, detail, ran_at) VALUES (?,?,?,?,?)',
        ).bind(KEEPALIVE_JOB, r.target, r.ok ? 1 : 0, r.detail.slice(0, 200), ranAt),
      ),
    );
  } catch (err) {
    // The heartbeat failing must not undo the keep-alive that already happened.
    console.log(`[cron] heartbeat write failed: ${String(err)}`);
  }
}

/**
 * WHY: Supabase pauses a free-tier project after ~7 days idle, breaking sign-in
 * for a low-traffic portfolio. A cheap daily request keeps each project active.
 * The response body is irrelevant — only that a request happened.
 *
 * Errors are still contained (one dead project must not stop the others, or the
 * renewals fan-out that follows) but they are no longer INVISIBLE: every outcome,
 * success or failure, lands in `cron_heartbeat`. Before that, a keep-alive that
 * had been failing nightly for a month was indistinguishable from a working one,
 * and the first signal would have been a pause email for the live auth project.
 */
export async function keepAliveSupabase(env: Env): Promise<void> {
  const targets = keepAliveTargets(env);

  // Zero targets is the dangerous case, not a no-op: it means the config is empty
  // or misspelled and NOTHING is being kept awake. Recorded as a failure so it
  // surfaces in the same query as a dead endpoint.
  if (targets.length === 0) {
    console.log('[cron] supabase keep-alive: NO TARGETS CONFIGURED');
    await recordHeartbeat(env, [
      { target: '(none)', ok: false, detail: 'no targets configured' },
    ]);
    return;
  }

  const rows: { target: string; ok: boolean; detail: string }[] = [];
  for (const target of targets) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${target}/auth/v1/health`, {
        signal: controller.signal,
      });
      console.log(`[cron] supabase keep-alive ${target}: ${res.status}`);
      // A request that reaches a broken project still counts as activity, but it
      // must not read as green — a 5xx is recorded as a failure.
      rows.push({ target, ok: res.status < 500, detail: `HTTP ${res.status}` });
    } catch (err) {
      console.log(`[cron] supabase keep-alive ${target} FAILED: ${String(err)}`);
      rows.push({ target, ok: false, detail: String(err) });
    } finally {
      clearTimeout(timeout);
    }
  }
  await recordHeartbeat(env, rows);
}

/** Cron entrypoint. `ctx.waitUntil` keeps the isolate alive for the async work. */
export const scheduled: ExportedHandlerScheduledHandler<Env> = async (_event, env, ctx) => {
  ctx.waitUntil(
    (async () => {
      await keepAliveSupabase(env);
      for (const t of appTargets(env)) {
        await recomputeRenewals(t.db, t.appId);
      }
    })(),
  );
};
