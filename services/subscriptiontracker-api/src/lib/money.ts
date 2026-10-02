// ─────────────────────────────────────────────────────────────────────────────
// The money world this deploy lives in — [5]M-12, subscriptiontracker-api's view.
//
// ⏱ 2026-10-01 · rv2 SYN-S2 (services-035).
// A RE-EXPORT. `MoneyEnvironment` / `isMoneyEnvironment` are declared once, in
// contracts/entitlement/contract.js, which services/platform's
// src/lib/mor/contract.ts re-exports too. This file used to RESTATE the two-value
// vocabulary on the ground that a stamped tree has no ../platform sibling to
// import from; that held for platform, but `contracts/` sits at the repo root,
// which every stamped tree has, and esbuild inlines the `.js` at bundle time
// (`wrangler deploy --dry-run` proves the bundle resolves it). Two values, one
// meaning: a row written under 'sandbox' money must never unlock anything read
// under 'live', and vice versa.
//
// FAIL CLOSED ON AN ABSENT OR UNRECOGNISED VALUE — same rule, same reason as
// services/platform/src/routes/money.ts: a default of 'live' would honour
// sandbox money as real, a default of 'sandbox' would silently stop honouring
// real payments, and neither is a safe guess. Callers answer 503 and name the
// variable instead.
// ─────────────────────────────────────────────────────────────────────────────
export { isMoneyEnvironment, type MoneyEnvironment } from '../../../../contracts/entitlement/contract.js';
