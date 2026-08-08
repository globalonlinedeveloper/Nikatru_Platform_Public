// ─────────────────────────────────────────────────────────────────────────────
// [13]T-9 — A NOTIFICATION TAP IS OBSERVABLE END TO END.
//
// 🔴 WHAT WAS BROKEN, MEASURED. `onDidReceiveNotificationResponse` — the plugin
// callback that fires when a user taps a notification — appeared ZERO times in
// Dart source tree-wide. `core.NotificationService` declared six methods and
// every one of them pointed outward. `AnalyticsFunnel.onNotificationOpened`
// existed with ZERO callers, and `assert-capability-register.mjs` printed that
// fact on every run (`⬜ … has ZERO emitters tree-wide`) without failing.
//
// So the outbound half worked perfectly and the inbound half did not exist, and
// NOTHING WENT RED — refusing to deliver a tap is indistinguishable from there
// being no tap. That is this repo's "fail-closed seam with no proven open path"
// shape, and four features shipped that way before.
//
// The tests below drive the REAL objects — the real `LocalNotificationService`,
// the real `NotificationTapObserver`, the real `AnalyticsFunnel` — and fake only
// the two ends nobody can run in a unit test: the plugin and the analytics sink.
// The tap enters where the OS would put it (the callback the adapter registered)
// and must come out the far end as `notification_opened`.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/src/local_notification_service_io.dart';
import 'package:subly/state/analytics_funnel.dart';
import 'package:subly/state/notification_tap_observer.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

/// The far end of the funnel: what actually reached analytics.
class _RecordingAnalytics implements core.Analytics {
  final List<({String event, Map<String, Object?>? params})> logged =
      <({String event, Map<String, Object?>? params})>[];

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async =>
      logged.add((event: event, params: params));

  @override
  Future<void> flush() async {}

  @override
  Future<void> purge() async => logged.clear();
}

/// The plugin, faked at the ONE place that matters: it keeps the tap sink the
/// service handed over, and refuses to invent one.
class _FakePlugin implements NotificationPlugin {
  void Function(core.NotificationTap tap)? onTap;
  int initializeCalls = 0;

  @override
  Future<void> initialize(void Function(core.NotificationTap tap) onTap) async {
    initializeCalls++;
    this.onTap = onTap;
  }

  /// 🔴 THROWS rather than no-ops when nothing registered. A fake that silently
  /// swallowed the tap would let the missing registration pass as a green test —
  /// the precise failure this file is a response to.
  void simulateTap({int id = 7, String? payload}) {
    final void Function(core.NotificationTap tap)? sink = onTap;
    if (sink == null) {
      throw StateError(
        'the service registered NO tap callback, so a real tap reaches nothing',
      );
    }
    sink(core.NotificationTap(id: id, payload: payload));
  }

  @override
  Future<bool> requestPermission() async => true;

  @override
  Future<void> showNow(int id, String title, String body) async {}

  @override
  Future<void> scheduleDaily(
    int id,
    String title,
    String body,
    tz.TZDateTime when,
  ) async {}

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}
}

