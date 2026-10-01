// ─────────────────────────────────────────────────────────────────────────────
// fakes/mail.ts — THE MAIL FAKE. A MailTransport that records what it was asked
// to send and sends nothing.
//
// Selectable in `test` and `sandbox` only (tooling/ports/mail.json, the `fake`
// row; assert-ports limb 7 refuses it in live). No Worker module imports it —
// only tests do, so it is not in any bundle.
//
// Deterministic: ids are `fake-mail-1`, `fake-mail-2`, … in send order, and a
// second send under an idempotency key returns the first send's id without
// recording a second message. A test scripts a failure with `refuse(address)`
// (every send to it is `refused`) or `failNext(kind)` (the next send only).
// It passes the same conformance suite as every real adapter
// (services/_shared/test/mail-fake.conformance.test.ts).
// ─────────────────────────────────────────────────────────────────────────────
import {
  type MailCapability,
  type MailMessage,
  type MailOutcome,
  type MailSendOptions,
  type MailSenders,
  type MailStream,
  type MailTransport,
  preflightOutcome,
} from '../mail';

/** One message the fake accepted, with the From it resolved for its stream. */
export interface RecordedMail {
  readonly id: string;
  readonly stream: MailStream;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
}

export interface FakeMailTransport extends MailTransport {
  /** Every message accepted, in order. */
  readonly sent: readonly RecordedMail[];
  /** Every send call that reached the (pretend) wire, accepted or not. */
  readonly attempts: number;
  /** Every send to this address is refused. */
  refuse(address: string): void;
  /** The next send resolves to this failure instead of being accepted. */
  failNext(kind: 'refused' | 'retryable' | 'timeout', status?: number): void;
}

const CARRIER = 'fake mail';

export function createFakeMail(senders: MailSenders): FakeMailTransport {
  const sent: RecordedMail[] = [];
  const refused = new Set<string>();
  const byKey = new Map<string, string>();
  const capabilities: ReadonlySet<MailCapability> = new Set<MailCapability>(['idempotency']);
  let next: { kind: 'refused' | 'retryable' | 'timeout'; status?: number } | null = null;
  let attempts = 0;
  let seq = 0;

  return {
    id: 'fake',
    capabilities,
    get sent() {
      return sent;
    },
    get attempts() {
      return attempts;
    },
    refuse(address: string) {
      refused.add(address);
    },
    failNext(kind, status) {
      next = { kind, status };
    },
    async send(message: MailMessage, options?: MailSendOptions): Promise<MailOutcome> {
      const pre = preflightOutcome(CARRIER, capabilities, senders, message, options);
      if (pre) return pre;
      const key = options?.idempotencyKey;
      if (key !== undefined && byKey.has(key)) return { ok: true, id: byKey.get(key) as string };
      attempts++;
      if (next) {
        const { kind, status } = next;
        next = null;
        if (kind === 'timeout') return { ok: false, kind, retryable: false, detail: `${CARRIER} not reached: no answer within the send bound` };
        const s = status ?? (kind === 'retryable' ? 503 : 422);
        return { ok: false, kind, retryable: kind === 'retryable', status: s, detail: `${CARRIER} answered ${s}` };
      }
      if (message.to.some((a) => refused.has(a))) {
        return { ok: false, kind: 'refused', retryable: false, status: 422, detail: `${CARRIER} answered 422` };
      }
      const id = `fake-mail-${++seq}`;
      sent.push({
        id,
        stream: message.stream,
        from: senders[message.stream],
        to: [...message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
        ...(key === undefined ? {} : { idempotencyKey: key }),
      });
      if (key !== undefined) byKey.set(key, id);
      return { ok: true, id };
    },
  };
}
