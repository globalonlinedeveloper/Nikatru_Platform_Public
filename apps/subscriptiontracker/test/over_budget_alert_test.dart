// THE OVER-BUDGET ALERT — ST-I2 (audit C14).
//
// A budget became settable with ST-D3, and nothing anywhere in the app ever
// told anyone they had passed it outside the Insights card: the reminders seam
// carried renewals and the weekly digest only. Exceeding a set budget now arms
// ONE alert through the same seam, at the user's reminder time of day, and a
// tap opens Insights.
//
// MUTATION PROOF (run 2026-09-30 on this tree): delete the `_syncOverBudget`
// call from `_syncRemindersOrThrow` and "exceeding a set budget arms the
// alert" goes red on the missing id; drop the `minorUnits <= 0` guard and "no
// budget set is no alert" goes red.

import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/notification_tap_observer.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/recording_seam.dart';
import 'support/width_harness.dart' show MemStore;

final DateTime _morning = DateTime(2026, 10, 1, 8);

ReminderCopy _copy({bool withBudget = true}) => ReminderCopy(
  channelName: 'Renewal reminders',
  channelDescription: 'Alerts before a charge',
  reminderTitle: 'Renewal coming up',
  reminderBody: (String n, DateTime d) => '$n renews',
  digestTitle: 'Weekly',
  digestBody: (int c, String t) => '$c, $t',
  cancelByTitle: (DateTime d) => 'Cancel by',
  cancelByBody: (String n, DateTime d) => '$n by',
  overBudgetTitle: withBudget ? 'Over budget' : null,
  overBudgetBody: withBudget
      ? (String spent, String budget) => '$spent of $budget'
      : null,
);

BudgetInfo _budget(int minor) => BudgetInfo(
  monthlyBudget: Money(minor, 'USD'),
  categories: const <BudgetCap>[],
);

MoneyBag _spent(int minor) => MoneyBag.sum(<Money>[Money(minor, 'USD')]);

const MoneyFormatter _money = MoneyFormatter('en', emptyCurrencyCode: 'USD');

({RecordingSeam seam, RenewalReminders svc}) _build({
  TargetPlatform platform = TargetPlatform.android,
  bool isWeb = false,
  DateTime? now,
}) {
  final RecordingSeam seam = RecordingSeam();
  return (
    seam: seam,
    svc: RenewalReminders.forTesting(
      platform: platform,
      isWeb: isWeb,
      service: seam,
      now: () => now ?? _morning,
    ),
  );
}

