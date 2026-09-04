// ─────────────────────────────────────────────────────────────────────────────
// captcha_token_reaches_the_request_test.dart — THE TOKEN THE WIDGET PRODUCES
// MUST ARRIVE AT THE AUTH CALL.
//
// 🔴 THE CAPTURE POINT WAS BUILT FOR THIS TEST AND THE TEST WAS NEVER WRITTEN.
// `test/support/mock_auth_repository.dart` records `lastCaptchaToken`, and says
// in its own words why: *"The captcha token is the one argument a screen can
// silently stop sending while every existing test stays green — the request
// simply goes out without it and this fake accepts it anyway."* Measured
// 2026-09-04: `rg lastCaptchaToken apps/subly/test/` outside the mock returned
// NOTHING. The hook existed; nobody ever looked at it.
//
// ── WHY THIS IS THE FRONT-DOOR TEST WORTH HAVING ────────────────────────────
// Signing in past Turnstile is FOUR separate claims, and only one of them needs
// a human:
//   1 the widget renders when a sitekey is compiled in   — needs a test sitekey
//   2 THE TOKEN REACHES THE REQUEST                      — this file
//   3 the server refuses a request with no token         — a CI script
//   4 the server accepts a genuinely solved challenge    — a person, once
// Claim 2 is the one that catches the realistic bug: somebody tidies the login
// code, `captchaToken:` stops being passed, and every other test stays green
// because the fake accepts a null.
//
// ⚠️ AND IT IS THE **DYNAMIC** TWIN OF A STATIC GUARD.
// `tooling/ci/assert-captcha-gated-call-sites.mjs` (#446) proves a
// `captchaToken:` ARGUMENT is present at every gated call site. It cannot prove
// the VALUE arrives — `captchaToken: someFieldThatIsAlwaysNull` satisfies it
// perfectly. This file closes exactly that gap, and the two together are what
// make the wiring checkable rather than assumed.
//
// 🔬 HOW IT DRIVES THE WIDGET WITHOUT A NETWORK, WHICH IS THE TRICK:
// `TurnstileGate` renders `SizedBox.shrink()` when no `TURNSTILE_SITE_KEY` is
// compiled in — which is every test build — but the WIDGET OBJECT IS STILL IN
// THE TREE. So the test reaches it with `find.byType`, invokes its `onToken`
// callback directly, and the screen behaves exactly as it would when Cloudflare
// calls back. No dart-define, no new CI lane, no network, milliseconds.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/features/auth/turnstile_gate.dart';
import 'package:subly/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart';

/// Hands the screen the token Cloudflare would have handed it.
///
/// The gate is inert in a test build, so it never calls back on its own — but it
/// is mounted, and `onToken` is the exact seam the real widget uses.
void deliverToken(WidgetTester tester, String? token) {
  final Finder gate = find.byType(TurnstileGate);
  expect(
    gate,
    findsOneWidget,
    reason:
        'LoginScreen must MOUNT TurnstileGate even when no site key is compiled '
        'in. If this fails the widget was removed from the tree, and no token '
        'can ever be produced on this screen after the cutover — which is the '
        'defect this file exists to catch, arriving one layer earlier.',
  );
  tester.widget<TurnstileGate>(gate).onToken(token);
}

