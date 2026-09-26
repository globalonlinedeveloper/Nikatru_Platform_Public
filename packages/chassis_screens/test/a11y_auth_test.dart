import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/check_inbox_screen.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_chassis_screens/auth/reaccept_terms_screen.dart';
import 'package:nikatru_chassis_screens/auth/reset_password_screen.dart';
import 'package:nikatru_chassis_screens/auth/sign_in_screen.dart';
import 'package:nikatru_chassis_screens/auth/sign_up_screen.dart';
import 'package:nikatru_chassis_screens/auth/verify_email_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE SEVEN AUTH SCREEN BODIES EVERY STAMPED APP INHERITS.
///
/// 🔴 WHY THIS FILE EXISTS. `tooling/ci/assert-a11y-coverage.mjs` printed
/// `packages/chassis_screens: 0 of 17 reachable surface(s) carry an a11y sweep`
/// on every run from the day [ADR 071] created this package until this file
/// landed, while `C-WCAG-22-AA` — WCAG 2.2 Level AA, [ADR 048] / [ADR 050] — is
/// a PUBLISHED claim. These seven widgets are what a stamped app renders for
/// sign-in, sign-up, verification, recovery and re-acceptance, so an
/// accessibility defect here is one every app in the portfolio ships. The gap
/// was inherited, not created: the same screens carried no sweep while they sat
/// in the brick either (`O-CHASSIS-SCREENS-A11Y-SWEEPS`).
///
/// ── WHAT A CASE HERE ASSERTS, AND WHY EACH LIMB IS LOAD-BEARING ────────────
/// Every case pumps ONE surface under the chassis theme and then runs three of
/// `flutter_test`'s own guidelines over the WHOLE screen:
///   · `androidTapTargetGuideline` — 48x48 minimum hit area, which is [ADR
///     048]'s figure and clears WCAG 2.2 SC 2.5.5 (Enhanced, 44) as [ADR 050]
///     records. The guideline implements SC 2.5.8's exemptions itself: it skips
///     `isLink` nodes, hidden nodes, merged nodes, non-actionable nodes and
///     targets clipped by a scrolling boundary.
///   · `labeledTapTargetGuideline` — every node a user can activate announces a
///     NAME. This is the half of the app's own `nakedControls` walk the
///     framework supplies; the ROLE half is not reproduced here and is recorded
///     as a residue rather than copied (see `support/a11y_harness.dart`).
///   · `textContrastGuideline` — SC 1.4.3, measured against the tokens
///     `buildAppTheme` actually renders, in BOTH brightnesses. A contrast sweep
///     under Flutter's default `ThemeData` would be grading colours no stamped
///     app ships, which is why these cases do not use `pumpChassis`.
///
/// ⚠️ AND EVERY CASE CALLS `expectSweepHadSubjects` FIRST. An
/// `AccessibilityGuideline` that inspects nothing returns `Evaluation.pass()`,
/// byte-identical to a clean screen — [ADR 048] records six of subscriptiontracker's nineteen
/// surfaces sitting in that state while the tap-target increment was written.
/// The floors below are MEASURED numbers, read off this rig on 2026-09-07.
///
/// 🏗️ These are SURFACE assertions, not wiring ones. That the router puts a
/// user in front of any of these screens stays in the brick's
/// `chassis_properties_test.dart`, where a stamped root is booted.
void main() {
  // The consent fields the two clickwrap screens are handed. The real adapter
  // passes the brick's widget; this suite passes the package view, which is the
  // same tree minus the URL launcher this package may not declare.
  Widget consentFields({
    required bool termsAccepted,
    required bool marketingAccepted,
    required bool enabled,
    required ValueChanged<bool> onTermsChanged,
    required ValueChanged<bool> onMarketingChanged,
  }) =>
      LegalConsentFieldsView(
        termsAccepted: termsAccepted,
        marketingAccepted: marketingAccepted,
        enabled: enabled,
        showMarketing: true,
        onTermsChanged: onTermsChanged,
        onMarketingChanged: onMarketingChanged,
        onOpenTerms: () {},
        onOpenPrivacy: () {},
      );

  // ── CheckInboxView ────────────────────────────────────────────────────────
  group('a11y: check-inbox', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          CheckInboxView(email: 'someone@example.com', onBackToSignIn: () {}),
        );
        expectSweepHadSubjects(
          tester,
          'check-inbox',
          tappable: 1,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone — the brightness a contrast sweep is FOR', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          CheckInboxView(email: 'someone@example.com', onBackToSignIn: () {}),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'check-inbox (dark)',
          tappable: 1,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets(
        'light, kDesktop — the form cap changes the layout, not the '
        'obligation', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          CheckInboxView(email: 'someone@example.com', onBackToSignIn: () {}),
        );
        expectSweepHadSubjects(
          tester,
          'check-inbox (kDesktop)',
          tappable: 1,
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

  // ── LegalConsentFieldsView ────────────────────────────────────────────────
  //
  // 🔴 THE ONE SURFACE WHERE A TAP TARGET WAS A REAL DEFECT. Backlog item B-4
  // was a gutter tap beside "Privacy" that TICKED CONSENT in every stamped app.
  // The consent tick is a Material `Checkbox`, whose PAINTED square is 20 px
  // inside a 48x48 semantics node ([ADR 048]'s retraction) — which is exactly
  // the shape that reads as failing when it is not, and as passing when it is.
  group('a11y: legal-consent-fields', () {
    testWidgets('light, kPhone — unticked', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: LegalConsentFieldsView(
              termsAccepted: false,
              marketingAccepted: false,
              enabled: true,
              showMarketing: true,
              onTermsChanged: (bool _) {},
              onMarketingChanged: (bool _) {},
              onOpenTerms: () {},
              onOpenPrivacy: () {},
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'legal-consent-fields',
          tappable: 4,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone — ticked, which repaints both boxes', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: LegalConsentFieldsView(
              termsAccepted: true,
              marketingAccepted: true,
              enabled: true,
              showMarketing: true,
              onTermsChanged: (bool _) {},
              onMarketingChanged: (bool _) {},
              onOpenTerms: () {},
              onOpenPrivacy: () {},
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'legal-consent-fields (ticked, dark)',
          tappable: 4,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets(
        'light, kDesktop — DISABLED, which is a contrast state and not '
        'a layout one', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: LegalConsentFieldsView(
              termsAccepted: false,
              marketingAccepted: false,
              enabled: false,
              showMarketing: true,
              onTermsChanged: (bool _) {},
              onMarketingChanged: (bool _) {},
              onOpenTerms: () {},
              onOpenPrivacy: () {},
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'legal-consent-fields (disabled, kDesktop)',
          tappable: 2,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── ReacceptTermsView ─────────────────────────────────────────────────────
  group('a11y: reaccept-terms', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ReacceptTermsView(
            onAccept: () async {},
            onSignOut: () async {},
            consentFields: consentFields,
          ),
        );
        expectSweepHadSubjects(
          tester,
          'reaccept-terms',
          tappable: 5,
          labelled: 8,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ReacceptTermsView(
            onAccept: () async {},
            onSignOut: () async {},
            consentFields: consentFields,
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'reaccept-terms (dark)',
          tappable: 5,
          labelled: 8,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          ReacceptTermsView(
            onAccept: () async {},
            onSignOut: () async {},
            consentFields: consentFields,
          ),
        );
        expectSweepHadSubjects(
          tester,
          'reaccept-terms (kDesktop)',
          tappable: 5,
          labelled: 8,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── ResetPasswordView ─────────────────────────────────────────────────────
  group('a11y: reset-password', () {
    testWidgets('light, kPhone — the live form', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ResetPasswordView(
            hasSession: true,
            recovering: true,
            arrival: core.PasswordResetArrival.pending,
            problem: null,
            onSubmit: (String _) async {},
            onLeave: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'reset-password',
          tappable: 4,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone — the live form', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ResetPasswordView(
            hasSession: true,
            recovering: true,
            arrival: core.PasswordResetArrival.pending,
            problem: null,
            onSubmit: (String _) async {},
            onLeave: () {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'reset-password (dark)',
          tappable: 4,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets(
        'light, kDesktop — the DEAD-LINK state, which is a different '
        'screen and not a different width', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          ResetPasswordView(
            hasSession: false,
            recovering: false,
            arrival: core.PasswordResetArrival.unusable,
            problem: core.AuthLinkProblem.expiredOrUsed,
            onSubmit: (String _) async {},
            onLeave: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'reset-password (dead link, kDesktop)',
          tappable: 1,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── SignInView ────────────────────────────────────────────────────────────
  group('a11y: sign-in', () {
    testWidgets(
        'light, kPhone — with the Apple button, which is the widest '
        'control set this screen ever shows', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SignInView(
            onSignIn: (String _, String __) async {},
            onForgotPassword: (String _) async {},
            onNeedAccount: () {},
            showAppleButton: true,
            onSignInWithApple: () async {},
            appleTermsOwed: false,
            consentFields: ({
              required bool termsAccepted,
              required bool marketingAccepted,
              required bool enabled,
              required ValueChanged<bool> onTermsChanged,
              required ValueChanged<bool> onMarketingChanged,
            }) =>
                const SizedBox.shrink(),
            onAcceptTerms: ({required bool marketingEmail}) async {},
          ),
        );
        expectSweepHadSubjects(tester, 'sign-in', tappable: 6, labelled: 7);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SignInView(
            onSignIn: (String _, String __) async {},
            onForgotPassword: (String _) async {},
            onNeedAccount: () {},
            showAppleButton: true,
            onSignInWithApple: () async {},
            appleTermsOwed: false,
            consentFields: ({
              required bool termsAccepted,
              required bool marketingAccepted,
              required bool enabled,
              required ValueChanged<bool> onTermsChanged,
              required ValueChanged<bool> onMarketingChanged,
            }) =>
                const SizedBox.shrink(),
            onAcceptTerms: ({required bool marketingEmail}) async {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'sign-in (dark)',
          tappable: 6,
          labelled: 7,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets(
        'light, kDesktop — carrying the deletion notice, the one state '
        'that adds prose above the form', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          SignInView(
            onSignIn: (String _, String __) async {},
            onForgotPassword: (String _) async {},
            onNeedAccount: () {},
            showAppleButton: false,
            onSignInWithApple: () async {},
            appleTermsOwed: false,
            consentFields: ({
              required bool termsAccepted,
              required bool marketingAccepted,
              required bool enabled,
              required ValueChanged<bool> onTermsChanged,
              required ValueChanged<bool> onMarketingChanged,
            }) =>
                const SizedBox.shrink(),
            onAcceptTerms: ({required bool marketingEmail}) async {},
            deletion: core.AccountDeletionOutcome.deleted,
            deletionDetail: 'Your account and its data are gone.',
            onDismissDeletionNotice: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'sign-in (deletion notice, kDesktop)',
          tappable: 5,
          labelled: 7,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── SignUpView ────────────────────────────────────────────────────────────
  group('a11y: sign-up', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SignUpView(
            onSignUp: ({
              required String email,
              required String password,
              required bool marketingEmail,
            }) async {},
            onHaveAccount: () {},
            consentFields: consentFields,
          ),
        );
        expectSweepHadSubjects(tester, 'sign-up', tappable: 7, labelled: 9);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SignUpView(
            onSignUp: ({
              required String email,
              required String password,
              required bool marketingEmail,
            }) async {},
            onHaveAccount: () {},
            consentFields: consentFields,
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'sign-up (dark)',
          tappable: 7,
          labelled: 9,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          SignUpView(
            onSignUp: ({
              required String email,
              required String password,
              required bool marketingEmail,
            }) async {},
            onHaveAccount: () {},
            consentFields: consentFields,
          ),
        );
        expectSweepHadSubjects(
          tester,
          'sign-up (kDesktop)',
          tappable: 7,
          labelled: 9,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });

  // ── VerifyEmailView ───────────────────────────────────────────────────────
  group('a11y: verify-email', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          VerifyEmailView(
            email: 'someone@example.com',
            onCheckConfirmed: () async => false,
            onResend: () async {},
            onSignOut: () async {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'verify-email',
          tappable: 3,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          VerifyEmailView(
            email: 'someone@example.com',
            onCheckConfirmed: () async => false,
            onResend: () async {},
            onSignOut: () async {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'verify-email (dark)',
          tappable: 3,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          VerifyEmailView(
            email: 'someone@example.com',
            onCheckConfirmed: () async => false,
            onResend: () async {},
            onSignOut: () async {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'verify-email (kDesktop)',
          tappable: 3,
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
