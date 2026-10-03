import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { codesRoutes } from '../src/routes/codes';
import { invitesRoutes } from '../src/routes/invites';
import { codeHash } from '../src/lib/codes/verify';
import { inviteVerdict, type InviteFacts } from '../src/lib/codes/invites';
import { freeOffersOf, type FreeOffer, type InviteRules } from '../src/lib/codes/offers';
import { planOf } from '../src/lib/ai/meter';
import { readProductEntitlement } from '../../_shared/src/entitlement-read';
import { allRows } from '../src/lib/d1';
import { isMoneyEnvironment } from '../src/lib/mor/contract';
import { memoryRateLimiter } from '../../_shared/src/ports/fakes/ratelimit';
import offersRegister from '../../../tooling/catalog/offers.json';
import type { AppEnv } from '../src/types';
import { RealDb, realPlatformDb } from './harness';

// ─────────────────────────────────────────────────────────────────────────────
// offer-codes.test.ts — our own offer codes and invite-a-friend (lane
// growth-codes, Do 2 and Do 4). Each 🔴 case is one of the brief's red controls.
// The register's rows are the REAL ones (tooling/catalog/offers.json), switched
// to `live` here: the bundled register ships them `draft` until the money review.
// ─────────────────────────────────────────────────────────────────────────────

