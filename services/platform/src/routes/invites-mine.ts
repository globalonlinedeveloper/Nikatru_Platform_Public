// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/invites/mine?app= — "your invites" (lane growth-codes, Do 4): how many
// people joined with this account's invite, and how many were rewarded. Two
// counts over the invites naming this account as the inviter, NEVER who.
// Behind `platformAuth` (src/index.ts mounts it on /v1/invites/*); EVENTS_LIMITER
// keyed `invites:<sub>`. The claim and the reward are routes/invites.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { firstRow } from '../lib/d1';
import { withinRateLimit } from '../lib/edge-ceiling';
import { FREE_OFFERS, type FreeOffer } from '../lib/codes/offers';

export function invitesMineRoutes(offers: readonly FreeOffer[] = FREE_OFFERS) {
  const mine = new Hono<AppEnv>();
  const offerFor = (app: string) => offers.find((o) => o.kind === 'invite' && o.app === app && o.status === 'live');

  mine.get('/invites/mine', async (c) => {
    const userId = c.get('userId');
    if (!(await withinRateLimit(c.env.EVENTS_LIMITER, `invites:${userId}`, 'EVENTS_LIMITER'))) return c.json({ error: 'rate_limited' }, 429);
    const app = c.req.query('app');
    if (typeof app !== 'string' || offerFor(app) === undefined) return c.json({ error: 'offer_not_live' }, 503);
    const row = await firstRow<{ joined: number; rewarded: number }>(
      c.env.PLATFORM_DB.prepare(
        "SELECT COUNT(*) AS joined, COALESCE(SUM(CASE WHEN state = 'rewarded' THEN 1 ELSE 0 END), 0) AS rewarded FROM invites WHERE inviter_user_id = ? AND app_id = ?",
      ).bind(userId, app),
    );
    return c.json({ joined: Number(row?.joined ?? 0), rewarded: Number(row?.rewarded ?? 0) }, 200, { 'Cache-Control': 'no-store' });
  });

  return mine;
}

export default invitesMineRoutes();
