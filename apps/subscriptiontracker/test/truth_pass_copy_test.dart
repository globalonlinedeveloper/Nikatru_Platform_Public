// ─────────────────────────────────────────────────────────────────────────────
// ST-U3 — COPY TRUTH: A FIRST-RUN SENTENCE SAYS ONLY WHAT THIS PLATFORM DOES.
//
// Two surfaces the audit measured making claims the product cannot keep
// (Private/research/session-2026-09-23/full-review-r2/product-audit-st.md):
//   · B44 — /scan's busy CTA read "Scanning…" and its ring announced "Scan
//     progress", and nothing is scanned: the screen loads the list. (ADR 077
//     §2.2 retired /scan; its successor, the import hub, is held to the same
//     sentence: nothing on it claims a scan.)
//   · C30 — onboarding slide 2 promised "A reminder arrives before each
//     renewal" on web, Windows and Linux, where NotificationCapabilities says
//     canSchedule: false; slide 3 promised a "mark unused" control that exists
//     nowhere.
// The remove sheet (B32) is asserted in dark_group_sheets_test.dart and
// monthly_share_display_test.dart, beside the cases it replaced.
//
// RED CONTROLS: put "scan" into any `import*` string the hub renders and the
// first group is red; make `_slides` ignore
// `canSchedule` and the linux/windows cases are red; restore the old slide-3
// body and the last case is red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/features/onboarding/onboarding_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';

import 'support/width_harness.dart';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// Every string a sighted user can read, from plain and rich `Text` alike.
List<String> _visible(WidgetTester tester) => <String>[
  for (final Text t in tester.widgetList<Text>(find.byType(Text)))
    t.data ?? t.textSpan?.toPlainText() ?? '',
];

Future<void> _toSlide(WidgetTester tester, int index) async {
  final AppLocalizations l10n = await _en();
  for (int i = 0; i < index; i++) {
    await tester.tap(find.text(l10n.onboardingNext));
    await tester.pumpAndSettle();
  }
}

void main() {
  group('import · nothing claims a scan (B44)', () {
    testWidgets('the hub says what it does, in text and in speech', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await pumpAt(tester, kPhone, const ImportScreen());
      final AppLocalizations l10n = await _en();

      // The hub is on screen: its own sentence is the key under test.
      expect(find.text(l10n.importSubtitle), findsOneWidget);
      for (final String s in _visible(tester)) {
        expect(s.toLowerCase(), isNot(contains('scan')), reason: s);
      }
      expect(
        find.bySemanticsLabel(RegExp('scan', caseSensitive: false)),
        findsNothing,
        reason: 'a screen reader still hears a scan that does not happen',
      );
      semantics.dispose();
    });
  });

  group('onboarding · slide 2 follows canSchedule (C30)', () {
    testWidgets('no reminder is promised where none can be scheduled', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      await _toSlide(tester, 1);
      final AppLocalizations l10n = await _en();

      expect(
        find.text(l10n.subscriptiontrackerOnboarding2BodyNoReminders),
        findsOneWidget,
      );
      expect(
        find.text(l10n.subscriptiontrackerOnboarding2Body),
        findsNothing,
        reason:
            '${debugDefaultTargetPlatformOverride?.name} cannot schedule a '
            'reminder, and slide 2 still promises one',
      );
      // ⏱ 2026-10-01 (NO-04): Fuchsia, not Linux — Linux schedules now
      // (packages/notifications' ledger), and web is out of a variant's reach.
    }, variant: TargetPlatformVariant.only(TargetPlatform.fuchsia));

    testWidgets('linux can now (NO-04), and keeps the reminder sentence', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      await _toSlide(tester, 1);
      final AppLocalizations l10n = await _en();
      expect(
        find.text(l10n.subscriptiontrackerOnboarding2Body),
        findsOneWidget,
      );
    }, variant: TargetPlatformVariant.only(TargetPlatform.linux));

    // ⏱ 2026-09-28 (ST-R4): Windows schedules now — the app carries its toast
    // identity — so slide 2 keeps its promise there. The logic did not move:
    // it follows canSchedule, and canSchedule is what changed.
    testWidgets('windows can now, and keeps the reminder sentence', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      await _toSlide(tester, 1);
      final AppLocalizations l10n = await _en();
      expect(
        find.text(l10n.subscriptiontrackerOnboarding2Body),
        findsOneWidget,
      );
    }, variant: TargetPlatformVariant.only(TargetPlatform.windows));

    testWidgets('android can, and keeps the reminder sentence', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      await _toSlide(tester, 1);
      final AppLocalizations l10n = await _en();
      expect(
        find.text(l10n.subscriptiontrackerOnboarding2Body),
        findsOneWidget,
      );
    }, variant: TargetPlatformVariant.only(TargetPlatform.android));

    testWidgets('slide 3 promises no "mark unused" control', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const OnboardingScreen());
      await _toSlide(tester, 2);
      final AppLocalizations l10n = await _en();
      expect(
        find.text(l10n.subscriptiontrackerOnboarding3Body),
        findsOneWidget,
      );
      for (final String s in _visible(tester)) {
        expect(s.toLowerCase(), isNot(contains('unused')), reason: s);
      }
    });
  });
}
