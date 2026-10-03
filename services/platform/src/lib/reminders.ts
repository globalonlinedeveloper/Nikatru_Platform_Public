// ─────────────────────────────────────────────────────────────────────────────
// reminders.ts — RENEWAL REMINDERS THAT REACH EVERY TARGET (ST-R1 email, ST-R2
// calendar). The nightly digest job's work, and the one reading of "which
// subscriptions are live and when do they next renew" that the calendar feed
// (routes/calendar.ts) shares with it.
//
// 🔴 ONE DATE ENGINE. Every occurrence here comes from `rollForward` / `advance`
// in src/renewals.ts, which CLAMP at month end (Jan 31 → Feb 28). The mail, the
// calendar feed and the app all say the same date because they call the same
// function; a second engine — or an RRULE handed to a calendar client — is how
// the 31st would quietly become the 3rd of the next month in one of them.
//
// 🔴 NO EMAIL ADDRESS IS STORED. The address is read at send time from the
// identity provider (`readAccount`, lib/platform-erasure.ts), CONFIRMED
// addresses only, and handed to Resend for that one message. platform_db holds a
// preference, a sent ledger and a feed hash — never a second copy of an address.
//
// 🔴 A NIGHT NEVER MAILS TWICE, AND THAT IS THE DATABASE'S PROPERTY. Every item
// of a digest is CLAIMED in `reminder_sent` BEFORE the send, by one INSERT … ON
// CONFLICT DO NOTHING against the UNIQUE (user, app, subscription, due date,
// kind); only the items whose claim landed are mailed. A retried firing, an
// overlapping run or a re-run the same day collides there. A send Resend
// REFUSES releases its claims so the next night tries again; a send that timed
// out may have been delivered, so it keeps them, and if a release itself fails
// the item is NOT mailed rather than mailed twice — at most once is the safe
// direction for mail.
//
// ⚠️ "NOTHING DUE" IS OK, AND SAYS SO. A night with no opted-in account, or none
// with a renewal inside its lead days, writes ok=1 with its own detail; a missing
// key, a missing binding or no targets at all is ok=0 with the reason — the
// renewals fan-out's rule (src/scheduled.ts `renewalsFanOut`).
// ─────────────────────────────────────────────────────────────────────────────
import type { SqlDb } from '../../../_shared/src/ports/sql';
import type { AppTarget, Env } from '../types';
import { rollForward } from '../renewals';
import { allRows, firstRow } from './d1';
import { readAccount } from './platform-erasure';
import { sha256Hex } from '../middleware/ext-device-auth';
import { catalogueApp } from './catalog';
import { parseReminderDays } from '../../../_shared/src/reminder-days';
import { minorUnitDigits } from '../../../../contracts/currency/iso4217.js';
import type { MailOutcome, MailTransport } from '../../../_shared/src/ports/mail';
import { MAIL_FROM } from '../generated/entity';
import { identityFor, mailFor } from '../ports';
import type { IdentityAdmin } from '../../../_shared/src/ports/identity';

/**
 * [ADR 029] §2 — everything a machine sends leaves from mail.nikatru.com, typed
 * by local-part. Owner alerts are `alerts@`; a reminder to a USER is a different
 * type of mail, so it has its own local-part and its own display name, and a
 * recipient can filter or trust the two separately. The value is the entity
 * source's (tooling/house-identity.json `mail.from.reminders`); the mail port
 * sets it from the `reminders` stream, so this export only names it.
 */
export const REMINDER_FROM: string = MAIL_FROM.reminders;

/**
 * The `kind` column of `reminder_sent`. A closed set, enforced here (0020 has
 * no CHECK): `renewal` for a reminder at the ACCOUNT's lead, and
 * `renewal:<days>` (reminderKind below) for one at a lead the SUBSCRIPTION
 * chose — each of its own leads is its own reminder, so each needs its own claim
 * under the UNIQUE (user, app, subscription, due date, kind).
 */
export const REMINDER_KIND_RENEWAL = 'renewal';

/** Where the one-click unsubscribe link points. The mail is sent from the cron,
 *  which has no request to read a host from; this is the portfolio API host
 *  (wrangler.jsonc `routes`). */
export const REMINDER_LINK_ORIGIN = 'https://platform.nikatru.com';

/**
 * Days ahead a renewal is mailed when the person has not chosen. Three: far enough
 * ahead to cancel before a charge, near enough that the mail is not forgotten.
 *
 * @ceiling none — a reminder lead we chose, not a platform resource.
 */
export const DEFAULT_LEAD_DAYS = 3;

