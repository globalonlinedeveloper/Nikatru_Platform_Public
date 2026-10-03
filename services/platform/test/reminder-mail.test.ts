// ─────────────────────────────────────────────────────────────────────────────
// ST-R1 — THE RENEWAL REMINDER DIGEST, through the real job over the real-SQL
// harness: platform_db with every migration, and subscriptiontracker_db with the
// app's own two. Only the network is a double — the identity provider's admin
// read and Resend's send — and every call to it is recorded, so "exactly one
// mail" is a count of real calls, not an inference from which branch ran.
//
// RED ON MAIN, GREEN AFTER: on the tree before this change there is no
// src/lib/reminders.ts, no REMINDER_MAIL_JOB and no reminder_* table, so this file
// fails at import.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import appInit0001 from '../../subscriptiontracker-api/migrations/0001_init.sql?raw';
import appSchemaDebt0002 from '../../subscriptiontracker-api/migrations/0002_schema_debt.sql?raw';
import appModel0003 from '../../subscriptiontracker-api/migrations/0003_subscription_model.sql?raw';
import appPrefs0008 from '../../subscriptiontracker-api/migrations/0008_preferences.sql?raw';
import REGISTER_RAW from '../../../tooling/ops/register.json?raw';
import INVENTORY_RAW from '../../../tooling/legal/data-inventory.json?raw';
import { REMINDER_MAIL_JOB, reminderMail } from '../src/scheduled';
import {
  MAX_ADDRESS_READS_PER_RUN,
  MAX_REMINDER_MAILS_PER_DAY,
  REMINDER_FROM,
  REMINDER_SENT_RETENTION_DAYS,
  addDays,
  appName,
  appUrl,
  buildDigest,
  runReminderMail,
  ymdOf,
} from '../src/lib/reminders';
import { RESEND_EMAILS_URL } from '../src/adapters/mail/resend';
import reminders, { MAX_PREFS_BODY_BYTES, parsePrefs } from '../src/routes/reminders';
import { app as realApp } from '../src/index';
import type { AppEnv, Env } from '../src/types';
import { RealDb, realPlatformDb } from './harness';
import { SUPPORTED_LOCALES, digestCopy, resolveLocale } from '../src/lib/digest-copy';
import EMAIL_RAW from '../../../tooling/i18n/messages/email.json?raw';

const APP = 'subscriptiontracker';
const AUTH = 'https://auth.example';
const NOW = Date.parse('2026-10-01T06:00:00Z');
const TODAY = '2026-10-01';

afterEach(() => vi.restoreAllMocks());

interface Person {
  id: string;
  optIn: boolean;
  lead?: number;
  email?: string;
  confirmed?: boolean;
}

function appDb(): RealDb {
  return new RealDb([appInit0001, appSchemaDebt0002]);
}

