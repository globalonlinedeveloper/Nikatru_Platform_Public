// ─────────────────────────────────────────────────────────────────────────────
// e2e_email.mjs — THE SHAPES OF A THROWAWAY E2E ADDRESS, minted by
// tooling/e2e/provision_user.mjs and matched by tooling/e2e/purge_stale.mjs.
//
// One module, so the address the provisioner writes and the address the stale
// sweep is allowed to delete cannot drift apart: a sweep matching an old shape
// would stop finding leaks in silence, and one matching a looser shape would
// delete accounts the harness never made.
//
// The address is `subscriptiontracker-e2e+<Date.now()>@nikatru.com`: GoTrue
// rejects @example.com, and nikatru.com is the platform's own domain, so no
// outside person can hold a mailbox of this shape. The 13-digit epoch-ms tag is
// the second witness of age the sweep reads beside GoTrue's own created_at.
//
// ⏱ 2026-10-03 — 🔴 ONLY A MARKED ADDRESS IS SWEEPABLE (PR #1177 review,
// finding 3). The stale sweep purges a user's rows in ONE app's PRODUCTION
// database, and the bare address names neither the app nor the database: a
// store capture's user (rows in the SANDBOX databases, purge.mjs) or another
// app's would lose its auth user, the only handle on its rows, while the rows
// stayed. So e2e.yml — whose every user's rows live in `matrix.app`'s
// production APP_DB, exactly where the sweep purges — mints the MARKED shape
// `subscriptiontracker-e2e+<app>.<tag>@nikatru.com` (provision_user.mjs, env
// E2E_SWEEP_APP), and the sweep selects only the marked addresses of its own
// app. Every other caller keeps the bare shape, which no sweep ever selects.
// ─────────────────────────────────────────────────────────────────────────────

/** The literal local-part prefix every throwaway E2E address starts with. */
export const E2E_EMAIL_PREFIX = 'subscriptiontracker-e2e+';
export const E2E_EMAIL_DOMAIN = 'nikatru.com';

/** The bare address, anchored, lower-case only: prefix, a 13-digit epoch-ms
 *  tag, the domain. Nothing before, nothing after, no other domain. Never swept. */
export const E2E_EMAIL_SHAPE = /^subscriptiontracker-e2e\+(\d{13})@nikatru\.com$/;

/** The MARKED address, the only one a sweep selects: prefix, the app id that
 *  owns its rows, a dot, the 13-digit tag, the domain. Anchored at both ends. */
export const E2E_SWEEPABLE_SHAPE = /^subscriptiontracker-e2e\+([a-z0-9][a-z0-9-]*)\.(\d{13})@nikatru\.com$/;

/** An app id as tooling/e2e/backend.mjs accepts one. */
const APP_SLUG = /^[a-z0-9][a-z0-9-]*$/;
/** RFC 5321's ceiling on a local part. */
const LOCAL_PART_MAX = 64;

export class E2eEmailRefused extends Error {}

/** A fresh throwaway address, tagged with [nowMs]; MARKED for [sweepApp] when
 *  one is given (see the header), bare otherwise. */
export function e2eEmail(nowMs = Date.now(), { sweepApp } = {}) {
  if (sweepApp === undefined) return `${E2E_EMAIL_PREFIX}${nowMs}@${E2E_EMAIL_DOMAIN}`;
  if (typeof sweepApp !== 'string' || !APP_SLUG.test(sweepApp)) {
    throw new E2eEmailRefused(`E2E_SWEEP_APP is not an app id (${String(sweepApp).length} characters)`);
  }
  const local = `${E2E_EMAIL_PREFIX}${sweepApp}.${nowMs}`;
  if (local.length > LOCAL_PART_MAX) {
    throw new E2eEmailRefused(`E2E_SWEEP_APP makes a local part of ${local.length} characters, over ${LOCAL_PART_MAX}`);
  }
  return `${local}@${E2E_EMAIL_DOMAIN}`;
}

/** The epoch-ms tag of a bare address of E2E_EMAIL_SHAPE, or null for any other value. */
export function e2eEmailTagMs(email) {
  if (typeof email !== 'string') return null;
  const m = E2E_EMAIL_SHAPE.exec(email);
  return m ? Number(m[1]) : null;
}

/** The epoch-ms tag of an address MARKED for exactly [appId], or null for any
 *  other value: a bare address, another app's, or a near miss. */
export function e2eSweepTagMs(email, appId) {
  if (typeof email !== 'string' || typeof appId !== 'string') return null;
  const m = E2E_SWEEPABLE_SHAPE.exec(email);
  return m && m[1] === appId ? Number(m[2]) : null;
}
