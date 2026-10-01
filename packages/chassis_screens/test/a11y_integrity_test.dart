import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/turnstile_gate.dart';
import 'package:nikatru_chassis_screens/integrity/device_integrity_gate.dart'
    show ReauthDialog;
import 'package:nikatru_chassis_screens/integrity/tampered_build_screen.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart'
    show RootedDeviceNoticeHost;
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE DEVICE-INTEGRITY SURFACES (row O-APPS-GOV-IN-VAPT-CHECKLIST).
///
/// `TamperedBuildApp` / `TamperedBuildScreen` (what a re-signed copy runs
/// instead of the app), `RootedDeviceNoticeHost` (the once-per-session rooted
/// notice) and `ReauthDialog` (the password prompt in front of a sensitive
/// action) arrived together on 2026-10-01 and are swept here in the same
/// change. See `a11y_auth_test.dart`'s header for what each case asserts and
/// why; the subject counts were measured off this rig the day they landed.
const core.DeviceIntegrity _rooted = core.DeviceIntegrity(
  root: core.RootReport(core.RootStatus.rooted, <core.RootSignal>{
    core.RootSignal.suBinary,
  }),
  signer: core.SignerVerdict.verified,
);

void main() {
  // ── TamperedBuildScreen ───────────────────────────────────────────────────
  group('a11y: tampered-build-screen', () {
    testWidgets('light, kPhone — the message and its one way out', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          TamperedBuildScreen(onExit: () async {}),
        );
        expectSweepHadSubjects(
          tester,
          'tampered-build-screen',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          TamperedBuildScreen(onExit: () async {}),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'tampered-build-screen (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── TamperedBuildApp ──────────────────────────────────────────────────────
  //
  // It is an application ROOT with its own neutral-grey theme, so it is pumped
  // as one: wrapping it in the chassis theme would grade colours a re-signed
  // copy never renders.
  group('a11y: tampered-build-app', () {
    testWidgets('light, kPhone — its own theme', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(tester, kPhone, const TamperedBuildApp());
        expectSweepHadSubjects(
          tester,
          'tampered-build-app',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop — the platform asks for dark', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      try {
        await pumpRootForA11y(tester, kDesktop, const TamperedBuildApp());
        expectSweepHadSubjects(
          tester,
          'tampered-build-app (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── RootedDeviceNoticeHost ────────────────────────────────────────────────
  group('a11y: rooted-device-notice-host', () {
    testWidgets('light, kPhone — rooted, so the notice and its dismiss are '
        'on screen', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: RootedDeviceNoticeHost(
              session: core.IntegritySession(_rooted),
              child: const Center(child: Text('the app below the notice')),
            ),
          ),
        );
        expect(find.byKey(RootedDeviceNoticeHost.notice), findsOneWidget);
        expectSweepHadSubjects(
          tester,
          'rooted-device-notice-host',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: RootedDeviceNoticeHost(
              session: core.IntegritySession(_rooted),
              child: const Center(child: Text('the app below the notice')),
            ),
          ),
          brightness: Brightness.dark,
        );
        expect(find.byKey(RootedDeviceNoticeHost.notice), findsOneWidget);
        expectSweepHadSubjects(
          tester,
          'rooted-device-notice-host (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── ReauthDialog ──────────────────────────────────────────────────────────
  //
  // Swept with the challenge MOUNTED and not yet answered, behind a labelled
  // stand-in of the vendor's size — the same rig as `a11y: turnstile-gate` —
  // so the gate's host layout is measured too, not only the field and buttons.
  group('a11y: reauth-dialog', () {
    testWidgets('light, kPhone — password, cancel and continue', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: Center(
              child: ReauthDialog(
                captcha: c,
                renderTurnstile: (BuildContext _, TurnstileChallenge _) =>
                    Semantics(
                      label: 'Verification challenge',
                      child: const SizedBox(width: 300, height: 65),
                    ),
              ),
            ),
          ),
        );
        expect(find.bySemanticsLabel('Verification challenge'), findsOneWidget);
        expectSweepHadSubjects(
          tester,
          'reauth-dialog',
          tappable: 3,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        c.dispose();
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final CaptchaTokenController c = CaptchaTokenController(
        posture: CaptchaPosture.challenge,
        siteKey: 'k',
      );
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: Center(
              child: ReauthDialog(
                captcha: c,
                renderTurnstile: (BuildContext _, TurnstileChallenge _) =>
                    Semantics(
                      label: 'Verification challenge',
                      child: const SizedBox(width: 300, height: 65),
                    ),
              ),
            ),
          ),
          brightness: Brightness.dark,
        );
        expect(find.bySemanticsLabel('Verification challenge'), findsOneWidget);
        expectSweepHadSubjects(
          tester,
          'reauth-dialog (dark, kDesktop)',
          tappable: 3,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        c.dispose();
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });
}
