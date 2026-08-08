import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

/// [13]T-9 — THE INBOUND HALF OF THE NOTIFICATION SEAM, IN THE CHASSIS.
///
/// 🔴 WHAT THIS EXISTS TO FIX, AND WHY IT IS IN THE BRICK. The tap loop was
/// wired into `apps/subly` and **only** there. Every app this factory stamps
/// inherited the OUTBOUND half in full — `notificationServiceProvider`,
/// `applyReminderChoice`, `resyncOnStart`, the whole reminder rail — and NOTHING
/// on the way back: `core.NotificationService.notificationTaps()` had no
/// subscriber anywhere in the template, so a stamped app could wake a user at
/// 09:00 and learn nothing at all when they tapped it. `notification_opened` had
/// zero emitters in every app but one.
///
/// Nothing went red, and nothing could: a tap that reaches no listener is
/// indistinguishable from no tap. That is this repo's "fail-closed seam with no
/// proven open path" shape ([pipeline C-6]) — the same one that shipped four
/// times before — and the cost of leaving it in one app is that app #2 through
/// #50 are born with a permanently silent tap stream.
///
/// ── WHY IT LOGS THROUGH `core.Analytics` RATHER THAN A FUNNEL ───────────────
/// Subly's version takes its app-owned `AnalyticsFunnel`. The chassis has no
/// such object and deliberately does not grow one: the launch trio lives in
/// `core.AnalyticsLifecycle` and the money events in `MoneyFunnel`, both in
/// shared packages, because an event NAME that lives in an app becomes fifty
/// copies the moment the factory stamps fifty apps. This class takes the seam
/// itself, so the only app-local thing here is the subscription.
///
/// The whole class is that one subscription. It is a class rather than a
/// `listen` buried in a widget so it can be constructed with fakes and asserted
/// end to end (see `test/chassis_properties_test.dart`, property
/// `notification-tap-observed`), and so the route from the OS to
/// `notification_opened` is one named, greppable thing.
class NotificationTapObserver {
  NotificationTapObserver({
    required core.NotificationService service,
    required core.Analytics analytics,
  }) : _service = service,
       _analytics = analytics;

  /// The event name, spelled ONCE. `analytics-events.md` §5 Engage — it is a D1
  /// column, not a label, so it is a constant rather than a literal repeated at
  /// the call site and in the assertion.
  static const String kEvent = 'notification_opened';

  final core.NotificationService _service;
  final core.Analytics _analytics;
  StreamSubscription<core.NotificationTap>? _sub;

  /// Whether taps are currently being observed — the property a test can assert
  /// without reaching into the subscription.
  bool get isListening => _sub != null;

  /// Subscribes to the seam's tap stream. Idempotent: calling it twice does not
  /// double-log, which matters because the caller is a widget `build` that
  /// Flutter may run any number of times.
  void start() {
    if (_sub != null) return;
    _sub = _service.notificationTaps().listen(
      // `tap.kind`, NEVER `tap.payload`. The payload round-trips through the OS
      // and is free text; `kind` is the enumerable code core sanitises it down
      // to. See core's NotificationTap.kind for why a raw payload in a D1
      // column is the defect and not the feature.
      (core.NotificationTap tap) => _log(tap.kind),
      // Analytics is never allowed to be why a flow breaks — the same rule every
      // emitter in this chassis follows. A stream error here would otherwise
      // reach the zone's uncaught handler and be reported as a crash.
      onError: (Object _) {},
      cancelOnError: false,
    );
  }

  Future<void> stop() async {
    final StreamSubscription<core.NotificationTap>? s = _sub;
    _sub = null;
    await s?.cancel();
  }

  Future<void> _log(String kind) async {
    try {
      await _analytics.log(kEvent, params: <String, Object?>{'kind': kind});
    } catch (_) {
      // Fire-and-forget, failures swallowed: a measurement failure is not a
      // user-facing failure.
    }
  }
}
