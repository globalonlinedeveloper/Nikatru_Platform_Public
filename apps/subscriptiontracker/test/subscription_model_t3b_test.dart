// ST-T3b — the subscription model, app half ([ADR no.077] §5).
//
// One file per train keeps the red controls findable: each group below names
// the label it pins (ST-M3, ST-E1, ST-E3, ST-E4, ST-E5), and each case is one
// the pre-T3b tree FAILS — measured by reverting the lib change it names.
import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/core/format/sub_math.dart';
import 'package:subscriptiontracker/data/api/api_client.dart';
import 'package:subscriptiontracker/data/local/subscription_store.dart';
import 'package:subscriptiontracker/data/models/budget_info.dart';
import 'package:subscriptiontracker/data/models/payment_record.dart';
import 'package:subscriptiontracker/data/models/spend_history.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/shared/due.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/recording_seam.dart';

DateTime _day(DateTime d) => DateTime(d.year, d.month, d.day);

Subscription _row(
  String id, {
  Cadence? cycle = Cadence.monthly,
  required DateTime next,
  int minor = 1000,
  String currency = 'USD',
  SubscriptionStatus status = SubscriptionStatus.active,
  DateTime? trialEndsOn,
}) => Subscription(
  id: id,
  name: id,
  category: 'Other',
  price: Money(minor, currency),
  cycle: cycle,
  nextRenewal: next,
  status: status,
  trialEndsOn: trialEndsOn,
);

/// The API seam, recording every call. `updateSubscription` applies the body
/// the way the route does (`Subscription.patched`).
class _RecordingApi implements ApiClient {
  _RecordingApi(this.subs);
  List<Subscription> subs;
  final List<(String, Map<String, dynamic>)> patches =
      <(String, Map<String, dynamic>)>[];
  int deletes = 0;

  /// The ST-T3a route today: any non-null `deleted_at` is a 400.
  bool refuseDeletedAt = false;

  @override
  Future<List<Subscription>> getSubscriptions() async => subs;
  @override
  Future<Subscription> createSubscription(Subscription draft) async => draft;
  @override
  Future<Subscription> getSubscription(String id) async =>
      subs.firstWhere((Subscription s) => s.id == id);
  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    patches.add((id, Map<String, dynamic>.of(changes)));
    if (refuseDeletedAt && changes['deleted_at'] != null) {
      throw ApiException(400, 'invalid_body');
    }
    final Subscription updated = subs
        .firstWhere((Subscription s) => s.id == id)
        .patched(changes);
    subs = <Subscription>[
      for (final Subscription s in subs) s.id == id ? updated : s,
    ];
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    deletes++;
    subs = subs.where((Subscription s) => s.id != id).toList();
  }

  // NO-10 · "Mark as paid": not exercised by this suite.
  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {}

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      const <PaymentRecord>[];
  @override
  Future<SpendHistory> getSpendHistory() async => SpendHistory.empty;
  @override
  Future<BudgetInfo> getBudget() async => const BudgetInfo(
    monthlyBudget: Money(1, 'USD'),
    categories: <BudgetCap>[],
  );
  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async => budget;
  @override
  Future<core.Entitlements> getEntitlements() async => core.Entitlements.none;
}

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

