// ─────────────────────────────────────────────────────────────────────────────
// conformance/mail.ts — THE MAIL PORT'S CONFORMANCE SUITE. Every adapter of
// tooling/ports/mail.json passes these scenarios, each against its OWN bytes.
//
// A suite is a scenario list plus a per-adapter fixture (tooling/ports/README.md
// §3 "Conformance"): the adapter's test hands `runMailConformance` one harness
// builder per scenario — for an HTTP adapter, a stub carrier answering with the
// vendor's documented response; for the fake, the fake scripted to answer the
// same way. 🔴 THE RUNNER THROWS WHEN A SCENARIO HAS NO FIXTURE: a missing
// fixture is never a skip, so an adapter cannot be conformant by omission.
//
// assert-ports limb 6 counts an adapter conformant when its test file CALLS
// `runMailConformance` and mail.json names no pending case for it.
//
// The scenarios, each a pure async check (exported, so the suite's own red
// controls — test/mail-conformance.test.ts — can run one against a mutated
// adapter and watch it fail):
//   send-ok        a send succeeds and returns a non-empty id, one attempt
//   idempotent     two sends under one key deliver once, with one id — or, on a
//                  transport that does not declare `idempotency`, the send is
//                  `invalid` and nothing reaches the wire
//   refused        a refused recipient is `refused`, not retryable, and NOT
//                  retried (exactly one attempt)
//   rate-limited   a 429 is `retryable`
//   server-error   a 5xx is `retryable`
//   timeout        no answer within the bound is `timeout`
//   from-stream    the From on the wire is the stream's, from the entity source
//   no-address-in-logs  no recipient or sender appears in any console line, in
//                  any outcome detail, across success and every failure
// ─────────────────────────────────────────────────────────────────────────────
import type { MailMessage, MailOutcome, MailSenders, MailStream, MailTransport } from '../../src/ports/mail';
import { MAIL_STREAMS } from '../../src/ports/mail';

export const MAIL_SCENARIOS = [
  'send-ok',
  'idempotent',
  'refused',
  'rate-limited',
  'server-error',
  'timeout',
  'from-stream',
  'no-address-in-logs',
] as const;
export type MailScenario = (typeof MAIL_SCENARIOS)[number];

/** One scenario's harness: the transport, and what reached the carrier. */
export interface MailHarness {
  readonly transport: MailTransport;
  /** Send calls that reached the carrier (HTTP requests, or the fake's attempts). */
  attempts(): number;
  /** Messages the carrier DELIVERED (a carrier honouring an idempotency key delivers once). */
  delivered(): number;
  /** The From of every request that reached the carrier, in order. */
  froms(): string[];
}

export interface MailConformanceSubject {
  /** The adapter id under test. */
  readonly adapter: string;
  /** The senders the harnesses were built with (the entity source's). */
  readonly senders: MailSenders;
  /** One harness builder per scenario; a missing one throws. */
  readonly fixtures: Partial<Record<MailScenario, () => MailHarness | Promise<MailHarness>>>;
}

/** The recipient every scenario mails. A literal in a TEST: tests are not Worker source. */
export const CONFORMANCE_RECIPIENT = 'conformance-recipient@example.test';

const fail = (scenario: string, what: string): never => {
  throw new Error(`mail conformance ${scenario}: ${what}`);
};

const msg = (stream: MailStream = 'reports', to = CONFORMANCE_RECIPIENT): MailMessage => ({
  stream,
  to: [to],
  subject: 'conformance',
  text: 'conformance body',
});

function expectFailure(scenario: string, out: MailOutcome, kind: string, retryable: boolean): void {
  if (out.ok) fail(scenario, `expected ${kind}, got ok`);
  else {
    if (out.kind !== kind) fail(scenario, `expected kind ${kind}, got ${out.kind}`);
    if (out.retryable !== retryable) fail(scenario, `expected retryable ${retryable}, got ${out.retryable}`);
  }
}

