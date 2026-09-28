import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show NotificationChannel, NotificationTap;
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_notifications/src/local_notification_service_io.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

// 🔴 THE PROOF THAT `tz.local` IS THE DEVICE'S ZONE, NOT UTC, AND THAT A
// FAILED RESOLUTION IS LOUD. Every case pins an ABSOLUTE UTC instant rather
// than arithmetic over an offset, so the test cannot re-derive its answer with
// the mistake the code under test might be making.
void main() {
  setUpAll(tz_data.initializeTimeZones);
  tearDown(() => tz.setLocalLocation(tz.UTC));

  group('resolveLocalTimezone', () {
    test('an IANA name resolves to that location, with no fallback', () async {
      final List<String> loud = <String>[];
      final LocalTimezoneResolution r = await resolveLocalTimezone(
        resolver: () async => 'Asia/Kolkata',
        onFallback: loud.add,
      );
      expect(r.location.name, 'Asia/Kolkata');
      expect(r.isFallback, isFalse);
      expect(r.fallbackReason, isNull);
      expect(loud, isEmpty);
      // 09:00 in Kolkata is 03:30Z — the number the shipped defect got wrong
      // by five and a half hours.
      expect(
        tz.TZDateTime(r.location, 2030, 6, 10, 9).toUtc(),
        DateTime.utc(2030, 6, 10, 3, 30),
      );
    });

    test('a resolver that THROWS falls back to the device offset, LOUDLY',
        () async {
      final List<String> loud = <String>[];
      final LocalTimezoneResolution r = await resolveLocalTimezone(
        resolver: () async => throw StateError('no platform channel'),
        deviceUtcOffset: () => const Duration(hours: 5, minutes: 30),
        onFallback: loud.add,
      );
      expect(r.isFallback, isTrue);
      expect(r.location.name, 'device+0530');
      expect(r.fallbackReason, contains('no platform channel'));
      expect(loud, hasLength(1));
      expect(loud.single, contains('timezone fallback'));
      // NEVER UTC: the fallback is the device's offset, so 09:00 is 03:30Z.
      expect(
        tz.TZDateTime(r.location, 2030, 6, 10, 9).toUtc(),
        DateTime.utc(2030, 6, 10, 3, 30),
      );
    });

    test('a zone the database does not carry falls back the same way',
        () async {
      final List<String> loud = <String>[];
      final LocalTimezoneResolution r = await resolveLocalTimezone(
        resolver: () async => 'Not/AZone',
        deviceUtcOffset: () => const Duration(hours: -8),
        onFallback: loud.add,
      );
      expect(r.isFallback, isTrue);
      expect(r.location.name, 'device-0800');
      expect(r.fallbackReason, contains('Not/AZone'));
      expect(loud.single, contains('does not carry'));
    });

    test('with NO resolver and no platform channel the answer is still not UTC',
        () async {
      // The production default is `deviceIanaTimezone`, which needs the
      // flutter_timezone platform channel. Under `flutter test` there is none,
      // so this is exactly the degraded path a host without the plugin takes.
      final List<String> loud = <String>[];
      final LocalTimezoneResolution r = await resolveLocalTimezone(
        deviceUtcOffset: () => const Duration(hours: 5, minutes: 30),
        onFallback: loud.add,
      );
      expect(r.isFallback, isTrue, reason: 'no channel ⇒ fallback');
      expect(r.location.name, isNot('UTC'));
      expect(r.location.name, 'device+0530');
      expect(loud, hasLength(1));
    });
  });

  group('DST is carried by the IANA zone', () {
    // America/New_York enters DST on Sunday 2030-03-10. A 09:00 reminder on
    // either side of that date is a DIFFERENT UTC instant, and a fixed offset
    // could only ever get one of them right.
    test('09:00 New York is 14:00Z before the transition and 13:00Z after',
        () async {
      final LocalTimezoneResolution r = await resolveLocalTimezone(
        resolver: () async => 'America/New_York',
      );
      expect(
        tz.TZDateTime(r.location, 2030, 3, 1, 9).toUtc(),
        DateTime.utc(2030, 3, 1, 14),
      );
      expect(
        tz.TZDateTime(r.location, 2030, 3, 11, 9).toUtc(),
        DateTime.utc(2030, 3, 11, 13),
      );
    });

    test('the fixed-offset fallback cannot, and that is why it is loud', () {
      final tz.Location fixed =
          deviceOffsetLocation(const Duration(hours: -5));
      expect(
        tz.TZDateTime(fixed, 2030, 3, 11, 9).toUtc(),
        DateTime.utc(2030, 3, 11, 14),
        reason: 'one hour late after the transition — the bounded, announced '
            'error the fallback trades for the unbounded, silent UTC one',
      );
    });
  });

  group('LocalNotificationService installs the resolution', () {
    test('init() sets tz.local to the resolved IANA zone', () async {
      final LocalNotificationService s = LocalNotificationService(
        plugin: _NullPlugin(),
        platform: TargetPlatform.android,
        localTimezone: () async => 'Asia/Kolkata',
      );
      await s.init();
      expect(tz.local.name, 'Asia/Kolkata');
      expect(s.timezoneFallbackReason, isNull);
    });

    test('init() reports the fallback reason when the resolver fails',
        () async {
      final LocalNotificationService s = LocalNotificationService(
        plugin: _NullPlugin(),
        platform: TargetPlatform.android,
        localTimezone: () async => throw StateError('boom'),
        deviceUtcOffset: () => const Duration(hours: 1),
      );
      await s.init();
      expect(tz.local.name, 'device+0100');
      expect(s.timezoneFallbackReason, contains('boom'));
    });
  });
}

class _NullPlugin implements NotificationPlugin {
  @override
  Future<void> initialize(void Function(NotificationTap tap) onTap) async {}
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
  Future<void> scheduleOnce(
    int id,
    String title,
    String body,
    tz.TZDateTime when, {
    required bool exact,
    String? payload,
    NotificationChannel? channel,
  }) async {}
  @override
  Future<bool> canScheduleExact() async => false;
  @override
  Future<List<int>> pendingIds() async => const <int>[];
  @override
  Future<NotificationTap?> launchTap() async => null;
  @override
  Future<void> cancel(int id) async {}
  @override
  Future<void> cancelAll() async {}
}
