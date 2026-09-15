import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ERASURE_RETRY_JOB, ERASURE_STUCK_AFTER_DAYS, erasureRetry } from '../src/scheduled';
import {
  ERASURE_RETRY_BASE_MS,
  ERASURE_RETRY_CAP_MS,
  erasureBindingName,
  nextAttemptDelayMs,
  recordPendingErasure,
} from '../src/lib/erasure-ledger';
import { userOwnedTables, userReferencingColumns } from '../../_shared/src/erasure';
import { realPlatformDb, type RealDb } from './harness';
import type { Env } from '../src/types';

// ─────────────────────────────────────────────────────────────────────────────
// erasure-retry.test.ts — [ADR 081] the ledger and the nightly retry, against the
// real migrations (0010 included) on a real SQL engine.
//
// ⏱ 2026-09-15. What each group pins:
//   · the ledger cannot be reached by the erasure it records (no user_id-shaped column);
//   · a due order is retried over the app's Service Binding, confirmed, and — once
//     every app for the subject has confirmed — platform_db is re-walked and the
//     identity is deleted LAST, then the orders go (the retention bound);
//   · a failure backs off, an order stuck past the bound turns the heartbeat RED,
//     and no heartbeat row carries the subject.
// ─────────────────────────────────────────────────────────────────────────────

const NOW_MS = Date.parse('2026-09-20T06:00:00.000Z');
const SUBJECT = 'retry-subject-6c0e';
const SUPABASE_URL = 'https://retry.supabase.co';

