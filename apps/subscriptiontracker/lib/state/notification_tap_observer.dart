import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart' as core;

import '../services/notifications/notification_service.dart'
    show RenewalReminders;
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

/// Where a tapped notification's [payload] leads, or null for nowhere.
///
/// ST-R5 (audit C27): `sub:{id}` — every renewal, trial and cancel-by
/// reminder carries it (RenewalReminders.payloadFor) — opens `/sub/{id}`.
/// The payload comes back through the OS and is UNTRUSTED, so the id must be
/// a plain token; anything else goes nowhere rather than into a route.
///
/// ST-I2 (audit C14): `budget` — the over-budget alert
/// (`RenewalReminders.overBudgetPayload`) — opens `/insights`, where the
/// budget card is.
String? routeForNotificationPayload(String? payload) {
  if (payload == RenewalReminders.overBudgetPayload) return '/insights';
  if (payload == null || !payload.startsWith('sub:')) return null;
  final String id = payload.substring(4);
  if (!RegExp(r'^[A-Za-z0-9_-]{1,128}$').hasMatch(id)) return null;
  return '/sub/$id';
}

/// ST-R5 (audit C27): the wire between a tap and the screen it names.
///
/// A tap was logged and routed nowhere, so a renewal reminder opened the app
/// wherever it had been. This subscribes to the SAME seam stream the funnel
/// observer does (broadcast, so both get every tap) and, once at start, to
/// [core.NotificationService.takeLaunchTap] — a tap that COLD-STARTS the app
/// arrives there, never on the stream. Independent of analytics consent:
/// opening what the user tapped is not tracking.
class NotificationTapRouter {
  NotificationTapRouter({
    required core.NotificationService service,
    required void Function(String route) open,
  }) : _service = service,
       _open = open;

  final core.NotificationService _service;
  final void Function(String route) _open;
  StreamSubscription<core.NotificationTap>? _sub;

  void _route(core.NotificationTap? tap) {
    final String? route = routeForNotificationPayload(tap?.payload);
    if (route != null) _open(route);
  }

  /// Idempotent, like [NotificationTapObserver.start].
  Future<void> start() async {
    if (_sub != null) return;
    _sub = _service.notificationTaps().listen(
      _route,
      onError: (Object _) {},
      cancelOnError: false,
    );
    try {
      _route(await _service.takeLaunchTap());
    } on Object {
      // A launch that cannot be read opens where the app opens anyway.
    }
  }

  Future<void> stop() async {
    final StreamSubscription<core.NotificationTap>? s = _sub;
    _sub = null;
    await s?.cancel();
  }
}
