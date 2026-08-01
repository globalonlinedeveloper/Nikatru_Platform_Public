import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

class _RecordingAnalytics implements core.Analytics {
  final List<({String event, Map<String, Object?>? params})> logged =
      <({String event, Map<String, Object?>? params})>[];
  bool throwOnLog = false;

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async {
    if (throwOnLog) throw StateError('recorder exploded');
    logged.add((event: event, params: params));
  }

  @override
  Future<void> flush() async {}

  @override
  Future<void> purge() async {}
}

void main() {
  group('[5]M-16 · the four money events, which had ZERO callers', () {
    test('each method emits its documented event name and params', () async {
      final _RecordingAnalytics a = _RecordingAnalytics();
      final MoneyFunnel f = MoneyFunnel(a);

      await f.onPaywallViewed('feature_gate');
      await f.onCheckoutStarted('pro_monthly');
      await f.onPurchaseSuccess('pro_monthly');
      await f.onPurchaseFailed('channel_not_permitted');

      expect(
        a.logged.map((r) => r.event).toList(),
        <String>[
          'paywall_viewed',
          'checkout_started',
          'purchase_success',
          'purchase_failed',
        ],
      );
      expect(a.logged[0].params, <String, Object?>{'trigger': 'feature_gate'});
      expect(a.logged[3].params,
          <String, Object?>{'reason': 'channel_not_permitted'});
    });

    test('🔒 no event carries a user id — the pseudonymity firewall', () {
      // [ADR 020]:21. The obvious way to answer "which cohort paid?" is to join
      // the pseudonymous analytics id to the paying account id, and doing that
      // ONCE retroactively reclassifies the whole analytics store as personal
      // data subject to DPDP erasure, for every app, forever. It cannot be
      // undone by deleting the join afterwards.
      //
      // Asserted on the API rather than on a payload: there is no `userId`
      // parameter to forget to leave out.
      final _RecordingAnalytics a = _RecordingAnalytics();
      final MoneyFunnel f = MoneyFunnel(a);
      expect(f.onPaywallViewed, isA<Future<void> Function(String)>());
      expect(f.onCheckoutStarted, isA<Future<void> Function(String)>());
      expect(f.onPurchaseSuccess, isA<Future<void> Function(String)>());
      expect(f.onPurchaseFailed, isA<Future<void> Function(String)>());
    });

    test('analytics can never break a purchase', () async {
      // Best-effort by contract. A throwing recorder must not take the paywall
      // down with it.
      final _RecordingAnalytics a = _RecordingAnalytics()..throwOnLog = true;
      final MoneyFunnel f = MoneyFunnel(a);
      await expectLater(f.onPurchaseSuccess('pro_monthly'), completes);
    });
  });
}
