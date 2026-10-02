// ─────────────────────────────────────────────────────────────────────────────
// ai-routes.test.ts — PAID AI, metered (train-st-ai-customer-pays, T17).
//
// Driven through the REAL routes over the real-SQL harness, with the COUNTING
// stub (services/_shared/src/ports/fakes/ai.ts) in place of the provider. The
// stub asks the meter for a reservation exactly as the Anthropic adapter does,
// so `stub.calls` is the proof the owner lock needs: every refusal leaves it 0.
//
// The red controls of the brief, each a case below:
//   · a Free user → 402 ai_requires_plan; a Pro user in a trial → 402; a cap
//     reached → 402; the kill switch → 503 — and the stub saw 0 calls each time;
//   · no call without a recorded opt-in to the CURRENT disclosure;
//   · a fixture receipt image yields one candidate, marked `source: ai_import`
//     with provenance, and the request body is persisted nowhere;
//   · review is metered like import and its output is advisory, marked
//     `generated_by: ai`;
//   · a replayed pack grant credits once; a refunded pack removes its unspent
//     credits;
//   · a call where nothing ran gives its credit back.
// ─────────────────────────────────────────────────────────────────────────────
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import ai, { aiRouteDeps } from '../src/routes/ai';
import { AI_DISCLOSURE_VERSION, PER_USER_DAILY_CALLS, PRO_MONTHLY_ALLOWANCE, creditPack, revokePack } from '../src/lib/ai/meter';
import { aiFor, aiLimits } from '../src/ports';
import type { AppEnv } from '../src/types';
import { createStubAi, type StubAiProvider } from '../../_shared/src/ports/fakes/ai';
import { realPlatformDb, type RealDb } from './harness';

const APP = 'subscriptiontracker';
const FREE = 'u-ai-free';
const PRO = 'u-ai-pro';
const TRIAL = 'u-ai-trial';
const PACK = 'u-ai-pack';
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();

const ONE_CANDIDATE = JSON.stringify({
  candidates: [{ name: 'StreamCo', price: 9.99, currency: 'USD', cycle: 'monthly', next_date: '2026-11-01', confidence: 0.92 }],
});
// A 1×1 PNG: the "fixture receipt image" — the stub reads nothing from it.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let stub: StubAiProvider;
/** Every stub a test built: one per selection, each with the route's own meter. */
let stubs: StubAiProvider[] = [];
/** Calls that reached ANY stub's pretend wire in this test. */
const calls = () => stubs.reduce((n, s) => n + s.calls, 0);
const realSelect = aiRouteDeps.select;

beforeEach(() => {
  stubs = [];
  stub = createStubAi({ limits: aiLimits(), defaultText: ONE_CANDIDATE });
  // The model is config and null until measured, so the test stands in a selection
  // that reaches the counting stub — built WITH the route's own meter (beforeCall).
  aiRouteDeps.select = (feature, _env, wiring) => {
    stub = createStubAi({ limits: { ...aiLimits(), maxInputTokens: { import: 24000, review: 24000 } }, defaultText: ONE_CANDIDATE, beforeCall: wiring?.beforeCall });
    stubs.push(stub);
    return { ok: true, feature, model: 'claude-haiku-4-5', effort: null, provider: stub };
  };
});
afterEach(() => {
  aiRouteDeps.select = realSelect;
});

