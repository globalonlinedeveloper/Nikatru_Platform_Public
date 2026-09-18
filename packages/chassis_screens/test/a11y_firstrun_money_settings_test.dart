import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_chassis_screens/settings/report_content_dialog.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';
import 'package:nikatru_core/nikatru_core.dart';

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — FIRST RUN, THE MONEY SCREENS AND SETTINGS.
///
/// The six surfaces this file sweeps — `OnboardingView`, `ManagePlanView`,
/// `PaywallView`, `SettingsView`, `EditProfileDialog` and `ReportContentDialog`
/// — are the ones a
/// stamped app renders for the two decisions that cost the user something: the
/// purchase and the account. See `a11y_auth_test.dart`'s header for what each
/// case asserts and why; the same three `flutter_test` guidelines and the same
/// non-vacuity floor apply here.
///
/// 🔴 ONE STATE IS PINNED RATHER THAN SWEPT, AND THE PIN IS THE POINT.
/// `PaywallPhase.refused` renders an explanation and NO control at all
/// (`paywall_screen.dart` `_body`, the `refused` arm), so the tap-target family
/// is handed zero subjects there. [ADR 048] records the same shape on two subscriptiontracker
/// surfaces and the same remedy: pin the zero, so that a vacuous pass is
/// impossible and the day a control lands there the pin fails and asks for the
/// sweep.
void main() {
  const List<PaywallOffer> offers = <PaywallOffer>[
    PaywallOffer(
      id: 'pro_monthly',
      formattedPrice: r'$4.99',
      term: 'month',
      trialDays: 0,
    ),
    PaywallOffer(
      id: 'pro_yearly',
      formattedPrice: r'$39.99',
      term: 'year',
      trialDays: 7,
    ),
  ];

  // ── OnboardingView ────────────────────────────────────────────────────────
  group('a11y: onboarding', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          OnboardingView(
            pages: const <OnboardingPage>[
              OnboardingPage(title: 'One', body: 'The first thing'),
              OnboardingPage(title: 'Two', body: 'The second thing'),
            ],
            onFinish: () {},
          ),
        );
        expectSweepHadSubjects(tester, 'onboarding', tappable: 2, labelled: 3);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          OnboardingView(
            pages: const <OnboardingPage>[
              OnboardingPage(title: 'One', body: 'The first thing'),
              OnboardingPage(title: 'Two', body: 'The second thing'),
            ],
            onFinish: () {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'onboarding (dark)',
          tappable: 2,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop — where the reading cap engages', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          OnboardingView(
            pages: const <OnboardingPage>[
              OnboardingPage(title: 'One', body: 'The first thing'),
              OnboardingPage(title: 'Two', body: 'The second thing'),
            ],
            onFinish: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'onboarding (kDesktop)',
          tappable: 2,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── ManagePlanView ────────────────────────────────────────────────────────
  //
  // ROSCA is a rule about how hard the cancel control is to FIND, and a control
  // a screen reader cannot identify is one a reader cannot find at all — so the
  // labelled-tap-target limb is this surface's compliance limb, not decoration.
  group('a11y: manage-plan', () {
    testWidgets('light, kPhone — an active plan, both controls live', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ManagePlanView(
            title: 'Manage plan',
            isPro: true,
            planStatusLabel: 'Your plan is active',
            restoreHint: 'Sign in on a new device and your plan follows you',
            cancelLabel: 'Cancel plan',
            busy: false,
            onBack: () {},
            onRestore: () {},
            onCancel: () {},
          ),
        );
        expectSweepHadSubjects(tester, 'manage-plan', tappable: 3, labelled: 5);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ManagePlanView(
            title: 'Manage plan',
            isPro: true,
            planStatusLabel: 'Your plan is active',
            restoreHint: 'Sign in on a new device and your plan follows you',
            cancelLabel: 'Cancel plan',
            busy: false,
            onBack: () {},
            onRestore: () {},
            onCancel: () {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'manage-plan (dark)',
          tappable: 3,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop — NO plan, which removes the cancel row and '
        'is therefore a different reading order', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          ManagePlanView(
            title: 'Manage plan',
            isPro: false,
            planStatusLabel: 'No active plan',
            restoreHint: 'Sign in on a new device and your plan follows you',
            cancelLabel: 'Cancel plan',
            busy: false,
            onBack: () {},
            onRestore: () {},
            onCancel: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'manage-plan (no plan, kDesktop)',
          tappable: 2,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── PaywallView ───────────────────────────────────────────────────────────
  group('a11y: paywall', () {
    testWidgets('light, kPhone — choosing, the state with the plan cards', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          PaywallView(
            phase: PaywallPhase.choosing,
            offers: offers,
            canStartCheckout: true,
            detail: '',
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'paywall (choosing)',
          tappable: 2,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone — choosing', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          PaywallView(
            phase: PaywallPhase.choosing,
            offers: offers,
            canStartCheckout: true,
            detail: '',
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'paywall (choosing, dark)',
          tappable: 2,
          labelled: 6,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — unlocked, the terminal SUCCESS state', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          PaywallView(
            phase: PaywallPhase.unlocked,
            offers: offers,
            canStartCheckout: true,
            detail: '',
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
          ),
        );
        expectSweepHadSubjects(
          tester,
          'paywall (unlocked)',
          tappable: 1,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — pending, which NEVER SETTLES and is pumped '
        'once rather than settled', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          PaywallView(
            phase: PaywallPhase.pending,
            offers: offers,
            canStartCheckout: true,
            detail: 'Waiting for the store.',
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
          ),
          settle: false,
        );
        expectSweepHadSubjects(
          tester,
          'paywall (pending)',
          tappable: 1,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop — refused hands the tap-target family NOTHING '
        '— PINNED', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          PaywallView(
            phase: PaywallPhase.refused,
            offers: offers,
            canStartCheckout: true,
            detail: 'The store refused the purchase.',
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
          ),
        );
        // 🔴 PINNED AT ZERO, NOT SWEPT WITH A FLOOR OF ONE. This arm renders an
        // explanation and no control, so `androidTapTargetGuideline` would
        // return `Evaluation.pass()` having inspected nothing — the vacuous
        // shape [ADR 048] records. The pin says so out loud: the day a control
        // lands in the refused arm this case fails and asks for the tap-target
        // floor the other four cases carry.
        final int tappable = tester.semantics
            .simulatedAccessibilityTraversal()
            .where(
              (SemanticsNode n) =>
                  n.getSemanticsData().hasAction(SemanticsAction.tap),
            )
            .length;
        expect(
          tappable,
          0,
          reason:
              'the refused arm gained a control; give this case the tap-target '
              'floor the other paywall cases carry instead of this pin',
        );
        // The CONTRAST limb is not vacuous here — the refusal and its reason are
        // the only thing on the screen, and unreadable prose is the whole defect.
        expectSweepHadSubjects(
          tester,
          'paywall (refused)',
          tappable: 0,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── SettingsView ──────────────────────────────────────────────────────────
  //
  // The densest surface in the package: twelve activatable nodes and
  // twenty-one labels on a phone. It carries the deletion control, the consent
  // switches and the locale picker, so a naming or contrast defect here is a
  // privacy control a reader cannot operate.
  group('a11y: settings', () {
    testWidgets('light, kPhone — signed in, with a profile', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SettingsView(
            profile: const SettingsProfile(
              initial: 'S',
              displayName: 'Someone',
              email: 'someone@example.com',
            ),
            onEditProfile: () {},
            themeMode: ThemeMode.system,
            onThemeModeChanged: (ThemeMode _) {},
            languageCode: '',
            onLanguageChanged: (String _) {},
            remindersAvailable: true,
            remindersEnabled: false,
            onRemindersChanged: (bool _) {},
            analyticsGranted: false,
            onAnalyticsConsentChanged: (bool _) {},
            promoObjected: false,
            promoObjectionKnown: true,
            onPromoObjectionChanged: (bool _) {},
            hasSession: true,
            planSectionLabel: 'Plan',
            managePlanLabel: 'Manage plan',
            onUpgrade: () {},
            onManagePlan: () {},
            onOpenPrivacyPolicy: () {},
            onOpenTerms: () {},
            onOpenRefundPolicy: () {},
            supportEmail: 'support@example.com',
            onContactSupport: () {},
            onSignOut: () {},
            onDeleteAccount: () {},
            applicationName: 'Probe',
            applicationVersion: '1.2.3',
          ),
        );
        expectSweepHadSubjects(
          tester,
          'settings',
          tappable: 12,
          labelled: 21,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone — the consent switches in their OFF state, which '
        'is the low-contrast one', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SettingsView(
            profile: const SettingsProfile(
              initial: 'S',
              displayName: 'Someone',
              email: 'someone@example.com',
            ),
            onEditProfile: () {},
            themeMode: ThemeMode.dark,
            onThemeModeChanged: (ThemeMode _) {},
            languageCode: '',
            onLanguageChanged: (String _) {},
            remindersAvailable: true,
            remindersEnabled: false,
            onRemindersChanged: (bool _) {},
            analyticsGranted: false,
            onAnalyticsConsentChanged: (bool _) {},
            promoObjected: false,
            promoObjectionKnown: true,
            onPromoObjectionChanged: (bool _) {},
            hasSession: true,
            planSectionLabel: 'Plan',
            managePlanLabel: 'Manage plan',
            onUpgrade: () {},
            onManagePlan: () {},
            onOpenPrivacyPolicy: () {},
            onOpenTerms: () {},
            onOpenRefundPolicy: () {},
            supportEmail: 'support@example.com',
            onContactSupport: () {},
            onSignOut: () {},
            onDeleteAccount: () {},
            applicationName: 'Probe',
            applicationVersion: '1.2.3',
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'settings (dark)',
          tappable: 12,
          labelled: 21,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — SIGNED OUT, which is a different control set '
        'and not a different width', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SettingsView(
            profile: null,
            onEditProfile: () {},
            themeMode: ThemeMode.system,
            onThemeModeChanged: (ThemeMode _) {},
            languageCode: '',
            onLanguageChanged: (String _) {},
            remindersAvailable: true,
            remindersEnabled: false,
            onRemindersChanged: (bool _) {},
            analyticsGranted: false,
            onAnalyticsConsentChanged: (bool _) {},
            promoObjected: false,
            promoObjectionKnown: true,
            onPromoObjectionChanged: (bool _) {},
            hasSession: false,
            planSectionLabel: 'Plan',
            managePlanLabel: 'Manage plan',
            onUpgrade: () {},
            onManagePlan: () {},
            onOpenPrivacyPolicy: () {},
            onOpenTerms: () {},
            onOpenRefundPolicy: () {},
            supportEmail: 'support@example.com',
            onContactSupport: () {},
            onSignOut: () {},
            onDeleteAccount: () {},
            applicationName: 'Probe',
            applicationVersion: '1.2.3',
          ),
        );
        expectSweepHadSubjects(
          tester,
          'settings (signed out)',
          tappable: 13,
          labelled: 21,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop — where the page cap engages and the rows stop '
        'stretching', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          SettingsView(
            profile: const SettingsProfile(
              initial: 'S',
              displayName: 'Someone',
              email: 'someone@example.com',
            ),
            onEditProfile: () {},
            themeMode: ThemeMode.system,
            onThemeModeChanged: (ThemeMode _) {},
            languageCode: '',
            onLanguageChanged: (String _) {},
            remindersAvailable: true,
            remindersEnabled: false,
            onRemindersChanged: (bool _) {},
            analyticsGranted: false,
            onAnalyticsConsentChanged: (bool _) {},
            promoObjected: false,
            promoObjectionKnown: true,
            onPromoObjectionChanged: (bool _) {},
            hasSession: true,
            planSectionLabel: 'Plan',
            managePlanLabel: 'Manage plan',
            onUpgrade: () {},
            onManagePlan: () {},
            onOpenPrivacyPolicy: () {},
            onOpenTerms: () {},
            onOpenRefundPolicy: () {},
            supportEmail: 'support@example.com',
            onContactSupport: () {},
            onSignOut: () {},
            onDeleteAccount: () {},
            applicationName: 'Probe',
            applicationVersion: '1.2.3',
          ),
        );
        expectSweepHadSubjects(
          tester,
          'settings (kDesktop)',
          tappable: 14,
          labelled: 24,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── EditProfileDialog ─────────────────────────────────────────────────────
  group('a11y: edit-profile', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final TextEditingController name = TextEditingController(text: 'Old');
      addTearDown(name.dispose);
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          EditProfileDialog(name: name, onSave: () {}),
        );
        expectSweepHadSubjects(
          tester,
          'edit-profile',
          tappable: 3,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final TextEditingController name = TextEditingController(text: 'Old');
      addTearDown(name.dispose);
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          EditProfileDialog(name: name, onSave: () {}),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'edit-profile (dark)',
          tappable: 3,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop', (WidgetTester tester) async {
      final TextEditingController name = TextEditingController(text: 'Old');
      addTearDown(name.dispose);
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          EditProfileDialog(name: name, onSave: () {}),
        );
        expectSweepHadSubjects(
          tester,
          'edit-profile (kDesktop)',
          tappable: 3,
          labelled: 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── ReportContentDialog ───────────────────────────────────────────────────
  // O-PLAY-AI-CONTENT-REPORTING. Swept in its FORM phase, the one with every
  // control: eight reason rows, two fields and two buttons.
  group('a11y: report-content', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ReportContentDialog(
            onSubmit: (ContentReport _) async =>
                const Result<ContentReportReceipt>.err(Failure('unused')),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'report-content (light, kPhone)',
          tappable: 11,
          labelled: 17,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          ReportContentDialog(
            onSubmit: (ContentReport _) async =>
                const Result<ContentReportReceipt>.err(Failure('unused')),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'report-content (dark, kPhone)',
          tappable: 11,
          labelled: 17,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          ReportContentDialog(
            onSubmit: (ContentReport _) async =>
                const Result<ContentReportReceipt>.err(Failure('unused')),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'report-content (light, kDesktop)',
          tappable: 11,
          labelled: 17,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });
}
