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
// A TypeScript interface (`CreateBody`, `RevenueCatEvent`) is NOT a runtime
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

/** A non-empty string no longer than [max] — for identifiers. */
export function isIdString(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/**
 * The largest |ms| a JS Date can represent (ECMA-262 time-value range).
 *
 * Past this, `new Date(ms)` is an Invalid Date and `.toISOString()` THROWS a
 * RangeError. In a webhook handler that is a 500 the sender retries forever, and
 * `1e400` parses out of JSON as `Infinity`, so the input is reachable from the
 * wire — it does not need a hostile client, only a buggy one.
 */
export const MAX_TIME_MS = 8.64e15;

/**
 * Epoch-ms -> ISO-8601, or null when the value is not a representable instant.
 *
 * TOTAL BY CONSTRUCTION: the range check and the conversion are the same
 * function, so they cannot drift apart the way a check in one file and a
 * `new Date(...).toISOString()` in another can.
 */
export function isoFromEpochMs(ms: unknown): string | null {
  if (!isFiniteNumber(ms)) return null;
  if (Math.abs(ms) > MAX_TIME_MS) return null;
  return new Date(ms).toISOString();
}

/** 'YYYY-MM-DD' matching a real calendar date (rejects 2026-02-31). */
export function isCalendarDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  // Round-trip: Date.parse accepts '2026-02-31' and normalises it to March 3rd,
  // so equality with the input is what actually rejects an impossible day.
  return new Date(ms).toISOString().slice(0, 10) === v;
}
