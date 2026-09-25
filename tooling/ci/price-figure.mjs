// ─────────────────────────────────────────────────────────────────────────────
// price-figure.mjs — the ONE answer to "does this text name a price, or the
// lifetime plan?", for every reader that hunts one.
//
// O-PRICE-GUARD-IS-DART-ONLY. Until 2026-09-24 the repo held TWO price
// matchers and they disagreed:
//
//   assert-no-price-literals.mjs   [$€£¥₹] symbol-first, seven ISO codes on
//                                  either side, case-sensitive; read .dart only
//   assert-store-metadata.mjs      ₹, Rs, INR, $, USD, case-insensitive; read
//                                  three apps-gov-in listing files only
//
// Neither was a superset of the other. `€4.99` in the apps.gov.in listing passed
// the second (no `€`); `Rs 2,499` in a Dart string passed the first (no `Rs`).
// So the matcher is ONE regex here, the UNION of both, and both guards import
// it — so the two guards cannot disagree about what a price is.
//
// ── THE SHAPES ───────────────────────────────────────────────────────────────
//   symbol-first   `$4.99`, `₹399`, `£1,299.00`, `€ 4`
//   Rs-first       `Rs 1,499`, `Rs. 499`, `RS499`
//   code-first     `USD 4.99`, `INR 499`, `usd4.99`
//   code-last      `19.99 EUR`, `499 INR`
// Case-insensitive throughout, because the listing matcher was: a listing is
// prose, and `usd 4.99` in prose is a price. A bare number is NOT a price:
// "7 days", "3 devices" and "1.0.101" carry no currency marker.
//
// `LIFETIME` is the word, whole: [ADR 093] §2 keeps the lifetime plan on the web
// checkout only, and "per §11.2 — no app and no store listing mentions it".
//
// It scans nothing and exits nowhere: two regexes, no filesystem, no tree. The
// coverage question belongs to its importers, each of which carries its own
// COVERAGE LOST over what it reads, and assert-no-price-literals.mjs proves the
// matcher against known-dirty input on every run before it trusts it. Flat in
// tooling/ci because assert-guard-coverage treats a subdirectory as a guard
// escaping its scan. Its failing cases are in test/price-figure.test.mjs.
// ─────────────────────────────────────────────────────────────────────────────

/** The ISO 4217 codes either matcher named. */
const CODES = '(?:USD|EUR|GBP|INR|JPY|AUD|CAD)';
/** A figure: digits with optional thousands commas and at most two decimals. */
const FIGURE = String.raw`\d[\d,]*(?:\.\d{1,2})?`;

/**
 * A money figure in any notation either old matcher read. No `g` flag, so
 * `PRICE.test` and `PRICE.exec` carry no state between calls.
 */
export const PRICE = new RegExp(
  [
    String.raw`[$€£¥₹]\s?${FIGURE}`,
    String.raw`\bRs\.?\s*${FIGURE}`,
    String.raw`\b${CODES}\s*${FIGURE}`,
    String.raw`\b${FIGURE}\s?${CODES}\b`,
  ].join('|'),
  'i',
);

/** The lifetime plan, by name. Whole word, any case. */
export const LIFETIME = /\blifetime\b/i;
