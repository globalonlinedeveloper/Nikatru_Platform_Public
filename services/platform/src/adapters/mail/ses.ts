// ─────────────────────────────────────────────────────────────────────────────
// adapters/mail/ses.ts — THE AMAZON SES DRAFT ADAPTER of the mail port
// (services/_shared/src/ports/mail.ts; registry tooling/ports/mail.json, row
// `ses`: status `draft`, environments EMPTY — never selectable).
//
// 🔴 IT EXISTS TO PROVE THE PORT IS NOT RESEND-SHAPED. [ADR 029] names SES as the
// documented fallback; this is that fallback written against the port, passing
// the same conformance suite as Resend with fixtures from the AWS docs. Nothing
// constructs it: the composition root (src/ports.ts) does not import it, no
// account exists, and its secret names are declared, not provisioned.
//
// Read at https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
// (tooling/ports/mail.json `readAt`): SES v2 `SendEmail` is
// `POST https://email.<region>.amazonaws.com/v2/email/outbound-emails`, a JSON
// body of FromEmailAddress / Destination.ToAddresses / Content.Simple
// (Subject, Body.Text, Body.Html, Headers), and `{ "MessageId": … }` on 200.
// It has NO idempotency token — so this adapter does not declare `idempotency`,
// and a send that asks for one is `invalid` (the port's rule), never silently
// sent twice.
//
// SigV4 is signed here with WebCrypto (crypto.subtle HMAC-SHA256 and SHA-256),
// which workerd provides: no package for a draft. The signer is checked against
// the AWS docs' published vectors in test/mail-ses.conformance.test.ts.
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

/** The SES v2 SendEmail path. */
export const SES_SEND_PATH = '/v2/email/outbound-emails';

/**
 * How long one SES send may take — the same bound as the Resend adapter's, for
 * the same reason (the nightly digest sends sequentially).
 *
 * @ceiling none — a per-call wait we chose, not a platform resource.
 */
export const SES_SEND_TIMEOUT_MS = 10_000;

export interface SesCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

export interface SesMailDeps extends SesCredentials {
  readonly senders: MailSenders;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** The signing clock; tests pin it. */
  readonly now?: () => Date;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(data: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(data)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** `20150830T123600Z` for a Date. */
export function amzDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** The SigV4 signing key: HMAC chain secret → date → region → service → aws4_request. */
export async function signingKey(secretAccessKey: string, ymd: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(enc.encode(`AWS4${secretAccessKey}`), ymd);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SigV4Request {
  readonly method: string;
  readonly host: string;
  readonly path: string;
  /** Already-canonical query string ('' for none). */
  readonly query: string;
  /** Lower-case names; `host` and `x-amz-date` are added here. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * Sign one request with AWS Signature Version 4. Returns the headers to send:
 * the given ones plus `x-amz-date` and `authorization`. Header values are
 * trimmed; names are signed in sorted order.
 */
export async function signV4(
  req: SigV4Request,
  creds: SesCredentials,
  service: string,
  at: Date,
): Promise<Record<string, string>> {
  const stamp = amzDate(at);
  const ymd = stamp.slice(0, 8);
  const all: Record<string, string> = { ...req.headers, host: req.host, 'x-amz-date': stamp };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower: Record<string, string> = {};
  for (const [n, v] of Object.entries(all)) lower[n.toLowerCase()] = v.trim().replace(/\s+/g, ' ');
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonical = [req.method, req.path, req.query, canonicalHeaders, signedHeaders, await sha256Hex(req.body)].join('\n');
  const scope = `${ymd}/${creds.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonical)].join('\n');
  const signature = hex(await hmac(await signingKey(creds.secretAccessKey, ymd, creds.region, service), toSign));
  const out: Record<string, string> = {};
  for (const [n, v] of Object.entries(all)) if (n !== 'host') out[n] = v;
  out.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return out;
}

const CARRIER = 'SES';

/** The SES v2 MailTransport (draft — never selected). */
export function createSesMail(deps: SesMailDeps): MailTransport {
  const capabilities: ReadonlySet<MailCapability> = new Set<MailCapability>();
  const host = `email.${deps.region}.amazonaws.com`;
  return {
    id: 'ses',
    capabilities,
    async send(message: MailMessage, options?: MailSendOptions): Promise<MailOutcome> {
      const pre = preflightOutcome(CARRIER, capabilities, deps.senders, message, options);
      if (pre) return pre;
      const body = JSON.stringify({
        FromEmailAddress: deps.senders[message.stream],
        Destination: { ToAddresses: [...message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              ...(message.html === undefined ? {} : { Html: { Data: message.html, Charset: 'UTF-8' } }),
            },
            ...(message.headers === undefined
              ? {}
              : { Headers: Object.entries(message.headers).map(([Name, Value]) => ({ Name, Value })) }),
          },
        },
      });
      const headers = await signV4(
        { method: 'POST', host, path: SES_SEND_PATH, query: '', headers: { 'content-type': 'application/json' }, body },
        deps,
        'ses',
        (deps.now ?? (() => new Date()))(),
      );
      const fetchImpl = deps.fetchImpl ?? fetch;
      let res: Response;
      try {
        res = await fetchImpl(`https://${host}${SES_SEND_PATH}`, {
          method: 'POST',
          headers,
          body,
          signal: AbortSignal.timeout(deps.timeoutMs ?? SES_SEND_TIMEOUT_MS),
        });
      } catch (err) {
        return noAnswerOutcome(CARRIER, err);
      }
      // Every documented SendEmail error is a 400 (the message or the account) or
      // 404, except TooManyRequestsException (429); a 5xx is the service's.
      if (res.status < 200 || res.status >= 300) return answeredOutcome(CARRIER, res.status);
      let id = '';
      try {
        const json = (await res.json()) as { MessageId?: unknown };
        if (typeof json?.MessageId === 'string') id = json.MessageId;
      } catch {
        /* the 200 is the fact */
      }
      return { ok: true, id: id || 'ses:unreported' };
    },
  };
}
