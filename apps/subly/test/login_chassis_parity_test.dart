// ─────────────────────────────────────────────────────────────────────────────
// THE THREE BEHAVIOURS SUBLY'S LOGIN SCREEN LOST BY BEING A FORK.
//
// *(Said TWO until 2026-08-21, when the third — §3, the keyboard and the
// browser — was found and fixed. The count is corrected rather than left
// standing: a header that undercounts its own file reads as "everything below
// is the whole story", which is the sentence that stops the next reader
// looking.)*
//
// `apps/subly/lib/features/auth/login_screen.dart` (617 lines) and the chassis
// `tooling/bricks/app/__brick__/…/features/auth/sign_in_screen.dart` (154) are
// the same screen written twice. Every stamped app inherits the brick's
// version; Subly predates it and carries its own. Three of the differences were
// defects, and NONE of them throws, clips, or changes a rendered string on
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
//
// 3 · THE KEYBOARD AND THE BROWSER. The brick's two `TextField`s carry
//     `autofillHints` and an `onSubmitted` that signs in; this fork's carried
//     neither. Consequences, both on the web build, which is the one every
//     signed-out visitor lands on: the engine emitted `<input>` elements with
//     no `autocomplete` attribute, so no saved credential was ever offered by
//     the browser or by a password manager; and Enter in the password box did
//     nothing whatsoever, so the only way to submit was to leave the keyboard
//     and find the button.
//
//     ⚠️ NOTHING RENDERS DIFFERENTLY EITHER WAY, which is the whole reason this
//     survived a 628-test suite: `autofillHints` is a property handed to the
//     platform text-input plugin, and a missing `onSubmitted` is an action that
//     does not happen. The group below therefore reads the properties OFF the
//     `TextField`s AND drives the real Enter through
//     `tester.testTextInput.receiveAction` — the property check alone would
//     pass against a screen that declares `done` and wires it to nothing.
//
//     ⚠️ AND THE HINT IS PINNED AS `password`, NOT `newPassword`. This widget is
//     the sign-IN box that `_signUp` re-labels in place, so `newPassword` —
//     which asks the browser to offer a generated secret and to suppress the
//     stored one — would sabotage the dominant path on this screen. The
//     assertion names the wrong value explicitly, so a "but it is also a
//     sign-up form" edit goes red instead of quietly landing.
//
//     ⚠️ THE EMAIL BOX GOES BEYOND THE BRICK, deliberately: the brick sets no
//     `textInputAction` at all, so Enter there submits a form whose password
//     field is by definition still empty — an "enter both" snack every time.
//     `.next` + a focus hop is the behaviour the brick should grow; it is not
//     a fork divergence to be reconciled back.
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

/// A repository that RECORDS the sign-in attempt and then REFUSES it.
///
/// 🔴 THE REFUSAL IS NOT INCIDENTAL. `_submit` ends a SUCCESSFUL sign-in with
/// `context.go('/scan')`, and `pumpAt` hosts the screen on a bare `MaterialApp`
/// with no router on purpose (see `support/width_harness.dart`), so a double
/// that succeeded would end the Enter case in a GoRouter lookup failure instead
/// of in its assertion. Refusing keeps the whole flow on the screen's own error
/// path — and the proof is unaffected either way, because it is [attempts]:
/// the seam was handed these credentials, so Enter really did reach it.
class _SignInAuth extends core.AuthRepository {
  /// `email/password` per attempt, in order.
  final List<String> attempts = <String>[];

  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    attempts.add('$email/$password');
    throw core.AuthFailure('invalid_credentials');
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

  // ───────────────────────────────────────────────────────────────────────────
  // §3 — see the header. Properties AND behaviour, because either alone passes
  // against a screen that is still broken in the other half.
  group('the sign-in form answers the keyboard and the browser', () {
    TextField fieldOf(WidgetTester tester, Key key) =>
        tester.widget<TextField>(find.byKey(key));

    testWidgets('the email box is autofillable, and Enter ADVANCES', (
      WidgetTester tester,
    ) async {
      final _SignInAuth auth = _SignInAuth();
      await pumpLogin(tester, auth: auth);

      final TextField email = fieldOf(tester, E2EKeys.loginEmail);
      expect(
        email.autofillHints,
        <String>[AutofillHints.email],
        reason:
            'THE DEFECT: with no hints the web engine emits an <input> with no '
            'autocomplete attribute, so the saved credential for this site is '
            'never offered — on the screen every signed-out visitor lands on',
      );
      expect(email.textInputAction, TextInputAction.next);

      await tester.enterText(find.byKey(E2EKeys.loginEmail), 'a@b.test');
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pump();

      expect(
        auth.attempts,
        isEmpty,
        reason:
            'submitting from the email box can only ever be the "enter both" '
            'snack — the password box is by definition still empty',
      );
      expect(find.text(en.authEnterBoth), findsNothing);
      expect(
        fieldOf(tester, E2EKeys.loginPassword).focusNode?.hasFocus,
        isTrue,
        reason:
            'Enter moved the caret to the password box, which is the only '
            'thing that makes .next worth declaring',
      );
    });

    testWidgets('the password box declares `password`, NOT `newPassword`', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, auth: _SignInAuth());

      final TextField password = fieldOf(tester, E2EKeys.loginPassword);
      expect(password.autofillHints, <String>[AutofillHints.password]);
      expect(
        password.autofillHints,
        isNot(contains(AutofillHints.newPassword)),
        reason:
            'newPassword asks the browser to offer a GENERATED secret and to '
            'suppress the stored one. This widget is the sign-IN box that '
            '_signUp re-labels in place, so that setting would break the '
            'dominant path on the screen; sign_up_screen.dart is where the '
            'newPassword hint belongs',
      );
      expect(password.textInputAction, TextInputAction.done);
    });

    testWidgets('the sign-UP arm keeps the same hint', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, auth: _SignInAuth());
      await tester.tap(find.text(en.newHerePrompt));
      await tester.pump();

      // The SUBTITLE, not the title: `signUpTitle` and `signUp` are the same
      // string ("Create account"), so the heading and the submit button both
      // match it on this arm and `findsOneWidget` fails for a reason that has
      // nothing to do with the toggle.
      expect(
        find.text(en.signUpSubtitle),
        findsOneWidget,
        reason:
            'the toggle really did flip — otherwise this case tests the '
            'sign-in arm twice and cannot fail',
      );
      expect(
        fieldOf(tester, E2EKeys.loginPassword).autofillHints,
        <String>[AutofillHints.password],
        reason:
            'the hint is read when the input connection opens, so a value '
            'chosen for the arm the user MIGHT toggle to is the value the '
            'returning user\'s password manager sees first',
      );
    });

    testWidgets('Enter in the password box actually submits', (
      WidgetTester tester,
    ) async {
      final _SignInAuth auth = _SignInAuth();
      await pumpLogin(tester, auth: auth);
      await tester.enterText(find.byKey(E2EKeys.loginEmail), 'a@b.test');
      await tester.enterText(find.byKey(E2EKeys.loginPassword), 'hunter2!!');

      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(
        auth.attempts,
        <String>['a@b.test/hunter2!!'],
        reason:
            'THE DEFECT: with no onSubmitted, Enter did nothing at all and the '
            'button was the only way in. The assertion is on the SEAM because '
            'a declared textInputAction wired to nothing looks identical from '
            'the widget tree',
      );
      expect(
        find.text(en.authIncorrect),
        findsOneWidget,
        reason:
            'Enter went through _submit, which owns the guards and the error '
            'mapping — it is the same door as the button, not a second one',
      );
      expect(tester.takeException(), isNull);
    });
  });
}
