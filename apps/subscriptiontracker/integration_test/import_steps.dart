// IM-07 — THE NIGHTLY WALKS THE IMPORT HUB, NOT A TIMER.
//
// Two legs, both through the deployed Workers and both READ BACK from them:
//   · importCsvAndReadBack — the add sheet's "Import instead", a 3-row CSV
//     pasted, the mapping step, the review, Add; then the list is re-fetched
//     from the server and all three rows must be in it.
//   · restoreBackupAndReadBack — a backup of those three rows, one of them
//     deleted, the backup handed to the hub the way a share or a drop hands
//     it (the import inbox), Restore; re-fetched, all three are back.
// Both remove what they added, so a reused e2e user does not accumulate rows.

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/portability/subscription_columns.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

typedef PumpFor = Future<void> Function(WidgetTester tester, Duration total);

ProviderContainer _container(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(HomeScreen).first));

/// The list as the SERVER has it now: the controller is invalidated and
/// re-fetched, so a row that only exists in local state does not count.
Future<List<Subscription>> _refetch(
  WidgetTester tester,
  PumpFor pumpFor,
) async {
  final ProviderContainer c = _container(tester);
  c.invalidate(subscriptionsControllerProvider);
  await pumpFor(tester, const Duration(seconds: 4));
  return c.read(subscriptionsControllerProvider.future);
}

/// The three names this run imports, unique to it.
List<String> importNames(String stamp) => <String>[
  'E2E Import A $stamp',
  'E2E Import B $stamp',
  'E2E Import C $stamp',
];

Future<void> importCsvAndReadBack(
  WidgetTester tester, {
  required String stamp,
  required PumpFor pumpFor,
  required String Function(WidgetTester tester) onScreen,
}) async {
  final List<String> names = importNames(stamp);
  final String csv =
      'name,price,currency,cycle\n'
      '${names[0]},1.11,USD,monthly\n'
      '${names[1]},2.22,USD,monthly\n'
      '${names[2]},3.33,USD,yearly\n';

  await tester.tap(find.byKey(E2EKeys.fabAdd));
  await pumpFor(tester, const Duration(seconds: 2));
  await tester.tap(find.byKey(E2EKeys.addImportInstead));
  await pumpFor(tester, const Duration(seconds: 2));
  expect(
    find.byType(ImportScreen),
    findsOneWidget,
    reason:
        '"Import instead" did not open /import. On screen: ${onScreen(tester)}',
  );

  await tester.enterText(find.byKey(E2EKeys.importPaste), csv);
  await pumpFor(tester, const Duration(milliseconds: 500));
  await tester.tap(find.byKey(E2EKeys.importRead));
  await pumpFor(tester, const Duration(seconds: 2));
  expect(
    find.byKey(E2EKeys.importContinue),
    findsOneWidget,
    reason:
        'the pasted CSV did not reach the mapping step. On screen: ${onScreen(tester)}',
  );
  await tester.tap(find.byKey(E2EKeys.importContinue));
  // The duplicate check reads the list from the Worker.
  await pumpFor(tester, const Duration(seconds: 6));
  for (final String n in names) {
    expect(
      find.text(n),
      findsOneWidget,
      reason: '$n is not on the review list. On screen: ${onScreen(tester)}',
    );
  }
  await tester.ensureVisible(find.byKey(E2EKeys.importAdd));
  await tester.tap(find.byKey(E2EKeys.importAdd));
  // Three POSTs through the add route.
  await pumpFor(tester, const Duration(seconds: 12));
  expect(
    find.byType(ImportScreen),
    findsNothing,
    reason: 'the hub did not close after Add. On screen: ${onScreen(tester)}',
  );

  final Set<String> server = (await _refetch(
    tester,
    pumpFor,
  )).map((Subscription s) => s.name).toSet();
  expect(
    server,
    containsAll(names),
    reason: 'imported rows were not read back from the server',
  );
}

Future<void> restoreBackupAndReadBack(
  WidgetTester tester, {
  required String stamp,
  required PumpFor pumpFor,
  required String Function(WidgetTester tester) onScreen,
}) async {
  final List<String> names = importNames(stamp);
  final ProviderContainer c = _container(tester);
  final List<Subscription> mine = (await c.read(
    subscriptionsControllerProvider.future,
  )).where((Subscription s) => names.contains(s.name)).toList();
  expect(mine, hasLength(3), reason: 'the import leg left 3 rows to back up');
  final String backup = utf8.decode(
    subscriptionsBackupFile(mine, now: DateTime.now().toUtc()).bytes,
  );

  // One of the three is deleted after the backup was taken.
  await c
      .read(subscriptionsControllerProvider.notifier)
      .cancelSubscription(mine.first.id);
  await pumpFor(tester, const Duration(seconds: 4));

  // Handed over the way a share or a drop hands it: the import inbox, which
  // the router's share bridge fills and the hub takes on arrival.
  c
      .read(importInboxProvider.notifier)
      .deliver(core.ImportedFile(name: 'backup.json', text: backup));
  GoRouter.of(tester.element(find.byType(Scaffold).first)).push('/import');
  await pumpFor(tester, const Duration(seconds: 6));
  expect(
    find.byKey(E2EKeys.restoreConfirm),
    findsOneWidget,
    reason:
        'the backup did not reach the restore preview. On screen: ${onScreen(tester)}',
  );
  await tester.tap(find.byKey(E2EKeys.restoreConfirm));
  await pumpFor(tester, const Duration(seconds: 10));

  final List<Subscription> server = await _refetch(tester, pumpFor);
  expect(
    server.map((Subscription s) => s.name).toSet(),
    containsAll(names),
    reason: 'the restore did not bring the deleted row back',
  );

  // Leave the e2e user as it was found.
  for (final Subscription s in server.where(
    (Subscription s) => names.contains(s.name),
  )) {
    await c
        .read(subscriptionsControllerProvider.notifier)
        .cancelSubscription(s.id);
  }
  await pumpFor(tester, const Duration(seconds: 4));
}
