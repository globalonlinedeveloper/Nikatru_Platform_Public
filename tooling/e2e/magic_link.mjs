// ─────────────────────────────────────────────────────────────────────────────
// magic_link.mjs — THE ONE MINTER of the single-use sign-in token a headless
// drive spends at `/verify` instead of typing a password into the login form.
//
// Two callers, one request, which is the whole reason this is a module:
//   · tooling/e2e/provision_user.mjs — the token every provisioned user is
//     handed as the `token_hash` step output (e2e.yml, store-screenshots.yml);
//   · tooling/store/capture-play-screenshots.mjs — a FRESH token for every
//     drive after the first, because the token is SINGLE USE and a capture runs
//     one drive per viewport.
//
// Why a token and not the password, and the measurements behind it, are in
// provision_user.mjs's "THE CAPTCHA-PROOF LOGIN PATH" block.
//
// 🔴 ONE LIVE TOKEN PER USER. GoTrue keeps a single magic-link token per user
// and a new `generate_link` replaces it, so tokens cannot be minted up front
// for every drive: mint the next one only after the previous drive has run.
//
// ⚠️ The service-role key goes in and nothing but the hashed token comes out.
// The caller masks and redacts the token; this module prints nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { CredentialOriginRefused, credentialOrigin } from '../ops/credential-origin.mjs';

/** The shape GoTrue issues a `hashed_token` in: lowercase hex (a SHA-224 digest
 *  today, 56 characters; the range leaves room for another digest). */
export const TOKEN_HASH_SHAPE = /^[0-9a-f]{40,128}$/;

/**
 * ⏱ 2026-10-02 — Cloudflare's origin-fault answers (520-529): the request was
 * lost between the edge and the identity server, and the server never saw it.
 * Measured 2026-10-01 15:00:51Z: `POST /admin/generate_link` answered 520 after
 * 12.9 s with no line in Box C's GoTrue or envoy log, and main's E2E went red on
 * it. The user is a throwaway and a second mint replaces the first token, so the
 * mint is asked ONCE more on one of these, and says so in the log.
 */
export const ORIGIN_FAULT = (status) => status >= 520 && status <= 529;
/** The pause before the one retry. */
export const MINT_RETRY_DELAY_MS = 2_000;

/** Thrown for every way the mint can fail, with the message a caller prints. */
export class MagicLinkRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'MagicLinkRefused';
  }
}

/**
 * Mints a magic-link token for [email] through the GoTrue admin API and returns
 * its `hashed_token` — the value `/verify` (and `verifyOTP(tokenHash:)`) takes.
 * Throws MagicLinkRefused on a non-2xx answer or an answer with no token: an
 * empty token would send the driver back to the password form, where a gated
 * stack refuses it with a `captcha_failed` that says nothing about a token.
 *
 * 🔴 AND ONE OF ANY OTHER SHAPE. provision_user.mjs writes the token into
 * $GITHUB_OUTPUT as `token_hash=<value>`, one output per line, so a value
 * carrying a newline would write outputs of its own — a `user_id=` the purge
 * then deletes by. Held to TOKEN_HASH_SHAPE, no text from the response but a
 * hex digest can reach that file (CodeQL js/http-to-file-access, answered in
 * code, as tooling/e2e/backend.mjs answers #467).
 */
export async function mintMagicLinkTokenHash({
  url,
  serviceKey,
  email,
  fetchImpl = fetch,
  log = (line) => console.error(line),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  for (const [name, v] of [['url', url], ['serviceKey', serviceKey], ['email', email]]) {
    if (typeof v !== 'string' || v === '') throw new MagicLinkRefused(`cannot mint a magic-link token: ${name} is empty`);
  }
  // ⏱ 2026-09-30 — 🔴 THE SERVICE-ROLE KEY GOES TO ITS ISSUER OR NOWHERE (CodeQL
  // js/file-access-to-http #532/#533). Pinned HERE, in the one minter, so every
  // caller is covered whether or not it pinned its own SUPABASE_URL first:
  // tooling/ops/credential-origin.mjs, and the refusal is this module's own.
  let origin;
  try {
    origin = credentialOrigin(url, 'supabase');
  } catch (e) {
    if (!(e instanceof CredentialOriginRefused)) throw e;
    throw new MagicLinkRefused(`cannot mint a magic-link token: ${e.message}`);
  }
  const mint = () =>
    fetchImpl(`${origin}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ type: 'magiclink', email }),
    });
  let res = await mint();
  if (ORIGIN_FAULT(res.status)) {
    // Nothing from the response, and never the key or the address: the status is the fact.
    log(`generate_link answered HTTP ${res.status}, an origin fault (the request was lost before the identity server); retrying once`);
    await res.body?.cancel().catch(() => {});
    await sleep(MINT_RETRY_DELAY_MS);
    res = await mint();
  }
  if (!res.ok) {
    throw new MagicLinkRefused(`generate_link failed: HTTP ${res.status}\n${await res.text()}`);
  }
  const link = await res.json();
  const tokenHash = link?.hashed_token;
  if (typeof tokenHash !== 'string' || tokenHash === '') {
    throw new MagicLinkRefused(`No hashed_token in generate_link response (keys: ${Object.keys(link ?? {}).sort().join(', ')})`);
  }
  if (!TOKEN_HASH_SHAPE.test(tokenHash)) {
    throw new MagicLinkRefused(
      `generate_link returned a hashed_token that is not a hex digest (${tokenHash.length} characters), so it is never written to a step output`,
    );
  }
  return tokenHash;
}
