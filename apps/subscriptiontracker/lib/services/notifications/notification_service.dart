import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        debugPrint,
        defaultTargetPlatform,
        immutable,
        kIsWeb,
        visibleForTesting;
import 'package:flutter/services.dart' show PlatformException;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:nikatru_notifications/nikatru_notifications.dart'
    show
        LocalTimezoneResolution,
        LocalTimezoneResolver,
        NotificationCapabilities,
        resolveLocalTimezone;
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
/// in this template. The calls below target the 22.x API (named parameters since
/// 20.0.0). If `flutter pub get` resolves a newer major, re-check
/// `zonedSchedule` (androidScheduleMode) and the Windows init settings.
class NotificationService {
  NotificationService._() : _platformOverride = null, _isWebOverride = null;
  static final NotificationService instance = NotificationService._();

  /// For test fakes ONLY. The singleton above cannot be replaced and the real
  /// methods need a platform, so the reminder-wiring tests (which must prove a
  /// settings toggle reaches this service — see settings_wiring_test.dart)
  /// subclass via this constructor and override the scheduling methods to
  /// record calls. Production wiring keeps using [instance].
  ///
  /// [platform] pins the capability matrix for a test that cannot (or must
  /// not) flip `debugDefaultTargetPlatformOverride` for the whole process.
  @visibleForTesting
  NotificationService.forTesting({TargetPlatform? platform, bool? isWeb})
    : _platformOverride = platform,
      _isWebOverride = isWeb;

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();
  bool _ready = false;
  final TargetPlatform? _platformOverride;
  final bool? _isWebOverride;
  NotificationCapabilities? _caps;

  /// What THIS platform can deliver, from the chassis matrix — the same
  /// object the shared adapter and the settings screen consult.
  ///
  /// 🔴 EVERY SCHEDULING CALL BELOW IS GATED ON THIS, AND IT USED NOT TO BE.
  /// `flutter_local_notifications` 17.2.4 answers `initialize` with `true` on
  /// Windows and Linux and then THROWS `UnimplementedError` out of
  /// `zonedSchedule` (lib/src/flutter_local_notifications_plugin.dart:377) —
  /// so on both desktop targets `_ready` went true and every list load ended
  /// in an uncaught async error, while the settings screen said reminders
  /// were unavailable. Parity is either the feature on all seven targets or
  /// an honest per-target "not here, and why" — never a throw. Windows gained
  /// a plugin at flutter_local_notifications 19.0.0 ("[Windows] Added
  /// support for Windows", CHANGELOG) and the workspace is on 22.x, but that
  /// plugin needs WindowsInitializationSettings (an AppUserModelID and a GUID)
  /// which this service does not pass yet, so the matrix still says no and
  /// this service obeys it (O-RENEWAL-REMINDERS-OFF-ON-DESKTOP).
  NotificationCapabilities get capabilities =>
      _caps ??= NotificationCapabilities.forPlatform(
        _platformOverride ?? defaultTargetPlatform,
        isWeb: _isWebOverride ?? kIsWeb,
      );

  /// The reason, for a settings screen, that this platform schedules nothing
  /// — `null` where it does. Keyed so the UI can pick a localised sentence.
  ReminderUnavailability? get unavailability {
    final NotificationCapabilities c = capabilities;
    if (c.canSchedule) return null;
    if (!c.canNotify) return ReminderUnavailability.noNotifications;
    return ReminderUnavailability.noScheduling;
  }

  static const String _channelId = 'renewals';

  /// Why `tz.local` is a fixed device offset rather than the device's IANA
  /// zone — null when the real zone was resolved. See [init].
  String? get timezoneFallbackReason => _timezoneFallbackReason;
  String? _timezoneFallbackReason;

