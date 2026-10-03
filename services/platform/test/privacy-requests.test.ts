import { describe, it, expect, vi, afterEach } from 'vitest';
import { app } from '../src/index';
import { DAY_MS, HOUR_MS } from '../src/feedback/limits';
import {
  ACK_HOURS,
  acceptPrivacyRequest,
  clockOf,
  GRIEVANCE_STATUTORY_DAYS,
  PRIVACY_MOVES,
  parsePrivacyRequest,
  REQUEST_TYPES,
  type ClockRow,
  type PrivacyRequest,
} from '../src/feedback/privacy';
import { runFeedbackCron } from '../src/feedback/cron';
import { CTX, harness, type Harness } from './feedback-harness';
import type { MailTransport } from '../../_shared/src/ports/mail';

// ─────────────────────────────────────────────────────────────────────────────
// privacy-requests.test.ts — DPDP rights requests riding POST /v1/feedback
// (lane dpdp-rights, Do 1). Each 🔴 case is one of the brief's red controls.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NETWORK = { colo: 'MAA', asn: 55836 };

function request(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'privacy-request',
    idempotencyKey: `pr-${Math.random().toString(36).slice(2, 12)}`,
    appId: 'subscriptiontracker',
    surface: 'site',
    requestType: 'access',
    details: 'Please send me what you hold.',
    locale: 'en-IN',
    elapsedMs: 10_000,
    ...over,
  };
}

