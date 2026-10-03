import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import { runFeedbackCron } from '../src/feedback/cron';
import { MOVES, STATUSES } from '../src/feedback/lifecycle';
import { MAX_NOTICES_PER_RUN } from '../src/feedback/notify';
import { createFakeMail } from '../../_shared/src/ports/fakes/mail';
import { MAIL_FROM } from '../src/generated/entity';
import { harness, validReport, type Harness } from './feedback-harness';

// ─────────────────────────────────────────────────────────────────────────────
// triage.test.ts — lane feedback-triage, Do 3, 4 and 5: the status lifecycle
// the Worker enforces, the one "fixed in version X" notice, the receipt, and
// suppression. Mail goes through the fake mail port (the cron) or a stubbed
// `fetch` under the real Resend adapter (the receipt, sent from the route).
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = 'ops-secret-for-tests-only';

/** A ctx whose waitUntil work the test can await. */
function ctx() {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {}, settle: () => Promise.all(pending) };
}

async function submit(h: Harness, over: Record<string, unknown> = {}, c = ctx()): Promise<string> {
  const res = await app.fetch(
    new Request('https://feedback.example.test/v1/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validReport(over)),
    }),
    h.env as never,
    c as never,
  );
  expect(res.status).toBe(201);
  await c.settle();
  return ((await res.json()) as { id: string }).id;
}

function move(h: Harness, body: Record<string, unknown>, secret: string | null = SECRET, origin?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers.Authorization = `Bearer ${secret}`;
  if (origin) headers.Origin = origin;
  return app.fetch(
    new Request('https://feedback.example.test/v1/ops/feedback/move', { method: 'POST', headers, body: JSON.stringify(body) }),
    h.env as never,
    ctx() as never,
  );
}

async function walkToFixed(h: Harness, id: string, version = '1.4.1') {
  for (const step of [{ to: 'triaged' }, { to: 'in-fix', pr: 1201 }, { to: 'fixed', version }]) {
    const res = await move(h, { id, ...step });
    expect(res.status, JSON.stringify(step)).toBe(200);
  }
}

const statusOf = (h: Harness, id: string) => (h.db.rows('SELECT status FROM feedback_reports WHERE id = ?', id) as { status: string }[])[0]?.status;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('🔴 [Do 3] the status lifecycle is the Worker\'s, not the caller\'s', () => {
  it('a jump new -> notified is refused, and nothing changes', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h);
    const res = await move(h, { id, to: 'notified' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'cron_only', from: 'new', to: 'notified' });
    expect(statusOf(h, id)).toBe('new');
  });

  it('a jump the graph does not list (new -> fixed) is refused as illegal', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h);
    const res = await move(h, { id, to: 'fixed', version: '1.4.1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'illegal_move' });
    expect(statusOf(h, id)).toBe('new');
  });

  it('no status reaches `notified` through the ops route, from anywhere', () => {
    // The graph lists fixed -> notified for the CRON; the ops check refuses it first.
    for (const s of STATUSES) expect(MOVES[s].filter((t) => t === 'notified').length).toBe(s === 'fixed' ? 1 : 0);
  });

  it('the legal walk writes every move with its time and writer, and the PR and version', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h);
    await walkToFixed(h, id, '1.4.1');
    const [row] = (h.db.rows(
      'SELECT status, fix_pr, fixed_version, status_history, status_at FROM feedback_reports WHERE id = ?',
      id,
    ) as { status: string; fix_pr: number; fixed_version: string; status_history: string; status_at: string }[]);
    expect(row).toMatchObject({ status: 'fixed', fix_pr: 1201, fixed_version: '1.4.1' });
    const history = JSON.parse(row.status_history) as { from: string; to: string; at: string; by: string }[];
    expect(history.map((e) => `${e.from}->${e.to}:${e.by}`)).toEqual(['new->triaged:ops', 'triaged->in-fix:ops', 'in-fix->fixed:ops']);
    for (const e of history) expect(e.at).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('each move names what it needs: in-fix a PR, fixed a version, duplicate a real report', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h);
    expect((await move(h, { id, to: 'triaged' })).status).toBe(200);
    expect(await (await move(h, { id, to: 'in-fix' })).json()).toMatchObject({ error: 'required', field: 'pr' });
    expect(await (await move(h, { id, to: 'duplicate', duplicateOf: 'FB-0000000000' })).json()).toMatchObject({ field: 'duplicateOf' });
    const other = await submit(h);
    expect((await move(h, { id, to: 'duplicate', duplicateOf: other })).status).toBe(200);
    expect(statusOf(h, id)).toBe('duplicate');
  });

  it('the route is closed without the secret: 503 unset, 401 wrong, 403 from a browser', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const unset = harness();
    const id = await submit(unset);
    expect((await move(unset, { id, to: 'triaged' })).status).toBe(503);
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    const id2 = await submit(h);
    expect((await move(h, { id: id2, to: 'triaged' }, 'not-the-secret')).status).toBe(401);
    expect((await move(h, { id: id2, to: 'triaged' }, null)).status).toBe(401);
    expect((await move(h, { id: id2, to: 'triaged' }, SECRET, 'https://nikatru.com')).status).toBe(403);
    expect(statusOf(h, id2)).toBe('new');
  });
});

