// ─────────────────────────────────────────────────────────────────────────────
// report-notify.ts — THE SUPPORT INBOX HEARS ABOUT A CONTENT REPORT.
//
// O-PLAY-AI-CONTENT-REPORTING. The report itself is already in content_reports
// (0013) before this runs; this is the NOTICE, and it is allowed to not happen.
// Every way it can not happen leaves `notified_at` NULL, which is the one query
// that finds an unnoticed report: `SELECT … WHERE notified_at IS NULL`.
//
// 🔴 THREE DECISIONS, EACH FROM A LOCKED RECORD RATHER THAN FROM HERE:
//   · THE SENDER is `alerts@mail.nikatru.com` — [ADR 029]: everything a machine
//     sends leaves Resend from mail.nikatru.com, typed by local-part, and owner
//     alerts are `alerts@` (GlitchTip's are).
//   · THE CONTAINER is the auth+alerts Resend account — [ADR 041]: campaigns live
//     in a separate account; an alert never does.
//   · THE RECIPIENT is support@nikatru.com, the published human inbox on
//     Workspace ([ADR 029] §1: Workspace receives).
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
import { firstRow } from './d1';

/** [ADR 029] §2 — the alert local-part on the pooled machine-mail subdomain. */
export const REPORT_NOTICE_FROM = 'Nikatru reports <alerts@mail.nikatru.com>';
/** [ADR 029] §1 — the published support inbox. */
export const REPORT_NOTICE_TO = 'support@nikatru.com';

/**
 * The most notices per UTC day. A fifth of the Free tier's 100/day, so a report
 * storm can never take more than 20 sends from password resets.
 *
 * @ceiling none — a share of a vendor send quota we chose, not a platform resource; tooling/ceilings.json records no Resend limit to compare it with.
 */
export const MAX_REPORT_NOTICES_PER_DAY = 20;

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

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
 * Send the notice for ONE stored report, then stamp `notified_at`. Never throws:
 * the caller runs it under `waitUntil`, after the user already has their answer.
 */
export async function notifyReport(
  db: D1Database,
  apiKey: string | undefined,
  report: ReportNotice,
  fetchImpl: typeof fetch = fetch,
): Promise<NoticeOutcome> {
  if (!apiKey) return { sent: false, why: 'not_configured' };
  try {
    const today = await firstRow<{ n: number }>(
      db
        .prepare('SELECT COUNT(*) AS n FROM content_reports WHERE created_at >= ? AND notified_at IS NOT NULL')
        .bind(utcDayStart(report.createdAt)),
    );
    if ((today?.n ?? 0) >= MAX_REPORT_NOTICES_PER_DAY) return { sent: false, why: 'daily_cap' };

    const res = await fetchImpl(RESEND_EMAILS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: REPORT_NOTICE_FROM,
        to: [REPORT_NOTICE_TO],
        subject: `Content report ${report.id} — ${report.appId}: ${report.reason}`,
        text:
          `A user reported AI-generated content.\n\n` +
          `Report: ${report.id}\nApp: ${report.appId}\nReason: ${report.reason}\nAt: ${report.createdAt}\n\n` +
          `The excerpt and the user's note are in platform_db.content_reports, row id ${report.id}. ` +
          `They are deliberately not in this email.`,
      }),
    });
    if (!res.ok) {
      console.error(`[report-notify] Resend answered ${res.status} for report ${report.id} — stored, not noticed`);
      return { sent: false, why: 'send_failed' };
    }
    await db
      .prepare('UPDATE content_reports SET notified_at = ? WHERE id = ?')
      .bind(new Date().toISOString(), report.id)
      .run();
    return { sent: true };
  } catch (err) {
    console.error(`[report-notify] report ${report.id} — stored, not noticed: ${String(err)}`);
    return { sent: false, why: 'send_failed' };
  }
}
