// ─────────────────────────────────────────────────────────────────────────────
// cancel-executor.test.ts — queued cancels are carried out, retried with a
// backoff, and page the owner once (refund-finish; O-CANCEL-EXECUTOR-UNBUILT).
//
// Through the REAL Paddle rail (the composition root's railFor) with a stubbed
// network, over the real-SQL harness:
//   · a queued Paddle cancel is executed with exactly ONE call, and a second run
//     makes none;
//   · a failing rail retries with a backoff (not before next_attempt_at), and
//     after CANCEL_ALERT_AFTER_ATTEMPTS failures pages the owner ONCE;
//   · a row with no subscription reference is a human's and is never selected;
//   · before migration 0029, the queue is unreadable and nothing is done;
//   · the backlog unexecuted when 0029 ran is never acted on: skipped, counted.
// The account-deletion half ("deleting an account with an active Paddle
// subscription produces exactly one cancel") is test/account-billing.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_ALERT_AFTER_ATTEMPTS, executeQueuedCancels, nextAttemptAt } from '../src/lib/mor/cancel-executor';
import type { Env } from '../src/types';
import { PLATFORM_MIGRATIONS, RealDb, realPlatformDb } from './harness';
import cancelAttempts0029 from '../migrations/0029_cancel_attempts.sql?raw';

const LIVE_KEY = `pdl_live_apikey_${'x'.repeat(24)}`;
const EFFECTIVE = '2026-10-29T00:00:00.000Z';
let answer: () => Response = () => new Response('{}', { status: 500 });
let calls: string[] = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://api.paddle.com/')) return answer();
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

