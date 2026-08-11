// ─────────────────────────────────────────────────────────────────────────────
// THE TWO BEHAVIOURS SUBLY'S LOGIN SCREEN LOST BY BEING A FORK.
//
// `apps/subly/lib/features/auth/login_screen.dart` (617 lines) and the chassis
// `tooling/bricks/app/__brick__/…/features/auth/sign_in_screen.dart` (154) are
// the same screen written twice. Every stamped app inherits the brick's
// version; Subly predates it and carries its own. Two of the differences were
// defects, and NEITHER of them throws, clips, or changes a rendered string on
// the path any existing test walks — which is why 492 green tests said nothing.
//
// 1 · THE FORGOT-PASSWORD BUTTON. It read the email field, sent whatever was
//     in it, and then told the user a reset link was on its way — with no
//     empty-field guard and no `catch`. Both failure modes end in the SAME
//     reassuring sentence: an empty field ("a link is on its way" to no
//     address) and a refusal ("a link is on its way", with the real answer in
//     an unawaited future). A button that reports success unconditionally is
//     indistinguishable from a button that works, which is the whole reason
//     this file exists.
//
//     ⚠️ THE ASSERTION IS ON THE SEAM, not only on the snackbar. `sentTo`
//     records what `sendPasswordReset` was actually handed, so the empty case
//     can prove the request was never MADE rather than merely that the message
//     changed. A snackbar-only test passes against a screen that still fires
//     `sendPasswordReset('')` and just words the result differently.
//
// 2 · "CONTINUE WITH APPLE". Rendered unconditionally. Probed live 2026-08-10:
//     `GET /auth/v1/authorize?provider=apple` answers 400 "Unsupported
//     provider: provider is not enabled" — the button ships and cannot work.
//     The brick asks `authCapabilitiesProvider` first ([pipeline C-7]); this
//     fork never did.
//
//     🔴 THE GATE IS DRIVEN THROUGH THE PROVIDER, NOT THROUGH THE PLATFORM.
//     `AuthCapabilities.forPlatform` answers `oauthRedirect: true` for all six
//     rows except fuchsia, so a test that only pinned the ambient platform
//     would be asserting a branch no shipping target takes — an assertion that
//     cannot fail on anything the portfolio builds for. Overriding the provider
//     drives BOTH arms, which is what makes the false arm capable of going red.
//
//     ⚠️ AND THE FIRST VERSION OF THAT FIX STILL DID NOT HIDE THE BUTTON.
//     `caps.oauthRedirect` is a fact about the PLATFORM; whether Supabase will
//     honour `provider=apple` is a fact about the SERVER, and gating one on the
//     other hid the button on fuchsia alone — i.e. on nothing this portfolio
//     ships. The 400 survived the fix that was written for it. `AuthProviders`
//     is the missing axis, measured 2026-08-11 against
//     `GET /auth/v1/settings` (every `external` key false but `email`), and the
//     two groups below now pin the two conditions SEPARATELY — a platform that
//     cannot redirect, and a server that will not honour the provider — so
//     neither can silently stand in for the other again.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthProviders;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/features/auth/login_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart';

/// A repository that RECORDS what the reset seam was asked to do.
///
/// 🔴 `extends`, NOT `implements` — see the note on `core.AuthRepository`'s
/// verification members: the default bodies reach a subclass only through
/// `extends`, and a double written `implements` would have to restate them.
class _ResetAuth extends core.AuthRepository {
  _ResetAuth({this.refusal});

  /// What `sendPasswordReset` throws once it has been called. Null = it works.
  final Object? refusal;

