/// Local-notification seam (CFG G-25 / engagement chassis). Streak and
/// daily-goal reminders are the retention engine for content apps. The concrete
/// impl (`flutter_local_notifications` + timezone) lives in the app/adapter
/// layer so `core` stays pure Dart — mirroring the storage seams (ADR 005).
library;

/// A recurring daily reminder to schedule (a streak/goal nudge at [hour]:[minute]
/// local time). [id] is stable so the same reminder can be updated or cancelled.
class DailyReminder {
  const DailyReminder({
    required this.id,
    required this.title,
    required this.body,
    required this.hour,
    required this.minute,
  });

  final int id;
  final String title;
  final String body;

  /// 0–23 local hour.
  final int hour;

  /// 0–59 minute.
  final int minute;
}

/// The Android CHANNEL a notification posts on — the row the user sees under
/// the app in the OS notification settings. Pure data, so `core` names a
/// channel without importing a plugin; the adapter maps it. Other platforms
/// ignore it.
class NotificationChannel {
  const NotificationChannel({
    required this.id,
    required this.name,
    required this.description,
    this.important = false,
  });

  /// Stable forever: Android keys the user's per-channel choices by it.
  final String id;
  final String name;
  final String description;

  /// High importance (heads-up) rather than the default.
  final bool important;
}

/// A BUTTON on a posted notification — "Mark as paid", "Snooze 1 day" (NO-10).
///
/// Pure data like [NotificationChannel]: `core` names the button, the adapter
/// maps it onto each platform's own action type, and a press comes back as a
/// [NotificationTap] whose [NotificationTap.actionId] is [id]. Already rendered
/// in the user's language, because the adapter has no `BuildContext` either.
class NotificationAction {
  const NotificationAction({required this.id, required this.title});

  /// A short `[a-z0-9_]` token, stable forever: it is what a press hands back.
  final String id;
  final String title;
}

/// A ONE-OFF notification at a local wall-clock time — a renewal due in two
/// days, a cancel-by date — as opposed to [DailyReminder]'s repeat.
///
/// [at] is read as a WALL CLOCK in the device's own zone: only its year,
/// month, day, hour, minute and second are used, and the adapter resolves them
/// in the device's IANA zone (DST-correct), so `DateTime(2026, 10, 3, 9, 30)`
/// means 09:30 where the user is on that day. The second is honoured so a
/// "test reminder in ten seconds" (NO-13) is not truncated into the past.
class ScheduledNotification {
  const ScheduledNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.at,
    this.payload,
    this.channel,
    this.actions = const <NotificationAction>[],
  });

  final int id;
  final String title;
  final String body;
  final DateTime at;

  /// Handed back on tap as [NotificationTap.payload] — e.g. `sub:<id>`, so a
  /// tap can open the thing the notification names.
  final String? payload;

  /// Null = the adapter's default channel.
  final NotificationChannel? channel;

  /// The buttons on the notification, in order. Empty = none. Ignored where
  /// the impl reports it cannot carry actions (Linux, web).
  final List<NotificationAction> actions;

  @override
  String toString() => 'ScheduledNotification(id: $id, at: $at)';
}

/// A notification the user TAPPED — the inbound half of the seam.
///
/// Pure Dart on purpose: this is what crosses the facade, so no plugin type
/// (`NotificationResponse` and friends) may appear in it or in
/// [NotificationService]. The `flutter_local_notifications` types stay inside
/// `packages/notifications`'s `_io` adapter, which maps them to this.
class NotificationTap {
  const NotificationTap({required this.id, this.payload, this.actionId});

  /// The id the notification was posted/scheduled under — the same [DailyReminder.id]
  /// the caller chose, so a tap can be traced back to the reminder that caused it.
  final int id;

  /// Whatever the poster attached, or null. Free-form and UNTRUSTED: it comes
  /// back through the OS, so treat it as input rather than as state.
  final String? payload;

  /// The [NotificationAction.id] of the BUTTON pressed, or null when the body
  /// was tapped. UNTRUSTED like [payload]: compare it, never route by it.
  final String? actionId;

  /// The ENUMERABLE code an analytics funnel may log.
  ///
  /// 🔴 NOT the raw [payload]. `notification_opened{kind}` lands in D1, and a
  /// raw payload is free text there — the exact defect
  /// `AnalyticsFunnel.onPurchaseFailed` documents for its `reason`. Anything
  /// that is not a short `[a-z0-9_]` token collapses to `other`.
  String get kind {
    final String? p = payload;
    if (p == null || p.isEmpty || p.length > 32) return 'other';
    return RegExp(r'^[a-z0-9_]+$').hasMatch(p) ? p : 'other';
  }

