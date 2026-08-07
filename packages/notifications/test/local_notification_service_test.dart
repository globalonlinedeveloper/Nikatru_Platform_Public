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

  /// The tap sink the service handed over at [initialize] — i.e. the
  /// REGISTRATION itself, captured rather than assumed. Null means the service
  /// never registered, which is exactly the defect [13]T-9 closes, so the tests
  /// below assert on this being non-null rather than on a call-name string.
  void Function(NotificationTap tap)? onTap;

  @override
  Future<void> initialize(void Function(NotificationTap tap) onTap) async {
    calls.add('initialize');
    this.onTap = onTap;
  }

  /// Fires a tap the way the OS would: through the callback the ADAPTER
  /// registered. Throws rather than no-ops when nothing registered — a fake that
  /// silently swallowed the tap would make the missing registration look like a
  /// passing test, which is the failure mode this whole file exists under.
  void simulateTap({int id = 7, String? payload}) {
    final void Function(NotificationTap tap)? sink = onTap;
    if (sink == null) {
      throw StateError(
        'no tap callback was registered — the service never handed the plugin '
        'port a sink, so a real tap would reach nothing',
      );
    }
    sink(NotificationTap(id: id, payload: payload));
  }

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

/// One zone the resolver can name, paired with what a 02:00 reminder MUST
/// become in it. The expectation is written as an ABSOLUTE UTC instant rather
/// than as arithmetic over [utcOffset], so the test cannot re-derive its answer
/// with the same mistake the code under test might be making.
typedef _ZoneCase = ({String zone, Duration utcOffset, List<int> utcYmdHm});

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

    // ── [13]T-9 THE INBOUND HALF ─────────────────────────────────────────────
    // Everything above this line is OUTBOUND: show, schedule, cancel. All of it
    // was green while `onDidReceiveNotificationResponse` appeared ZERO times in
    // the tree and a tapped reminder opened nothing — the outbound tests cannot
    // see the inbound gap, which is the entire reason it survived.
    test('init hands the plugin port a tap sink', () async {
      final _FakePlugin p = _FakePlugin();
      expect(p.onTap, isNull);
      await build(p, TargetPlatform.android).init();
      expect(
        p.onTap,
        isNotNull,
        reason: 'without this the adapter has nothing to register with '
            'onDidReceiveNotificationResponse',
      );
    });

    test('a plugin tap surfaces on notificationTaps()', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(p, TargetPlatform.android);
      await s.init();

      final Future<NotificationTap> first = s.notificationTaps().first;
      p.simulateTap(id: 42, payload: 'renewal');

      final NotificationTap tap = await first;
      expect(tap.id, 42);
      expect(tap.kind, 'renewal');
    });

    test('notificationTaps() is broadcast — two listeners both get it',
        () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(p, TargetPlatform.android);
      await s.init();

      final Future<NotificationTap> a = s.notificationTaps().first;
      final Future<NotificationTap> b = s.notificationTaps().first;
      p.simulateTap(id: 3);

      expect((await a).id, 3);
      expect((await b).id, 3);
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

    test(
      'cancel still delegates (Linux can dismiss a shown notification)',
      () async {
        final _FakePlugin p = _FakePlugin();
        await build(p, TargetPlatform.linux).cancel(9);
        expect(p.calls, contains('cancel:9'));
      },
    );
  });

  // On the pinned flutter_local_notifications 17.x both Web (no plugin) and
  // Windows (no Windows plugin until 18.x) are fully unsupported: every op must
  // degrade to a no-op rather than throw.
  group('fully unsupported (web + windows on 17.x)', () {
    Future<void> expectAllNoOp(
      LocalNotificationService s,
      _FakePlugin p,
    ) async {
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
        'which is NOT 09:15 UTC', () async {
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
    });

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
      expect(
        <int>[
          p.scheduledFor.single.toUtc().hour,
          p.scheduledFor.single.toUtc().minute,
        ],
        <int>[3, 45],
      );
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

  // ── [13]T-3: THE RESOLVER PATH, PINNED IN TWO ZONES ────────────────────────
  // The group above pins the BARE-DEVICE path (no resolver) and both of its
  // fallbacks. What it cannot pin is the resolver path, and one zone is not
  // enough to pin that: an assertion about 'Asia/Kolkata' alone passes equally
  // well against a service that hard-codes that zone, ignores the resolver
  // entirely, or merely inherited `tz.local` from an earlier test. Two zones
  // driven through the SAME reminder rule all three out — the only way both
  // can be right is if the resolver's answer is what reaches the port.
  //
  // 02:00 is chosen, not incidental: at that wall clock the two zones fall on
  // DIFFERENT UTC calendar days (Kolkata is the previous day in UTC, Los
  // Angeles the same day). A mid-afternoon hour keeps both on one date and
  // hides every date-rollover error; this hour makes the rollover testable.
  group('[13]T-3 the resolver decides the zone — proven in two of them', () {
    // `tz.local` is process-global and `init()` sets it. Put it back so no
    // later test can inherit a zone this group installed.
    tearDown(() => tz.setLocalLocation(tz.UTC));

    const DailyReminder earlyReminder = DailyReminder(
      id: 21,
      title: 'Early bird',
      body: '02:00 on the user\'s own wall clock',
      hour: 2,
      minute: 0,
    );

    const List<_ZoneCase> cases = <_ZoneCase>[
      // +05:30, no DST. 02:00 on the 2nd is 20:30 UTC on the 1st.
      (
        zone: 'Asia/Kolkata',
        utcOffset: Duration(hours: 5, minutes: 30),
        utcYmdHm: <int>[2026, 1, 1, 20, 30],
      ),
      // -08:00 in January (PST). 02:00 on the 2nd is 10:00 UTC on the 2nd.
      (
        zone: 'America/Los_Angeles',
        utcOffset: Duration(hours: -8),
        utcYmdHm: <int>[2026, 1, 2, 10, 0],
      ),
    ];

    /// Schedules [earlyReminder] with a resolver that names [zone], and returns
    /// the instant that actually reached the plugin port.
    Future<tz.TZDateTime> scheduleIn(String zone) async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = LocalNotificationService(
        plugin: p,
        platform: TargetPlatform.android,
        localTimezone: () async => zone,
        // An offset NEITHER case is on. If the resolver were ignored and the
        // device fallback taken, the zone name below reads `device+0945` and
        // every instant is wrong — the fallback cannot fake a pass here.
        deviceUtcOffset: () => const Duration(hours: 9, minutes: 45),
        // Read INSIDE the closure so it sees the location init() installed.
        now: () => tz.TZDateTime(tz.local, 2026, 1, 1, 6, 0),
      );
      await s.init();
      await s.scheduleDaily(earlyReminder);
      return p.scheduledFor.single;
    }

    for (final _ZoneCase c in cases) {
      test('a 02:00 reminder resolves into ${c.zone}', () async {
        final tz.TZDateTime when = await scheduleIn(c.zone);

        expect(
          when.location.name,
          c.zone,
          reason: 'the TZDateTime handed to the plugin must carry the zone the '
              'resolver named, not whatever tz.local happened to already be',
        );
        expect(tz.local.name, c.zone);

        expect(
          <int>[when.hour, when.minute],
          <int>[2, 0],
          reason: 'the wall clock the user reads in ${c.zone} must say 02:00',
        );
        expect(
          when.timeZoneOffset,
          c.utcOffset,
          reason: '${c.zone} is ${c.utcOffset} from UTC on this date',
        );

        final tz.TZDateTime utc = when.toUtc();
        expect(
          <int>[utc.year, utc.month, utc.day, utc.hour, utc.minute],
          c.utcYmdHm,
          reason: '02:00 in ${c.zone} is one fixed instant; if the UTC DATE is '
              'wrong the reminder fires a day out, which an hour-only '
              'assertion would never see',
        );
      });
    }

    // Guards the pair above against being quietly re-tuned to a convenient
    // hour. The whole reason for 02:00 is that the two zones straddle the UTC
    // date boundary; move the reminder to 09:15 and every assertion above
    // still passes while this one goes red.
    test('the two zones fall on DIFFERENT UTC calendar days', () async {
      final tz.TZDateTime kolkata = await scheduleIn('Asia/Kolkata');
      final tz.TZDateTime la = await scheduleIn('America/Los_Angeles');

      expect(
        kolkata.day,
        la.day,
        reason: 'both reminders are the same LOCAL calendar day…',
      );
      expect(
        kolkata.toUtc().day,
        isNot(la.toUtc().day),
        reason: '…but land on different UTC days. That straddle is the '
            'coverage this pair exists to provide; if it ever stops being '
            'true, the two-zone test has lost its point',
      );
    });
  });
}
