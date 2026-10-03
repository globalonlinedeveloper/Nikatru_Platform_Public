// ─────────────────────────────────────────────────────────────────────────────
// ST-U5 — DEAD CONTROLS: NOTHING LOOKS ACTIONABLE THAT DOES NOTHING.
//
// Four the audit measured (Private/research/session-2026-09-23/full-review-r2/
// product-audit-st.md §7.2):
//   · B14 — detail's "More options" (⋯) was focusable, announced as a button,
//     and opened nothing.
//   · B6  — home's notification bell carried an unread dot that was ALWAYS on.
//   · D6/D2 — "Connected accounts" and "Export data (CSV)" are inert rows that
//     drew the same chevron as every row that goes somewhere.
//     ⏱ 2026-10-01 · SE-04: "Connected accounts" is WIRED too (the linked
//     sign-in methods sheet), so no inert row is left on Settings.
//     ⏱ 2026-09-28 · ST-X1 (audit D2/D31): "Export data (CSV)" is WIRED — it
//     saves a real file (settings_export_test.dart) — so it moved from the
//     inert list to the rows that keep their chevron.
//   · B11 — the demo client created every new row with `usedPct: 50` and
//     `usageNote: 'Just added.'`: fabricated usage for a plan added a second ago.
//
// ⏱ 2026-09-28 · ST-T3b (ST-E3): "More options" is BACK, with the row's
// lifecycle menu behind it, so B14 now asserts the control DOES something.
//
// RED CONTROLS: make `more_horiz`'s callback a no-op again; pass
// `dot: true` again; draw the chevron unconditionally; restore `usedPct: 50`.
// Each turns its own case red.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show FocusableTap;
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';

import 'support/width_harness.dart';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// The [FocusableTap] whose subtree carries the text [label] — the row or
/// button a user would tap.
Finder _tapFor(String label) => find
    .ancestor(of: find.text(label), matching: find.byType(FocusableTap))
    .first;

void main() {
  testWidgets('B14 · the detail hero "More options" opens the lifecycle menu', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle semantics = tester.ensureSemantics();
    await pumpAt(tester, kPhone, const SubscriptionDetailScreen(id: '1'));
    final AppLocalizations l10n = await _en();
    expect(find.bySemanticsLabel(l10n.moreOptions), findsOneWidget);
    // The real exit is still there.
    expect(find.bySemanticsLabel(l10n.back), findsOneWidget);
    await tester.tap(find.byIcon(Icons.more_horiz));
    await tester.pumpAndSettle();
    expect(find.text(l10n.actionPause), findsOneWidget);
    expect(find.text(l10n.actionMarkCancelled), findsOneWidget);
    expect(find.text(l10n.actionDeleteFromTracker), findsOneWidget);
    semantics.dispose();
  });

  testWidgets('B6 · the notification bell carries no always-on unread dot', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, const HomeScreen());
    final AppLocalizations l10n = await _en();
    final Finder bell = find.byWidgetPredicate(
      (Widget w) => w is FocusableTap && w.label == l10n.notifications,
    );
    expect(bell, findsOneWidget);
    expect(
      find.descendant(of: bell, matching: find.byType(Positioned)),
      findsNothing,
      reason:
          'a badge that is always on says "something new" and means nothing',
    );
  });

  // ⏱ 2026-10-01 · SE-04: "Connected accounts" is WIRED — it opens the
  // linked sign-in methods sheet (connected_accounts_sheet_test.dart) and moved
  // to the signed-in account rows — so the last inert row is gone, and "Not
  // available yet" is drawn nowhere on this screen. The inert-row rendering itself is
  // still asserted in the design system's `FocusableTap` tests.
  testWidgets('D6/D2 · every settings row that goes somewhere says so', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, const SettingsScreen());
    final AppLocalizations l10n = await _en();
    // A row that DOES go somewhere keeps its chevron: the rule is "only where
    // a tap leads", not "never". The export row is one since ST-X1.
    // "Connected accounts" is an account row (AccountSecurityRows), drawn for
    // a signed-in account only; settings_account_test.dart taps it (SE-04).
    for (final String live in <String>[
      l10n.exportDataCsv,
      l10n.helpAndSupport,
    ]) {
      await tester.scrollUntilVisible(find.text(live), 200);
      expect(tester.widget<FocusableTap>(_tapFor(live)).onTap, isNotNull);
      expect(
        find.descendant(
          of: _tapFor(live),
          matching: find.byIcon(Icons.chevron_right),
        ),
        findsOneWidget,
        reason: live,
      );
    }
  });

  test(
    'B11 · a row the demo client creates carries no fabricated usage',
    () async {
      final Subscription created = await SeedApiClient().createSubscription(
        Subscription(
          id: '',
          name: 'Figma',
          category: 'Design',
          price: const Money(1500, 'USD'),
          cycle: BillingCycle.monthly,
          nextRenewal: DateTime.utc(2026, 10, 1),
        ),
      );
      expect(created.usedPct, 0);
      expect(created.usageNote, isEmpty);
    },
  );
}
