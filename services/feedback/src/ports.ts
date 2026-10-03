// ─────────────────────────────────────────────────────────────────────────────
// ports.ts — THE FEEDBACK WORKER'S COMPOSITION ROOT for mail (tooling/ports/
// README.md §3): the one module here that imports a mail adapter. Every other
// module takes a `MailTransport` and never learns who carries it.
//
// The stream is `feedback` (tooling/ports/mail.json `streams.feedback`): the
// Resend adapter the platform Worker uses, on RESEND_API_KEY, From the entity
// source's `mail.from.feedback` (rendered into the platform's
// src/generated/entity.ts, which this Worker imports rather than rendering a
// second copy). No key ⇒ null: nothing is sent, the receipt and the notice
// record "not configured", and every report is still stored.
// ─────────────────────────────────────────────────────────────────────────────
import type { MailTransport } from '../../_shared/src/ports/mail';
import { createResendMail } from '../../platform/src/adapters/mail/resend';
import { MAIL_FROM } from '../../platform/src/generated/entity';
import type { Env } from './types';

export function mailFor(env: Pick<Env, 'RESEND_API_KEY'>, fetchImpl?: typeof fetch): MailTransport | null {
  if (!env.RESEND_API_KEY) return null;
  return createResendMail({ apiKey: env.RESEND_API_KEY, senders: MAIL_FROM, ...(fetchImpl ? { fetchImpl } : {}) });
}
