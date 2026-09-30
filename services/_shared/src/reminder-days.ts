// ─────────────────────────────────────────────────────────────────────────────
// reminder-days.ts — THE `subscriptions.reminder_days` CONTRACT. THE ONE HOME.
//
// ⏱ 2026-09-30 · O-REMINDER-DAYS-JSON-READ-AS-NUMBER (rv2-services-001).
// subscriptiontracker-api WRITES the column as JSON text — `'[7,1]'`, `'[]'` or
// NULL (its 0003 migration, lines 91-92) — and the platform Worker READ it as a
// number. A TEXT column always arrives as a string, so the platform dropped every
// value: the e-mail digest and the live calendar-feed alarms used the account
// lead for every subscription, and an explicit `[]` ("no reminder for this one")
// was mailed and alarmed anyway. Two Workers, two readings of one column, and
// nothing that held them equal. So the reading lives here, once, and both
// Workers call it: the API to validate what it writes and to serve what it
// stored, the platform to decide what to remind.
//
// THE THREE ANSWERS, and they are three, not two:
//   · NULL            → `null`: "use the account's lead" (reminder_prefs.lead_days);
//   · `[]`            → `[]`:   "no reminder for this subscription" — no mail, no alarm;
//   · `[d, …]`        → the list: one reminder `d` days before the charge, per entry.
// Anything else — not JSON, not a list, a decimal, a negative, past a year, a
// repeat, too many — is a row edited outside the API, and reads as `null` (the
// account lead). Never a guess at what was meant, and never a thrown error that
// would fail the whole read for one bad row.
//
// 🔴 THE PLATFORM HONOURS THE WHOLE RANGE THE API ACCEPTS (0..MAX_REMINDER_DAY),
// deliberately. The account-wide lead is capped at 30 (platform
// lib/reminders.ts MAX_LEAD_DAYS), but a per-subscription entry is a choice the
// API already accepted and stored — an annual plan with a 60-day notice period
// is exactly who sets `[60]`. Clamping it to 30 would be the same silent
// disregard this file exists to end.
//
// ⚠️ NOTHING IN `services/_shared/src/` MAY CARRY A BARE IMPORT — see
// services/_shared/test/shared-home.test.ts. This module imports nothing.
// ─────────────────────────────────────────────────────────────────────────────

/** @ceiling none — a list length on one column; the spec's example is [7,1]. */
export const MAX_REMINDERS = 5;

/** @ceiling none — a VALUE bound: a reminder at most a year before the charge. */
export const MAX_REMINDER_DAY = 365;

/** A whole number of days in 0..MAX_REMINDER_DAY. */
function isReminderDay(d: unknown): d is number {
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= MAX_REMINDER_DAY;
}

/**
 * True when `v` is a list the column may hold: at most MAX_REMINDERS different
 * whole numbers of days, each 0..MAX_REMINDER_DAY. `[]` is valid (no reminder).
 * The API's write validation and the stored-value parse below are this one test.
 */
export function isReminderDaysList(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length <= MAX_REMINDERS &&
    v.every(isReminderDay) &&
    new Set(v).size === v.length
  );
}

/**
 * The stored column → what it means. `null` = the account lead; `[]` = no
 * reminder; a list = those days. Accepts the raw D1 value (`string | null`, or
 * anything a row edited by hand may carry) and never throws.
 */
export function parseReminderDays(raw: unknown): number[] | null {
  if (typeof raw !== 'string') return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  return isReminderDaysList(v) ? v : null;
}
