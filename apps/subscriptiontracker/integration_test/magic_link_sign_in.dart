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
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
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
/// 🔴 AND IT NAVIGATES TO `/scan` ITSELF — THE NAVIGATION IS PART OF SIGNING IN
/// ON THIS PATH, NOT SOMETHING THE CALLER REMEMBERS TO ADD. `/scan` has exactly
/// one entry point in the app: `LoginScreen._submit`'s `context.go('/scan')`.
/// Every other occurrence in the tree is a comment ABOUT it. So a sign-in that
/// skips the form skips the navigation too, and the caller lands on the home
/// shell instead.
///
/// ⚠️ WHY IT LIVES HERE RATHER THAN AT THE CALL SITE, AND THE COST OF LEARNING
/// THAT THE OTHER WAY. It was written at the call site first, in the full-walk
/// test only. The full walk went green — 17 screenshots, /scan reached — and
/// run 33844142953 still failed, because the DELETE-ACCOUNT test signs in the
/// same way with its own token and never got the two lines. Its screen text was
/// `Home | Calendar | Insights | Budget | More | Good morning` — the home shell,
/// exactly the symptom the full walk had just stopped showing. Two call sites,
/// one of them patched, and the diff looked complete. A helper that leaves out
/// the step its own doc comment says is mandatory is a trap for the next caller
/// as well as this one.
///
/// ⚠️ A `Scaffold` IS THE CONTEXT, NOT `AppShell`. By this point the router has
/// already put an authenticated user with no clickwrap record on the
/// `/reaccept-terms` interstitial, where no `AppShell` exists.
///
/// 🔴 BEFORE THE CLICKWRAP, NOT AFTER — the gate does not BLOCK the destination,
/// it BANKS it. `_gateWithNext` stores `/scan` as `?next=` and the gate's exit
/// hands it back via `_nextOr(state, '/home')`. Navigate after the interstitial
/// is cleared and there is no gate left to bank anything, which is what run
/// 33843443550 measured. Pinned locally, on the real router, by
/// `test/scan_survives_the_gate_test.dart` — both halves: that asking for
/// `/scan` while the gate is CLOSED banks `?next=%2Fscan`, and that clearing it
/// the way a user clears it lands on `/scan`.
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
  // Stand in for `LoginScreen._submit`'s `context.go('/scan')`. See above.
  GoRouter.of(tester.firstElement(find.byType(Scaffold))).go('/scan');
  await pumpFor(tester, const Duration(seconds: 2));
  return true;
}