describe('🔴 [Do 4] "fixed in version X": one mail, to a consenting reporter only', () => {
  const consenting = { contactEmail: 'asha@example.com', consent: { reply: false, notifyFixed: true } };

  it('a consenting report gets exactly one mail across two cron runs, and becomes `notified`', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h, consenting);
    await walkToFixed(h, id, '1.4.1');
    const mail = createFakeMail(MAIL_FROM);
    await runFeedbackCron(h.env, Date.now(), { mail });
    await runFeedbackCron(h.env, Date.now(), { mail });
    expect(mail.sent).toHaveLength(1);
    const [m] = mail.sent;
    expect(m.to).toEqual(['asha@example.com']);
    expect(m.from).toBe(MAIL_FROM.feedback);
    expect(m.subject).toBe(`Fixed in version 1.4.1: your report ${id}`);
    expect(m.text).toContain('https://nikatru.com/apps/subscriptiontracker');
    expect(m.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m.idempotencyKey).toBe(`feedback-fixed-${id}`);
    expect(statusOf(h, id)).toBe('notified');
  });

  it('a report without the tick gets none, and stays `fixed`', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h, { contactEmail: 'asha@example.com', consent: { reply: true, notifyFixed: false } });
    await walkToFixed(h, id);
    const mail = createFakeMail(MAIL_FROM);
    await runFeedbackCron(h.env, Date.now(), { mail });
    expect(mail.sent).toHaveLength(0);
    expect(statusOf(h, id)).toBe('fixed');
  });

  it('a suppressed address gets none, through the one-click unsubscribe', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const first = await submit(h, consenting);
    await walkToFixed(h, first);
    const mail = createFakeMail(MAIL_FROM);
    await runFeedbackCron(h.env, Date.now(), { mail });
    const link = /unsubscribe\?t=([A-Za-z0-9_-]{43})/.exec(mail.sent[0].text)?.[1];
    expect(link).toBeDefined();
    // GET changes nothing; the POST (RFC 8058) suppresses.
    const page = await app.fetch(new Request(`https://feedback.example.test/v1/feedback/unsubscribe?t=${link}`), h.env as never, ctx() as never);
    expect(page.status).toBe(200);
    expect(h.db.rows('SELECT * FROM feedback_mail_suppressed')).toHaveLength(0);
    const post = await app.fetch(
      new Request(`https://feedback.example.test/v1/feedback/unsubscribe?t=${link}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      h.env as never,
      ctx() as never,
    );
    expect(post.status).toBe(200);
    const stored = (h.db.rows('SELECT address_hash FROM feedback_mail_suppressed') as { address_hash: string }[]);
    expect(stored).toHaveLength(1);
    expect(stored[0].address_hash).toMatch(/^[0-9a-f]{64}$/);
    // A second report from the same address, fixed later, is never mailed.
    const second = await submit(h, { ...consenting, contactEmail: 'ASHA@example.com' });
    await walkToFixed(h, second, '1.5.0');
    await runFeedbackCron(h.env, Date.now(), { mail });
    expect(mail.sent).toHaveLength(1);
    expect(statusOf(h, second)).toBe('fixed');
  });

  it('a malformed or unknown token is refused, and suppresses nothing', async () => {
    const h = harness();
    for (const t of ['short', 'A'.repeat(43)]) {
      const res = await app.fetch(new Request(`https://feedback.example.test/v1/feedback/unsubscribe?t=${t}`, { method: 'POST' }), h.env as never, ctx() as never);
      expect(res.status).toBe(404);
    }
    expect(h.db.rows('SELECT * FROM feedback_mail_suppressed')).toHaveLength(0);
  });

  it('the notice is in the report\'s own locale (diagnostics.locale), English otherwise', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const base = validReport();
    const ta = await submit(h, { ...consenting, diagnostics: { ...(base.diagnostics as object), locale: 'ta-IN' } });
    const xx = await submit(h, { ...consenting, contactEmail: 'b@example.com', diagnostics: { ...(base.diagnostics as object), locale: 'xx' } });
    await walkToFixed(h, ta, '2.0.0');
    await walkToFixed(h, xx, '2.0.0');
    const mail = createFakeMail(MAIL_FROM);
    await runFeedbackCron(h.env, Date.now(), { mail });
    const subjects = Object.fromEntries(mail.sent.map((m) => [m.to[0], m.subject]));
    expect(subjects['asha@example.com']).toBe(`பதிப்பு 2.0.0-இல் சரிசெய்யப்பட்டது: உங்கள் புகார் ${ta}`);
    expect(subjects['b@example.com']).toBe(`Fixed in version 2.0.0: your report ${xx}`);
  });

  it('a send with no answer keeps its claim: never mailed twice, recorded as failed', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h, consenting);
    await walkToFixed(h, id);
    const mail = createFakeMail(MAIL_FROM);
    mail.failNext('timeout');
    await runFeedbackCron(h.env, Date.now(), { mail });
    await runFeedbackCron(h.env, Date.now(), { mail });
    expect(mail.attempts).toBe(1);
    expect(statusOf(h, id)).toBe('notified');
    const beats = (h.db.rows("SELECT ok FROM cron_heartbeat WHERE target = 'notices' ORDER BY ran_at") as { ok: number }[]);
    expect(beats.map((b) => b.ok)).toEqual([0, 1]);
  });

  it('without a mail key nothing is claimed: the report waits at `fixed`', async () => {
    const h = harness({ FEEDBACK_OPS_SECRET: SECRET });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h, consenting);
    await walkToFixed(h, id);
    await runFeedbackCron(h.env, Date.now(), { mail: null });
    expect(statusOf(h, id)).toBe('fixed');
    expect(MAX_NOTICES_PER_RUN).toBeGreaterThan(0);
  });
});

