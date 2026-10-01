// ─────────────────────────────────────────────────────────────────────────────
// ST-R2 — THE PRIVATE CALENDAR FEED, through the real routes over the real-SQL
// harness (platform_db with every migration, subscriptiontracker_db with the
// app's own two), and the RFC 5545 writer it renders with.
//
// RED ON MAIN, GREEN AFTER: before this change there is no routes/calendar.ts, no
// lib/ics.ts and no reminder_feed table, so this file fails at import.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import appInit0001 from '../../subscriptiontracker-api/migrations/0001_init.sql?raw';
import appSchemaDebt0002 from '../../subscriptiontracker-api/migrations/0002_schema_debt.sql?raw';
import appModel0003 from '../../subscriptiontracker-api/migrations/0003_subscription_model.sql?raw';
import calendar from '../src/routes/calendar';
import { escapeText, foldLine, writeCalendar, ICS_MAX_LINE_OCTETS } from '../src/lib/ics';
import { sha256Hex } from '../src/middleware/ext-device-auth';
import { app as realApp } from '../src/index';
import type { AppEnv } from '../src/types';
import { RealDb, realPlatformDb } from './harness';

const APP = 'subscriptiontracker';
const ALICE = 'u-alice-cal';
const BOB = 'u-bob-cal';

afterEach(() => {
  vi.useRealTimers();
});

function appDb(): RealDb {
  return new RealDb([appInit0001, appSchemaDebt0002]);
}

function seedSub(app: RealDb, userId: string, id: string, name: string, nextRenewal: string | null, cycle: string | null = 'monthly'): void {
  app.db
    .prepare('INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, 12.5, cycle, nextRenewal);
}

/** The routes, with `platformAuth`'s one output set as it would be. */
function appFor(userId: string) {
  const a = new Hono<AppEnv>();
  a.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-calendar');
    await next();
  });
  a.route('/v1', calendar);
  return a;
}

function envOf(platform: RealDb, app: RealDb) {
  return { PLATFORM_DB: platform, SUBSCRIPTIONTRACKER_DB: app } as never;
}

async function mint(platform: RealDb, app: RealDb, userId = ALICE): Promise<{ token: string; body: Record<string, string> }> {
  const res = await appFor(userId).request(
    'https://platform.nikatru.com/v1/calendar/feed',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: APP }) },
    envOf(platform, app),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as Record<string, string>;
  const token = /\/v1\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(body.https_url)![1];
  return { token, body };
}

/** The feed, fetched through the REAL app: public, no Authorization header. */
async function fetchFeed(platform: RealDb, app: RealDb, token: string, query = '') {
  return realApp.request(`https://platform.nikatru.com/v1/calendar/${token}.ics${query}`, {}, envOf(platform, app));
}

/** RFC 5545 §3.1 unfolding: a CRLF followed by one space joins two lines. */
const unfold = (ics: string) => ics.replace(/\r\n /g, '');

