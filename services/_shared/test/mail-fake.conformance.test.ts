// mail-fake.conformance.test.ts — the mail fake (src/ports/fakes/mail.ts) passes
// the same conformance suite as every real adapter, scripted to answer each
// scenario the way a carrier would. Senders here are fixture values: the fake is
// built by whoever uses it, and the suite only asks that From follow the stream.
import { describe, expect, it } from 'vitest';
import { createFakeMail, type FakeMailTransport } from '../src/ports/fakes/mail';
import type { MailSenders } from '../src/ports/mail';
import { CONFORMANCE_RECIPIENT, runMailConformance, type MailHarness } from './conformance/mail';

const SENDERS: MailSenders = { reports: 'Fixture reports <reports@fixture.test>', reminders: 'Fixture reminders <reminders@fixture.test>', feedback: 'Fixture support <support@fixture.test>' };

function harness(script: (f: FakeMailTransport) => void = () => {}): MailHarness {
  const f = createFakeMail(SENDERS);
  script(f);
  return {
    transport: f,
    attempts: () => f.attempts,
    delivered: () => f.sent.length,
    froms: () => f.sent.map((m) => m.from),
  };
}

runMailConformance({
  adapter: 'fake',
  senders: SENDERS,
  fixtures: {
    'send-ok': () => harness(),
    idempotent: () => harness(),
    refused: () => harness((f) => f.refuse(CONFORMANCE_RECIPIENT)),
    'rate-limited': () => harness((f) => f.failNext('retryable', 429)),
    'server-error': () => harness((f) => f.failNext('retryable', 503)),
    timeout: () => harness((f) => f.failNext('timeout')),
    'from-stream': () => harness(),
    'no-address-in-logs': () => harness((f) => f.failNext('refused')),
  },
}, { describe, it });

describe('the mail fake records what it was asked to send', () => {
  it('ids are deterministic, and the record carries the stream From', async () => {
    const f = createFakeMail(SENDERS);
    const a = await f.send({ stream: 'reports', to: ['x@example.test'], subject: 's', text: 't' });
    const b = await f.send({ stream: 'reminders', to: ['x@example.test'], subject: 's', text: 't', headers: { 'List-Unsubscribe': '<u>' } });
    expect(a).toEqual({ ok: true, id: 'fake-mail-1' });
    expect(b).toEqual({ ok: true, id: 'fake-mail-2' });
    expect(f.sent.map((m) => m.from)).toEqual([SENDERS.reports, SENDERS.reminders]);
    expect(f.sent[1].headers).toEqual({ 'List-Unsubscribe': '<u>' });
  });
});