function seedEntitlement(db: RealDb, userId: string, o: { status?: string; trialEnd?: string | null } = {}) {
  db.db
    .prepare(
      `INSERT INTO entitlements (user_id, app_id, entitlement, is_active, expires_at, updated_at, provider, provider_environment, provider_status, trial_end)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(userId, APP, 'pro', 1, FUTURE, NOW, 'paddle', 'live', o.status ?? 'active', o.trialEnd ?? null);
}

function seedConsent(db: RealDb, userId: string, version = AI_DISCLOSURE_VERSION) {
  db.db
    .prepare(`INSERT INTO ai_accounts (user_id, app_id, consent_version, consent_at, updated_at) VALUES (?,?,?,?,?)
              ON CONFLICT (user_id, app_id) DO UPDATE SET consent_version = excluded.consent_version`)
    .run(userId, APP, version, NOW, NOW);
}

interface KvStub {
  store: Map<string, string>;
  get(k: string): Promise<string | null>;
  put(k: string, v: string): Promise<void>;
}
const kv = (): KvStub => {
  const store = new Map<string, string>();
  return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v) };
};

function envFor(db: RealDb, over: Record<string, unknown> = {}) {
  return { PLATFORM_DB: db, CONFIG_KV: kv(), MONEY_ENVIRONMENT: 'live', AI_ENABLED: 'true', AI_DAILY_USD_CAP: '50', ...over };
}

async function call(db: RealDb, userId: string, path: string, body: unknown, env: Record<string, unknown> = envFor(db)) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('userId', userId);
    c.set('requestId', 'test-ai');
    await next();
  });
  app.route('/v1', ai);
  const init: RequestInit = body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await app.request(`http://x/v1${path}`, init, env as unknown as AppEnv['Bindings']);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const IMPORT = { app_id: APP, image: { media_type: 'image/png', base64: PNG } };

describe('🔴 no free AI: every refusal is answered before a model call', () => {
  it('a Free user → 402 ai_requires_plan, and no call is made', async () => {
    const db = realPlatformDb();
    seedConsent(db, FREE);
    const r = await call(db, FREE, '/ai/import', IMPORT);
    expect(r).toMatchObject({ status: 402, json: { error: 'ai_requires_plan' } });
    expect(calls()).toBe(0);
    expect(db.count('ai_ledger', "kind = 'call'")).toBe(0);
  });

  it('a Pro user in a TRIAL → 402: a trial buys no AI (rail status trialing, or a trial end ahead)', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, TRIAL, { status: 'trialing', trialEnd: FUTURE });
    seedConsent(db, TRIAL);
    const r = await call(db, TRIAL, '/ai/import', IMPORT);
    expect(r).toMatchObject({ status: 402, json: { error: 'ai_requires_plan' } });
    expect(calls()).toBe(0);

    const db2 = realPlatformDb();
    seedEntitlement(db2, TRIAL, { status: 'active', trialEnd: FUTURE });
    seedConsent(db2, TRIAL);
    expect((await call(db2, TRIAL, '/ai/import', IMPORT)).status).toBe(402);
    expect(calls()).toBe(0);
  });

  it('the kill switch → 503 ai_disabled: AI_ENABLED absent, not "true", or CONFIG_KV ai:kill set', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    for (const over of [{ AI_ENABLED: undefined }, { AI_ENABLED: 'TRUE' }, { AI_ENABLED: '1' }]) {
      const r = await call(db, PRO, '/ai/import', IMPORT, envFor(db, over));
      expect(r).toMatchObject({ status: 503, json: { error: 'ai_disabled' } });
    }
    const killed = kv();
    killed.store.set('ai:kill', '1');
    expect((await call(db, PRO, '/ai/import', IMPORT, envFor(db, { CONFIG_KV: killed }))).json.error).toBe('ai_disabled');
    expect(calls()).toBe(0);
  });

  it('no opt-in, or an opt-in to an OLDER disclosure → 403 ai_consent_required, no call', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    expect((await call(db, PRO, '/ai/import', IMPORT)).json.error).toBe('ai_consent_required');
    seedConsent(db, PRO, '2020-01-01');
    expect((await call(db, PRO, '/ai/import', IMPORT)).json.error).toBe('ai_consent_required');
    expect(calls()).toBe(0);
  });

  it('the monthly allowance spent → 402 ai_credits_exhausted (a hard cap), no call', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    db.db.prepare('UPDATE ai_accounts SET allowance_period = ?, allowance_used = ? WHERE user_id = ?').run(NOW.slice(0, 7), PRO_MONTHLY_ALLOWANCE, PRO);
    const r = await call(db, PRO, '/ai/import', IMPORT);
    expect(r).toMatchObject({ status: 402, json: { error: 'ai_credits_exhausted' } });
    expect(calls()).toBe(0);
  });

  it('the per-user daily cap → 402 ai_daily_cap, no call', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const ins = db.db.prepare(
      `INSERT INTO ai_ledger (id, kind, user_id, app_id, environment, source, credits, status, reserved_usd, cost_usd, created_at, day) VALUES (?, 'call', ?, ?, 'live', 'pack', -1, 'settled', 0, 0, ?, ?)`,
    );
    for (let i = 0; i < PER_USER_DAILY_CALLS; i++) ins.run(`old-${i}`, PRO, APP, NOW, NOW.slice(0, 10));
    const r = await call(db, PRO, '/ai/import', IMPORT);
    expect(r).toMatchObject({ status: 402, json: { error: 'ai_daily_cap' } });
    expect(calls()).toBe(0);
  });

  it('the GLOBAL daily circuit-breaker → 503 ai_spend_paused, no call, and the owner is paged once', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const k = kv();
    // A cap below one call's worst case: every reservation trips it.
    const env = envFor(db, { AI_DAILY_USD_CAP: '0.0001', CONFIG_KV: k });
    const r = await call(db, PRO, '/ai/import', IMPORT, env);
    expect(r).toMatchObject({ status: 503, json: { error: 'ai_spend_paused' } });
    expect(calls()).toBe(0);
    expect(k.store.has(`ai:cap-paged:${NOW.slice(0, 10)}`)).toBe(true);
    // An absent cap is 0: refused the same way, never unlimited.
    expect((await call(db, PRO, '/ai/import', IMPORT, envFor(db, { AI_DAILY_USD_CAP: undefined }))).json.error).toBe('ai_spend_paused');
    expect(calls()).toBe(0);
    // Nothing was debited by the refusals.
    expect(db.rows('SELECT allowance_used FROM ai_accounts WHERE user_id = ?', PRO)[0]).toMatchObject({ allowance_used: 0 });
  });

  it('with the real selection, every feature answers 503 ai_unavailable today (no model is set) — after the plan check', async () => {
    aiRouteDeps.select = realSelect;
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    expect((await call(db, PRO, '/ai/import', IMPORT)).json.error).toBe('ai_unavailable');
    // The reservation never ran, so nothing was debited.
    expect(db.count('ai_ledger')).toBe(0);
    expect(aiFor('import', {}, {}).ok).toBe(false);
    // A Free user still hears "this needs a plan" first.
    seedConsent(db, FREE);
    expect((await call(db, FREE, '/ai/import', IMPORT)).json.error).toBe('ai_requires_plan');
  });
});