/**
 * The longest ACCOUNT-WIDE lead a person may choose. A month covers a monthly
 * plan's whole cycle. A per-subscription `reminder_days` entry is NOT held to
 * it: that list is bounded by the column's own contract (MAX_REMINDER_DAY,
 * services/_shared/src/reminder-days.ts), which the API already enforced when it
 * stored the value — that file says why it is honoured, not clamped.
 *
 * @ceiling none — an input bound we chose, not a platform resource.
 */
export const MAX_LEAD_DAYS = 30;

/**
 * 🔴 THE HARD DAILY CAP, DERIVED — Resend's quota is SHARED.
 *
 * The auth+alerts Resend container is on the FREE tier: 100 sends per UTC day
 * (lib/report-notify.ts records the same figure), and signup confirmations and
 * PASSWORD RESETS go through that quota too. A reset that cannot be sent locks a
 * person out; a reminder that waits a night is a day later. So reminders get a
 * bounded share and never the rest:
 *
 *     100  the Free tier's daily sends
 *   −  20  report notices at their own cap (MAX_REPORT_NOTICES_PER_DAY)
 *   −  60  held back for auth mail — confirmations and resets
 *   =  20  reminder digests per UTC day, the whole portfolio together
 *
 * Mails over the cap are NOT dropped: their items stay unclaimed and are mailed
 * the next night, OLDEST FIRST (the digest whose earliest item entered its lead
 * window first goes first), for as long as the renewal is still ahead.
 * No plan change is made here or implied: the quota is the owner's money.
 *
 * @ceiling none — a share of a vendor send quota we chose; tooling/ceilings.json records no Resend limit to compare it with.
 */
export const MAX_REMINDER_MAILS_PER_DAY = 20;

/**
 * Identity reads per run. Each digest costs one read (and, if confirmed, one
 * send), and a read that finds an unconfirmed address sends nothing, so reads
 * are bounded separately from sends. ⏱ 2026-10-02 · review 1 of #1140: a read
 * is up to ACCOUNT_READ_ATTEMPTS (2) requests since a transient answer is asked
 * again (lib/platform-erasure.ts), so this limb's worst case is 25 x 2 reads +
 * 20 sends = 70 external subrequests: ABOVE workers.externalSubrequests'
 * recorded Free figure (50) and far under its Paid figure (10,000). It rests on
 * the firing running on Workers Paid (tooling/ceilings.json `planOfRecord`);
 * on Free this bound would have to fall to 15 reads.
 *
 * @ceiling none — a per-run bound we chose for this one limb; the arithmetic is above.
 */
export const MAX_ADDRESS_READS_PER_RUN = 25;

/**
 * Renewals listed in one digest. A mail that lists more than this stops being
 * read; a person with more renewals inside their lead days gets the rest the next
 * night (they are left unclaimed, so nothing is lost while the date is ahead).
 *
 * @ceiling none — a digest length we chose for the reader, not a platform resource.
 */
export const MAX_DIGEST_ITEMS = 14;

/**
 * How long a `reminder_sent` row is kept after its `due_on`. The row is a LOG OF
 * PROCESSING (this person was mailed about this renewal), and 400 days is the
 * platform's period for such records — [ADR 045] §9: it clears the DPDP Rules
 * 2025 Rule 8(3) one-year floor that 365 misses across a 29 February. The
 * dedupe needs a row only until its date has passed, so nothing live is lost.
 * Mirrored in tooling/legal/data-inventory.json and tooling/ops/register.json,
 * cross-checked by test/reminder-mail.test.ts.
 *
 * @ceiling none — a retention period, not a platform resource.
 */
export const REMINDER_SENT_RETENTION_DAYS = 400;

/**
 * Ledger rows one prune PASS removes, at most — the retention sweep's own per-pass
 * bound. ⏱ 2026-10-01 · O-NIGHTLY-CRON-INVOCATION-BUDGET-UNSUMMED: it was the
 * per-RUN bound, so a ledger growing past ~1,000 expired rows a night fell behind
 * for good with nothing red. The prune now repeats while a pass is full, at most
 * MAX_PRUNE_PASSES_PER_RUN times.
 *
 * @ceiling d1.rowsWrittenPerDay lte
 */
export const MAX_PRUNE_PER_RUN = 1000;

/**
 * Prune passes per run. A ledger still full when they run out prints
 * `prune_capped=1` in every reminder_mail row, and tooling/ops/check-heartbeats.mjs
 * turns RED after `cappedNightsRed.nights` such runs in a row (tooling/ops/
 * register.json, duty.platform-cron). Counted in reminderMailStatementBudget below.
 *
 * @ceiling d1.queriesPerInvocation lte
 */