function post(h: Harness, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = Object.assign(
    new Request('https://platform.example.test/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    { cf: NETWORK },
  );
  return app.fetch(req, h.env as never, CTX as never);
}

/** A mail port that records what it was asked to send. */
function recordingMail(): MailTransport & { sent: Array<{ to: string[]; text: string; subject: string }> } {
  const sent: Array<{ to: string[]; text: string; subject: string }> = [];
  return {
    id: 'recording',
    capabilities: new Set(),
    sent,
    send: async (m: { to: string[]; text: string; subject: string }) => {
      sent.push(m);
      return { ok: true, id: `m-${sent.length}` };
    },
  } as unknown as MailTransport & { sent: Array<{ to: string[]; text: string; subject: string }> };
}

const rows = (h: Harness) => h.db.rows('SELECT * FROM privacy_requests');

describe('the request shape', () => {
  it('every right the brief names is a request type, and nothing else', () => {
    expect([...REQUEST_TYPES].sort()).toEqual(['access', 'correction', 'erasure', 'grievance', 'nomination', 'withdraw-consent']);
  });

  it('an unknown key is refused, as a report\'s is', () => {
    expect(parsePrivacyRequest(request({ deviceId: 'x' }))).toMatchObject({ ok: false, error: 'unknown_key', field: 'deviceId' });
  });

  it('a grievance or a correction must say what is wrong', () => {
    for (const requestType of ['grievance', 'correction']) {
      expect(parsePrivacyRequest(request({ requestType, details: '' }))).toMatchObject({ ok: false, error: 'required', field: 'details' });
    }
    expect(parsePrivacyRequest(request({ requestType: 'erasure', details: '' })).ok).toBe(true);
  });

  it('the free text is PII-masked before it is stored, as a report is', () => {
    const p = parsePrivacyRequest(request({ details: 'my card 4111 1111 1111 1111' }));
    expect(p.ok && p.request.details).toBe('my card [card]');
  });
});

describe('🔴 identity: the session, or a proven address — nothing else', () => {
  it('🔴 an unauthenticated access request WITHOUT the e-mail proof is refused, and nothing is stored', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(h, request({ requestType: 'access' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'proof_required' });
    expect(rows(h)).toHaveLength(0);
  });

  it('🔴 a signed-out request with an address is held UNVERIFIED: no clock runs until the link is followed', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await post(h, request({ contactEmail: 'Asha@Example.com' }));
    expect(res.status).toBe(202);
    const { id, status } = (await res.json()) as { id: string; status: string };
    expect(status).toBe('unverified');
    const [row] = rows(h);
    expect(row).toMatchObject({ id, status: 'unverified', user_id: null, contact_email: 'asha@example.com', ack_due_at: null, resolve_due_at: null });
    expect(clockOf(row as unknown as ClockRow, Date.now() + 365 * DAY_MS)).toBe('waiting');
    expect(row.verify_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('🔴 the e-mailed link verifies it: GET changes nothing, POST starts the 48 h / 30 day clocks and spends the token', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const mail = recordingMail();
    // The route below stamps the verification from the wall clock, so the request is made on it too.
    const t0 = Date.now();
    await acceptPrivacyRequest(
      h.db as never,
      mail,
      parsePrivacyRequest(request({ contactEmail: 'asha@example.com' })).ok
        ? (parsePrivacyRequest(request({ contactEmail: 'asha@example.com' })) as { request: PrivacyRequest }).request
        : (null as never),
      { kind: 'anonymous' },
      t0,
    );
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toEqual(['asha@example.com']);
    const token = /\/v1\/feedback\/verify\?t=([A-Za-z0-9_-]{43})/.exec(mail.sent[0].text)![1];
    expect(JSON.stringify(rows(h))).not.toContain(token);

    const get = await app.fetch(new Request(`https://platform.example.test/v1/feedback/verify?t=${token}`), h.env as never, CTX as never);
    expect(get.status).toBe(200);
    expect(rows(h)[0].status).toBe('unverified');

    const verify = () => app.fetch(new Request(`https://platform.example.test/v1/feedback/verify?t=${token}`, { method: 'POST' }), h.env as never, CTX as never);
    expect((await verify()).status).toBe(200);
    const [row] = rows(h);
    expect(row.status).toBe('new');
    expect(row.verify_hash).toBeNull();
    expect(Date.parse(String(row.ack_due_at)) - Date.parse(String(row.verified_at))).toBe(ACK_HOURS * HOUR_MS);
    expect(Date.parse(String(row.resolve_due_at)) - Date.parse(String(row.verified_at))).toBe(30 * DAY_MS);
    // A second use of the same link verifies nothing.
    expect((await verify()).status).toBe(404);
  });

  it('a signed-in request is verified by its session: stored `new`, with the clocks, and no link mailed', async () => {
    const h = harness();
    const mail = recordingMail();
    const p = parsePrivacyRequest(request({ requestType: 'grievance', details: 'You kept mailing me.' }));
    if (!p.ok) throw new Error('fixture');
    const t0 = Date.parse('2026-11-01T10:00:00Z');
    const out = await acceptPrivacyRequest(h.db as never, mail, p.request, { kind: 'user', userId: 'u-asha', email: 'asha@example.com' }, t0);
    expect(out.status).toBe(201);
    expect(mail.sent).toHaveLength(0);
    const [row] = rows(h);
    expect(row).toMatchObject({ user_id: 'u-asha', status: 'new', contact_email: 'asha@example.com' });
    expect(Date.parse(String(row.statutory_due_at)) - t0).toBe(GRIEVANCE_STATUTORY_DAYS * DAY_MS);
    // A replay is answered with the first id and stores nothing.
    const again = await acceptPrivacyRequest(h.db as never, mail, p.request, { kind: 'user', userId: 'u-asha', email: null }, t0);
    expect(again).toMatchObject({ status: 200, body: { status: 'duplicate' } });
    expect(rows(h)).toHaveLength(1);
  });
});

describe('🔴 the clocks', () => {
  const verified = Date.parse('2026-11-01T00:00:00Z');
  const open = (over: Partial<ClockRow> = {}): ClockRow => ({
    status: 'acknowledged',
    ack_due_at: new Date(verified + 48 * HOUR_MS).toISOString(),
    resolve_due_at: new Date(verified + 30 * DAY_MS).toISOString(),
    statutory_due_at: null,
    acknowledged_at: new Date(verified + HOUR_MS).toISOString(),
    ...over,
  });

  it('🔴 a request at day 29 is AMBER, day 31 is RED, day 10 is green', () => {
    expect(clockOf(open(), verified + 10 * DAY_MS)).toBe('green');
    expect(clockOf(open(), verified + 29 * DAY_MS)).toBe('amber');
    expect(clockOf(open(), verified + 31 * DAY_MS)).toBe('red');
  });

  it('🔴 unacknowledged past 48 hours is RED on day 3, however far the 30 days are', () => {
    expect(clockOf(open({ status: 'new', acknowledged_at: null }), verified + 3 * DAY_MS)).toBe('red');
    expect(clockOf(open({ status: 'new', acknowledged_at: null }), verified + 47 * HOUR_MS)).toBe('green');
  });

  it('a closed request has no clock', () => {
    expect(clockOf(open({ status: 'resolved' }), verified + 400 * DAY_MS)).toBe('closed');
  });
});

describe('🔴 nothing automatic closes a rights request, and an overdue one pages the owner', () => {
  it('🔴 the triage graph has no automatic mover: unverified moves only by its link, and closed is final', () => {
    expect(PRIVACY_MOVES.unverified).toEqual([]);
    expect(PRIVACY_MOVES.resolved).toEqual([]);
    expect(PRIVACY_MOVES.refused).toEqual([]);
  });

  it('🔴 the nightly feedback cron, run long past every deadline, leaves an open request open — and pages the owner once a day', async () => {
    const h = harness({ RESEND_API_KEY: 're_test' } as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = parsePrivacyRequest(request({ requestType: 'erasure', details: '' }));
    if (!p.ok) throw new Error('fixture');
    const t0 = Date.parse('2026-11-01T10:00:00Z');
    await acceptPrivacyRequest(h.db as never, null, p.request, { kind: 'user', userId: 'u-asha', email: 'asha@example.com' }, t0);
    const pages: string[] = [];
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      pages.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ id: 'resend-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const late = t0 + 200 * DAY_MS;
    await runFeedbackCron(h.env, late, { mail: null, fetchImpl });
    await runFeedbackCron(h.env, late + HOUR_MS, { mail: null, fetchImpl });
    const [row] = rows(h);
    expect(row.status).toBe('new');
    expect(row.resolved_at).toBeNull();
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain(String(row.id));
    expect(pages[0]).not.toContain('asha@example.com');
    const beat = h.db.rows(`SELECT ok, detail FROM cron_heartbeat WHERE job = 'feedback_purge' AND target = 'privacy' ORDER BY rowid DESC LIMIT 1`)[0];
    expect(beat).toMatchObject({ ok: 0 });
    expect(String(beat.detail)).toContain('red=1');
  });

  it('an unproven request is purged after 7 days; an open verified one never is', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const t0 = Date.parse('2026-11-01T10:00:00Z');
    const anon = parsePrivacyRequest(request({ contactEmail: 'x@example.com' }));
    const mine = parsePrivacyRequest(request({ requestType: 'erasure', details: '' }));
    if (!anon.ok || !mine.ok) throw new Error('fixture');
    await acceptPrivacyRequest(h.db as never, null, anon.request, { kind: 'anonymous' }, t0);
    await acceptPrivacyRequest(h.db as never, null, mine.request, { kind: 'user', userId: 'u-1', email: null }, t0);
    await runFeedbackCron(h.env, t0 + 8 * DAY_MS, { mail: null, fetchImpl: (async () => new Response('{}')) as typeof fetch });
    expect(rows(h).map((r) => r.status)).toEqual(['new']);
  });
});

describe('the ops move — the one way a request closes', () => {
  async function move(h: Harness, body: Record<string, unknown>) {
    return app.fetch(
      new Request('https://platform.example.test/v1/ops/feedback/move', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ops-secret' },
        body: JSON.stringify(body),
      }),
      { ...h.env, FEEDBACK_OPS_SECRET: 'ops-secret' } as never,
      CTX as never,
    );
  }

  it('new -> acknowledged -> resolved, stamping each, and a closed request takes its 400-day purge date', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const p = parsePrivacyRequest(request({ requestType: 'access' }));
    if (!p.ok) throw new Error('fixture');
    const out = await acceptPrivacyRequest(h.db as never, null, p.request, { kind: 'user', userId: 'u-1', email: null }, Date.now());
    const id = (out.body as { id: string }).id;
    expect((await move(h, { id, to: 'resolved' })).status).toBe(409);
    expect((await move(h, { id, to: 'acknowledged' })).status).toBe(200);
    expect(rows(h)[0].acknowledged_at).not.toBeNull();
    expect((await move(h, { id, to: 'resolved' })).status).toBe(200);
    const [row] = rows(h);
    expect(row.status).toBe('resolved');
    expect(Date.parse(String(row.purge_at)) - Date.parse(String(row.resolved_at))).toBe(400 * DAY_MS);
    expect((await move(h, { id, to: 'new' })).status).toBe(409);
  });
});
