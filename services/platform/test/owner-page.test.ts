import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { boxaReachability, boxbReachability, opsWatchdogJob, BOXA_REACH_JOB, BOXB_REACH_JOB, OPS_WATCHDOG_JOB } from '../src/scheduled';
import { OWNER_PAGED_MARK, OWNER_PAGE_TO, withPagedMark } from '../src/lib/owner-page';
import { RESEND_EMAILS_URL } from '../src/adapters/mail/resend';
import { MAIL_FROM, SUPPORT_EMAIL } from '../src/generated/entity';
import { gradeOpsWatchFreshness, OPS_WATCH_FRESHNESS_TARGET, OPS_WATCH_MAX_AGE_HOURS } from '../src/ops-watchdog';
import ownerPageSource from '../src/lib/owner-page.ts?raw';
import { realPlatformDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · PB-02 / PB-10 — THE PAGE THAT DOES NOT LEAVE FROM BOX B.
//
// What these cases pin, through the REAL limbs and a real platform_db:
//   · one ok=0 reachability row sends NO mail; two consecutive send ONE;
//   · a third, fourth… of the same streak sends nothing more, and carries the mark;
//   · a recovery ends the streak, so the next outage pages again;
//   · a send that did not go out leaves no mark, so the next firing retries;
//   · Box A's "not configured" row is not an outage and never pages;
//   · the recipient is the entity's support inbox, the From the `reports`
//     stream's, and the module holds no address literal;
//   · the ops-watch freshness row pages on ONE firing, once per streak.
// No real mail is sent: every Resend call lands in the fetch double.
// ─────────────────────────────────────────────────────────────────────────────

const KEY = 're_SECRET-RESEND-KEY';
const T0 = Date.parse('2026-10-01T00:00:00Z');
const SIX_HOURS = 6 * 3_600_000;
/** ⏱ 2026-10-02 · the addresses are entity facts (src/generated/entity.ts), sent through the mail port. */
const ENTITY = { to: SUPPORT_EMAIL, from: MAIL_FROM.reports };

type Sent = { to: string[]; from: string; subject: string; text: string };

/** Reachability targets answer `status[target]`; Resend answers `resend`. */
function double(status: Record<string, number>, resend: () => Response = () => new Response(JSON.stringify({ id: 'resend-fixture-id' }), { status: 200 })) {
  const sent: Sent[] = [];
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === RESEND_EMAILS_URL) {
      sent.push(JSON.parse(String(init?.body)) as Sent);
      return resend();
    }
    const code = status[url];
    if (code === undefined) throw new Error(`unexpected fetch ${url}`);
    if (code === 0) throw new Error('connect ETIMEDOUT');
    return new Response('', { status: code });
  });
  vi.stubGlobal('fetch', f);
  return { f, sent };
}

let firing = 0;
/** Each call is the next 6-hourly firing, so `ran_at` moves the way it does in production. */
function nextFiring() {
  vi.setSystemTime(T0 + firing * SIX_HOURS);
  firing += 1;
}

const rowsOf = (db: ReturnType<typeof realPlatformDb>, job: string) =>
  db.rows('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ? ORDER BY ran_at, target', job) as { target: string; ok: number; detail: string }[];

