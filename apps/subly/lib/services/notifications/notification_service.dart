import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../../data/models/subscription.dart';

/// On-device renewal reminders — the cross-platform reminder path (iOS, Android,
/// macOS, Linux, Windows). No server push, so it also covers the desktop targets
/// where FCM has no official support. Web falls back to a no-op (use the
/// service-worker Notification API there if needed).
///
/// NOTE: `flutter_local_notifications` is the most version-sensitive dependency
/// in this template. The calls below target the 17.x API. If `flutter pub get`
/// resolves a newer major, re-check `zonedSchedule` (androidScheduleMode /
/// uiLocalNotificationDateInterpretation) and the Windows init settings.
class NotificationService {
  NotificationService._();
  static final NotificationService instance = NotificationService._();

  /// For test fakes ONLY. The singleton above cannot be replaced and the real
  /// methods need a platform, so the reminder-wiring tests (which must prove a
  /// settings toggle reaches this service — see settings_wiring_test.dart)
  /// subclass via this constructor and override the scheduling methods to
  /// record calls. Production wiring keeps using [instance].
  @visibleForTesting
  NotificationService.forTesting();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _ready = false;

  static const String _channelId = 'renewals';
  static const String _channelName = 'Renewal reminders';

  Future<void> init() async {
    if (kIsWeb) return; // plugin has no web implementation
    tzdata.initializeTimeZones();
    // For exact local-time scheduling, add `flutter_timezone` and call
    // tz.setLocalLocation(tz.getLocation(await FlutterTimezone.getLocalTimezone()));
    // Defaults to UTC otherwise.

    const InitializationSettings settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
      macOS: DarwinInitializationSettings(),
      linux: LinuxInitializationSettings(defaultActionName: 'Open'),
      // Windows: add WindowsInitializationSettings(appName, appUserModelId, guid)
      // once you have an AppUserModelID; omitted here to stay version-safe.
    );

    await _plugin.initialize(settings);
    await _requestPermissions();
    _ready = true;
  }

  Future<void> _requestPermissions() async {
    await _plugin
        .resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin
        >()
        ?.requestPermissions(alert: true, badge: true, sound: true);
    await _plugin
        .resolvePlatformSpecificImplementation<
          MacOSFlutterLocalNotificationsPlugin
        >()
        ?.requestPermissions(alert: true, badge: true, sound: true);
    await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
  }

  NotificationDetails get _details => const NotificationDetails(
    android: AndroidNotificationDetails(
      _channelId,
      _channelName,
      channelDescription: 'Alerts a couple of days before a charge',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: DarwinNotificationDetails(),
    macOS: DarwinNotificationDetails(),
    linux: LinuxNotificationDetails(),
  );

  /// Schedules a one-off reminder [daysBefore] the renewal, at 09:00 local.
  /// (Windows can't do *repeating* notifications, but one-off per-renewal
  /// reminders like this work everywhere.)
  Future<void> scheduleRenewalReminder(
    Subscription sub, {
    int daysBefore = 2,
  }) async {
    if (!_ready) return;
    final DateTime target = sub.nextRenewal.subtract(
      Duration(days: daysBefore),
    );
    final tz.TZDateTime when = tz.TZDateTime(
      tz.local,
      target.year,
      target.month,
      target.day,
      9,
    );
    // Don't fire in the past.
    if (when.isBefore(tz.TZDateTime.now(tz.local))) return;

    await _plugin.zonedSchedule(
      _idFor(sub.id),
      'Renewal coming up',
      '${sub.name} renews on ${_pretty(sub.nextRenewal)}.',
      when,
      _details,
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
    );
  }

  /// The weekly spending digest, behind the `weekly` setting.
  ///
  /// Repeats on Sundays at 18:00 local via `matchDateTimeComponents:
  /// dayOfWeekAndTime` -- one scheduled notification, not one per week, so it
  /// survives the app not being opened. [total] is the real monthly figure
  /// computed from the subscriptions actually held; nothing here is invented.
  ///
  /// Wired 2026-07-27. The `weekly` toggle existed in settings_controller.dart
  /// and was read NOWHERE, so switching it on did nothing at all -- a switch
  /// that promises a feature and delivers none is the same defect class as copy
  /// that claims one.
  Future<void> scheduleWeeklyDigest({
    required int count,
    required String formattedTotal,
  }) async {
    if (!_ready) return;
    await _plugin.cancel(_digestId);
    final tz.TZDateTime now = tz.TZDateTime.now(tz.local);
    tz.TZDateTime when = tz.TZDateTime(
      tz.local,
      now.year,
      now.month,
      now.day,
      18,
    );
    // DateTime.sunday == 7; walk forward to the next Sunday 18:00.
    while (when.weekday != DateTime.sunday || !when.isAfter(now)) {
      when = when.add(const Duration(days: 1));
    }
    await _plugin.zonedSchedule(
      _digestId,
      'Your week in subscriptions',
      '$count active, $formattedTotal a month.',
      when,
      _details,
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
    );
  }

  Future<void> cancelWeeklyDigest() async {
    if (!_ready) return;
    await _plugin.cancel(_digestId);
  }

  Future<void> cancelForSubscription(String id) async {
    if (!_ready) return;
    await _plugin.cancel(_idFor(id));
  }

  Future<void> cancelAll() async {
    if (!_ready) return;
    await _plugin.cancelAll();
  }

  /// Rebuilds the full reminder set (call after edits, or on app resume).
  Future<void> syncAll(List<Subscription> subs, {int daysBefore = 2}) async {
    if (!_ready) return;
    await cancelAll();
    for (final Subscription s in subs) {
      await scheduleRenewalReminder(s, daysBefore: daysBefore);
    }
  }

  /// Fixed id for the digest, outside the range `_idFor` can produce for a
  /// subscription, so `cancelForSubscription` can never cancel it by collision.
  static const int _digestId = 0x7ffffffe;

  int _idFor(String id) {
    final int h = id.hashCode & 0x7fffffff;
    return h == _digestId ? h - 1 : h;
  }

  String _pretty(DateTime d) {
    const List<String> m = <String>[
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${m[d.month - 1]} ${d.day}';
  }
}
