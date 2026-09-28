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
//   · B11 — the demo client created every new row with `usedPct: 50` and
//     `usageNote: 'Just added.'`: fabricated usage for a plan added a second ago.
//
// RED CONTROLS: put the `_iconButton(Icons.more_horiz, …)` back; pass
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
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

/// The [FocusableTap] whose subtree carries the text [label] — the row or
/// button a user would tap.
Finder _tapFor(String label) => find
    .ancestor(of: find.text(label), matching: find.byType(FocusableTap))
    .first;

void main() {
  testWidgets(
    'B14 · the detail hero has no "More options" that opens nothing',
    (WidgetTester tester) async {
      final SemanticsHandle semantics = tester.ensureSemantics();
      await pumpAt(tester, kPhone, const SubscriptionDetailScreen(id: '1'));
      expect(find.byIcon(Icons.more_horiz), findsNothing);
      expect(find.bySemanticsLabel('More options'), findsNothing);
      // The real exit is still there.
      expect(find.bySemanticsLabel((await _en()).back), findsOneWidget);
      semantics.dispose();
    },
  );

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

  testWidgets('D6/D2 · an inert settings row draws no chevron and says why', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, const SettingsScreen());
    final AppLocalizations l10n = await _en();
    for (final String inert in <String>[
      l10n.connectedAccounts,
      l10n.exportDataCsv,
    ]) {
      await tester.scrollUntilVisible(find.text(inert), 200);
      final Finder row = _tapFor(inert);
      expect(tester.widget<FocusableTap>(row).onTap, isNull, reason: inert);
      expect(
        find.descendant(of: row, matching: find.byIcon(Icons.chevron_right)),
        findsNothing,
        reason: '"$inert" does nothing when tapped and still says "tap me"',
      );
      expect(
        find.descendant(
          of: row,
          matching: find.text(l10n.settingsNotAvailableYet),
        ),
        findsOneWidget,
      );
    }
    // A row that DOES go somewhere keeps its chevron: the rule is "only where
    // a tap leads", not "never".
    await tester.scrollUntilVisible(find.text(l10n.helpAndSupport), 200);
    expect(
      find.descendant(
        of: _tapFor(l10n.helpAndSupport),
        matching: find.byIcon(Icons.chevron_right),
      ),
      findsOneWidget,
    );
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
