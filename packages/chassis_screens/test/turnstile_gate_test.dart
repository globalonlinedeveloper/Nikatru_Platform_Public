// ─────────────────────────────────────────────────────────────────────────────
// ST-A1 (audit BUG-1, D29) — the chassis TurnstileGate and its single-use token.
//
// A redeemed Turnstile token is dead, and the identity server redeems it on the
// first gated call even when the password is wrong. The flagship stored the
// token once and re-sent it, so every retry after one failed sign-in read
// "Verification expired" until a reload. These cases pin the three halves of
// the fix: a spend forgets the token, a spend re-mounts the challenge, and a
// gated call WAITS for an unanswered challenge — never a dead button.
//
// ⏱ 2026-09-28 — the third half was "a view refuses the gated action while a
// rendered challenge has not answered" (`captchaReady`). That was the #1022
// regression: no token (slow, blocked, headless) meant a dead button that could
// not even say "Enter your email" (E2E live run 36379673890). The view is now
// live unless a request is in flight, validates first, and the adapter's
// callback awaits `untilReady()`.
//
// MUTATION PROOF (run for the PR): make `consume()` return `_token` without
// clearing it and bumping the generation, and the first two groups go red;
// make `untilReady` resolve without a token and the wait group does; disable
// SignInView's submit while a token is missing and the view group does.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisL10nX;
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

  group('CaptchaTokenController.untilReady — a valid submit waits, once', () {
    test('ready already: completes at once, nothing shown', () async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.notOnThisChannel,
      );
      addTearDown(c.dispose);
      await c.untilReady();
      expect(c.waiting, isFalse);
    });

    test('no token yet: waits, and completes when the token lands', () async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      addTearDown(c.dispose);
      bool done = false;
      final Future<void> wait = c.untilReady().then((_) => done = true);
      expect(c.waiting, isTrue);
      await Future<void>.delayed(Duration.zero);
      expect(done, isFalse, reason: 'no token, no go');
      c.setToken('tok-1');
      await wait;
      expect(c.waiting, isFalse);
      expect(c.consume(), 'tok-1');
    });

    test(
      'a challenge error throws CaptchaUnavailable and re-challenges',
      () async {
        final CaptchaTokenController c = CaptchaTokenController(
          posture: CaptchaPosture.challenge,
          siteKey: 'k',
        );
        addTearDown(c.dispose);
        final int before = c.generation;
        final Future<void> wait = c.untilReady();
        c.reportError('600010');
        await expectLater(wait, throwsA(isA<CaptchaUnavailable>()));
        expect(c.waiting, isFalse);
        expect(c.token, isNull, reason: 'nothing to send after a failure');
        expect(c.generation, greaterThan(before));
      },
    );

    test('a challenge that never answers times out', () async {
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      addTearDown(c.dispose);
      await expectLater(
        c.untilReady(timeout: const Duration(milliseconds: 10)),
        throwsA(
          isA<CaptchaUnavailable>().having(
            (CaptchaUnavailable e) => e.reason,
            'reason',
            'timeout',
          ),
        ),
      );
      expect(c.waiting, isFalse);
    });
  });

  group('SignInView — live without a token; validates first', () {
    Widget view({
      bool waiting = false,
      Widget? captcha,
      Future<void> Function(String, String)? onSignIn,
    }) => SignInView(
      onSignIn: onSignIn ?? (String _, String _) async {},
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
      captchaWaiting: waiting,
    );

    testWidgets('(a) no token yet: an EMPTY submit says what is missing', (
      WidgetTester tester,
    ) async {
      int calls = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(
          captcha: const SizedBox(key: Key('gate')),
          onSignIn: (String _, String _) async => calls++,
        ),
      );
      expect(find.byKey(const Key('gate')), findsOneWidget);
      expect(
        tester
            .widget<TextButton>(find.byKey(SignInView.forgotButton))
            .onPressed,
        isNotNull,
      );
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pump();
      final BuildContext ctx = tester.element(find.byType(SignInView));
      expect(find.text(ctx.chassisL10n.authEnterBoth), findsOneWidget);
      expect(calls, 0, reason: 'validation first — no request, no captcha');
    });

    testWidgets('(b) while a valid submit waits, the status is announced', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await pumpChassis(tester, kPhone, view(waiting: true), settle: false);
      final Finder status = find.byKey(CaptchaWaitStatus.statusLine);
      expect(status, findsOneWidget);
      expect(
        tester.getSemantics(status),
        isSemantics(isLiveRegion: true),
      );
      semantics.dispose();
    });

    testWidgets('(c) a CaptchaUnavailable from the callback reads as the '
        'retry sentence', (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(
          onSignIn: (String _, String _) =>
              Future<void>.error(const CaptchaUnavailable('timeout')),
        ),
      );
      await tester.enterText(
        find.byKey(SignInView.emailField),
        'alex@example.com',
      );
      await tester.enterText(find.byKey(SignInView.passwordField), 'hunter22');
      await tester.tap(find.byKey(SignInView.submitButton));
      await tester.pump();
      final BuildContext ctx = tester.element(find.byType(SignInView));
      expect(find.text(ctx.chassisL10n.authCaptchaUnavailable), findsOneWidget);
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