function seedPerson(platform: RealDb, p: Person): void {
  platform.db
    .prepare('INSERT INTO reminder_prefs (user_id, app_id, email_opt_in, lead_days, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(p.id, APP, p.optIn ? 1 : 0, p.lead ?? 3, '2026-09-28T00:00:00Z');
}

function seedSub(app: RealDb, userId: string, id: string, name: string, nextRenewal: string, cycle: string | null = 'monthly'): void {
  app.db
    .prepare('INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, 9.99, cycle, nextRenewal);
}

interface Call {
  url: string;
  body: Record<string, unknown> | null;
}

/** The network: the admin read answers from `people`, Resend answers `resendStatus`. */
function network(people: Person[], resendStatus = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    if (url === RESEND_EMAILS_URL) return new Response(JSON.stringify({ id: 'resend-1' }), { status: resendStatus });
    const m = /\/auth\/v1\/admin\/users\/([^/?]+)$/.exec(url);
    if (m) {
      const p = people.find((x) => x.id === decodeURIComponent(m[1]));
      if (!p) return new Response('{}', { status: 404 });
      return new Response(
        JSON.stringify({ email: p.email ?? `${p.id}@example.com`, email_confirmed_at: p.confirmed === false ? null : '2026-01-01T00:00:00Z' }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const sends = () => calls.filter((c) => c.url === RESEND_EMAILS_URL);
  const reads = () => calls.filter((c) => c.url.includes('/auth/v1/admin/users/'));
  return { fetchImpl, calls, sends, reads };
}

function envOf(platform: RealDb, app: RealDb | undefined, over: Partial<Record<string, unknown>> = {}): Env {
  return {
    PLATFORM_DB: platform,
    SUBSCRIPTIONTRACKER_DB: app,
    RESEND_API_KEY: 're_test_key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    SUPABASE_URL: AUTH,
    ...over,
  } as unknown as Env;
}

const target = (db: RealDb | undefined) => [{ appId: APP, db: db as unknown as D1Database }];

describe('R1 — the mail names the app from the catalogue', () => {
  // 🔴 The app catalogue is a top-level ARRAY. A reader that looked for an
  // `apps` key found nothing, and every digest fell back to the bare id and
  // the portfolio home page.
  it('reads the app its name and page from the catalogue, through lib/catalog.ts', () => {
    expect(appName('subscriptiontracker')).toBe('Nikatru Subscription Tracker');
    expect(appUrl('subscriptiontracker')).toBe('https://nikatru.com/subscriptiontracker');
    expect(appName('no-such-app')).toBe('no-such-app');
    expect(appUrl('no-such-app')).toBe('https://nikatru.com');
  });
});

describe('R1 — who gets a digest', () => {
  it('🔴 an opted-in person with a CONFIRMED address and a renewal inside the lead days gets EXACTLY ONE mail; the opted-out, the unconfirmed and the already-sent get none', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [
      { id: 'u-in', optIn: true, email: 'in@example.com' },
      { id: 'u-out', optIn: false },
      { id: 'u-unconfirmed', optIn: true, confirmed: false },
      { id: 'u-sent', optIn: true },
      { id: 'u-far', optIn: true },
    ];
    for (const p of people) seedPerson(platform, p);
    seedSub(app, 'u-in', 's-in', 'Netflix', '2026-10-03');
    seedSub(app, 'u-out', 's-out', 'Hulu', '2026-10-02');
    seedSub(app, 'u-unconfirmed', 's-unc', 'Spotify', '2026-10-02');
    seedSub(app, 'u-sent', 's-sent', 'Disney', '2026-10-02');
    seedSub(app, 'u-far', 's-far', 'Gym', '2026-10-20');
    platform.db
      .prepare(
        'INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('u-sent', APP, 's-sent', '2026-10-02', 'renewal', '2026-09-30T06:00:00.000Z', 'h-earlier');

    const net = network(people);
    const rows = await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);

    expect(net.sends()).toHaveLength(1);
    const body = net.sends()[0].body!;
    expect(body.from).toBe(REMINDER_FROM);
    expect(body.from).toBe('Nikatru reminders <reminders@mail.nikatru.com>');
    expect(body.to).toEqual(['in@example.com']);
    expect(String(body.subject)).toContain('Netflix');
    expect(String(body.text)).toContain('Netflix');
    const headers = body.headers as Record<string, string>;
    expect(headers['List-Unsubscribe']).toMatch(/^<https:\/\/platform\.nikatru\.com\/v1\/reminders\/unsubscribe\?t=[A-Za-z0-9_-]{43}>$/);
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // No address was read for the opted-out person, and none is stored anywhere.
    expect(net.reads().map((c) => c.url)).not.toContain(`${AUTH}/auth/v1/admin/users/u-out`);
    expect(JSON.stringify(platform.rows('SELECT * FROM reminder_sent'))).not.toContain('in@example.com');
    expect(platform.rows("SELECT subscription_id, due_on FROM reminder_sent WHERE user_id = 'u-in'")).toEqual([
      { subscription_id: 's-in', due_on: '2026-10-03' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ target: APP, ok: true });
    expect(rows[0].detail).toMatch(/^sent=1 deferred=0 unconfirmed=1 errors=0 opted_in=4 due=2 /);
  });

  it('🔴 a second run the same night mails NOBODY — the claim in reminder_sent is what stops it', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-in', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-in', 's-in', 'Netflix', '2026-10-02');
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    await runReminderMail(envOf(platform, app), target(app), NOW + 60_000, net.fetchImpl);
    expect(net.sends()).toHaveLength(1);
  });

  it('🔴 a run that claims the same renewal FIRST wins — the loser sends nothing, even though its own read said "not yet sent"', async () => {
    // Isolates the CLAIM from the pre-read: the conflicting row lands while the
    // address is being read, i.e. after this run built its digest and before it
    // claims — exactly an overlapping firing. Only the UNIQUE claim can stop it.
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-race', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-race', 's-race', 'Netflix', '2026-10-02');
    const net = network(people);
    const racing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/auth/v1/admin/users/')) {
        platform.db
          .prepare(
            'INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run('u-race', APP, 's-race', '2026-10-02', 'renewal', '2026-10-01T06:00:00.000Z', 'h-other-run');
      }
      return net.fetchImpl(input, init);
    }) as typeof fetch;
    const [row] = await runReminderMail(envOf(platform, app), target(app), NOW, racing);
    expect(net.sends()).toHaveLength(0);
    expect(row.ok).toBe(true);
    expect(platform.rows('SELECT unsubscribe_hash FROM reminder_sent')).toEqual([{ unsubscribe_hash: 'h-other-run' }]);
  });

  it('the per-subscription lead is the person’s lead today — a renewal past it is not mailed yet', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-lead7', optIn: true, lead: 7 }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-lead7', 's-6', 'SixDays', addDays(TODAY, 6));
    seedSub(app, 'u-lead7', 's-8', 'EightDays', addDays(TODAY, 8));
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends()).toHaveLength(1);
    expect(String(net.sends()[0].body!.text)).toContain('SixDays');
    expect(String(net.sends()[0].body!.text)).not.toContain('EightDays');
  });

  it('a stored date the renewals pass has not advanced yet is mailed on the date advance() gives — Jan 31 → Feb 28', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-31', optIn: true, lead: 3 }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-31', 's-31', 'MonthEnd', '2027-01-31');
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), Date.parse('2027-02-26T06:00:00Z'), net.fetchImpl);
    expect(net.sends()).toHaveLength(1);
    expect(platform.rows("SELECT due_on FROM reminder_sent WHERE user_id = 'u-31'")).toEqual([{ due_on: '2027-02-28' }]);
  });
});