  /// Every address the seam was actually handed, in order.
  final List<String> sentTo = <String>[];

  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<void> sendPasswordReset(String email) async {
    sentTo.add(email);
    if (refusal != null) throw refusal!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Fuchsia's row, which is the only one in the real matrix that says no.
const AuthCapabilities kNoRedirect = AuthCapabilities(
  emailPassword: true,
  oauthRedirect: false,
  secureSessionStorage: false,
  note: 'the platform cannot complete an OAuth redirect',
);

/// The android/iOS row.
const AuthCapabilities kWithRedirect = AuthCapabilities(
  emailPassword: true,
  oauthRedirect: true,
  secureSessionStorage: true,
  note: '',
);

/// Both providers off — what the live project actually answers today.
const AuthProviders kNoProviders = AuthProviders(apple: false, google: false);

/// Apple switched on at the identity server. No shipping build sees this yet;
/// it exists so the "the button comes back" arm is REACHABLE, which is the only
/// thing that stops the arm above from passing by deletion.
const AuthProviders kAppleEnabled = AuthProviders(apple: true, google: false);

Future<void> pumpLogin(
  WidgetTester tester, {
  core.AuthRepository? auth,
  AuthCapabilities? caps,
  AuthProviders? providers,
}) => pumpAt(
  tester,
  kPhone,
  const LoginScreen(),
  overrides: <Override>[
    if (auth != null) authRepositoryProvider.overrideWithValue(auth),
    if (caps != null) authCapabilitiesProvider.overrideWithValue(caps),
    if (providers != null) authProvidersProvider.overrideWithValue(providers),
  ],
);

/// Tap the reset link and let the snackbar arrive.
///
/// Two pumps, not `pumpAndSettle`: the `SnackBar` animates in and
/// `pumpAndSettle` would sit through its four-second dismissal timer.
Future<void> tapForgot(WidgetTester tester, AppLocalizations l10n) async {
  await tester.tap(find.text(l10n.forgotPasswordShort));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  late AppLocalizations en;

  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the forgot-password button', () {
    testWidgets('an EMPTY field never reaches the seam', (
      WidgetTester tester,
    ) async {
      final _ResetAuth auth = _ResetAuth();
      await pumpLogin(tester, auth: auth);

      await tapForgot(tester, en);

      expect(
        auth.sentTo,
        isEmpty,
        reason:
            'THE DEFECT: with no guard this fired sendPasswordReset("") — a '
            'malformed request the user is then told succeeded',
      );
      expect(
        find.text(en.emailRequired),
        findsOneWidget,
        reason:
            'the chassis SignInScreen throws AuthFailure(emailRequired) here; '
            'this screen has no _run to throw into, so it snacks the same key',
      );
      expect(
        find.text(en.resetSent),
        findsNothing,
        reason:
            'the app must not claim a link is on its way to an address nobody '
            'typed — that sentence is false for every possible outcome',
      );
    });

    testWidgets('a REFUSED request reaches the USER, not the console', (
      WidgetTester tester,
    ) async {
      // The likeliest refusal, and the one a user meets by tapping twice:
      // GoTrue caps reset mail per address.
      final _ResetAuth auth = _ResetAuth(
        refusal: core.AuthFailure('over_email_send_rate_limit'),
      );
      await pumpLogin(tester, auth: auth);
      await tester.enterText(find.byKey(E2EKeys.loginEmail), 'a@b.test');

      await tapForgot(tester, en);

      expect(
        auth.sentTo,
        <String>['a@b.test'],
        reason: 'the request was made — this case is about its ANSWER',
      );
      expect(
        find.text(en.authRateLimited),
        findsOneWidget,
        reason:
            'THE DEFECT: with no catch the throw went into an unawaited future '
            'and the user was told the mail was on its way anyway',
      );
      expect(
        find.text(en.resetSent),
        findsNothing,
        reason: 'a refusal must not be reported as a success',
      );
      expect(
        tester.takeException(),
        isNull,
        reason: 'the failure is HANDLED, not merely rendered somewhere',
      );
    });

    testWidgets('a good address still gets the non-committal confirmation', (
      WidgetTester tester,
    ) async {
      final _ResetAuth auth = _ResetAuth();
      await pumpLogin(tester, auth: auth);
      await tester.enterText(find.byKey(E2EKeys.loginEmail), '  a@b.test  ');

      await tapForgot(tester, en);

      expect(
        auth.sentTo,
        <String>['a@b.test'],
        reason: 'the seam is handed the TRIMMED address, as it was before',
      );
      expect(
        find.text(en.resetSent),
        findsOneWidget,
        reason:
            'the guard and the catch must not have cost the working path its '
            'message — and resetSent is the wording that reveals nothing about '
            'whether that address has an account',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('Continue with Apple is capability-gated', () {
    testWidgets('a platform that cannot redirect is not offered it', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, caps: kNoRedirect, providers: kAppleEnabled);

      expect(
        find.text(en.continueWithApple),
        findsNothing,
        reason:
            'THE DEFECT: an OAuth button on a surface that cannot complete the '
            'redirect promises something the app cannot deliver',
      );
      expect(
        find.text(en.orDivider),
        findsNothing,
        reason:
            'the divider is the other half of the same sentence — "or" with '
            'nothing after it is a rule with a dangling caption',
      );
    });

    testWidgets('a platform that CAN still gets it — gated, not deleted', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, caps: kWithRedirect, providers: kAppleEnabled);

      expect(
        find.text(en.continueWithApple),
        findsOneWidget,
        reason:
            'the button must light up on its own the day the capability says '
            'yes; deleting it would have made the case above pass forever',
      );
      expect(find.text(en.orDivider), findsOneWidget);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE AXIS THE PLATFORM GATE COULD NOT SEE.
  //
  // Every case above pins a fact about the DEVICE. None of them can fail while
  // the identity server refuses the provider, because the screen never asked
  // the server anything. That is the gap the 400 lived in.
  group('Continue with Apple is also SERVER-gated', () {
    testWidgets('a capable platform is NOT offered a disabled provider', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, caps: kWithRedirect, providers: kNoProviders);

      expect(
        find.text(en.continueWithApple),
        findsNothing,
        reason:
            'THE DEFECT THE PLATFORM GATE DID NOT FIX: android/iOS can complete '
            'the redirect, so the platform arm says show it — and Supabase '
            'answers 400 "provider is not enabled". A button that cannot '
            'succeed must not be offered',
      );
      expect(
        find.text(en.orDivider),
        findsNothing,
        reason: 'the divider goes with it, or "or" captions nothing',
      );
    });

    testWidgets('THE SHIPPING DEFAULT hides it — no overrides at all', (
      WidgetTester tester,
    ) async {
      // 🔴 THE ONE CASE THAT IS ABOUT REAL USERS. Everything else in this file
      // overrides something; this pumps the screen exactly as a build does, so
      // it asserts what a person actually sees. It fails the moment
      // `AuthProviders.configured` claims a provider the server has not been
      // told about — which is the mistake that would put the 400 back.
      await pumpLogin(tester, caps: kWithRedirect);

      expect(
        find.text(en.continueWithApple),
        findsNothing,
        reason:
            'measured 2026-08-11: GET /auth/v1/settings returns every external '
            'provider false. While that is true, no shipping build may render '
            'this button on any platform',
      );
    });

    testWidgets('the declaration matches the measured live project', (
      WidgetTester tester,
    ) async {
      // Pins the constant itself, so flipping it is a deliberate act that
      // shows up in review rather than a quiet edit inside a widget tree.
      // `verify-auth-providers.mjs` is the other half: this asserts what we
      // DECLARED, that asserts the server still AGREES.
      expect(AuthProviders.configured.apple, isFalse);
      expect(AuthProviders.configured.google, isFalse);
      expect(
        AuthProviders.configured.any,
        isFalse,
        reason: 'no federated provider is enabled, so the whole limb is hidden',
      );
    });
  });
}
