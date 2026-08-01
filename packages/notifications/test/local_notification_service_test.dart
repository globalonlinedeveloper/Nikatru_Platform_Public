import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
// The plugin-backed service + its test seam live in the io library (the barrel
// deliberately does NOT export it, so web stays compilable). Tests run natively,
// where `dart.library.io` is available.
import 'package:nikatru_notifications/src/local_notification_service_io.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

/// Records which plugin operations the service decided to invoke, so the
/// platform-guard logic can be asserted without real platform channels.
class _FakePlugin implements NotificationPlugin {
  final List<String> calls = <String>[];
  final List<tz.TZDateTime> scheduledFor = <tz.TZDateTime>[];
  bool permission = true;

  @override
  Future<void> initialize() async => calls.add('initialize');

  @override
  Future<bool> requestPermission() async {
    calls.add('requestPermission');
    return permission;
  }

  @override
  Future<void> showNow(int id, String title, String body) async =>
      calls.add('showNow:$id');

  @override
  Future<void> scheduleDaily(
    int id,
    String title,
    String body,
    tz.TZDateTime when,
  ) async {
    calls.add('scheduleDaily:$id');
    scheduledFor.add(when);
  }

  @override
  Future<void> cancel(int id) async => calls.add('cancel:$id');

  @override
  Future<void> cancelAll() async => calls.add('cancelAll');
}