/** Run ONE scenario against one harness; throws (with the reason) when the adapter does not conform. */
export async function checkMailScenario(scenario: MailScenario, h: MailHarness, senders: MailSenders): Promise<void> {
  const t = h.transport;
  switch (scenario) {
    case 'send-ok': {
      const out = await t.send(msg());
      if (!out.ok) return fail(scenario, `expected ok, got ${out.kind} (${out.detail})`);
      if (typeof out.id !== 'string' || out.id === '') fail(scenario, 'no id returned');
      if (h.attempts() !== 1) fail(scenario, `expected 1 attempt, got ${h.attempts()}`);
      return;
    }
    case 'idempotent': {
      if (!t.capabilities.has('idempotency')) {
        const out = await t.send(msg(), { idempotencyKey: 'conformance-key' });
        expectFailure(scenario, out, 'invalid', false);
        if (h.attempts() !== 0) fail(scenario, `a transport without idempotency reached the carrier ${h.attempts()} time(s)`);
        return;
      }
      const a = await t.send(msg(), { idempotencyKey: 'conformance-key' });
      const b = await t.send(msg(), { idempotencyKey: 'conformance-key' });
      if (!a.ok || !b.ok) return fail(scenario, 'a send under an idempotency key failed');
      if (a.id !== b.id) fail(scenario, `two sends under one key returned two ids`);
      if (h.delivered() !== 1) fail(scenario, `expected 1 delivery, got ${h.delivered()}`);
      return;
    }
    case 'refused': {
      const out = await t.send(msg());
      expectFailure(scenario, out, 'refused', false);
      if (h.attempts() !== 1) fail(scenario, `a refused recipient must not be retried: ${h.attempts()} attempt(s)`);
      if (h.delivered() !== 0) fail(scenario, 'a refused message was delivered');
      return;
    }
    case 'rate-limited':
    case 'server-error': {
      const out = await t.send(msg());
      expectFailure(scenario, out, 'retryable', true);
      if (h.delivered() !== 0) fail(scenario, 'a retryable failure was delivered');
      return;
    }
    case 'timeout': {
      const out = await t.send(msg());
      expectFailure(scenario, out, 'timeout', false);
      return;
    }
    case 'from-stream': {
      for (const s of MAIL_STREAMS) {
        const out = await t.send(msg(s));
        if (!out.ok) return fail(scenario, `the ${s} stream failed: ${out.kind}`);
      }
      const seen = h.froms();
      if (seen.length !== MAIL_STREAMS.length) fail(scenario, `expected ${MAIL_STREAMS.length} requests, got ${seen.length}`);
      MAIL_STREAMS.forEach((s, i) => {
        // "match" / "no match" only: an address is never printed by a test.
        if (seen[i] !== senders[s]) fail(scenario, `the ${s} stream's From is no match for the entity source`);
      });
      return;
    }
    case 'no-address-in-logs': {
      const lines: string[] = [];
      const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
      const saved = methods.map((m) => console[m]);
      for (const m of methods) {
        console[m] = (...args: unknown[]) => {
          lines.push(args.map(String).join(' '));
        };
      }
      const details: string[] = [];
      try {
        for (let i = 0; i < 4; i++) {
          const out = await t.send(msg(MAIL_STREAMS[i % MAIL_STREAMS.length]));
          if (!out.ok) details.push(out.detail);
        }
      } finally {
        methods.forEach((m, i) => {
          console[m] = saved[i];
        });
      }
      const addresses = [CONFORMANCE_RECIPIENT, ...Object.values(senders)].flatMap((a) => {
        const bare = /<([^>]+)>/.exec(a)?.[1];
        return bare ? [a, bare] : [a];
      });
      if (details.length === 0) fail(scenario, 'the harness produced no failure, so no failure detail was examined');
      for (const text of [...lines, ...details]) {
        if (addresses.some((a) => text.includes(a))) fail(scenario, 'an address appears in a log line or an outcome detail: match');
      }
      return;
    }
  }
}

/** The test runner's two registration functions — vitest's `describe` and `it`,
 *  passed in so this module imports no runner (services/_shared/test is outside
 *  every Worker's node_modules, and tsc resolves imports from the file). */
export interface MailTestApi {
  describe(name: string, body: () => void): unknown;
  it(name: string, body: () => Promise<void>): unknown;
}

/** The entry point an adapter's test CALLS, with vitest's `describe` and `it`.
 *  Throws on a missing fixture. */
export function runMailConformance(subject: MailConformanceSubject, t: MailTestApi): void {
  const missing = MAIL_SCENARIOS.filter((s) => typeof subject.fixtures[s] !== 'function');
  if (missing.length) {
    throw new Error(`runMailConformance(${subject.adapter}): no fixture for ${missing.join(', ')} — a missing fixture is never a skip`);
  }
  t.describe(`mail port conformance — ${subject.adapter}`, () => {
    for (const s of MAIL_SCENARIOS) {
      t.it(s, async () => {
        const h = await (subject.fixtures[s] as () => MailHarness | Promise<MailHarness>)();
        await checkMailScenario(s, h, subject.senders);
      });
    }
  });
}