beforeEach(() => {
  firing = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the recipient is the entity\'s, never a literal', () => {
  it('pages the published support inbox, from the entity source', () => {
    expect(OWNER_PAGE_TO).toBe(SUPPORT_EMAIL);
  });

  it('🔴 the module carries no address literal - the entity source is the one home', () => {
    expect(ownerPageSource).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
  });

  it('🔴 the module sends through the mail port, never a carrier URL of its own', () => {
    expect(ownerPageSource).toMatch(/mailFor\('reports'/);
    expect(ownerPageSource).not.toMatch(/https:\/\//);
  });

  it('the mark lands where the 200-character slice keeps it', () => {
    expect(withPagedMark('HTTP 530 - x')).toBe(`${OWNER_PAGED_MARK} HTTP 530 - x`);
    expect(withPagedMark('FINDING: y')).toBe(`FINDING: ${OWNER_PAGED_MARK} y`);
    expect(withPagedMark(withPagedMark('z'))).toBe(withPagedMark('z'));
  });
});

describe('🔴 Box B: two consecutive ok=0 firings send ONE mail; one sends none', () => {
  const URL_B = 'https://boxb-a.test/';
  const envFor = (db: ReturnType<typeof realPlatformDb>, extra: Partial<Env> = {}) =>
    ({ PLATFORM_DB: db, BOXB_REACH_URLS: URL_B, RESEND_API_KEY: KEY, ...extra }) as unknown as Env;

  it('one ok=0 row sends none', async () => {
    const db = realPlatformDb();
    const { sent } = double({ [URL_B]: 530 });
    nextFiring();
    await boxbReachability(envFor(db));
    expect(sent).toHaveLength(0);
    expect(rowsOf(db, BOXB_REACH_JOB)).toEqual([{ target: URL_B, ok: 0, detail: 'HTTP 530 - Cloudflare edge could not reach the origin' }]);
  });

  it('two ok=0 rows send one mail, to the entity\'s recipient, and the row carries the mark', async () => {
    const db = realPlatformDb();
    const { sent } = double({ [URL_B]: 530 });
    nextFiring();
    await boxbReachability(envFor(db));
    nextFiring();
    await boxbReachability(envFor(db));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([ENTITY.to]);
    expect(sent[0].from).toBe(ENTITY.from);
    expect(sent[0].subject).toMatch(/Box B unreachable from Cloudflare on two consecutive firings/);
    expect(sent[0].text).toContain(URL_B);
    expect(JSON.stringify(sent)).not.toContain(KEY);
    const rows = rowsOf(db, BOXB_REACH_JOB);
    expect(rows.map((r) => r.ok)).toEqual([0, 0]);
    expect(rows[0].detail).not.toContain(OWNER_PAGED_MARK);
    expect(rows[1].detail.startsWith(OWNER_PAGED_MARK)).toBe(true);
  });

  it('a long outage mails ONCE; a recovery ends the streak, and the next outage pages again', async () => {
    const db = realPlatformDb();
    const status = { [URL_B]: 530 };
    const { sent } = double(status);
    for (let i = 0; i < 5; i++) {
      nextFiring();
      await boxbReachability(envFor(db));
    }
    expect(sent).toHaveLength(1);
    expect(rowsOf(db, BOXB_REACH_JOB).slice(1).every((r) => r.detail.includes(OWNER_PAGED_MARK))).toBe(true);
    status[URL_B] = 200;
    nextFiring();
    await boxbReachability(envFor(db));
    status[URL_B] = 0; // a transport failure this time
    nextFiring();
    await boxbReachability(envFor(db));
    expect(sent).toHaveLength(1);
    nextFiring();
    await boxbReachability(envFor(db));
    expect(sent).toHaveLength(2);
  });

  it('several hosts down at once are ONE mail naming each', async () => {
    const db = realPlatformDb();
    const hosts = ['https://boxb-a.test/', 'https://boxb-b.test/', 'https://boxb-c.test/'];
    const { sent } = double(Object.fromEntries(hosts.map((h) => [h, 530])));
    for (let i = 0; i < 2; i++) {
      nextFiring();
      await boxbReachability(envFor(db, { BOXB_REACH_URLS: hosts.join(',') } as Partial<Env>));
    }
    expect(sent).toHaveLength(1);
    for (const h of hosts) expect(sent[0].text).toContain(h);
  });

  it('a send Resend refuses leaves no mark, so the next firing tries again', async () => {
    const db = realPlatformDb();
    let answer = 500;
    const { sent } = double({ [URL_B]: 530 }, () => new Response('{}', { status: answer }));
    for (let i = 0; i < 2; i++) {
      nextFiring();
      await boxbReachability(envFor(db));
    }
    expect(sent).toHaveLength(1);
    expect(rowsOf(db, BOXB_REACH_JOB).some((r) => r.detail.includes(OWNER_PAGED_MARK))).toBe(false);
    answer = 200;
    nextFiring();
    await boxbReachability(envFor(db));
    expect(sent).toHaveLength(2);
    expect(rowsOf(db, BOXB_REACH_JOB).at(-1)?.detail.startsWith(OWNER_PAGED_MARK)).toBe(true);
  });

  it('without RESEND_API_KEY nothing is sent, the row still lands, and nothing is marked', async () => {
    const db = realPlatformDb();
    const { sent, f } = double({ [URL_B]: 530 });
    for (let i = 0; i < 2; i++) {
      nextFiring();
      await boxbReachability(envFor(db, { RESEND_API_KEY: undefined }));
    }
    expect(sent).toHaveLength(0);
    expect(f.mock.calls.filter(([u]) => String(u) === RESEND_EMAILS_URL)).toHaveLength(0);
    expect(rowsOf(db, BOXB_REACH_JOB).map((r) => r.ok)).toEqual([0, 0]);
    expect(rowsOf(db, BOXB_REACH_JOB).some((r) => r.detail.includes(OWNER_PAGED_MARK))).toBe(false);
  });
});

describe('Box A (BOXA_REACH_URLS): the same rule, and "not configured" is not an outage', () => {
  const URL_A = 'https://boxa-a.test/';

  it('two consecutive ok=0 firings send one mail', async () => {
    const db = realPlatformDb();
    const { sent } = double({ [URL_A]: 522 });
    for (let i = 0; i < 2; i++) {
      nextFiring();
      await boxaReachability({ PLATFORM_DB: db, BOXA_REACH_URLS: URL_A, RESEND_API_KEY: KEY } as unknown as Env);
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/BOXA_REACH_URLS hosts unreachable/);
    expect(rowsOf(db, BOXA_REACH_JOB).at(-1)?.detail.startsWith(OWNER_PAGED_MARK)).toBe(true);
  });

  it('🔴 an unset BOXA_REACH_URLS is ok=0 on every firing and pages NOBODY', async () => {
    const db = realPlatformDb();
    const { sent } = double({});
    for (let i = 0; i < 3; i++) {
      nextFiring();
      await boxaReachability({ PLATFORM_DB: db, RESEND_API_KEY: KEY } as unknown as Env);
    }
    expect(sent).toHaveLength(0);
    expect(rowsOf(db, BOXA_REACH_JOB).map((r) => [r.target, r.ok])).toEqual([['(none)', 0], ['(none)', 0], ['(none)', 0]]);
  });
});

describe('PB-10: the ops-watch freshness row pages on ONE firing, once per streak', () => {
  const NOW = Date.parse('2026-10-01T12:00:10Z');
  const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

  it('grades a run inside the ceiling ok with no page, and one past it as a FINDING that asks for a page', () => {
    const fresh = gradeOpsWatchFreshness({ id: 7, status: 'completed', updated_at: hoursAgo(5.9) }, NOW);
    expect(fresh).toMatchObject({ target: OPS_WATCH_FRESHNESS_TARGET, ok: true });
    expect(fresh.page).toBeUndefined();
    expect(fresh.detail).not.toMatch(/^FINDING: /);
    const stale = gradeOpsWatchFreshness({ id: 7, status: 'completed', updated_at: hoursAgo(OPS_WATCH_MAX_AGE_HOURS + 0.1) }, NOW);
    expect(stale.ok).toBe(true); // a finding is never ok=0 - ops-watch must not latch its own staleness red
    expect(stale.detail).toMatch(/^FINDING: ops-watch\.yml has STOPPED: newest completed run 7/);
    expect(stale.page).toMatch(/completed no run on main for 7\.1h/);
  });

  // ⏱ 2026-10-03 · #1165 review bd5d50ac minor (club-nits-b B14). RED before: the
  // ceiling equalled the 6-hourly firing interval, so the previous firing's run,
  // finished some minutes after its dispatch, read past it on a healthy ops-watch.
  it('🔴 the ceiling has slack past one firing interval: 6.5h is healthy, just under 7h is healthy, just over pages', () => {
    for (const h of [6.5, 6.95]) {
      const row = gradeOpsWatchFreshness({ id: 11, status: 'completed', updated_at: hoursAgo(h) }, NOW);
      expect(row.page, `${h}h`).toBeUndefined();
      expect(row.detail).not.toMatch(/^FINDING: /);
    }
    const over = gradeOpsWatchFreshness({ id: 12, status: 'completed', updated_at: hoursAgo(7.05) }, NOW);
    expect(over.detail).toMatch(/^FINDING: /);
    expect(over.page).toMatch(/ceiling 7h/);
  });

  it('a pass that read no ops-watch run is ok=0 "not judged" and pages nobody', () => {
    const row = gradeOpsWatchFreshness(undefined, NOW);
    expect(row).toMatchObject({ target: OPS_WATCH_FRESHNESS_TARGET, ok: false });
    expect(row.detail).toMatch(/^not judged/);
    expect(row.page).toBeUndefined();
    expect(gradeOpsWatchFreshness({ id: 8, status: 'completed' }, NOW).ok).toBe(false);
  });

  it('🔴 opsWatchdogJob mails once for a stale row, carries the mark, and mails again after a fresh pass', async () => {
    const db = realPlatformDb();
    const { sent } = double({});
    const env = { PLATFORM_DB: db, RESEND_API_KEY: KEY } as unknown as Env;
    const stale = () => gradeOpsWatchFreshness({ id: 9, status: 'completed', updated_at: new Date(T0 - 8 * 3_600_000).toISOString() }, Date.now());
    const freshRow = () => gradeOpsWatchFreshness({ id: 10, status: 'completed', updated_at: new Date(Date.now() - 3_600_000).toISOString() }, Date.now());
    nextFiring();
    await opsWatchdogJob(env, async () => [stale()]);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([ENTITY.to]);
    expect(sent[0].subject).toMatch(/ops-watch has stopped completing runs on main/);
    nextFiring();
    await opsWatchdogJob(env, async () => [stale()]);
    expect(sent).toHaveLength(1);
    nextFiring();
    await opsWatchdogJob(env, async () => [freshRow()]);
    nextFiring();
    await opsWatchdogJob(env, async () => [stale()]);
    expect(sent).toHaveLength(2);
    const rows = db.rows('SELECT detail FROM cron_heartbeat WHERE job = ? AND target = ? ORDER BY ran_at', OPS_WATCHDOG_JOB, OPS_WATCH_FRESHNESS_TARGET) as { detail: string }[];
    expect(rows.map((r) => r.detail.startsWith(`FINDING: ${OWNER_PAGED_MARK}`))).toEqual([true, true, false, true]);
  });
});
