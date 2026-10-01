// ─────────────────────────────────────────────────────────────────────────────
// ports.ts — THE PLATFORM WORKER'S COMPOSITION ROOT. The one module that imports
// an adapter (tooling/ports/README.md §3; assert-ports limb 4 holds it): every
// other module asks for a port here and never learns who answers it.
//
// MAIL (tooling/ports/mail.json). `mailFor(stream, env)` is the MailTransport for
// one stream, or null when the stream's key is not set on this Worker (the caller
// records "not configured" and sends nothing — a notice and a reminder are
// allowed to not happen; the row they are about is already stored).
//   · The From of each stream is the entity source's, from src/generated/entity.ts.
//   · The adapter and secret of each stream are MAIL_STREAM_TABLE below — a hand
//     table mirroring mail.json `streams`, declared there as a `handTables` waiver
//     until the port renderer lands; test/mail-port.test.ts fails on any
//     difference between the two.
//   · `reminders` takes RESEND_REMINDERS_API_KEY when it is set, else the reports
//     key under the reminder digest's own small daily cap (lib/reminders.ts
//     MAX_REMINDER_MAILS_PER_DAY — never raised here).
// The fake (services/_shared/src/ports/fakes/mail.ts) is never selected here:
// it serves tests only, which build it themselves, so it is in no bundle.
// The SES adapter is a draft and is not imported here: nothing can select it.
// ─────────────────────────────────────────────────────────────────────────────
import type { MailSenders, MailStream, MailTransport } from '../../_shared/src/ports/mail';
import { createResendMail } from './adapters/mail/resend';
import { MAIL_FROM } from './generated/entity';
import type { Env } from './types';

type MailSecret = 'RESEND_API_KEY' | 'RESEND_REMINDERS_API_KEY';

/** Per stream: the adapter id and its secret NAMES, first one set wins. */
export const MAIL_STREAM_TABLE: Readonly<Record<MailStream, { adapter: 'resend'; secrets: readonly MailSecret[] }>> = {
  reports: { adapter: 'resend', secrets: ['RESEND_API_KEY'] },
  reminders: { adapter: 'resend', secrets: ['RESEND_REMINDERS_API_KEY', 'RESEND_API_KEY'] },
};

/** The From of every stream, from the entity source. */
export const MAIL_SENDERS: MailSenders = MAIL_FROM;

/** The secret NAME a stream would send with on this Worker, or null. Never the value. */
export function mailSecretFor(stream: MailStream, env: Pick<Env, MailSecret>): MailSecret | null {
  return MAIL_STREAM_TABLE[stream].secrets.find((n) => !!env[n]) ?? null;
}

/** The MailTransport for one stream, or null when its key is not set. */
export function mailFor(stream: MailStream, env: Pick<Env, MailSecret>, fetchImpl?: typeof fetch): MailTransport | null {
  const secret = mailSecretFor(stream, env);
  if (!secret) return null;
  return createResendMail({ apiKey: env[secret] as string, senders: MAIL_SENDERS, ...(fetchImpl ? { fetchImpl } : {}) });
}
