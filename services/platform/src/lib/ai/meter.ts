// ─────────────────────────────────────────────────────────────────────────────
// lib/ai/meter.ts — THE AI METER (train-st-ai-customer-pays, T17, AI-01). Who may
// make a model call we pay for, the credit it spends, and what it cost.
//
// 🔴 CUSTOMER PAYS (owner lock 2026-10-01: "If using AI ... it should come from
// customer pocket"; lead addendum: "There is NO free AI anywhere: no trial
// credits, no free tier, no 'first N free'"). A call is possible only when ALL of:
//   1. the kill switch is OFF: `AI_ENABLED` is exactly "true" on this Worker AND
//      CONFIG_KV holds no `ai:kill` — absent config is OFF (fail closed);
//   2. the user acknowledged the CURRENT AI disclosure (AI_DISCLOSURE_VERSION):
//      it names the processor, says results are AI-generated and can be wrong,
//      and that nothing is saved without the user's review (EU AI Act Art. 50(1));
//   3. a PAID credit exists: the monthly allowance of a PAID plan (a plan in its
//      trial has none) or a pack credit bought through a verified purchase;
//   4. the user is under their daily call cap (PER_USER_DAILY_CALLS);
//   5. today's spend, with this call's WORST CASE added, stays within the GLOBAL
//      daily circuit-breaker (`AI_DAILY_USD_CAP`; absent or unparseable is 0, so
//      every call is refused). A trip pages the owner once a day.
// Steps 4, 5 and the debit run INSIDE the port's `beforeCall` — the reservation
// every adapter asks for before it touches the wire — so a refusal at any step
// is a call that was never made (services/_shared/src/ports/ai.ts
// `reserveOrRefuse`; the stub's `calls` stays 0, which test/ai-routes.test.ts
// asserts for every refusal).
//
// SETTLEMENT: a call where nothing ran (the provider answered an error it does
// not bill, or the reservation was refused) RELEASES its credit; anything else is
// charged — a refusal or a truncation is billed by the provider, so the credit is
// spent — and its USD is recorded at each attempt's own model prices (`settle`).
//
// NO CONTENT here: ids, counts, tokens and USD only.
// ─────────────────────────────────────────────────────────────────────────────
import type { AiBeforeCall, AiCostModel, AiFeature, AiOutcome, AiReservationRequest } from '../../../../_shared/src/ports/ai';
import { settle } from '../../../../_shared/src/ports/ai';
import { readProductEntitlement } from '../../../../_shared/src/entitlement-read';
import { allRows, firstRow, nowIso, uuid } from '../d1';
import { isAttributableProduct } from '../../config';
import { isMoneyEnvironment } from '../mor/contract';
import type { Env } from '../../types';

/**
 * The version of the AI disclosure a user must have acknowledged. A new text is
 * a new version, and every user is asked again before their next call.
 */
export const AI_DISCLOSURE_VERSION = '2026-10-02';

/**
 * Model calls a PAID plan includes per UTC month (the T17 proposal; the price ADR
 * ratifies it). None during a trial.
 *
 * @ceiling none — a commercial allowance we chose, not a platform resource.
 */
export const PRO_MONTHLY_ALLOWANCE = 20;

/**
 * Model calls one user may make per UTC day, whatever credits they hold — the
 * per-user cap a leaked session cannot spend past.
 *
 * @ceiling none — an abuse cap we chose, not a platform resource; enforced by a D1 read, not a binding.
 */
export const PER_USER_DAILY_CALLS = 40;

/**
 * The most statements any meter batch sends: a pack grant is 3 (the account row,
 * the credit, the grant flip), a release and a revocation 2. FIXED by the code,
 * not sized by input; test/ai-routes.test.ts drives every one.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const AI_METER_BATCH_STATEMENTS = 3;

/** The KV key that, when present, stops every AI call at once (the kill switch). */
export const AI_KILL_KEY = 'ai:kill';

export type AiPlan = 'paid' | 'trial' | 'free';

/** A refusal the route answers with; never a call. */
export interface MeterRefusal {
  readonly status: 402 | 403 | 503;
  readonly error:
    | 'ai_disabled'
    | 'ai_consent_required'
    | 'ai_requires_plan'
    | 'ai_credits_exhausted'
    | 'ai_daily_cap'
    | 'ai_spend_paused'
    | 'ai_meter_unavailable';
}