describe('🔴 [Do 5] the receipt: only with "you may reply to me"', () => {
  function stubResend() {
    const sent: { to: string[]; subject: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.resend.com/emails');
        sent.push(JSON.parse(String(init?.body)) as { to: string[]; subject: string });
        return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
      }),
    );
    return sent;
  }

  it('one receipt with the report id when ticked; none without the tick', async () => {
    const sent = stubResend();
    const h = harness({ RESEND_API_KEY: 're_test' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const id = await submit(h, { contactEmail: 'asha@example.com', consent: { reply: true, notifyFixed: false } });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['asha@example.com']);
    expect(sent[0].subject).toBe(`We got your report ${id}`);
    await submit(h, { contactEmail: 'ravi@example.com', consent: { reply: false, notifyFixed: true } });
    await submit(h, { contactEmail: 'ravi@example.com', consent: { reply: false, notifyFixed: false } });
    expect(sent).toHaveLength(1);
  });

  it('a replayed submit (same idempotency key) sends no second receipt', async () => {
    const sent = stubResend();
    const h = harness({ RESEND_API_KEY: 're_test' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const body = { idempotencyKey: 'key-replay-0001', contactEmail: 'asha@example.com', consent: { reply: true, notifyFixed: false } };
    await submit(h, body);
    const c = ctx();
    const again = await app.fetch(
      new Request('https://feedback.example.test/v1/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validReport(body)),
      }),
      h.env as never,
      c as never,
    );
    expect(again.status).toBe(200);
    await c.settle();
    expect(sent).toHaveLength(1);
  });

  it('the contact address is kept only with a box that needs it', async () => {
    const h = harness();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await submit(h, { contactEmail: 'a@example.com', consent: { reply: false, notifyFixed: false } });
    await submit(h, { contactEmail: 'b@example.com', consent: { reply: false, notifyFixed: true } });
    expect((h.db.rows('SELECT contact_email FROM feedback_reports ORDER BY contact_email') as { contact_email: string | null }[]).map((r) => r.contact_email)).toEqual([
      null,
      'b@example.com',
    ]);
  });
});