describe('AI import (AI-03): candidates out, marked, never saved', () => {
  it('a fixture receipt image yields ONE candidate with source ai_import and provenance; the call is metered', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const r = await call(db, PRO, '/ai/import', IMPORT);
    expect(r.status).toBe(200);
    expect(calls()).toBe(1);
    const cands = r.json.candidates as Array<Record<string, unknown>>;
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ name: 'StreamCo', cycle: 'monthly', source: 'ai_import', provenance: { generator: 'ai', provider: 'stub', model: 'claude-haiku-4-5' } });
    expect(r.json.provenance).toMatchObject({ generator: 'ai', provider: 'stub', model: 'claude-haiku-4-5' });
    // Metered BEFORE the response returned: one settled call, one allowance credit used.
    const ledger = db.rows("SELECT * FROM ai_ledger WHERE kind = 'call'");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ status: 'settled', source: 'allowance', feature: 'import', model: 'claude-haiku-4-5', tokens_in: 120, tokens_out: 30 });
    expect(Number(ledger[0]?.cost_usd)).toBeCloseTo((120 * 1 + 30 * 5) / 1e6, 12);
    expect(db.rows('SELECT allowance_used FROM ai_accounts WHERE user_id = ?', PRO)[0]).toMatchObject({ allowance_used: 1 });
  });

  it('🔴 the request body is persisted NOWHERE: no table holds the image or the text', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const text = 'SENTINEL-RECEIPT-TEXT-7f3a';
    expect((await call(db, PRO, '/ai/import', { ...IMPORT, text })).status).toBe(200);
    const tables = db.rows("SELECT name FROM sqlite_master WHERE type = 'table'").map((t) => String(t.name));
    for (const t of tables) {
      const dump = JSON.stringify(db.rows(`SELECT * FROM "${t}"`));
      expect(dump.includes(text), t).toBe(false);
      expect(dump.includes(PNG.slice(0, 40)), t).toBe(false);
    }
    // ...and the text did reach the (stub) provider, so the sentinel is a real one.
    expect(stub.requests[0]?.input).toBe(text);
  });

  it('a paid pack credit buys a call for a Free user; the balance never goes below zero', async () => {
    const db = realPlatformDb();
    seedConsent(db, PACK);
    expect(await creditPack(db as unknown as D1Database, { provider: 'paddle', ref: 'txn_1', userId: PACK, appId: APP, credits: 1, environment: 'live' })).toBe(true);
    expect((await call(db, PACK, '/ai/import', IMPORT)).status).toBe(200);
    expect(db.rows('SELECT pack_credits FROM ai_accounts WHERE user_id = ?', PACK)[0]).toMatchObject({ pack_credits: 0 });
    const again = await call(db, PACK, '/ai/import', IMPORT);
    expect(again).toMatchObject({ status: 402, json: { error: 'ai_requires_plan' } });
    expect(calls()).toBe(1); // the refused second call reached no stub
    expect(db.rows('SELECT pack_credits FROM ai_accounts WHERE user_id = ?', PACK)[0]).toMatchObject({ pack_credits: 0 });
  });

  it('a call where nothing ran (the provider answered 529) gives its credit back', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const prev = aiRouteDeps.select;
    aiRouteDeps.select = (feature, env, wiring) => {
      const sel = prev(feature, env, wiring);
      if (sel.ok) (sel.provider as StubAiProvider).answer({ kind: 'status', status: 529 });
      return sel;
    };
    const r = await call(db, PRO, '/ai/import', IMPORT);
    expect(r).toMatchObject({ status: 503, json: { error: 'ai_unavailable' } });
    expect(db.rows("SELECT status, credits FROM ai_ledger WHERE kind = 'call'")[0]).toMatchObject({ status: 'released', credits: 0 });
    expect(db.rows('SELECT allowance_used FROM ai_accounts WHERE user_id = ?', PRO)[0]).toMatchObject({ allowance_used: 0 });
  });
});

