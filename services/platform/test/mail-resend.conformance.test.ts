// mail-resend.conformance.test.ts — the Resend adapter (src/adapters/mail/resend.ts)
// passes the mail port's conformance suite against Resend's own bytes.
//
// Each fixture is a stub carrier answering as Resend's API reference documents
// (https://resend.com/docs/api-reference/emails/send-email and
// https://resend.com/docs/api-reference/errors): 200 `{ "id": … }`, a 422
// `validation_error` for a recipient it will not take, 429
// `rate_limit_exceeded`, 500 `application_error`, and the `Idempotency-Key`
// header honoured once per key. The stub reads the wire the adapter wrote, so a
// dropped header or a wrong From fails here, not in production.
import { describe, expect, it } from 'vitest';
import { runMailConformance, type MailHarness } from '../../_shared/test/conformance/mail';
import { createResendMail, RESEND_EMAILS_URL } from '../src/adapters/mail/resend';
import { MAIL_SENDERS } from '../src/ports';

type Answer = number | 'hang';

/** A Resend stub that answers each request with the next of `answers` (the last repeats). */
function resendStub(answers: Answer[]): MailHarness {
  let attempts = 0;
  let delivered = 0;
  const froms: string[] = [];
  const keys = new Map<string, string>();
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== RESEND_EMAILS_URL) throw new Error(`unexpected URL ${String(url)}`);
    attempts++;
    const body = JSON.parse(String(init?.body)) as { from: string };
    froms.push(body.from);
    const answer = answers[Math.min(attempts - 1, answers.length - 1)];
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    if (answer !== 200) {
      const name = answer === 422 ? 'validation_error' : answer === 429 ? 'rate_limit_exceeded' : 'application_error';
      return new Response(JSON.stringify({ statusCode: answer, name, message: 'stub' }), { status: answer });
    }
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'];
    if (key !== undefined && keys.has(key)) return new Response(JSON.stringify({ id: keys.get(key) }), { status: 200 });
    delivered++;
    const id = `re-${delivered}`;
    if (key !== undefined) keys.set(key, id);
    return new Response(JSON.stringify({ id }), { status: 200 });
  }) as typeof fetch;
  return {
    transport: createResendMail({ apiKey: 're_conformance', senders: MAIL_SENDERS, fetchImpl, timeoutMs: 20 }),
    attempts: () => attempts,
    delivered: () => delivered,
    froms: () => froms,
  };
}

runMailConformance({
  adapter: 'resend',
  senders: MAIL_SENDERS,
  fixtures: {
    'send-ok': () => resendStub([200]),
    idempotent: () => resendStub([200]),
    refused: () => resendStub([422]),
    'rate-limited': () => resendStub([429]),
    'server-error': () => resendStub([500]),
    timeout: () => resendStub(['hang']),
    'from-stream': () => resendStub([200]),
    'no-address-in-logs': () => {
      const seq: Answer[] = [200, 422, 503, 'hang'];
      return resendStub(seq);
    },
  },
}, { describe, it });

describe("the Resend adapter's wire — the shape moved verbatim from sendResendMail", () => {
  it('POSTs the from/to/subject/text body with a Bearer key, and the key header only when asked', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), init: init as RequestInit });
      return new Response(JSON.stringify({ id: 'x' }), { status: 200 });
    }) as typeof fetch;
    const t = createResendMail({ apiKey: 're_k', senders: MAIL_SENDERS, fetchImpl });
    await t.send({ stream: 'reports', to: ['a@example.test'], subject: 's', text: 't' });
    await t.send({ stream: 'reminders', to: ['a@example.test'], subject: 's', text: 't', html: 'h', headers: { 'List-Unsubscribe': '<u>' } }, { idempotencyKey: 'k1' });
    expect(seen[0].url).toBe(RESEND_EMAILS_URL);
    expect(seen[0].init.method).toBe('POST');
    expect(seen[0].init.headers).toEqual({ Authorization: 'Bearer re_k', 'Content-Type': 'application/json' });
    expect(String(seen[0].init.body)).toBe(JSON.stringify({ from: MAIL_SENDERS.reports, to: ['a@example.test'], subject: 's', text: 't' }));
    expect(seen[0].init.signal).toBeInstanceOf(AbortSignal);
    expect((seen[1].init.headers as Record<string, string>)['Idempotency-Key']).toBe('k1');
    expect(String(seen[1].init.body)).toBe(
      JSON.stringify({ from: MAIL_SENDERS.reminders, to: ['a@example.test'], subject: 's', text: 't', html: 'h', headers: { 'List-Unsubscribe': '<u>' } }),
    );
  });

  it('a 2xx with an unreadable body is still ok — the mail was accepted, so no caller sends it twice', async () => {
    const t = createResendMail({ apiKey: 're_k', senders: MAIL_SENDERS, fetchImpl: (async () => new Response('not json', { status: 200 })) as typeof fetch });
    const out = await t.send({ stream: 'reports', to: ['a@example.test'], subject: 's', text: 't' });
    expect(out.ok).toBe(true);
  });
});
