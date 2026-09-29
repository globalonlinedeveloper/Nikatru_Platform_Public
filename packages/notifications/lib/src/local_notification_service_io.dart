import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import 'device_timezone.dart';
import 'notification_capabilities.dart';

// The fixed-offset fallback moved to device_timezone.dart with the resolver it
// serves; re-exported so a caller of this file finds it where it always was.
export 'device_timezone.dart' show deviceOffsetLocation;

/// Native factory (Android/iOS/macOS/Linux/Windows) — selected by the conditional
/// import when `dart.library.io` is available.
NotificationService createPlatformNotificationService({
  LocalTimezoneResolver? localTimezone,
}) => LocalNotificationService(localTimezone: localTimezone);

/// iOS/macOS init settings that ask the OS for NOTHING.
///
/// 🔴 THE PLUGIN'S DEFAULTS ASK. `DarwinInitializationSettings()` defaults
/// alert, sound and badge to true, and `initialize` then calls
/// `requestAuthorizationWithOptions` and completes only when the user answers
/// the dialog — so `init()`, which `main()` awaits before `runApp`, blocked on
/// a launch-time permission prompt. On a runner nobody answers it: native auth
/// proof run 36525783687's iOS and macOS jobs built, launched and then printed
/// nothing until cancelled at 60 and 45 min. Permission is asked only by
/// [LocalNotificationService.requestPermission], from a user gesture.
const DarwinInitializationSettings kDarwinInitNoAsk =
    DarwinInitializationSettings(
      requestAlertPermission: false,
      requestSoundPermission: false,
      requestBadgePermission: false,
    );

/// Returns a [tz.TZDateTime] a fixed clock — injected in tests for determinism.
typedef TZDateTimeNow = tz.TZDateTime Function();

/// Minimal port over the notification-plugin operations the service needs. A
/// seam so the service's platform-guard logic is unit-testable without platform
/// channels — the concrete adapter below is thin glue that `analyze` covers.
@visibleForTesting
abstract interface class NotificationPlugin {
  /// [onTap] is the INBOUND channel and is required, not optional: the plugin
  /// only accepts a tap callback at initialize time, so an `initialize()` that
  /// cannot be handed one is an adapter that can never deliver a tap. Making it
  /// a parameter is what stops the registration being quietly droppable —
  /// remove it and this port stops compiling, rather than going silently deaf.
  Future<void> initialize(void Function(NotificationTap tap) onTap);
  Future<bool> requestPermission();
  Future<void> showNow(int id, String title, String body);
  Future<void> scheduleDaily(
    int id,
    String title,
    String body,
    tz.TZDateTime when,
  );
  Future<void> cancel(int id);
  Future<void> cancelAll();
}

/// A [NotificationService] backed by `flutter_local_notifications` + `timezone`.
///
/// All runtime plugin calls are guarded by [NotificationCapabilities] so an
/// unsupported platform degrades to a safe no-op instead of throwing (Windows
/// can't repeat-schedule; a web build uses the stub factory, never this class).
class LocalNotificationService implements NotificationService {
  LocalNotificationService({
    NotificationPlugin? plugin,
    TargetPlatform? platform,
    bool isWeb = false,
    LocalTimezoneResolver? localTimezone,
    TZDateTimeNow? now,
    DeviceUtcOffset? deviceUtcOffset,
  }) : _plugin = plugin ?? _FlutterLocalNotificationsAdapter(),
       _caps = NotificationCapabilities.forPlatform(
         platform ?? defaultTargetPlatform,
         isWeb: isWeb,
       ),
       _resolveTimezone = localTimezone,
       _now = now,
       _deviceUtcOffset = deviceUtcOffset ?? _hostUtcOffset;

  final NotificationPlugin _plugin;
  final NotificationCapabilities _caps;

  /// NULLABLE, and null means the CHASSIS DEFAULT — the device's IANA zone via
  /// `flutter_timezone` — see [resolveLocalTimezone]. Inject only from a test.
  final LocalTimezoneResolver? _resolveTimezone;
  final TZDateTimeNow? _now;
  final DeviceUtcOffset _deviceUtcOffset;
  bool _initialized = false;

