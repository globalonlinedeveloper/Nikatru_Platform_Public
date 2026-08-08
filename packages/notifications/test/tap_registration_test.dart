// ─────────────────────────────────────────────────────────────────────────────
// [13]T-9 — THE REGISTRATION ITSELF, NOT A FAKE OF IT.
//
// 🔴 WHY THIS FILE EXISTS SEPARATELY FROM local_notification_service_test.dart.
// That file drives a `_FakePlugin` implementing the `NotificationPlugin` port,
// which proves the SERVICE hands a sink downward — and proves nothing about
// `_FlutterLocalNotificationsAdapter`, the class that has to turn that sink into
// `onDidReceiveNotificationResponse`. Delete that one named argument from the
// adapter and every fake-driven test in this package stays green while no tap
// on any of the six platforms ever reaches Dart again. The adapter carried a
// comment calling itself "thin glue that `analyze` covers", and `analyze` cannot
// see an omitted OPTIONAL argument.
//
// So this drives the REAL adapter, through the plugin's REAL method channel:
// `LocalNotificationService()` with no `plugin:` override, `init()`, then an
// INCOMING `didReceiveNotificationResponse` call on
// `dexterous.com/flutter/local_notifications` — which is exactly what the
// Android/iOS/macOS/Linux host sends when a user taps. Nothing about the tap
// path is simulated except the OS.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_notifications/src/local_notification_service_io.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

/// The plugin's own channel name, from
/// `flutter_local_notifications/lib/src/platform_flutter_local_notifications.dart`.
const MethodChannel _channel = MethodChannel(
  'dexterous.com/flutter/local_notifications',
);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(tz_data.initializeTimeZones);

  late List<MethodCall> outgoing;

  setUp(() {
    outgoing = <MethodCall>[];
    // Stand in for the host side so `initialize` completes. `initialize` returns
    // a `bool` on Android, so the default null would throw on the cast.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, (MethodCall call) async {
      outgoing.add(call);
      return true;
    });
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(_channel, null);
    tz.setLocalLocation(tz.UTC);
  });

  /// Delivers a tap the way the platform host does: an incoming method call on
  /// the plugin's channel, routed by the plugin to whatever callback was
  /// registered at `initialize`. If nothing registered, this reaches nothing.
  Future<void> hostDeliversTap({
    required int notificationId,
    String? payload,
  }) async {
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(
      _channel.name,
      const StandardMethodCodec().encodeMethodCall(
        MethodCall('didReceiveNotificationResponse', <String, Object?>{
          'notificationId': notificationId,
          'actionId': null,
          'input': null,
          'payload': payload,
          // NotificationResponseType.selectedNotification
          'notificationResponseType': 0,
        }),
      ),
      (_) {},
    );
  }

  test(
    'the REAL adapter registers with the plugin, and a host tap reaches '
    'notificationTaps()',
    () async {
      // No `plugin:` argument — this is the production adapter.
      final LocalNotificationService service = LocalNotificationService(
        platform: TargetPlatform.android,
        localTimezone: () async => 'UTC',
      );
      await service.init();

      expect(
        outgoing.map((MethodCall c) => c.method),
        contains('initialize'),
        reason: 'the adapter must have reached the plugin at all',
      );

      final Future<NotificationTap> tapped = service.notificationTaps().first;
      await hostDeliversTap(notificationId: 91, payload: 'renewal');

      // 🔴 THE ASSERTION THE MUTATION BREAKS. Remove
      // `onDidReceiveNotificationResponse:` from
      // `_FlutterLocalNotificationsAdapter.initialize` and this future never
      // completes — the plugin has no callback to route the host's message to.
      final NotificationTap tap = await tapped.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw StateError(
          'the host delivered a tap and NOTHING received it: the adapter '
          'registered no onDidReceiveNotificationResponse callback',
        ),
      );

      expect(tap.id, 91);
      expect(tap.kind, 'renewal');
    },
  );

  test('a host tap with no payload still arrives, as kind "other"', () async {
    final LocalNotificationService service = LocalNotificationService(
      platform: TargetPlatform.android,
      localTimezone: () async => 'UTC',
    );
    await service.init();

    final Future<NotificationTap> tapped = service.notificationTaps().first;
    await hostDeliversTap(notificationId: 5);

    final NotificationTap tap = await tapped.timeout(
      const Duration(seconds: 5),
      onTimeout: () =>
          throw StateError('no callback registered — see the test above'),
    );
    expect(tap.id, 5);
    expect(tap.kind, 'other');
  });
}
