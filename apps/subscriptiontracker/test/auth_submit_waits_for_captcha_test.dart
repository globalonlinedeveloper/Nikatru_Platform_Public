// ─────────────────────────────────────────────────────────────────────────────
// auth_submit_waits_for_captcha_test.dart — AN UNANSWERED CAPTCHA NEVER KILLS A
// BUTTON; IT MAKES A VALID SUBMIT WAIT, VISIBLY.
//
// ⏱ 2026-09-28 · E2E live run 36379673890 failed "login rejects empty + invalid
// credentials": ST-T1 (#1022) gated Sign in on `captcha.ready`, the Turnstile
// widget in a headless browser never answers, so the tap did nothing and
// "Enter your email" never appeared. A real user on a slow or blocked captcha
// got the same dead button with no reason (WCAG 3.3.1 / 4.1.3).
//
// A widget test is never web, so the posture is forced to `challenge` through
// `debugCaptchaPostureOverride` — without it every case here sees
// `notOnThisChannel` and the regression passes the whole suite, which is how it
// shipped. The controller is then driven directly, as Cloudflare would.
//
// RED CONTROL (run for the PR): restore `!captcha.ready` in any of the three
// `login_screen.dart` gates, or in `check_inbox_actions.dart`, and the matching
// case below goes red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisL10nX, ChassisLocalizations;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/auth/auth_models.dart';
import 'package:subscriptiontracker/features/auth/check_inbox_actions.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/auth/turnstile_gate.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart';

/// Counts the gated calls, so "exactly one request" and "no request" are
/// measured rather than inferred from the last token.
class _CountingAuth extends MockAuthRepository {
  int signIns = 0;
  int resets = 0;
  int resends = 0;

  @override
  Future<AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) {
    signIns++;
    return super.signInWithEmail(
      email: email,
      password: password,
      captchaToken: captchaToken,
    );
  }

  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) {
    resets++;
    return super.sendPasswordReset(email, captchaToken: captchaToken);
  }

  @override
  Future<void> resendSignUpConfirmation(String email, {String? captchaToken}) {
    resends++;
    lastCaptchaToken = captchaToken;
    return Future<void>.value();
  }
}

CaptchaTokenController _captcha(WidgetTester tester) =>
    tester.widget<TurnstileGate>(find.byType(TurnstileGate)).controller;

Future<_CountingAuth> _pumpLogin(WidgetTester tester) async {
  final _CountingAuth auth = _CountingAuth();
  await pumpAt(
    tester,
    kPhone,
    const LoginScreen(),
    overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
  );
  expect(
    _captcha(tester).ready,
    isFalse,
    reason: 'the premise: a rendered challenge that has not answered yet',
  );
  return auth;
}

Future<void> _fill(WidgetTester tester, String email, String password) async {
  await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
  await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
  await tester.pump();
}

Future<void> _tapSubmit(WidgetTester tester) async {
  await tester.tap(find.byKey(E2EKeys.loginSubmit));
  await tester.pump();
}

ChassisLocalizations _chassis(WidgetTester tester) =>
    tester.element(find.byType(LoginScreen)).chassisL10n;