List<Subscription> _subs(int minorEach, int n) => <Subscription>[
  for (int i = 0; i < n; i++)
    Subscription(
      id: 's$i',
      name: 'Plan $i',
      category: 'Other',
      price: Money(minorEach, 'USD'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime.now().add(Duration(days: 20 + i)),
    ),
];

class _Repo implements SubscriptionRepository {
  _Repo(this.subs, this.budgetInfo);
  final List<Subscription> subs;
  BudgetInfo budgetInfo;
  bool failBudget = false;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  Future<BudgetInfo> budget() async {
    if (failBudget) throw StateError('the network is down');
    return budgetInfo;
  }

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

void main() {
  group('RenewalReminders.plannedOverBudget', () {
    test('under the budget: no alert', () {
      final RenewalReminders svc = _build().svc;
      expect(
        svc.plannedOverBudget(
          budget: _budget(5000),
          spent: _spent(4999),
          copy: _copy(),
          rules: const ReminderRules(),
          money: _money,
        ),
        isNull,
      );
    });

    test('no budget set is no alert, however much is spent', () {
      final RenewalReminders svc = _build().svc;
      expect(
        svc.plannedOverBudget(
          budget: _budget(0),
          spent: _spent(99999),
          copy: _copy(),
          rules: const ReminderRules(),
          money: _money,
        ),
        isNull,
        reason: 'a zero budget is "none", not "every charge is over it"',
      );
    });

    test('over the budget: one alert at the next reminder time, opening '
        'Insights, with both figures', () {
      final RenewalReminders svc = _build().svc;
      final core.ScheduledNotification? n = svc.plannedOverBudget(
        budget: _budget(5000),
        spent: _spent(5400),
        copy: _copy(),
        rules: const ReminderRules(hour: 9),
        money: _money,
      );
      expect(n, isNotNull);
      expect(n!.id, RenewalReminders.overBudgetId);
      expect(n.title, 'Over budget');
      expect(n.body, r'$54.00 of $50');
      expect(n.at, DateTime(2026, 10, 1, 9), reason: '08:00 now → 09:00 today');
      expect(n.payload, RenewalReminders.overBudgetPayload);
      expect(routeForNotificationPayload(n.payload), '/insights');
      expect(
        RenewalReminders.isRenewalReminderId(n.id),
        isFalse,
        reason:
            'outside the renewal namespace, so a renewal sync never '
            'reconciles it away',
      );
    });

    test('past today\'s reminder time it is tomorrow\'s', () {
      final RenewalReminders svc = _build(now: DateTime(2026, 10, 1, 10)).svc;
      final core.ScheduledNotification? n = svc.plannedOverBudget(
        budget: _budget(5000),
        spent: _spent(5400),
        copy: _copy(),
        rules: const ReminderRules(hour: 9),
        money: _money,
      );
      expect(n!.at, DateTime(2026, 10, 2, 9));
    });

    test('a copy with no over-budget sentence posts nothing', () {
      final RenewalReminders svc = _build().svc;
      expect(
        svc.plannedOverBudget(
          budget: _budget(5000),
          spent: _spent(5400),
          copy: _copy(withBudget: false),
          rules: const ReminderRules(),
          money: _money,
        ),
        isNull,
      );
    });
  });

  group('RenewalReminders.syncOverBudget', () {
    test(
      'arms, then cancels when back under — and touches only its own id',
      () async {
        final ({RecordingSeam seam, RenewalReminders svc}) b = _build();
        b.seam.pending[RenewalReminders.digestId] = core.ScheduledNotification(
          id: RenewalReminders.digestId,
          title: 'digest',
          body: '',
          at: _morning,
        );
        await b.svc.syncOverBudget(
          budget: _budget(5000),
          spent: _spent(5400),
          copy: _copy(),
          rules: const ReminderRules(),
          money: _money,
        );
        expect(b.seam.pending.keys, contains(RenewalReminders.overBudgetId));

        await b.svc.syncOverBudget(
          budget: _budget(6000),
          spent: _spent(5400),
          copy: _copy(),
          rules: const ReminderRules(),
          money: _money,
        );
        expect(
          b.seam.pending.keys,
          isNot(contains(RenewalReminders.overBudgetId)),
        );
        expect(
          b.seam.pending.keys,
          contains(RenewalReminders.digestId),
          reason: 'the digest is not this alert\'s to cancel',
        );
      },
    );

    // ⏱ 2026-10-01 · NO-04: this read Linux, which schedules now; web is the
    // target that cannot.
    test('where nothing can be scheduled (web) it does nothing', () async {
      final ({RecordingSeam seam, RenewalReminders svc}) b = _build(
        isWeb: true,
      );
      await b.svc.syncOverBudget(
        budget: _budget(5000),
        spent: _spent(5400),
        copy: _copy(),
        rules: const ReminderRules(),
        money: _money,
      );
      expect(b.seam.calls, isEmpty);
    });
  });

  group('the controller arms it from a real sync', () {
    Future<({ProviderContainer c, RecordingSeam seam, _Repo repo})> boot(
      BudgetInfo budget,
    ) async {
      final ({RecordingSeam seam, RenewalReminders svc}) b = _build(
        now: DateTime.now(),
      );
      // Three $20 plans: a $60 monthly average.
      final _Repo repo = _Repo(_subs(2000, 3), budget);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          renewalRemindersProvider.overrideWithValue(b.svc),
          subscriptionRepositoryProvider.overrideWithValue(repo),
          currencyCodeProvider.overrideWithValue('USD'),
          localeProvider.overrideWith(() => _EnglishLocale()),
        ],
      );
      addTearDown(c.dispose);
      await c.read(settingsControllerProvider.notifier).hydration;
      await c.read(subscriptionsControllerProvider.future);
      return (c: c, seam: b.seam, repo: repo);
    }

    test('exceeding a set budget arms the over-budget alert', () async {
      final ({ProviderContainer c, RecordingSeam seam, _Repo repo}) r =
          await boot(_budget(5000));
      final core.ScheduledNotification? n =
          r.seam.pending[RenewalReminders.overBudgetId];
      expect(n, isNotNull, reason: r'$60 a month against a $50 budget');
      final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
      expect(n!.title, en.overBudgetTitle);
      expect(n.body, contains(r'$60.00'));
      expect(n.body, contains(r'$50'));
    });

    test('inside the budget: nothing armed', () async {
      final ({ProviderContainer c, RecordingSeam seam, _Repo repo}) r =
          await boot(_budget(8000));
      expect(
        r.seam.pending.keys,
        isNot(contains(RenewalReminders.overBudgetId)),
      );
    });

    test('a budget save re-syncs: raising it cancels the alert', () async {
      final ({ProviderContainer c, RecordingSeam seam, _Repo repo}) r =
          await boot(_budget(5000));
      expect(r.seam.pending.keys, contains(RenewalReminders.overBudgetId));
      r.repo.budgetInfo = _budget(9000);
      await r.c
          .read(subscriptionsControllerProvider.notifier)
          .resyncReminders();
      expect(
        r.seam.pending.keys,
        isNot(contains(RenewalReminders.overBudgetId)),
      );
    });

    test('an unread budget leaves the armed alert alone', () async {
      final ({ProviderContainer c, RecordingSeam seam, _Repo repo}) r =
          await boot(_budget(5000));
      r.repo.failBudget = true;
      await r.c
          .read(subscriptionsControllerProvider.notifier)
          .resyncReminders();
      expect(
        r.seam.pending.keys,
        contains(RenewalReminders.overBudgetId),
        reason: 'a failed read is not "no budget"',
      );
      expect(
        r.c.read(reminderSyncFailureProvider),
        isNull,
        reason: 'and it is not a reminder-sync failure either',
      );
    });

    test('"Renewal alerts" off cancels it', () async {
      final ({ProviderContainer c, RecordingSeam seam, _Repo repo}) r =
          await boot(_budget(5000));
      expect(r.seam.pending.keys, contains(RenewalReminders.overBudgetId));
      await r.c.read(settingsControllerProvider.notifier).toggle('alerts');
      await r.c
          .read(subscriptionsControllerProvider.notifier)
          .resyncReminders();
      expect(
        r.seam.pending.keys,
        isNot(contains(RenewalReminders.overBudgetId)),
      );
    });
  });
}

class _EnglishLocale extends LocaleController {
  @override
  Locale? build() => const Locale('en');
}
