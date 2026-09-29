// [13]T-9 and ST-R5 — what a TAPPED notification does.
//
// T-9: `notification_opened` had zero emitters for as long as the seam had no
// inbound half; the observer is the one wire from a tap to the funnel.
// ST-R5 (audit C27): a tap was logged and routed NOWHERE, so a renewal
// reminder opened the app wherever it had been. Every reminder now carries
// `sub:{id}`, and [NotificationTapRouter] opens `/sub/{id}` — for a tap on a
// running app AND for the tap that cold-starts it, which the OS delivers as
// launch details and never on the tap stream.
//
// ⏱ 2026-09-28 (ST-R4): driven through the core seam. That the adapter
// registers its tap callback with the plugin at all is proven in
// packages/notifications/test/tap_registration_test.dart.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/analytics_funnel.dart';
import 'package:subscriptiontracker/state/notification_tap_observer.dart';

import 'support/recording_seam.dart';

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

void main() {
  ({
    RecordingSeam seam,
    _RecordingAnalytics analytics,
    NotificationTapObserver observer,
  })
  build() {
    final RecordingSeam seam = RecordingSeam();
    final _RecordingAnalytics analytics = _RecordingAnalytics();
    return (
      seam: seam,
      analytics: analytics,
      observer: NotificationTapObserver(
        service: seam,
        funnel: AnalyticsFunnel(analytics: analytics),
      ),
    );
  }

  group('[13]T-9 a tap reaches the funnel as notification_opened', () {
    test('a tap arrives as notification_opened{kind}', () async {
      final w = build();
      w.observer.start();
      w.seam.taps.add(const core.NotificationTap(id: 7, payload: 'renewal'));
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged.single.event, 'notification_opened');
      expect(w.analytics.logged.single.params, <String, Object?>{
        'kind': 'renewal',
      });
    });

    test('nothing is logged until the observer is started', () async {
      final w = build();
      w.seam.taps.add(const core.NotificationTap(id: 7, payload: 'renewal'));
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged, isEmpty);
    });

    test('start() is idempotent — a rebuild cannot double-log a tap', () async {
      final w = build();
      w.observer
        ..start()
        ..start();
      w.seam.taps.add(const core.NotificationTap(id: 7, payload: 'renewal'));
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged.length, 1);
    });

    test('stop() ends the subscription', () async {
      final w = build();
      w.observer.start();
      await w.observer.stop();
      expect(w.observer.isListening, isFalse);
      w.seam.taps.add(const core.NotificationTap(id: 7, payload: 'renewal'));
      await Future<void>.delayed(Duration.zero);
      expect(w.analytics.logged, isEmpty);
    });

    test(
      'a sub:{id} payload is logged as kind "other", never the id',
      () async {
        final w = build();
        w.observer.start();
        w.seam.taps.add(const core.NotificationTap(id: 7, payload: 'sub:abc'));
        await Future<void>.delayed(Duration.zero);
        expect(w.analytics.logged.single.params!['kind'], 'other');
      },
    );
  });

  group('ST-R5 a tap opens the subscription it names', () {
    test('the payload every reminder carries routes to /sub/{id}', () {
      expect(RenewalReminders.payloadFor('abc'), 'sub:abc');
      expect(routeForNotificationPayload('sub:abc'), '/sub/abc');
    });

    for (final String? junk in <String?>[
      null,
      '',
      'renewal',
      'sub:',
      'sub:../settings',
      'sub:a b',
      'sub:${'x' * 129}',
      'SUB:abc',
    ]) {
      test('an untrusted payload ${junk == null ? 'null' : '"$junk"'} goes '
          'nowhere', () {
        expect(routeForNotificationPayload(junk), isNull);
      });
    }

    test('🔴 a tap on a running app opens /sub/abc', () async {
      final RecordingSeam seam = RecordingSeam();
      final List<String> opened = <String>[];
      final NotificationTapRouter r = NotificationTapRouter(
        service: seam,
        open: opened.add,
      );
      await r.start();
      seam.taps.add(const core.NotificationTap(id: 1, payload: 'sub:abc'));
      await Future<void>.delayed(Duration.zero);
      expect(opened, <String>['/sub/abc']);
      await r.stop();
    });

    test('🔴 the tap that COLD-STARTS the app opens /sub/abc too', () async {
      final RecordingSeam seam = RecordingSeam()
        ..launch = const core.NotificationTap(id: 1, payload: 'sub:abc');
      final List<String> opened = <String>[];
      await NotificationTapRouter(service: seam, open: opened.add).start();
      expect(opened, <String>['/sub/abc']);
    });

    test('a digest tap (no payload) opens nothing', () async {
      final RecordingSeam seam = RecordingSeam()
        ..launch = const core.NotificationTap(id: 2);
      final List<String> opened = <String>[];
      final NotificationTapRouter r = NotificationTapRouter(
        service: seam,
        open: opened.add,
      );
      await r.start();
      seam.taps.add(const core.NotificationTap(id: 2));
      await Future<void>.delayed(Duration.zero);
      expect(opened, isEmpty);
    });
  });
}
