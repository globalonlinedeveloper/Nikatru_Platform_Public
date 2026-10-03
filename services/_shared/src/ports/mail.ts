// ─────────────────────────────────────────────────────────────────────────────
// ports/mail.ts — THE MAIL PORT. What a Worker says when it sends a message,
// and nothing about who carries it.
//
// The standard is tooling/ports/README.md; the registry is
// tooling/ports/mail.json (streams, secrets by NAME, senders by entity-source
// PATH); the conformance suite every adapter passes is
// services/_shared/test/conformance/mail.ts (`runMailConformance`).
//
// 🔴 A MESSAGE NAMES ITS STREAM, NEVER ITS SENDER. The From address of every
// stream is a business fact in tooling/house-identity.json (`mail.from.<stream>`),
// rendered into each Worker's src/generated/entity.ts; the adapter is built with
// that table and sets From from `stream`. So a caller cannot mail from an
// address the registry does not know, and a sender change is an entity edit.
//
// 🔴 OUTCOMES, NEVER THROWS ACROSS THE PORT. Every send resolves to one of:
//   · ok         — the carrier accepted it; `id` is the carrier's message id.
//   · refused    — the carrier ANSWERED and will not carry it (a bad recipient,
//                  an unverified sender, a bad request). Never retried: the same
//                  message gets the same answer.
//   · retryable  — the carrier ANSWERED "not now" (429, 5xx). Not retried HERE;
//                  the caller's ledger decides when (the reminder digest's next
//                  night).
//   · timeout    — NO ANSWER (the bound passed, or the connection failed). The
//                  message may have been delivered, so a caller that claims
//                  before it sends KEEPS its claim — at most once is the safe
//                  direction for mail.
//   · invalid    — the transport cannot carry the message as asked (a stream
//                  with no sender, an idempotency key on a transport without
//                  `idempotency`). Nothing was sent.
// `refused`, `retryable` and `invalid` are definite: nothing was delivered.
//
// 🔴 NO ADDRESS IN A DETAIL. `detail` is printed into heartbeat rows and console
// lines, so it carries the carrier and the status — never a recipient, never a
// sender, never the carrier's response body (which may echo either). The
// conformance suite holds every adapter to it.
//
// Types and pure helpers only: no vendor import, no bare import (see
// services/_shared/src/health.ts's header for why nothing here may carry one).
// ─────────────────────────────────────────────────────────────────────────────

/** Every stream a Worker sends on. `auth` mail is GoTrue's SMTP on Box C and
 *  never passes through this port (tooling/ports/mail.json, the `smtp` row). */
export const MAIL_STREAMS = ['reports', 'reminders', 'feedback'] as const;
export type MailStream = (typeof MAIL_STREAMS)[number];

/** What an adapter can do beyond a single send. Declared, never assumed. */
export type MailCapability = 'idempotency' | 'tags' | 'batch';

/** The From address (display name and address) of each stream. */
export type MailSenders = Readonly<Record<MailStream, string>>;

export interface MailMessage {
  readonly stream: MailStream;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Extra mail headers (List-Unsubscribe). */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MailSendOptions {
  /** A send carrying a key is delivered at most once per key — only on a
   *  transport that declares `idempotency`; any other refuses it as `invalid`. */
  readonly idempotencyKey?: string;
}

export type MailFailureKind = 'refused' | 'retryable' | 'timeout' | 'invalid';

export type MailOutcome =
  | { readonly ok: true; readonly id: string }
  | {
      readonly ok: false;
      readonly kind: MailFailureKind;
      readonly retryable: boolean;
      /** The carrier's HTTP status when it answered. */
      readonly status?: number;
      /** Printable: the carrier and what happened. Never an address. */
      readonly detail: string;
    };

export interface MailTransport {
  /** The adapter id of tooling/ports/mail.json. */
  readonly id: string;
  readonly capabilities: ReadonlySet<MailCapability>;
  send(message: MailMessage, options?: MailSendOptions): Promise<MailOutcome>;
}

/** The outcome of a carrier that ANSWERED with a non-2xx `status`. */
export function answeredOutcome(carrier: string, status: number): MailOutcome {
  const retryable = status === 429 || status >= 500;
  return { ok: false, kind: retryable ? 'retryable' : 'refused', retryable, status, detail: `${carrier} answered ${status}` };
}

/** The outcome of a send that got NO answer — it may have been delivered. */
export function noAnswerOutcome(carrier: string, err: unknown): MailOutcome {
  const name = err instanceof Error || (typeof err === 'object' && err !== null && 'name' in err) ? String((err as { name: unknown }).name) : 'Error';
  const timedOut = name === 'TimeoutError' || name === 'AbortError';
  return {
    ok: false,
    kind: 'timeout',
    retryable: false,
    detail: `${carrier} not reached: ${timedOut ? 'no answer within the send bound' : name}`,
  };
}

/** The checks every adapter makes before it touches the wire; null when the
 *  message may be sent. */
export function preflightOutcome(
  carrier: string,
  capabilities: ReadonlySet<MailCapability>,
  senders: MailSenders,
  message: MailMessage,
  options: MailSendOptions | undefined,
): MailOutcome | null {
  if (!senders[message.stream]) {
    return { ok: false, kind: 'invalid', retryable: false, detail: `${carrier}: stream ${String(message.stream)} has no sender` };
  }
  if (message.to.length === 0) return { ok: false, kind: 'invalid', retryable: false, detail: `${carrier}: no recipient` };
  if (options?.idempotencyKey !== undefined && !capabilities.has('idempotency')) {
    return { ok: false, kind: 'invalid', retryable: false, detail: `${carrier}: an idempotency key was asked for, and this transport cannot honour one` };
  }
  return null;
}
