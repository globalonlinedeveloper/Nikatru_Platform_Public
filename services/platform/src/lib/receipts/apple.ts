// ─────────────────────────────────────────────────────────────────────────────
// APPLE — App Store Server API, and this rail is STRUCTURED BUT NOT COMPLETE.
// IT REFUSES. IT NEVER GRANTS ON LESS EVIDENCE.
//
// 🔴 THE HONEST STATE, DECLARED AS DATA (`implemented: false`) RATHER THAN LEFT
// FOR A READER TO INFER FROM HOW MUCH CODE IS HERE.
//
// What Apple actually requires, and what is missing:
//
//   1. AN ES256 JWT signed with the App Store Connect .p8 private key, carrying
//      iss/iid/bid/aud, to authenticate `GET /inApps/v1/subscriptions/{id}`.
//      The key is not provisioned for this purpose
//      (research/2026-09-09 / apple-status-2026-09-08.md: an Admin-scope key
//      exists and is owner-accepted, and narrowing it is a follow-up).
//   2. 🔴 THE PART THAT MATTERS MORE. Apple's answer is not JSON facts — it is
//      `signedTransactionInfo` / `signedRenewalInfo`, JWS blobs whose payload is
//      only trustworthy after the x5c CERTIFICATE CHAIN has been verified up to
//      the Apple Root CA G3. Decoding a JWS payload WITHOUT verifying that chain
//      is reading an attacker-supplied JSON document and calling it Apple's word.
//      That chain verification is not implemented here.
//
// So this file builds the request and refuses to interpret the answer. The
// alternative — base64-decode the payload and grant — would look like a working
// Apple rail in every test that stubbed the transport, and would be the exact
// "purchase unlocked on somebody's word" defect the receipts route exists to
// close, wearing a verifier's clothes.
//
// ⚠️ IT IS STILL REGISTERED, and that is deliberate. An absent rail answers 404
// `unknown_store` — indistinguishable from a typo — while a registered,
// unimplemented one answers 503 and SAYS WHY. It also keeps the rail inside every
// count-based guard's floor, so the gap cannot become permanent by being quiet.
// The seed row for `apple_iap` in migration 0009 already exists for the same
// reason: a source that is not in the set on the day the first customer pays is
// unclassifiable forever.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type ReceiptOutcome,
  type ReceiptVerifier,
  type ReceiptVerifyDeps,
  type ReceiptVerifyInput,
  refuse,
} from './contract';

/** Production. The sandbox host differs and is selected by MONEY_ENVIRONMENT when this rail lands. */
export const APPLE_API_HOST = 'https://api.storekit.itunes.apple.com';

export function appleSubscriptionUrl(transactionId: string): string {
  return `${APPLE_API_HOST}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`;
}

export const appleIapVerifier: ReceiptVerifier = {
  store: 'apple_iap',
  source: 'apple_iap',
  credentialEnvVars: ['APPLE_ASC_ISSUER_ID', 'APPLE_ASC_KEY_ID', 'APPLE_ASC_PRIVATE_KEY'],
  implemented: false,

  async verify(_input: ReceiptVerifyInput, deps: ReceiptVerifyDeps): Promise<ReceiptOutcome> {
    const missing = appleIapVerifier.credentialEnvVars.filter(
      (name) => (deps.credentials[name] ?? '') === '',
    );
    if (missing.length > 0) {
      return refuse(
        503,
        'receipt_rail_not_configured',
        `Apple receipt verification needs ${missing.join(', ')}, which this deploy does not set. ` +
          'The StoreKit transaction the client posted is not a fallback: it is an opaque string, and ' +
          'granting on it would be the irreversible client unlock this route exists to remove.',
      );
    }
    // 🔴 REACHED ONLY WITH CREDENTIALS PRESENT, AND STILL REFUSES. See the header:
    // Apple's answer is a JWS whose payload means nothing until its x5c chain has
    // been verified to the Apple Root CA G3, and that verification is not
    // implemented. Reading the payload anyway would be trusting a document the
    // caller could have supplied.
    return refuse(
      503,
      'receipt_rail_not_verifiable',
      'The Apple rail is registered but its answer cannot yet be verified: App Store Server API responses ' +
        'are JWS blobs, and their payloads are only evidence once the x5c certificate chain has been ' +
        'checked to the Apple Root CA G3. That chain verification is not implemented, so this rail ' +
        'refuses rather than decoding an unverified payload and calling it Apple’s word.',
    );
  },
};
