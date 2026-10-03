// ─────────────────────────────────────────────────────────────────────────────
// INVITE A FRIEND (lane growth-codes, Do 4; O-INVITE-REWARD-UNBUILT): one free
// Pro month for BOTH, once the invitee is a real, active, new user.
//
//   POST /v1/invites/code    { app }        → 200 { code }       mint (or rotate) my invite code
//   POST /v1/invites/claim   { app, code }  → 200 { state }      the invitee names who invited them
//   POST /v1/invites/settle  { app }        → 200 { state, expiresAt } | 202 { state, waitingOn }
//   GET  /v1/invites/mine is routes/invites-mine.ts (its own file, so each wire pin reads one body).
//
// AUTHED (src/index.ts mounts `platformAuth` on /v1/invites/*). The code is
// returned ONCE, at mint, and stored only as its hash (migration 0032
// invite_links); asking again ROTATES it, so an old link stops working.
//
// THE RULES are tooling/catalog/offers.json `st-invite.rules`, judged by
// src/lib/codes/invites.ts over facts the SERVER reads: the identity provider's
// account record (age, confirmed address), the app's own rows (activation), the
// money tables (prior Pro or trial) and this table (the inviter's rewards this
// year, one reward per invitee). A rule time can lift (age, address,
// activation) leaves the invite pending (202); any other refuses it for good.
// The reward is taken in ONE conditional UPDATE that re-counts the inviter's
// rewards, so two invitees settling at once cannot pass the yearly cap.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { readBoundedBody } from '../lib/body';
import { allRows, firstRow, nowIso, run } from '../lib/d1';
import { isMoneyEnvironment } from '../lib/mor/contract';
import { withinRateLimit } from '../lib/edge-ceiling';
import { readAccount } from '../lib/platform-erasure';
import { codeHash, normaliseCode } from '../lib/codes/verify';
import { grantPromoMonths } from '../lib/codes/grant';
import { inviteEligibility } from '../lib/codes/invites';
import { FREE_OFFERS, type FreeOffer } from '../lib/codes/offers';

/** @ceiling none — a request-shape bound: an app id and a code. */
export const INVITE_MAX_BYTES = 512;
// @ceiling none — the invite rule's year, a policy window rather than a platform resource
const YEAR_MS = 365 * 86_400_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Keys that would DECIDE a reward. A body naming one is refused out loud. */
const GRANT_DECIDING_KEYS = ['source', 'featureSetName', 'expiresAt', 'months', 'userId', 'inviterId', 'offer'];

/** 16 characters of a 32-symbol alphabet: 80 bits (offers.json codePolicy). */
export function mintInviteCode(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map((x) => ALPHABET[x & 31]).join('');
}

/**
 * The invitee's rows in the app's activation table, or null for a table this
 * Worker cannot read. One literal statement per (database, table) the register
 * may name, so the SQL inventory (assert-d1-sql-inventory) sees every one.
 */
async function activationRows(env: AppEnv['Bindings'], database: string, table: string, userId: string): Promise<number | null> {
  if (database === 'SUBSCRIPTIONTRACKER_DB' && table === 'subscriptions') {
    const row = await firstRow<{ n: number }>(env.SUBSCRIPTIONTRACKER_DB.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_id = ?').bind(userId));
    return Number(row?.n ?? 0);
  }
  return null;
}

type Parsed = { ok: true; app: string; code: string | null } | { ok: false; status: 400 | 413 | 422; error: string; keys?: string[] };

async function parse(req: Request, wantCode: boolean): Promise<Parsed> {
  const read = await readBoundedBody(req, INVITE_MAX_BYTES);
  if (!read.ok) return { ok: false, status: read.status === 413 ? 413 : 400, error: read.error };
  let o: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(read.bytes));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, status: 400, error: 'bad_json' };
    o = v as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, error: 'bad_json' };
  }
  const offered = GRANT_DECIDING_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(o, k));
  if (offered.length) return { ok: false, status: 400, error: 'client_supplied_grant', keys: offered };
  if (Object.keys(o).some((k) => k !== 'app' && !(wantCode && k === 'code'))) return { ok: false, status: 422, error: 'invalid' };
  if (typeof o.app !== 'string') return { ok: false, status: 422, error: 'invalid' };
  const code = wantCode ? normaliseCode(o.code) : null;
  if (wantCode && code === null) return { ok: false, status: 422, error: 'invalid' };
  return { ok: true, app: o.app, code };
}

