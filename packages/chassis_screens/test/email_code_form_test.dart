import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/email_code_form.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// ⏱ 2026-10-01 · EN-21 — `EmailCodeForm`, the code entry after "Email me a
/// code". The app drives it end to end (`email_code_sign_in_test.dart`); this
/// holds the view's own properties.
///
/// RED CONTROLS: drop the `isEmailCodeShape` check (the typo case reaches
/// `onVerify`); enable resend while `_wait > 0` (the countdown case taps it);
/// drop the `ConstrainedBox` (the kTablet / kDesktop cases measure the window).
void main() {
  final ChassisLocalizations l10n = lookupChassisLocalizations(
    const Locale('en'),
  );

  Widget form({
    Duration cooldown = Duration.zero,
    Future<void> Function(String)? onVerify,
    Future<Duration> Function()? onResend,
    VoidCallback? onCancel,
  }) => Scaffold(
    body: EmailCodeForm(
      email: 'a@example.com',
      cooldown: cooldown,
      onVerify: onVerify ?? (_) async {},
      onResend: onResend ?? () async => core.emailCodeCooldown,
      onCancel: onCancel ?? () {},
    ),
  );

  /// The countdown is a periodic timer; unmount so it does not outlive a case.
  Future<void> unmount(WidgetTester tester) =>
      tester.pumpWidget(const SizedBox.shrink());

  // ── THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────────
  group('property: email-code-holds-the-form-cap at every window class', () {
    Future<double> buttonWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, form());
      return tester.getSize(find.byKey(EmailCodeForm.verifyButton)).width;
    }

    testWidgets('kPhone — the window is narrower than the cap', (
      WidgetTester tester,
    ) async {
      expect(await buttonWidthAt(tester, kPhone), kPhone.width);
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await buttonWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await buttonWidthAt(tester, kDesktop), AppBreakpoints.form);
    });
  });

  testWidgets('a typo is refused here, with no request', (
    WidgetTester tester,
  ) async {
    final List<String> verified = <String>[];
    await pumpChassis(
      tester,
      kPhone,
      form(onVerify: (String c) async => verified.add(c)),
    );
    await tester.enterText(find.byKey(EmailCodeForm.codeField), '12345');
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    expect(verified, isEmpty);
    expect(
      tester.widget<Text>(find.byKey(EmailCodeForm.statusLine)).data,
      l10n.emailCodeShape,
    );
    await tester.enterText(find.byKey(EmailCodeForm.codeField), '123 456');
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    expect(verified, <String>['123456']);
  });

  testWidgets('🔴 the cooldown holds the resend, counts down, then frees it', (
    WidgetTester tester,
  ) async {
    int resends = 0;
    await pumpChassis(
      tester,
      kPhone,
      form(
        cooldown: const Duration(seconds: 3),
        onResend: () async {
          resends++;
          return core.emailCodeCooldown;
        },
      ),
      settle: false,
    );
    TextButton resend() =>
        tester.widget<TextButton>(find.byKey(EmailCodeForm.resendButton));
    expect(resend().onPressed, isNull);
    expect(find.text(l10n.emailCodeResendIn(3)), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text(l10n.emailCodeResendIn(2)), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    expect(resend().onPressed, isNotNull);
    await tester.tap(find.byKey(EmailCodeForm.resendButton));
    await tester.pump();
    expect(resends, 1);
    // A send starts a fresh cooldown and says so — uniformly.
    expect(resend().onPressed, isNull);
    expect(find.text(l10n.emailCodeSentAgain), findsOneWidget);
    await unmount(tester);
  });

  testWidgets('a refusal reads through the one mapper', (
    WidgetTester tester,
  ) async {
    await pumpChassis(
      tester,
      kPhone,
      form(
        onVerify: (_) async => throw core.AuthFailure(
          'Token has expired or is invalid',
          code: core.AuthFailure.codeInvalid,
        ),
      ),
    );
    await tester.enterText(find.byKey(EmailCodeForm.codeField), '000000');
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(EmailCodeForm.statusLine)).data,
      l10n.authCodeInvalid,
    );
  });
}