export const MAX_PRUNE_PASSES_PER_RUN = 20;

/**
 * D1 statements one app's pass may spend on reads: the preferences read, the
 * ledger read, and one subscriptions read per USER_CHUNK opted-in accounts. 50
 * holds 48 chunks, 2,400 opted-in accounts an app; past that the reads grow with
 * the data, like the renewals batch (tooling/ceilings.json `batchCallSites`), and
 * this is the allowance to raise.
 *
 * @ceiling none — a declared per-app allowance that reminderMailStatementBudget sums, not a cap the code enforces.
 */
export const REMINDER_STATEMENTS_PER_APP = 50;

/**
 * The most D1 statements one reminder_mail run can send for `appCount` apps: the
 * prune passes, the sent-today count, each app's reads and its heartbeat row, and
 * a claim plus a release for every identity read. Summed per firing against
 * d1.queriesPerInvocation by test/scheduled-crons.test.ts.
 */
export function reminderMailStatementBudget(appCount: number): number {
  return MAX_PRUNE_PASSES_PER_RUN + 1 + appCount * (REMINDER_STATEMENTS_PER_APP + 1) + MAX_ADDRESS_READS_PER_RUN * 2;
}

/**
 * Accounts per subscriptions read. The ids travel as ONE JSON parameter, so this
 * binds no placeholders; it bounds the rows one statement returns.
 *
 * @ceiling none — a read size we chose, not a platform resource.
 */
export const USER_CHUNK = 50;

// ── the app's name and page, from the catalogue the Worker already bundles ────
/** The app's public name ("Nikatru Subscription Tracker"), or its id. */
export function appName(appId: string): string {
  return catalogueApp(appId)?.name ?? appId;
}

/** The app's public page, where the reminder settings live. */
export function appUrl(appId: string): string {
  return catalogueApp(appId)?.url ?? 'https://nikatru.com';
}

// ── dates ───────────────────────────────────────────────────────────────────
/** 'YYYY-MM-DD' of the UTC day `ms` falls in. */
export function ymdOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `ymd` plus `days`, in UTC. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A lead in days, clamped to the range a person may choose; anything else is the default. */
export function clampLead(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_LEAD_DAYS ? v : DEFAULT_LEAD_DAYS;
}

// ── the live subscriptions, read one way for the mail and the feed ──────────
export interface LiveSubscription {
  id: string;
  user_id: string;
  name: string | null;
  price: number | null;
  /** ISO 4217, where subscriptiontracker_db's 0003 column exists and the row
   *  carries one; null on a legacy row, whose currency only the client knows. */
  currency: string | null;
  /** The exact charge in the currency's minor unit (0003), or null. */
  price_minor: number | null;
  cycle: string | null;
  next_renewal: string;
  /** subscriptiontracker_db's own leads, where that column exists (ST-T3a):
   *  null = the account lead, [] = no reminder, else one reminder per entry. */
  reminder_days: number[] | null;
}

/**
 * 🔴 THE LATER COLUMNS ARE READ IF THEY ARE THERE, NEVER ASSUMED — renewals.ts's
 * rule for an app database this Worker does not migrate. subscriptiontracker_db's
 * `reminder_days`, `status` and `deleted_at` arrive with that app's own migration
 * (ST-T3a). The read is `SELECT *`, so a row carries them the day they exist and
 * lacks them until then, and the filter below keys on the row having the column:
 * on today's schema every row with a renewal date is live; once `status` and
 * `deleted_at` exist, only `status IN ('active', 'trialing') AND deleted_at IS
 * NULL` is. One static statement, no probe, no identifier built into SQL.
 */
export function isLive(row: Record<string, unknown>): boolean {
  if ('status' in row && row.status !== 'active' && row.status !== 'trialing') return false;
  if ('deleted_at' in row && row.deleted_at !== null && row.deleted_at !== undefined) return false;
  return true;
}

/** Every live subscription of `userIds`, read USER_CHUNK accounts at a time.
 *  The ids travel as ONE JSON parameter, so a chunk's size binds no placeholders. */
