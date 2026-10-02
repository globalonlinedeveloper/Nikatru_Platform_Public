// ─────────────────────────────────────────────────────────────────────────────
// T20 · AD-10 — Detail › More options › Duplicate opens the add sheet
// prefilled from the row, named "<name> (2)".
//
// 🔴 THE RED CONTROL: the duplicate saves as a NEW row and the original is
// untouched. Before this train the overflow had no Duplicate, so the tile
// below did not exist and the case failed at its first expectation.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';

import 'support/home_fixture.dart';
import 'support/st_polish_harness.dart';

void main() {
  testWidgets('🔴 Duplicate saves a NEW row "<name> (2)"; the original is '
      'untouched', (WidgetTester tester) async {
    final List<Subscription> rows = <Subscription>[
      for (final Subscription s in homeFixture())
        s.id == 'nfx'
            ? s.copyWith(
                plan: 'Premium',
                notes: 'family plan',
                tags: <String>['family'],
              )
            : s,
    ];
    final ProviderContainer c = await pumpPolish(
      tester,
      const SubscriptionDetailScreen(id: 'nfx'),
      rows: rows,
      size: const Size(400, 1400),
    );
    final Subscription original = listOf(
      c,
    ).firstWhere((Subscription s) => s.id == 'nfx');
    final Map<String, dynamic> before = original.toJson();
    final int n = listOf(c).length;

    await tester.tap(find.byKey(E2EKeys.detailMoreOptions));
    await settle(tester);
    final Finder duplicate = find.byKey(const Key('detail-duplicate'));
    expect(duplicate, findsOneWidget, reason: 'More options offers Duplicate');
    await tester.tap(duplicate);
    await settle(tester);

    expect(
      find.widgetWithText(TextField, 'Netflix (2)'),
      findsOneWidget,
      reason: 'the copy is told apart from its original by its name',
    );
    expect(find.widgetWithText(TextField, 'Premium'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'family'), findsOneWidget);
    await tester.ensureVisible(find.byKey(E2EKeys.addSubmit));
    await settle(tester);
    await tester.tap(find.byKey(E2EKeys.addSubmit));
    await settle(tester);

    final List<Subscription> after = listOf(c);
    expect(after, hasLength(n + 1), reason: 'a NEW row, not an edit');
    final Subscription copy = after.firstWhere(
      (Subscription s) => s.name == 'Netflix (2)',
    );
    expect(copy.id, isNot('nfx'));
    expect(copy.price, original.price);
    expect(copy.cycle, original.cycle);
    expect(copy.category, original.category);
    expect(copy.plan, 'Premium');
    expect(copy.notes, 'family plan');
    expect(copy.tags, <String>['family']);
    expect(
      after.firstWhere((Subscription s) => s.id == 'nfx').toJson(),
      before,
      reason: 'the original is exactly as it was',
    );
  });
}
