// ─────────────────────────────────────────────────────────────────────────────
// notify.ts — the feedback Worker's two mails, both CONSENTED, both about the
// person's OWN report (lane feedback-triage, Do 4 and Do 5). Nobody else is
// ever mailed: the only recipient is the report's `contact_email`, which the
// intake stores only when a box was ticked (routes/feedback.ts `contactOf`).
//
//   RECEIPT — on submit, when "you may reply to me" was ticked: one short
//             acknowledgement with the report id. `receipt_at` is claimed
//             first, so a replayed submit never mails twice.
//   FIXED   — from the cron, when the report has reached `fixed` (a version)
//             and "tell me when it is fixed" was ticked: ONE localised mail
//             with the version and the product's link, then the status is
//             `notified`. The move IS the claim (UPDATE … WHERE status =
//             'fixed'), so two cron runs, or two overlapping firings, mail once.
//
// 🔴 CLAIM, THEN SEND. A send that gets no answer may have been delivered, so a
// claim is never released (the mail port's `timeout` rule): at most once is the
// safe direction for mail to a person.
//
// 🔴 SUPPRESSION. An address whose SHA-256 is in `feedback_mail_suppressed`
// (it pressed "unsubscribe" on one of these mails) gets neither mail, ever. The
// notice carries RFC 8058 one-click unsubscribe; its token is stored only as a
// hash (`unsubscribe_hash`). The carrier's own account-wide suppression list
// (bounces, complaints) applies on top, as it does to every stream.
//
// The copy is tooling/i18n/messages/email.json `feedbackMail`, in the report's
// own `diagnostics.locale`, falling back to the register's source locale.
// ─────────────────────────────────────────────────────────────────────────────
import emailJson from '../../../../tooling/i18n/messages/email.json';
import registerJson from '../../../../tooling/i18n/locales.json';
import type { MailTransport } from '../../../_shared/src/ports/mail';
import type { SqlDb } from '../../../_shared/src/ports/sql';
import { allRows, firstRow, run } from '../lib/d1';
import { appendHistory } from './lifecycle';

/**
 * The most "fixed in" notices one cron run sends. The stream shares the
 * auth+alerts account's quota with password resets (tooling/ports/mail.json
 * `streams.feedback`); a backlog drains over the following nights.
 *
 * @ceiling none — our own per-run pacing, not a platform resource.
 */
export const MAX_NOTICES_PER_RUN = 20;

/** Where the one-click unsubscribe link points: this Worker's own host. */
export const FEEDBACK_LINK_ORIGIN = 'https://platform.nikatru.com';

/** Each product's page, which carries its store and web links. A report from
 *  an app or extension not listed here links the home page. */
export const PRODUCT_LINKS: Readonly<Record<string, string>> = {
  subscriptiontracker: 'https://nikatru.com/apps/subscriptiontracker',
  fullshot: 'https://nikatru.com/fullshot/',
  nikatru: 'https://nikatru.com/',
};

/** Each product's name in the mail. */
const PRODUCT_NAMES: Readonly<Record<string, string>> = {
  subscriptiontracker: 'Subscription Tracker',
  fullshot: 'FullShot',
  nikatru: 'nikatru.com',
};

export interface FeedbackCopy {
  receiptSubject: string;
  receiptBody: string;
  fixedSubject: string;
  fixedBody: string;
  update: string;
  why: string;
  receiptWhy: string;
  stop: string;
}

const COPY = (emailJson as { feedbackMail: Record<string, Partial<FeedbackCopy> | undefined> }).feedbackMail;
const SOURCE_LOCALE: string = registerJson.sourceLocale;
const SUPPORTED: readonly string[] = (registerJson.locales as { code: string; status: string }[])
  .filter((l) => l.status === 'supported')
  .map((l) => l.code);

/** The supported locale a report's tag resolves to: exact, else its language, else the source. */
export function localeOf(tag: unknown): string {
  if (typeof tag !== 'string' || tag === '') return SOURCE_LOCALE;
  const exact = SUPPORTED.find((c) => c.toLowerCase() === tag.toLowerCase());
  if (exact) return exact;
  const lang = tag.split(/[-_]/)[0].toLowerCase();
  return SUPPORTED.find((c) => c.toLowerCase() === lang) ?? SOURCE_LOCALE;
}

/** The copy for `locale`, any missing key from the source locale. */
export function copyFor(locale: string): FeedbackCopy {
  return { ...(COPY[SOURCE_LOCALE] as FeedbackCopy), ...(COPY[locale] ?? {}) };
}

const fill = (t: string, vars: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);