void main() {
  setUpAll(tz_data.initializeTimeZones);
  tearDown(() => tz.setLocalLocation(tz.UTC));

  ({
    _FakePlugin plugin,
    _RecordingAnalytics analytics,
    LocalNotificationService service,
    NotificationTapObserver observer,
  })
  build({TargetPlatform platform = TargetPlatform.android}) {
    final _FakePlugin plugin = _FakePlugin();
    final _RecordingAnalytics analytics = _RecordingAnalytics();
    final LocalNotificationService service = LocalNotificationService(
      plugin: plugin,
      platform: platform,
      localTimezone: () async => 'UTC',
    );
    return (
      plugin: plugin,
      analytics: analytics,
      service: service,
      observer: NotificationTapObserver(
        service: service,
        funnel: AnalyticsFunnel(analytics: analytics),
      ),
    );
  }

  group('[13]T-9 a tap reaches the funnel as notification_opened', () {
    test(
      'init REGISTERS a tap callback with the plugin — the whole defect',
      () async {
        final w = build();
        expect(
          w.plugin.onTap,
          isNull,
          reason: 'nothing may be registered before init()',
        );

        await w.service.init();

        // 🔴 THE MUTATION TARGET. Drop the `_taps.add` argument from
        // `_plugin.initialize(...)` in local_notification_service_io.dart and
        // this is the assertion that goes red. Every other test in
        // packages/notifications stays green, because showing and scheduling
        // are untouched — which is exactly how the gap survived.
        expect(
          w.plugin.onTap,
          isNotNull,
          reason:
              'init() must hand the plugin port a tap sink, or a tap the '
              'OS delivers reaches no Dart code at all',
        );
      },
    );

    test('a simulated tap arrives as notification_opened{kind}', () async {
      final w = build();
      await w.service.init();
      w.observer.start();

      w.plugin.simulateTap(id: 7, payload: 'renewal');
      // The tap crosses a Stream and the funnel awaits its sink, so let both
      // microtask hops run before asserting.
      await Future<void>.delayed(Duration.zero);

      expect(w.analytics.logged.length, 1);
      expect(w.analytics.logged.single.event, 'notification_opened');
      expect(w.analytics.logged.single.params, <String, Object?>{
        'kind': 'renewal',
      });
    });

    test('nothing is logged until the observer is started', () async {
      final w = build();
      await w.service.init();

      w.plugin.simulateTap(payload: 'renewal');
      await Future<void>.delayed(Duration.zero);

      expect(
        w.analytics.logged,
        isEmpty,
        reason:
            'the subscription is consent-gated in app.dart; a tap before '
            'that must not be recorded',
      );
    });

    test('start() is idempotent — a rebuild cannot double-log a tap', () async {
      final w = build();
      await w.service.init();
      w.observer
        ..start()
        ..start()
        ..start();

      w.plugin.simulateTap(payload: 'renewal');
      await Future<void>.delayed(Duration.zero);

      expect(w.analytics.logged.length, 1);
    });

    test('stop() ends the subscription', () async {
      final w = build();
      await w.service.init();
      w.observer.start();
      expect(w.observer.isListening, isTrue);

      await w.observer.stop();
      expect(w.observer.isListening, isFalse);

      w.plugin.simulateTap(payload: 'renewal');
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged, isEmpty);
    });
  });

  group('the kind that reaches D1 is enumerable, not free text', () {
    // `notification_opened{kind}` is a D1 column. `onPurchaseFailed` already
    // documents why a raw string may not go there; the payload is worse, because
    // it round-trips through the OS and is attacker-influencable on some
    // platforms. These pin the sanitiser at the seam, not at the caller.
    for (final ({String? payload, String expected}) c
        in <({String? payload, String expected})>[
          (payload: 'renewal', expected: 'renewal'),
          (payload: 'weekly_digest', expected: 'weekly_digest'),
          (payload: null, expected: 'other'),
          (payload: '', expected: 'other'),
          (payload: 'Renewal', expected: 'other'), // uppercase is not a code
          (payload: 'a b', expected: 'other'), // whitespace is not a code
          (payload: '{"sql":"drop"}', expected: 'other'),
          (payload: 'x' * 33, expected: 'other'), // over the length cap
        ]) {
      test('payload ${c.payload == null ? 'null' : '"${c.payload}"'} '
          '→ kind "${c.expected}"', () async {
        final w = build();
        await w.service.init();
        w.observer.start();

        w.plugin.simulateTap(payload: c.payload);
        await Future<void>.delayed(Duration.zero);

        expect(w.analytics.logged.single.params!['kind'], c.expected);
      });
    }
  });

  test(
    'on a platform that cannot notify, init registers nothing and the stream '
    'stays silent',
    () async {
      // Windows on the pinned flutter_local_notifications 17.x. The stream must
      // EXIST and be silent rather than be absent, so no caller needs a
      // platform check of its own.
      final w = build(platform: TargetPlatform.windows);
      await w.service.init();
      w.observer.start();

      expect(w.plugin.initializeCalls, 0);
      expect(w.plugin.onTap, isNull);
      expect(w.service.notificationTaps(), isA<Stream<core.NotificationTap>>());
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged, isEmpty);
    },
  );
}
