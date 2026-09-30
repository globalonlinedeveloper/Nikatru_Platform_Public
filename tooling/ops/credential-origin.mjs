// ─────────────────────────────────────────────────────────────────────────────
// credential-origin.mjs — THE ONE ANSWER TO "MAY THIS CREDENTIAL GO TO THAT
// HOST?" for every script that reads a key from the vault or the environment and
// sends it to a base URL it also read from the environment or a file.
//
// NOT A GUARD. It reads no file, makes no request and never sets an exit code.
// It returns an origin or throws CredentialOriginRefused; the caller refuses in
// its own exit-code convention, BEFORE its first request carrying the key.
//
// ── WHY IT EXISTS (⏱ 2026-09-30, CodeQL js/file-access-to-http audit) ────────
// 🔴 A CREDENTIAL WENT TO WHATEVER HOST ITS NEIGHBOUR IN THE ENVIRONMENT NAMED.
// The service-role key (verify-password-reset-revokes.mjs, tooling/e2e/
// magic_link.mjs, provision_user.mjs), the publishable key
// (verify-auth-providers.mjs) and the GlitchTip API token
// (glitchtip-monitor-api.mjs, verify-alarm-chains.mjs, assert-glitchtip-project.mjs,
// assert-glitchtip-no-ip.mjs, symbolication-proof.mjs) were each attached to a
// request whose origin came from SUPABASE_URL, GLITCHTIP_URL or a register's
// `instance`, and nothing compared that origin with the credential's ISSUER. One
// wrong or tampered line, and a production admin key is sent to any host that
// asks. assert-glitchtip-project.mjs had already pinned the register's instance
// (#293) and left the environment override open; this closes the class once.
//
// ── THE RULE: THE ISSUER, OR THIS MACHINE, NOTHING ELSE ─────────────────────
// The value is parsed with `new URL` and its ORIGIN compared EXACTLY — never a
// substring, prefix or suffix, which is what `auth-api.nikatru.com.evil.com` and
// `evil.com/auth-api.nikatru.com` exist to beat. Refused outright: userinfo (a
// credential of its own, and a way to make a URL read like another host), a
// path, query or fragment (the scripts append the API path to an ORIGIN; anything
// after it would be silently dropped or silently kept), and any https host that
// is not the issuer.
//   · supabase  — https://auth-api.nikatru.com (the self-hosted GoTrue,
//                 BOXC_DEFAULT_TARGET in tooling/ops/selfhosted-auth.mjs), or a
//                 hosted project https://<ref>.supabase.co whose HOSTNAME hashes
//                 to SUPABASE_HOSTED_HOST_SHA256 — OUR project, exactly. The ref is
//                 deliberately not in the public tree, so its sha256 is (⏱
//                 2026-09-30, review finding 4: the shape alone admitted every
//                 tenant of supabase.co, and the service-role key must never reach
//                 another project). The shape is still HOSTED_ORIGIN in
//                 tooling/e2e/auth_target_expectation.mjs; the hash narrows it to one;
//   · glitchtip — https://glitchtip.nikatru.com;
//   · both      — http on 127.0.0.1 / localhost / [::1], the loopback test seam
//                 of loopbackBase (extensions/scripts/store-poll.mjs) and
//                 githubApiBase (tooling/ci/record-deployment.mjs): the tests drive
//                 the real transport against a server in their own process, and a
//                 loopback address can only ever reach this machine. https on
//                 loopback is refused, as there. A caller whose value comes from a
//                 FILE passes `{ loopback: false }`: a file edit is never a test seam.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

/** The self-hosted GoTrue — the same literal as BOXC_DEFAULT_TARGET (asserted equal in the test). */
export const GOTRUE_SELFHOSTED_ORIGIN = 'https://auth-api.nikatru.com';
/** A hosted Supabase project's origin — the same shape as HOSTED_ORIGIN (asserted equal in the test). */
export const SUPABASE_HOSTED_ORIGIN = /^https:\/\/[a-z0-9]+\.supabase\.co$/;
/** sha256 of OUR hosted project's hostname (`<ref>.supabase.co`). Measured 2026-09-30
 *  on the machine holding the vault: sha256 of new URL(SUPABASE_URL).hostname, which
 *  equals SUPABASE_PROJECT_REF + '.supabase.co'. Re-measure it the same way if the
 *  hosted project is ever replaced; drop it when the hosted stack is retired. */
