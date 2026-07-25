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
  AnalyticsFunnel({
    required core.Analytics analytics,
    required core.KeyValueStore store,
    DateTime Function()? clock,
  }) : _a = analytics,
       _store = store,
       _now = clock ?? DateTime.now;

  final core.Analytics _a;
  final core.KeyValueStore _store;
  final DateTime Function() _now;

  static const String _kFirstLaunchDone = 'nikatru.analytics.first_launch_done';
  static const String _kLastOpen = 'nikatru.analytics.last_open';

  /// Launch-time lifecycle: `first_launch` (once per INSTALL, ever), `app_open`
  /// (every launch), and `return_visit{days_since_last}` when this is not the
  /// first launch.
  ///
  /// `first_launch`, not `app_install`: a reinstall is indistinguishable from a
  /// new user, so this is an install-level denominator and must not be named as
  /// though it counted people.
  Future<void> onLaunch() async {
    try {
      final String? done = await _store.read(_kFirstLaunchDone);
      final bool isFirst = done == null || done.isEmpty;
      if (isFirst) {
        await _a.log('first_launch');
        await _store.write(_kFirstLaunchDone, '1');
      }
      await _a.log('app_open');

      final String? lastRaw = await _store.read(_kLastOpen);
      final DateTime now = _now();
      if (!isFirst && lastRaw != null && lastRaw.isNotEmpty) {
        final DateTime? last = DateTime.tryParse(lastRaw);
        if (last != null) {
          // Bucketed, not exact: an unbounded integer is a fingerprinting
          // surface, and the retention curve only needs D1/D7/D30 shape.
          await _a.log(
            'return_visit',
            params: <String, Object?>{
              'days_since_last': _bucketDays(now.difference(last).inDays),
            },
          );
        }
      }
      await _store.write(_kLastOpen, now.toUtc().toIso8601String());
    } catch (_) {
      // never surface
    }
  }

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

  /// D1 / D7 / D30 shaped buckets.
  static String _bucketDays(int days) {
    if (days <= 0) return 'same_day';
    if (days == 1) return '1';
    if (days <= 7) return '2_7';
    if (days <= 30) return '8_30';
    return '30_plus';
  }
}

/// The funnel, available once analytics and storage have resolved. Null while
/// still resolving or in a demo/test build — callers must tolerate that rather
/// than await it, so a slow store can never delay a screen.
final FutureProvider<AnalyticsFunnel> analyticsFunnelProvider =
    FutureProvider<AnalyticsFunnel>((ref) async {
      final core.Analytics a = await ref.watch(analyticsProvider.future);
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      return AnalyticsFunnel(analytics: a, store: kv);
    });