/// Records what the controller hands the OS-facing seam.
class _RecordingNotifier extends RenewalReminders {
  _RecordingNotifier() : super.forTesting();
  final List<List<Subscription>> synced = <List<Subscription>>[];
  final List<String> cancelledFor = <String>[];

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async => synced.add(List<Subscription>.of(subs));
  @override
  Future<void> cancelForSubscription(String id) async => cancelledFor.add(id);
  @override
  Future<void> cancelOwnedRenewals() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

ProviderContainer _container(_RecordingApi api, _RecordingNotifier n) {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
      apiClientProvider.overrideWithValue(api),
      renewalRemindersProvider.overrideWithValue(n),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });
  final DateTime now = DateTime.now();
  final DateTime today = _day(now);

  // ═══════════════════════════════════════════════════════════════════════════
  group('ST-M3 · due dates roll by the platform rule', () {
    test(
      'a monthly row 3 days past shows its ROLLED date, not "Due today"',
      () {
        final Subscription late = _row(
          'm',
          next: today.subtract(const Duration(days: 3)),
        );
        final DateTime rolled = RecurrenceSchedule.nextOnOrAfter(
          late.nextRenewal,
          Cadence.monthly,
          today,
        );
        expect(late.nextCharge(now), rolled);
        expect(rolled.isAfter(today), isTrue);
        final int d = late.daysUntil(now);
        expect(d, greaterThan(0));
        final String label = DueInfo.localized(en, late, now).label;
        expect(label, isNot(en.dueToday));
        expect(label, d == 1 ? en.renewsTomorrow : en.dueInDays(d));
      },
    );

    test('a row with NO cadence whose date passed says "Overdue"', () {
      final Subscription none = _row(
        'n',
        cycle: null,
        next: today.subtract(const Duration(days: 3)),
      );
      expect(none.daysUntil(now), -3);
      expect(DueInfo.localized(en, none, now).label, en.dueOverdue);
      // …and a row due TODAY still says so.
      expect(
        DueInfo.localized(en, _row('t', next: today), now).label,
        en.dueToday,
      );
    });

    test('the hero due-in-7 figure is the sum of exactly the rows listed', () {
      final List<Subscription> subs = <Subscription>[
        // Stored 3 days ago, weekly → next charge in 4 days: IS due within 7.
        _row(
          'weekly',
          cycle: Cadence.weekly,
          next: today.subtract(const Duration(days: 3)),
          minor: 300,
        ),
        // Stored 3 days ago, monthly → next charge ~a month out: is NOT. The
        // pre-T3b `daysUntil` read -3 and the hero excluded it while the list
        // printed "Due today" for it.
        _row(
          'monthly',
          next: today.subtract(const Duration(days: 3)),
          minor: 5000,
        ),
        _row('soon', next: today.add(const Duration(days: 2)), minor: 700),
        _row(
          'paused',
          next: today.add(const Duration(days: 1)),
          status: SubscriptionStatus.paused,
          minor: 9900,
        ),
      ];
      final List<Subscription> listed = SubMath.dueWithinRows(subs, now, 7);
      expect(listed.map((Subscription s) => s.id), <String>['weekly', 'soon']);
      expect(
        SubMath.dueWithin(subs, now, 7).inCurrency('USD'),
        const Money(1000, 'USD'),
      );
      expect(
        core.MoneyBag.sum(
          listed.map((Subscription s) => s.price),
        ).inCurrency('USD'),
        SubMath.dueWithin(subs, now, 7).inCurrency('USD'),
      );
      // Every row the list shows reads a due label within the window.
      for (final Subscription s in listed) {
        expect(s.daysUntil(now), inInclusiveRange(0, 7));
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('ST-E4 · cadences beyond monthly/yearly', () {
    test('weekly, quarterly and every-10-days rows total correctly', () {
      final Subscription weekly = _row(
        'w',
        cycle: Cadence.weekly,
        next: today,
      ); // 10.00 a week
      final Subscription quarterly = _row(
        'q',
        cycle: Cadence.quarterly,
        next: today,
        minor: 3000,
      ); // 30.00 a quarter
      final Subscription tenDays = _row(
        'd',
        cycle: const Cadence(10, CycleUnit.day),
        next: today,
        minor: 500,
      ); // 5.00 every 10 days
      // Yearly charges: 52 weeks, 4 quarters, 36.5 ten-day periods.
      expect(weekly.yearlyCharge, const Money(52000, 'USD'));
      expect(quarterly.yearlyCharge, const Money(12000, 'USD'));
      expect(tenDays.yearlyCharge, const Money(18250, 'USD'));
      // Monthly shares, each rounded ONCE: 1000·52/12, 3000/3, 500·365/120.
      expect(
        SubMath.totalMonthly(<Subscription>[weekly]).inCurrency('USD'),
        const Money(4333, 'USD'),
      );
      expect(
        SubMath.totalMonthly(<Subscription>[quarterly]).inCurrency('USD'),
        const Money(1000, 'USD'),
      );
      expect(
        SubMath.totalMonthly(<Subscription>[tenDays]).inCurrency('USD'),
        const Money(1521, 'USD'),
      );
      expect(
        SubMath.totalYearly(<Subscription>[
          weekly,
          quarterly,
          tenDays,
        ]).inCurrency('USD'),
        const Money(52000 + 12000 + 18250, 'USD'),
      );
      // Monthly and yearly are exactly what they were.
      expect(
        SubMath.totalMonthly(<Subscription>[
          _row('m', next: today, minor: 999),
        ]).inCurrency('USD'),
        const Money(999, 'USD'),
      );
      expect(
        SubMath.totalMonthly(<Subscription>[
          _row('y', cycle: Cadence.yearly, next: today, minor: 12053),
        ]).inCurrency('USD'),
        const Money(1004, 'USD'),
      );
    });

    test('a start date LAST MONTH gives the right next renewal', () {
      final DateTime start = DateTime(today.year, today.month - 1, today.day);
      final Subscription s = _row('s', next: start);
      final DateTime next = s.nextCharge(now);
      expect(next, RecurrenceSchedule.advance(start, Cadence.monthly));
      expect(next.isBefore(today), isFalse);
    });

    test('old JSON (cycle only) decodes; a null cycle is no cadence', () {
      Subscription decode(Object? cycle) =>
          Subscription.fromJson(<String, dynamic>{
            'id': 'x',
            'name': 'x',
            'price': 1,
            'cycle': cycle,
            'next_renewal': '2026-10-01',
          });
      expect(decode('monthly').cycle, Cadence.monthly);
      expect(decode('yearly').cycle, Cadence.yearly);
      expect(decode(null).cycle, isNull);
      // The pair wins over the legacy value when both are there.
      final Subscription weekly = Subscription.fromJson(<String, dynamic>{
        'id': 'x',
        'name': 'x',
        'price': 1,
        'cycle': null,
        'cycle_every': 2,
        'cycle_unit': 'week',
        'next_renewal': '2026-10-01',
      });
      expect(weekly.cycle, const Cadence(2, CycleUnit.week));
      expect(weekly.status, SubscriptionStatus.active);
    });

    test('toJson sends the pair and the legacy value the API derives', () {
      final Map<String, dynamic> weekly = _row(
        'w',
        cycle: Cadence.weekly,
        next: today,
      ).toJson();
      expect(weekly['cycle'], isNull);
      expect(weekly['cycle_every'], 1);
      expect(weekly['cycle_unit'], 'week');
      final Map<String, dynamic> monthly = _row('m', next: today).toJson();
      expect(monthly['cycle'], 'monthly');
      expect(monthly['cycle_unit'], 'month');
    });

    test(
      'the local store round-trips the pair, the status and the trial',
      () async {
        final LocalSubscriptionStore store = LocalSubscriptionStore.inMemory();
        final Subscription trial = Subscription(
          id: 't',
          name: 'Trial',
          category: 'Other',
          price: const Money(64900, 'INR'),
          cycle: const Cadence(3, CycleUnit.month),
          nextRenewal: DateTime(2026, 12, 1),
          status: SubscriptionStatus.trialing,
          trialEndsOn: DateTime(2026, 10, 15),
          firstChargeOn: DateTime(2026, 10, 15),
          notes: 'family plan',
          cancelUrl: 'https://example.com/cancel',
        );
        await store.writeSubscriptions(<Subscription>[trial]);
        final Subscription back = (await store.readSubscriptions())!.single;
        expect(back.cycle, const Cadence(3, CycleUnit.month));
        expect(back.status, SubscriptionStatus.trialing);
        expect(back.trialEndsOn, DateTime(2026, 10, 15));
        expect(back.firstChargeOn, DateTime(2026, 10, 15));
        expect(back.notes, 'family plan');
        expect(back.cancelUrl, 'https://example.com/cancel');
        expect(back.price, const Money(64900, 'INR'));
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('ST-E1 · edit sends only what changed', () {
    test('changesFrom carries only the changed keys, and their partners', () {
      final Subscription before = _row('a', next: DateTime(2026, 10, 1));
      expect(
        before.copyWith(name: 'Renamed').changesFrom(before),
        <String, dynamic>{'name': 'Renamed'},
      );
      expect(before.changesFrom(before), isEmpty);
      // A new price carries its exact amount and currency: the API 400s a
      // price_minor sent without them, and clears it when price comes alone.
      expect(
        before.withPrice(const Money(1299, 'USD')).changesFrom(before),
        <String, dynamic>{
          'price': 12.99,
          'price_minor': 1299,
          'currency': 'USD',
        },
      );
      // A new cadence carries the whole triple.
      expect(
        before.copyWith(cycle: Cadence.weekly).changesFrom(before),
        <String, dynamic>{
          'cycle': null,
          'cycle_every': 1,
          'cycle_unit': 'week',
        },
      );
    });

    test('the controller sends ONE PATCH with only the changed keys', () async {
      final _RecordingApi api = _RecordingApi(<Subscription>[
        _row('a', next: DateTime(2030, 1, 1)),
      ]);
      final ProviderContainer c = _container(api, _RecordingNotifier());
      final List<Subscription> list = await c.read(
        subscriptionsControllerProvider.future,
      );
      final Subscription before = list.single;
      final Subscription after = before.copyWith(notes: 'shared with Asha');
      await c
          .read(subscriptionsControllerProvider.notifier)
          .updateSubscription(before.id, after.changesFrom(before));
      expect(api.patches, hasLength(1));
      expect(api.patches.single.$2, <String, dynamic>{
        'notes': 'shared with Asha',
      });
      expect(
        c.read(subscriptionsControllerProvider).requireValue.single.notes,
        'shared with Asha',
      );
      // An edit that changed nothing is not a write.
      await c
          .read(subscriptionsControllerProvider.notifier)
          .updateSubscription(before.id, const <String, dynamic>{});
      expect(api.patches, hasLength(1));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('ST-E3 · lifecycle keeps the row and its history', () {
    late _RecordingApi api;
    late _RecordingNotifier notifier;
    late ProviderContainer c;
    setUp(() async {
      api = _RecordingApi(<Subscription>[
        _row('a', next: DateTime(2030, 1, 1), minor: 1000),
        _row('b', next: DateTime(2030, 1, 2), minor: 2000),
      ]);
      notifier = _RecordingNotifier();
      c = _container(api, notifier);
      await c.read(subscriptionsControllerProvider.future);
    });
    SubscriptionsController ctl() =>
        c.read(subscriptionsControllerProvider.notifier);
    List<Subscription> rows() =>
        c.read(subscriptionsControllerProvider).requireValue;

    test(
      'Mark cancelled: status + cancelled_on; the row stays, the totals drop it',
      () async {
        await ctl().markCancelled('a', on: DateTime(2026, 9, 28));
        expect(api.patches.single.$2, <String, dynamic>{
          'status': 'cancelled',
          'cancelled_on': '2026-09-28',
        });
        expect(rows().map((Subscription s) => s.id), <String>['a', 'b']);
        expect(
          SubMath.totalMonthly(rows()).inCurrency('USD'),
          const Money(2000, 'USD'),
        );
        // …and its reminder is not re-armed.
        expect(notifier.synced.last.map((Subscription s) => s.id), <String>[
          'b',
        ]);
      },
    );

    test('Pause: status only; the row stays, the totals drop it', () async {
      await ctl().pauseSubscription('b');
      expect(api.patches.single.$2, <String, dynamic>{'status': 'paused'});
      expect(rows(), hasLength(2));
      expect(
        SubMath.totalMonthly(rows()).inCurrency('USD'),
        const Money(1000, 'USD'),
      );
      await ctl().resumeSubscription('b');
      expect(api.patches.last.$2, <String, dynamic>{
        'status': 'active',
        'cancelled_on': null,
      });
      expect(
        SubMath.totalMonthly(rows()).inCurrency('USD'),
        const Money(3000, 'USD'),
      );
    });

    test(
      'Delete is a soft delete, NEVER a DELETE, and Undo restores the row',
      () async {
        final Subscription? was = await ctl().cancelSubscription('a');
        expect(was?.id, 'a');
        expect(api.deletes, 0, reason: 'the UI must never call DELETE');
        final Map<String, dynamic> body = api.patches.single.$2;
        expect(body.keys, <String>['deleted_at']);
        expect(DateTime.tryParse(body['deleted_at'] as String), isNotNull);
        expect(rows().map((Subscription s) => s.id), <String>['b']);
        expect(notifier.cancelledFor, <String>['a']);

        await ctl().undoDelete('a');
        expect(api.patches.last.$2, <String, dynamic>{'deleted_at': null});
        expect(rows().map((Subscription s) => s.id).toSet(), <String>{
          'a',
          'b',
        });
        expect(api.deletes, 0);
      },
    );

    test(
      // ⏱ 2026-10-01 · DE-10: `DELETE /v1/subscriptions/:id` is a SOFT delete
      // now (`SET deleted_at = COALESCE(deleted_at, ?)`), so the fallback is
      // undoable too — this case used to pin the refused Undo.
      'a server that refuses deleted_at (400) falls back to DELETE, still undoable',
      () async {
        expect(ctl().canUndoDelete('a'), isFalse);
        api.refuseDeletedAt = true;
        await ctl().cancelSubscription('a');
        expect(api.deletes, 1);
        expect(rows().map((Subscription s) => s.id), <String>['b']);
        expect(ctl().canUndoDelete('a'), isTrue);
        expect(notifier.cancelledFor, <String>['a']);

        api.refuseDeletedAt = false;
        await ctl().cancelSubscription('b');
        expect(api.deletes, 1, reason: 'the soft delete held: no DELETE');
        expect(ctl().canUndoDelete('b'), isTrue);
        await ctl().undoDelete('b');
        expect(ctl().canUndoDelete('b'), isFalse);
      },
    );

    test('a soft-deleted row the server still lists is not shown', () async {
      // GET /v1/subscriptions (ST-T3a) does not filter deleted_at yet.
      api.subs = <Subscription>[
        ...api.subs,
        _row(
          'gone',
          next: DateTime(2030, 1, 3),
        ).patched(<String, dynamic>{'deleted_at': '2026-09-01T00:00:00.000Z'}),
      ];
      c.invalidate(subscriptionsControllerProvider);
      final List<Subscription> list = await c.read(
        subscriptionsControllerProvider.future,
      );
      expect(list.map((Subscription s) => s.id), <String>['a', 'b']);
    });

    test('a history row shows ITS OWN currency, not the user\'s', () {
      final PaymentRecord p = PaymentRecord.fromJson(<String, dynamic>{
        'amount': 649,
        'currency': 'INR',
        'paid_at': '2026-08-01T00:00:00Z',
      }, fallbackCurrencyCode: 'USD');
      expect(p.amount, const Money(64900, 'INR'));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  group('ST-E5 · trials', () {
    // ⏱ 2026-09-28 (ST-R4): over the core seam — the app no longer wraps the
    // plugin, so the plan is what is asserted, and the seam's pending set.
    test(
      'a trialing row arms a reminder at trial end minus the lead, with its own id',
      () async {
        final RecordingSeam seam = RecordingSeam();
        final RenewalReminders service = RenewalReminders.forTesting(
          service: seam,
          now: () => DateTime(today.year, today.month, today.day, 8),
        );
        final DateTime ends = today.add(const Duration(days: 10));
        final Subscription trial = _row(
          'trial-1',
          next: today.add(const Duration(days: 20)),
          status: SubscriptionStatus.trialing,
          trialEndsOn: ends,
        );
        final List<core.ScheduledNotification> plan = service.plannedFor(
          trial,
          copy: _copy,
          rules: const ReminderRules(),
        );
        final int trialId = RenewalReminders.renewalIdFor('trial-1|trial|2');
        final core.ScheduledNotification t2 = plan.singleWhere(
          (core.ScheduledNotification n) => n.id == trialId,
        );
        expect(t2.at, DateTime(ends.year, ends.month, ends.day - 2, 9));
        expect(trialId, isNot(RenewalReminders.renewalIdFor('trial-1|2')));
        expect(
          RenewalReminders.isRenewalReminderId(trialId),
          isTrue,
          reason: 'outside the owned namespace, cancelOwnedRenewals misses it',
        );

        await service.syncAll(<Subscription>[trial], copy: _copy);
        // ⏱ 2026-10-01 · NO-11: the renewal is armed for its next charges
        // too (`|2|c1`, `|2|c2`); the trial reminder stays one.
        expect(seam.pending.keys.toSet(), <int>{
          RenewalReminders.renewalIdFor('trial-1|2'),
          RenewalReminders.renewalIdFor('trial-1|2|c1'),
          RenewalReminders.renewalIdFor('trial-1|2|c2'),
          trialId,
        });

        // An ACTIVE row with a stale trial date arms no trial reminder.
        expect(
          service
              .plannedFor(
                _row('a', next: ends, trialEndsOn: ends),
                copy: _copy,
                rules: const ReminderRules(),
              )
              .where(
                (core.ScheduledNotification n) =>
                    n.id == RenewalReminders.renewalIdFor('a|trial|2'),
              ),
          isEmpty,
        );

        // Cancelling the row cancels BOTH.
        await service.cancelForSubscription(trial.id);
        expect(seam.pending, isEmpty);
      },
    );
  });
}

final ReminderCopy _copy = ReminderCopy(
  channelName: 'Renewals',
  reminderTitle: 'Renewal',
  reminderBody: (String name, DateTime renewal) => name,
  digestTitle: 'Digest',
  digestBody: (int count, String total) => '$count',
  cancelByTitle: (DateTime d) => 'Cancel by',
  cancelByBody: (String name, DateTime d) => name,
  channelDescription: 'Alerts',
);