const refuse = (c: { json: (b: unknown, s: 400 | 413 | 422) => Response }, p: Parsed & { ok: false }) =>
  p.status === 413 ? c.json({ error: p.error }, 413) : p.status === 400 ? c.json({ error: p.error, keys: p.keys }, 400) : c.json({ error: p.error }, 422);

export function invitesRoutes(offers: readonly FreeOffer[] = FREE_OFFERS, fetchImpl: typeof fetch = fetch) {
  const invites = new Hono<AppEnv>();
  const offerFor = (app: string) => offers.find((o) => o.kind === 'invite' && o.app === app && o.status === 'live' && o.rules !== undefined);

  invites.post('/invites/code', async (c) => {
    const userId = c.get('userId');
    if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `invites:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
    const p = await parse(c.req.raw, false);
    if (!p.ok) return refuse(c, p);
    if (offerFor(p.app) === undefined) return c.json({ error: 'offer_not_live' }, 503);
    const code = mintInviteCode();
    await run(
      c.env.PLATFORM_DB.prepare(
        'INSERT INTO invite_links (user_id, app_id, code_hash, created_at) VALUES (?,?,?,?) ON CONFLICT (user_id, app_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at',
      ).bind(userId, p.app, await codeHash(code), nowIso()),
    );
    return c.json({ code }, 200, { 'Cache-Control': 'no-store' });
  });

  invites.post('/invites/claim', async (c) => {
    const userId = c.get('userId');
    if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `invites:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
    const p = await parse(c.req.raw, true);
    if (!p.ok) return refuse(c, p);
    if (offerFor(p.app) === undefined) return c.json({ error: 'offer_not_live' }, 503);
    const link = await firstRow<{ user_id: string }>(
      c.env.PLATFORM_DB.prepare('SELECT user_id FROM invite_links WHERE code_hash = ? AND app_id = ?').bind(await codeHash(p.code as string), p.app),
    );
    if (link === null) return c.json({ error: 'unknown_code' }, 404);
    if (link.user_id === userId) return c.json({ error: 'self_invite' }, 422);
    const ins = await run(
      c.env.PLATFORM_DB.prepare(
        "INSERT INTO invites (user_id, app_id, inviter_user_id, state, claimed_at) VALUES (?,?,?,'pending',?) ON CONFLICT (user_id, app_id) DO NOTHING",
      ).bind(userId, p.app, link.user_id, nowIso()),
    );
    if ((ins.meta?.changes ?? 0) === 0) return c.json({ error: 'already_claimed' }, 409);
    return c.json({ state: 'pending' }, 200);
  });

  invites.post('/invites/settle', async (c) => {
    const userId = c.get('userId');
    const environment = c.env.MONEY_ENVIRONMENT;
    if (!isMoneyEnvironment(environment)) return c.json({ error: 'money_rail_not_configured' }, 503);
    if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `invites:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
    const p = await parse(c.req.raw, false);
    if (!p.ok) return refuse(c, p);
    const offer = offerFor(p.app);
    if (offer === undefined || offer.rules === undefined) return c.json({ error: 'offer_not_live' }, 503);
    const rules = offer.rules;
    const db = c.env.PLATFORM_DB;
    const invite = await firstRow<{ inviter_user_id: string | null; state: string; reward_grant_ids: string | null }>(
      db.prepare('SELECT inviter_user_id, state, reward_grant_ids FROM invites WHERE user_id = ? AND app_id = ?').bind(userId, p.app),
    );
    if (invite === null) return c.json({ error: 'no_invite' }, 404);
    if (invite.state !== 'pending') return c.json({ state: invite.state }, 200);

    // The server's own facts.
    const key = c.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) return c.json({ error: 'unavailable' }, 503);
    const activation = await activationRows(c.env, rules.activation.database, rules.activation.table, userId);
    if (activation === null) return c.json({ error: 'unavailable' }, 503);
    const account = await readAccount(c.env.SUPABASE_URL, key, userId, fetchImpl);
    if (account.kind !== 'found') return c.json({ error: 'unavailable' }, 503);
    // The inviter's address, only to refuse the same mailbox inviting itself; never stored.
    const inviterAccount = invite.inviter_user_id === null ? null : await readAccount(c.env.SUPABASE_URL, key, invite.inviter_user_id, fetchImpl);
    if (inviterAccount !== null && inviterAccount.kind !== 'found' && inviterAccount.kind !== 'no_account') return c.json({ error: 'unavailable' }, 503);
    const inviterId = inviterAccount?.kind === 'found' ? invite.inviter_user_id : null;
    const prior = await allRows<{ n: number }>(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ? AND app_id = ?
           UNION ALL SELECT COUNT(*) AS n FROM bundle_grants WHERE user_id = ? AND source <> 'promo_code'`,
        )
        .bind(userId, p.app, userId),
    );
    const at = nowIso();
    const since = new Date(Date.parse(at) - YEAR_MS).toISOString();
    const rewarded = invite.inviter_user_id === null
      ? null
      : await firstRow<{ n: number }>(
          db.prepare("SELECT COUNT(*) AS n FROM invites WHERE inviter_user_id = ? AND state = 'rewarded' AND settled_at >= ?").bind(invite.inviter_user_id, since),
        );
    const verdict = inviteEligibility.verify(
      {
        inviteeId: userId,
        inviterId,
        inviteeEmail: account.email,
        inviterEmail: inviterAccount?.kind === 'found' ? inviterAccount.email : '',
        accountCreatedAt: account.created_at ?? null,
        emailConfirmed: account.email_confirmed_at !== null,
        activationRows: activation,
        priorProOrTrial: prior.some((r) => Number(r.n) > 0),
        inviterRewardsThisYear: Number(rewarded?.n ?? 0),
        nowIso: at,
      },
      rules,
    );
    if (!verdict.ok && !verdict.final) return c.json({ state: 'pending', waitingOn: verdict.rule }, 202);
    if (!verdict.ok) {
      await run(
        db.prepare("UPDATE invites SET state = 'refused', refused_reason = ?, settled_at = ? WHERE user_id = ? AND app_id = ? AND state = 'pending'").bind(verdict.rule, at, userId, p.app),
      );
      return c.json({ state: 'refused', rule: verdict.rule }, 200);
    }
    // Take the reward: once per invitee, and under the inviter's yearly cap, in one statement.
    const inviter = invite.inviter_user_id as string;
    const keys = [`invite:${p.app}:${userId}:inviter`, `invite:${p.app}:${userId}:invitee`];
    const taken = await run(
      db
        .prepare(
          `UPDATE invites SET state = 'rewarded', settled_at = ?, reward_grant_ids = ?
            WHERE user_id = ? AND app_id = ? AND state = 'pending'
              AND (SELECT COUNT(*) FROM invites WHERE inviter_user_id = ? AND state = 'rewarded' AND settled_at >= ?) < ?`,
        )
        .bind(at, keys.join(' '), userId, p.app, inviter, since, rules.maxRewardsPerInviterPerYear),
    );
    if ((taken.meta?.changes ?? 0) === 0) return c.json({ error: 'conflict' }, 409);
    const deps = { db, environment };
    await grantPromoMonths(deps, { userId: inviter, appId: p.app, months: offer.months, grantKey: keys[0], operator: `invite:${offer.id}`, nowIso: at });
    const mine = await grantPromoMonths(deps, { userId, appId: p.app, months: offer.months, grantKey: keys[1], operator: `invite:${offer.id}`, nowIso: at });
    return c.json({ state: 'rewarded', expiresAt: mine.expiresAt }, 200);
  });

  return invites;
}

export default invitesRoutes();
