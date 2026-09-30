// ─────────────────────────────────────────────────────────────────────────────
// tooling/catalog/sbp-enrolment.mjs — THE ONE READING of the Apple Small Business
// Program cell. A LIBRARY: it returns, it never prints and never exits.
//
// Two tools read `apple-small-business-enrolment` in tooling/catalog/fee-register.json:
// render-rail-prices.mjs (limb G picks the Apple rate from it) and
// tooling/ci/assert-small-business-program.mjs (it refuses a real App Store
// submission while the cell is null). Each used to carry its own date check, and
// the two differed: one accepted an ISO instant and a date in the future, the
// other a plain date no later than today. So a value could select the 15% rate in
// the net sheet while the gate refused it. Both now judge the value here.
//
// THE VALUE IS THE DAY APPLE APPROVED THE ENROLMENT, not the day it was asked
// for. https://developer.apple.com/app-store/small-business-program/, read
// 2026-09-30: "Your proceeds will be adjusted fifteen (15) days after the end of
// the fiscal calendar month in which your enrollment is approved."
// ─────────────────────────────────────────────────────────────────────────────

/** The fee-register cell the owner fills (owner queue A-18). */
export const SBP_ENROLMENT_CELL = 'apple-small-business-enrolment';

const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today as YYYY-MM-DD, UTC. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Judge the cell's value. `null` is "not enrolled", which is not a problem here: the gate decides what it refuses.
 * @param {unknown} value the cell's `value`
 * @param {string} [today] YYYY-MM-DD, UTC
 * @returns {{ enrolled: boolean, problem: string | null }} `problem` completes the sentence "<cell>.value …"
 */
export function readEnrolment(value, today = todayUtc()) {
  if (value === null) return { enrolled: false, problem: null };
  const t = typeof value === 'string' && PLAIN_DAY.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  const calendar = Number.isFinite(t) && new Date(t).toISOString().startsWith(value); // 2026-02-30 parses, and rolls over
  if (!calendar) {
    return {
      enrolled: false,
      problem:
        `is ${JSON.stringify(value)}; it is null, or the enrolment APPROVAL date the console shows, as a plain calendar ` +
        'date (YYYY-MM-DD, no time).',
    };
  }
  if (value > today) {
    return {
      enrolled: false,
      problem: `is ${value}, after today (${today}). An approval is recorded once the console shows it, not before.`,
    };
  }
  return { enrolled: true, problem: null };
}