const ok = () =>
  new Response(JSON.stringify({ data: { id: 'sub_01q', status: 'active', scheduled_change: { action: 'cancel', effective_at: EFFECTIVE, resume_at: null } } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

/** A row the route recorded (`backlog = 0`), or, with `backlog: 'pre-0029'`, one written before 0029 (no column yet). */
function queue(db: RealDb, id: string, o: { sub?: string | null; requestedAt?: string; backlog?: 'pre-0029' } = {}) {
  db.db
    .prepare(
      `INSERT INTO cancellation_requests (request_id, user_id, app_id, environment, provider, provider_subscription_id, requested_at, executed_at, not_executed_reason${o.backlog === undefined ? ', backlog' : ''})
       VALUES (?, 'u-1', 'subscriptiontracker', 'live', 'paddle', ?, ?, NULL, 'provider_error'${o.backlog === undefined ? ', 0' : ''})`,
    )
    .run(id, o.sub === undefined ? 'sub_01q' : o.sub, o.requestedAt ?? '2026-10-01T00:00:00.000Z');
}

// ⚠️ `null` for no key, never `undefined`: an `undefined` argument is swallowed by the default.
const env = (db: RealDb, key: string | null = LIVE_KEY) => ({ PLATFORM_DB: db, MONEY_ENVIRONMENT: 'live', PADDLE_API_KEY: key ?? undefined }) as unknown as Env;

describe('the cancel executor', () => {
  it('🔴 a queued Paddle cancel is executed with exactly one call; a second run makes none', async () => {
    answer = ok;
    const db = realPlatformDb();
    queue(db, 'r-1');
    const now = '2026-10-02T06:00:00.000Z';
    expect(await executeQueuedCancels(env(db), now)).toMatchObject({ tried: 1, executed: 1, failed: 0 });
    expect(calls).toHaveLength(1);
    expect(db.rows('SELECT executed_at, not_executed_reason FROM cancellation_requests')[0]).toEqual({ executed_at: now, not_executed_reason: null });
    expect(await executeQueuedCancels(env(db), now)).toMatchObject({ tried: 0 });
    expect(calls).toHaveLength(1);
  });

  it('🔴 a failing rail retries with a backoff, then pages the owner ONCE', async () => {
    answer = () => new Response(JSON.stringify({ error: { code: 'internal' } }), { status: 500 });
    const db = realPlatformDb();
    queue(db, 'r-2');
    const pages: string[] = [];
    const page = async (subject: string) => void pages.push(subject);
    let now = '2026-10-02T06:00:00.000Z';
    for (let i = 1; i <= CANCEL_ALERT_AFTER_ATTEMPTS + 1; i++) {
      // Not before next_attempt_at: a run in between does nothing.
      const r = await executeQueuedCancels(env(db), now, page);
      expect(r).toMatchObject({ tried: 1, failed: 1 });
      const row = db.rows('SELECT attempts, next_attempt_at, alerted_at FROM cancellation_requests')[0] as { attempts: number; next_attempt_at: string };
      expect(row.attempts).toBe(i);
      expect(row.next_attempt_at).toBe(nextAttemptAt(now, i));
      expect(await executeQueuedCancels(env(db), new Date(Date.parse(row.next_attempt_at) - 1000).toISOString(), page)).toMatchObject({ tried: 0 });
      now = row.next_attempt_at;
    }
    expect(pages).toHaveLength(1);
    expect(calls).toHaveLength(CANCEL_ALERT_AFTER_ATTEMPTS + 1);
  });

  it('no key on this Worker: recorded as provider_not_configured, nothing sent, retried later', async () => {
    const db = realPlatformDb();
    queue(db, 'r-3');
    expect(await executeQueuedCancels(env(db, null), '2026-10-02T06:00:00.000Z')).toMatchObject({ failed: 1 });
    expect(calls).toHaveLength(0);
    expect(db.rows('SELECT not_executed_reason FROM cancellation_requests')[0]).toEqual({ not_executed_reason: 'provider_not_configured' });
  });

  it('a row with no subscription reference is a human’s: never selected', async () => {
    const db = realPlatformDb();
    queue(db, 'r-4', { sub: null });
    expect(await executeQueuedCancels(env(db), '2026-10-02T06:00:00.000Z')).toMatchObject({ tried: 0 });
  });

  it('before migration 0029 the queue is unreadable, and nothing is done', async () => {
    answer = ok;
    const db = new RealDb(PLATFORM_MIGRATIONS.filter((m) => !m.includes('ADD COLUMN next_attempt_at')));
    queue(db, 'r-5', { backlog: 'pre-0029' });
    expect(await executeQueuedCancels(env(db), '2026-10-02T06:00:00.000Z')).toMatchObject({ tried: 0, skipped: 'queue_unreadable' });
    expect(calls).toHaveLength(0);
  });

  it('🔴 the backlog recorded before 0029 is skipped and reported on the first night; a later request is carried out', async () => {
    answer = ok;
    const db = new RealDb(PLATFORM_MIGRATIONS.filter((m) => m !== cancelAttempts0029));
    queue(db, 'r-old', { backlog: 'pre-0029' });
    db.db.exec(cancelAttempts0029); // the deploy: the executor's cutoff
    queue(db, 'r-new', { requestedAt: '2026-10-02T00:00:00.000Z' });
    const r = await executeQueuedCancels(env(db), '2026-10-02T06:00:00.000Z');
    expect(r).toMatchObject({ tried: 1, executed: 1, backlog: 1 });
    expect(calls).toHaveLength(1);
    expect(db.rows("SELECT request_id, executed_at FROM cancellation_requests WHERE executed_at IS NULL")).toEqual([{ request_id: 'r-old', executed_at: null }]);
    expect(await executeQueuedCancels(env(db), '2026-10-09T06:00:00.000Z')).toMatchObject({ tried: 0, backlog: 1 });
    expect(calls).toHaveLength(1);
  });

  it('the backoff doubles from one day and stops at seven', () => {
    const t = '2026-10-02T00:00:00.000Z';
    expect([1, 2, 3, 4, 5].map((a) => (Date.parse(nextAttemptAt(t, a)) - Date.parse(t)) / 86_400_000)).toEqual([1, 2, 4, 7, 7]);
  });
});
