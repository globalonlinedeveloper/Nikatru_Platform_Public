import 'package:flutter/widgets.dart' show Locale;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/settings_controller.dart';
import 'package:subly/state/subscriptions_controller.dart';

/// The three settings toggles were declared in settings_controller.dart and read
/// NOWHERE, so switching them did nothing. These lock the wiring in place: if the
/// mapping from preference to action is broken again, these go red.
void main() {
  group('ReminderPlan', () {
    test('defaults: renewal reminders ON, weekly digest OFF', () {
      // A missing key must never silently turn a user's notifications ON, and
      // must never silently turn the ones they rely on OFF.
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{});
      expect(p.syncRenewals, isTrue);
      expect(p.weeklyDigest, isFalse);
    });

    test('alerts=false cancels renewal reminders', () {
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{
        'alerts': false,
      });
      expect(p.syncRenewals, isFalse);
    });

    test('weekly=true schedules the digest', () {
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{
        'weekly': true,
      });
      expect(p.weeklyDigest, isTrue);
    });

    test('the two toggles are independent', () {
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{
        'alerts': false,
        'weekly': true,
      });
      expect(p.syncRenewals, isFalse);
      expect(p.weeklyDigest, isTrue);
    });

    test('an unrelated pref does not disturb either', () {
      // 'priceHike' still round-trips in persisted settings even though its row
      // was removed, so it must not affect the plan.
      final ReminderPlan p = ReminderPlan.from(const <String, bool>{
        'priceHike': true,
      });
      expect(p.syncRenewals, isTrue);
      expect(p.weeklyDigest, isFalse);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // P4 L7 — THE WORDS THE OS GETS.
  //
  // `NotificationService` has no `BuildContext` and takes a [ReminderCopy] the
  // caller renders (see the class doc). Everything below drives the REAL caller
  // path — `SubscriptionsController._syncReminders`, reached the way the app
  // reaches it, through `subscriptionsControllerProvider` and the settings
  // listener — and asserts on the finished string, because that is the artefact
  // the user reads on their lock screen.
  //
  // 🔴 THE FAKE RENDERS INSTEAD OF RECORDING A CALL NAME. A `calls.add('…')`
  // recorder (settings_wiring_test's, correctly, for what IT tests) would go on
  // passing with every string in the wrong language, or with `count` pinned to a
  // constant. So this one does exactly what the real service does with the copy
  // it is handed, and keeps the result.
  // ───────────────────────────────────────────────────────────────────────────
  group('reminder copy through the caller path', () {
    setUpAll(() async {
      // The one call `MaterialApp` makes that initialises intl's date symbol
      // tables — `GlobalMaterialLocalizations.delegate.load` runs
      // `loadDateIntlDataIfNotLoaded()`
      // (flutter_localizations/lib/src/utils/date_localizations.dart), which is
      // why `DateFormat.MMMd('ta')` works in the app and throws in a bare
      // container. Bootstrapping it HERE, through the same public entry point,
      // keeps these expectations pinned to the data production actually uses
      // rather than to a second copy loaded some other way.
      await GlobalMaterialLocalizations.delegate.load(const Locale('en'));
      await GlobalMaterialLocalizations.delegate.load(const Locale('ta'));
    });

    test(
      'the digest count reaches the plural — 1 and 2 render differently',
      () async {
        final _RenderingNotifications one = await _driveDigest(1);
        expect(one.digestBodies, <String>[r'1 active, $10.00 a month.']);

        final _RenderingNotifications two = await _driveDigest(2);
        expect(two.digestBodies, <String>[r'2 active, $20.00 a month.']);
      },
    );

    test('a Tamil locale renders the Tamil digest, title and channel', () async {
      final _RenderingNotifications ta = await _driveDigest(
        2,
        locale: const Locale('ta'),
      );
      expect(ta.digestBodies, <String>[r'2 செயலில், மாதம் $20.00.']);
      expect(ta.digestTitles, <String>['உங்கள் வாரச் சந்தாச் சுருக்கம்']);
      // The Android CHANNEL name — the string that outlives the notification in
      // the OS settings app.
      expect(ta.channelNames, contains('புதுப்பித்தல் நினைவூட்டல்கள்'));
    });

    test(
      'the renewal date is formatted by the locale, not a month table',
      () async {
        // The service used to carry its own English `_pretty` table, so this date
        // read "Aug 12" in every language the app can run in.
        final _RenderingNotifications en = await _driveDigest(1);
        expect(en.reminderBodies, <String>['Netflix renews on Aug 12.']);

        final _RenderingNotifications ta = await _driveDigest(
          1,
          locale: const Locale('ta'),
        );
        expect(ta.reminderBodies, <String>[
          'Netflix 12 ஆக. அன்று புதுப்பிக்கப்படும்.',
        ]);
      },
    );

    test('switching language re-renders the queued reminders', () async {
      // Without the `localeProvider` listener the OS keeps the notifications it
      // was given in the language the user just left, until the list or a
      // preference next happens to change.
      final _Harness h = _harness(1);
      await h.container.read(subscriptionsControllerProvider.future);
      await h.container
          .read(settingsControllerProvider.notifier)
          .toggle('weekly');
      expect(h.notifier.digestBodies, <String>[r'1 active, $10.00 a month.']);

      await h.container.read(localeProvider.notifier).set(const Locale('ta'));
      // `.last`, and the length, together: a stale re-render posts a SECOND
      // English body rather than none, so a `contains` here would pass on the
      // exact defect this pins (measured — see reminderCopyFor's second note).
      expect(h.notifier.digestBodies, <String>[
        r'1 active, $10.00 a month.',
        r'1 செயலில், மாதம் $10.00.',
      ]);
    });
  });
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

class _FixedRepository implements SubscriptionRepository {
  _FixedRepository(this.subs);
  final List<Subscription> subs;

  @override
  Future<List<Subscription>> fetchAll() async => subs;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

/// Does with the [ReminderCopy] precisely what `NotificationService` does with
/// it, and keeps the strings. See the group header for why.
class _RenderingNotifications extends NotificationService {
  _RenderingNotifications() : super.forTesting();

  final List<String> channelNames = <String>[];
  final List<String> reminderBodies = <String>[];
  final List<String> digestTitles = <String>[];
  final List<String> digestBodies = <String>[];

  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {
    channelNames.add(copy.channelName);
    for (final Subscription s in subs) {
      reminderBodies.add(copy.reminderBody(s.name, s.nextRenewal));
    }
  }

  @override
  Future<void> cancelAll() async {}

  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {
    channelNames.add(copy.channelName);
    digestTitles.add(copy.digestTitle);
    digestBodies.add(copy.digestBody(count, formattedTotal));
  }

  @override
  Future<void> cancelWeeklyDigest() async {}
}

/// [count] monthly subscriptions at $10 each, all renewing 12 Aug 2026 — so the
/// digest total is a figure the assertion can name (10.00 / 20.00) and the
/// renewal date is one whose month word differs between the two locales.
List<Subscription> _subs(int count) => <Subscription>[
  for (int i = 0; i < count; i++)
    Subscription(
      id: 's$i',
      name: i == 0 ? 'Netflix' : 'Hulu',
      category: 'Other',
      price: 10,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 8, 12),
    ),
];

typedef _Harness = ({
  ProviderContainer container,
  _RenderingNotifications notifier,
});

_Harness _harness(int count, {Locale? locale}) {
  final _RenderingNotifications notifier = _RenderingNotifications();
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((Ref ref) async => _MemStore()),
      subscriptionRepositoryProvider.overrideWithValue(
        _FixedRepository(_subs(count)),
      ),
      sublyNotificationServiceProvider.overrideWithValue(notifier),
    ],
  );
  addTearDown(container.dispose);
  if (locale != null) {
    // Synchronous where it matters: `LocaleController.set` latches `_userChose`
    // and assigns `state` before its first await, so the language is in place
    // before the controller below is ever built.
    container.read(localeProvider.notifier).set(locale);
  }
  return (container: container, notifier: notifier);
}

/// Builds the controller (which syncs renewals) and then switches the weekly
/// digest ON through the settings toggle — the real trigger edge, via the
/// `settingsControllerProvider` listener rather than a direct call.
Future<_RenderingNotifications> _driveDigest(
  int count, {
  Locale? locale,
}) async {
  final _Harness h = _harness(count, locale: locale);
  await h.container.read(subscriptionsControllerProvider.future);
  // `syncAll` ran once on build; drop it so a digest assertion is not reading
  // the renewal pass, and so `reminderBodies` holds exactly one sweep.
  final List<String> renewals = List<String>.of(h.notifier.reminderBodies);
  h.notifier.reminderBodies.clear();
  await h.container.read(settingsControllerProvider.notifier).toggle('weekly');
  // The toggle re-syncs everything, so the renewal pass repeats identically —
  // pinning that here keeps the date assertions above reading ONE sweep.
  expect(h.notifier.reminderBodies, renewals);
  return h.notifier;
}