describe('Review my subscriptions (AI-04): metered like import, advisory only', () => {
  it('a Free user is refused the same way, with no call', async () => {
    const db = realPlatformDb();
    seedConsent(db, FREE);
    const r = await call(db, FREE, '/ai/review', { app_id: APP, subscriptions: [{ name: 'StreamCo', price: 9.99 }] });
    expect(r).toMatchObject({ status: 402, json: { error: 'ai_requires_plan' } });
    expect(calls()).toBe(0);
  });

  it('a paid call returns advisory suggestions, each marked generated_by ai with provenance, and is metered', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, PRO);
    seedConsent(db, PRO);
    const prev = aiRouteDeps.select;
    aiRouteDeps.select = (feature, env, wiring) => {
      const sel = prev(feature, env, wiring);
      if (sel.ok)
        (sel.provider as StubAiProvider).answer({ kind: 'stop', stopReason: 'end_turn', text: JSON.stringify({ suggestions: [{ name: 'StreamCo', action: 'review', reason: 'Unused for 60 days.' }] }) });
      return sel;
    };
    const r = await call(db, PRO, '/ai/review', { app_id: APP, subscriptions: [{ name: 'StreamCo', price: 9.99, currency: 'USD', cycle: 'monthly' }] });
    expect(r.status).toBe(200);
    expect(r.json.advisory).toBe(true);
    expect((r.json.suggestions as unknown[])[0]).toMatchObject({ action: 'review', generated_by: 'ai', provenance: { generator: 'ai' } });
    expect(db.count('ai_ledger', "kind = 'call' AND feature = 'review' AND status = 'settled'")).toBe(1);
  });
});

