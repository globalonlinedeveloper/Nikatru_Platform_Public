// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR BEHAVIOURS SUBLY'S LOGIN SCREEN LOST BY BEING A FORK.
//
// *(Said TWO until 2026-08-21, when the third — §3, the keyboard and the
// browser — was found and fixed, and THREE until 2026-09-05, when §4 — the
// re-entrancy latch the chassis `_run` has always had — was found by the same
// reading. The count is corrected rather than left standing: a header that
// undercounts its own file reads as "everything below is the whole story",
// which is the sentence that stops the next reader looking.)*
//
// `apps/subscriptiontracker/lib/features/auth/login_screen.dart` and the chassis
// `tooling/bricks/app/__brick__/…/features/auth/sign_in_screen.dart` are the
// same screen written twice. Every stamped app inherits the brick's version;
// Subly predates it and carries its own. Four of the differences were defects,
// and NONE of them throws, clips, or changes a rendered string on the path any
// existing test walks — which is why 492 green tests said nothing, and why 831
// still said nothing about §4 on 2026-09-05.
//
// *(The two line counts that used to open this paragraph — "617 lines" and
// "154" — are gone rather than re-measured. Neither was true any more, both
// were true only on the day they were typed, and a stale number in a header is
// the thing that makes a reader distrust the sentences beside it.)*
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
//
// 4 · THE RE-ENTRANCY LATCH ON FORGOT-PASSWORD (§7-4, 2026-09-05). §1 gave the
//     button a guard and a `catch`; it did not put the button inside this
//     screen's in-flight idiom. Every other await here is behind `_loading` —
//     `_submit` and `_apple` raise it, the submit and Apple buttons are gated
//     on it, and `onSubmitted` re-states it so a second Enter cannot fire a
//     second sign-in — but `_forgot` neither read it nor set it, and its
//     control was `onPressed: _forgot`, flat. Two taps, two reset requests to
//     the same address; GoTrue caps those per address, so the second tap is
//     what CREATES the rate limit §1 taught the screen to report.
//
//     ⚠️ THE ASSERTION IS A CALL COUNT, AND THE TAPS ARE IN ONE FRAME. Nothing
//     rendered and no string differs between the broken screen and the fixed
//     one — both send `a@b.test` — so only the number of calls can tell them
//     apart. And `setState` schedules a rebuild rather than performing one, so
//     a case that pumped between the taps would pass against a method that is
//     still re-entrant and only the BUTTON had been fixed. Measured against the
//     unfixed file 2026-09-05: `Actual: ['a@b.test', 'a@b.test']`.
//
//     ⚠️ THE CHASSIS HAS HAD THIS SINCE IT WAS WRITTEN (`_run`'s
//     `if (_busy) return;`), so this is the fork owing the chassis rather than
//     the other way round — but it is Subly's own `_loading` that carries it,
//     not an imported `_run`. One screen, one idiom.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, AuthProviders;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

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

  /// Parks the request until a test completes it — i.e. an IN-FLIGHT request.
  ///
  /// 🔴 WITHOUT THIS THE RE-ENTRANCY CASE CANNOT FAIL HONESTLY. An `async`
  /// method with no await in it settles on the next microtask, so "tap twice"
  /// would really be "tap, let the first request finish, tap again" — two
  /// requests that a correct screen SHOULD send. Holding the future open is
  /// what makes the second tap arrive while the first is genuinely outstanding,
  /// which is the only situation a latch is supposed to refuse.
  Completer<void>? hold;

  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {
    sentTo.add(email);
    if (hold != null) await hold!.future;
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
    String? captchaToken,
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
///
/// ⏱ 2026-09-26 — since Google went live this is also the GOOGLE-OFF arm: the
/// one fixture in which the Google gate is driven closed while the limb itself
/// still renders.
const AuthProviders kAppleEnabled = AuthProviders(apple: true, google: false);

/// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. Google FORCED ON beside Apple —
/// the only arrangement App Store Guideline 4.8 and `assert-auth-callbacks`'s
/// provider-policy limb allow. No shipping build sees this.
///
/// ⏱ 2026-09-26, later — every shipping build sees it now: this is what
/// `AuthProviders.configured` declares. Kept as a named fixture so the forced
/// cases below still say what they force, whatever the default becomes.
const AuthProviders kBothEnabled = AuthProviders(apple: true, google: true);

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

      expect(auth.sentTo, <String>[
        'a@b.test',
      ], reason: 'the request was made — this case is about its ANSWER');
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

      expect(auth.sentTo, <String>[
        'a@b.test',
      ], reason: 'the seam is handed the TRIMMED address, as it was before');
      expect(
        find.text(en.resetSent),
        findsOneWidget,
        reason:
            'the guard and the catch must not have cost the working path its '
            'message — and resetSent is the wording that reveals nothing about '
            'whether that address has an account',
      );
    });

    // ─────────────────────────────────────────────────────────────────────────
    // §7-4 · THE FOURTH MISSING HALF: NOTHING STOPPED A SECOND TAP.
    //
    // The case above proves the rate limit is REPORTED. This one proves the
    // screen stops CAUSING it. `_forgot` was the one await on this screen
    // outside the `_loading` idiom: `_submit` and `_apple` both raise it before
    // their request and every other control is gated on it, but this button was
    // `onPressed: _forgot`, flat. A user who taps twice — the ordinary response
    // to a control that shows nothing for a second — sent two reset mails to
    // the same address, and GoTrue caps those per address, so the second tap is
    // what manufactures `over_email_send_rate_limit`. The button punished the
    // user for the fact that it gave them no feedback.
    //
    // 🔴 NO PUMP BETWEEN THE TAPS, AND THAT IS THE WHOLE POINT. `setState`
    // SCHEDULES a rebuild; it does not repaint inside the current frame. Both
    // taps therefore reach the live button, so `onPressed: _loading ? null : …`
    // cannot be what saves this — only a latch inside the method can. A version
    // of this case with a pump in the middle would pass against a screen whose
    // method is still re-entrant, which is a weaker property than the one a
    // double-tapping thumb actually meets.
    testWidgets(
      'a second tap while the first request is IN FLIGHT sends nothing',
      (WidgetTester tester) async {
        final _ResetAuth auth = _ResetAuth()..hold = Completer<void>();
        await pumpLogin(tester, auth: auth);
        await tester.enterText(find.byKey(E2EKeys.loginEmail), 'a@b.test');

        final Finder forgot = find.widgetWithText(
          TextButton,
          en.forgotPasswordShort,
        );
        await tester.tap(forgot);
        await tester.tap(forgot);
        await tester.pump();

        expect(
          auth.sentTo,
          <String>['a@b.test'],
          reason:
              'THE DEFECT: two taps, two requests. The COUNT is the assertion — '
              'the address is identical either way, so nothing rendered and no '
              'string differs between the broken screen and the fixed one',
        );
        expect(
          tester.widget<TextButton>(forgot).onPressed,
          isNull,
          reason:
              'and the control says so: a latch the user cannot see is a button '
              'that still invites the tap it is about to swallow',
        );

        // The other direction, in the same case, because a latch that never
        // releases is a Forgot-password button that works exactly once per app
        // launch — and it would satisfy every assertion above.
        auth.hold!.complete();
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));

        expect(find.text(en.resetSent), findsOneWidget);
        expect(
          tester.widget<TextButton>(forgot).onPressed,
          isNotNull,
          reason: 'the request finished, so the door reopens',
        );
        expect(tester.takeException(), isNull);
      },
    );
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

    testWidgets('THE SHIPPING DEFAULT shows it — no overrides at all', (
      WidgetTester tester,
    ) async {
      // 🔴 THE ONE CASE THAT IS ABOUT REAL USERS. Everything else in this file
      // overrides something; this pumps the screen exactly as a build does, so
      // it asserts what a person actually sees.
      //
      // ⏱ 2026-09-16 — THIS CASE INVERTED, AND THE INVERSION IS THE POINT.
      // It read `findsNothing` from 2026-08-11 until today, because the live
      // project honoured no federated provider. Sign in with Apple was
      // provisioned on 2026-09-16 and `external.apple` is now `true`, so the
      // shipping default must RENDER the button — a build that still hid it
      // would be hiding a capability the owner paid to stand up, which
      // `verify-auth-providers.mjs` grades as a failure in its own right.
      //
      // The case this file existed to catch has NOT gone away: declaring a
      // provider the server does not honour is still a defect, and it is still
      // covered — by `kNoProviders` in the overridden cases below, and by
      // `verify-auth-providers.mjs`, which compares the declaration against the
      // live settings endpoint in BOTH directions on every ops-watch run.
      await pumpLogin(tester, caps: kWithRedirect);

      expect(
        find.text(en.continueWithApple),
        findsOneWidget,
        reason:
            'measured 2026-09-16: GET /auth/v1/settings returns external.apple '
            'true. While that is true, a shipping build must offer the button '
            'on every platform that can complete an OAuth redirect',
      );
    });

    testWidgets('the declaration matches the measured live project', (
      WidgetTester tester,
    ) async {
      // Pins the constant itself, so flipping it is a deliberate act that
      // shows up in review rather than a quiet edit inside a widget tree.
      // `verify-auth-providers.mjs` is the other half: this asserts what we
      // DECLARED, that asserts the server still AGREES.
      expect(
        AuthProviders.configured.apple,
        isTrue,
        reason:
            'provisioned 2026-09-16: Services ID com.nikatru.signin against the '
            'com.nikatru.platform consent group, and external_apple_enabled is '
            'true on the live project',
      );
      // ⏱ 2026-09-26 — THIS PIN INVERTED, same as Apple's on 2026-09-16. It
      // read `isFalse` ("Google is still owner-gated; no credential has been
      // created") until the owner made the Google client, and the live
      // project is switched to `external_google_enabled: true` in the same
      // window this declaration flips.
      expect(
        AuthProviders.configured.google,
        isTrue,
        reason:
            'provisioned 2026-09-23: one Google Web application client, its '
            'id and secret in the vault, and external_google_enabled switched '
            'on at the live project in the window this constant flipped',
      );
      expect(
        AuthProviders.configured.any,
        isTrue,
        reason: 'Apple is enabled, so the federated limb and its divider show',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. The Google door is BUILT and
  // OFF. Both directions, as for Apple: the shipping default must not show it,
  // and forcing it on must — or the first case passes by deletion. Its
  // clickwrap and age gate are pinned in `age_gate_sign_up_test.dart`, beside
  // Apple's.
  //
  // ⏱ 2026-09-26, LATER — THE DOOR IS ON, AND BOTH DIRECTIONS ARE STILL HELD.
  // The shipping-default case below inverted to `findsOneWidget`. What the
  // earlier pair proved by forcing Google ON is now proved by forcing it OFF
  // beside Apple (`kAppleEnabled`), so the per-provider gate is still driven
  // closed while the rest of the limb renders. Without that case, a build that
  // drew the Google button regardless of the flag would pass everything here.
  group('Continue with Google is built, and on', () {
    testWidgets('THE SHIPPING DEFAULT offers it — no overrides', (
      WidgetTester tester,
    ) async {
      // 🔴 THIS CASE INVERTED, AND THE INVERSION IS THE POINT — the #780 move
      // for Apple, made for Google. It read `findsNothing` while
      // `AuthProviders.configured` said google: false and the identity server
      // would have answered 400. The owner provisioned the Google client, the
      // live project is switched on in the window this change merges, and a
      // build that still hid the button would be hiding a door the owner
      // stood up. `verify-auth-providers.mjs` grades that as a failure in its
      // own right.
      await pumpLogin(tester, caps: kWithRedirect);

      expect(
        find.text(en.continueWithGoogle),
        findsOneWidget,
        reason:
            '`AuthProviders.configured` says google: true, switched on at the '
            'live project in the same window. While both say so, a shipping '
            'build must offer the button on every platform that can complete '
            'an OAuth redirect',
      );
      expect(
        find.text(en.continueWithApple),
        findsOneWidget,
        reason:
            'Google never ships without Apple beside it (App Store Review '
            'Guideline 4.8; assert-auth-callbacks limb PROVIDER-POLICY)',
      );
      expect(
        find.text(en.orDivider),
        findsOneWidget,
        reason: 'one divider above both doors',
      );
    });

    testWidgets('forced OFF beside Apple, it is not offered', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, caps: kWithRedirect, providers: kAppleEnabled);

      expect(
        find.text(en.continueWithGoogle),
        findsNothing,
        reason:
            'the Google gate must still close on its own flag. This is the '
            'arm the shipping default no longer exercises: Apple on, Google '
            'off, the limb and its divider rendered',
      );
      expect(find.text(en.continueWithApple), findsOneWidget);
      expect(find.text(en.orDivider), findsOneWidget);
    });

    testWidgets('forced on, a capable platform offers it beside Apple', (
      WidgetTester tester,
    ) async {
      await pumpLogin(tester, caps: kWithRedirect, providers: kBothEnabled);

      expect(find.text(en.continueWithGoogle), findsOneWidget);
      expect(find.text(en.continueWithApple), findsOneWidget);
      expect(
        find.text(en.orDivider),
        findsOneWidget,
        reason: 'one divider above both doors',
      );
    });

    testWidgets(
      'forced on, a platform that cannot redirect is not offered it',
      (WidgetTester tester) async {
        await pumpLogin(tester, caps: kNoRedirect, providers: kBothEnabled);

        expect(find.text(en.continueWithGoogle), findsNothing);
        expect(find.text(en.orDivider), findsNothing);
      },
    );
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
      // ⏱ 2026-09-16 — ensureVisible IS LOAD-BEARING SINCE APPLE WAS ENABLED.
      // The OAuth limb (divider + "Continue with Apple") now renders by default,
      // which pushes this toggle below the test viewport; the tap then landed on
      // nothing, the arm never flipped, and the failure surfaced as the sign-up
      // SUBTITLE being absent rather than as a missed tap. Scrolling it into view
      // is the honest fix — the screen is scrollable and a real user reaches the
      // toggle the same way.
      await tester.ensureVisible(find.text(en.newHerePrompt));
      await tester.pumpAndSettle();
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
