import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/email_code_form.dart';
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// ⏱ 2026-10-01 · train ST-account-plus — the a11y sweeps of the two views it
/// adds: `EmailCodeForm` (EN-21) and `ConnectedAccountsView` (SE-04). The same
/// three sweeps every chassis surface takes (tap target, labelled tap target,
/// text contrast), in both brightnesses, over every tap-target platform.
void main() {
  for (final Brightness b in Brightness.values) {
    group('a11y: email-code (${b.name})', () {
      testWidgets('kPhone', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          await pumpForA11y(
            tester,
            kPhone,
            Scaffold(
              body: EmailCodeForm(
                email: 'a@example.com',
                cooldown: Duration.zero,
                onVerify: (_) async {},
                onResend: () async => core.emailCodeCooldown,
                onCancel: () {},
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'email-code (${b.name})',
            tappable: 4,
            labelled: 5,
          );
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        } finally {
          handle.dispose();
        }
      }, variant: kTapTargetPlatforms);
    });

    group('a11y: connected-accounts (${b.name})', () {
      testWidgets('kPhone', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          await pumpForA11y(
            tester,
            kPhone,
            Scaffold(
              body: ConnectedAccountsView(
                user: const core.AuthUser(
                  id: 'u',
                  email: 'a@example.com',
                  emailVerified: true,
                  oauthProviders: <String>['apple'],
                ),
                available: const <core.SignInMethod>{
                  core.SignInMethod.apple,
                  core.SignInMethod.google,
                },
                onLink: (_) async {},
                onUnlink: (_) async => throw StateError('not in a sweep'),
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'connected-accounts (${b.name})',
            tappable: 2,
            labelled: 6,
          );
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        } finally {
          handle.dispose();
        }
      }, variant: kTapTargetPlatforms);
    });
  }
}
