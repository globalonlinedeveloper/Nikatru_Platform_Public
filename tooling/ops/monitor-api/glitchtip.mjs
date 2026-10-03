// ─────────────────────────────────────────────────────────────────────────────
// monitor-api/glitchtip.mjs — the `glitchtip` adapter of the ops MONITOR API: the
// one place an ops script's request to GlitchTip's uptime-monitor API is made.
//
// The writer half — `api`, `requestBodyFrom`, `POLICY`, the vault token — is
// tooling/ops/glitchtip-monitor-api.mjs, unchanged and re-exported here (its path
// is pinned by tooling/ci/credential-origin-exempt.json, the CodeQL disposition
// for #496 and the credential-origin guard's tests, so it stays where those read
// it). The reader half `verify-monitors.mjs` used to make itself — one bounded,
// second-look GET of the monitor list — is `listMonitors` below, moved here
// verbatim so no ops script composes a monitor URL of its own
// (tooling/ci/assert-ports.mjs limb 9).
//
// The DATA stays tooling/monitor-register.json: this module speaks the API, the
// register says which monitors must exist.
// ─────────────────────────────────────────────────────────────────────────────
import { fetchWithBoundedRetry } from '../bounded-retry.mjs';
import { credentialOrigin } from '../credential-origin.mjs';

export { api, BASE, ORG, POLICY, requestBodyFrom, vaultToken } from '../glitchtip-monitor-api.mjs';

/** The adapter's wire id. */
export const ADAPTER = 'glitchtip';

/** The organisation's monitor collection, relative to the API base. */
export const monitorsPath = (org) => `/api/0/organizations/${org}/monitors/`;

/**
 * GET the organisation's monitor list, as verify-monitors always has: on
 * tooling/ops/bounded-retry.mjs's plan with its `secondLook` (a US edge stalling
 * in front of the Mumbai tunnel can outlast the first ~50 s). Resolves to the
 * `Response`, whatever its status; the caller grades it. `base` is pinned to the
 * token's issuer by tooling/ops/credential-origin.mjs before anything is sent.
 *
 * NO `CF-Connecting-IP` HEADER, EVER — Cloudflare's edge rejects any client
 * request carrying one with error 1000 before the origin is reached.
 */
export function listMonitors({ base, org, token }) {
  const origin = credentialOrigin(base, 'glitchtip');
  return fetchWithBoundedRetry(
    ({ signal }) =>
      fetch(`${origin}${monitorsPath(org)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal,
      }),
    { describe: (why) => `the monitor list: ${why}`, secondLook: true },
  );
}
