// ─────────────────────────────────────────────────────────────────────────────
// O-REMINDER-DAYS-JSON-READ-AS-NUMBER (rv2-services-001) — a subscription's OWN
// reminder leads reach both server-side reminder channels: the nightly e-mail
// digest and the calendar feed's alarms.
//
// subscriptiontracker-api writes `reminder_days` as JSON TEXT ('[7,1]', '[]',
// NULL); the platform read it as a number, so every value was dropped and the
// account lead was used for every subscription — an explicit '[]' ("no reminder
// for this one") was mailed and alarmed anyway.
//
// 🔴 WHY THE OTHER REMINDER SUITES NEVER SAW IT. reminder-mail.test.ts and
// calendar-feed.test.ts build subscriptiontracker_db from the app's FIRST TWO
// migrations, which predate the column, and no platform test seeded it. This file
// builds that database from EVERY migration in the app's directory, by glob, so
// the schema under test is the one that ships and a later migration arrives here
// without an edit.
//
// RED ON MAIN, GREEN AFTER: on the tree before this change the '[7]' renewal five
// days out is not mailed (the account lead is 3), '[]' is mailed and alarmed, and
// the feed carries one TRIGGER at the account lead whatever the list says.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import calendar from '../src/routes/calendar';
import { runReminderMail, addDays } from '../src/lib/reminders';
import { RESEND_EMAILS_URL } from '../src/lib/report-notify';
import { app as realApp } from '../src/index';
import type { AppEnv, Env } from '../src/types';
import { RealDb, realPlatformDb } from './harness';

