// mail-ses.conformance.test.ts — the Amazon SES DRAFT adapter
// (src/adapters/mail/ses.ts) passes the mail port's conformance suite, which is
// the evidence that the port is not Resend-shaped: a different URL, body,
// signature, id field and error model behind the same MailTransport.
//
// Fixtures from the AWS docs (tooling/ports/mail.json row `ses`, `readAt`):
//   · SES v2 SendEmail (APIReference-V2/API_SendEmail.html): POST
//     /v2/email/outbound-emails, 200 `{ "MessageId": … }`; errors are typed by
//     the `x-amzn-ErrorType` header — MessageRejected 400 (a message SES will
//     not carry), TooManyRequestsException 429, and a 5xx.
//   · SigV4 (IAM User Guide, "Signature Version 4 test suite" and "Examples of
//     how to derive a signing key"): the get-vanilla request, and the signing
//     key for 20120215/us-east-1/iam, with the docs' example credentials.
// No AWS account exists; nothing here reaches the network.
import { describe, expect, it } from 'vitest';
import { runMailConformance, type MailHarness } from '../../_shared/test/conformance/mail';
import { createSesMail, signV4, signingKey, SES_SEND_PATH } from '../src/adapters/mail/ses';
import { MAIL_SENDERS } from '../src/ports';

const DOCS_KEY_ID = 'AKIDEXAMPLE';
const DOCS_SECRET = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
const REGION = 'us-east-1';
const SES_URL = `https://email.${REGION}.amazonaws.com${SES_SEND_PATH}`;
/** The MessageId shape in the API_SendEmail reference. */
const DOCS_MESSAGE_ID = 'EXAMPLE78603177f-7a5433e7-8edb-42ae-af10-f0181f34d6ee-000000';

type Answer = { status: number; type?: string } | 'hang';

function sesStub(answers: Answer[]): MailHarness {
  let attempts = 0;
  let delivered = 0;
  const froms: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) !== SES_URL) throw new Error(`unexpected URL ${String(url)}`);
    const auth = (init?.headers as Record<string, string>).authorization ?? '';
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${DOCS_KEY_ID}/`)) throw new Error('unsigned request');
    attempts++;
    froms.push((JSON.parse(String(init?.body)) as { FromEmailAddress: string }).FromEmailAddress);
    const answer = answers[Math.min(attempts - 1, answers.length - 1)];
    if (answer === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    if (answer.status !== 200) {
      const headers = answer.type ? { 'x-amzn-ErrorType': `${answer.type}:http://internal.amazon.com/coral/com.amazonaws.sesv2/` } : undefined;
      return new Response(JSON.stringify({ message: 'stub' }), { status: answer.status, headers });
    }
    delivered++;
    return new Response(JSON.stringify({ MessageId: `${DOCS_MESSAGE_ID}-${delivered}` }), { status: 200 });
  }) as typeof fetch;
  return {
    transport: createSesMail({
      accessKeyId: DOCS_KEY_ID,
      secretAccessKey: DOCS_SECRET,
      region: REGION,
      senders: MAIL_SENDERS,
      fetchImpl,
      timeoutMs: 20,
      now: () => new Date('2015-08-30T12:36:00Z'),
    }),
    attempts: () => attempts,
    delivered: () => delivered,
    froms: () => froms,
  };
}

const OK: Answer = { status: 200 };

runMailConformance({
  adapter: 'ses',
  senders: MAIL_SENDERS,
  fixtures: {
    'send-ok': () => sesStub([OK]),
    idempotent: () => sesStub([OK]),
    refused: () => sesStub([{ status: 400, type: 'MessageRejected' }]),
    'rate-limited': () => sesStub([{ status: 429, type: 'TooManyRequestsException' }]),
    'server-error': () => sesStub([{ status: 500, type: 'InternalFailure' }]),
    timeout: () => sesStub(['hang']),
    'from-stream': () => sesStub([OK]),
    'no-address-in-logs': () => sesStub([OK, { status: 400, type: 'MessageRejected' }, { status: 503 }, 'hang']),
  },
}, { describe, it });

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

describe('SigV4 in-Worker (WebCrypto) — the AWS docs vectors', () => {
  it('derives the signing key of "Examples of how to derive a signing key"', async () => {
    expect(hex(await signingKey(DOCS_SECRET, '20120215', 'us-east-1', 'iam'))).toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });

  it('signs the test suite\'s get-vanilla request to its published Authorization', async () => {
    const h = await signV4(
      { method: 'GET', host: 'example.amazonaws.com', path: '/', query: '', headers: {}, body: '' },
      { accessKeyId: DOCS_KEY_ID, secretAccessKey: DOCS_SECRET, region: 'us-east-1' },
      'service',
      new Date('2015-08-30T12:36:00Z'),
    );
    expect(h['x-amz-date']).toBe('20150830T123600Z');
    expect(h.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });
});

describe('the SES wire — SendEmail v2, not Resend', () => {
  it('posts FromEmailAddress / Destination / Content.Simple, signed for ses in the region', async () => {
    const seen: RequestInit[] = [];
    const t = createSesMail({
      accessKeyId: DOCS_KEY_ID,
      secretAccessKey: DOCS_SECRET,
      region: REGION,
      senders: MAIL_SENDERS,
      now: () => new Date('2015-08-30T12:36:00Z'),
      fetchImpl: (async (_u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init as RequestInit);
        return new Response(JSON.stringify({ MessageId: DOCS_MESSAGE_ID }), { status: 200 });
      }) as typeof fetch,
    });
    const out = await t.send({ stream: 'reminders', to: ['a@example.test'], subject: 's', text: 't', html: 'h', headers: { 'List-Unsubscribe': '<u>' } });
    expect(out).toEqual({ ok: true, id: DOCS_MESSAGE_ID });
    expect(JSON.parse(String(seen[0].body))).toEqual({
      FromEmailAddress: MAIL_SENDERS.reminders,
      Destination: { ToAddresses: ['a@example.test'] },
      Content: {
        Simple: {
          Subject: { Data: 's', Charset: 'UTF-8' },
          Body: { Text: { Data: 't', Charset: 'UTF-8' }, Html: { Data: 'h', Charset: 'UTF-8' } },
          Headers: [{ Name: 'List-Unsubscribe', Value: '<u>' }],
        },
      },
    });
    const auth = (seen[0].headers as Record<string, string>).authorization;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20150830\/us-east-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/);
  });
});
