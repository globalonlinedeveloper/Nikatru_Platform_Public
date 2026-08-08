import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/data/models/subscription.dart';
import 'package:subly/services/notifications/notification_service.dart';
import 'package:subly/state/providers.dart';
import 'package:subly/state/settings_controller.dart';
import 'package:subly/state/subscriptions_controller.dart';

/// Settings must PERSIST (mirroring consent's "SURVIVES a restart" test) and
/// must ACT immediately. Both directions previously failed silently:
///
///  * `SettingsController.build()` returned defaults and the setters wrote
///    nowhere, so every launch reset the prefs — and the launch-time
///    `_syncReminders` then CANCELLED the weekly digest the user had switched
///    on last session.
///  * `_syncReminders` read settings with `ref.read` and ran only on
///    build/add/cancel, so flipping a toggle changed nothing until the list
///    next happened to change.
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

/// Records which scheduling seams the wiring drives, instead of touching the
/// plugin (which needs a real device — the DECISION is what is under test).
class _RecordingNotificationService extends NotificationService {
  _RecordingNotificationService() : super.forTesting();

  final List<String> calls = <String>[];

  @override
  Future<void> syncAll(List<Subscription> subs, {int daysBefore = 2}) async {
    calls.add('syncAll');
  }

  @override
  Future<void> cancelAll() async {
    calls.add('cancelAll');
  }

  @override
  Future<void> scheduleWeeklyDigest({
    required int count,
    required String formattedTotal,
  }) async {
    calls.add('scheduleWeeklyDigest');
  }

  @override
  Future<void> cancelWeeklyDigest() async {
    calls.add('cancelWeeklyDigest');
  }
}

ProviderContainer _container(
  core.KeyValueStore store,
  _RecordingNotificationService notifier,
) {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((ref) async => store),
      sublyNotificationServiceProvider.overrideWithValue(notifier),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

void main() {
  group('settings persistence (ADR 005 store round-trip)', () {
    test('a toggled preference SURVIVES a restart', () async {
      final _MemStore store = _MemStore();

      // Session 1: the user switches the weekly digest on.
      final ProviderContainer first = _container(
        store,
        _RecordingNotificationService(),
      );
      await first.read(settingsControllerProvider.notifier).toggle('weekly');
      expect(first.read(settingsControllerProvider).prefs['weekly'], isTrue);
      first.dispose();

      // A fresh container over the same store == the next app launch.
      final ProviderContainer reborn = _container(
        store,
        _RecordingNotificationService(),
      );
      final SettingsController controller = reborn.read(
        settingsControllerProvider.notifier,
      );
      await controller.hydration;
      expect(
        reborn.read(settingsControllerProvider).prefs['weekly'],
        isTrue,
        reason: 'if this fails, every launch silently resets the prefs',
      );
      // Untouched prefs keep their defaults through the round-trip.
      expect(reborn.read(settingsControllerProvider).prefs['alerts'], isTrue);
    });

    test('the chosen currency SURVIVES a restart', () async {
      final _MemStore store = _MemStore();

      final ProviderContainer first = _container(
        store,
        _RecordingNotificationService(),
      );
      await first.read(settingsControllerProvider.notifier).setCurrency('₹');
      first.dispose();

      final ProviderContainer reborn = _container(
        store,
        _RecordingNotificationService(),
      );
      await reborn.read(settingsControllerProvider.notifier).hydration;
      expect(reborn.read(settingsControllerProvider).currencySymbol, '₹');
    });

    test(
      'a corrupt store falls back to defaults instead of breaking',
      () async {
        final _MemStore store = _MemStore();
        store.data[kSettingsKey] = 'not json {{{';

        final ProviderContainer c = _container(
          store,
          _RecordingNotificationService(),
        );
        await c.read(settingsControllerProvider.notifier).hydration;
        expect(c.read(settingsControllerProvider).prefs['alerts'], isTrue);
        expect(c.read(settingsControllerProvider).prefs['weekly'], isFalse);
        expect(c.read(settingsControllerProvider).currencySymbol, r'$');
      },
    );

    test(
      'the weekly digest the user enabled is NOT cancelled by the next launch',
      () async {
        final _MemStore store = _MemStore();

        // Session 1: enable the digest (persisted by the fix above).
        final ProviderContainer first = _container(
          store,
          _RecordingNotificationService(),
        );
        await first.read(settingsControllerProvider.notifier).toggle('weekly');
        first.dispose();

        // Session 2 — the launch that used to UN-schedule it: build() ran
        // _syncReminders against the reset prefs and hit cancelWeeklyDigest.
        final _RecordingNotificationService notifier =
            _RecordingNotificationService();
        final ProviderContainer reborn = _container(store, notifier);
        await reborn.read(subscriptionsControllerProvider.future);
        await reborn.read(settingsControllerProvider.notifier).hydration;
        // Let the settings listener's resync run.
        await Future<void>.delayed(Duration.zero);

        final Iterable<String> digestCalls = notifier.calls.where(
          (String c) => c.contains('Digest'),
        );
        expect(
          digestCalls,
          isNotEmpty,
          reason: 'launch must decide the digest one way or the other',
        );
        expect(
          digestCalls.last,
          'scheduleWeeklyDigest',
          reason:
              'the digest the user switched on last session must come '
              'back scheduled, not be actively cancelled by the launch sync',
        );
      },
    );
  });

  group('settings changes resync reminders IMMEDIATELY', () {
    test(
      'enabling the weekly digest schedules it with no add/cancel',
      () async {
        final _RecordingNotificationService notifier =
            _RecordingNotificationService();
        final ProviderContainer c = _container(_MemStore(), notifier);
        await c.read(subscriptionsControllerProvider.future);
        notifier.calls.clear();

        await c.read(settingsControllerProvider.notifier).toggle('weekly');
        await Future<void>.delayed(Duration.zero);

        expect(
          notifier.calls,
          contains('scheduleWeeklyDigest'),
          reason:
              'the toggle used to sit unread until the next subscription '
              'add/cancel — the trigger edge is the wiring under test',
        );
      },
    );

    test('disabling renewal alerts cancels them with no add/cancel', () async {
      final _RecordingNotificationService notifier =
          _RecordingNotificationService();
      final ProviderContainer c = _container(_MemStore(), notifier);
      await c.read(subscriptionsControllerProvider.future);
      notifier.calls.clear();

      // 'alerts' defaults ON; one toggle switches it off.
      await c.read(settingsControllerProvider.notifier).toggle('alerts');
      await Future<void>.delayed(Duration.zero);

      expect(
        notifier.calls,
        contains('cancelAll'),
        reason:
            'switching alerts off must unschedule the reminders NOW — '
            'otherwise they keep firing after the user said stop',
      );
    });
  });
}
