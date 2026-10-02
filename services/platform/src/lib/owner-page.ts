// ─────────────────────────────────────────────────────────────────────────────
// owner-page.ts — THE ONE PAGE THAT DOES NOT LEAVE FROM BOX B.
//
// ⏱ 2026-10-01 · PB-02, the owner-page row this train opens (ADR draft
// `owner-page-never-depends-on-the-watched-box`, recorded by the next Private
// pass). Every other page leaves from Box B: GlitchTip's monitors, its alert
// evaluation, its Resend relay and ntfy. A Box B loss was already DETECTED off
// the box — this Worker's boxb_reachability rows — but its only DELIVERY was an
// ops-watch issue, filed on schedule-triggered runs, and no delivery of that to
// the owner was ever recorded. So this module mails the owner straight from
// Cloudflare over HTTPS, through the mail port's `reports` stream (src/ports.ts
// `mailFor` — RESEND_API_KEY, the key the Worker already holds), and the page
// shares no machine with the box it reports on.
//
// 🔴 THE ADDRESSES ARE ENTITY FACTS, NEVER TYPED HERE: the recipient is the
// published support inbox (`supportEmail`, src/generated/entity.ts — Workspace
// receives it, off Box B, [ADR 029] §1), and the From is the `reports` stream's
// `alerts@` sender, which the port sets. test/owner-page.test.ts fails on an
// address literal in this file. tooling/ops/alarm-chains.json `ownerPage` is the
// register entry that says so.
//
// 🔴 ONE MAIL PER STREAK. A row that paged carries OWNER_PAGED_MARK in its
// `detail`, and every later row of the same streak carries it forward, so an
// outage that lasts a week mails once rather than 28 times. The Resend container
// is the auth+alerts one on the Free tier (100/day, shared with password resets —
// lib/report-notify.ts), which is the other reason this is not a mail per firing.
// A send that did not succeed leaves no mark, so the next firing tries again: a
// duplicate page costs one send, a lost one costs the outage.
//
// ⚠️ NEVER THROWS, and never logs the key. It runs inside cron limbs whose own
// rows must still land. The mail carries hostnames and row details only.
// ─────────────────────────────────────────────────────────────────────────────
import type { Env } from '../types';
import { SUPPORT_EMAIL } from '../generated/entity';
import { mailFor } from '../ports';

/** Written into a row's `detail` when its streak has paged the owner. */
export const OWNER_PAGED_MARK = '[owner paged]';

/** A heartbeat row that may ask for a page. `page` is the one line the mail
 *  carries for it; a row without one never pages. */
export type PageRow = { target: string; ok: boolean; detail: string; page?: string };

export type PageOutcome = 'sent' | 'not_configured' | 'failed';

/** [ADR 029] §1 — the published support inbox, from the entity source. */
export const OWNER_PAGE_TO: string = SUPPORT_EMAIL;

export function hasPagedMark(detail: string | null | undefined): boolean {
  return typeof detail === 'string' && detail.includes(OWNER_PAGED_MARK);
}

/** The detail with the mark near its START, where recordHeartbeat's 200-character
 *  slice keeps it — after a leading `FINDING: `, which ops-watchdog rows lead with. */
export function withPagedMark(detail: string): string {
  if (hasPagedMark(detail)) return detail;
  return detail.startsWith('FINDING: ')
    ? `FINDING: ${OWNER_PAGED_MARK} ${detail.slice('FINDING: '.length)}`
    : `${OWNER_PAGED_MARK} ${detail}`;
}

/** The newest row already recorded for (job, target), or null when there is
 *  none. THROWS when unreadable; each caller decides what that means. */
export async function previousRow(env: Env, job: string, target: string): Promise<{ ok: number; detail: string } | null> {
  const row = await env.PLATFORM_DB.prepare(
    'SELECT ok, detail FROM cron_heartbeat WHERE job = ? AND target = ? ORDER BY ran_at DESC LIMIT 1',
  )
    .bind(job, target)
    .first<{ ok: number; detail: string | null }>();
  return row ? { ok: Number(row.ok), detail: String(row.detail ?? '') } : null;
}

