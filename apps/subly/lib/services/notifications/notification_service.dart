import 'package:flutter/foundation.dart'
    show immutable, kIsWeb, visibleForTesting;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import '../../data/models/subscription.dart';

/// Every user-visible string this service hands to the OS, already rendered in
/// the language the app is currently showing.
///
/// 🔴 THIS EXISTS BECAUSE THE SERVICE HAS NO `BuildContext` AND MUST NOT GET ONE.
/// It is a process singleton constructed in `main()` before `runApp`, and its
/// scheduling methods run from a Riverpod notifier — there is no element tree to
/// read `AppLocalizations.of(context)` from at either point. The alternative
/// shapes were measured and rejected:
///
///  · a `BuildContext` parameter — would tie a background scheduling seam to a
///    mounted widget, and `SubscriptionsController.build()` has none;
///  · `AppLocalizations` itself as the parameter — drags the generated l10n
///    class (and `flutter_localizations`) into a file that otherwise knows only
///    about the plugin, and this service is a candidate to move into the chassis.
///
/// So the CALLER renders and the service posts. The two closures are closures
/// rather than strings because their arguments are only known per-notification:
/// `syncAll` loops over subscriptions itself, and the digest's plural arm is
/// chosen by a count this object cannot see. They carry the locale's
/// `DateFormat` with them — the date belongs to the same sentence as the words
/// around it, so it is formatted where the words are.
@immutable
class ReminderCopy {
  const ReminderCopy({
    required this.channelName,
    required this.reminderTitle,
    required this.reminderBody,
    required this.digestTitle,
    required this.digestBody,
  });

  /// The Android notification CHANNEL name — visible in the OS settings app,
  /// long after the notification itself is gone.
  final String channelName;

  final String reminderTitle;

  /// `(name, renewal date) → body`. The caller owns the date format.
  final String Function(String name, DateTime renewal) reminderBody;

  final String digestTitle;

  /// `(count, formatted total) → body`. PLURAL: [count] picks the arm.
  final String Function(int count, String formattedTotal) digestBody;
}

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
      // ⚠️ THIS LITERAL IS ALREADY DEAD, AND LOCALIZING IT HERE WOULD CHANGE
      // NOTHING — which is why `notificationActionOpen` is in the .arb and not
      // read on this line. `FlutterLocalNotificationsPlugin()` is a process
      // singleton (its constructor is a `factory` returning a static instance),
      // and `main.dart` initialises the SHARED adapter immediately after this
      // one; that adapter's `initialize` passes its own
      // `LinuxInitializationSettings(defaultActionName: 'Open')`
      // (packages/notifications/lib/src/local_notification_service_io.dart:266)
      // and, being last, is the one the plugin keeps. The label a Linux user
      // reads therefore comes from the chassis, so translating it is a chassis
      // change — out of scope for this increment, recorded rather than faked.
      linux: LinuxInitializationSettings(defaultActionName: 'Open'),
      // Windows: add WindowsInitializationSettings(appName, appUserModelId, guid)
      // once you have an AppUserModelID; omitted here to stay version-safe.
    );

    await _plugin.initialize(settings);
    // 🔴 [pipeline 13]T-4 — `init()` DOES NOT ASK. It used to end with
    // `await _requestPermissions()`, and `init()` is called from `main()` before
    // `runApp`, so the OS permission dialog was the first thing a new user saw:
    // spent at first frame, before the app had shown a single subscription or
    // any reason to say yes.
    //
    // WHY IT MATTERS BEYOND ONE BAD IMPRESSION: on Android 13+ a runtime
    // permission denied a SECOND time becomes `USER_FIXED` — permanently
    // non-promptable, no dialog ever again. A launch-time ask spends the first
    // denial for nothing, so the install is one accidental tap from losing its
    // return channel for good, silently. (The one-strike variant applies only to
    // apps targeting ≤ 12L.)
    //
    // The shared adapter has always had this shape — `init()` and
    // `requestPermission()` are separate seam methods in
    // packages/notifications/lib/src/local_notification_service_io.dart — and
    // this fork is the only place in the tree that had fused them.
    _ready = true;
  }

  /// Asks the OS for notification permission. Returns whether we may post.
  ///
  /// CALL THIS FROM A USER GESTURE ONLY — the moment the user turns on a
  /// reminder-bearing feature. Never from `init()`, a provider `build()`, or a
  /// widget `initState`. `tooling/ci/assert-stamp-properties.mjs` walks the call
  /// graph from `main()` and fails the build if any path reaches here.
  ///
  /// `!_ready` guards the test path as every other method here does: a fake that
  /// never ran `init()` gets `false` instead of a `MissingPluginException`.
  Future<bool> requestPermissions() async {
    if (kIsWeb || !_ready) return false;
    final bool? ios = await _plugin
        .resolvePlatformSpecificImplementation<
          IOSFlutterLocalNotificationsPlugin
        >()
        ?.requestPermissions(alert: true, badge: true, sound: true);
    final bool? macos = await _plugin
        .resolvePlatformSpecificImplementation<
          MacOSFlutterLocalNotificationsPlugin
        >()
        ?.requestPermissions(alert: true, badge: true, sound: true);
    final bool? android = await _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    // Exactly one of these resolves on any given platform; the rest are null.
    // Linux and Windows have no runtime prompt, so all three are null there and
    // the honest answer is "yes, we may post".
    return ios ?? macos ?? android ?? true;
  }

  /// 👤 `channelDescription` IS STILL ENGLISH, DELIBERATELY. It is the second
  /// line under the channel name in Android's app-notification settings, so it
  /// is as user-visible as the name above it — but there is no .arb key for it
  /// (the P4 baseline minted `renewalChannelName` and no description), and
  /// minting one is the arb owner's call, not this increment's. Recorded so the
  /// gap is a decision rather than an oversight.
  NotificationDetails _detailsFor(ReminderCopy copy) => NotificationDetails(
    android: AndroidNotificationDetails(
      _channelId,
      copy.channelName,
      channelDescription: 'Alerts a couple of days before a charge',
      importance: Importance.high,
      priority: Priority.high,
    ),
    iOS: const DarwinNotificationDetails(),
    macOS: const DarwinNotificationDetails(),
    linux: const LinuxNotificationDetails(),
  );

  /// Schedules a one-off reminder [daysBefore] the renewal, at 09:00 local.
  /// (Windows can't do *repeating* notifications, but one-off per-renewal
  /// reminders like this work everywhere.)
  Future<void> scheduleRenewalReminder(
    Subscription sub, {
    required ReminderCopy copy,
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
      copy.reminderTitle,
      copy.reminderBody(sub.name, sub.nextRenewal),
      when,
      _detailsFor(copy),
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
    required ReminderCopy copy,
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
      copy.digestTitle,
      copy.digestBody(count, formattedTotal),
      when,
      _detailsFor(copy),
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
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {
    if (!_ready) return;
    await cancelAll();
    for (final Subscription s in subs) {
      await scheduleRenewalReminder(s, copy: copy, daysBefore: daysBefore);
    }
  }

  /// Fixed id for the digest, outside the range `_idFor` can produce for a
  /// subscription, so `cancelForSubscription` can never cancel it by collision.
  static const int _digestId = 0x7ffffffe;

  int _idFor(String id) {
    final int h = id.hashCode & 0x7fffffff;
    return h == _digestId ? h - 1 : h;
  }
}