  /// [localTimezone] is for tests ONLY; production takes the chassis default,
  /// which reads the device's IANA zone through `flutter_timezone`.
  Future<void> init({LocalTimezoneResolver? localTimezone}) async {
    // 🔴 THE MATRIX FIRST. Where the platform cannot notify at all (web, and
    // Windows until it has init settings) the plugin is never initialised and
    // `_ready` stays false, so every method below is the no-op it already is
    // for an uninitialised service. Where it can notify but not schedule
    // (Linux) the plugin IS initialised — an immediate `show` works there —
    // and the scheduling methods refuse individually on `canSchedule`.
    if (!capabilities.canNotify) return;
    tzdata.initializeTimeZones();
    // 🔴 THIS LINE USED TO BE A COMMENT SAYING "add flutter_timezone", AND
    // `tz.local` STAYED UTC. Every `tz.TZDateTime(tz.local, …, 9)` below was
    // therefore 09:00 UTC — 14:30 in Chennai — and the suite was green because
    // each app test pinned `tz.setLocalLocation(tz.UTC)`, the one zone where
    // the bug and the fix agree. The resolution is the chassis's
    // (`packages/notifications` device_timezone.dart) so this service and the
    // shared adapter — which drive the SAME plugin singleton and the SAME
    // process-global `tz.local` — can never disagree about the zone.
    //
    // Re-resolved on EVERY init(), which runs at every cold start: a device
    // that changes zone mid-session keeps its already-scheduled reminders at
    // the absolute instants they were computed at (the OS holds epoch
    // instants, not wall clocks), and the next launch re-syncs the set in the
    // new zone. DST needs no repair at all with an IANA location — the rules
    // travel with the zone, which is what the fixed-offset fallback lacks and
    // why that fallback announces itself.
    final LocalTimezoneResolution zone = await resolveLocalTimezone(
      resolver: localTimezone,
    );
    tz.setLocalLocation(zone.location);
    _timezoneFallbackReason = zone.fallbackReason;

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

    await _plugin.initialize(settings: settings);
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

  // ═══════════════════════════════════════════════════════════════════════════
  // EXACT ALARMS — the permission this app does not have, and must not need
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // 🔴 EVERY `zonedSchedule` BELOW USED TO PASS `exactAllowWhileIdle`
  // UNCONDITIONALLY, AND THE ANDROID MANIFEST DECLARES NO PERMISSION AT ALL.
  // Measured, not inferred: `apps/subscriptiontracker/android/app/src/main/
  // AndroidManifest.xml` carries zero `<uses-permission>` elements, and
  // flutter_local_notifications 22.3.1's own plugin manifest (like 17.2.4's) adds
  // VIBRATE and POST_NOTIFICATIONS. So SCHEDULE_EXACT_ALARM is not in the
  // merged manifest, `AlarmManager.canScheduleExactAlarms()` is false on every
  // Android 12+ device, and the plugin's Java side
  // (`FlutterLocalNotificationsPlugin.setupAllowWhileIdleAlarm` →
  // `checkCanScheduleExactAlarms`) throws `ExactAlarmPermissionException`.
  //
  // ⚠️ WHAT THAT COSTS IS NOT ONE REMINDER, IT IS ALL OF THEM. That exception
  // reaches Dart as `PlatformException('exact_alarms_not_permitted')` out of
  // `zonedSchedule`, nothing in this file or its callers catches it, and
  // [syncAll] schedules in a `for` loop — so the FIRST subscription throws and
  // the loop never reaches the second. An account with forty subscriptions gets
  // zero reminders, from one uncaught throw, on a code path no test exercised.
  //
  // ── WHY DEGRADING IS THE FIX AND NOT A CONSOLATION ─────────────────────────
  // SCHEDULE_EXACT_ALARM is NOT pre-granted on a fresh install from Android 13
  // onwards, and Android 14 revokes it outright after a backup-and-restore. So
  // "declare it and prompt" leaves a real, permanent population of users with
  // the permission refused, and a renewal reminder that only works for the users
  // who said yes to a dialog is a feature that silently is not there for the
  // rest. `setAndAllowWhileIdle` still fires while the device is dozing; it just
  // lets the OS batch the wake-up. A reminder that a charge lands in two days
  // tolerates a ten-minute window. A missing reminder does not.
  //
  // ── AND `USE_EXACT_ALARM` IS DELIBERATELY NOT USED ────────────────────────
  // It needs no prompt, which is exactly why it is tempting. Its two permitted
  // use cases are an alarm/timer app and a calendar app that shows event
  // notifications. A subscription tracker is neither, so declaring it is a
  // policy violation dressed as a convenience, and the review that catches it
  // catches it after upload.
  //
  // ── RECONCILED WITH THE CHASSIS ADAPTER, WHICH WAS ALREADY RIGHT ──────────
  // `packages/notifications/lib/src/local_notification_service_io.dart:334`
  // schedules its DAILY nudge with `inexactAllowWhileIdle` unconditionally and
  // needs no permission at all. That is correct there and stays untouched: a
  // daily nudge has no instant it must land on. This fork schedules a renewal
  // reminder at 09:00 on a named day, so it takes exact precision WHEN THE OS
  // WILL GIVE IT and the chassis's behaviour when it will not — strictly better
  // than either extreme, and the only difference between the two files is now a
  // reason rather than an oversight.

  /// Whether the OS will honour an EXACT alarm from this app right now.
  ///
  /// Asked FRESH every time it matters, never cached: the user can revoke
  /// "Alarms & reminders" from system settings at any moment, and a cached
  /// `true` is how an app goes on scheduling alarms the OS is refusing.
  ///
  /// `true` on every non-Android platform, and that is an accurate answer
  /// rather than a lenient one: `androidScheduleMode` is inert everywhere else
  /// (the Darwin and Linux `zonedSchedule` overloads do not take it), so there
  /// is no precision to lose.
  Future<bool> canScheduleExactAlarms() async {
    if (kIsWeb || !_ready) return false;
    final AndroidFlutterLocalNotificationsPlugin? android = _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    if (android == null) return true; // not Android — nothing to permit
    try {
      return (await android.canScheduleExactNotifications()) ?? false;
    } on PlatformException {
      // An older host that does not implement the method must read as "no", not
      // as a crash: "no" degrades to a reminder that still fires.
      return false;
    }
  }

  /// Sends the user to Android's "Alarms & reminders" screen for this app.
  ///
  /// 🔴 CALL THIS ONLY AFTER AN IN-APP EXPLANATION, AND ONLY FROM A USER
  /// GESTURE. It is `ACTION_REQUEST_SCHEDULE_EXACT_ALARM` — not a dialog but a
  /// full trip out to Settings, and an app that throws the user there with no
  /// sentence explaining why gets a back-press. Unlike the notification
  /// permission there is no "denied twice is permanent" cliff here, but there is
  /// also no second chance at a first impression.
  ///
  /// ⚠️ IT IS NEVER REQUIRED. Reminders work without it — see the block above.
  /// This buys precision, so the explanation must offer precision and must not
  /// imply that saying no turns reminders off.
  ///
  /// Returns the OS's answer where the host gives one; `false` otherwise. The
  /// honest read is [canScheduleExactAlarms] on the next resume, because the
  /// user grants this in Settings and comes back.
  Future<bool> requestExactAlarmPermission() async {
    if (kIsWeb || !_ready) return false;
    final AndroidFlutterLocalNotificationsPlugin? android = _plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >();
    if (android == null) return true; // not Android — nothing to request
    try {
      return (await android.requestExactAlarmsPermission()) ?? false;
    } on PlatformException {
      return false;
    }
  }

  /// The schedule mode a device that [permitted] (or refused) exact alarms gets.
  ///
  /// A named pure function so the DEGRADATION itself is assertable without a
  /// platform channel — the mapping is the whole decision, and a test that can
  /// only reach it through `zonedSchedule` cannot say what it is.
  @visibleForTesting
  static AndroidScheduleMode scheduleModeFor({required bool permitted}) =>
      permitted
      ? AndroidScheduleMode.exactAllowWhileIdle
      : AndroidScheduleMode.inexactAllowWhileIdle;

  /// [scheduleModeFor] over a live reading of the OS.
  ///
  /// ONE reading per batch, not one per subscription: [syncAll] resolves it once
  /// and passes it down. Eighty subscriptions must not become eighty platform
  /// round-trips for an answer that cannot change inside one loop.
  Future<AndroidScheduleMode> _resolveScheduleMode() async =>
      scheduleModeFor(permitted: await canScheduleExactAlarms());

  /// `zonedSchedule`, with the exact-alarm race closed.
  ///
  /// 🔴 THE CHECK AND THE SCHEDULE ARE TWO SEPARATE IPC CALLS, so the user can
  /// revoke "Alarms & reminders" between them. That window is small and the
  /// consequence is not: an uncaught `exact_alarms_not_permitted` out of the
  /// first subscription ends [syncAll]'s loop and costs the whole reminder set.
  /// Caught HERE rather than around the loop so the retry is per-notification
  /// and the ones already scheduled stand.
  Future<void> _schedule({
    required int id,
    required String title,
    required String body,
    required tz.TZDateTime when,
    required NotificationDetails details,
    required AndroidScheduleMode mode,
    DateTimeComponents? matchDateTimeComponents,
  }) async {
    Future<void> post(AndroidScheduleMode m) => _plugin.zonedSchedule(
      id: id,
      title: title,
      body: body,
      scheduledDate: when,
      notificationDetails: details,
      androidScheduleMode: m,
      matchDateTimeComponents: matchDateTimeComponents,
    );
    try {
      await post(mode);
    } on PlatformException catch (e) {
      // The plugin's own code for it, from FlutterLocalNotificationsPlugin.java
      // (`EXACT_ALARMS_PERMISSION_ERROR_CODE`). Anything else is a real failure
      // and must keep travelling — swallowing every PlatformException here is
      // how "no reminders" becomes indistinguishable from "all fine".
      if (e.code != 'exact_alarms_not_permitted') rethrow;
      await post(AndroidScheduleMode.inexactAllowWhileIdle);
    }
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
  @visibleForTesting
  tz.TZDateTime? whenFor(Subscription sub, int daysBefore) {
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
  /// reached no implementation at all. On 22.3.1 Windows has one (unused
  /// here: no init settings) and Linux still falls through to the platform
  /// default, which does not implement it. Recorded, not fixed here: this increment
  /// bounds the reminder set, and the desktop gap is a separate change.
  ///
  /// [mode] is the exact-vs-inexact decision, resolved ONCE by [syncAll] for a
  /// whole batch. `null` means "this is a single call, read the OS yourself" —
  /// see the exact-alarms block above for why the answer is never cached.
  Future<void> scheduleRenewalReminder(
    Subscription sub, {
    required ReminderCopy copy,
    int daysBefore = 2,
    AndroidScheduleMode? mode,
  }) async {
    if (!_ready || !capabilities.canSchedule) return;
    final tz.TZDateTime? when = whenFor(sub, daysBefore);
    if (when == null) return;

    final int id = _idFor(sub.id);
    _scheduledThisProcess.add(id);
    await _schedule(
      id: id,
      title: copy.reminderTitle,
      body: copy.reminderBody(sub.name, sub.nextRenewal),
      when: when,
      details: _detailsFor(copy),
      mode: mode ?? await _resolveScheduleMode(),
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
    if (!_ready || !capabilities.canSchedule) return;
    await _plugin.cancel(id: _digestId);
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
    await _schedule(
      id: _digestId,
      title: copy.digestTitle,
      body: copy.digestBody(count, formattedTotal),
      when: when,
      details: _detailsFor(copy),
      mode: await _resolveScheduleMode(),
      matchDateTimeComponents: DateTimeComponents.dayOfWeekAndTime,
    );
  }

  Future<void> cancelWeeklyDigest() async {
    if (!_ready) return;
    await _plugin.cancel(id: _digestId);
  }

  Future<void> cancelForSubscription(String id) async {
    if (!_ready) return;
    await _plugin.cancel(id: _idFor(id));
  }

  /// EVERYTHING the plugin holds — the chassis daily reminder included.
  ///
  /// ⚠️ SIGN-OUT AND ACCOUNT DELETION ONLY (`userStateDrops`). It is no
  /// longer what [syncAll] does: two services share one
  /// `FlutterLocalNotificationsPlugin` singleton, and when each called this
  /// the app's every list change wiped the chassis daily reminder (id 1) and
  /// the chassis "reminders off" path wiped every renewal reminder. Each
  /// service now cancels only the ids it owns — see [cancelOwnedRenewals].
  Future<void> cancelAll() async {
    if (!_ready) return;
    await _plugin.cancelAll();
  }

  /// Cancel every RENEWAL reminder this service owns, and nothing else.
  ///
  /// Owned means "in this service's id namespace" ([isRenewalReminderId]):
  /// the ids are read back from the OS's own pending list, so a reminder
  /// scheduled by a previous launch for a subscription that has since gone is
  /// cancelled too, and the digest, the chassis daily reminder and anything a
  /// future channel schedules are left standing. A platform whose pending
  /// list cannot be read falls back to the ids THIS process scheduled.
  Future<void> cancelOwnedRenewals() async {
    if (!_ready) return;
    final Set<int> owned = <int>{..._scheduledThisProcess};
    try {
      for (final PendingNotificationRequest r
          in await _plugin.pendingNotificationRequests()) {
        if (isRenewalReminderId(r.id)) owned.add(r.id);
      }
    } on Object catch (e) {
      // An older host, or a platform whose channel does not implement the
      // read: fall back to what this process knows it scheduled.
      debugPrint('[reminders] could not read pending notifications: $e');
    }
    for (final int id in owned) {
      await _plugin.cancel(id: id);
    }
    _scheduledThisProcess.clear();
  }

  /// The renewal-reminder ids scheduled by THIS process — the fallback set
  /// for [cancelOwnedRenewals] where the pending list cannot be read.
  final Set<int> _scheduledThisProcess = <int>{};

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
        subs.where((Subscription s) => whenFor(s, daysBefore) != null).toList()
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
    if (!_ready || !capabilities.canSchedule) return;
    // 🔴 OWNED IDS ONLY — never `cancelAll()`. See that method for the
    // defect: the chassis daily reminder shares this plugin instance.
    await cancelOwnedRenewals();
    final List<Subscription> planned = plannedReminders(
      subs,
      daysBefore: daysBefore,
    );
    _droppedByBudget = subs.length - planned.length;
    // ONE reading of the exact-alarm permission for the whole batch. It cannot
    // change inside this loop in any way the user would notice, and eighty
    // subscriptions must not mean eighty extra platform round-trips.
    final AndroidScheduleMode mode = await _resolveScheduleMode();
    for (final Subscription s in planned) {
      await scheduleRenewalReminder(
        s,
        copy: copy,
        daysBefore: daysBefore,
        mode: mode,
      );
    }
  }

  /// Fixed id for the digest, outside the renewal namespace below, so
  /// `cancelForSubscription` and [cancelOwnedRenewals] can never take it.
  static const int _digestId = 0x7ffffffe;

  /// The RENEWAL id namespace: [renewalIdBase, renewalIdBase + renewalIdRange).
  ///
  /// 🔴 DISJOINT BY CONSTRUCTION from every other id on the shared plugin:
  /// the chassis daily reminder is `kDailyReminderId` (1), the chassis
  /// immediate bucket is 0x7f000000, the digest is 0x7ffffffe. All three lie
  /// outside [0x10000000, 0x50000000), which is what lets [cancelOwnedRenewals]
  /// read the OS pending list and cancel by membership rather than by
  /// `cancelAll()`.
  static const int renewalIdBase = 0x10000000;
  static const int renewalIdRange = 0x40000000;

  /// Whether [id] is a renewal reminder this service owns.
  static bool isRenewalReminderId(int id) =>
      id >= renewalIdBase && id < renewalIdBase + renewalIdRange;

  /// A STABLE id for a subscription id.
  ///
  /// FNV-1a over the UTF-16 code units rather than `String.hashCode`: Dart
  /// documents `hashCode` as an implementation detail that may change between
  /// VM versions, and an id that moves with an SDK bump orphans every alarm
  /// the previous build scheduled — `cancelForSubscription` would cancel the
  /// new id while the old one kept firing.
  @visibleForTesting
  static int renewalIdFor(String id) {
    int h = 0x811c9dc5;
    for (final int unit in id.codeUnits) {
      h ^= unit;
      h = (h * 0x01000193) & 0xffffffff;
    }
    return renewalIdBase + (h % renewalIdRange);
  }

  int _idFor(String id) => renewalIdFor(id);
}

/// Why this platform cannot schedule a renewal reminder — the key a settings
/// screen turns into a sentence. Only ever non-null where the capability
/// matrix says so; the app never OFFERS what it cannot deliver.
enum ReminderUnavailability {
  /// No notification plugin at all on this target (web; Windows until an app
  /// supplies the 22.x Windows plugin its init settings).
  noNotifications,

  /// Immediate notifications work but nothing can be scheduled (Linux).
  noScheduling,
}
