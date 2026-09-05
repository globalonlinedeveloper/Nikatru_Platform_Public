import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        defaultTargetPlatform,
        immutable,
        kIsWeb,
        visibleForTesting;
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

  /// The instant a reminder for [sub] should fire, or `null` when that instant
  /// has already passed and the reminder is therefore not schedulable.
  ///
  /// 🔴 ONE DEFINITION, TWO CALLERS, DELIBERATELY. [scheduleRenewalReminder]
  /// posts it and [plannedReminders] budgets against it. A second copy of this
  /// arithmetic would drift, and the drift is not visible: the planner would
  /// spend a scarce slot (see [renewalReminderBudget]) on a reminder the
  /// scheduler then silently declines to post, so the user would lose a
  /// reminder they COULD have had to one they never could.
  tz.TZDateTime? _whenFor(Subscription sub, int daysBefore) {
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
    if (when.isBefore(tz.TZDateTime.now(tz.local))) return null;
    return when;
  }

  /// Schedules a one-off reminder [daysBefore] the renewal, at 09:00 local.
  ///
  /// ⚠️ "ONE-OFF" IS THE WORD THAT MATTERS, AND IT IS NOT A LIMITATION OF THE
  /// PLATFORMS — it is what a renewal reminder IS. The obvious-looking
  /// alternative — `matchDateTimeComponents`, which [scheduleWeeklyDigest]
  /// genuinely does use, and which `DateTimeComponents.dayOfMonthAndTime` /
  /// `.dateAndTime` would express for this app's two [BillingCycle] arms — was
  /// measured and rejected here, twice over:
  ///
  ///  · the body is a FINISHED STRING containing a concrete date —
  ///    `copy.reminderBody(sub.name, sub.nextRenewal)` renders "Netflix renews
  ///    on Aug 12" once, and a repeating request re-posts those same words
  ///    every month forever. A repeat would not carry the moving renewal date;
  ///    it would carry a frozen one, and be wrong from its second firing on.
  ///  · it would not buy a single slot anyway. iOS counts PENDING requests,
  ///    and a repeating request is one pending request exactly like a one-off.
  ///    Repetition is orthogonal to the budget below, not a way around it.
  ///
  /// ⚠️ AND IT DOES NOT "WORK EVERYWHERE" — this doc used to claim it did.
  /// `FlutterLocalNotificationsPlugin.zonedSchedule` dispatches on
  /// `defaultTargetPlatform` and its final `else` throws `UnimplementedError`
  /// (flutter_local_notifications 17.2.4,
  /// lib/src/flutter_local_notifications_plugin.dart:377), so Linux and Windows
  /// reach no implementation at all. Recorded, not fixed here: this increment
  /// bounds the reminder set, and the desktop gap is a separate change.
  Future<void> scheduleRenewalReminder(
    Subscription sub, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {
    if (!_ready) return;
    final tz.TZDateTime? when = _whenFor(sub, daysBefore);
    if (when == null) return;

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

  /// 🔴 APPLE'S PENDING-NOTIFICATION POOL — 64 PER APP, ENFORCED BY DISCARDING.
  /// `UNUserNotificationCenter` keeps only the 64 soonest pending requests an
  /// app has scheduled and drops every one after that. It does not throw, does
  /// not call back, and does not report the drop anywhere; the only way to see
  /// it is to ask for the pending list afterwards and find yours missing. The
  /// limit is per APP, shared by every scheduled notification this service
  /// owns, and it applies on macOS too — both go through
  /// `UNUserNotificationCenter`.
  static const int _darwinPendingLimit = 64;

  /// The most renewal reminders [syncAll] will schedule on a platform that caps
  /// them.
  ///
  /// 🔴 STRICTLY BELOW [_darwinPendingLimit], AND THAT GAP IS NOT ROUNDING.
  /// [_digestId] lives in the SAME per-app pool: a renewal set filling all 64
  /// slots would push the weekly digest out, and the digest is the one
  /// notification that can still tell a user something when their reminders
  /// have been capped. Four slots is room for the digest and for whatever this
  /// service is asked to schedule next, at a cost of four reminders on an
  /// account that already has more than 60 subscriptions.
  static const int renewalReminderBudget = _darwinPendingLimit - 4;

  /// Whether [platform] silently discards pending notifications past a cap.
  ///
  /// ⚠️ ANDROID IS DELIBERATELY ABSENT. It schedules through `AlarmManager`,
  /// which has no 64-request pool, so applying the budget there would delete
  /// working reminders to solve a problem that platform does not have — a
  /// regression dressed as a fix. Linux and Windows are absent for a blunter
  /// reason: `zonedSchedule` reaches no implementation at all on them (see
  /// [scheduleRenewalReminder]), so there is nothing there to budget.
  @visibleForTesting
  static bool platformCapsPendingNotifications(TargetPlatform platform) =>
      platform == TargetPlatform.iOS || platform == TargetPlatform.macOS;

  /// The subscriptions [syncAll] will actually schedule a reminder for, in the
  /// order it will schedule them.
  ///
  /// Below the budget, or on a platform that does not cap, this is the input
  /// untouched — the ordinary account must behave exactly as it did. Above it,
  /// the set is narrowed on purpose and in a defensible order:
  ///
  ///  1. drop the reminders that CANNOT fire — a renewal already past its
  ///     reminder instant is skipped by [scheduleRenewalReminder] anyway, and
  ///     letting those consume slots would spend the budget on nothing (an
  ///     account carrying stale renewal dates is exactly the crowded account
  ///     this cap exists for);
  ///  2. soonest first — the reminders a user could still act on;
  ///  3. take [renewalReminderBudget].
  ///
  /// The result is the same overflow the OS was going to impose regardless,
  /// except chosen rather than arbitrary, and countable
  /// ([remindersDroppedByBudget]) rather than invisible.
  @visibleForTesting
  List<Subscription> plannedReminders(
    List<Subscription> subs, {
    int daysBefore = 2,
    TargetPlatform? platform,
  }) {
    if (kIsWeb) return List<Subscription>.unmodifiable(subs);
    final TargetPlatform target = platform ?? defaultTargetPlatform;
    if (!platformCapsPendingNotifications(target) ||
        subs.length <= renewalReminderBudget) {
      return List<Subscription>.unmodifiable(subs);
    }
    final List<Subscription> schedulable =
        subs.where((Subscription s) => _whenFor(s, daysBefore) != null).toList()
          ..sort(
            (Subscription a, Subscription b) =>
                a.nextRenewal.compareTo(b.nextRenewal),
          );
    return List<Subscription>.unmodifiable(
      schedulable.take(renewalReminderBudget),
    );
  }

  /// How many subscriptions the last [syncAll] left out because the cap in
  /// [plannedReminders] narrowed the set. Exactly 0 whenever the cap did not
  /// bite — on Android, and on any account inside [renewalReminderBudget] —
  /// because the planner returns its input untouched in both cases.
  ///
  /// This is the "observable" half of the cap: the OS was going to discard
  /// these either way, but a number the app can read is the whole difference
  /// between a deliberate limit and a silent one.
  int get remindersDroppedByBudget => _droppedByBudget;
  int _droppedByBudget = 0;

  /// Rebuilds the full reminder set (call after edits, or on app resume).
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    int daysBefore = 2,
  }) async {
    if (!_ready) return;
    await cancelAll();
    final List<Subscription> planned = plannedReminders(
      subs,
      daysBefore: daysBefore,
    );
    _droppedByBudget = subs.length - planned.length;
    for (final Subscription s in planned) {
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
