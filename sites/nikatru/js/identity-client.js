// ─────────────────────────────────────────────────────────────────────────────
// identity-client.js — EVERY CALL THIS SITE MAKES TO THE IDENTITY PROVIDER.
//
// ⏱ 2026-10-03 · port-auth (tooling/ports/auth.json). The site's half of the
// auth port: the provider's wire — GoTrue's `/auth/v1` paths, the `apikey`
// header, the grant names — lives in this one module, and no other file under
// sites/ names an identity-provider path (tooling/ci/assert-ports.mjs limb 4,
// its URL half; this file is that check's positive control). Callers
// (js/signin.js) speak verbs and hand it the endpoint and the public key.
//
// It sits in sites/nikatru/js/, not sites/_shared/: the Pages project serves
// sites/nikatru with no build step (sites/nikatru/README.md), so a module
// outside it would never reach a browser.
//
// The endpoints were read 2026-09-24 from supabase/auth-js src/GoTrueClient.ts
// and supabase/auth README.md (signin.js keeps the record):
//   · POST {AUTH}/token?grant_type=<grant>, the publishable key in `apikey`;
//   · GET  {AUTH}/authorize?<query> — a full-page navigation, never a fetch.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A client of the identity provider at `endpoint` (its origin), sending the
 * public `publicKey`. Moved verbatim from signin.js (`tokenCall`, the
 * authorize URL); what each answer means is unchanged.
 */
export function identityClient({ endpoint, publicKey }) {
  const AUTH = `${endpoint}/auth/v1`;
  return {
    /** A token grant. Resolves to the parsed session, or throws an Error whose
     *  message is a fixed phrase — never the response body, which can echo input. */
    async token(grant, body) {
      let res;
      try {
        res = await fetch(`${AUTH}/token?grant_type=${grant}`, {
          method: 'POST',
          headers: { apikey: publicKey, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error('network');
      }
      if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'credentials' : 'unavailable');
      const session = await res.json();
      if (!session || typeof session.access_token !== 'string') throw new Error('unavailable');
      return session;
    },

    /** Where a browser goes to start a provider sign-in (PKCE). */
    authorizeUrl(query) {
      return `${AUTH}/authorize?${query.toString()}`;
    },
  };
}
