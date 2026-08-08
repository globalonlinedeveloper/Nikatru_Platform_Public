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

/// A notification the user TAPPED — the inbound half of the seam.
///
/// Pure Dart on purpose: this is what crosses the facade, so no plugin type
/// (`NotificationResponse` and friends) may appear in it or in
/// [NotificationService]. The `flutter_local_notifications` types stay inside
/// `packages/notifications`'s `_io` adapter, which maps them to this.
class NotificationTap {
  const NotificationTap({required this.id, this.payload});

  /// The id the notification was posted/scheduled under — the same [DailyReminder.id]
  /// the caller chose, so a tap can be traced back to the reminder that caused it.
  final int id;

  /// Whatever the poster attached, or null. Free-form and UNTRUSTED: it comes
  /// back through the OS, so treat it as input rather than as state.
  final String? payload;

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
/// the `flutter_local_notifications` adapter can't schedule on Web/Windows/Linux,
/// nor even show on Web/Windows). Callers fall back to an in-app catch-up nudge
/// where an operation no-ops; the [NoOpNotificationService] covers the rest.
abstract interface class NotificationService {
  /// One-time setup (timezone db, platform channels). Safe to call more than once.
  Future<void> init();

  /// Ask the user for notification permission; returns whether it was granted.
  Future<bool> requestPermission();

  /// Show a notification immediately (works on all platforms).
  Future<void> showNow({required String title, required String body});

  /// Schedule [reminder] to fire daily at its local time. No-op where the impl's
  /// backend can't schedule (e.g. Web/Windows/Linux with flutter_local_notifications).
  Future<void> scheduleDaily(DailyReminder reminder);

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
  Future<void> cancel(int id) async {}

  @override
  Future<void> cancelAll() async {}

  /// Never emits — there is no platform under this impl to tap. `const` so the
  /// whole class stays const-constructible.
  @override
  Stream<NotificationTap> notificationTaps() =>
      const Stream<NotificationTap>.empty();
}
