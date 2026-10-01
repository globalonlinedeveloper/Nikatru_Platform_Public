import 'dart:async';

import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
// The plugin-backed service + its test seam live in the io library (the barrel
// deliberately does NOT export it, so web stays compilable). Tests run natively,
// where `dart.library.io` is available.
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show
        LinuxReminderScheduler,
        MemoryReminderLedgerStore,
        WindowsNotificationIdentity;
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

  /// Every immediate show, with its payload — the Linux scheduler's output.
  final List<({int id, String title, String? payload})> shown =
      <({int id, String title, String? payload})>[];

  @override
  Future<void> showNow(
    int id,
    String title,
    String body, {
    String? payload,
  }) async {
    calls.add('showNow:$id');
    shown.add((id: id, title: title, payload: payload));
  }

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

  /// Every one-off, in order.
  final List<_Once> once = <_Once>[];
  bool exactAllowed = true;

  /// Refuse the FIRST exact schedule the way Android does when the user
  /// revoked "Alarms & reminders" between the check and the post.
  bool refuseExactOnce = false;
  List<int> pending = <int>[];
  bool pendingThrows = false;

  @override
  Future<void> scheduleOnce(
    int id,
    String title,
    String body,
    tz.TZDateTime when, {
    required bool exact,
    String? payload,
    NotificationChannel? channel,
    List<NotificationAction> actions = const <NotificationAction>[],
  }) async {
    if (exact && refuseExactOnce) {
      refuseExactOnce = false;
      throw PlatformException(code: 'exact_alarms_not_permitted');
    }
    calls.add('scheduleOnce:$id');
    once.add(_Once(id, when, exact, payload, channel?.id, actions));
  }

  @override
  Future<bool> canScheduleExact() async => exactAllowed;

  /// What the user answers on the "Alarms & reminders" page.
  bool grantExactOnRequest = true;

  @override
  Future<bool> requestExactAlarms() async {
    calls.add('requestExactAlarms');
    exactAllowed = grantExactOnRequest;
    return exactAllowed;
  }

  /// What the OS reports as the tap that launched the process.
  NotificationTap? launchedBy;

  @override
  Future<NotificationTap?> launchTap() async {
    calls.add('launchTap');
    return launchedBy;
  }

  @override
  Future<List<int>> pendingIds() async {
    if (pendingThrows) throw StateError('no pending list here');
    return pending;
  }

  @override
  Future<void> cancel(int id) async => calls.add('cancel:$id');

  @override
  Future<void> cancelAll() async => calls.add('cancelAll');
}

class _Once {
  _Once(
    this.id,
    this.when,
    this.exact,
    this.payload,
    this.channel, [
    this.actions = const <NotificationAction>[],
  ]);
  final int id;
  final tz.TZDateTime when;
  final bool exact;
  final String? payload;
  final String? channel;
  final List<NotificationAction> actions;
}

/// A fake clock and timer pair: the scheduler's timer is captured, and
/// [advance] moves the clock and fires every timer whose moment has come —
/// so "fires at its instant" is asserted without a real wait.
class _FakeTime {
  _FakeTime(this.now);

  DateTime now;
  final List<_FakeTimer> timers = <_FakeTimer>[];

  Timer timer(Duration delay, void Function() fire) {
    final _FakeTimer t = _FakeTimer(now.add(delay), fire);
    timers.add(t);
    return t;
  }

  Future<void> advance(Duration by) async {
    final DateTime end = now.add(by);
    while (true) {
      final List<_FakeTimer> due =
          timers
              .where((_FakeTimer t) => t.isActive && !t.at.isAfter(end))
              .toList()
            ..sort((_FakeTimer a, _FakeTimer b) => a.at.compareTo(b.at));
      if (due.isEmpty) break;
      final _FakeTimer t = due.first;
      now = t.at.isAfter(now) ? t.at : now;
      t.fireNow();
      // Let the scheduler's async show/re-arm chain run.
      for (int i = 0; i < 20; i++) {
        await Future<void>.delayed(Duration.zero);
      }
    }
    now = end;
  }
}

class _FakeTimer implements Timer {
  _FakeTimer(this.at, this._fire);
  final DateTime at;
  final void Function() _fire;
  bool _active = true;

  void fireNow() {
    if (!_active) return;
    _active = false;
    _fire();
  }

  @override
  void cancel() => _active = false;

  @override
  bool get isActive => _active;

