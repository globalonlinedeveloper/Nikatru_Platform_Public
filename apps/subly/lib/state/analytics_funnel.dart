import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'analytics_providers.dart';

/// The v1 funnel for Subly ([ADR 011], `analytics-events.md` §v1 scope).
///
/// Nine events, not the whole taxonomy: the monetize funnel plus activation and
/// core retention. Instrumenting everything on day one produces a lot of rows
/// and no decisions.
///
/// Every method is fire-and-forget and swallows its own failures — analytics is
/// never allowed to be the reason a user-facing flow breaks or stalls.
class AnalyticsFunnel {
  // `store` and `clock` left this constructor with `onLaunch()` (P2.6a): the
  // remaining events are stateless fire-and-forget, and a parameter nothing
  // reads is a fingerprinting surface for bugs — callers wiring a store that
  // cannot matter.
  AnalyticsFunnel({required core.Analytics analytics}) : _a = analytics;

  final core.Analytics _a;

  // 🪦 `onLaunch()` LIVED HERE UNTIL P2.6a ([ADR 037]) and was DELETED, not
  // moved: the launch trio (`first_launch` once-per-install, `app_open`,
  // `return_visit{days_since_last}`) is emitted by the chassis
  // `core.AnalyticsLifecycle` via `logLaunchLifecycle` (lib/state/providers.dart),
  // whose one caller is `AnalyticsGate`'s granted branch — same consent gating,
  // SAME storage keys (`nikatru.analytics.first_launch_done` /
  // `nikatru.analytics.last_open`, core/analytics_lifecycle.dart:9,:14 — the
  // lifecycle was extracted FROM this file, which is why existing installs do
  // not re-emit `first_launch` after the swap). Keeping both callers would have
  // emitted `app_open` twice per launch, doubling the denominator every
  // retention and activation ratio divides by. The funnel keeps only Subly's
  // app-specific events below.

  /// The "aha" moment. Subly's activation is its first subscription added —
  /// the single strongest predictor of retention and of paying, which is why it
  /// gets its own event name rather than being inferred from `core_action`.
  Future<void> onActivation() async {
    try {
      await _a.log(
        'activation',
        params: <String, Object?>{'kind': 'first_subscription_added'},
      );
    } catch (_) {}
  }

  Future<void> onPaywallViewed(String trigger) =>
      _safe('paywall_viewed', <String, Object?>{'trigger': trigger});

  Future<void> onCheckoutStarted(String sku) =>
      _safe('checkout_started', <String, Object?>{'sku': sku});

  Future<void> onPurchaseSuccess(String sku) =>
      _safe('purchase_success', <String, Object?>{'sku': sku});

  /// [reason] must be an ENUMERABLE code (`cancelled`, `declined`, `network`),
  /// never a raw store error message — that would be free text in D1.
  Future<void> onPurchaseFailed(String reason) =>
      _safe('purchase_failed', <String, Object?>{'reason': reason});

  Future<void> onNotificationOpened(String kind) =>
      _safe('notification_opened', <String, Object?>{'kind': kind});

  Future<void> _safe(String event, Map<String, Object?> params) async {
    try {
      await _a.log(event, params: params);
    } catch (_) {}
  }
}

/// The funnel, available once analytics and storage have resolved. Null while
/// still resolving or in a demo/test build — callers must tolerate that rather
/// than await it, so a slow store can never delay a screen.
final FutureProvider<AnalyticsFunnel> analyticsFunnelProvider =
    FutureProvider<AnalyticsFunnel>((ref) async {
      final core.Analytics a = await ref.watch(analyticsProvider.future);
      return AnalyticsFunnel(analytics: a);
    });