void main() {
  setUp(() => debugCaptchaPostureOverride = CaptchaPosture.challenge);
  tearDown(() => debugCaptchaPostureOverride = null);

  testWidgets(
    '(a) an EMPTY submit with no token yet says what is missing, and sends '
    'nothing',
    (WidgetTester tester) async {
      final _CountingAuth auth = await _pumpLogin(tester);
      final AppLocalizations l10n = AppLocalizations.of(
        tester.element(find.byType(LoginScreen)),
      );

      await _tapSubmit(tester);

      expect(
        find.textContaining(l10n.authEnterBoth),
        findsOneWidget,
        reason:
            'the button was dead while the captcha had not answered — the '
            '#1022 regression E2E run 36379673890 caught',
      );
      expect(auth.signIns, 0);
      expect(find.byKey(TurnstileGate.waitStatusLine), findsNothing);
    },
  );

  testWidgets('(a) Forgot password with an empty field says so, too', (
    WidgetTester tester,
  ) async {
    final _CountingAuth auth = await _pumpLogin(tester);
    final AppLocalizations l10n = AppLocalizations.of(
      tester.element(find.byType(LoginScreen)),
    );

    await tester.tap(find.text(l10n.forgotPasswordShort));
    await tester.pump();

    expect(find.textContaining(l10n.emailRequired), findsOneWidget);
    expect(auth.resets, 0);
  });

  testWidgets(
    '(b) a VALID submit shows "Checking you\'re human…" in a live region, then '
    'sends exactly ONE request, with the token, when it lands',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      final _CountingAuth auth = await _pumpLogin(tester);
      await _fill(tester, 'alex@example.com', 'hunter22');

      await _tapSubmit(tester);
      // A second tap and an Enter while waiting must not queue a second call.
      await tester.tap(find.byKey(E2EKeys.loginSubmit), warnIfMissed: false);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pump();

      expect(auth.signIns, 0, reason: 'no request may go without a token');
      final Finder status = find.byKey(TurnstileGate.waitStatusLine);
      expect(status, findsOneWidget);
      expect(find.text(_chassis(tester).authCaptchaChecking), findsOneWidget);
      expect(
        tester.getSemantics(status),
        isSemantics(isLiveRegion: true),
        reason: 'the wait must be ANNOUNCED, not only painted (WCAG 4.1.3)',
      );

      _captcha(tester).setToken('tok-1');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(auth.signIns, 1, reason: 'the token lands: ONE request');
      expect(auth.lastCaptchaToken, 'tok-1');
      expect(
        _captcha(tester).token,
        isNull,
        reason: 'the token is spent by the call, never kept for a retry',
      );
      expect(find.byKey(TurnstileGate.waitStatusLine), findsNothing);
      semantics.dispose();
    },
  );

  testWidgets(
    '(c) a captcha ERROR while waiting says to retry, sends nothing, and the '
    'button is live again',
    (WidgetTester tester) async {
      final _CountingAuth auth = await _pumpLogin(tester);
      await _fill(tester, 'alex@example.com', 'hunter22');
      await _tapSubmit(tester);
      expect(find.byKey(TurnstileGate.waitStatusLine), findsOneWidget);
      final int generation = _captcha(tester).generation;

      _captcha(tester).reportError('600010');
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 400));

      expect(auth.signIns, 0, reason: 'no token, no request');
      expect(
        find.text(_chassis(tester).authCaptchaUnavailable),
        findsOneWidget,
        reason: 'a failed challenge must say so, never a silent no-op',
      );
      expect(find.byKey(TurnstileGate.waitStatusLine), findsNothing);
      expect(
        _captcha(tester).generation,
        greaterThan(generation),
        reason: 'the retry meets a FRESH challenge',
      );

      // The retry works: a token now, and one tap is one request.
      _captcha(tester).setToken('tok-2');
      await tester.pump();
      await _tapSubmit(tester);
      await tester.pump(const Duration(milliseconds: 400));
      expect(auth.signIns, 1);
      expect(auth.lastCaptchaToken, 'tok-2');
    },
  );

  testWidgets('(c) a challenge that never answers times out to the same '
      'retry sentence', (WidgetTester tester) async {
    final _CountingAuth auth = await _pumpLogin(tester);
    await _fill(tester, 'alex@example.com', 'hunter22');
    await _tapSubmit(tester);

    await tester.pump(CaptchaTokenController.defaultWait);
    await tester.pump(const Duration(milliseconds: 400));

    expect(auth.signIns, 0);
    expect(find.text(_chassis(tester).authCaptchaUnavailable), findsOneWidget);
  });

  testWidgets('Check-inbox Resend is live with no token, and waits for one', (
    WidgetTester tester,
  ) async {
    final _CountingAuth auth = _CountingAuth();
    await pumpAt(
      tester,
      kPhone,
      const CheckInboxActions(email: 'alex@example.com'),
      overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
    );

    await tester.tap(find.byKey(CheckInboxActions.resendButton));
    await tester.pump();
    expect(auth.resends, 0);
    expect(find.byKey(TurnstileGate.waitStatusLine), findsOneWidget);

    _captcha(tester).setToken('tok-r');
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(auth.resends, 1);
    expect(auth.lastCaptchaToken, 'tok-r');
  });
}
