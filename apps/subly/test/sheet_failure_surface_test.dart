import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/e2e_keys.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/features/add/add_subscription_sheet.dart';
import 'package:subly/features/cancel/cancel_sheet.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/providers.dart';

/// THE SHEETS HAD NO FAILURE PATH AT ALL.
///
/// `_save()` and `_confirm()` awaited a call that goes through the repository to
/// the network with no try/catch. One offline moment therefore threw out of an
/// unawaited future: the error surfaced nowhere, the busy flag was never
/// cleared, and the button sat disabled on 'Adding…' / 'Cancelling…' forever.
/// The user's only escape was to dismiss the sheet and start again.
///
/// Every existing sheet test drives the SUCCESS path, which is why nothing was
/// red. These drive the failure, and assert the three things the user needs: the
/// error does not escape, the control comes back, and they are told.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Reads fine, writes fail — the shape of being offline behind a cache.
class _WriteFailsRepository implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[];

  @override
  Future<Subscription> add(Subscription draft) async =>
      throw const SocketFailure();

  @override
  Future<void> cancel(String id) async => throw const SocketFailure();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

class SocketFailure implements Exception {
  const SocketFailure();
  @override
  String toString() => 'SocketException: Failed host lookup';
}

class _SilentNotifications extends NotificationService {
  _SilentNotifications() : super.forTesting();
  @override
  Future<void> syncAll(List<Subscription> subs, {int daysBefore = 2}) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

Widget _app(void Function(BuildContext) open) {
  return ProviderScope(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(_WriteFailsRepository()),
      sublyNotificationServiceProvider.overrideWithValue(
        _SilentNotifications(),
      ),
    ],
    // 🔴 THE DELEGATES ARE NOT DECORATION — WITHOUT THEM THIS HOST THROWS.
    // `l10n.yaml` sets `nullable-getter: false`, so the generated
    // `AppLocalizations.of(context)` ends in a null assertion: the first line of
    // either sheet's `build` that reads a string dies with a
    // `Null check operator used on a null value` the instant it mounts under a
    // bare `MaterialApp`. That failure looks nothing like a missing delegate —
    // it points at the sheet — which is why it is called out here rather than
    // left to be rediscovered.
    //
    // Nothing else in this file changed for l10n. Every assertion below still
    // reads the same English literal it did before the sheets moved to the arb,
    // and that is the point: the arb VALUES were minted from the shipped copy,
    // so this file is the review gate on that claim. A value that drifted would
    // show up here as a red line naming the string, not as a silent repaint.
    child: MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              onPressed: () => open(context),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
}

Subscription _sub() => Subscription(
  id: 'sub-1',
  name: 'Netflix',
  category: 'Streaming',
  price: 15,
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

void main() {
  testWidgets('add sheet: a failed save re-arms the button and says so', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app((BuildContext c) => showAddSubscriptionSheet(c)),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(E2EKeys.addName), 'Hulu');
    await tester.pumpAndSettle();

    final Finder submit = find.byKey(E2EKeys.addSubmit);
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    // `pump()` with no duration runs NO timers, and the SnackBar needs them.
    await tester.pumpAndSettle();

    // 1. The error did not escape as an unhandled async error.
    expect(tester.takeException(), isNull);
    // 2. The user is told.
    expect(find.byType(SnackBar), findsOneWidget);
    expect(
      find.textContaining('Could not add that subscription'),
      findsOneWidget,
    );
    // 3. The button is usable again and the typed draft survived, so a retry is
    //    one tap rather than a re-entry.
    expect(find.text('Adding…'), findsNothing);
    // Scoped to the button: the sheet's own title reads 'Add subscription' too.
    expect(
      find.descendant(of: submit, matching: find.text('Add subscription')),
      findsOneWidget,
    );
    // Scoped to the field: 'Hulu' is also one of the POPULAR tiles.
    expect(
      find.descendant(
        of: find.byKey(E2EKeys.addName),
        matching: find.text('Hulu'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('cancel sheet: a failed cancel never claims success', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      _app((BuildContext c) => showCancelSheet(c, _sub())),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Confirm cancel'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.textContaining('Could not cancel just now'), findsOneWidget);
    // 🔴 The confirmation step congratulates the user on savings. Showing it
    // after a failed cancel would be a lie the app tells about the user's money.
    expect(find.text('Cancelled'), findsNothing);
    expect(find.text('Cancelling…'), findsNothing);
    expect(find.text('Confirm cancel'), findsOneWidget);
  });
}