export async function sha256Hex(value: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh 256-bit token, base64url, 43 characters. */
export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const addressHash = (address: string) => sha256Hex(address.trim().toLowerCase());

export async function isSuppressed(db: SqlDb, address: string): Promise<boolean> {
  const row = await firstRow<{ n: number }>(
    db.prepare('SELECT 1 AS n FROM feedback_mail_suppressed WHERE address_hash = ?').bind(await addressHash(address)),
  );
  return row !== null;
}

export async function suppress(db: SqlDb, address: string, at: string): Promise<void> {
  await run(
    db.prepare('INSERT INTO feedback_mail_suppressed (address_hash, created_at) VALUES (?, ?) ON CONFLICT (address_hash) DO NOTHING').bind(
      await addressHash(address),
      at,
    ),
  );
}

function localeOfDiagnostics(diagnostics: string | null): string {
  try {
    return localeOf((JSON.parse(diagnostics ?? '{}') as { locale?: unknown }).locale);
  } catch {
    return SOURCE_LOCALE;
  }
}

export type MailResult = 'sent' | 'not_configured' | 'not_consented' | 'suppressed' | 'already' | 'failed';

/** The receipt for report `id`, once. Called after the row is written. */
export async function sendReceipt(db: SqlDb, mail: MailTransport | null, id: string, at: string): Promise<MailResult> {
  if (mail === null) return 'not_configured';
  const row = await firstRow<{ contact_email: string | null; reply_ok: number; diagnostics: string | null }>(
    db.prepare('SELECT contact_email, reply_ok, diagnostics FROM feedback_reports WHERE id = ?').bind(id),
  );
  if (!row || row.reply_ok !== 1 || !row.contact_email) return 'not_consented';
  if (await isSuppressed(db, row.contact_email)) return 'suppressed';
  const claim = await run(db.prepare('UPDATE feedback_reports SET receipt_at = ? WHERE id = ? AND receipt_at IS NULL').bind(at, id));
  if (claim.meta.changes !== 1) return 'already';
  const copy = copyFor(localeOfDiagnostics(row.diagnostics));
  const vars = { id };
  const outcome = await mail.send(
    {
      stream: 'feedback',
      to: [row.contact_email],
      subject: fill(copy.receiptSubject, vars),
      text: `${fill(copy.receiptBody, vars)}\n\n${copy.receiptWhy}\n`,
    },
    mail.capabilities.has('idempotency') ? { idempotencyKey: `feedback-receipt-${id}` } : undefined,
  );
  if (!outcome.ok) console.log(`[feedback-mail] receipt ${id} not sent: ${outcome.kind} ${outcome.detail}`);
  return outcome.ok ? 'sent' : 'failed';
}

/** Every waiting "fixed in" notice, up to MAX_NOTICES_PER_RUN. Never throws per report. */
export async function runNotices(
  db: SqlDb,
  mail: MailTransport | null,
  at: string,
): Promise<{ sent: number; suppressed: number; failed: number; configured: boolean }> {
  const out = { sent: 0, suppressed: 0, failed: 0, configured: mail !== null };
  if (mail === null) return out;
  const rows = await allRows<{
    id: string;
    app_id: string;
    contact_email: string;
    fixed_version: string | null;
    diagnostics: string | null;
    status_history: string | null;
  }>(
    db
      .prepare(`SELECT id, app_id, contact_email, fixed_version, diagnostics, status_history FROM feedback_reports WHERE status = 'fixed' AND notify_fixed = 1 AND contact_email IS NOT NULL AND notified_at IS NULL ORDER BY status_at LIMIT ?`)
      .bind(MAX_NOTICES_PER_RUN),
  );
  for (const r of rows) {
    if (await isSuppressed(db, r.contact_email)) {
      // Recorded on the row so the next run does not read it again; the status
      // stays `fixed`, because the reporter was NOT told.
      await run(db.prepare("UPDATE feedback_reports SET notify_fixed = 0 WHERE id = ? AND status = 'fixed'").bind(r.id));
      out.suppressed++;
      continue;
    }
    const token = newToken();
    const history = appendHistory(r.status_history, { from: 'fixed', to: 'notified', at, by: 'cron' });
    const claim = await run(
      db
        .prepare(`UPDATE feedback_reports SET status = 'notified', status_at = ?, notified_at = ?, unsubscribe_hash = ?, status_history = ? WHERE id = ? AND status = 'fixed' AND notified_at IS NULL`)
        .bind(at, at, await sha256Hex(token), history, r.id),
    );
    if (claim.meta.changes !== 1) continue;
    const version = r.fixed_version ?? '';
    const copy = copyFor(localeOfDiagnostics(r.diagnostics));
    const vars = { id: r.id, version, app: PRODUCT_NAMES[r.app_id] ?? r.app_id };
    const link = PRODUCT_LINKS[r.app_id] ?? PRODUCT_LINKS.nikatru;
    const unsubscribeUrl = `${FEEDBACK_LINK_ORIGIN}/v1/feedback/unsubscribe?t=${token}`;
    const outcome = await mail.send(
      {
        stream: 'feedback',
        to: [r.contact_email],
        subject: fill(copy.fixedSubject, vars),
        text:
          `${fill(copy.fixedBody, vars)}\n\n${fill(copy.update, vars)}\n${link}\n\n${copy.why}\n` + `${copy.stop}: ${unsubscribeUrl}\n`,
        headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      },
      mail.capabilities.has('idempotency') ? { idempotencyKey: `feedback-fixed-${r.id}` } : undefined,
    );
    if (outcome.ok) out.sent++;
    else {
      out.failed++;
      console.log(`[feedback-mail] notice ${r.id} not sent: ${outcome.kind} ${outcome.detail}`);
    }
  }
  return out;
}

/** The address a one-click token names, or null. Refuses a malformed token before any read. */
export async function tokenAddress(db: SqlDb, token: string | undefined): Promise<string | null> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return null;
  const row = await firstRow<{ contact_email: string | null }>(
    db.prepare('SELECT contact_email FROM feedback_reports WHERE unsubscribe_hash = ? LIMIT 1').bind(await sha256Hex(token)),
  );
  return row?.contact_email ?? null;
}