describe('consent and status', () => {
  it('the opt-in records only the CURRENT disclosure version; a stale one is 409', async () => {
    const db = realPlatformDb();
    expect((await call(db, PRO, '/ai/consent', { app_id: APP, disclosure_version: '2020-01-01' })).status).toBe(409);
    expect(db.count('ai_accounts')).toBe(0);
    expect((await call(db, PRO, '/ai/consent', { app_id: APP, disclosure_version: AI_DISCLOSURE_VERSION })).status).toBe(200);
    expect(db.rows('SELECT consent_version FROM ai_accounts WHERE user_id = ?', PRO)[0]).toMatchObject({ consent_version: AI_DISCLOSURE_VERSION });
  });

  it('status: a trial has no allowance; a paid plan has the monthly allowance', async () => {
    const db = realPlatformDb();
    seedEntitlement(db, TRIAL, { status: 'trialing', trialEnd: FUTURE });
    seedEntitlement(db, PRO);
    expect((await call(db, TRIAL, `/ai/status?app_id=${APP}`, undefined)).json).toMatchObject({ plan: 'trial', allowance_left: 0, consent_current: false });
    expect((await call(db, PRO, `/ai/status?app_id=${APP}`, undefined)).json).toMatchObject({ plan: 'paid', allowance_left: PRO_MONTHLY_ALLOWANCE });
  });
});

describe('packs (AI-04): credited only by a verified purchase, idempotent', () => {
  it('🔴 a replayed grant credits ONCE', async () => {
    const db = realPlatformDb();
    const g = { provider: 'paddle', ref: 'txn_42', userId: PACK, appId: APP, credits: 25, environment: 'live' };
    expect(await creditPack(db as unknown as D1Database, g)).toBe(true);
    expect(await creditPack(db as unknown as D1Database, g)).toBe(false);
    expect(db.rows('SELECT pack_credits FROM ai_accounts WHERE user_id = ?', PACK)[0]).toMatchObject({ pack_credits: 25 });
    expect(db.count('ai_ledger', "kind = 'grant'")).toBe(1);
  });

  it('🔴 a refunded pack removes its UNSPENT credits, once, never below zero', async () => {
    const db = realPlatformDb();
    await creditPack(db as unknown as D1Database, { provider: 'paddle', ref: 'txn_7', userId: PACK, appId: APP, credits: 25, environment: 'live' });
    db.db.prepare('UPDATE ai_accounts SET pack_credits = 3 WHERE user_id = ?').run(PACK); // 22 spent
    expect(await revokePack(db as unknown as D1Database, 'paddle', 'txn_7')).toBe(true);
    expect(db.rows('SELECT pack_credits FROM ai_accounts WHERE user_id = ?', PACK)[0]).toMatchObject({ pack_credits: 0 });
    expect(await revokePack(db as unknown as D1Database, 'paddle', 'txn_7')).toBe(false);
    expect(db.rows("SELECT status FROM ai_ledger WHERE kind = 'grant'")[0]).toMatchObject({ status: 'revoked' });
  });

  it('a zero or fractional grant credits nothing', async () => {
    const db = realPlatformDb();
    expect(await creditPack(db as unknown as D1Database, { provider: 'paddle', ref: 'x', userId: PACK, appId: APP, credits: 0, environment: 'live' })).toBe(false);
    expect(await creditPack(db as unknown as D1Database, { provider: 'paddle', ref: 'y', userId: PACK, appId: APP, credits: 1.5, environment: 'live' })).toBe(false);
    expect(db.count('ai_ledger')).toBe(0);
  });
});