describe('R1 — the daily cap', () => {
  it('🔴 over the cap, mails WAIT for the next night, oldest first — nothing is dropped and nothing is sent twice', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const n = MAX_REMINDER_MAILS_PER_DAY + 2;
    expect(n).toBeLessThanOrEqual(MAX_ADDRESS_READS_PER_RUN);
    const people: Person[] = [];
    for (let i = 0; i < n; i++) {
      // Everyone renews in 3 days; person i chose a lead of (3 + i) days, so
      // person 0's window opened LAST and person n-1's FIRST. Oldest first means
      // the two whose window opened latest — u-00 and u-01 — are the ones that wait.
      const p: Person = { id: `u-${String(i).padStart(2, '0')}`, optIn: true, lead: Math.min(3 + i, 30) };
      people.push(p);
      seedPerson(platform, p);
      seedSub(app, p.id, `s-${i}`, `Sub ${i}`, addDays(TODAY, 3));
    }
    const net = network(people);
    const [row] = await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends()).toHaveLength(MAX_REMINDER_MAILS_PER_DAY);
    expect(row.detail).toContain(`deferred=2`);
    expect(row.detail).toContain(`sent_today=${MAX_REMINDER_MAILS_PER_DAY}/${MAX_REMINDER_MAILS_PER_DAY}`);
    expect(row.ok).toBe(true);
    // The two whose window opened LATEST (leads 3 and 4: u-00 and u-01) waited.
    const mailed = new Set(platform.rows('SELECT DISTINCT user_id FROM reminder_sent').map((r) => String(r.user_id)));
    expect(mailed.has('u-00')).toBe(false);
    expect(mailed.has('u-01')).toBe(false);
    expect(mailed.size).toBe(MAX_REMINDER_MAILS_PER_DAY);

    // A second run the SAME day sends nothing: the cap is counted from the ledger.
    const again = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW + 3_600_000, again.fetchImpl);
    expect(again.sends()).toHaveLength(0);

    // The next night the two that waited are mailed, and only they.
    const next = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW + 86_400_000, next.fetchImpl);
    expect(next.sends().map((c) => (c.body!.to as string[])[0]).sort()).toEqual(['u-00@example.com', 'u-01@example.com']);
  });
});