const APP_MIGRATIONS = import.meta.glob('../../subscriptiontracker-api/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const APP = 'subscriptiontracker';
const AUTH = 'https://auth.example';
const NOW = Date.parse('2026-10-01T06:00:00Z');
const TODAY = '2026-10-01';
const DAY = 86_400_000;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** subscriptiontracker_db at the schema that ships: every migration, in order. */
function appDb(): RealDb {
  const names = Object.keys(APP_MIGRATIONS).sort();
  // Floor: 0003 is the migration that adds `reminder_days`. A glob that found
  // fewer would build a schema without the column and every test below would
  // grade the NULL path only.
  expect(names.some((n) => n.endsWith('/0003_subscription_model.sql'))).toBe(true);
  return new RealDb(names.map((n) => APP_MIGRATIONS[n]));
}

function seedPerson(platform: RealDb, userId: string, lead = 3, optIn = true): void {
  platform.db
    .prepare('INSERT INTO reminder_prefs (user_id, app_id, email_opt_in, lead_days, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, APP, optIn ? 1 : 0, lead, '2026-09-28T00:00:00Z');
}

/** A subscription whose `reminder_days` column holds `reminderDays` VERBATIM —
 *  the JSON text the API writes, or anything a hand edit left. */
function seedSub(app: RealDb, userId: string, id: string, name: string, nextRenewal: string, reminderDays: string | null): void {
  app.db
    .prepare('INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal, reminder_days) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, 9.99, 'yearly', nextRenewal, reminderDays);
}

/** The network: every account is confirmed; Resend accepts. Sends are recorded. */
function network() {
  const sends: Array<{ to: string; text: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === RESEND_EMAILS_URL) {
      const body = JSON.parse(String(init?.body)) as { to: string[]; text: string };
      sends.push({ to: body.to[0], text: body.text });
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200 });
    }
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(url);
    if (m) {
      const id = decodeURIComponent(m[1]);
      return new Response(JSON.stringify({ email: `${id}@example.com`, email_confirmed_at: '2026-01-01T00:00:00Z' }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { fetchImpl, sends };
}

function envOf(platform: RealDb, app: RealDb): Env {
  return {
    PLATFORM_DB: platform,
    SUBSCRIPTIONTRACKER_DB: app,
    RESEND_API_KEY: 're_test_key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SUPABASE_URL: AUTH,
  } as unknown as Env;
}

const target = (db: RealDb) => [{ appId: APP, db: db as unknown as D1Database }];

/** Who was mailed tonight, by user id. */
const mailed = (sends: Array<{ to: string }>) => sends.map((s) => s.to.replace(/@example\.com$/, '')).sort();

describe('the e-mail digest honours each subscription’s reminder_days', () => {
  it('🔴 [7] is mailed 5 days out under an account lead of 3; [] is NEVER mailed; NULL and a malformed value use the account lead', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people = ['u-own7', 'u-none', 'u-null', 'u-null-far', 'u-bad', 'u-bad-far', 'u-over30'];
    for (const p of people) seedPerson(platform, p, 3);
    seedSub(app, 'u-own7', 's-own7', 'Seven', addDays(TODAY, 5), '[7]'); // inside its own 7, outside the account 3
    seedSub(app, 'u-none', 's-none', 'None', addDays(TODAY, 1), '[]'); // explicit none, 1 day out
    seedSub(app, 'u-null', 's-null', 'Null', addDays(TODAY, 2), null); // account lead 3 → mailed
    seedSub(app, 'u-null-far', 's-null-far', 'NullFar', addDays(TODAY, 5), null); // account lead 3 → not yet
    seedSub(app, 'u-bad', 's-bad', 'Bad', addDays(TODAY, 2), 'not json'); // malformed → account lead → mailed
    seedSub(app, 'u-bad-far', 's-bad-far', 'BadFar', addDays(TODAY, 5), '[400]'); // out of contract → account lead → not yet
    seedSub(app, 'u-over30', 's-over30', 'Sixty', addDays(TODAY, 45), '[60]'); // past the account cap of 30, honoured

    const net = network();
    const rows = await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(rows[0].ok, rows[0].detail).toBe(true);
    expect(mailed(net.sends)).toEqual(['u-bad', 'u-null', 'u-over30', 'u-own7']);

    // The ledger names the lead each reminder was for: the account's keeps the
    // original kind, a subscription's own lead carries its days.
    const kinds = platform.db
      .prepare('SELECT subscription_id, kind FROM reminder_sent ORDER BY subscription_id')
      .all() as Array<{ subscription_id: string; kind: string }>;
    expect(kinds).toEqual([
      { subscription_id: 's-bad', kind: 'renewal' },
      { subscription_id: 's-null', kind: 'renewal' },
      { subscription_id: 's-over30', kind: 'renewal:60' },
      { subscription_id: 's-own7', kind: 'renewal:7' },
    ]);
  });

  it('🔴 [7,1] mails once entering the 7-day window, not again inside it, and once more entering the 1-day window', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedPerson(platform, 'u-two', 3);
    const due = addDays(TODAY, 7);
    seedSub(app, 'u-two', 's-two', 'Twice', due, '[7,1]');

    const nights: number[] = [];
    for (let n = 0; n <= 7; n++) {
      const net = network();
      await runReminderMail(envOf(platform, app), target(app), NOW + n * DAY, net.fetchImpl);
      nights.push(net.sends.length);
    }
    // Night 0 is 7 days out, night 6 is 1 day out, night 7 is the renewal day.
    expect(nights).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);
    const kinds = (platform.db.prepare('SELECT kind FROM reminder_sent ORDER BY kind').all() as Array<{ kind: string }>).map(
      (r) => r.kind,
    );
    expect(kinds).toEqual(['renewal:1', 'renewal:7']);
  });

  it('a list whose windows were all missed mails the NEAREST one once, not every missed one', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedPerson(platform, 'u-late', 3);
    seedSub(app, 'u-late', 's-late', 'Late', addDays(TODAY, 1), '[14,7,1]');
    const net = network();
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends).toHaveLength(1);
    expect(platform.db.prepare('SELECT kind FROM reminder_sent').all()).toEqual([{ kind: 'renewal:1' }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-30 · review of #1090, minor 1 — A WINDOW ALREADY MAILED IS COVERED,
// WHATEVER KIND CLAIMED IT. Keyed on the kind alone, the account-lead claim
// (`renewal`, every claim written before this change) did not cover the same
// window claimed as `renewal:<days>`: a subscription whose own list equals the
// account lead was mailed a second time the night after go-live, and a list
// switched on inside an already-mailed window mailed again. RED before the
// window rule, GREEN after.
// ─────────────────────────────────────────────────────────────────────────────
describe('a reminder window already mailed is not mailed again', () => {
  /** A claim as the job wrote it before per-subscription leads were read. */
  function legacyClaim(platform: RealDb, userId: string, subId: string, due: string, sentAtMs: number): void {
    platform.db
      .prepare(
        'INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, APP, subId, due, 'renewal', new Date(sentAtMs).toISOString(), `h-legacy-${subId}`);
  }

  it('🔴 own list [3] = account lead 3, mailed under `renewal` the night before go-live: EXACTLY ONE mail across the switch-over', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedPerson(platform, 'u-same', 3);
    const due = addDays(TODAY, 3);
    seedSub(app, 'u-same', 's-same', 'Same', due, '[3]');
    legacyClaim(platform, 'u-same', 's-same', due, NOW); // night 0: the pre-deploy job mailed it
    let sends = 0;
    for (let n = 1; n <= 3; n++) {
      const net = network();
      await runReminderMail(envOf(platform, app), target(app), NOW + n * DAY, net.fetchImpl);
      sends += net.sends.length;
    }
    expect(sends).toBe(0);
    expect(platform.db.prepare('SELECT kind FROM reminder_sent').all()).toEqual([{ kind: 'renewal' }]);
  });

  it('🔴 a list switched on mid-window sends no second mail for the same due date', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedPerson(platform, 'u-switch', 3);
    const due = addDays(TODAY, 3);
    seedSub(app, 'u-switch', 's-switch', 'Switch', due, null);
    const first = network();
    await runReminderMail(envOf(platform, app), target(app), NOW, first.fetchImpl);
    expect(first.sends).toHaveLength(1); // the account lead's window, claimed `renewal`

    // The person now chooses their own lead for it, inside the window just mailed.
    app.db.prepare('UPDATE subscriptions SET reminder_days = ? WHERE id = ?').run('[5]', 's-switch');
    let later = 0;
    for (let n = 1; n <= 3; n++) {
      const net = network();
      await runReminderMail(envOf(platform, app), target(app), NOW + n * DAY, net.fetchImpl);
      later += net.sends.length;
    }
    expect(later).toBe(0);
  });

  it('a NEARER lead in the list is still its own window: [7] mailed at 7 days out does not cover [7,1]’s 1-day reminder', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    seedPerson(platform, 'u-near', 3);
    const due = addDays(TODAY, 1);
    seedSub(app, 'u-near', 's-near', 'Near', due, '[7,1]');
    legacyClaim(platform, 'u-near', 's-near', due, NOW - 6 * DAY); // mailed 7 days out
    const net = network();
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends).toHaveLength(1);
  });
});

describe('the calendar feed carries one alarm per reminder_days entry', () => {
  /** Mint a feed through the REAL app's route and return its token. */
  async function mintFeed(platform: RealDb, app: RealDb, userId: string): Promise<string> {
    const a = new Hono<AppEnv>();
    a.use('*', async (c, next) => {
      c.set('userId', userId);
      c.set('requestId', 'test-reminder-days');
      await next();
    });
    a.route('/v1', calendar);
    const res = await a.request(
      'https://platform.nikatru.com/v1/calendar/feed',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: APP }) },
      { PLATFORM_DB: platform, SUBSCRIPTIONTRACKER_DB: app } as never,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { https_url: string };
    return /\/v1\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(body.https_url)![1];
  }

  /** Each VEVENT's unfolded text, keyed by its SUMMARY. */
  function events(ics: string): Map<string, string> {
    const text = ics.replace(/\r\n /g, '');
    const out = new Map<string, string>();
    for (const block of text.split('BEGIN:VEVENT').slice(1)) {
      const summary = /SUMMARY:(.*)\r\n/.exec(block)![1];
      out.set(summary, block);
    }
    return out;
  }

  it('🔴 [7,1] → TRIGGER -P7D and -P1D; [] → the event with NO alarm; NULL and malformed → the account lead', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const USER = 'u-cal-days';
    seedPerson(platform, USER, 3, false);
    seedSub(app, USER, 's-two', 'Two', '2099-01-10', '[7,1]');
    seedSub(app, USER, 's-none', 'None', '2099-01-11', '[]');
    seedSub(app, USER, 's-null', 'Null', '2099-01-12', null);
    seedSub(app, USER, 's-bad', 'Bad', '2099-01-13', '{"days":7}');
    seedSub(app, USER, 's-sixty', 'Sixty', '2099-01-14', '[60]');
    const token = await mintFeed(platform, app, USER);

    const res = await realApp.request(`https://platform.nikatru.com/v1/calendar/${token}.ics`, {}, {
      PLATFORM_DB: platform,
      SUBSCRIPTIONTRACKER_DB: app,
    } as never);
    expect(res.status).toBe(200);
    const byName = events(await res.text());
    const triggers = (name: string) => [...byName.get(`${name} renews`)!.matchAll(/TRIGGER:(\S+)/g)].map((m) => m[1]);
    expect(byName.size).toBe(5);
    expect(triggers('Two')).toEqual(['-P7D', '-P1D']);
    expect(triggers('None')).toEqual([]);
    expect(byName.get('None renews')).not.toContain('BEGIN:VALARM');
    expect(triggers('Null')).toEqual(['-P3D']);
    expect(triggers('Bad')).toEqual(['-P3D']);
    expect(triggers('Sixty')).toEqual(['-P60D']);
  });
});