  @override
  String toString() => 'NotificationTap(id: $id, kind: $kind)';
}

/// Seam for local notifications. Impls schedule via the OS, and **not every
/// platform supports every operation** — the concrete impl reports its own
/// capability matrix and no-ops what it can't do so a caller never crashes (e.g.
/// the `flutter_local_notifications` adapter can't schedule on Web or Linux,
/// nor even show on Web, nor either on Windows without an app identity). Callers fall back to an in-app catch-up nudge
/// where an operation no-ops; the [NoOpNotificationService] covers the rest.
abstract interface class NotificationService {
  /// One-time setup (timezone db, platform channels). Safe to call more than once.
  Future<void> init();

  /// Ask the user for notification permission; returns whether it was granted.
  Future<bool> requestPermission();

  /// Show a notification immediately (works on all platforms).
  Future<void> showNow({required String title, required String body});

  /// Schedule [reminder] to fire daily at its local time. No-op where the impl's
  /// backend can't schedule (e.g. Web/Linux with flutter_local_notifications).
  /// ⚠️ Windows schedules the NEXT instance only (the plugin cannot repeat
  /// there); the boot-path resync re-arms it every launch.
  Future<void> scheduleDaily(DailyReminder reminder);

  /// Schedule a ONE-OFF [notification] at its local wall-clock time. Replaces
  /// a pending one with the same id; an instant already past posts nothing.
  /// No-op where the impl cannot schedule (web).
  Future<void> scheduleAt(ScheduledNotification notification);

  /// Make the pending set of ids [owns] claims EXACTLY [wanted]: every owned
  /// pending id not in [wanted] is cancelled, and each of [wanted] is
  /// scheduled as by [scheduleAt]. Ids [owns] does not claim are never
  /// touched — that is what lets two callers share one OS queue without a
  /// `cancelAll()` taking the other's notifications.
  Future<void> reconcile(
    List<ScheduledNotification> wanted, {
    required bool Function(int id) owns,
  });

  /// Cancel a scheduled notification by id.
  Future<void> cancel(int id);

  /// Cancel every scheduled notification.
  Future<void> cancelAll();

  /// Taps on notifications this impl posted — the INBOUND half, without which
  /// a scheduled reminder can wake the user and open nothing.
  ///
  /// Broadcast and idempotent: call it as often as you like, you get the same
  /// stream. Emits only after [init] (that is where the impl registers with the
  /// OS), and never emits on a platform that cannot notify — a caller must
  /// tolerate a stream that stays silent forever rather than await a first event.
  ///
  /// A METHOD rather than a getter, deliberately: `tooling/ci/assert-capability-register.mjs`
  /// verifies a declared seam method by finding its DECLARATION, and its
  /// `declaresMethod` regex requires a paren. A getter here would be listed in
  /// the register and checked by nothing — this repo's own recurring failure.
  Stream<NotificationTap> notificationTaps();

  /// The tap that LAUNCHED this process, once; null after the first call, and
  /// null when the app was started any other way.
  ///
  /// 🔴 [notificationTaps] CANNOT CARRY IT. When a tap cold-starts the app the
  /// OS delivers it as launch details, before any listener exists, and the
  /// plugin never calls its tap callback for it — so a reminder that opens a
  /// closed app would open the home screen instead of what it names. Call
  /// after [init].
  Future<NotificationTap?> takeLaunchTap();
}

/// A do-nothing [NotificationService] — the safe default before a real impl is
/// injected, and the fallback on platforms without local-notification support.
/// Never throws.
class NoOpNotificationService implements NotificationService {
  const NoOpNotificationService();

  @override
  Future<void> init() async {}

  @override
  Future<bool> requestPermission() async => false;

  @override
  Future<void> showNow({required String title, required String body}) async {}

  @override
  Future<void> scheduleDaily(DailyReminder reminder) async {}

  @override
  Future<void> scheduleAt(ScheduledNotification notification) async {}

  @override
  Future<void> reconcile(
    List<ScheduledNotification> wanted, {
    required bool Function(int id) owns,
  }) async {}

  @override
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}

  /// Never emits — there is no platform under this impl to tap. `const` so the
  /// whole class stays const-constructible.
  @override
  Stream<NotificationTap> notificationTaps() =>
      const Stream<NotificationTap>.empty();

  @override
  Future<NotificationTap?> takeLaunchTap() async => null;
}
