// ─────────────────────────────────────────────────────────────────────────────
// e2e_email.mjs — THE ONE SHAPE OF A THROWAWAY E2E ADDRESS, minted by
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
// ─────────────────────────────────────────────────────────────────────────────

/** The literal local-part prefix every throwaway E2E address starts with. */
export const E2E_EMAIL_PREFIX = 'subscriptiontracker-e2e+';
export const E2E_EMAIL_DOMAIN = 'nikatru.com';

/** The WHOLE address, anchored, lower-case only: prefix, a 13-digit epoch-ms
 *  tag, the domain. Nothing before, nothing after, no other domain. */
export const E2E_EMAIL_SHAPE = /^subscriptiontracker-e2e\+(\d{13})@nikatru\.com$/;

/** A fresh throwaway address, tagged with [nowMs]. */
export function e2eEmail(nowMs = Date.now()) {
  return `${E2E_EMAIL_PREFIX}${nowMs}@${E2E_EMAIL_DOMAIN}`;
}

/** The epoch-ms tag of an address of E2E_EMAIL_SHAPE, or null for any other value. */
export function e2eEmailTagMs(email) {
  if (typeof email !== 'string') return null;
  const m = E2E_EMAIL_SHAPE.exec(email);
  return m ? Number(m[1]) : null;
}
