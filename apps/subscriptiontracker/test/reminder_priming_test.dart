// 🔴 THE OS PERMISSION PROMPT IS SPENT ONLY AFTER A PRIMED YES — train ST-D8.
//
// The OS prompt can be shown ONCE on most platforms, so an un-primed ask costs
// the feature for good. Subly reached `requestPermissions()` from exactly two
// places, and both spent it with nothing on screen saying why:
//
//   · the reminder switches in Settings (`SettingsController.toggle`), and
//   · the first subscription added (`SubscriptionsController.addSubscription`,
//     because `alerts` defaults ON and most users never open Settings).
//
// Both now go through the design system's `showPermissionPriming`. These
// cases COUNT the OS asks, so each "spends nothing" is an equality on a number
// that the "spends once" case beside it proves can move.
//
// MUTATION PROOF (run and recorded with the draft): make `primeThenToggle` in
// lib/features/shared/priming.dart skip the priming (its `if (!on && …)` limb
// `false`) and the settings cases go red (the priming view is never found);
// make the
// `primeReminders != null && await primeReminders()` limb in
// subscriptions_controller.dart `true` and the "Not now" and "no primer" cases
// go red on the ask count.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart';

/// A silent service on a scheduling platform that COUNTS the OS asks.
class _CountingNotifications extends NotificationService {
  _CountingNotifications() : super.forTesting(platform: TargetPlatform.android);

  int asks = 0;

  @override
  Future<bool> requestPermissions() async {
    asks++;
    return true;
  }

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {}
  @override
  Future<void> cancelOwnedRenewals() async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

/// Tall enough that every settings row is built, not merely laid out.
const Size _tall = Size(800, 9000);

/// The switch for one preference row, found by the name it announces.
Finder _switchFor(String label) =>
    find.byWidgetPredicate((Widget w) => w is FocusableTap && w.label == label);

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

/// An empty account, so the next add is the empty→first transition.
class _EmptyRepository implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => const <Subscription>[];

  @override
  Future<Subscription> add(Subscription draft) async => Subscription(
    id: 'created',
    name: draft.name,
    category: draft.category,
    price: draft.price,
    cycle: draft.cycle,
    nextRenewal: draft.nextRenewal,
  );

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

Subscription _draft() => Subscription(
  id: '',
  name: 'Hulu',
  category: 'Other',
  price: const Money(999, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 1),
);

void main() {
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));

  group('settings: a reminder switch primes before it asks', () {
    late _CountingNotifications svc;

    Future<ProviderContainer> pump(WidgetTester tester) async {
      svc = _CountingNotifications();
      await pumpAt(
        tester,
        _tall,
        const SettingsScreen(),
        overrides: <Override>[
          subscriptiontrackerNotificationServiceProvider.overrideWithValue(svc),
        ],
      );
      return ProviderScope.containerOf(
        tester.element(find.byType(SettingsScreen)),
      );
    }

    bool prefOf(ProviderContainer c, String key) =>
        c.read(settingsControllerProvider).prefs[key] ?? false;

    testWidgets('"Not now" leaves the switch OFF and spends nothing', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await pump(tester);
      expect(prefOf(c, 'weekly'), isFalse);

      await tester.tap(_switchFor(en.prefWeeklyDigest));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsOneWidget);
      // The priming names what THIS row does.
      expect(
        find.descendant(
          of: find.byType(PermissionPrimingView),
          matching: find.text(en.prefWeeklyDigestDesc),
        ),
        findsOneWidget,
      );

      await tester.tap(find.byKey(PermissionPrimingView.notNowButton));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(prefOf(c, 'weekly'), isFalse);
      expect(svc.asks, 0);
    });

    testWidgets('"Continue" turns the switch ON and asks the OS once', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await pump(tester);
      await tester.tap(_switchFor(en.prefWeeklyDigest));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(PermissionPrimingView.allowButton));
      await tester.pumpAndSettle();
      expect(prefOf(c, 'weekly'), isTrue);
      expect(svc.asks, 1);
    });

    testWidgets('turning a reminder OFF never primes and never asks', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await pump(tester);
      expect(prefOf(c, 'alerts'), isTrue);
      await tester.tap(_switchFor(en.prefRenewalAlerts));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(prefOf(c, 'alerts'), isFalse);
      expect(svc.asks, 0);

      // …and back ON is an ask, so it is primed.
      await tester.tap(_switchFor(en.prefRenewalAlerts));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsOneWidget);
    });

    testWidgets('no OS prompt on this platform: the switch flips, nothing is '
        'primed', (WidgetTester tester) async {
      final ProviderContainer c = await pump(tester);
      await tester.tap(_switchFor(en.prefWeeklyDigest));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(prefOf(c, 'weekly'), isTrue);
    }, variant: TargetPlatformVariant.only(TargetPlatform.linux));

    testWidgets('the in-app "unused" row is not a notification: no priming', (
      WidgetTester tester,
    ) async {
      final ProviderContainer c = await pump(tester);
      final bool before = prefOf(c, 'unused');
      await tester.tap(_switchFor(en.prefUnusedPlans));
      await tester.pumpAndSettle();
      expect(find.byType(PermissionPrimingView), findsNothing);
      expect(prefOf(c, 'unused'), !before);
      expect(svc.asks, 0);
    });
  });

  group('first add: the ask is primed', () {
    ({ProviderContainer c, _CountingNotifications svc}) harness() {
      final _CountingNotifications svc = _CountingNotifications();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
          subscriptionRepositoryProvider.overrideWithValue(_EmptyRepository()),
          subscriptiontrackerNotificationServiceProvider.overrideWithValue(svc),
        ],
      );
      addTearDown(c.dispose);
      return (c: c, svc: svc);
    }

    Future<int> firstAdd({Future<bool> Function()? prime}) async {
      final ({ProviderContainer c, _CountingNotifications svc}) h = harness();
      await h.c.read(subscriptionsControllerProvider.future);
      await h.c
          .read(subscriptionsControllerProvider.notifier)
          .addSubscription(_draft(), primeReminders: prime);
      return h.svc.asks;
    }

    test('a primed yes asks the OS once', () async {
      expect(await firstAdd(prime: () async => true), 1);
    });

    test('"Not now" spends nothing', () async {
      expect(await firstAdd(prime: () async => false), 0);
    });

    test('no primer, no ask — never an un-primed prompt', () async {
      expect(await firstAdd(), 0);
    });

    test('the primer is asked ONLY on the empty→first transition', () async {
      final ({ProviderContainer c, _CountingNotifications svc}) h = harness();
      int primed = 0;
      Future<bool> prime() async {
        primed++;
        return true;
      }

      await h.c.read(subscriptionsControllerProvider.future);
      final SubscriptionsController ctl = h.c.read(
        subscriptionsControllerProvider.notifier,
      );
      await ctl.addSubscription(_draft(), primeReminders: prime);
      await ctl.addSubscription(_draft(), primeReminders: prime);
      expect(primed, 1);
      expect(h.svc.asks, 1);
    });
  });

  test('the controller and the screen agree on which rows are asks', () {
    expect(SettingsController.isReminderBearing('alerts'), isTrue);
    expect(SettingsController.isReminderBearing('weekly'), isTrue);
    expect(SettingsController.isReminderBearing('unused'), isFalse);
  });
}
