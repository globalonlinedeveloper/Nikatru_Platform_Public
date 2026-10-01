// ─────────────────────────────────────────────────────────────────────────────
// magic_link_sign_in.dart — HOW A LIVE DRIVE SIGNS IN: by spending the one-time
// magic-link token the harness minted, never through the captcha-gated login
// form. Shared by BOTH suites under integration_test/ (added 2026-09-28):
//   · app_test.dart (the e2e nightly) — E2E_TOKEN_HASH and E2E_DELETE_TOKEN_HASH,
//     minted by tooling/e2e/provision_user.mjs;
//   · store_screenshots_test.dart (the store capture) — E2E_TOKEN_HASH, minted
//     per drive (tooling/store/capture-play-screenshots.mjs), because the token
//     is single use and the capture runs one drive per viewport.
//
// Until this file the capture typed the password, and the production auth box
// refused it `captcha_failed` (run 36315636919) while the nightly — which had
// its own copy of this helper — signed in. ONE helper, because two hand-written
// copies of "sign in without the form" is how one of them goes back to the form.
// tooling/ci/test/store-screenshots-lane.test.mjs holds both suites to it.
//
// [pumpFor] is the CALLER'S, not a loop of this file's own: app_test.dart routes
// every wall-clock loop through its `guardedPump`, and a helper with a private
// loop would be the one pump in that suite that escapes it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// Signs in WITHOUT the login form, by spending the single-use magic-link token
/// the harness minted, and returns whether it did.
///
/// 🔴 WHY THE FORM STOPS WORKING, MEASURED. Box A enforces Cloudflare Turnstile,
/// and `token?grant_type=password` is one of the six gated routes — so the
/// moment `SUPABASE_URL` moves there, typing credentials is refused with
/// `captcha_failed` BEFORE the password is checked. A headless driver cannot
/// solve a Turnstile challenge; that is the entire point of one.
///
/// `/verify` is NOT gated (auth-cutover.md §4.7) and this is the path an emailed
/// link takes, so the browser still genuinely authenticates and still receives a
/// real session — it just does not type. Verified against Box A 2026-09-04:
/// HTTP 200, correct user, refresh token present, and a REPLAY returns 403.
///
/// ⚠️ SINGLE USE. One call per token: each e2e leg signs in once with its own
/// user's, and each store-capture drive spends its own, which the capture runner
/// mints after the previous drive has spent the one before it.
/// ⚠️ It goes through `Supabase.instance.client`, the same client the app holds,
/// so `onAuthStateChange` fires and the router reacts exactly as it would after
/// a form login. Nothing here reaches into app state directly.
/// ⚠️ WHAT THIS GIVES UP: the login FORM is no longer exercised on this path.
/// The keystrokes are still covered by app_test.dart's empty-field and
/// wrong-password legs; what is not covered post-cutover is a SUCCESSFUL form
/// submit, which no headless driver can do against a live captcha.
///
/// ⏱ 2026-10-01 · IM-07 (ADR 077 §2.2): IT NO LONGER NAVIGATES ANYWHERE.
/// It used to force `go('/scan')` here, standing in for the form's old
/// `context.go('/scan')` — a timed loader that imported nothing and that
/// nothing in the app navigated to any more (sign-in lands on the banked
/// `?next=` or `/home`, `afterSignInDestination`). The session appearing is
/// now the whole of signing in, exactly as it is for a person: the router's
/// refresh moves the user off `/sign-in` through the gate chain, and every
/// caller asserts the HOME it lands on (`expectLandedOnHome` in app_test.dart).
/// The forcing was inside this helper rather than at each call site because a
/// call site once missed it (run 33844142953); removing it here removes it for
/// every caller at once, which is the same argument in the other direction.
Future<bool> signInWithMagicToken(
  WidgetTester tester,
  String tokenHash, {
  required Future<void> Function(WidgetTester tester, Duration total) pumpFor,
}) async {
  if (tokenHash.isEmpty) return false;
  await sb.Supabase.instance.client.auth.verifyOTP(
    type: sb.OtpType.magiclink,
    tokenHash: tokenHash,
  );
  // The same settle the form path takes: GoTrue round trip + route change.
  await pumpFor(tester, const Duration(seconds: 10));
  return true;
}
