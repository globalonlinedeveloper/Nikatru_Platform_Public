// ─────────────────────────────────────────────────────────────────────────────
// T20 · HO-08 — swipe a row, or select several, and act on them with ONE Undo.
//
// 🔴 THE RED CONTROL: selecting three and deleting offers exactly one Undo, and
// that one Undo restores all three. Before this train there was no selection
// at all (no long press, no checkbox, no bulk action), so the first `longPress`
// below found nothing to enter and the case failed at its first expectation.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/home_fixture.dart';
import 'support/st_polish_harness.dart';
import 'support/width_harness.dart' show defaultWidthOverrides;

/// [name]'s row in the "All subscriptions" group — a row also listed under
/// "Upcoming renewals" is there twice.
Finder _inAll(String name) => find.descendant(
  of: find.byKey(HomeScreen.allKey),
  matching: find.text(name),
);

Set<String> _names(ProviderContainer c) => <String>{
  for (final Subscription s in listOf(c)) s.name,
};

void main() {
  testWidgets(
    '🔴 selecting 3 and deleting offers ONE Undo that restores all 3',
    (WidgetTester tester) async {
      final ProviderContainer c = await pumpPolish(tester, const HomeScreen());
      final AppLocalizations l10n = l10nOf(tester);
      final Set<String> before = _names(c);
      expect(before, containsAll(<String>['Netflix', 'Spotify', 'City Gym']));

      // A long press enters the selection with that row picked; taps add more.
      await tester.longPress(_inAll('Netflix'));
      await settle(tester);
      expect(
        find.byKey(HomeScreen.selectionBarKey),
        findsOneWidget,
        reason: 'a long press on a row must open the selection',
      );
      await tester.tap(_inAll('Spotify'));
      await tester.tap(_inAll('City Gym'));
      await settle(tester);
      expect(find.text(l10n.selectedCount(3)), findsOneWidget);

      await tester.tap(find.byKey(HomeScreen.bulkDeleteKey));
      await settle(tester);

      expect(
        _names(c),
        before.difference(<String>{'Netflix', 'Spotify', 'City Gym'}),
        reason: 'the three picked rows leave the list, and only they do',
      );
      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.text(l10n.bulkDeleted(3)), findsOneWidget);
      final Finder undo = find.widgetWithText(SnackBarAction, l10n.undo);
      expect(undo, findsOneWidget, reason: 'ONE Undo for the whole selection');
      expect(
        find.byKey(HomeScreen.selectionBarKey),
        findsNothing,
        reason: 'acting on the selection leaves it',
      );

      await tester.tap(undo);
      await settle(tester);
      expect(_names(c), before, reason: 'the one Undo brings all three back');
    },
  );

  testWidgets('bulk pause and mark-cancelled each have one Undo that restores '
      'every row to the status it HAD', (WidgetTester tester) async {
    final List<Subscription> rows = <Subscription>[
      ...homeFixture(),
      Subscription(
        id: 'trial',
        name: 'Trial Box',
        category: 'Other',
        price: const Money(500, 'USD'),
        cycle: BillingCycle.monthly,
        nextRenewal: kHomeFixtureNow.add(const Duration(days: 20)),
        status: SubscriptionStatus.trialing,
        trialEndsOn: kHomeFixtureNow.add(const Duration(days: 20)),
      ),
    ];
    final ProviderContainer c = await pumpPolish(
      tester,
      const HomeScreen(),
      rows: rows,
    );
    final AppLocalizations l10n = l10nOf(tester);
    SubscriptionStatus statusOf(String id) =>
        listOf(c).firstWhere((Subscription s) => s.id == id).status;

    await tester.longPress(_inAll('Trial Box'));
    await tester.tap(_inAll('Netflix'));
    await settle(tester);
    await tester.tap(find.byKey(HomeScreen.bulkPauseKey));
    await settle(tester);
    expect(statusOf('trial'), SubscriptionStatus.paused);
    expect(statusOf('nfx'), SubscriptionStatus.paused);
    expect(find.text(l10n.bulkPaused(2)), findsOneWidget);
    await tester.tap(find.widgetWithText(SnackBarAction, l10n.undo));
    await settle(tester);
    expect(
      statusOf('trial'),
      SubscriptionStatus.trialing,
      reason: 'Undo restores the trial, not "active" — that would end it',
    );
    expect(statusOf('nfx'), SubscriptionStatus.active);

    await tester.longPress(_inAll('Spotify'));
    await settle(tester);
    await tester.tap(find.byKey(HomeScreen.bulkCancelKey));
    await settle(tester);
    expect(statusOf('spt'), SubscriptionStatus.cancelled);
    await tester.tap(find.widgetWithText(SnackBarAction, l10n.undo));
    await settle(tester);
    expect(statusOf('spt'), SubscriptionStatus.active);
    expect(
      listOf(c).firstWhere((Subscription s) => s.id == 'spt').cancelledOn,
      isNull,
    );
  });

  testWidgets(
    'Export hands the PICKED rows, and only those, to the export seam',
    (WidgetTester tester) async {
      final KeepingExporter exporter = KeepingExporter();
      await pumpPolish(
        tester,
        const HomeScreen(),
        overrides: <Override>[fileExporterProvider.overrideWithValue(exporter)],
      );
      await tester.longPress(_inAll('Netflix'));
      await tester.tap(_inAll('City Gym'));
      await settle(tester);
      await tester.tap(find.byKey(HomeScreen.bulkExportKey));
      await settle(tester);
      expect(exporter.files, hasLength(1));
      final String csv = String.fromCharCodes(exporter.files.single.bytes);
      expect(csv, contains('Netflix'));
      expect(csv, contains('City Gym'));
      expect(csv, isNot(contains('Spotify')));
    },
  );

  testWidgets('a touch swipe towards the start deletes, with an Undo; towards '
      'the end pauses and the row stays', (WidgetTester tester) async {
    final ProviderContainer c = await pumpPolish(tester, const HomeScreen());
    final AppLocalizations l10n = l10nOf(tester);
    expect(
      find.byKey(HomeScreen.swipeKeyOf('icl')),
      findsOneWidget,
      reason: 'rows swipe on a touch platform (the test default is Android)',
    );

    await tester.drag(
      find.byKey(HomeScreen.swipeKeyOf('icl')),
      const Offset(-500, 0),
    );
    await settle(tester);
    expect(_names(c), isNot(contains('iCloud+')));
    expect(find.text(l10n.subscriptionDeleted('iCloud+')), findsOneWidget);
    await tester.tap(find.widgetWithText(SnackBarAction, l10n.undo));
    await settle(tester);
    expect(_names(c), contains('iCloud+'));

    await tester.drag(
      find.byKey(HomeScreen.swipeKeyOf('spt')),
      const Offset(500, 0),
    );
    await settle(tester);
    expect(
      listOf(c).firstWhere((Subscription s) => s.id == 'spt').status,
      SubscriptionStatus.paused,
    );
    expect(_inAll('Spotify'), findsOneWidget, reason: 'a paused row stays');
  });

  testWidgets('on a desktop pointer: no swipe, a visible Select, and a '
      'checkbox per row', (WidgetTester tester) async {
    await pumpPolish(tester, const HomeScreen(), size: const Size(800, 2400));
    expect(find.byKey(HomeScreen.swipeKeyOf('icl')), findsNothing);
    expect(find.byType(Checkbox), findsNothing);
    await tester.tap(find.byKey(HomeScreen.selectKey));
    await settle(tester);
    expect(find.byKey(HomeScreen.pickKeyOf('icl')), findsWidgets);
    await tester.tap(find.byKey(HomeScreen.pickKeyOf('icl')).last);
    await settle(tester);
    final AppLocalizations l10n = l10nOf(tester);
    expect(find.text(l10n.selectedCount(1)), findsOneWidget);
    await tester.tap(find.byKey(HomeScreen.selectDoneKey));
    await settle(tester);
    expect(find.byKey(HomeScreen.selectionBarKey), findsNothing);
  }, variant: TargetPlatformVariant.only(TargetPlatform.windows));

  test(
    'the controller: deleteMany + undoDeleteMany are one round trip',
    () async {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...defaultWidthOverrides(),
          subscriptionRepositoryProvider.overrideWithValue(
            SubscriptionRepository(seededWith(homeFixture())),
          ),
        ],
      );
      addTearDown(c.dispose);
      await c.read(subscriptionsControllerProvider.future);
      final SubscriptionsController ctl = c.read(
        subscriptionsControllerProvider.notifier,
      );
      final int n = listOf(c).length;
      final List<Subscription> removed = await ctl.deleteMany(<String>[
        'nfx',
        'spt',
        'gym',
      ]);
      expect(removed.map((Subscription s) => s.id), <String>[
        'nfx',
        'spt',
        'gym',
      ]);
      expect(listOf(c), hasLength(n - 3));
      await ctl.undoDeleteMany(removed.map((Subscription s) => s.id));
      expect(listOf(c), hasLength(n));
    },
  );
}
