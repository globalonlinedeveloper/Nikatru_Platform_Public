// ─────────────────────────────────────────────────────────────────────────────
// ST-A1 (audit BUG-1, D29) — the chassis TurnstileGate and its single-use token.
//
// A redeemed Turnstile token is dead, and the identity server redeems it on the
// first gated call even when the password is wrong. The flagship stored the
// token once and re-sent it, so every retry after one failed sign-in read
// "Verification expired" until a reload. These cases pin the three halves of
// the fix: a spend forgets the token, a spend re-mounts the challenge, and a
// view refuses the gated action while a rendered challenge has not answered.
//
// MUTATION PROOF (run for the PR): make `consume()` return `_token` without
// clearing it and bumping the generation, and the first two groups go red;
// drop `|| !widget.captchaReady` from SignInView's submit and the third does.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';

import 'support/width_harness.dart';

/// Stands in for the vendor widget: counts how many challenges were mounted.
class _FakeChallenge extends StatefulWidget {
  const _FakeChallenge(this.challenge, this.mounts);
  final TurnstileChallenge challenge;
  final List<TurnstileChallenge> mounts;
  @override
  State<_FakeChallenge> createState() => _FakeChallengeState();
}

class _FakeChallengeState extends State<_FakeChallenge> {
  @override
  void initState() {
    super.initState();
    widget.mounts.add(widget.challenge);
  }

  @override
  Widget build(BuildContext context) => const SizedBox(height: 10);
}

void main() {
  group('CaptchaTokenController — a token is spent, never re-read', () {
    test('consume hands the token over ONCE, then there is none', () {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      c.setToken('tok-1');
      expect(c.ready, isTrue);
      expect(c.consume(), 'tok-1');
      expect(c.token, isNull);
      expect(c.ready, isFalse, reason: 'a spent token is not a usable one');
      expect(c.consume(), isNull, reason: 'the spent token must not come back');
    });

    test('where no challenge renders, a gated call is never blocked', () {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.notOnThisChannel,
      );
      expect(c.ready, isTrue);
      expect(c.consume(), isNull);
      expect(c.ready, isTrue);
    });
  });

  group('TurnstileGate — a spend re-mounts the challenge', () {
    testWidgets('one challenge per token', (WidgetTester tester) async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      addTearDown(c.dispose);
      final List<TurnstileChallenge> mounts = <TurnstileChallenge>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TurnstileGate(
              controller: c,
              render: (BuildContext _, TurnstileChallenge ch) =>
                  _FakeChallenge(ch, mounts),
            ),
          ),
        ),
      );
      expect(mounts, hasLength(1));
      expect(mounts.single.siteKey, 'k');

      mounts.single.onToken('tok-1');
      await tester.pump();
      expect(mounts, hasLength(1), reason: 'an answer is not a re-challenge');

      c.consume();
      await tester.pump();
      expect(
        mounts,
        hasLength(2),
        reason: 'a spent token needs a new challenge',
      );
    });

    testWidgets('renders nothing where the posture is not a challenge', (
      WidgetTester tester,
    ) async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.notOnThisChannel,
      );
      addTearDown(c.dispose);
      final List<TurnstileChallenge> mounts = <TurnstileChallenge>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TurnstileGate(
              controller: c,
              render: (BuildContext _, TurnstileChallenge ch) =>
                  _FakeChallenge(ch, mounts),
            ),
          ),
        ),
      );
      expect(mounts, isEmpty);
      expect(tester.getSize(find.byType(TurnstileGate)), Size.zero);
    });
  });

  group('SignInView — submit waits for the challenge', () {
    Widget view({required bool ready, Widget? captcha}) => SignInView(
      onSignIn: (String _, String _) async {},
      onForgotPassword: (String _) async {},
      onNeedAccount: () {},
      showAppleButton: false,
      onSignInWithApple: () async {},
      appleTermsOwed: false,
      consentFields:
          ({
            required bool termsAccepted,
            required bool marketingAccepted,
            required bool enabled,
            required ValueChanged<bool> onTermsChanged,
            required ValueChanged<bool> onMarketingChanged,
          }) => const SizedBox.shrink(),
      onAcceptTerms: ({required bool marketingEmail}) async {},
      captcha: captcha,
      captchaReady: ready,
    );

    testWidgets('no token yet: Sign in and Forgot password are disabled', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(ready: false, captcha: const SizedBox(key: Key('gate'))),
      );
      expect(find.byKey(const Key('gate')), findsOneWidget);
      final FilledButton submit = tester.widget<FilledButton>(
        find.byKey(SignInView.submitButton),
      );
      expect(submit.onPressed, isNull);
      final TextButton forgot = tester.widget<TextButton>(
        find.byKey(SignInView.forgotButton),
      );
      expect(forgot.onPressed, isNull);
    });

    testWidgets('with a token: both are live', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, view(ready: true));
      expect(
        tester
            .widget<FilledButton>(find.byKey(SignInView.submitButton))
            .onPressed,
        isNotNull,
      );
      expect(
        tester
            .widget<TextButton>(find.byKey(SignInView.forgotButton))
            .onPressed,
        isNotNull,
      );
    });
  });

  // assert-responsive-coverage: the gate is a chassis surface, measured at each
  // window class inside the form pane it is mounted in.
  group('TurnstileGate fits the form pane at every window class', () {
    Future<void> pumpAt(WidgetTester tester, Size size) async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      addTearDown(c.dispose);
      await pumpChassis(
        tester,
        size,
        TurnstileGate(
          controller: c,
          render: (BuildContext _, TurnstileChallenge _) =>
              const SizedBox(key: Key('challenge'), height: 65),
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.byKey(const Key('challenge')), findsOneWidget);
    }

    testWidgets('kPhone', (WidgetTester t) => pumpAt(t, kPhone));
    testWidgets('kTablet', (WidgetTester t) => pumpAt(t, kTablet));
    testWidgets('kDesktop', (WidgetTester t) => pumpAt(t, kDesktop));
  });
}