export const SUPABASE_HOSTED_HOST_SHA256 = '4d544c2d8e55934aab155541e14e74be2d4fd60cee9d653a241b23218b288edb';

/** PURE. Is this origin OUR hosted project — the shape, and the pinned hostname hash? */
export function isOurHostedProject(origin, pinned = SUPABASE_HOSTED_HOST_SHA256) {
  if (!SUPABASE_HOSTED_ORIGIN.test(origin)) return false;
  return createHash('sha256').update(new URL(origin).hostname).digest('hex') === pinned;
}
/** The one GlitchTip instance. */
export const GLITCHTIP_ORIGIN = 'https://glitchtip.nikatru.com';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Per credential kind: what the credential is called in a refusal, and its issuer(s). */
const ISSUERS = Object.freeze({
  supabase: {
    label: 'Supabase auth',
    accepts: (origin) => origin === GOTRUE_SELFHOSTED_ORIGIN || isOurHostedProject(origin),
    names: `${GOTRUE_SELFHOSTED_ORIGIN} or our hosted project https://<ref>.supabase.co (sha256-pinned)`,
  },
  glitchtip: {
    label: 'GlitchTip',
    accepts: (origin) => origin === GLITCHTIP_ORIGIN,
    names: GLITCHTIP_ORIGIN,
  },
});

/** The credential kinds this module knows. */
export const CREDENTIAL_KINDS = Object.freeze(Object.keys(ISSUERS));

/** Thrown for every refusal; the message is the line a caller prints. It never
 *  carries the raw value when that value did not parse, nor any userinfo. */
export class CredentialOriginRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'CredentialOriginRefused';
  }
}

/**
 * The normalized origin (no trailing slash) the [kind] credential may be sent to,
 * given the configured base [url] — or a thrown CredentialOriginRefused.
 *
 * @param {string} url      the configured base, e.g. process.env.SUPABASE_URL
 * @param {'supabase'|'glitchtip'} kind
 * @param {{loopback?: boolean}} [options]  loopback: false for a value read from a file
 * @returns {string}
 */
export function credentialOrigin(url, kind, { loopback = true } = {}) {
  const issuer = ISSUERS[kind];
  if (!issuer) throw new TypeError(`credentialOrigin: unknown credential kind ${JSON.stringify(kind)} (known: ${CREDENTIAL_KINDS.join(', ')})`);
  const allowed = `allowed: ${issuer.names}${loopback ? ', or http on 127.0.0.1 / localhost / [::1]' : ''}`;
  const refuse = (what) => new CredentialOriginRefused(`refusing to send the ${issuer.label} credential to ${what}: not its issuer (${allowed})`);

  const raw = typeof url === 'string' ? url.trim() : '';
  if (raw === '') throw refuse('an empty base URL');
  let u;
  try {
    u = new URL(raw);
  } catch {
    // Not echoed: a value that is not a URL may be a pasted key.
    throw refuse(`a value that is not a URL (${raw.length} characters)`);
  }
  if (u.username !== '' || u.password !== '') throw refuse(`${u.origin} with userinfo in the URL`);
  if (u.pathname !== '/' || u.search !== '' || u.hash !== '') {
    throw refuse(`${u.origin} with a path, query or fragment after it (the base must be an origin)`);
  }
  const origin = u.origin;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname)) {
    if (loopback) return origin;
    throw refuse(`${origin}, a loopback address read from a file (a file edit is never a test seam)`);
  }
  if (u.protocol === 'https:' && issuer.accepts(origin)) return origin;
  throw refuse(origin);
}