let identityCalls: string[] = [];
let identityStatus = 204;
beforeEach(() => {
  identityCalls = [];
  identityStatus = 204;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(`${SUPABASE_URL}/auth/v1/admin/users/`) && init?.method === 'DELETE') {
      identityCalls.push(url);
      return new Response(null, { status: identityStatus });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

function envWith(db: RealDb, bindings: Record<string, unknown>, serviceRoleKey: string | undefined = 'srk'): Env {
  return {
    PLATFORM_DB: db,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    ...bindings,
  } as unknown as Env;
}

const orders = (db: RealDb) =>
  db.db.prepare('SELECT order_id, app_id, attempts, next_attempt_at, confirmed_at, last_error FROM pending_erasures').all() as Array<{
    order_id: string;
    app_id: string;
    attempts: number;
    next_attempt_at: string;
    confirmed_at: string | null;
    last_error: string | null;
  }>;
const beats = (db: RealDb) =>
  db.db.prepare('SELECT target, ok, detail FROM cron_heartbeat WHERE job = ? ORDER BY rowid').all(ERASURE_RETRY_JOB) as Array<{
    target: string;
    ok: number;
    detail: string;
  }>;

async function queue(db: RealDb, appId = 'subscriptiontracker', createdAtMs = NOW_MS - 60_000) {
  await recordPendingErasure(db as unknown as D1Database, {
    subjectRef: SUBJECT,
    appId,
    nowIso: new Date(createdAtMs).toISOString(),
    reason: 'unreachable',
  });
}

describe('the ledger cannot be reached by the erasure it records', () => {
  it('pending_erasures has no user_id and no *_user_id column, so the derived sweep never sees it', async () => {
    const db = realPlatformDb();
    const owned = await userOwnedTables(db as unknown as D1Database);
    const refs = await userReferencingColumns(db as unknown as D1Database);
    expect(owned).not.toContain('pending_erasures');
    expect(refs.map((r) => r.table)).not.toContain('pending_erasures');
  });

  it('the binding name is ERASURE_<APP_ID> — the spelling wrangler.jsonc and the guard use', () => {
    expect(erasureBindingName('subscriptiontracker')).toBe('ERASURE_SUBSCRIPTIONTRACKER');
  });
});

describe('the nightly retry finishes an erasure, identity LAST', () => {
  it('confirms a due order over the binding, re-walks platform_db, deletes the identity, closes the orders', async () => {
    const db = realPlatformDb();
    await queue(db);
    // A row written while the subject still had a login, after the 202.
    db.db
      .prepare(
        `INSERT INTO entitlements (user_id, app_id, entitlement, product_id, store, is_active, expires_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(SUBJECT, 'subscriptiontracker', 'pro', 'p1', 'APP_STORE', 1, null, '2026-09-19T00:00:00Z');
    const calls: Array<[string, string]> = [];
    const binding = { eraseSubject: async (s: string, o: string) => (calls.push([s, o]), { ok: true }) };
    await erasureRetry(envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: binding }), NOW_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(SUBJECT);
    expect(identityCalls).toHaveLength(1);
    expect(orders(db)).toHaveLength(0);
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM entitlements WHERE user_id = ?').get(SUBJECT)).toEqual({ n: 0 });
    const b = beats(db);
    expect(b.every((r) => r.ok === 1)).toBe(true);
    expect(b.at(-1)?.detail).toMatch(/due=1 confirmed=1 failed=0 completed=1 identity_pending=0 stuck=0/);
  });

  it('does NOT delete the identity while another app for the subject is still unconfirmed', async () => {
    const db = realPlatformDb();
    await queue(db, 'subscriptiontracker');
    await queue(db, 'otherapp');
    const ok = { eraseSubject: async () => ({ ok: true }) };
    const refuses = { eraseSubject: async () => ({ ok: false, reason: 'down' }) };
    await erasureRetry(envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: ok, ERASURE_OTHERAPP: refuses }), NOW_MS);
    expect(identityCalls).toHaveLength(0);
    expect(orders(db).find((o) => o.app_id === 'subscriptiontracker')?.confirmed_at).not.toBeNull();
    expect(orders(db).find((o) => o.app_id === 'otherapp')?.confirmed_at).toBeNull();
  });

  it('keeps the orders when the identity delete fails, so the next night tries again', async () => {
    const db = realPlatformDb();
    await queue(db);
    identityStatus = 500;
    await erasureRetry(envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: { eraseSubject: async () => ({ ok: true }) } }), NOW_MS);
    expect(identityCalls).toHaveLength(1);
    expect(orders(db)).toHaveLength(1);
    expect(beats(db).at(-1)?.detail).toMatch(/identity_pending=1/);
  });
});

describe('a failure backs off, and a STUCK order turns the heartbeat red', () => {
  it('a refused attempt is rescheduled with backoff and the heartbeat stays ok while within the bound', async () => {
    const db = realPlatformDb();
    await queue(db);
    await erasureRetry(
      envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: { eraseSubject: async () => ({ ok: false, reason: 'app down' }) } }),
      NOW_MS,
    );
    const [o] = orders(db);
    expect(o.attempts).toBe(1);
    expect(Date.parse(o.next_attempt_at)).toBe(NOW_MS + nextAttemptDelayMs(1));
    expect(o.last_error).toMatch(/app down/);
    expect(identityCalls).toHaveLength(0);
    expect(beats(db).every((r) => r.ok === 1)).toBe(true);
  });

  it('an order unconfirmed past the bound writes ok=0 rows — RED in the ops register', async () => {
    const db = realPlatformDb();
    await queue(db, 'subscriptiontracker', NOW_MS - (ERASURE_STUCK_AFTER_DAYS + 1) * 86_400_000);
    await erasureRetry(
      envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: { eraseSubject: async () => { throw new Error('boom'); } } }),
      NOW_MS,
    );
    const b = beats(db);
    expect(b.some((r) => r.ok === 0 && /STUCK/.test(r.detail))).toBe(true);
    expect(b.at(-1)).toMatchObject({ target: '(portfolio)', ok: 0 });
    expect(b.at(-1)?.detail).toMatch(/stuck=1/);
  });

  it('an app with no declared binding is a failed attempt, never a silent skip', async () => {
    const db = realPlatformDb();
    await queue(db);
    await erasureRetry(envWith(db, {}), NOW_MS);
    expect(orders(db)[0].last_error).toMatch(/no erasure binding/);
  });

  it('writes a summary row on a run with nothing due, so the watched job stays fresh', async () => {
    const db = realPlatformDb();
    await erasureRetry(envWith(db, {}), NOW_MS);
    expect(beats(db)).toEqual([{ target: '(portfolio)', ok: 1, detail: expect.stringMatching(/^due=0 /) }]);
  });

  it('NO heartbeat row carries the subject — cron_heartbeat is not erasable', async () => {
    const db = realPlatformDb();
    await queue(db);
    await erasureRetry(
      envWith(db, { ERASURE_SUBSCRIPTIONTRACKER: { eraseSubject: async () => ({ ok: false, reason: 'down' }) } }),
      NOW_MS,
    );
    for (const r of beats(db)) expect(`${r.target} ${r.detail}`).not.toContain(SUBJECT);
  });

  it('the backoff doubles from the base and is capped at a day', () => {
    expect(nextAttemptDelayMs(0)).toBe(ERASURE_RETRY_BASE_MS);
    expect(nextAttemptDelayMs(1)).toBe(ERASURE_RETRY_BASE_MS * 2);
    expect(nextAttemptDelayMs(30)).toBe(ERASURE_RETRY_CAP_MS);
  });
});