/// Fills the form and submits.
///
/// ⚠️ EXPECT A LOGGED `No GoRouter found in context` PER CASE, AND IT IS NOT A
/// FAILURE. `pumpAt` hosts the screen on a bare `MaterialApp` with NO router, on
/// purpose — its own doc says *"a router would drag the redirect guards in with
/// it"*, and none of these properties is about navigation. So sign-in SUCCEEDS,
/// `_submit` then runs `context.go('/scan')`, that throws, and `_snack` turns it
/// into an unmapped-error debugPrint. Everything this file asserts is recorded
/// INSIDE `signInWithEmail`, strictly before that line — and
/// [expectSignInWasReached] below turns "strictly before" from a claim into a
/// checked fact, so a future reader need not take it on trust.
Future<void> submitLogin(
  WidgetTester tester, {
  required String email,
  required String password,
}) async {
  await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
  await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
  await tester.pump();
  await tester.tap(find.byKey(E2EKeys.loginSubmit));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

/// The auth call really happened.
///
/// Without this, `lastCaptchaToken == null` would be indistinguishable from
/// "the request was never made at all" — and every negative case below would
/// pass against a screen whose submit button had stopped working.
void expectSignInWasReached(MockAuthRepository auth) {
  expect(
    auth.currentUser,
    isNotNull,
    reason:
        'the sign-in call was never reached, so nothing below is evidence '
        'about what it carried',
  );
}

Future<MockAuthRepository> pumpLogin(WidgetTester tester) async {
  final MockAuthRepository auth = MockAuthRepository();
  await pumpAt(
    tester,
    kPhone,
    const LoginScreen(),
    overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
  );
  return auth;
}

void main() {
  testWidgets('🔴 the token the gate produced is the token sign-in sends', (
    WidgetTester tester,
  ) async {
    final MockAuthRepository auth = await pumpLogin(tester);

    deliverToken(tester, 'tok-from-cloudflare');
    await tester.pump();
    await submitLogin(tester, email: 'alex@example.com', password: 'hunter22');
    expectSignInWasReached(auth);

    expect(
      auth.lastCaptchaToken,
      'tok-from-cloudflare',
      reason:
          'The gate called back with a token and the sign-in request did not '
          'carry it. After the Box A cutover that request is refused with '
          '`captcha_failed` before the password is even read, so NOBODY CAN '
          'SIGN IN — and every other test in this suite stays green, because '
          'the fake repository accepts a null token happily.',
    );
  });

  // The NEGATIVE control. Without it the case above passes just as well against
  // a screen that hardcodes the string, or a fake that echoes whatever it likes.
  testWidgets('and with no token delivered it sends null, not a stale value', (
    WidgetTester tester,
  ) async {
    final MockAuthRepository auth = await pumpLogin(tester);

    await submitLogin(tester, email: 'alex@example.com', password: 'hunter22');
    expectSignInWasReached(auth);

    expect(
      auth.lastCaptchaToken,
      isNull,
      reason:
          'With no site key compiled in the gate never calls back, so the token '
          'must be null — that is what every build shipping today sends. A '
          'non-null here would mean the screen invented one.',
    );
  });

  // 🔴 THE EXPIRY PATH, AND IT IS NOT HYPOTHETICAL. TurnstileGate clears the
  // token on ALL THREE of its failure callbacks — `onTokenExpired`, `onTimeout`
  // and `onError` — because a STALE token is worse than none: the server refuses
  // it, and the user is told something that sounds like their password was
  // wrong. Tokens are single-use with a ~5 minute life, so this fires in normal
  // use, not just in faults.
  testWidgets('a cleared token is sent as null, never as the old value', (
    WidgetTester tester,
  ) async {
    final MockAuthRepository auth = await pumpLogin(tester);

    deliverToken(tester, 'tok-that-then-expires');
    await tester.pump();
    deliverToken(tester, null);
    await tester.pump();
    await submitLogin(tester, email: 'alex@example.com', password: 'hunter22');
    expectSignInWasReached(auth);

    expect(
      auth.lastCaptchaToken,
      isNull,
      reason:
          'The gate cleared the token and the screen sent the expired one '
          'anyway. The server refuses a spent token, so the user would be shown '
          'a failure for a password that was correct.',
    );
  });

  testWidgets('a REPLACED token sends the newest, not the first', (
    WidgetTester tester,
  ) async {
    // Cloudflare refreshes an expiring token in place (`refreshExpired: auto`),
    // so the screen must hold the LATEST value rather than the first it saw.
    final MockAuthRepository auth = await pumpLogin(tester);

    deliverToken(tester, 'tok-first');
    await tester.pump();
    deliverToken(tester, 'tok-refreshed');
    await tester.pump();
    await submitLogin(tester, email: 'alex@example.com', password: 'hunter22');
    expectSignInWasReached(auth);

    expect(auth.lastCaptchaToken, 'tok-refreshed');
  });
}