describe('R2 — a valid token returns the account’s live renewals, one VEVENT each', () => {
  it('🔴 one VEVENT per live row, and a stored Jan 31 read in February is Feb 28 — advance() is the date engine', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-02-10T12:00:00Z'));
    const platform = realPlatformDb();
    const app = appDb();
    seedSub(app, ALICE, 's-31', 'Gym', '2027-01-31');
    seedSub(app, ALICE, 's-yr', 'Cloud', '2027-06-15', 'yearly');
    seedSub(app, ALICE, 's-none', 'NoDate', null);
    seedSub(app, BOB, 's-bob', 'NotAlices', '2027-02-20');
    const { token } = await mint(platform, app);

    const res = await fetchFeed(platform, app, token);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
    const ics = await res.text();
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    const text = unfold(ics);
    expect(text).toContain('DTSTART;VALUE=DATE:20270228');
    expect(text).toContain('DTEND;VALUE=DATE:20270301');
    expect(text).toContain('DTSTART;VALUE=DATE:20270615');
    expect(text).not.toContain('NotAlices');
    expect(text).not.toContain('NoDate');
    // A stable UID per occurrence, and the alarm at the default lead.
    expect(text).toContain(`UID:${APP}.s-31.2027-02-28@reminders.nikatru.com`);
    expect(text).toContain('TRIGGER:-P3D');
  });

  it('the alarm follows the person’s chosen lead', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    platform.db
      .prepare('INSERT INTO reminder_prefs (user_id, app_id, email_opt_in, lead_days, updated_at) VALUES (?, ?, 0, 7, ?)')
      .run(ALICE, APP, '2026-09-28T00:00:00Z');
    seedSub(app, ALICE, 's-1', 'Music', '2099-01-05');
    const { token } = await mint(platform, app);
    expect(unfold(await (await fetchFeed(platform, app, token)).text())).toContain('TRIGGER:-P7D');
  });

  it('?download=1 adds an attachment disposition; without it there is none', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const { token } = await mint(platform, app);
    expect((await fetchFeed(platform, app, token)).headers.get('Content-Disposition')).toBeNull();
    expect((await fetchFeed(platform, app, token, '?download=1')).headers.get('Content-Disposition')).toBe(
      'attachment; filename="renewals.ics"',
    );
  });

  it('answers both URLs a calendar can subscribe to', async () => {
    const { token, body } = await mint(realPlatformDb(), appDb());
    expect(body.https_url).toBe(`https://platform.nikatru.com/v1/calendar/${token}.ics`);
    expect(body.webcal_url).toBe(`webcal://platform.nikatru.com/v1/calendar/${token}.ics`);
  });
});

describe('R2 — CRLF, folding and escaping hold', () => {
  it('🔴 every line ends CRLF, no line passes 75 octets, and unfolding restores the text exactly', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const long = `Très longue souscription, avec; des virgules et un \\ antislash — ${'é'.repeat(60)}`;
    seedSub(app, ALICE, 's-long', long, '2099-03-01');
    const { token } = await mint(platform, app);
    const ics = await (await fetchFeed(platform, app, token)).text();
    expect(ics.endsWith('\r\n')).toBe(true);
    const lines = ics.slice(0, -2).split('\r\n');
    for (const l of lines) {
      expect(l.includes('\n') || l.includes('\r'), `bare line break in ${JSON.stringify(l)}`).toBe(false);
      expect(new TextEncoder().encode(l).length, `over 75 octets: ${JSON.stringify(l)}`).toBeLessThanOrEqual(ICS_MAX_LINE_OCTETS);
    }
    expect(lines.some((l) => l.startsWith(' ')), 'the long SUMMARY was never folded').toBe(true);
    expect(unfold(ics)).toContain(`SUMMARY:${escapeText(`${long} renews`)}`);
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folding never splits a UTF-8 sequence, and a 75-octet line is left whole', () => {
    const exact = 'X'.repeat(75);
    expect(foldLine(exact)).toBe(exact);
    const folded = foldLine(`SUMMARY:${'€'.repeat(40)}`); // 3 octets each
    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      expect(part).not.toContain('\uFFFD');
    }
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'€'.repeat(40)}`);
  });

  it('the calendar frame is the one RFC 5545 requires', () => {
    const ics = writeCalendar({ name: 'X', stamp: new Date('2026-09-28T03:00:00.123Z'), events: [] });
    expect(ics).toBe(
      'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Nikatru//Renewal reminders//EN\r\nCALSCALE:GREGORIAN\r\n' +
        'METHOD:PUBLISH\r\nX-WR-CALNAME:X\r\nEND:VCALENDAR\r\n',
    );
  });
});

describe('R2 — the token is the capability, and only its hash is kept', () => {
  it('🔴 the stored value is SHA-256 of the token, and the token itself is stored nowhere', async () => {
    const platform = realPlatformDb();
    const { token } = await mint(platform, appDb());
    const rows = platform.rows('SELECT * FROM reminder_feed');
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('🔴 an unknown token, a malformed one and a revoked one all answer 404', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const { token } = await mint(platform, app);
    expect((await fetchFeed(platform, app, 'Z'.repeat(43))).status).toBe(404);
    expect((await fetchFeed(platform, app, 'short')).status).toBe(404);
    const del = await appFor(ALICE).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, envOf(platform, app));
    expect(del.status).toBe(204);
    expect((await fetchFeed(platform, app, token)).status).toBe(404);
    // ⏱ 2026-10-01 · rv2-services-003. Revoking again is a 204: the feed is
    // revoked, which is what DELETE asked for — and it is the answer a retry
    // gets after a committed first attempt, which must not read as "no feed".
    expect((await appFor(ALICE).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, envOf(platform, app))).status).toBe(204);
    expect((await fetchFeed(platform, app, token)).status).toBe(404);
    // A person who never had a feed is the 404.
    expect((await appFor(BOB).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, envOf(platform, app))).status).toBe(404);
  });

  it('rotating kills the old URL at once and the new one works; one row per account and app', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const first = await mint(platform, app);
    const second = await mint(platform, app);
    expect((await fetchFeed(platform, app, first.token)).status).toBe(404);
    expect((await fetchFeed(platform, app, second.token)).status).toBe(200);
    expect(platform.count('reminder_feed')).toBe(1);
  });

  it('🔴 minting is behind auth on the REAL app, and the feed is not', async () => {
    const platform = realPlatformDb();
    const env = { PLATFORM_DB: platform, SUPABASE_URL: 'https://auth.example' } as never;
    const post = await realApp.request(
      'https://x/v1/calendar/feed',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: APP }) },
      env,
    );
    expect(post.status).toBe(401);
    expect((await realApp.request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, env)).status).toBe(401);
    // Public: an unknown token is a 404, not a 401.
    expect((await realApp.request(`https://x/v1/calendar/${'Q'.repeat(43)}.ics`, {}, env)).status).toBe(404);
  });

  it('an app that is not a reminder target is refused', async () => {
    const res = await appFor(ALICE).request(
      'https://x/v1/calendar/feed',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: 'nope' }) },
      envOf(realPlatformDb(), appDb()),
    );
    expect(res.status).toBe(404);
  });

  it('the public GET is edge-ceilinged: a limiter that says no is a 429 before any read', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const { token } = await mint(platform, app);
    const before = platform.sql.length;
    const env = { PLATFORM_DB: platform, SUBSCRIPTIONTRACKER_DB: app, REMINDERS_CEILING_LIMITER: { limit: async () => ({ success: false }) } } as never;
    const res = await realApp.request(`https://x/v1/calendar/${token}.ics`, {}, env);
    expect(res.status).toBe(429);
    expect(platform.sql.length).toBe(before);
  });
});

