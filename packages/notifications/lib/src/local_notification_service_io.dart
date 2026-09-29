import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'package:timezone/timezone.dart' as tz;

import 'device_timezone.dart';
import 'notification_capabilities.dart';
import 'windows_notification_identity.dart';

// The fixed-offset fallback moved to device_timezone.dart with the resolver it
// serves; re-exported so a caller of this file finds it where it always was.
export 'device_timezone.dart' show deviceOffsetLocation;

/// Native factory (Android/iOS/macOS/Linux/Windows) — selected by the conditional
/// import when `dart.library.io` is available.
NotificationService createPlatformNotificationService({
  LocalTimezoneResolver? localTimezone,
  WindowsNotificationIdentity? windows,
}) =>
    LocalNotificationService(localTimezone: localTimezone, windows: windows);

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
  /// A ONE-OFF schedule at [when]. [exact] asks Android for an exact alarm;
  /// the port throws the plugin's `PlatformException` when the OS refuses
  /// one, and the SERVICE owns the retry (so a fake can prove it).
  Future<void> scheduleOnce(
    int id,
    String title,
    String body,
    tz.TZDateTime when, {
    required bool exact,
    String? payload,
    NotificationChannel? channel,
  });

  /// Whether the OS will honour an EXACT alarm right now. Asked fresh: the
  /// user can revoke "Alarms & reminders" at any moment.
  Future<bool> canScheduleExact();

  /// The ids the OS holds pending. Throws where the platform cannot say.
  Future<List<int>> pendingIds();

  /// The tap that launched the process (the plugin's launch details), or
  /// null. Called once, after [initialize].
  Future<NotificationTap?> launchTap();
  Future<void> cancel(int id);
  Future<void> cancelAll();
}

