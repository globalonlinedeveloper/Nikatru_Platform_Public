// ─────────────────────────────────────────────────────────────────────────────
// report-notify.ts — THE SUPPORT INBOX HEARS ABOUT A CONTENT REPORT.
//
// O-PLAY-AI-CONTENT-REPORTING. The report itself is already in content_reports
// (0013) before this runs; this is the NOTICE, and it is allowed to not happen.
// Every way it can not happen leaves `notified_at` NULL, which is the one query
// that finds an unnoticed report: `SELECT … WHERE notified_at IS NULL` — except
// a send that THREW (a timeout, a dropped connection), which may have been
// delivered and keeps its claim; its console line names the report id.
//
// 🔴 THREE DECISIONS, EACH FROM A LOCKED RECORD RATHER THAN FROM HERE:
//   · THE SENDER is the `reports` stream's From — tooling/house-identity.json
//     `mail.from.reports`, the `alerts@` local-part on the machine-mail
//     subdomain ([ADR 029]: everything a machine sends leaves from it, typed by
//     local-part, and owner alerts are `alerts@`, as GlitchTip's are). The mail
//     port sets it from the stream; this file never names an address.
//   · THE CONTAINER is the auth+alerts Resend account — [ADR 041]: campaigns live
//     in a separate account; an alert never does (tooling/ports/mail.json
//     `streams.reports`, secret RESEND_API_KEY).
//   · THE RECIPIENT is the published support inbox, `supportEmail` in the entity
//     source, on Workspace ([ADR 029] §1: Workspace receives).
//
// 🔴 A DAILY CAP, BECAUSE THE QUOTA IS SHARED WITH PASSWORD RESETS. The auth+alerts
// container is on Resend's Free tier — 100 sends/day — and signup confirmations
// and password resets go through the same quota. The Private ledger names the
// failure exactly: "an unthrottled alert storm can mute your own password
// resets". So at most MAX_REPORT_NOTICES_PER_DAY notices leave per UTC day, and
// every report past that is stored un-noticed, never refused.
//
// 🔴 THE EMAIL CARRIES NO USER CONTENT. Report id, app, reason, time — not the
// excerpt, not the note, not who reported. Support reads the row by id. So no
// user-written text flows to Resend, and the privacy notice's account of what
// Resend holds (email addresses, for auth mail) stays true.
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import type { MailOutcome, MailTransport } from '../../../_shared/src/ports/mail';
import { SUPPORT_EMAIL } from '../generated/entity';

/** [ADR 029] §1 — the published support inbox, from the entity source. */
export const REPORT_NOTICE_TO: string = SUPPORT_EMAIL;

/**
 * The most notices per UTC day. A fifth of the Free tier's 100/day, so a report
 * storm can never take more than 20 sends from password resets.
 *
 * @ceiling none — a share of a vendor send quota we chose, not a platform resource; tooling/ceilings.json records no Resend limit to compare it with.
 */
export const MAX_REPORT_NOTICES_PER_DAY = 20;

export type NoticeOutcome =
  | { sent: true }
  | { sent: false; why: 'not_configured' | 'daily_cap' | 'send_failed' };

export interface ReportNotice {
  id: string;
  appId: string;
  reason: string;
  createdAt: string;
}

/** Midnight UTC of the day `iso` falls in, as an ISO instant. */
export function utcDayStart(iso: string): string {
  return `${iso.slice(0, 10)}T00:00:00.000Z`;
}

/**
 * Claim `notified_at` for ONE stored report under the daily cap, then send on the
 * `reports` stream. Never throws: the caller runs it under `waitUntil`, after the
 * user already has their answer. `mail` is `mailFor('reports', env)` (src/ports.ts),
 * null when the stream's key is not set.
 */
export async function notifyReport(
  db: SqlDb,
  mail: MailTransport | null,
  report: ReportNotice,
): Promise<NoticeOutcome> {
  if (!mail) return { sent: false, why: 'not_configured' };
  // ⏱ 2026-09-30 · O-REPORT-CAPS-ARE-READ-THEN-WRITE (rv2-services-004). CLAIM,
  // THEN SEND. The cap was a COUNT, then the send, then the stamp — so a parallel
  // wave of reports all counted before any sibling had stamped, and every one of
  // them mailed, spending the Resend quota password resets share. Now the stamp
  // IS the claim, taken in one statement that holds the cap: `notified_at` is set
  // only while fewer than MAX_REPORT_NOTICES_PER_DAY of today's reports carry
  // one, and only the claim that landed sends. The reminder digest's rule for an
  // unclear outcome (lib/reminders.ts): a DEFINITE refusal releases the claim; a
  // send that THREW may have been delivered and spent a send, so its claim stays.
  const claimedAt = new Date().toISOString();
  try {
    const claim = await db
      .prepare(
        `UPDATE content_reports SET notified_at = ?1
         WHERE id = ?2 AND notified_at IS NULL
           AND (SELECT COUNT(*) FROM content_reports WHERE created_at >= ?3 AND notified_at IS NOT NULL) < ?4`,
      )
      .bind(claimedAt, report.id, utcDayStart(report.createdAt), MAX_REPORT_NOTICES_PER_DAY)
      .run();
    if (Number(claim.meta?.changes ?? 0) === 0) return { sent: false, why: 'daily_cap' };
  } catch (err) {
    console.error(`[report-notify] report ${report.id} — stored, not noticed: ${String(err)}`);
    return { sent: false, why: 'send_failed' };
  }
  let res: MailOutcome;
  try {
    res = await mail.send({
      stream: 'reports',
      to: [REPORT_NOTICE_TO],
      subject: `Content report ${report.id} — ${report.appId}: ${report.reason}`,
      text:
        `A user reported AI-generated content.\n\n` +
        `Report: ${report.id}\nApp: ${report.appId}\nReason: ${report.reason}\nAt: ${report.createdAt}\n\n` +
        `The excerpt and the user's note are in platform_db.content_reports, row id ${report.id}. ` +
        `They are deliberately not in this email.`,
    });
  } catch (err) {
    // The port resolves every outcome; a throw is a defect, and it may have sent.
    res = { ok: false, kind: 'timeout', retryable: false, detail: `mail transport threw ${err instanceof Error ? err.name : 'a non-error'}` };
  }
  if (res.ok) return { sent: true };
  if (res.kind === 'timeout') {
    // No answer: it may have been delivered and spent a send, so the claim stays.
    console.error(`[report-notify] report ${report.id} — ${res.detail}; it may have been delivered, so the claim stays`);
    return { sent: false, why: 'send_failed' };
  }
  // A definite answer (refused, retryable, invalid): nothing was delivered.
  console.error(`[report-notify] ${res.detail} for report ${report.id} — stored, not noticed`);
  await releaseClaim(db, report.id, claimedAt);
  return { sent: false, why: 'send_failed' };
}

/** Undo THIS claim (its own stamp, nothing later), so the report reads un-noticed
 *  again. Never throws: a release that fails leaves the report stamped, which
 *  under-uses the day's cap rather than overshooting it. */
async function releaseClaim(db: SqlDb, id: string, claimedAt: string): Promise<void> {
  try {
    await db.prepare('UPDATE content_reports SET notified_at = NULL WHERE id = ? AND notified_at = ?').bind(id, claimedAt).run();
  } catch (err) {
    console.error(`[report-notify] report ${id} — the refused notice's claim could not be released: ${String(err)}`);
  }
}