const APP_MIGRATIONS = import.meta.glob('../../subscriptiontracker-api/migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const appDb = () => new RealDb(Object.keys(APP_MIGRATIONS).sort().map((k) => APP_MIGRATIONS[k] as string));

const LIVE: FreeOffer[] = freeOffersOf(offersRegister).map((o) => ({ ...o, status: 'live' }));
const RULES = LIVE.find((o) => o.kind === 'invite')?.rules as InviteRules;
const ME = 'u-asha-codes';
const FRIEND = 'u-ravi-codes';
const CODE = 'ABCD-EFGH-JKLM-NPQR';
const DAY = 86_400_000;

function serve(userId: string, platform: RealDb, app: RealDb = appDb(), fetchImpl?: typeof fetch) {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-codes');
    await next();
  });
  a.route('/v1', codesRoutes(LIVE));
  a.route('/v1', invitesRoutes(LIVE, fetchImpl));
  const env = {
    PLATFORM_DB: platform,
    SUBSCRIPTIONTRACKER_DB: app,
    MONEY_ENVIRONMENT: 'sandbox',
    EVENTS_LIMITER: memoryRateLimiter({ budget: 1000 }),
    SUPABASE_URL: 'https://idp.test',
    SUPABASE_SERVICE_ROLE_KEY: 'srk',
  } as never;
  return (path: string, body: unknown) =>
    a.request(`https://platform.nikatru.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env);
}

async function issue(db: RealDb, code: string, opts: { max?: number; expiresAt?: string; offer?: string } = {}) {
  db.db
    .prepare('INSERT INTO offer_codes (code_hash, offer_id, app_id, max_redemptions, redeemed, expires_at, issued_by, created_at) VALUES (?,?,?,?,0,?,?,?)')
    .run(
      await codeHash(code.replace(/-/g, '')),
      opts.offer ?? 'st-free-month',
      'subscriptiontracker',
      opts.max ?? 10,
      opts.expiresAt ?? new Date(Date.now() + 30 * DAY).toISOString(),
      'owner:ticket-1',
      new Date().toISOString(),
    );
}

const grants = (db: RealDb, user: string) => db.rows('SELECT source, feature_set_name, expires_at, last_event_id FROM bundle_grants WHERE user_id = ?', user);

describe('🔴 POST /v1/codes/redeem — authed, rate-limited, idempotent, hashed, capped, expiring', () => {
  it('a code grants one free Pro month as a promo_code grant, and the code itself is stored nowhere', async () => {
    const db = realPlatformDb();
    await issue(db, CODE);
    const res = await serve(ME, db)('/v1/codes/redeem', { code: CODE.toLowerCase(), idempotencyKey: 'key-00000001' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offer: string; months: number; expiresAt: string; replay: boolean };
    expect(body).toMatchObject({ offer: 'st-free-month', months: 1, replay: false });
    expect(grants(db, ME)).toEqual([{ source: 'promo_code', feature_set_name: 'promo_subscriptiontracker', expires_at: body.expiresAt, last_event_id: 'code:owner:ticket-1' }]);
    const dump = JSON.stringify([db.rows('SELECT * FROM offer_codes'), db.rows('SELECT * FROM offer_redemptions')]);
    expect(dump).not.toContain('ABCDEFGHJKLMNPQR');
  });

  it('🔴 A REPLAY GRANTS ONCE: the same key, or the same code under a new key, answers the first outcome and writes nothing', async () => {
    const db = realPlatformDb();
    await issue(db, CODE);
    const post = serve(ME, db);
    const first = (await (await post('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000001' })).json()) as { expiresAt: string };
    const again = await post('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000001' });
    const newKey = await post('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000002' });
    for (const r of [again, newKey]) {
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ replay: true, expiresAt: first.expiresAt });
    }
    expect(grants(db, ME)).toHaveLength(1);
    expect(db.rows('SELECT redeemed FROM offer_codes')).toEqual([{ redeemed: 1 }]);
  });

  it('🔴 an EXPIRED code is refused (410) and an EXHAUSTED one (409); neither grants', async () => {
    const db = realPlatformDb();
    await issue(db, 'EXPD-EXPD-EXPD-EXPD', { expiresAt: new Date(Date.now() - DAY).toISOString() });
    await issue(db, 'ONCE-ONCE-ONCE-ONCE', { max: 1 });
    expect((await serve(ME, db)('/v1/codes/redeem', { code: 'EXPD-EXPD-EXPD-EXPD', idempotencyKey: 'key-00000001' })).status).toBe(410);
    expect((await serve(FRIEND, db)('/v1/codes/redeem', { code: 'ONCE-ONCE-ONCE-ONCE', idempotencyKey: 'key-00000001' })).status).toBe(200);
    expect((await serve(ME, db)('/v1/codes/redeem', { code: 'ONCE-ONCE-ONCE-ONCE', idempotencyKey: 'key-00000002' })).status).toBe(409);
    expect(grants(db, ME)).toEqual([]);
  });

  it('🔴 6 WRONG CODES IN A MINUTE ARE THROTTLED: the sixth attempt is 429, even with a right code', async () => {
    const db = realPlatformDb();
    await issue(db, CODE);
    const post = serve(ME, db);
    for (let i = 0; i < 5; i++) {
      expect((await post('/v1/codes/redeem', { code: `WRNG-WRNG-WRNG-WRN${i + 2}`, idempotencyKey: `key-0000000${i}` })).status).toBe(404);
    }
    expect((await post('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000009' })).status).toBe(429);
    expect(grants(db, ME)).toEqual([]);
  });

  it('a body that names its own grant is refused out loud (client_supplied_grant), and a draft offer redeems nothing', async () => {
    const db = realPlatformDb();
    await issue(db, CODE);
    const r = await serve(ME, db)('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000001', months: 12 });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: 'client_supplied_grant', keys: ['months'] });
    const drafted = new Hono<AppEnv>();
    drafted.use('*', async (c, next) => {
      c.set('userId', ME);
      await next();
    });
    drafted.route('/v1', codesRoutes(freeOffersOf(offersRegister)));
    const d = await drafted.request(
      'https://platform.nikatru.com/v1/codes/redeem',
      { method: 'POST', body: JSON.stringify({ code: CODE, idempotencyKey: 'key-00000002' }) },
      { PLATFORM_DB: db, MONEY_ENVIRONMENT: 'sandbox' } as never,
    );
    expect(d.status).toBe(503);
    expect(grants(db, ME)).toEqual([]);
  });

  it('🔴 NEVER FREE AI: the redeemed month unlocks Pro for the app, and the AI meter reads the plan as free', async () => {
    const db = realPlatformDb();
    await issue(db, CODE);
    expect((await serve(ME, db)('/v1/codes/redeem', { code: CODE, idempotencyKey: 'key-00000001' })).status).toBe(200);
    const deps = { db, allRows, isMoneyEnvironment, isKnownProduct: (p: string) => p === 'subscriptiontracker', warn: () => {}, error: () => {}, nowMs: () => Date.now() };
    const read = await readProductEntitlement(deps as never, { userId: ME, productId: 'subscriptiontracker', environment: 'sandbox', rid: 't' });
    expect(read).toMatchObject({ kind: 'ok', is_pro: true });
    expect(await planOf({ PLATFORM_DB: db, MONEY_ENVIRONMENT: 'sandbox' } as never, ME, 'subscriptiontracker', 't', Date.now())).toBe('free');
  });
});

// ── invite-a-friend ─────────────────────────────────────────────────────────

const facts = (over: Partial<InviteFacts> = {}): InviteFacts => ({
  inviteeId: FRIEND,
  inviterId: ME,
  accountCreatedAt: new Date(Date.now() - 8 * DAY).toISOString(),
  emailConfirmed: true,
  activationRows: 1,
  priorProOrTrial: false,
  inviterRewardsThisYear: 0,
  nowIso: new Date().toISOString(),
  ...over,
});

describe('🔴 the invite abuse rules — one red case per rule (src/lib/codes/invites.ts)', () => {
  it('green control: a real, active, new invitee is rewarded', () => {
    expect(inviteVerdict(facts(), RULES)).toEqual({ ok: true });
  });
  it.each([
    ['minAccountAgeDays', { accountCreatedAt: new Date(Date.now() - 6 * DAY).toISOString() }, false],
    ['verifiedEmail', { emailConfirmed: false }, false],
    ['activation', { activationRows: 0 }, false],
    ['maxRewardsPerInviterPerYear', { inviterRewardsThisYear: 5 }, true],
    ['noPriorProOrTrial', { priorProOrTrial: true }, true],
    ['noSelfInvite', { inviterId: FRIEND }, true],
  ] as const)('🔴 %s refuses', (rule, over, final) => {
    expect(inviteVerdict(facts(over as Partial<InviteFacts>), RULES)).toEqual({ ok: false, rule, final });
  });
  it('the register carries the brief\'s numbers', () => {
    expect(RULES).toMatchObject({ minAccountAgeDays: 7, verifiedEmail: true, maxRewardsPerInviterPerYear: 5, oneRewardPerInvitee: true, noPriorProOrTrial: true, noSelfInvite: true });
  });
});

describe('🔴 the invite routes, end to end', () => {
  const idp = (createdDaysAgo: number, confirmed = true) =>
    (async () =>
      new Response(
        JSON.stringify({ email: 'ravi@example.com', email_confirmed_at: confirmed ? '2026-09-01T00:00:00Z' : null, created_at: new Date(Date.now() - createdDaysAgo * DAY).toISOString() }),
        { status: 200 },
      )) as unknown as typeof fetch;

  async function claimed(platform: RealDb, app: RealDb, fetchImpl: typeof fetch) {
    const { code } = (await (await serve(ME, platform, app, fetchImpl)('/v1/invites/code', { app: 'subscriptiontracker' })).json()) as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{16}$/);
    expect((await serve(FRIEND, platform, app, fetchImpl)('/v1/invites/claim', { app: 'subscriptiontracker', code })).status).toBe(200);
    return code;
  }

  it('both get one free Pro month once the invitee qualifies; a second settle and a second claim reward nothing', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const code = await claimed(platform, app, idp(10));
    const post = serve(FRIEND, platform, app, idp(10));
    const waiting = await post('/v1/invites/settle', { app: 'subscriptiontracker' });
    expect(waiting.status).toBe(202);
    expect(await waiting.json()).toEqual({ state: 'pending', waitingOn: 'activation' });
    app.db.prepare("INSERT INTO subscriptions (id, user_id, name) VALUES ('s1', ?, 'Netflix')").run(FRIEND);
    const done = await post('/v1/invites/settle', { app: 'subscriptiontracker' });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ state: 'rewarded' });
    expect(grants(platform, ME).map((g) => g.source)).toEqual(['promo_code']);
    expect(grants(platform, FRIEND).map((g) => g.source)).toEqual(['promo_code']);
    expect(await (await post('/v1/invites/settle', { app: 'subscriptiontracker' })).json()).toEqual({ state: 'rewarded' });
    expect((await post('/v1/invites/claim', { app: 'subscriptiontracker', code })).status).toBe(409);
    expect(grants(platform, FRIEND)).toHaveLength(1);
  });

  it('🔴 a self-invite is refused at the claim', async () => {
    const platform = realPlatformDb();
    const { code } = (await (await serve(ME, platform)('/v1/invites/code', { app: 'subscriptiontracker' })).json()) as { code: string };
    expect((await serve(ME, platform)('/v1/invites/claim', { app: 'subscriptiontracker', code })).status).toBe(422);
  });

  it('🔴 a young account waits; an invitee who held Pro before is refused for good', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    await claimed(platform, app, idp(2));
    const young = await serve(FRIEND, platform, app, idp(2))('/v1/invites/settle', { app: 'subscriptiontracker' });
    expect(await young.json()).toEqual({ state: 'pending', waitingOn: 'minAccountAgeDays' });
    platform.db
      .prepare("INSERT INTO entitlements (user_id, app_id, entitlement, is_active, updated_at) VALUES (?, 'subscriptiontracker', 'pro', 0, '2026-01-01')")
      .run(FRIEND);
    const prior = await serve(FRIEND, platform, app, idp(30))('/v1/invites/settle', { app: 'subscriptiontracker' });
    expect(await prior.json()).toEqual({ state: 'refused', rule: 'noPriorProOrTrial' });
    expect(grants(platform, FRIEND)).toEqual([]);
    expect(grants(platform, ME)).toEqual([]);
  });

  it('🔴 the inviter\'s sixth reward in a year is refused', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    for (let i = 0; i < 5; i++) {
      platform.db
        .prepare("INSERT INTO invites (user_id, app_id, inviter_user_id, state, claimed_at, settled_at) VALUES (?, 'subscriptiontracker', ?, 'rewarded', ?, ?)")
        .run(`u-earlier-${i}`, ME, new Date().toISOString(), new Date().toISOString());
    }
    await claimed(platform, app, idp(10));
    app.db.prepare("INSERT INTO subscriptions (id, user_id, name) VALUES ('s1', ?, 'Netflix')").run(FRIEND);
    const r = await serve(FRIEND, platform, app, idp(10))('/v1/invites/settle', { app: 'subscriptiontracker' });
    expect(await r.json()).toEqual({ state: 'refused', rule: 'maxRewardsPerInviterPerYear' });
    expect(grants(platform, ME)).toEqual([]);
  });
});
