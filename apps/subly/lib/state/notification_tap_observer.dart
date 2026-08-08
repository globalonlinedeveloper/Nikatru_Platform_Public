import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

import 'analytics_funnel.dart';

/// [13]T-9 — the wire between a tap and the funnel that records it.
///
/// 🔴 WHAT THIS EXISTS TO FIX. `AnalyticsFunnel.onNotificationOpened` and the
/// `notification_opened` event have been in the v1 set since [ADR 011] with
/// ZERO emitters, because nothing in the tree could tell the app that a
/// reminder had been tapped: `NotificationService` had six methods and all six
/// pointed outward. The event was not under-reported, it was unreportable —
/// and nothing went red, because a funnel method nobody calls compiles, tests
/// green and looks exactly like a feature waiting for traffic.
///
/// The whole class is this one subscription. It is a class rather than a
/// `listen` buried in a widget so it can be constructed with fakes and asserted
/// end to end (see test/notification_tap_observer_test.dart), and so the route
/// from the OS to `notification_opened` is one named, greppable thing.
class NotificationTapObserver {
  NotificationTapObserver({
    required core.NotificationService service,
    required AnalyticsFunnel funnel,
  }) : _service = service,
       _funnel = funnel;

  final core.NotificationService _service;
  final AnalyticsFunnel _funnel;
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
      (core.NotificationTap tap) => _funnel.onNotificationOpened(tap.kind),
      // Analytics is never allowed to be why a flow breaks — the same rule
      // every AnalyticsFunnel method follows. A stream error here would
      // otherwise reach the zone's uncaught handler and be reported as a crash.
      onError: (Object _) {},
      cancelOnError: false,
    );
  }

  Future<void> stop() async {
    final StreamSubscription<core.NotificationTap>? s = _sub;
    _sub = null;
    await s?.cancel();
  }
}