/** One mail to the owner. Never throws. */
export async function sendOwnerPage(
  env: Env,
  subject: string,
  lines: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<PageOutcome> {
  const mail = mailFor('reports', env, fetchImpl);
  if (!mail) {
    console.log(`[owner-page] NOT SENT - the reports stream's key is not set: ${subject}`);
    return 'not_configured';
  }
  try {
    const res = await mail.send({
      stream: 'reports',
      to: [OWNER_PAGE_TO],
      subject,
      text:
        `${lines.join('\n')}\n\n` +
        'Sent by the platform Worker cron straight to the mail carrier - not by GlitchTip or ntfy, which run on Box B. ' +
        'One mail per outage: no repeat while it lasts, and no recovery mail (the next ok row in ' +
        'platform_db.cron_heartbeat is the recovery). See tooling/ops/alarm-chains.json ownerPage.',
    });
    if (!res.ok) {
      // `detail` names the carrier and the status, never an address (the port's rule).
      console.log(`[owner-page] ${res.detail} - NOT SENT, the next firing retries: ${subject}`);
      return 'failed';
    }
    console.log(`[owner-page] sent (${mail.id} id ${res.id}): ${subject}`);
    return 'sent';
  } catch (err) {
    // The port resolves every outcome; a throw is a defect, and the next firing retries.
    console.log(`[owner-page] mail transport threw (${err instanceof Error ? err.name : 'a non-error'}) - the next firing retries: ${subject}`);
    return 'failed';
  }
}

/** Page once for `due`, and mark each row only when the mail went out. */
async function pageDue(env: Env, subject: string, due: PageRow[], fetchImpl: typeof fetch): Promise<PageOutcome | 'none'> {
  if (due.length === 0) return 'none';
  const outcome = await sendOwnerPage(
    env,
    subject,
    due.map((r) => `- ${r.page ?? `${r.target}: ${r.detail}`}`),
    fetchImpl,
  );
  if (outcome === 'sent') for (const r of due) r.detail = withPagedMark(r.detail);
  return outcome;
}

/**
 * A REACHABILITY pass: page for every target that is ok=0 now AND was ok=0 on
 * the previous firing, unless that streak already paged. Mutates `detail` (the
 * mark) and must run BEFORE the rows are recorded.
 *
 * 🔴 ONE MISS PAGES NOBODY. A single 52x or timeout is a blip as often as an
 * outage, and on the 6-hourly grid two consecutive misses is 12 h — the bound
 * PB-02 asked for, against the 24-48 h a nightly-only probe gave.
 * ⚠️ AN UNREADABLE HISTORY PAGES NOBODY either: "two in a row" cannot be shown,
 * and the row itself still lands ok=0 for ops-watch to read.
 */
export async function pageOnConsecutiveMiss(
  env: Env,
  job: string,
  label: string,
  rows: PageRow[],
  fetchImpl: typeof fetch = fetch,
): Promise<PageOutcome | 'none'> {
  const due: PageRow[] = [];
  for (const r of rows) {
    if (r.ok) continue;
    let prev: { ok: number; detail: string } | null;
    try {
      prev = await previousRow(env, job, r.target);
    } catch (err) {
      console.log(`[owner-page] ${job} ${r.target}: history unreadable, so no page was decided: ${String(err).slice(0, 120)}`);
      continue;
    }
    if (!prev || prev.ok !== 0) continue;
    if (hasPagedMark(prev.detail)) {
      r.detail = withPagedMark(r.detail);
      continue;
    }
    r.page = `${r.target} - ${r.detail} (and ok=0 on the previous firing too)`;
    due.push(r);
  }
  return pageDue(env, `PAGE: ${label} unreachable from Cloudflare on two consecutive firings`, due, fetchImpl);
}

/**
 * Rows that carry `page` (one firing is enough): page once for those whose
 * previous row has not already paged. An unreadable history PAGES — the opposite
 * of pageOnConsecutiveMiss, because here one firing is the condition, and a
 * duplicate costs one send where a lost page costs the outage.
 */
export async function pageFlaggedRows(
  env: Env,
  job: string,
  subject: string,
  rows: PageRow[],
  fetchImpl: typeof fetch = fetch,
): Promise<PageOutcome | 'none'> {
  const due: PageRow[] = [];
  for (const r of rows) {
    if (!r.page) continue;
    let prev: { ok: number; detail: string } | null = null;
    try {
      prev = await previousRow(env, job, r.target);
    } catch (err) {
      console.log(`[owner-page] ${job} ${r.target}: history unreadable, paging rather than risking silence: ${String(err).slice(0, 120)}`);
    }
    if (hasPagedMark(prev?.detail)) {
      r.detail = withPagedMark(r.detail);
      continue;
    }
    due.push(r);
  }
  return pageDue(env, subject, due, fetchImpl);
}
