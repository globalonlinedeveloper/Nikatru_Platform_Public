import 'dart:async';

import 'package:flutter/foundation.dart' show defaultTargetPlatform;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_chassis_screens/settings/devices_section.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_chassis_screens/settings/help_section.dart';
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
    PaywallOffer(id: 'pro_monthly', formattedPrice: r'$4.99', term: 'month'),
    PaywallOffer(
      id: 'pro_yearly',
      formattedPrice: r'$39.99',
      term: 'year',
      trial: (count: 7, unit: 'day'),
    ),
  ];

  // ── OnboardingView ────────────────────────────────────────────────────────
  // ⏱ ST-T9 (EN-18): the after-sign-in setup's frame, swept in the same
  // change that adds it to SWEPT_FLOOR_BY_ROOT.
  // ⏱ ST-T9 (EN-18): the after-sign-in setup's frame, swept in the same
  // change that adds it to SWEPT_FLOOR_BY_ROOT.
  group('a11y: after-sign-in setup', () {
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          SetupStepsView(
            steps: const <SetupStep>[
              SetupStep(title: 'One', body: 'The first thing'),
              SetupStep(title: 'Two', body: 'The second thing'),
            ],
            onFinish: () {},
            onSkip: () {},
            nextLabel: 'Next',
            finishLabel: 'Done',
            skipLabel: 'Skip',
            backLabel: 'Back',
            positionLabel: (int i, int n) => 'Step $i of $n',
          ),
          brightness: Brightness.light,
        );
        expectSweepHadSubjects(
          tester,
          'setup (light)',
          tappable: 2,
          labelled: 3,
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
          SetupStepsView(
            steps: const <SetupStep>[
              SetupStep(title: 'One', body: 'The first thing'),
              SetupStep(title: 'Two', body: 'The second thing'),
            ],
            onFinish: () {},
            onSkip: () {},
            nextLabel: 'Next',
            finishLabel: 'Done',
            skipLabel: 'Skip',
            backLabel: 'Back',
            positionLabel: (int i, int n) => 'Step $i of $n',
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'setup (dark)',
          tappable: 2,
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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);
  });

  // ── ManagePlanView ────────────────────────────────────────────────────────
  //
  // ROSCA is a rule about how hard the cancel control is to FIND, and a control
  // a screen reader cannot identify is one a reader cannot find at all — so the
  // labelled-tap-target limb is this surface's compliance limb, not decoration.
  //
  // ⏱ 2026-09-25 · O-DESKTOP-TAP-TARGETS-BELOW-48. The `labelled` floor is
  // per platform here, and only here, because this is the one swept surface
  // with a `BackButton`. Flutter gives that button a semantics LABEL on
  // android only; on iOS, linux, macOS and windows it is named by its
  // tooltip alone, so the same view announces one labelled node fewer. Both
  // numbers are measured under [kTapTargetPlatforms]: android 5 / 5 / 4 as
  // before, every other platform 4 / 4 / 3.
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
        expectSweepHadSubjects(
          tester,
          'manage-plan',
          tappable: 3,
          labelled: defaultTargetPlatform == TargetPlatform.android ? 5 : 4,
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
          labelled: defaultTargetPlatform == TargetPlatform.android ? 5 : 4,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

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
          labelled: defaultTargetPlatform == TargetPlatform.android ? 4 : 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
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
            checkoutStyle: PaywallCheckoutStyle.hosted,
            refusalView: PaywallRefusalView.retryable,
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
            onRetry: () {},
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
    }, variant: kTapTargetPlatforms);

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
            checkoutStyle: PaywallCheckoutStyle.hosted,
            refusalView: PaywallRefusalView.retryable,
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
            onRetry: () {},
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
    }, variant: kTapTargetPlatforms);

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
            checkoutStyle: PaywallCheckoutStyle.hosted,
            refusalView: PaywallRefusalView.retryable,
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
            onRetry: () {},
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
    }, variant: kTapTargetPlatforms);

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
            checkoutStyle: PaywallCheckoutStyle.store,
            refusalView: PaywallRefusalView.retryable,
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
            onRetry: () {},
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
    }, variant: kTapTargetPlatforms);

    testWidgets('light, kDesktop — refused, whose one control is Try again', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          PaywallView(
            phase: PaywallPhase.refused,
            offers: offers,
            canStartCheckout: true,
            checkoutStyle: PaywallCheckoutStyle.store,
            refusalView: PaywallRefusalView.unavailable,
            onBuy: (PaywallOffer _) {},
            onCheckAgain: () {},
            onGoHome: () {},
            onRetry: () {},
          ),
        );
        // This case was PINNED AT ZERO controls while the refused arm rendered
        // an explanation and nothing to press — a tap-target sweep over it would
        // have passed having inspected nothing, the vacuous shape [ADR 048]
        // records — and the pin asked for the tap-target floor the day a
        // control landed here. Try again is that control
        // (O-PAYWALL-SPEAKS-ONLY-WEB-CHECKOUT), so the arm now carries the same
        // floor and the same three sweeps as the other paywall cases.
        expectSweepHadSubjects(
          tester,
          'paywall (refused)',
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
            onSignOutEverywhere: () {},
            onDeleteAccount: () {},
            applicationName: 'Probe',
            applicationVersion: '1.2.3',
          ),
        );
        expectSweepHadSubjects(tester, 'settings', tappable: 12, labelled: 21);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

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
            onSignOutEverywhere: () {},
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
    }, variant: kTapTargetPlatforms);

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
            onSignOutEverywhere: () {},
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
    }, variant: kTapTargetPlatforms);

    testWidgets(
      'light, kDesktop — where the page cap engages and the rows stop '
      'stretching',
      (WidgetTester tester) async {
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
              onSignOutEverywhere: () {},
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
      },
      variant: kTapTargetPlatforms,
    );
  });

  // ── SettingsSection (ST-D4) ───────────────────────────────────────────────
  // The group every settings page is built from: a heading node, one card of
  // rows, an optional footer. Swept with a tappable row and a switch in it.
  group('a11y: settings-section', () {
    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}, kPhone', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          // On a Scaffold, as on every settings page: under a bare `home:`
          // the heading and footer sit on no painted ground and the contrast
          // sweep reads them against transparent black.
          await pumpForA11y(
            tester,
            kPhone,
            const Scaffold(
              body: SettingsSection(
                title: 'Privacy',
                footer: 'Applies on this device.',
                children: <Widget>[
                  ListTile(title: Text('Privacy notice'), onTap: _noop),
                  SwitchListTile(
                    title: Text('Usage statistics'),
                    value: true,
                    onChanged: _noopBool,
                  ),
                ],
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'settings-section (${b.name})',
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
    }
  });

  // ── SettingsHeading + helpCard (audit D8, D12/F53) ────────────────────────
  // A heading node over the ONE Help section, its four rows drawn by a
  // ListTile the way an app's own row widget is passed in.
  group('a11y: help-section', () {
    for (final Brightness b in Brightness.values) {
      testWidgets('${b.name}, kPhone', (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        try {
          await pumpForA11y(
            tester,
            kPhone,
            Scaffold(
              body: Builder(
                builder: (BuildContext context) => ListView(
                  children: <Widget>[
                    const SettingsHeading('Help', paint: 'HELP'),
                    helpCard(
                      context,
                      decoration: const BoxDecoration(),
                      row: _HelpRow.new,
                      contactPageLabel: 'Help & support',
                      openContactPage: _noop,
                      contactSupportLabel: 'Contact support',
                      supportEmail: 'support@example.com',
                      supportSubject: 'App support',
                      feedbackLabel: 'Send feedback',
                      feedbackSubject: 'App feedback',
                      openMail: (Uri mail) async {},
                      canRate: true,
                      rateLabel: 'Rate App',
                      openStoreListing: () async => StoreListingOutcome.opened,
                      rateUnavailable: 'The store could not be opened.',
                    ),
                  ],
                ),
              ),
            ),
            brightness: b,
          );
          expectSweepHadSubjects(
            tester,
            'help-section (${b.name})',
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
    }
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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);
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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);

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
    }, variant: kTapTargetPlatforms);
  });
  // ── ST-T2 honest states: PlanStatusTile, PlansLoadGate/PlansLoading,
  // RowChevron. The failed plan row carries the only control (Retry).
  group('a11y: honest states (ST-T2)', () {
    testWidgets('plan status (failed) and an actionable chevron, kPhone', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: Column(
              children: <Widget>[
                PlanStatusTile(
                  status: PlanStatus.failed,
                  labels: const PlanStatusLabels(
                    active: 'Your plan is active',
                    inactive: 'You have no plan',
                    checking: 'Checking your plan',
                    failed: 'Could not check your plan',
                    retry: 'Retry',
                  ),
                  onRetry: () {},
                ),
                const RowChevron(actionable: true),
              ],
            ),
          ),
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);

    testWidgets('plans still loading announce what they wait for, kPhone', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: PlansLoadGate(
              load: () => Completer<void>().future,
              builder: (BuildContext context, bool loading) =>
                  const PlansLoading(label: 'Loading plans'),
            ),
          ),
          settle: false,
        );
        expect(find.bySemanticsLabel('Loading plans'), findsOneWidget);
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── DevicesSection (SE-03, 2026-10-01) ───────────────────────────────────
  // This device first and marked, one other device with its "Sign out this
  // device" control — the one activatable node, which must be labelled.
  group('a11y: devices', () {
    final List<DeviceSession> two = <DeviceSession>[
      const DeviceSession(id: 'here', current: true, device: 'Chrome on Linux'),
      DeviceSession(
        id: 'phone',
        current: false,
        device: 'Safari on iPhone',
        lastActiveAt: DateTime.utc(2026, 9, 30),
      ),
    ];
    testWidgets('light, kPhone', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: ListView(
              children: <Widget>[
                DevicesSection(
                  load: () async => Result<List<DeviceSession>>.ok(two),
                  revoke: (String id) async => const Result<void>.ok(null),
                ),
              ],
            ),
          ),
          brightness: Brightness.light,
        );
        // The list is read on demand (review of #1129, finding 4).
        await tester.tap(find.byKey(DevicesSection.show));
        await tester.pumpAndSettle();
        expectSweepHadSubjects(tester, 'devices', tappable: 1, labelled: 4);
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
          Scaffold(
            body: ListView(
              children: <Widget>[
                DevicesSection(
                  load: () async => Result<List<DeviceSession>>.ok(two),
                  revoke: (String id) async => const Result<void>.ok(null),
                ),
              ],
            ),
          ),
          brightness: Brightness.dark,
        );
        // The list is read on demand (review of #1129, finding 4).
        await tester.tap(find.byKey(DevicesSection.show));
        await tester.pumpAndSettle();
        expectSweepHadSubjects(tester, 'devices', tappable: 1, labelled: 4);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    }, variant: kTapTargetPlatforms);
  });
}

void _noop() {}

void _noopBool(bool _) {}

/// The app's row widget as [helpCard] takes it — a ListTile here.
class _HelpRow extends StatelessWidget {
  const _HelpRow({
    super.key,
    required this.icon,
    required this.label,
    required this.last,
    this.subtitle,
    this.onTap,
  });

  final String icon;
  final String label;
  final bool last;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => ListTile(
    title: Text(label),
    subtitle: subtitle == null ? null : Text(subtitle!),
    onTap: onTap,
  );
}
