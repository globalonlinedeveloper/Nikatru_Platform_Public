// mail-conformance.test.ts — the mail conformance suite must be able to FAIL.
//
// Each case runs one scenario of conformance/mail.ts against a MUTATED adapter
// and expects the scenario to throw (vacuous-03: an assertion that cannot fail
// is worse than none). The green control is the fake itself, which passes
// every scenario in mail-fake.conformance.test.ts.
import { describe, expect, it } from 'vitest';
import { createFakeMail } from '../src/ports/fakes/mail';
import type { MailSenders, MailTransport } from '../src/ports/mail';
import { CONFORMANCE_RECIPIENT, checkMailScenario, runMailConformance, type MailHarness } from './conformance/mail';

const SENDERS: MailSenders = { reports: 'Fixture reports <reports@fixture.test>', reminders: 'Fixture reminders <reminders@fixture.test>', feedback: 'Fixture support <support@fixture.test>' };

/** A harness over `transport`, counted by the fake underneath it. */
function over(transport: MailTransport, f: ReturnType<typeof createFakeMail>): MailHarness {
  return { transport, attempts: () => f.attempts, delivered: () => f.sent.length, froms: () => f.sent.map((m) => m.from) };
}

describe('the mail conformance suite reddens', () => {
  it('green control: the unmutated fake passes `refused`', async () => {
    const f = createFakeMail(SENDERS);
    f.refuse(CONFORMANCE_RECIPIENT);
    await expect(checkMailScenario('refused', over(f, f), SENDERS)).resolves.toBeUndefined();
  });

  it('🔴 a fake that RETRIES a refused recipient fails `refused`', async () => {
    const f = createFakeMail(SENDERS);
    f.refuse(CONFORMANCE_RECIPIENT);
    const retrying: MailTransport = {
      id: 'fake',
      capabilities: f.capabilities,
      async send(m, o) {
        const first = await f.send(m, o);
        return first.ok ? first : f.send(m, o);
      },
    };
    await expect(checkMailScenario('refused', over(retrying, f), SENDERS)).rejects.toThrow(/must not be retried: 2 attempt/);
  });

  it('🔴 a transport that calls a refusal retryable fails `refused`', async () => {
    const f = createFakeMail(SENDERS);
    f.refuse(CONFORMANCE_RECIPIENT);
    const mislabel: MailTransport = {
      id: 'fake',
      capabilities: f.capabilities,
      async send(m, o) {
        const out = await f.send(m, o);
        return out.ok ? out : { ...out, kind: 'retryable', retryable: true };
      },
    };
    await expect(checkMailScenario('refused', over(mislabel, f), SENDERS)).rejects.toThrow(/expected kind refused/);
  });

  it('🔴 a transport that puts the recipient in its detail fails `no-address-in-logs`', async () => {
    const f = createFakeMail(SENDERS);
    f.refuse(CONFORMANCE_RECIPIENT);
    const leaky: MailTransport = {
      id: 'fake',
      capabilities: f.capabilities,
      async send(m, o) {
        const out = await f.send(m, o);
        return out.ok ? out : { ...out, detail: `${out.detail} for ${m.to.join(',')}` };
      },
    };
    await expect(checkMailScenario('no-address-in-logs', over(leaky, f), SENDERS)).rejects.toThrow(/an address appears/);
  });

  it('🔴 a transport that logs the recipient fails `no-address-in-logs`', async () => {
    const f = createFakeMail(SENDERS);
    f.failNext('refused');
    const chatty: MailTransport = {
      id: 'fake',
      capabilities: f.capabilities,
      async send(m, o) {
        console.error(`sending to ${m.to[0]}`);
        return f.send(m, o);
      },
    };
    await expect(checkMailScenario('no-address-in-logs', over(chatty, f), SENDERS)).rejects.toThrow(/an address appears/);
  });

  it('🔴 a fake built with the wrong senders fails `from-stream`', async () => {
    const f = createFakeMail({ reports: SENDERS.reminders, reminders: SENDERS.reminders, feedback: SENDERS.feedback });
    await expect(checkMailScenario('from-stream', over(f, f), SENDERS)).rejects.toThrow(/reports stream's From is no match/);
  });

  it('🔴 a transport that drops the idempotency key fails `idempotent`', async () => {
    const f = createFakeMail(SENDERS);
    const forgetful: MailTransport = { id: 'fake', capabilities: f.capabilities, send: (m) => f.send(m) };
    await expect(checkMailScenario('idempotent', over(forgetful, f), SENDERS)).rejects.toThrow(/two ids|expected 1 delivery/);
  });

  it('🔴 the runner THROWS on a missing fixture — never a skip', () => {
    const noop = { describe: () => {}, it: () => {} };
    expect(() => runMailConformance({ adapter: 'partial', senders: SENDERS, fixtures: { 'send-ok': () => over(createFakeMail(SENDERS), createFakeMail(SENDERS)) } }, noop)).toThrow(
      /no fixture for idempotent, refused/,
    );
  });
});