// ⏱ 2026-10-01 · rv2-services-015. RED before: neither authed route had a
// per-person limiter, so a limiter that says no changed nothing.
describe('R2 — mint and revoke are behind a per-person burst breaker', () => {
  class FakeLimiter {
    keys: string[] = [];
    constructor(private readonly allow: boolean) {}
    limit = async ({ key }: { key: string }) => {
      this.keys.push(key);
      return { success: this.allow };
    };
  }
  const limitedEnv = (platform: RealDb, app: RealDb, limiter: FakeLimiter) =>
    ({ PLATFORM_DB: platform, SUBSCRIPTIONTRACKER_DB: app, EVENTS_LIMITER: limiter }) as never;

  it('🔴 POST /v1/calendar/feed: a limiter that says no is a 429 and NO reminder_feed write', async () => {
    const platform = realPlatformDb();
    const limiter = new FakeLimiter(false);
    const res = await appFor(ALICE).request(
      'https://x/v1/calendar/feed',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: APP }) },
      limitedEnv(platform, appDb(), limiter),
    );
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(limiter.keys).toEqual([`calendar:${ALICE}`]);
    expect(platform.count('reminder_feed')).toBe(0);
    expect(platform.sql.filter((q) => q.includes('reminder_feed'))).toEqual([]);
  });

  it('🔴 DELETE /v1/calendar/feed: a limiter that says no is a 429 and the feed stays live', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const { token } = await mint(platform, app);
    const limiter = new FakeLimiter(false);
    const res = await appFor(ALICE).request(`https://x/v1/calendar/feed?app_id=${APP}`, { method: 'DELETE' }, limitedEnv(platform, app, limiter));
    expect(res.status).toBe(429);
    expect(limiter.keys).toEqual([`calendar:${ALICE}`]);
    expect(platform.count('reminder_feed', 'revoked_at IS NULL')).toBe(1);
    expect((await fetchFeed(platform, app, token)).status).toBe(200);
  });

  it('a limiter that says yes is charged once per request, on the caller’s key', async () => {
    const platform = realPlatformDb();
    const limiter = new FakeLimiter(true);
    const res = await appFor(BOB).request(
      'https://x/v1/calendar/feed',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: APP }) },
      limitedEnv(platform, appDb(), limiter),
    );
    expect(res.status).toBe(201);
    expect(limiter.keys).toEqual([`calendar:${BOB}`]);
  });
});