export async function readLiveSubscriptions(db: SqlDb, userIds: readonly string[]): Promise<LiveSubscription[]> {
  const out: LiveSubscription[] = [];
  for (let i = 0; i < userIds.length; i += USER_CHUNK) {
    const chunk = userIds.slice(i, i + USER_CHUNK);
    const rows = await allRows<Record<string, unknown>>(
      db
        .prepare(
          'SELECT * FROM subscriptions WHERE user_id IN (SELECT value FROM json_each(?)) AND next_renewal IS NOT NULL ORDER BY next_renewal, id',
        )
        .bind(JSON.stringify(chunk)),
    );
    for (const r of rows) {
      if (!isLive(r)) continue;
      out.push({
        id: String(r.id),
        user_id: String(r.user_id),
        name: typeof r.name === 'string' ? r.name : null,
        price: typeof r.price === 'number' ? r.price : null,
        currency: typeof r.currency === 'string' ? r.currency : null,
        price_minor: typeof r.price_minor === 'number' ? r.price_minor : null,
        cycle: typeof r.cycle === 'string' ? r.cycle : null,
        next_renewal: String(r.next_renewal),
        // JSON TEXT, not a number: the one reading both Workers share.
        reminder_days: parseReminderDays(r.reminder_days),
      });
    }
  }
  return out;
}

/**
 * The next date on or after `today` this subscription renews, by `rollForward`
 * (renewals.ts) — so a stored Jan 31 read on Feb 10 is Feb 28, exactly what the
 * nightly renewals pass will write. No cycle: the stored date if it is still
 * ahead. A date the engine refuses is no occurrence, never a guess.
 */
export function nextOccurrence(sub: Pick<LiveSubscription, 'cycle' | 'next_renewal'>, today: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(sub.next_renewal ?? ''));
  if (!m) return null;
  let next = m[1];
  try {
    if (sub.cycle === 'monthly' || sub.cycle === 'yearly') next = rollForward(m[1], sub.cycle, today).next;
  } catch {
    return null;
  }
  // `rollForward` stops at its 240-cycle guard, so a pathological backlog can
  // still come back in the past; a past date is no occurrence.
  return next >= today ? next : null;
}

/** The leads for one subscription: its own `reminder_days` where the column
 *  exists and holds a valid list (`[]` = none), else the person's one lead. */
export function leadsFor(sub: Pick<LiveSubscription, 'reminder_days'>, personLead: number): number[] {
  return sub.reminder_days ?? [personLead];
}

/** The `reminder_sent.kind` of a reminder at `lead` days: the account's lead
 *  keeps the original `renewal`, a subscription's own lead is `renewal:<days>`. */
export function reminderKind(lead: number, own: boolean): string {
  return own ? `${REMINDER_KIND_RENEWAL}:${lead}` : REMINDER_KIND_RENEWAL;
}

/**
 * The reminder due tonight for a renewal on `due`, or null. Of the leads whose
 * window `today` is inside (`due` ≤ today + lead), the NEAREST is the window
 * entered most recently, and it is the one reminded: with `[7,1]` a renewal is
 * mailed once 7 days out and once 1 day out, and a night inside the 7-day window
 * but not the 1-day one finds `renewal:7` already claimed. A window missed
 * entirely (the daily cap deferred it) is not mailed late on top of the nearer one.
 */
export function dueReminder(
  sub: Pick<LiveSubscription, 'reminder_days'>,
  due: string,
  today: string,
  personLead: number,
): { lead: number; kind: string } | null {
  const reached = leadsFor(sub, personLead).filter((l) => due <= addDays(today, l));
  if (reached.length === 0) return null;
  const lead = Math.min(...reached);
  return { lead, kind: reminderKind(lead, sub.reminder_days !== null) };
}

/**
 * The minor-unit digits of an ISO 4217 code (upper case), from THE ONE table,
 * contracts/currency/iso4217.js — the table subscriptiontracker-api checks a
 * written `price_minor` against and packages/core's Money writes it with.
 *
 * ⏱ 2026-10-01 · lane fix-st-api-bounds (#1118 review finding 3). This was a
 * map of its own, ISO's full exception list, while core's Money knew only JPY
 * and KWD: the app wrote a KRW plan as won × 100 and this printed it 100× too
 * high, a BHD plan 10× too low. A code not in the table (never a real
 * currency; the API refuses one since this lane) prints with two.
 */
export function minorDigits(code: string): number {
  return minorUnitDigits(code) ?? 2;
}

/** An exact minor-unit count as its decimal string: (1999, 2) → "19.99", (500, 0) → "500". */
function fromMinor(minor: number, digits: number): string {
  const s = String(minor).padStart(digits + 1, '0');
  return digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}

/**
 * The amount as a person reads it: "USD 9.99", "JPY 1200", "KWD 3.500".
 *
 * ⏱ 2026-10-01 · rv2-services-020. This printed `price.toFixed(2)` and nothing
 * else, under a comment saying the currency was not stored — true until
 * subscriptiontracker_db's migration 0003 added `currency` and `price_minor`, so
 * a USD plan and an INR plan read the same in the mail and the calendar. Now the
 * stored code is printed with that currency's own minor digits, from the exact
 * `price_minor` where the row has it, else from `price`.
 *
 * A row with no currency (every row written before 0003, until the client
 * stamps it) still prints the bare amount: its currency is the user's own,
 * which only the device knows, and a guessed code would be a wrong one.
 * Nothing for a missing or non-finite amount.
 */