void main() {
  setUpAll(tz_data.initializeTimeZones);

  LocalNotificationService build(
    _FakePlugin plugin,
    TargetPlatform platform, {
    bool isWeb = false,
    TZDateTimeNow? now,
  }) =>
      LocalNotificationService(
        plugin: plugin,
        platform: platform,
        isWeb: isWeb,
        localTimezone: () async => 'UTC',
        now: now,
      );

  const DailyReminder reminder = DailyReminder(
    id: 7,
    title: 'Keep your streak',
    body: 'Do today\'s lesson',
    hour: 9,
    minute: 15,
  );

  group('supported platform (android)', () {
    test('init sets up the plugin', () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.android).init();
      expect(p.calls, contains('initialize'));
    });

    test('init is idempotent (initializes the plugin once)', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(p, TargetPlatform.android);
      await s.init();
      await s.init();
      expect(p.calls.where((String c) => c == 'initialize').length, 1);
    });

    test('requestPermission delegates and returns the plugin result', () async {
      final _FakePlugin p = _FakePlugin()..permission = true;
      expect(
        await build(p, TargetPlatform.android).requestPermission(),
        isTrue,
      );
      expect(p.calls, contains('requestPermission'));
    });

    test('showNow shows an immediate notification', () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.android).showNow(title: 'a', body: 'b');
      expect(p.calls.any((String c) => c.startsWith('showNow')), isTrue);
    });

    test('scheduleDaily schedules by reminder id', () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.android).scheduleDaily(reminder);
      expect(p.calls, contains('scheduleDaily:7'));
    });

    test('cancel / cancelAll delegate', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(p, TargetPlatform.android);
      await s.cancel(3);
      await s.cancelAll();
      expect(p.calls, containsAll(<String>['cancel:3', 'cancelAll']));
    });

    test('exposes canNotify + canSchedule capabilities', () {
      final LocalNotificationService s = build(
        _FakePlugin(),
        TargetPlatform.android,
      );
      expect(s.capabilities.canNotify, isTrue);
      expect(s.capabilities.canSchedule, isTrue);
    });
  });

  group('linux (show yes, repeat-schedule no)', () {
    test('scheduleDaily is a no-op (no zonedSchedule on Linux)', () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.linux).scheduleDaily(reminder);
      expect(p.calls, isNot(contains('scheduleDaily:7')));
    });

    test('showNow still works', () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.linux).showNow(title: 'a', body: 'b');
      expect(p.calls.any((String c) => c.startsWith('showNow')), isTrue);
    });

    test('cancel still delegates (Linux can dismiss a shown notification)',
        () async {
      final _FakePlugin p = _FakePlugin();
      await build(p, TargetPlatform.linux).cancel(9);
      expect(p.calls, contains('cancel:9'));
    });
  });

  // On the pinned flutter_local_notifications 17.x both Web (no plugin) and
  // Windows (no Windows plugin until 18.x) are fully unsupported: every op must
  // degrade to a no-op rather than throw.
  group('fully unsupported (web + windows on 17.x)', () {
    Future<void> expectAllNoOp(
        LocalNotificationService s, _FakePlugin p) async {
      await s.init();
      expect(await s.requestPermission(), isFalse);
      await s.showNow(title: 'a', body: 'b');
      await s.scheduleDaily(reminder);
      await s.cancel(1);
      await s.cancelAll();
      expect(p.calls, isEmpty);
    }

    test('web never touches the plugin', () async {
      final _FakePlugin p = _FakePlugin();
      await expectAllNoOp(build(p, TargetPlatform.android, isWeb: true), p);
    });

    test('windows never touches the plugin', () async {
      final _FakePlugin p = _FakePlugin();
      await expectAllNoOp(build(p, TargetPlatform.windows), p);
    });
  });

  group('nextInstanceOfTime', () {
    test('returns today when the time is still ahead', () {
      final tz.TZDateTime now = tz.TZDateTime(tz.UTC, 2026, 1, 1, 6, 0);
      expect(
        nextInstanceOfTime(9, 0, now),
        tz.TZDateTime(tz.UTC, 2026, 1, 1, 9, 0),
      );
    });

    test('rolls to tomorrow when the time already passed today', () {
      final tz.TZDateTime now = tz.TZDateTime(tz.UTC, 2026, 1, 1, 10, 0);
      expect(
        nextInstanceOfTime(9, 0, now),
        tz.TZDateTime(tz.UTC, 2026, 1, 2, 9, 0),
      );
    });

    test('rolls to tomorrow when the time equals now (strictly after)', () {
      final tz.TZDateTime now = tz.TZDateTime(tz.UTC, 2026, 1, 1, 9, 0);
      expect(
        nextInstanceOfTime(9, 0, now),
        tz.TZDateTime(tz.UTC, 2026, 1, 2, 9, 0),
      );
    });
  });

  test(
    'scheduleDaily anchors at the next local instance of the reminder time',
    () async {
      final _FakePlugin p = _FakePlugin();
      final tz.TZDateTime now = tz.TZDateTime(tz.UTC, 2026, 1, 1, 6, 0);
      await build(
        p,
        TargetPlatform.android,
        now: () => now,
      ).scheduleDaily(reminder);
      expect(p.scheduledFor.single, tz.TZDateTime(tz.UTC, 2026, 1, 1, 9, 15));
    },
  );

  // ── LOCAL TIME REALLY MEANS LOCAL ──────────────────────────────────────────
  // 🔴 THE GAP THESE TESTS EXIST TO CLOSE. Every test above injects
  // `localTimezone: () async => 'UTC'`, and UTC is the ONE value where the bug
  // and the correct behaviour are identical — so the whole suite was green while
  // a reminder core documents as "at [hour]:[minute] local time" was built at
  // that hour in UTC, i.e. 14:30 IST for a 09:00 reminder and the middle of the
  // night across the Americas.
  //
  // The offset is INJECTED rather than read from the host, because a test that
  // used the real `DateTime.now().timeZoneOffset` would assert nothing on a UTC
  // CI runner — the same blindness in a different costume.
  group('the local-vs-UTC difference is asserted, not assumed', () {
    // `tz.local` is process-global and `init()` sets it. Put it back so a later
    // test file (or a later test here) cannot inherit a device zone.
    tearDown(() => tz.setLocalLocation(tz.UTC));

    const Duration ist = Duration(hours: 5, minutes: 30);

    test(
      'with NO resolver a 09:15 reminder fires at 09:15 DEVICE-local, '
      'which is NOT 09:15 UTC',
      () async {
        final _FakePlugin p = _FakePlugin();
        final LocalNotificationService s = LocalNotificationService(
          plugin: p,
          platform: TargetPlatform.android,
          // No localTimezone at all — the exact wiring every consumer has.
          deviceUtcOffset: () => ist,
          // Read INSIDE the closure so it sees the location init() installed.
          now: () => tz.TZDateTime(tz.local, 2026, 1, 1, 6, 0),
        );

        await s.init();
        await s.scheduleDaily(reminder);

        final tz.TZDateTime when = p.scheduledFor.single;
        expect(
          <int>[when.hour, when.minute],
          <int>[9, 15],
          reason: 'the wall clock the user reads must say 09:15',
        );
        // The assertion that fails against the old UTC default: the same
        // instant expressed in UTC must be 5h30m EARLIER, not identical.
        expect(
          <int>[when.toUtc().hour, when.toUtc().minute],
          <int>[3, 45],
          reason: 'a 09:15 IST reminder is 03:45 UTC; if this reads 09:15 the '
              'service is scheduling in UTC and firing 5h30m late',
        );
      },
    );

    test('a negative offset works too — the sign is not assumed', () {
      final tz.Location loc = deviceOffsetLocation(const Duration(hours: -8));
      final tz.TZDateTime when = tz.TZDateTime(loc, 2026, 1, 1, 9, 0);
      expect(when.toUtc().hour, 17);
      expect(when.toUtc().day, 1);
    });

    test('an injected IANA zone still wins over the device offset', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = LocalNotificationService(
        plugin: p,
        platform: TargetPlatform.android,
        localTimezone: () async => 'Asia/Kolkata',
        // Deliberately disagrees with the zone above: if the fallback were
        // used, `when.toUtc()` would land an hour off.
        deviceUtcOffset: () => const Duration(hours: 6, minutes: 30),
        now: () => tz.TZDateTime(tz.local, 2026, 1, 1, 6, 0),
      );

      await s.init();
      await s.scheduleDaily(reminder);

      expect(tz.local.name, 'Asia/Kolkata');
      expect(<int>[
        p.scheduledFor.single.toUtc().hour,
        p.scheduledFor.single.toUtc().minute
      ], <int>[
        3,
        45
      ]);
    });

    test(
      'a resolver that throws falls back to the DEVICE offset, never to UTC',
      () async {
        final _FakePlugin p = _FakePlugin();
        final LocalNotificationService s = LocalNotificationService(
          plugin: p,
          platform: TargetPlatform.android,
          localTimezone: () async => throw StateError('no platform channel'),
          deviceUtcOffset: () => ist,
          now: () => tz.TZDateTime(tz.local, 2026, 1, 1, 6, 0),
        );

        await s.init();
        await s.scheduleDaily(reminder);

        expect(
          <int>[
            p.scheduledFor.single.toUtc().hour,
            p.scheduledFor.single.toUtc().minute,
          ],
          <int>[3, 45],
          reason: 'the old code caught the throw and installed UTC, which is a '
              'wrong answer dressed as a safe one',
        );
      },
    );

    test('an unknown zone name falls back to the DEVICE offset too', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = LocalNotificationService(
        plugin: p,
        platform: TargetPlatform.android,
        localTimezone: () async => 'Mars/Olympus_Mons',
        deviceUtcOffset: () => ist,
        now: () => tz.TZDateTime(tz.local, 2026, 1, 1, 6, 0),
      );

      await s.init();
      await s.scheduleDaily(reminder);

      expect(
        <int>[
          p.scheduledFor.single.toUtc().hour,
          p.scheduledFor.single.toUtc().minute,
        ],
        <int>[3, 45],
      );
    });
  });
}