const utcDay = (iso: string): string => iso.slice(0, 10);
const utcMonth = (iso: string): string => iso.slice(0, 7);

/** The global daily USD cap; absent, empty, negative or unparseable is 0 (refuse every call). */
export function dailyUsdCap(env: Pick<Env, 'AI_DAILY_USD_CAP'>): number {
  const v = Number(env.AI_DAILY_USD_CAP);
  return typeof env.AI_DAILY_USD_CAP === 'string' && env.AI_DAILY_USD_CAP.trim() !== '' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** The kill switch: ON (no calls) unless AI_ENABLED is exactly "true" and no `ai:kill` key is set. An unreadable KV is ON. */
export async function aiEnabled(env: Pick<Env, 'AI_ENABLED' | 'CONFIG_KV'>): Promise<boolean> {
  if (env.AI_ENABLED !== 'true') return false;
  try {
    return (await env.CONFIG_KV.get(AI_KILL_KEY)) === null;
  } catch {
    return false;
  }
}

/**
 * The user's plan for this product, through the ONE entitlement reader. `trial`
 * when the granting per-app row is in its trial (the rail says `trialing`, or
 * its trial has not ended): a trial is not a payment, so it buys no AI.
 */
export async function planOf(env: Pick<Env, 'PLATFORM_DB' | 'MONEY_ENVIRONMENT'>, userId: string, appId: string, rid: string, nowMs: number): Promise<AiPlan> {
  const read = await readProductEntitlement(
    { db: env.PLATFORM_DB, allRows, isMoneyEnvironment, isKnownProduct: isAttributableProduct, warn: (m) => console.warn(m), error: (m) => console.error(m), nowMs: () => nowMs },
    { userId, productId: appId, environment: env.MONEY_ENVIRONMENT, rid },
  );
  if (read.kind !== 'ok' || !read.is_pro) return 'free';
  if (read.granted_via === 'bundle') return 'paid';
  const inTrial = read.entitlements.some(
    (e) => e.is_active && (e.provider_status === 'trialing' || (e.trial_end !== null && Date.parse(e.trial_end) > nowMs)),
  );
  return inTrial ? 'trial' : 'paid';
}

interface AccountRow {
  pack_credits: number;
  allowance_period: string | null;
  allowance_used: number;
  consent_version: string | null;
  consent_at: string | null;
}

/** The user's AI account, or the empty one (nothing bought, nothing used, no opt-in). */
export async function readAccount(db: D1Database, userId: string, appId: string): Promise<AccountRow> {
  const row = await firstRow<AccountRow>(
    db.prepare('SELECT pack_credits, allowance_period, allowance_used, consent_version, consent_at FROM ai_accounts WHERE user_id = ? AND app_id = ?').bind(userId, appId),
  );
  return row ?? { pack_credits: 0, allowance_period: null, allowance_used: 0, consent_version: null, consent_at: null };
}

/** The allowance left this month on a plan: none on a trial or a free plan. */
export function allowanceLeft(plan: AiPlan, account: AccountRow, now: string): number {
  if (plan !== 'paid') return 0;
  const used = account.allowance_period === utcMonth(now) ? account.allowance_used : 0;
  return Math.max(0, PRO_MONTHLY_ALLOWANCE - used);
}

/** Record the user's acknowledgement of the current disclosure. Idempotent. */
export async function recordConsent(db: D1Database, userId: string, appId: string, now: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO ai_accounts (user_id, app_id, consent_version, consent_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id, app_id) DO UPDATE SET consent_version = excluded.consent_version, consent_at = excluded.consent_at, updated_at = excluded.updated_at`,
    )
    .bind(userId, appId, AI_DISCLOSURE_VERSION, now, now)
    .run();
}

/**
 * The checks that need no reservation, in the order a user should hear them:
 * the switch, the opt-in, then whether any PAID credit exists. Read-only. The
 * same rules are enforced again, atomically, in `beforeCall`.
 */
export async function precheck(env: Env, userId: string, appId: string, plan: AiPlan, now: string): Promise<MeterRefusal | null> {
  if (!(await aiEnabled(env))) return { status: 503, error: 'ai_disabled' };
  let account: AccountRow;
  try {
    account = await readAccount(env.PLATFORM_DB, userId, appId);
  } catch {
    return { status: 503, error: 'ai_meter_unavailable' };
  }
  if (account.consent_version !== AI_DISCLOSURE_VERSION) return { status: 403, error: 'ai_consent_required' };
  if (account.pack_credits > 0 || allowanceLeft(plan, account, now) > 0) return null;
  return plan === 'paid' ? { status: 402, error: 'ai_credits_exhausted' } : { status: 402, error: 'ai_requires_plan' };
}

export interface MeterContext {
  readonly env: Env;
  readonly userId: string;
  readonly appId: string;
  readonly feature: AiFeature;
  readonly plan: AiPlan;
  readonly prices: AiCostModel;
  /** For the once-a-day owner page when the global breaker trips. */
  readonly page?: (subject: string, lines: string[]) => Promise<unknown>;
  readonly now?: () => string;
}

export interface Meter {
  /** The port's reservation hook: refuses, or reserves ONE credit and the call's worst case. */
  readonly beforeCall: AiBeforeCall;
  /** Why the last reservation was refused, or null. */
  refusal(): MeterRefusal | null;
  /** Settle the reserved call against what ran. A no-op when nothing was reserved. */
  settle(outcome: AiOutcome): Promise<void>;
}

export function createMeter(ctx: MeterContext): Meter {
  const db = ctx.env.PLATFORM_DB;
  const clock = ctx.now ?? nowIso;
  const environment = isMoneyEnvironment(ctx.env.MONEY_ENVIRONMENT) ? ctx.env.MONEY_ENVIRONMENT : 'live';
  let refused: MeterRefusal | null = null;
  let held: { id: string; source: 'allowance' | 'pack'; period: string; reserveUsd: number } | null = null;

  const refuse = (r: MeterRefusal) => {
    refused = r;
    return { ok: false as const, detail: r.error };
  };

  const beforeCall: AiBeforeCall = async (req: AiReservationRequest) => {
    const now = clock();
    const day = utcDay(now);
    const period = utcMonth(now);
    if (!(await aiEnabled(ctx.env))) return refuse({ status: 503, error: 'ai_disabled' });
    const cap = dailyUsdCap(ctx.env);
    try {
      const account = await readAccount(db, ctx.userId, ctx.appId);
      if (account.consent_version !== AI_DISCLOSURE_VERSION) return refuse({ status: 403, error: 'ai_consent_required' });
      const source: 'allowance' | 'pack' | null = allowanceLeft(ctx.plan, account, now) > 0 ? 'allowance' : account.pack_credits > 0 ? 'pack' : null;
      if (source === null) return refuse(ctx.plan === 'paid' ? { status: 402, error: 'ai_credits_exhausted' } : { status: 402, error: 'ai_requires_plan' });

      // THE CAPS AND THE RESERVATION ROW ARE ONE STATEMENT: the row lands only
      // while the user is under their daily calls and today's spend plus this
      // call's worst case is within the global cap. D1 runs one statement at a
      // time, so a parallel burst cannot overshoot either cap.
      const id = uuid();
      const ins = await db
        .prepare(
          `INSERT INTO ai_ledger (id, kind, user_id, app_id, environment, feature, model, source, credits, status, reserved_usd, created_at, day)
           SELECT ?1, 'call', ?2, ?3, ?4, ?5, ?6, ?7, -1, 'reserved', ?8, ?9, ?10
            WHERE (SELECT COUNT(*) FROM ai_ledger
                    WHERE user_id = ?2 AND app_id = ?3 AND day = ?10 AND kind = 'call' AND status IN ('reserved', 'settled')) < ?11
              AND (SELECT COALESCE(SUM(CASE WHEN status = 'reserved' THEN reserved_usd ELSE COALESCE(cost_usd, reserved_usd) END), 0)
                     FROM ai_ledger WHERE day = ?10 AND kind = 'call' AND status IN ('reserved', 'settled')) + ?8 <= ?12`,
        )
        .bind(id, ctx.userId, ctx.appId, environment, ctx.feature, req.model, source, req.reserveUsd, now, day, PER_USER_DAILY_CALLS, cap)
        .run();
      if ((ins.meta?.changes ?? 0) !== 1) {
        const mine = await firstRow<{ n: number }>(
          db
            .prepare(`SELECT COUNT(*) AS n FROM ai_ledger WHERE user_id = ? AND app_id = ? AND day = ? AND kind = 'call' AND status IN ('reserved', 'settled')`)
            .bind(ctx.userId, ctx.appId, day),
        );
        if ((mine?.n ?? 0) >= PER_USER_DAILY_CALLS) return refuse({ status: 402, error: 'ai_daily_cap' });
        await pageCapTripped(ctx, day, cap);
        return refuse({ status: 503, error: 'ai_spend_paused' });
      }

      // THE DEBIT: one credit, conditional, so the balance can never go below zero
      // and the allowance never past its monthly number.
      const debit =
        source === 'allowance'
          ? db
              .prepare(
                `INSERT INTO ai_accounts (user_id, app_id, allowance_period, allowance_used, updated_at) VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT (user_id, app_id) DO UPDATE SET
                   allowance_used = CASE WHEN ai_accounts.allowance_period = ?3 THEN ai_accounts.allowance_used + 1 ELSE 1 END,
                   allowance_period = ?3, updated_at = ?4
                 WHERE ai_accounts.allowance_period IS NOT ?3 OR ai_accounts.allowance_used < ?5`,
              )
              .bind(ctx.userId, ctx.appId, period, now, PRO_MONTHLY_ALLOWANCE)
          : db
              .prepare('UPDATE ai_accounts SET pack_credits = pack_credits - 1, updated_at = ? WHERE user_id = ? AND app_id = ? AND pack_credits > 0')
              .bind(now, ctx.userId, ctx.appId);
      const debited = await debit.run();
      if ((debited.meta?.changes ?? 0) !== 1) {
        await db.prepare(`UPDATE ai_ledger SET status = 'refused', credits = 0, settled_at = ? WHERE id = ?`).bind(now, id).run();
        return refuse(ctx.plan === 'paid' ? { status: 402, error: 'ai_credits_exhausted' } : { status: 402, error: 'ai_requires_plan' });
      }
      held = { id, source, period, reserveUsd: req.reserveUsd };
      return { ok: true, id };
    } catch {
      // A missing table (the migration not yet run) or a D1 failure: refused, never a free call.
      return refuse({ status: 503, error: 'ai_meter_unavailable' });
    }
  };

  async function settleCall(outcome: AiOutcome): Promise<void> {
    if (held === null) return;
    const h = held;
    held = null;
    const now = clock();
    const nothingRan = outcome.billing.known && outcome.billing.attempts.length === 0;
    if (nothingRan) {
      // Release: the credit goes back where it came from.
      await db.batch([
        db.prepare(`UPDATE ai_ledger SET status = 'released', credits = 0, cost_usd = 0, settled_at = ? WHERE id = ? AND status = 'reserved'`).bind(now, h.id),
        h.source === 'allowance'
          ? db
              .prepare('UPDATE ai_accounts SET allowance_used = allowance_used - 1, updated_at = ? WHERE user_id = ? AND app_id = ? AND allowance_period = ? AND allowance_used > 0')
              .bind(now, ctx.userId, ctx.appId, h.period)
          : db.prepare('UPDATE ai_accounts SET pack_credits = pack_credits + 1, updated_at = ? WHERE user_id = ? AND app_id = ?').bind(now, ctx.userId, ctx.appId),
      ]);
      return;
    }
    const s = settle(ctx.prices, h.reserveUsd, outcome);
    const attempts = outcome.billing.known ? outcome.billing.attempts : [];
    const tokensIn = attempts.reduce((n, a) => n + a.usage.inputTokens + a.usage.cacheReadTokens + a.usage.cacheWriteTokens, 0);
    const tokensOut = attempts.reduce((n, a) => n + a.usage.outputTokens, 0);
    await db
      .prepare(`UPDATE ai_ledger SET status = 'settled', cost_usd = ?, tokens_in = ?, tokens_out = ?, settled_at = ? WHERE id = ? AND status = 'reserved'`)
      .bind(s.chargeUsd, outcome.billing.known ? tokensIn : null, outcome.billing.known ? tokensOut : null, now, h.id)
      .run();
  }

  return { beforeCall, refusal: () => refused, settle: settleCall };
}

/** Page the owner the first time the global breaker trips on a UTC day (a KV mark dedupes it). */
async function pageCapTripped(ctx: MeterContext, day: string, cap: number): Promise<void> {
  console.error(`[ai] the global daily spend circuit-breaker tripped (cap ${cap} USD, day ${day}): every paid AI call is refused until the next UTC day`);
  if (!ctx.page) return;
  const key = `ai:cap-paged:${day}`;
  try {
    if ((await ctx.env.CONFIG_KV.get(key)) !== null) return;
    await ctx.env.CONFIG_KV.put(key, '1', { expirationTtl: 2 * 86_400 });
  } catch {
    return;
  }
  await ctx.page(`AI spend paused: the daily cap of ${cap} USD is reached`, [
    `day ${day}: every paid AI call is refused (503 ai_spend_paused) until 00:00 UTC.`,
    'Raise AI_DAILY_USD_CAP on the platform Worker only after reading the ai_ledger day total.',
  ]);
}

// ── PACKS (AI-04): credited ONLY by a verified purchase, idempotent per purchase ──

export interface PackGrant {
  readonly provider: string;
  /** The rail's purchase reference: the idempotency key. */
  readonly ref: string;
  readonly userId: string;
  readonly appId: string;
  readonly credits: number;
  readonly environment: string;
}

/**
 * Credit a verified pack purchase. Called by the money path AFTER its signature
 * check, never by a client. A replay of the same (provider, ref) credits nothing:
 * the grant row is unique, and the balance moves only while the row is `pending`
 * — inside one batch, so a retried batch meets `granted` and adds nothing.
 */
export async function creditPack(db: D1Database, g: PackGrant, now: string = nowIso()): Promise<boolean> {
  if (!Number.isInteger(g.credits) || g.credits <= 0) return false;
  const id = uuid();
  const ins = await db
    .prepare(
      `INSERT INTO ai_ledger (id, kind, user_id, app_id, environment, source, credits, status, provider, provider_ref, created_at, day)
       VALUES (?, 'grant', ?, ?, ?, 'pack', ?, 'pending', ?, ?, ?, ?)
       ON CONFLICT (provider, provider_ref) DO NOTHING`,
    )
    .bind(id, g.userId, g.appId, g.environment, g.credits, g.provider, g.ref, now, utcDay(now))
    .run();
  if ((ins.meta?.changes ?? 0) !== 1) return false;
  await db.batch([
    db.prepare(`INSERT INTO ai_accounts (user_id, app_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (user_id, app_id) DO NOTHING`).bind(g.userId, g.appId, now),
    db
      .prepare(
        `UPDATE ai_accounts SET pack_credits = pack_credits + ?, updated_at = ?
          WHERE user_id = ? AND app_id = ? AND EXISTS (SELECT 1 FROM ai_ledger WHERE id = ? AND status = 'pending')`,
      )
      .bind(g.credits, now, g.userId, g.appId, id),
    db.prepare(`UPDATE ai_ledger SET status = 'granted' WHERE id = ? AND status = 'pending'`).bind(id),
  ]);
  return true;
}

/**
 * A refunded or charged-back pack: remove its UNSPENT credits (never below zero —
 * what was already spent was already paid for by the call it bought). Idempotent:
 * only a `granted` row is revoked, once.
 */
export async function revokePack(db: D1Database, provider: string, ref: string, now: string = nowIso()): Promise<boolean> {
  const row = await firstRow<{ id: string; user_id: string | null; app_id: string; credits: number; status: string }>(
    db.prepare(`SELECT id, user_id, app_id, credits, status FROM ai_ledger WHERE kind = 'grant' AND provider = ? AND provider_ref = ?`).bind(provider, ref),
  );
  if (!row || row.status !== 'granted' || row.user_id === null) return false;
  const res = await db.batch([
    db
      .prepare(
        `UPDATE ai_accounts SET pack_credits = MAX(0, pack_credits - ?), updated_at = ?
          WHERE user_id = ? AND app_id = ? AND EXISTS (SELECT 1 FROM ai_ledger WHERE id = ? AND status = 'granted')`,
      )
      .bind(row.credits, now, row.user_id, row.app_id, row.id),
    db.prepare(`UPDATE ai_ledger SET status = 'revoked', settled_at = ? WHERE id = ? AND status = 'granted'`).bind(now, row.id),
  ]);
  return (res[1]?.meta?.changes ?? 0) === 1;
}
