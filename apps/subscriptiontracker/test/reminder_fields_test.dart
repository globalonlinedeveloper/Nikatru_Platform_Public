// ST-R3 + ST-R8: the row's reminder fields round-trip, and the detail rows
// write them.
//
//  · `reminder_days` (0003) and `notice_days` (0004) are read off the wire;
//    malformed values are "the default", never a guess.
//  · The notice row appears only once the API EMITS `notice_days` — an API
//    before 0004 would drop the value, so a field the user set would silently
//    un-set itself. Deploy order is the API first; this is what makes it safe.
//  · Choosing a notice period PATCHes it and re-arms the reminders.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/detail/reminder_rows.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'support/width_harness.dart' show MemStore;

Map<String, dynamic> _row({
  Object? reminderDays,
  Object? notice,
  bool withNotice = true,
}) => <String, dynamic>{
  'id': 'gym',
  'name': 'Gym',
  'price': 10,
  'cycle': 'monthly',
  'next_renewal': '2026-10-20',
  'reminder_days': reminderDays,
  if (withNotice) 'notice_days': notice,
};

class _Repo implements SubscriptionRepository {
  _Repo(this.row);
  Subscription row;
  final List<Map<String, dynamic>> patches = <Map<String, dynamic>>[];

  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[row];

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    patches.add(changes);
    return row = row.withReminderPatch(changes);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

class _Recording extends RenewalReminders {
  _Recording() : super.forTesting();
  final List<List<Subscription>> syncs = <List<Subscription>>[];

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async => syncs.add(subs);

  @override
  Future<void> cancelWeeklyDigest() async {}
}

void main() {
  group('the wire', () {
    test('notice_days and reminder_days round-trip through the model', () {
      final Subscription s = Subscription.fromJson(
        _row(reminderDays: <int>[1, 7], notice: 14),
      );
      expect(s.noticeDays, 14);
      expect(s.noticeDaysSupported, isTrue);
      expect(s.reminderDays, <int>[7, 1]);
      expect(s.cancelBy, DateTime(2026, 10, 6));
      final Subscription back = Subscription.fromJson(s.toJson());
      expect(back.noticeDays, 14);
      expect(back.reminderDays, <int>[7, 1]);
    });

    test('an API before 0004 (no notice_days key) hides the field', () {
      final Subscription s = Subscription.fromJson(_row(withNotice: false));
      expect(s.noticeDaysSupported, isFalse);
      expect(s.noticeDays, isNull);
      expect(s.toJson().containsKey('notice_days'), isFalse);
    });

    test('a null notice keeps the capability through the cache round-trip', () {
      final Subscription s = Subscription.fromJson(_row());
      expect(s.noticeDaysSupported, isTrue);
      expect(Subscription.fromJson(s.toJson()).noticeDaysSupported, isTrue);
    });

    test('malformed values are the default, never a guess', () {
      expect(Subscription.readReminderDays(<Object?>[1, 'x']), isNull);
      expect(Subscription.readReminderDays(<int>[-1]), isNull);
      expect(Subscription.readReminderDays(<int>[]), isNull);
      expect(Subscription.readNoticeDays(1.5), isNull);
      expect(Subscription.readNoticeDays(-2), isNull);
    });
  });

  group('the detail rows', () {
    Future<({ProviderContainer c, _Repo repo, _Recording rem})> pump(
      WidgetTester tester,
      Subscription s,
    ) async {
      final _Repo repo = _Repo(s);
      final _Recording rem = _Recording();
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
          renewalRemindersProvider.overrideWithValue(rem),
          subscriptionRepositoryProvider.overrideWithValue(repo),
        ],
      );
      addTearDown(c.dispose);
      await c.read(subscriptionsControllerProvider.future);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: <LocalizationsDelegate<dynamic>>[
              ...AppLocalizations.localizationsDelegates,
              ChassisLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Consumer(
                builder: (_, WidgetRef ref, _) => SubscriptionReminderRows(
                  sub: ref
                      .watch(subscriptionsControllerProvider)
                      .requireValue
                      .single,
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return (c: c, repo: repo, rem: rem);
    }

    testWidgets('no notice row until the API emits notice_days', (
      WidgetTester tester,
    ) async {
      await pump(tester, Subscription.fromJson(_row(withNotice: false)));
      expect(find.byKey(const Key('detail.reminders')), findsOneWidget);
      expect(find.byKey(const Key('detail.notice')), findsNothing);
    });

    testWidgets('🔴 choosing 7 days PATCHes notice_days and re-arms', (
      WidgetTester tester,
    ) async {
      final w = await pump(tester, Subscription.fromJson(_row()));
      final int syncsBefore = w.rem.syncs.length;
      await tester.tap(find.byKey(const Key('detail.notice')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('settings.reminder.lead.7')));
      await tester.pumpAndSettle();
      expect(w.repo.patches.single, <String, dynamic>{'notice_days': 7});
      expect(w.rem.syncs.length, syncsBefore + 1);
      expect(w.rem.syncs.last.single.noticeDays, 7);
      expect(find.text('7 days before renewal'), findsOneWidget);
    });

    testWidgets('choosing [7, 1] PATCHes reminder_days, nearest last', (
      WidgetTester tester,
    ) async {
      final w = await pump(tester, Subscription.fromJson(_row()));
      await tester.tap(find.byKey(const Key('detail.reminders')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('detail.reminders.1')));
      await tester.tap(find.byKey(const Key('detail.reminders.7')));
      await tester.tap(find.byKey(const Key('detail.reminders.save')));
      await tester.pumpAndSettle();
      expect(w.repo.patches.single, <String, dynamic>{
        'reminder_days': <int>[7, 1],
      });
    });
  });
}
