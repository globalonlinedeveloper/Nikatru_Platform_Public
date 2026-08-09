// ─────────────────────────────────────────────────────────────────────────────
// The money world this deploy lives in — [5]M-12, subly-api's copy.
//
// The CANONICAL contract is services/platform/src/lib/mor/contract.ts
// (`MoneyEnvironment` / `isMoneyEnvironment`); this file restates its two-value
// vocabulary rather than importing it because subly-api is the shape a stamped
// per-app Worker ships in, and a stamped tree has no ../platform sibling to
// resolve the import against. Two values, one meaning: a row written under
// 'sandbox' money must never unlock anything read under 'live', and vice versa.
//
// FAIL CLOSED ON AN ABSENT OR UNRECOGNISED VALUE — same rule, same reason as
// services/platform/src/routes/money.ts: a default of 'live' would honour
// sandbox money as real, a default of 'sandbox' would silently stop honouring
// real payments, and neither is a safe guess. Callers answer 503 and name the
// variable instead.
// ─────────────────────────────────────────────────────────────────────────────

export type MoneyEnvironment = 'live' | 'sandbox';

export function isMoneyEnvironment(v: unknown): v is MoneyEnvironment {
  return v === 'live' || v === 'sandbox';
}