  @override
  int get tick => 0;
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
    WindowsNotificationIdentity? windows,
    LinuxReminderScheduler? linux,
  }) => LocalNotificationService(
    plugin: plugin,
    platform: platform,
    isWeb: isWeb,
    localTimezone: () async => 'UTC',
    now: now,
    windows: windows,
    // Never the real `$XDG_DATA_HOME` ledger from a test.
    linuxScheduler:
        linux ??
        LinuxReminderScheduler(
          store: MemoryReminderLedgerStore(),
          show: (int id, String t, String b, String? p) =>
              plugin.showNow(id, t, b, payload: p),
          timer: (Duration d, void Function() f) => Timer(Duration.zero, () {}),
        ),
  );

  const WindowsNotificationIdentity identity = WindowsNotificationIdentity(
    appName: 'Probe',
    appUserModelId: 'Nikatru.Probe_0000000000000!probe',
    toastActivatorClsid: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
  );

  // A fixed "now" so a wall clock can be asserted as an exact instant.
  tz.TZDateTime fixedNow() => tz.TZDateTime(tz.UTC, 2026, 10, 1, 8);

  ScheduledNotification one(int id, DateTime at, {String? payload}) =>
      ScheduledNotification(
        id: id,
        title: 't$id',
        body: 'b$id',
        at: at,
        payload: payload,
        channel: const NotificationChannel(
          id: 'renewals',
          name: 'Renewals',
          description: 'd',
          important: true,
        ),
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

  // ── ST-R4: the one-off half of the seam ────────────────────────────────────
  group('scheduleAt / reconcile (android)', () {
    test('scheduleAt posts the wall clock, with payload and channel',
        () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.init();
      await s.scheduleAt(
        one(5, DateTime(2026, 10, 3, 9, 30), payload: 'sub:a'),
      );
      expect(p.once.single.id, 5);
      expect(
        p.once.single.when.millisecondsSinceEpoch,
        DateTime.utc(2026, 10, 3, 9, 30).millisecondsSinceEpoch,
      );
      expect(p.once.single.payload, 'sub:a');
      expect(p.once.single.channel, 'renewals');
      expect(p.once.single.exact, isTrue);
    });

    test('an instant already past posts nothing', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.scheduleAt(one(5, DateTime(2026, 10, 1, 7, 59)));
      expect(p.once, isEmpty);
    });

    test('exact refused mid-batch retries INEXACT and keeps going', () async {
      final _FakePlugin p = _FakePlugin()..refuseExactOnce = true;
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.reconcile(<ScheduledNotification>[
        one(1, DateTime(2026, 10, 2, 9)),
        one(2, DateTime(2026, 10, 3, 9)),
      ], owns: (int id) => id < 100);
      expect(p.once.map((_Once e) => e.id), <int>[1, 2]);
      expect(p.once.first.exact, isFalse);
      expect(p.once.last.exact, isTrue);
    });

    test('no exact-alarm permission schedules inexact', () async {
      final _FakePlugin p = _FakePlugin()..exactAllowed = false;
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.scheduleAt(one(1, DateTime(2026, 10, 2, 9)));
      expect(p.once.single.exact, isFalse);
    });

    test('reconcile cancels owned pending ids and never an unowned one',
        () async {
      final _FakePlugin p = _FakePlugin()..pending = <int>[1, 7, 42, 900];
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.reconcile(<ScheduledNotification>[
        one(7, DateTime(2026, 10, 2, 9)),
      ], owns: (int id) => id >= 5 && id < 100);
      expect(p.calls, containsAll(<String>['cancel:7', 'cancel:42']));
      expect(p.calls, isNot(contains('cancel:1')));
      expect(p.calls, isNot(contains('cancel:900')));
      expect(p.calls, isNot(contains('cancelAll')));
      expect(p.once.map((_Once e) => e.id), <int>[7]);
    });

    test('an unreadable pending list falls back to this process ids',
        () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s =
          build(p, TargetPlatform.android, now: fixedNow);
      await s.reconcile(<ScheduledNotification>[
        one(10, DateTime(2026, 10, 2, 9)),
      ], owns: (int id) => true);
      p.pendingThrows = true;
      await s.reconcile(
        const <ScheduledNotification>[],
        owns: (int id) => true,
      );
      expect(p.calls, contains('cancel:10'));
    });
  });

  group('takeLaunchTap (ST-R5: a tap that cold-starts the app)', () {
    test('returns the launch tap once, then null', () async {
      final _FakePlugin p = _FakePlugin()
        ..launchedBy = const NotificationTap(id: 9, payload: 'sub:abc');
      final LocalNotificationService s = build(p, TargetPlatform.android);
      await s.init();
      expect((await s.takeLaunchTap())?.payload, 'sub:abc');
      expect(await s.takeLaunchTap(), isNull);
      expect(p.calls.where((String c) => c == 'launchTap').length, 1);
    });

    test('before init, or where nothing can notify, is null', () async {
      final _FakePlugin p = _FakePlugin()
        ..launchedBy = const NotificationTap(id: 9, payload: 'sub:abc');
      expect(await build(p, TargetPlatform.android).takeLaunchTap(), isNull);
      final LocalNotificationService web =
          build(p, TargetPlatform.android, isWeb: true);
      await web.init();
      expect(await web.takeLaunchTap(), isNull);
      expect(p.calls, isNot(contains('launchTap')));
    });
  });

  group('windows (ST-R4: on with the app identity, off without)', () {
    test('with an identity: shows and schedules one-offs', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(
        p,
        TargetPlatform.windows,
        now: fixedNow,
        windows: identity,
      );
      expect(s.capabilities.canNotify, isTrue);
      expect(s.capabilities.canSchedule, isTrue);
      await s.init();
      await s.scheduleAt(one(3, DateTime(2026, 10, 2, 9)));
      expect(p.calls, containsAll(<String>['initialize', 'scheduleOnce:3']));
    });

    test('without one: neither, and the plugin is never touched', () async {
      final _FakePlugin p = _FakePlugin();
      final LocalNotificationService s = build(p, TargetPlatform.windows);
      expect(s.capabilities.canNotify, isFalse);
      expect(s.capabilities.canSchedule, isFalse);
      await s.init();
      await s.scheduleAt(one(3, DateTime(2030, 1, 1, 9)));
      expect(p.calls, isEmpty);
    });
  });

  group('linux (NO-04: this package schedules; the plugin only shows)', () {
    // A fake clock in UTC: `tz.local` is UTC under these tests, so a wall
    // clock and an instant agree and the assertion is exact.
    late _FakeTime time;
    late _FakePlugin p;
    late MemoryReminderLedgerStore ledger;

    LinuxReminderScheduler scheduler() => LinuxReminderScheduler(
      store: ledger,
      show: (int id, String t, String b, String? pl) =>
          p.showNow(id, t, b, payload: pl),
      now: () => time.now,
      timer: time.timer,
    );

    LocalNotificationService linux() => build(
      p,
      TargetPlatform.linux,
      now: () => tz.TZDateTime.from(time.now, tz.UTC),
      linux: scheduler(),
    );

    setUp(() {
      time = _FakeTime(DateTime.utc(2026, 10, 1, 8));
      p = _FakePlugin();
      ledger = MemoryReminderLedgerStore();
    });

    test('RED CONTROL: a fake clock fires a reminder AT its instant', () async {
      final LocalNotificationService s = linux();
      await s.init();
      await s.scheduleAt(
        one(3, DateTime(2026, 10, 1, 9, 30), payload: 'sub:a'),
      );
      // Never through the plugin's zonedSchedule, which Linux lacks.
      expect(p.once, isEmpty);
      await time.advance(const Duration(minutes: 89));
      expect(p.shown, isEmpty, reason: 'one minute early');
      await time.advance(const Duration(minutes: 1));
      expect(p.shown.map((r) => r.id), <int>[3]);
      expect(p.shown.single.payload, 'sub:a');
      // Shown once: the ledger no longer holds it.
      await time.advance(const Duration(hours: 3));
      expect(p.shown, hasLength(1));
      expect(await scheduler().pendingIds(), isEmpty);
    });

    test(
      'a reminder missed while closed shows once at the next launch',
      () async {
        await linux().scheduleAt(one(4, DateTime(2026, 10, 1, 9)));
        // The app is closed; the next launch is at 10:00.
        time.now = DateTime.utc(2026, 10, 1, 10);
        final _FakePlugin relaunched = p = _FakePlugin();
        await linux().init();
        expect(relaunched.shown.map((r) => r.id), <int>[4]);
        // ...and the login-time `--remind` after it finds nothing left.
        expect(await linux().showDueReminders(), 0);
      },
    );

    test('reconcile replaces the owned ledger set, leaving others', () async {
      final LocalNotificationService s = linux();
      await s.scheduleAt(one(1, DateTime(2026, 10, 2, 9)));
      await s.scheduleAt(one(50, DateTime(2026, 10, 2, 9)));
      await s.reconcile(<ScheduledNotification>[
        one(51, DateTime(2026, 10, 3, 9)),
      ], owns: (int id) => id >= 50);
      expect((await scheduler().pendingIds())..sort(), <int>[1, 51]);
    });

    test('scheduleDaily holds the next instance in the ledger', () async {
      await linux().scheduleDaily(reminder);
      expect(await scheduler().pendingIds(), <int>[7]);
      expect(p.calls, isNot(contains('scheduleDaily:7')));
    });

    test('cancel removes a pending reminder before it fires', () async {
      final LocalNotificationService s = linux();
      await s.init();
      await s.scheduleAt(one(9, DateTime(2026, 10, 1, 9)));
      await s.cancel(9);
      expect(p.calls, contains('cancel:9'));
      await time.advance(const Duration(hours: 2));
      expect(p.shown, isEmpty);
    });

    test('showNow still works', () async {
      await linux().showNow(title: 'a', body: 'b');
      expect(p.calls.any((String c) => c.startsWith('showNow')), isTrue);
    });

    test('never exact, and carries no actions', () async {
      final LocalNotificationService s = linux();
      expect(s.capabilities.exactTime, isFalse);
      expect(await s.canScheduleExact(), isFalse);
    });
  });

  group('actions (NO-10) and exact alarms (NO-12)', () {
    const List<NotificationAction> buttons = <NotificationAction>[
      NotificationAction(id: 'paid', title: 'Mark as paid'),
      NotificationAction(id: 'snooze', title: 'Snooze 1 day'),
    ];
    ScheduledNotification withButtons(int id) => ScheduledNotification(
      id: id,
      title: 't',
      body: 'b',
      at: DateTime(2030, 1, 1, 9),
      payload: 'sub:x',
      actions: buttons,
    );

    test('Android, iOS, macOS and Windows post the buttons', () async {
      for (final TargetPlatform t in <TargetPlatform>[
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.macOS,
        TargetPlatform.windows,
      ]) {
        final _FakePlugin p = _FakePlugin();
        await build(p, t, windows: identity).scheduleAt(withButtons(1));
        expect(
          p.once.single.actions.map((NotificationAction a) => a.id),
          <String>['paid', 'snooze'],
          reason: '$t',
        );
      }
    });

    test(
      'a button press arrives with its action id; a body tap without',
      () async {
        final _FakePlugin p = _FakePlugin();
        final LocalNotificationService s = build(p, TargetPlatform.android);
        await s.init();
        final List<NotificationTap> got = <NotificationTap>[];
        s.notificationTaps().listen(got.add);
        p.onTap!(
          const NotificationTap(id: 1, payload: 'sub:x', actionId: 'paid'),
        );
        p.onTap!(const NotificationTap(id: 1, payload: 'sub:x'));
        await Future<void>.delayed(Duration.zero);
        expect(got.map((NotificationTap t) => t.actionId), <String?>[
          'paid',
          null,
        ]);
      },
    );

    test('requestExactAlarms opens the page and reads the answer', () async {
      final _FakePlugin p = _FakePlugin()
        ..exactAllowed = false
        ..grantExactOnRequest = false;
      final LocalNotificationService s = build(p, TargetPlatform.android);
      expect(await s.requestExactAlarms(), isFalse);
      expect(p.calls, contains('requestExactAlarms'));
      p.grantExactOnRequest = true;
      expect(await s.requestExactAlarms(), isTrue);
    });

    test(
      'a second-precision instant is honoured (the 10 s test reminder)',
      () async {
        final _FakePlugin p = _FakePlugin();
        await build(
          p,
          TargetPlatform.android,
          now: fixedNow,
        ).scheduleAt(one(5, DateTime(2026, 10, 1, 8, 0, 10)));
        expect(
          p.once.single.when.toUtc(),
          DateTime.utc(2026, 10, 1, 8, 0, 10),
        );
      },
    );
  });

  // Web (no plugin) and Windows WITHOUT the app's identity (the plugin cannot
  // start) are fully unsupported: every op must degrade to a no-op, not throw.
  group('fully unsupported (web, and windows without an identity)', () {
    Future<void> expectAllNoOp(
      LocalNotificationService s,
      _FakePlugin p,
    ) async {
      await s.init();
      expect(await s.requestPermission(), isFalse);
      await s.showNow(title: 'a', body: 'b');
      await s.scheduleDaily(reminder);
      await s.scheduleAt(one(2, DateTime(2030, 1, 1, 9)));
      await s.reconcile(
        const <ScheduledNotification>[],
        owns: (int _) => true,
      );
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