  /// Why `tz.local` is a fixed device offset rather than the device's IANA
  /// zone — null when the real zone was resolved. Set by [init]; a settings
  /// screen or a crash breadcrumb can carry it, which is what makes the
  /// fallback loud rather than silent.
  String? get timezoneFallbackReason => _timezoneFallbackReason;
  String? _timezoneFallbackReason;

  /// BROADCAST, and created eagerly rather than on first listen.
  ///
  /// Broadcast because a tap is an event several places may want (a router that
  /// opens the reminder AND a funnel that records it), and a single-subscription
  /// stream would let whichever subscribed first silently starve the other.
  /// Eager because [init] registers the OS callback and a tap can arrive before
  /// anyone has subscribed — a lazily-built controller would drop it.
  ///
  /// Never closed: this service lives as long as the process. Broadcast
  /// controllers hold no buffer, so an unlistened one costs nothing.
  final StreamController<NotificationTap> _taps =
      StreamController<NotificationTap>.broadcast();

  /// Fixed id bucket for immediate notifications (kept clear of caller-chosen
  /// small reminder ids); each `showNow` replaces the previous immediate one.
  static const int _immediateId = 0x7f000000;

  static Duration _hostUtcOffset() => DateTime.now().timeZoneOffset;

  /// The resolved platform capabilities — lets the app decide whether to offer a
  /// scheduling toggle or fall back to an in-app nudge.
  NotificationCapabilities get capabilities => _caps;

  @override
  Future<void> init() async {
    if (_initialized) return;
    tz_data.initializeTimeZones();
    // 🔴 THE ONE RESOLUTION BOTH SERVICES SHARE — see device_timezone.dart.
    // `tz.local` is process-global and this is the only correct value for it:
    // the device's IANA zone, or a LOUD fixed-offset fallback, never UTC.
    final LocalTimezoneResolution zone = await resolveLocalTimezone(
      resolver: _resolveTimezone,
      deviceUtcOffset: _deviceUtcOffset,
    );
    tz.setLocalLocation(zone.location);
    _timezoneFallbackReason = zone.fallbackReason;
    if (_caps.canNotify) {
      // 🔴 THE INBOUND HALF. Handing `_taps.add` to the port here is the whole
      // registration: the adapter below turns it into the plugin's
      // `onDidReceiveNotificationResponse`. Without this argument the service
      // still shows and schedules perfectly — and every notification it posts
      // opens nothing when tapped, with no test red and no error anywhere.
      await _plugin.initialize(_taps.add);
    }
    _initialized = true;
  }

  /// The taps, as a broadcast stream. See [NotificationService.notificationTaps].
  ///
  /// Silent (rather than absent) where `canNotify` is false: [init] skips the
  /// registration there, so no tap can ever arrive and callers need no
  /// platform check of their own.
  @override
  Stream<NotificationTap> notificationTaps() => _taps.stream;

  @override
  Future<bool> requestPermission() async {
    if (!_caps.canNotify) return false;
    return _plugin.requestPermission();
  }

  @override
  Future<void> showNow({required String title, required String body}) async {
    if (!_caps.canNotify) return;
    await _plugin.showNow(_immediateId, title, body);
  }

  @override
  Future<void> scheduleDaily(DailyReminder reminder) async {
    if (!_caps.canSchedule) return;
    final tz.TZDateTime base = _now?.call() ?? tz.TZDateTime.now(tz.local);
    await _plugin.scheduleDaily(
      reminder.id,
      reminder.title,
      reminder.body,
      nextInstanceOfTime(reminder.hour, reminder.minute, base),
    );
  }

  @override
  Future<void> cancel(int id) async {
    if (!_caps.canNotify) return;
    await _plugin.cancel(id);
  }