// ⏱ 2026-10-01 · rv2-services-019. RED before: escapeText passed C0 controls
// and DEL straight into the feed.
describe('R2 — no control character reaches the feed', () => {
  it('🔴 a name carrying U+0007 (and its kin) yields feed bytes with no C0 except CR and LF, and no DEL', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    // No U+0000 here: node:sqlite binds TEXT as a C string and would cut the name
    // at it, so the NUL is held by the unit case below instead.
    seedSub(app, ALICE, 's-bel', 'Ring\u0007Bell\u0001Soh\u001bEsc\u000bVt\u000cFf\u007fDel', '2099-04-01');
    const { token } = await mint(platform, app);
    const res = await fetchFeed(platform, app, token);
    expect(res.status).toBe(200);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const bad = [...bytes].filter((b) => (b < 0x20 && b !== 0x0d && b !== 0x0a) || b === 0x7f);
    expect(bad).toEqual([]);
    // Every CR is a line ending's, and so is every LF.
    const text = new TextDecoder().decode(bytes);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    // The visible text survives, with only the controls gone.
    expect(unfold(text)).toContain('SUMMARY:RingBellSohEscVtFfDel renews');
  });

  it('escapeText strips the forbidden controls first, and keeps HTAB and the line-break escape', () => {
    expect(escapeText('a\u0007b\u007fc\u0000d\u001fe')).toBe('abcde');
    expect(escapeText('a\tb')).toBe('a\tb');
    expect(escapeText('a\r\nb')).toBe('a\\nb');
    // Stripped BEFORE the escapes: a control between a backslash and a comma
    // cannot make either one disappear or double.
    expect(escapeText('\\\u0001,')).toBe('\\\\\\,');
  });
});

// ⏱ 2026-10-01 · rv2-services-020. RED before: the event printed `9.99` for a
// USD plan and an INR plan alike, though subscriptiontracker_db has stored the
// currency since its migration 0003.
describe('R2 — the amount carries its currency', () => {
  function modelDb(): RealDb {
    return new RealDb([appInit0001, appSchemaDebt0002, appModel0003]);
  }
  function seedPriced(app: RealDb, id: string, price: number, currency: string | null, priceMinor: number | null): void {
    app.db
      .prepare('INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal, currency, price_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, ALICE, `Plan ${id}`, price, 'monthly', '2099-05-01', currency, priceMinor);
  }

  it('🔴 a USD plan’s event says USD, a yen plan has no decimals, and a dinar has three', async () => {
    const platform = realPlatformDb();
    const app = modelDb();
    seedPriced(app, 'usd', 9.99, 'USD', 999);
    seedPriced(app, 'jpy', 1200, 'JPY', 1200);
    seedPriced(app, 'kwd', 3.5, 'KWD', 3500);
    const { token } = await mint(platform, app);
    const text = unfold(await (await fetchFeed(platform, app, token)).text());
    expect(text).toContain('DESCRIPTION:Renews monthly · Amount USD 9.99');
    expect(text).toContain('DESCRIPTION:Renews monthly · Amount JPY 1200');
    expect(text).toContain('DESCRIPTION:Renews monthly · Amount KWD 3.500');
  });

  it('a row with no currency (every row before 0003) keeps the bare amount — no guessed code', async () => {
    const platform = realPlatformDb();
    const app = modelDb();
    seedPriced(app, 'legacy', 12.5, null, null);
    const { token } = await mint(platform, app);
    const text = unfold(await (await fetchFeed(platform, app, token)).text());
    expect(text).toContain('DESCRIPTION:Renews monthly · Amount 12.50');
  });
});
