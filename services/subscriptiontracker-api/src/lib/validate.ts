// ─────────────────────────────────────────────────────────────────────────────
// Runtime validation primitives for PUBLIC HTTP input.
//
// The pattern is the one budget.ts landed (routes/budget.ts `validate`): a route
// owns a single `validate(body)` that returns a discriminated union carrying
// either the CHECKED values or a 400 `detail` string, and never throws — so no
// code path can reach a write with a value the route has not looked at, and no
// caller gets a generic 500 for a mistake the route could name.
//
// These are the leaf checks that pattern is built from. They live here so the
// next route does not invent a third dialect of "check the body"; budget.ts's
// own validator predates this module and is deliberately left alone.
//
// A TypeScript interface (`CreateBody`, say) is NOT a runtime
// check on a public body — it is erased before the request arrives. Every one of
// these exists because a route was binding an unchecked value straight into D1.
// ─────────────────────────────────────────────────────────────────────────────

/** What every route-level validator returns on failure. */
export interface Invalid {
  ok: false;
  detail: string;
}

/** A JSON object — not null, not an array, not a scalar. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A number that is really a number: no NaN, no Infinity, no numeric string. */
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * A string no longer than [max].
 *
 * EMPTY IS ALLOWED. The Subly client sends `plan`/`glyph`/`usage_note` as `''`
 * for "not set", so rejecting empty here would 400 first-party traffic. Where a
 * value must be non-empty (an identity, say) the caller checks that itself.
 */
export function isBoundedString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

// ⏱ 2026-09-16 — `isIdString`, `MAX_TIME_MS` and `isoFromEpochMs` were removed
// with their only caller, the retired legacy RevenueCat route
// (src/routes/webhooks.ts, O-REVENUECAT-VERIFIER leg b). The RevenueCat instant is
// now canonicalised on the platform side, by `normalizeInstant` in
// services/platform/src/lib/mor/contract.ts.

/** 'YYYY-MM-DD' matching a real calendar date (rejects 2026-02-31). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Round-trip: Date.parse accepts '2026-02-31' and normalises it to March 3rd,
  // so equality with the input is what actually rejects an impossible day.
  return new Date(ms).toISOString().slice(0, 10) === v;
}
