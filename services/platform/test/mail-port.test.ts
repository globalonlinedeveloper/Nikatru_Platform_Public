// mail-port.test.ts — the composition root's mail table (src/ports.ts) is the
// registry's (tooling/ports/mail.json `streams`), each stream sends with its own
// key, the senders are the entity source's, and the callers work against ANY
// MailTransport — here the fake, which is what every mail test uses unless it
// asserts Resend's wire shape (report.test.ts and reminder-mail.test.ts do).
import { afterEach, describe, expect, it, vi } from 'vitest';
import MAIL_RAW from '../../../tooling/ports/mail.json?raw';
import HOUSE_RAW from '../../../tooling/house-identity.json?raw';
import { createFakeMail } from '../../_shared/src/ports/fakes/mail';
import { MAIL_STREAMS } from '../../_shared/src/ports/mail';
import { MAIL_SENDERS, MAIL_STREAM_TABLE, mailFor, mailSecretFor } from '../src/ports';
import { notifyReport, REPORT_NOTICE_TO } from '../src/lib/report-notify';
import { RESEND_EMAILS_URL } from '../src/adapters/mail/resend';
import { realPlatformDb } from './harness';

const MAIL = JSON.parse(MAIL_RAW) as {
  adapters: Array<{ id: string; status: string }>;
  streams: Record<string, { adapter: string; secrets: string[]; from: string | null; to?: string }>;
};
const HOUSE = JSON.parse(HOUSE_RAW) as Record<string, unknown>;
const at = (path: string): unknown => {
  let node: unknown = HOUSE;
  for (const k of path.split('.')) node = (node as Record<string, unknown> | undefined)?.[k];
  return (node as { value?: unknown } | undefined)?.value;
};

afterEach(() => vi.unstubAllGlobals());

describe('src/ports.ts is tooling/ports/mail.json', () => {
  it('every Worker stream, its adapter and its secrets in order — and nothing else', () => {
    const external = new Set(MAIL.adapters.filter((a) => a.status === 'external').map((a) => a.id));
    const worker = Object.fromEntries(
      Object.entries(MAIL.streams)
        .filter(([, s]) => !external.has(s.adapter))
        .map(([k, s]) => [k, { adapter: s.adapter, secrets: s.secrets }]),
    );
    expect(MAIL_STREAM_TABLE).toEqual(worker);
    expect([...MAIL_STREAMS].sort()).toEqual(Object.keys(worker).sort());
  });

  it('each stream\'s From is the entity source\'s, through the generated module (match / no match only)', () => {
    for (const s of MAIL_STREAMS) {
      const want = at(MAIL.streams[s].from as string);
      expect(MAIL_SENDERS[s] === want ? 'match' : 'no match').toBe('match');
    }
    expect(REPORT_NOTICE_TO === at(MAIL.streams.reports.to as string) ? 'match' : 'no match').toBe('match');
  });
});

describe('mailFor — a key per stream', () => {
  async function bearerOf(stream: 'reports' | 'reminders', env: Record<string, string | undefined>): Promise<string | null> {
    let auth: string | null = null;
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization;
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    }) as typeof fetch;
    const t = mailFor(stream, env, fetchImpl);
    if (!t) return null;
    await t.send({ stream, to: ['a@example.test'], subject: 's', text: 't' });
    return auth;
  }

  it('🔴 with both keys set, reports and reminders send with DIFFERENT keys', async () => {
    const env = { RESEND_API_KEY: 're_reports', RESEND_REMINDERS_API_KEY: 're_reminders' };
    expect(await bearerOf('reports', env)).toBe('Bearer re_reports');
    expect(await bearerOf('reminders', env)).toBe('Bearer re_reminders');
    expect(mailSecretFor('reminders', env)).toBe('RESEND_REMINDERS_API_KEY');
  });

  it('without a reminders key, reminders use the reports key (under the digest\'s own cap)', async () => {
    const env = { RESEND_API_KEY: 're_reports' };
    expect(await bearerOf('reminders', env)).toBe('Bearer re_reports');
    expect(mailSecretFor('reminders', env)).toBe('RESEND_API_KEY');
  });

  it('the reminders key never serves reports', async () => {
    expect(mailFor('reports', { RESEND_REMINDERS_API_KEY: 're_reminders' })).toBeNull();
  });

  it('no key at all is null — the caller records "not configured"', () => {
    expect(mailFor('reports', {})).toBeNull();
    expect(mailFor('reminders', {})).toBeNull();
  });

  it('the transport resolves the global fetch at SEND time, so a stubbed fetch is the one used', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    }));
    const t = mailFor('reports', { RESEND_API_KEY: 're_k' });
    await t?.send({ stream: 'reports', to: ['a@example.test'], subject: 's', text: 't' });
    expect(calls).toEqual([RESEND_EMAILS_URL]);
  });
});

describe('notifyReport against the fake — the caller, not the carrier', () => {
  const report = { id: 'r-1', appId: 'subscriptiontracker', reason: 'other', createdAt: new Date().toISOString() };

  it('sends ONE message on the reports stream to support, and stamps the claim', async () => {
    const db = realPlatformDb();
    db.db.exec(`INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at) VALUES ('r-1', 'u', 'subscriptiontracker', 'other', 'c', '${report.createdAt}')`);
    const mail = createFakeMail(MAIL_SENDERS);
    expect(await notifyReport(db as unknown as D1Database, mail, report)).toEqual({ sent: true });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].stream).toBe('reports');
    expect(mail.sent[0].to).toEqual([REPORT_NOTICE_TO]);
    expect(db.count('content_reports', 'notified_at IS NOT NULL')).toBe(1);
  });

  it('a refusal releases the claim; a timeout keeps it — and no address reaches a log line', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' ')));
    for (const [kind, stamped] of [['refused', 0], ['timeout', 1]] as const) {
      const db = realPlatformDb();
      db.db.exec(`INSERT INTO content_reports (id, user_id, app_id, reason, content_ref, created_at) VALUES ('r-1', 'u', 'subscriptiontracker', 'other', 'c', '${report.createdAt}')`);
      const mail = createFakeMail(MAIL_SENDERS);
      mail.failNext(kind);
      expect(await notifyReport(db as unknown as D1Database, mail, report)).toEqual({ sent: false, why: 'send_failed' });
      expect(db.count('content_reports', 'notified_at IS NOT NULL')).toBe(stamped);
    }
    vi.restoreAllMocks();
    expect(lines.length).toBeGreaterThan(0);
    const addresses = [REPORT_NOTICE_TO, ...Object.values(MAIL_SENDERS)];
    expect(lines.some((l) => addresses.some((a) => l.includes(a))) ? 'match' : 'no match').toBe('no match');
  });
});
