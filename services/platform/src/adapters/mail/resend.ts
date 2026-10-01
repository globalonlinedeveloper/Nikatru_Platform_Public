// ─────────────────────────────────────────────────────────────────────────────
// adapters/mail/resend.ts — THE RESEND ADAPTER of the mail port
// (services/_shared/src/ports/mail.ts; registry tooling/ports/mail.json, row
// `resend`). Every Resend fact lives here: the URL, the Bearer header, the body
// shape, the timeout, the idempotency header. Moved from lib/report-notify.ts's
// `sendResendMail` (⏱ 2026-09-28 · ST-R1, where the reminder digest became the
// second sender) when the port arrived; the wire is unchanged byte for byte.
//
// Read at https://resend.com/docs/api-reference/emails/send-email
// (tooling/ports/mail.json `readAt`): `POST /emails` with a Bearer key, a JSON
// body of from/to/subject/text/html/headers, an optional `Idempotency-Key`
// header, and `{ "id": … }` on success.
//
// Only services/platform/src/ports.ts (the composition root) may import this
// file — assert-ports limb 4. Tests may, to assert Resend's wire shape.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type MailCapability,
  type MailMessage,
  type MailOutcome,
  type MailSendOptions,
  type MailSenders,
  type MailTransport,
  answeredOutcome,
  noAnswerOutcome,
  preflightOutcome,
} from '../../../../_shared/src/ports/mail';

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

/**
 * How long one Resend send may take. ⏱ 2026-09-28 · ST-R1: the nightly reminder
 * job sends sequentially inside the one nightly firing, so a send that never
 * answers must not hold every limb after it. Ten seconds, the bound every other
 * outbound call from the scheduler already uses.
 *
 * @ceiling none — a per-call wait we chose, not a platform resource.
 */
export const RESEND_SEND_TIMEOUT_MS = 10_000;

/** One message, in the shape Resend's `POST /emails` takes. `headers` carries
 *  extra mail headers (List-Unsubscribe); `html` is optional. */
export interface ResendMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  headers?: Record<string, string>;
}

export interface ResendMailDeps {
  readonly apiKey: string;
  readonly senders: MailSenders;
  readonly fetchImpl?: typeof fetch;
  /** Tests shorten the bound; production uses RESEND_SEND_TIMEOUT_MS. */
  readonly timeoutMs?: number;
}

const CARRIER = 'Resend';

/** The Resend MailTransport for one key. */
export function createResendMail(deps: ResendMailDeps): MailTransport {
  const capabilities: ReadonlySet<MailCapability> = new Set<MailCapability>(['idempotency']);
  return {
    id: 'resend',
    capabilities,
    async send(message: MailMessage, options?: MailSendOptions): Promise<MailOutcome> {
      const pre = preflightOutcome(CARRIER, capabilities, deps.senders, message, options);
      if (pre) return pre;
      const body: ResendMessage = {
        from: deps.senders[message.stream],
        to: [...message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html === undefined ? {} : { html: message.html }),
        ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
      };
      const headers: Record<string, string> = { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' };
      if (options?.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;
      const fetchImpl = deps.fetchImpl ?? fetch;
      let res: Response;
      try {
        res = await fetchImpl(RESEND_EMAILS_URL, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(deps.timeoutMs ?? RESEND_SEND_TIMEOUT_MS),
        });
      } catch (err) {
        return noAnswerOutcome(CARRIER, err);
      }
      if (res.status < 200 || res.status >= 300) return answeredOutcome(CARRIER, res.status);
      // Accepted. An unreadable body does not un-send the mail: the outcome stays
      // ok, so a caller's claim is kept and nothing is mailed twice.
      let id = '';
      try {
        const json = (await res.json()) as { id?: unknown };
        if (typeof json?.id === 'string') id = json.id;
      } catch {
        /* the id is a convenience; the 2xx is the fact */
      }
      return { ok: true, id: id || 'resend:unreported' };
    },
  };
}