export function priceLabel(price: unknown, currency: unknown = null, priceMinor: unknown = null): string | null {
  const code = typeof currency === 'string' && /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : null;
  if (code === null) return typeof price === 'number' && Number.isFinite(price) ? price.toFixed(2) : null;
  const digits = minorDigits(code);
  if (typeof priceMinor === 'number' && Number.isSafeInteger(priceMinor) && priceMinor >= 0) {
    return `${code} ${fromMinor(priceMinor, digits)}`;
  }
  return typeof price === 'number' && Number.isFinite(price) ? `${code} ${price.toFixed(digits)}` : null;
}

// ── the digest ──────────────────────────────────────────────────────────────
export interface DueItem {
  subscriptionId: string;
  name: string;
  dueOn: string;
  cycle: string | null;
  price: number | null;
  /** The subscription's ISO 4217 code and exact minor amount, where stored. */
  currency: string | null;
  priceMinor: number | null;
  lead: number;
  /** The claim's `reminder_sent.kind`: reminderKind(lead, …). */
  kind: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** "Mon 5 Oct 2026" — unambiguous in every locale, which a numeric date is not. */
export function dateLabel(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The digest, as plain text plus MINIMAL SEMANTIC HTML: a paragraph, a list, a
 * link. Behaviour, not design — no colours, no type, no images, nothing a mail
 * client has to fetch. Every string a person typed is escaped for HTML.
 */
export function buildDigest(
  appId: string,
  items: readonly DueItem[],
  unsubscribeUrl: string,
): { subject: string; text: string; html: string } {
  const name = appName(appId);
  const first = items[0];
  const subject =
    items.length === 1
      ? `${first.name} renews on ${dateLabel(first.dueOn)}`
      : `${items.length} subscriptions renew by ${dateLabel(items[items.length - 1].dueOn)}`;
  const line = (i: DueItem): string => {
    const p = priceLabel(i.price, i.currency, i.priceMinor);
    return `${i.name} — ${dateLabel(i.dueOn)}${i.cycle ? ` (${i.cycle}${p ? `, ${p}` : ''})` : p ? ` (${p})` : ''}`;
  };
  const text =
    `These subscriptions renew soon:\n\n` +
    items.map((i) => `- ${line(i)}`).join('\n') +
    `\n\nYou get this because you switched on renewal reminder emails in ${name}. ` +
    `Change them in the app: ${appUrl(appId)}\n` +
    `Stop these emails: ${unsubscribeUrl}\n`;
  const html =
    `<p>These subscriptions renew soon:</p>` +
    `<ul>${items.map((i) => `<li>${escapeHtml(line(i))}</li>`).join('')}</ul>` +
    `<p>You get this because you switched on renewal reminder emails in ${escapeHtml(name)}. ` +
    `<a href="${escapeHtml(appUrl(appId))}">Change them in the app</a>.</p>` +
    `<p><a href="${escapeHtml(unsubscribeUrl)}">Stop these emails</a></p>`;
  return { subject, text, html };
}

/** A fresh 256-bit token, base64url, 43 characters — the unsubscribe and feed capability. */
export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The shape `mintToken` produces. Anything else is refused before any read. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// ── the nightly job ─────────────────────────────────────────────────────────
export interface ReminderRow {
  target: string;
  ok: boolean;
  detail: string;
}

interface RunState {
  today: string;
  sentAt: string;
  sentToday: number;
  readsLeft: number;
  pruned: number;
  /** The prune's last pass was still full — expired rows may remain. */
  pruneCapped: boolean;
}

/** A pending digest: one person, one app, the items not yet mailed. */
interface Pending {
  userId: string;
  items: DueItem[];
  /** The first day any item entered its lead window — "oldest" for the cap's queue. */
  since: string;
}

/**
 * The ledger prune: `reminder_sent` rows whose `due_on` is more than
 * REMINDER_SENT_RETENTION_DAYS behind today, MAX_PRUNE_PER_RUN a pass, again while
 * a pass is full, at most MAX_PRUNE_PASSES_PER_RUN passes. `capped` = the last
 * pass was still full, so expired rows may remain.
 */
async function pruneLedger(db: SqlDb, today: string): Promise<{ pruned: number; capped: boolean }> {
  const cutoff = addDays(today, -REMINDER_SENT_RETENTION_DAYS);
  let pruned = 0;
  let full = true;
  for (let pass = 0; full && pass < MAX_PRUNE_PASSES_PER_RUN; pass++) {
    const res = await db
      .prepare(
        'DELETE FROM reminder_sent WHERE rowid IN (SELECT rowid FROM reminder_sent WHERE due_on < ? ORDER BY due_on LIMIT ?)',
      )
      .bind(cutoff, MAX_PRUNE_PER_RUN)
      .run();
    const n = Number(res.meta?.changes ?? 0);
    pruned += n;
    full = n >= MAX_PRUNE_PER_RUN;
  }
  return { pruned, capped: full };
}

/** Digests already sent today, portfolio-wide — one unsubscribe hash per digest. */
async function digestsSentSince(db: SqlDb, dayStart: string): Promise<number> {
  const row = await firstRow<{ n: number }>(
    db.prepare('SELECT COUNT(DISTINCT unsubscribe_hash) AS n FROM reminder_sent WHERE sent_at >= ?').bind(dayStart),
  );
  return Number(row?.n ?? 0);
}

/** Build every opted-in person's pending digest for one app. */
async function pendingFor(env: Env, target: AppTarget, db: SqlDb, today: string): Promise<{ optedIn: number; pending: Pending[] }> {
  const prefs = await allRows<{ user_id: string; lead_days: number }>(
    env.PLATFORM_DB.prepare(
      'SELECT user_id, lead_days FROM reminder_prefs WHERE app_id = ? AND email_opt_in = 1 ORDER BY user_id',
    ).bind(target.appId),
  );
  if (prefs.length === 0) return { optedIn: 0, pending: [] };
  const personLead = new Map(prefs.map((p) => [p.user_id, clampLead(p.lead_days)]));
  const subs = await readLiveSubscriptions(db, prefs.map((p) => p.user_id));
  // What this app has already mailed for a renewal still ahead — the digest is
  // built without them, and the claim below is the backstop if this read is stale.
  const sent = await allRows<{ user_id: string; subscription_id: string; due_on: string; kind: string; sent_at: string }>(
    env.PLATFORM_DB.prepare(
      'SELECT user_id, subscription_id, due_on, kind, sent_at FROM reminder_sent WHERE app_id = ? AND due_on >= ?',
    ).bind(target.appId, today),
  );
  // ⏱ 2026-09-30 · review of #1090, minor 1. A WINDOW IS COVERED BY ANY MAIL SENT
  // INSIDE IT, WHATEVER KIND CLAIMED IT. Keyed on the kind alone, a `renewal`
  // claim (the account lead — every claim written before per-subscription leads
  // were read) did not cover `renewal:<days>`, so a subscription whose own list
  // matched the account lead was mailed twice when this went live, and a list
  // switched on inside an already-mailed window was mailed again. So the latest
  // day each renewal was mailed is kept, and a reminder at lead L is skipped when
  // that day is on or after `due − L`. The per-kind UNIQUE claim stays the
  // backstop against two runs racing.
  //
  // ⏱ delta review of #1090, nit — AND THE EXACT KIND STILL COVERS ITSELF. A lead
  // LOWERED after its mail (7 → 3) leaves a `renewal` claim dated outside the new
  // window, which the window rule alone calls uncovered: the item would then spend
  // one of MAX_ADDRESS_READS_PER_RUN every night on a send the UNIQUE claim
  // refuses. So a reminder is skipped when EITHER holds.
  const lastMailed = new Map<string, string>();
  const claimedKinds = new Set<string>();
  for (const s of sent) {
    const key = `${s.user_id}\u0000${s.subscription_id}\u0000${s.due_on}`;
    claimedKinds.add(`${key}\u0000${s.kind}`);
    const day = String(s.sent_at).slice(0, 10);
    const prev = lastMailed.get(key);
    if (prev === undefined || day > prev) lastMailed.set(key, day);
  }
  const byUser = new Map<string, Pending>();
  for (const sub of subs) {
    const due = nextOccurrence(sub, today);
    if (due === null) continue;
    const reminder = dueReminder(sub, due, today, personLead.get(sub.user_id) ?? DEFAULT_LEAD_DAYS);
    if (reminder === null) continue;
    const { lead, kind } = reminder;
    const key = `${sub.user_id}\u0000${sub.id}\u0000${due}`;
    if (claimedKinds.has(`${key}\u0000${kind}`)) continue;
    const mailedOn = lastMailed.get(key);
    if (mailedOn !== undefined && mailedOn >= addDays(due, -lead)) continue;
    const item: DueItem = {
      subscriptionId: sub.id,
      name: (sub.name ?? '').trim() || 'A subscription',
      dueOn: due,
      cycle: sub.cycle,
      price: sub.price,
      currency: sub.currency,
      priceMinor: sub.price_minor,
      lead,
      kind,
    };
    const since = addDays(due, -lead);
    const p = byUser.get(sub.user_id) ?? { userId: sub.user_id, items: [], since };
    p.items.push(item);
    if (since < p.since) p.since = since;
    byUser.set(sub.user_id, p);
  }
  const pending = [...byUser.values()];
  for (const p of pending) p.items.sort((a, b) => (a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0));
  // OLDEST FIRST: the digest that has waited longest (its earliest item entered
  // its window first) takes the cap's next slot; ties by the nearest renewal,
  // then by account, so the order is total and a re-run picks the same people.
  pending.sort(
    (a, b) =>
      (a.since < b.since ? -1 : a.since > b.since ? 1 : 0) ||
      (a.items[0].dueOn < b.items[0].dueOn ? -1 : a.items[0].dueOn > b.items[0].dueOn ? 1 : 0) ||
      (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );
  return { optedIn: prefs.length, pending };
}

/**
 * Claim a digest's items; only the ones that land are mailed. ONE static
 * statement whatever the digest's length: the items travel as one JSON parameter
 * and `json_each` expands them, and `RETURNING` names exactly the rows this claim
 * inserted — a row another run already holds is skipped by the UNIQUE constraint
 * and is not returned. (`WHERE true` is SQLite's required disambiguation between
 * an INSERT … SELECT and its upsert clause.)
 */
async function claim(
  env: Env,
  appId: string,
  p: Pending,
  items: readonly DueItem[],
  sentAt: string,
  unsubscribeHash: string,
): Promise<DueItem[]> {
  const landed = await allRows<{ subscription_id: string; due_on: string; kind: string }>(
    env.PLATFORM_DB.prepare(
      `INSERT INTO reminder_sent (user_id, app_id, subscription_id, due_on, kind, sent_at, unsubscribe_hash)
       SELECT ?1, ?2, json_extract(j.value, '$.s'), json_extract(j.value, '$.d'), json_extract(j.value, '$.k'), ?3, ?4
       FROM json_each(?5) AS j WHERE true
       ON CONFLICT DO NOTHING RETURNING subscription_id, due_on, kind`,
    ).bind(
      p.userId,
      appId,
      sentAt,
      unsubscribeHash,
      JSON.stringify(items.map((i) => ({ s: i.subscriptionId, d: i.dueOn, k: i.kind }))),
    ),
  );
  const keys = new Set(landed.map((r) => `${r.subscription_id}\u0000${r.due_on}\u0000${r.kind}`));
  return items.filter((i) => keys.has(`${i.subscriptionId}\u0000${i.dueOn}\u0000${i.kind}`));
}

/** One app's pass. Never throws: the caller is a loop over every app. */
async function remindApp(
  env: Env,
  target: AppTarget,
  state: RunState,
  mail: MailTransport,
  identity: IdentityAdmin,
): Promise<ReminderRow> {
  if (!target.db) return { target: target.appId, ok: false, detail: 'no database binding for this app' };
  try {
    const { optedIn, pending } = await pendingFor(env, target, target.db, state.today);
    const tail = `pruned=${state.pruned} prune_capped=${state.pruneCapped ? 1 : 0}`;
    if (pending.length === 0) {
      return { target: target.appId, ok: true, detail: `nothing due: opted_in=${optedIn} due=0 ${tail}` };
    }
    let sent = 0;
    let deferred = 0;
    let unconfirmed = 0;
    let errors = 0;
    let firstError = '';
    const fail = (why: string): void => {
      errors++;
      if (!firstError) firstError = why;
    };
    for (const p of pending) {
      if (state.sentToday >= MAX_REMINDER_MAILS_PER_DAY || state.readsLeft <= 0) {
        deferred++;
        continue;
      }
      state.readsLeft--;
      const account = await readAccount(identity, p.userId);
      if (account.kind === 'transient' || account.kind === 'failed') {
        fail(`address read: ${account.why}`);
        continue;
      }
      // CONFIRMED addresses only: an unconfirmed one is an address anybody can
      // type, and mailing it would send someone's renewals to a stranger.
      if (account.kind !== 'found' || account.email === '' || account.email_confirmed_at === null) {
        unconfirmed++;
        continue;
      }
      const token = mintToken();
      const hash = await sha256Hex(token);
      const items = await claim(env, target.appId, p, p.items.slice(0, MAX_DIGEST_ITEMS), state.sentAt, hash);
      if (items.length === 0) continue;
      const unsubscribeUrl = `${REMINDER_LINK_ORIGIN}/v1/reminders/unsubscribe?t=${token}`;
      const digest = buildDigest(target.appId, items, unsubscribeUrl);
      let delivered = false;
      let refused = false;
      let why = '';
      let res: MailOutcome;
      try {
        res = await mail.send({
          stream: 'reminders',
          to: [account.email],
          subject: digest.subject,
          text: digest.text,
          html: digest.html,
          headers: {
            'List-Unsubscribe': `<${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
      } catch (err) {
        // The port resolves every outcome; a throw is a defect, and it may have sent.
        res = { ok: false, kind: 'timeout', retryable: false, detail: `mail transport threw ${err instanceof Error ? err.name : 'a non-error'}` };
      }
      delivered = res.ok;
      // `timeout` got no answer and may have been delivered; every other failure
      // is a definite answer that delivered nothing.
      refused = !res.ok && res.kind !== 'timeout';
      if (!res.ok) why = res.detail;
      if (delivered) {
        sent++;
        state.sentToday++;
        continue;
      }
      fail(why);
      // A DEFINITE refusal (Resend answered, not 2xx) releases the claims so the
      // next night tries again. A send that THREW — a timeout, a dropped
      // connection — may still have been delivered, so its claims STAY: that
      // renewal is not mailed again, and the row says so. If the release itself
      // throws, the outer catch records it and the items stay claimed.
      if (refused) await env.PLATFORM_DB.prepare('DELETE FROM reminder_sent WHERE unsubscribe_hash = ?').bind(hash).run();
    }
    const due = pending.reduce((n, p) => n + p.items.length, 0);
    const counts =
      `sent=${sent} deferred=${deferred} unconfirmed=${unconfirmed} errors=${errors} opted_in=${optedIn} due=${due} ` +
      `sent_today=${state.sentToday}/${MAX_REMINDER_MAILS_PER_DAY} ${tail}`;
    return { target: target.appId, ok: errors === 0, detail: errors === 0 ? counts : `${counts} — first error: ${firstError}` };
  } catch (err) {
    return { target: target.appId, ok: false, detail: `reminder pass failed: ${String(err)}` };
  }
}

/**
 * The nightly digest, fanned over every app target in order — one heartbeat row
 * per app, or one `(none)` row when the target list is empty. Sequential for the
 * renewals fan-out's reasons: one app's failure is contained, and the cap is a
 * single running count across the portfolio.
 */
export async function runReminderMail(
  env: Env,
  targets: readonly AppTarget[],
  nowMs: number = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<ReminderRow[]> {
  if (targets.length === 0) return [{ target: '(none)', ok: false, detail: 'no app targets configured' }];
  const missing = [
    ...(env.RESEND_API_KEY ? [] : ['RESEND_API_KEY']),
    ...(env.SUPABASE_SERVICE_ROLE_KEY ? [] : ['SUPABASE_SERVICE_ROLE_KEY']),
  ];
  if (missing.length > 0) {
    return targets.map((t) => ({
      target: t.appId,
      ok: false,
      detail: `not configured: ${missing.join(' and ')} not set on this Worker, so no reminder can be sent`,
    }));
  }
  // The `reminders` stream (src/ports.ts): its own key when one is set, else the
  // reports key above — so with RESEND_API_KEY present this is never null.
  const mail = mailFor('reminders', env, fetchImpl);
  if (!mail) {
    return targets.map((t) => ({ target: t.appId, ok: false, detail: 'not configured: no key for the reminders mail stream' }));
  }
  const today = ymdOf(nowMs);
  const state: RunState = {
    today,
    sentAt: new Date(nowMs).toISOString(),
    sentToday: 0,
    readsLeft: MAX_ADDRESS_READS_PER_RUN,
    pruned: 0,
    pruneCapped: false,
  };
  try {
    const prune = await pruneLedger(env.PLATFORM_DB, today);
    state.pruned = prune.pruned;
    state.pruneCapped = prune.capped;
    state.sentToday = await digestsSentSince(env.PLATFORM_DB, `${today}T00:00:00.000Z`);
  } catch (err) {
    return targets.map((t) => ({ target: t.appId, ok: false, detail: `reminder ledger unreadable: ${String(err)}` }));
  }
  const rows: ReminderRow[] = [];
  for (const t of targets) {
    rows.push(await remindApp(env, t, state, mail, identityFor(env, { fetchImpl })));
  }
  return rows;
}