describe('R1 — every outcome writes a heartbeat row', () => {
  function heartbeats(db: RealDb) {
    return db.rows('SELECT job, target, ok, detail FROM cron_heartbeat ORDER BY target');
  }

  it('🔴 the job writes its row under REMINDER_MAIL_JOB — `reminder_mail`', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-in', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-in', 's-in', 'Netflix', '2026-10-02');
    await reminderMail(envOf(platform, app), NOW, network(people).fetchImpl);
    expect(REMINDER_MAIL_JOB).toBe('reminder_mail');
    expect(heartbeats(platform)).toEqual([
      expect.objectContaining({ job: 'reminder_mail', target: APP, ok: 1, detail: expect.stringMatching(/^sent=1 /) }),
    ]);
  });

  it('"nothing due" is ok, with its own detail', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    await reminderMail(envOf(platform, app), NOW, network([]).fetchImpl);
    expect(heartbeats(platform)).toEqual([
      expect.objectContaining({ job: 'reminder_mail', target: APP, ok: 1, detail: 'nothing due: opted_in=0 due=0 pruned=0' }),
    ]);
  });

  it('opted in with nothing inside the lead days is ok too, and says how many were looked at', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-in', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-in', 's-in', 'Netflix', '2026-11-20');
    const [row] = await runReminderMail(envOf(platform, app), target(app), NOW, network(people).fetchImpl);
    expect(row).toEqual({ target: APP, ok: true, detail: 'nothing due: opted_in=1 due=0 pruned=0' });
  });

  it('🔴 a missing RESEND_API_KEY is ok=0 naming the key — and nothing is read or sent', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const net = network([]);
    const [row] = await runReminderMail(envOf(platform, app, { RESEND_API_KEY: undefined }), target(app), NOW, net.fetchImpl);
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('not configured: RESEND_API_KEY');
    expect(net.calls).toHaveLength(0);
  });

  it('a missing SUPABASE_SERVICE_ROLE_KEY is ok=0 naming the key', async () => {
    const platform = realPlatformDb();
    const [row] = await runReminderMail(envOf(platform, appDb(), { SUPABASE_SERVICE_ROLE_KEY: undefined }), target(appDb()), NOW, network([]).fetchImpl);
    expect(row).toMatchObject({ ok: false, detail: expect.stringContaining('SUPABASE_SERVICE_ROLE_KEY') });
  });

  it('🔴 no targets is ok=0 with the reason, never an empty success', async () => {
    const rows = await runReminderMail(envOf(realPlatformDb(), appDb()), [], NOW, network([]).fetchImpl);
    expect(rows).toEqual([{ target: '(none)', ok: false, detail: 'no app targets configured' }]);
  });

  it('a missing app database binding is ok=0, not "nothing due"', async () => {
    const rows = await runReminderMail(envOf(realPlatformDb(), undefined), target(undefined), NOW, network([]).fetchImpl);
    expect(rows).toEqual([{ target: APP, ok: false, detail: 'no database binding for this app' }]);
  });

  it('🔴 a send Resend refuses is ok=0, and its claim is RELEASED so the next night tries again', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-in', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-in', 's-in', 'Netflix', '2026-10-02');
    const [row] = await runReminderMail(envOf(platform, app), target(app), NOW, network(people, 500).fetchImpl);
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('Resend answered 500');
    expect(platform.count('reminder_sent')).toBe(0);
    const retry = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW + 86_400_000, retry.fetchImpl);
    expect(retry.sends()).toHaveLength(1);
  });
});