/// A [NotificationService] backed by `flutter_local_notifications` + `timezone`.
///
/// All runtime plugin calls are guarded by [NotificationCapabilities] so an
/// unsupported platform degrades to a safe no-op instead of throwing (Windows
/// can't schedule without its identity; a web build uses the stub factory,
/// never this class).
class LocalNotificationService implements NotificationService {
  LocalNotificationService({
    NotificationPlugin? plugin,
    TargetPlatform? platform,
    bool isWeb = false,
    LocalTimezoneResolver? localTimezone,
    TZDateTimeNow? now,
    DeviceUtcOffset? deviceUtcOffset,
    WindowsNotificationIdentity? windows,
  })  : _plugin =
            plugin ?? _FlutterLocalNotificationsAdapter(windows: windows),
        _caps = NotificationCapabilities.resolve(
          platform ?? defaultTargetPlatform,
          isWeb: isWeb,
          windows: windows,
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

  bool _launchTaken = false;

  @override
  Future<NotificationTap?> takeLaunchTap() async {
    if (!_caps.canNotify || !_initialized || _launchTaken) return null;
    _launchTaken = true;
    try {
      return await _plugin.launchTap();
    } on Object {
      // A launch that cannot be read opens the app where it would have opened
      // anyway; it must never be why the app fails to start.
      return null;
    }
  }

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

  /// The ids THIS process scheduled through [scheduleAt]/[reconcile] — the
  /// fallback for [reconcile] where the OS pending list cannot be read.
  final Set<int> _scheduledThisProcess = <int>{};

  tz.TZDateTime _nowTz() => _now?.call() ?? tz.TZDateTime.now(tz.local);

  /// [at]'s wall clock in the device zone, or null when it is not after now.
  tz.TZDateTime? _instantOf(DateTime at) {
    final tz.TZDateTime when = tz.TZDateTime(
      tz.local,
      at.year,
      at.month,
      at.day,
      at.hour,
      at.minute,
    );
    return when.isAfter(_nowTz()) ? when : null;
  }

  @override
  Future<void> scheduleAt(ScheduledNotification notification) async {
    if (!_caps.canSchedule) return;
    await _post(notification, exact: await _exact());
  }

  @override
  Future<void> reconcile(
    List<ScheduledNotification> wanted, {
    required bool Function(int id) owns,
  }) async {
    if (!_caps.canSchedule) return;
    // 🔴 OWNED IDS ONLY — never `cancelAll()`. Two callers share this one
    // plugin singleton (a daily nudge and an app's own reminders), and each
    // must be able to rebuild its set without wiping the other's.
    final Set<int> owned = _scheduledThisProcess.where(owns).toSet();
    try {
      owned.addAll((await _plugin.pendingIds()).where(owns));
    } on Object catch (e) {
      // A platform whose pending list cannot be read: fall back to what this
      // process knows it scheduled.
      debugPrint('[notifications] could not read pending ids: $e');
    }
    // Cancel-then-post, including ids about to be re-posted: Windows keeps a
    // second scheduled toast under a re-used id rather than replacing it.
    for (final int id in owned) {
      await _plugin.cancel(id);
      _scheduledThisProcess.remove(id);
    }
    // ONE reading of the exact-alarm permission for the whole batch: eighty
    // reminders must not be eighty platform round-trips for one answer.
    final bool exact = await _exact();
    for (final ScheduledNotification n in wanted) {
      await _post(n, exact: exact);
    }
  }

  Future<bool> _exact() async {
    try {
      return await _plugin.canScheduleExact();
    } on Object {
      // "No" degrades to a reminder that still fires, inside a window.
      return false;
    }
  }

  /// One schedule, with the exact-alarm race closed.
  ///
  /// 🔴 THE CHECK AND THE SCHEDULE ARE TWO IPC CALLS, so the user can revoke
  /// "Alarms & reminders" between them, and the plugin then throws
  /// `PlatformException('exact_alarms_not_permitted')`. Uncaught, that ends a
  /// [reconcile] loop at its first reminder and costs the whole set. Caught
  /// HERE, per notification, and retried inexact — anything else keeps
  /// travelling, because swallowing every failure is how "no reminders"
  /// becomes indistinguishable from "all fine".
  ///
  /// SCHEDULE_EXACT_ALARM is not pre-granted from Android 13 and Android 14
  /// revokes it on restore, so a reminder must not NEED it: inexact
  /// (`setAndAllowWhileIdle`) still fires in doze, inside a window a
  /// "renews in two days" reminder tolerates. USE_EXACT_ALARM is deliberately
  /// not used — it is for alarm and calendar apps only.
  Future<void> _post(ScheduledNotification n, {required bool exact}) async {
    final tz.TZDateTime? when = _instantOf(n.at);
    if (when == null) return;
    Future<void> post(bool e) => _plugin.scheduleOnce(
          n.id,
          n.title,
          n.body,
          when,
          exact: e,
          payload: n.payload,
          channel: n.channel,
        );
    try {
      await post(exact);
    } on PlatformException catch (e) {
      if (!exact || e.code != 'exact_alarms_not_permitted') rethrow;
      await post(false);
    }
    _scheduledThisProcess.add(n.id);
  }

  @override
  Future<void> cancel(int id) async {
    if (!_caps.canNotify) return;
    await _plugin.cancel(id);
    _scheduledThisProcess.remove(id);
  }

  @override
  Future<void> cancelAll() async {
    if (!_caps.canNotify) return;
    await _plugin.cancelAll();
    _scheduledThisProcess.clear();
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
  _FlutterLocalNotificationsAdapter({WindowsNotificationIdentity? windows})
      : _windows = windows;

  final FlutterLocalNotificationsPlugin _fln =
      FlutterLocalNotificationsPlugin();
  final WindowsNotificationIdentity? _windows;

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
    windows: WindowsNotificationDetails(),
  );

  /// [_details] on [channel] — Android's per-channel row; every other
  /// platform's details are the defaults above.
  static NotificationDetails _detailsOn(NotificationChannel? channel) {
    if (channel == null) return _details;
    return NotificationDetails(
      android: AndroidNotificationDetails(
        channel.id,
        channel.name,
        channelDescription: channel.description,
        importance:
            channel.important ? Importance.high : Importance.defaultImportance,
        priority: channel.important ? Priority.high : Priority.defaultPriority,
      ),
      iOS: const DarwinNotificationDetails(),
      macOS: const DarwinNotificationDetails(),
      linux: const LinuxNotificationDetails(),
      windows: const WindowsNotificationDetails(),
    );
  }

  @override
  Future<void> initialize(void Function(NotificationTap tap) onTap) async {
    final WindowsNotificationIdentity? w = _windows;
    final InitializationSettings settings = InitializationSettings(
      android: const AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: kDarwinInitNoAsk,
      macOS: kDarwinInitNoAsk,
      linux: const LinuxInitializationSettings(defaultActionName: 'Open'),
      // The app's own identity (app.yaml -> windows_notification_identity.g
      // .dart). Without it the Windows plugin cannot start, which is why
      // NotificationCapabilities.resolve reports Windows off with none.
      windows: w == null
          ? null
          : WindowsInitializationSettings(
              appName: w.appName,
              appUserModelId: w.appUserModelId,
              guid: w.toastActivatorClsid,
            ),
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
    final AndroidFlutterLocalNotificationsPlugin? android =
        _fln.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return (await android.requestNotificationsPermission()) ?? false;
    }
    final IOSFlutterLocalNotificationsPlugin? ios =
        _fln.resolvePlatformSpecificImplementation<
            IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return (await ios.requestPermissions(
            alert: true,
            badge: true,
            sound: true,
          )) ??
          false;
    }
    final MacOSFlutterLocalNotificationsPlugin? macos =
        _fln.resolvePlatformSpecificImplementation<
            MacOSFlutterLocalNotificationsPlugin>();
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
  Future<void> showNow(int id, String title, String body) =>
      _fln.show(
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
  ) =>
      _fln.zonedSchedule(
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
  Future<void> scheduleOnce(
    int id,
    String title,
    String body,
    tz.TZDateTime when, {
    required bool exact,
    String? payload,
    NotificationChannel? channel,
  }) =>
      _fln.zonedSchedule(
        id: id,
        title: title,
        body: body,
        scheduledDate: when,
        notificationDetails: _detailsOn(channel),
        payload: payload,
        // ONE-OFF: no matchDateTimeComponents. A body naming a concrete date
        // ("renews on Aug 12") re-posted every month would be wrong from its
        // second firing, and a repeat buys no slot in iOS's 64-request pool.
        androidScheduleMode: exact
            ? AndroidScheduleMode.exactAllowWhileIdle
            : AndroidScheduleMode.inexactAllowWhileIdle,
      );

  @override
  Future<bool> canScheduleExact() async {
    final AndroidFlutterLocalNotificationsPlugin? android =
        _fln.resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>();
    // Not Android: androidScheduleMode is inert everywhere else, so there is
    // no precision to lose.
    if (android == null) return true;
    try {
      return (await android.canScheduleExactNotifications()) ?? false;
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<NotificationTap?> launchTap() async {
    final NotificationAppLaunchDetails? d =
        await _fln.getNotificationAppLaunchDetails();
    final NotificationResponse? r = d?.notificationResponse;
    if (d == null || !d.didNotificationLaunchApp || r == null) return null;
    return NotificationTap(id: r.id ?? -1, payload: r.payload);
  }

  @override
  Future<List<int>> pendingIds() async => <int>[
        for (final PendingNotificationRequest r
            in await _fln.pendingNotificationRequests())
          r.id,
      ];

  @override
  Future<void> cancel(int id) => _fln.cancel(id: id);

  @override
  Future<void> cancelAll() => _fln.cancelAll();
}