  @override
  Future<void> cancelAll() async {
    if (!_caps.canNotify) return;
    await _plugin.cancelAll();
  }
}

/// The next [tz.TZDateTime] at [hour]:[minute] in [now]'s location, strictly
/// after [now] — today if the time is still ahead, otherwise tomorrow. Pure: the
/// daily-schedule anchor, kept side-effect-free so it can be tested exactly.
tz.TZDateTime nextInstanceOfTime(int hour, int minute, tz.TZDateTime now) {
  tz.TZDateTime scheduled = tz.TZDateTime(
    now.location,
    now.year,
    now.month,
    now.day,
    hour,
    minute,
  );
  if (!scheduled.isAfter(now)) {
    scheduled = scheduled.add(const Duration(days: 1));
  }
  return scheduled;
}

/// The default [NotificationPlugin] — thin glue onto `flutter_local_notifications`.
class _FlutterLocalNotificationsAdapter implements NotificationPlugin {
  final FlutterLocalNotificationsPlugin _fln =
      FlutterLocalNotificationsPlugin();

  static const AndroidNotificationDetails _androidDetails =
      AndroidNotificationDetails(
        'nikatru_reminders',
        'Reminders',
        channelDescription: 'Daily streak and goal reminders',
        importance: Importance.defaultImportance,
        priority: Priority.defaultPriority,
      );

  static const NotificationDetails _details = NotificationDetails(
    android: _androidDetails,
    iOS: DarwinNotificationDetails(),
    macOS: DarwinNotificationDetails(),
    linux: LinuxNotificationDetails(),
  );

  @override
  Future<void> initialize(void Function(NotificationTap tap) onTap) async {
    const InitializationSettings settings = InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: kDarwinInitNoAsk,
      macOS: kDarwinInitNoAsk,
      linux: LinuxInitializationSettings(defaultActionName: 'Open'),
    );
    await _fln.initialize(
      settings: settings,
      // The ONLY place a `flutter_local_notifications` type touches a tap. The
      // plugin's `NotificationResponse` stops here and a pure-Dart
      // `NotificationTap` continues, so `packages/core` — and every consumer
      // above it, on all six platforms — never sees the plugin's types.
      onDidReceiveNotificationResponse: (NotificationResponse r) =>
          onTap(NotificationTap(id: r.id ?? -1, payload: r.payload)),
    );
  }

  @override
  Future<bool> requestPermission() async {
    final AndroidFlutterLocalNotificationsPlugin? android = _fln
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    if (android != null) {
      return (await android.requestNotificationsPermission()) ?? false;
    }
    final IOSFlutterLocalNotificationsPlugin? ios = _fln
        .resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin
        >();
    if (ios != null) {
      return (await ios.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          )) ??
          false;
    }
    final MacOSFlutterLocalNotificationsPlugin? macos = _fln
        .resolvePlatformSpecificImplementation<
          MacOSFlutterLocalNotificationsPlugin
        >();
    if (macos != null) {
      return (await macos.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          )) ??
          false;
    }
    // Linux has no runtime permission prompt.
    return true;
  }

  @override
  Future<void> showNow(int id, String title, String body) => _fln.show(
    id: id,
    title: title,
    body: body,
    notificationDetails: _details,
  );

  @override
  Future<void> scheduleDaily(
    int id,
    String title,
    String body,
    tz.TZDateTime when,
  ) => _fln.zonedSchedule(
    id: id,
    title: title,
    body: body,
    scheduledDate: when,
    notificationDetails: _details,
    // inexact = no SCHEDULE_EXACT_ALARM permission needed (a daily nudge
    // tolerates OS batching); matchDateTimeComponents.time repeats it daily at
    // the same local time. flutter_local_notifications 19 removed
    // uiLocalNotificationDateInterpretation (absolute time is the only mode).
    androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
    matchDateTimeComponents: DateTimeComponents.time,
  );

  @override
  Future<void> cancel(int id) => _fln.cancel(id: id);

  @override
  Future<void> cancelAll() => _fln.cancelAll();
}