describe('R1 — a send that may have been delivered is never repeated', () => {
  it('🔴 a send that TIMES OUT keeps its claim: ok=0 now, and the next night does not mail that renewal again', async () => {
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-slow', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-slow', 's-slow', 'Netflix', '2026-10-02');
    const net = network(people);
    const timingOut = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === RESEND_EMAILS_URL) {
        await net.fetchImpl(input, init);
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      }
      return net.fetchImpl(input, init);
    }) as typeof fetch;
    const [row] = await runReminderMail(envOf(platform, app), target(app), NOW, timingOut);
    expect(row.ok).toBe(false);
    expect(row.detail).toContain('Resend not reached');
    expect(platform.count('reminder_sent')).toBe(1);
    const next = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW + 86_400_000, next.fetchImpl);
    expect(next.sends()).toHaveLength(0);
  });
});

describe('R1 — the sent ledger is pruned, and the period has one value everywhere', () => {
  it('a row older than REMINDER_SENT_RETENTION_DAYS past its date goes; one a day inside it stays', async () => {
    const platform = realPlatformDb();
    const ins = platform.db.prepare(
      'INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run('u', APP, 's-old', addDays(TODAY, -(REMINDER_SENT_RETENTION_DAYS + 1)), 'renewal', '2025-01-01T00:00:00Z', 'h1');
    ins.run('u', APP, 's-kept', addDays(TODAY, -(REMINDER_SENT_RETENTION_DAYS - 1)), 'renewal', '2025-01-01T00:00:00Z', 'h2');
    const [row] = await runReminderMail(envOf(platform, appDb()), target(appDb()), NOW, network([]).fetchImpl);
    expect(platform.rows('SELECT subscription_id FROM reminder_sent')).toEqual([{ subscription_id: 's-kept' }]);
    expect(row.detail).toContain('pruned=1');
  });

  it('the register and the inventory carry the code’s period, and name this job as the deleter', () => {
    const reg = JSON.parse(REGISTER_RAW) as { rows: Array<Record<string, unknown>> };
    const r = reg.rows.find((x) => x.id === 'retention.d1.platform_db.reminder_sent')!;
    expect(r.rule).toBe('period');
    expect(r.periodDays).toBe(REMINDER_SENT_RETENTION_DAYS);
    expect(String(r.deletingJob)).toContain(REMINDER_MAIL_JOB);
    const inv = JSON.parse(INVENTORY_RAW) as { stores: Array<{ id: string; retention?: { periodDays?: number } }> };
    expect(inv.stores.find((s) => s.id === 'table:platform_db.reminder_sent')?.retention?.periodDays).toBe(REMINDER_SENT_RETENTION_DAYS);
  });
});

describe('R1 — the preference and the one-click unsubscribe', () => {
  function appFor(userId: string) {
    const a = new Hono<AppEnv>();
    a.use('*', async (c, next) => {
      c.set('userId', userId);
      c.set('requestId', 'test-reminders');
      await next();
    });
    a.route('/v1', reminders);
    return a;
  }

  it('GET answers the default for a person with no row: not opted in, three days', async () => {
    const platform = realPlatformDb();
    const res = await appFor('u-new').request(`http://x/v1/reminders/prefs?app_id=${APP}`, {}, { PLATFORM_DB: platform } as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ app_id: APP, email_opt_in: false, lead_days: 3 });
  });

  it('PUT stores the preference for the CALLER, and an absent lead keeps the stored one', async () => {
    const platform = realPlatformDb();
    const put = (body: unknown) =>
      appFor('u-put').request(
        'http://x/v1/reminders/prefs',
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
        { PLATFORM_DB: platform } as never,
      );
    expect((await put({ app_id: APP, email_opt_in: true, lead_days: 7 })).status).toBe(200);
    const res = await put({ app_id: APP, email_opt_in: false });
    expect(await res.json()).toEqual({ app_id: APP, email_opt_in: false, lead_days: 7 });
    expect(platform.rows('SELECT user_id, app_id, email_opt_in, lead_days FROM reminder_prefs')).toEqual([
      { user_id: 'u-put', app_id: APP, email_opt_in: 0, lead_days: 7 },
    ]);
  });

  it('the body is validated: an unknown app 404s, a lead outside 0-30 400s', () => {
    expect(parsePrefs({ app_id: 'nope', email_opt_in: true })).toMatchObject({ ok: false, status: 404 });
    expect(parsePrefs({ app_id: APP, email_opt_in: 'yes' })).toMatchObject({ ok: false, status: 400 });
    expect(parsePrefs({ app_id: APP, email_opt_in: true, lead_days: 31 })).toMatchObject({ ok: false, error: 'invalid_lead_days' });
    expect(parsePrefs({ app_id: APP, email_opt_in: true, lead_days: 0 })).toMatchObject({ ok: true, leadDays: 0 });
  });

  it('🔴 the preference is behind auth on the REAL app, and the unsubscribe is not', async () => {
    const env = { PLATFORM_DB: realPlatformDb(), SUPABASE_URL: AUTH } as never;
    expect((await realApp.request(`http://x/v1/reminders/prefs?app_id=${APP}`, {}, env)).status).toBe(401);
    expect((await realApp.request(`http://x/v1/reminders/unsubscribe?t=${'A'.repeat(43)}`, {}, env)).status).toBe(404);
  });

  it('🔴 the mail’s own List-Unsubscribe URL opts the person out on POST — and a GET changes nothing', async () => {
    // ONE CLOCK: this case drives the real routes, which stamp from the wall
    // clock, so the job runs at the wall clock too (tooling/ci/assert-test-clock-mix.mjs).
    const now = Date.now();
    const platform = realPlatformDb();
    const app = appDb();
    const people: Person[] = [{ id: 'u-in', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-in', 's-in', 'Netflix', addDays(ymdOf(now), 1));
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), now, net.fetchImpl);
    const link = /^<(.+)>$/.exec((net.sends()[0].body!.headers as Record<string, string>)['List-Unsubscribe'])![1];
    const path = new URL(link).pathname + new URL(link).search;
    const env = { PLATFORM_DB: platform } as never;

    const get = await realApp.request(`http://x${path}`, {}, env);
    expect(get.status).toBe(200);
    expect(get.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(platform.rows("SELECT email_opt_in FROM reminder_prefs WHERE user_id = 'u-in'")).toEqual([{ email_opt_in: 1 }]);

    const post = await realApp.request(
      `http://x${path}`,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' },
      env,
    );
    expect(post.status).toBe(200);
    expect(platform.rows("SELECT email_opt_in FROM reminder_prefs WHERE user_id = 'u-in'")).toEqual([{ email_opt_in: 0 }]);

    // …and the next night mails nobody.
    const next = network(people);
    await runReminderMail(envOf(platform, app), target(app), now + 86_400_000, next.fetchImpl);
    expect(next.sends()).toHaveLength(0);

    // A token nobody minted is a 404, on both methods.
    const bogus = `/v1/reminders/unsubscribe?t=${'B'.repeat(43)}`;
    expect((await realApp.request(`http://x${bogus}`, { method: 'POST' }, env)).status).toBe(404);
  });
});

// ⏱ 2026-10-01 · rv2-services-020. RED before: the digest line printed `9.99`
// for every currency alike, under a comment saying the currency was not stored —
// stale since subscriptiontracker_db's migration 0003 added `currency` and
// `price_minor`.
describe('R1 — the digest prints each amount with its currency', () => {
  function modelDb(): RealDb {
    return new RealDb([appInit0001, appSchemaDebt0002, appModel0003]);
  }

  it('🔴 a USD plan’s digest line carries USD, from the exact minor amount', async () => {
    const platform = realPlatformDb();
    const app = modelDb();
    const people: Person[] = [{ id: 'u-usd', optIn: true }];
    seedPerson(platform, people[0]);
    app.db
      .prepare('INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal, currency, price_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('s-usd', 'u-usd', 'Netflix', 15.49, 'monthly', '2026-10-03', 'USD', 1549);
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends()).toHaveLength(1);
    const body = net.sends()[0].body!;
    expect(String(body.text)).toContain('- Netflix — Sat, 3 Oct 2026 (monthly, USD 15.49)');
    expect(String(body.html)).toContain('<li>Netflix — Sat, 3 Oct 2026 (monthly, USD 15.49)</li>');
  });

  it('a yen plan has no decimals; a row with no currency keeps the bare amount, never a guessed code', async () => {
    const platform = realPlatformDb();
    const app = modelDb();
    const people: Person[] = [{ id: 'u-mix', optIn: true }];
    seedPerson(platform, people[0]);
    const ins = app.db.prepare(
      'INSERT INTO subscriptions (id, user_id, name, price, cycle, next_renewal, currency, price_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run('s-jpy', 'u-mix', 'Anime', 1200, 'monthly', '2026-10-02', 'JPY', 1200);
    ins.run('s-old', 'u-mix', 'Legacy', 9.99, 'monthly', '2026-10-03', null, null);
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    const text = String(net.sends()[0].body!.text);
    expect(text).toContain('- Anime — Fri, 2 Oct 2026 (monthly, JPY 1200)');
    expect(text).toContain('- Legacy — Sat, 3 Oct 2026 (monthly, 9.99)');
  });
});

// ⏱ 2026-10-02 · lane i18n-pipeline (item 5). RED before: the digest was English
// string literals whatever the person had chosen; the platform Worker never read
// the stored `locale` preference.
describe('R1 — the digest speaks the person\u2019s stored language', () => {
  function prefsDb(): RealDb {
    return new RealDb([appInit0001, appSchemaDebt0002, appModel0003, appPrefs0008]);
  }
  function seedLocale(app: RealDb, userId: string, locale: string): void {
    app.db
      .prepare('INSERT INTO preferences (user_id, key, value, version, updated_at) VALUES (?, ?, ?, 1, ?)')
      .run(userId, 'locale', JSON.stringify(locale), '2026-10-01T00:00:00Z');
  }
  async function digestFor(locale: string | null, db: () => RealDb = prefsDb) {
    const platform = realPlatformDb();
    const app = db();
    const people: Person[] = [{ id: 'u-l', optIn: true }];
    seedPerson(platform, people[0]);
    seedSub(app, 'u-l', 's-l', 'Netflix', '2026-10-03');
    if (locale !== null) seedLocale(app, 'u-l', locale);
    const net = network(people);
    await runReminderMail(envOf(platform, app), target(app), NOW, net.fetchImpl);
    expect(net.sends()).toHaveLength(1);
    return net.sends()[0].body!;
  }

  it('🔴 a Tamil preference gets the Tamil digest — subject, intro, cycle word and date', async () => {
    const body = await digestFor('ta');
    const ta = digestCopy('ta');
    expect(String(body.text)).toContain(ta.intro);
    expect(String(body.text)).toContain(ta.cycle.monthly);
    expect(String(body.subject)).toContain('Netflix');
    expect(String(body.subject)).not.toContain('renews on');
    expect(String(body.html)).toContain(ta.stop);
    expect(String(body.text)).not.toContain('These subscriptions renew soon');
  });

  it('🔴 a Hindi preference gets the Hindi digest', async () => {
    const body = await digestFor('hi');
    expect(String(body.text)).toContain(digestCopy('hi').intro);
    expect(String(body.text)).not.toContain('These subscriptions renew soon');
  });

  it('no preference, "follow the device", an unsupported tag, or no preferences table: English, unchanged', async () => {
    for (const body of [
      await digestFor(null),
      await digestFor(''),
      await digestFor('fr'),
      await digestFor(null, appDb),
    ]) {
      expect(String(body.subject)).toBe('Netflix renews on Sat, 3 Oct 2026');
      expect(String(body.text)).toContain('These subscriptions renew soon:\n\n- Netflix — Sat, 3 Oct 2026 (monthly, 9.99)');
    }
  });

  it('a regional tag resolves to its language; every supported locale has a digest block', () => {
    expect(resolveLocale('ta-IN')).toBe('ta');
    expect(resolveLocale('hi_IN')).toBe('hi');
    expect(resolveLocale('xx')).toBe('en');
    const digest = (JSON.parse(EMAIL_RAW) as { digest: Record<string, unknown> }).digest;
    for (const code of SUPPORTED_LOCALES) expect(Object.keys(digest)).toContain(code);
  });

  it('a key missing from a locale falls back to English, never to an empty line', () => {
    const d = buildDigest(APP, [
      { subscriptionId: 's', name: 'X', dueOn: '2026-10-03', cycle: 'fortnightly', price: null, currency: null, priceMinor: null, lead: 3, kind: 'renewal' },
    ], 'https://u', 'ta');
    expect(d.locale).toBe('ta');
    expect(d.text).toContain('(fortnightly)'); // no Tamil word for it: the stored value, as before
    expect(d.text).not.toMatch(/\{\w+\}/); // every placeholder filled
  });
});

// ⏱ 2026-10-01 · rv2-services-017. The preference's refusals, each asserted to
// write nothing — the 401 through the REAL app, where platformAuth lives.
describe('R1 — PUT /v1/reminders/prefs refuses, and writes nothing', () => {
  function appFor(userId: string) {
    const a = new Hono<AppEnv>();
    a.use('*', async (c, next) => {
      c.set('userId', userId);
      c.set('requestId', 'test-reminders');
      await next();
    });
    a.route('/v1', reminders);
    return a;
  }
  const put = (body: string) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
  const GOOD = JSON.stringify({ app_id: APP, email_opt_in: true, lead_days: 5 });

  it('🔴 no Authorization on the REAL app is a 401, and no reminder_prefs row', async () => {
    const platform = realPlatformDb();
    const res = await realApp.request('http://x/v1/reminders/prefs', put(GOOD), { PLATFORM_DB: platform, SUPABASE_URL: AUTH } as never);
    expect(res.status).toBe(401);
    expect(platform.count('reminder_prefs')).toBe(0);
    expect(platform.sql.filter((q) => q.includes('reminder_prefs'))).toEqual([]);
  });

  it('🔴 a body over MAX_PREFS_BODY_BYTES is a 413 before it is parsed, and no row', async () => {
    const platform = realPlatformDb();
    const big = JSON.stringify({ app_id: APP, email_opt_in: true, pad: 'x'.repeat(MAX_PREFS_BODY_BYTES) });
    const res = await appFor('u-big').request('http://x/v1/reminders/prefs', put(big), { PLATFORM_DB: platform } as never);
    expect(res.status).toBe(413);
    expect(platform.count('reminder_prefs')).toBe(0);
  });

  it('🔴 a limiter that says no is a 429 on the caller’s key, and no row', async () => {
    const platform = realPlatformDb();
    const keys: string[] = [];
    const EVENTS_LIMITER = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    };
    const res = await appFor('u-burst').request('http://x/v1/reminders/prefs', put(GOOD), { PLATFORM_DB: platform, EVENTS_LIMITER } as never);
    expect(res.status).toBe(429);
    expect(keys).toEqual(['reminders:u-burst']);
    expect(platform.count('reminder_prefs')).toBe(0);
  });
});
