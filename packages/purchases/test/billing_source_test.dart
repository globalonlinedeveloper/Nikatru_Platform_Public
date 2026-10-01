// ⏱ 2026-10-01 · review 1 of #1114 (item 5): WHERE THE USER PAID is read, never
// guessed. Our own merchant-of-record rows carry no `store` (the server writes
// NULL, the client reads ''), the two stores carry RevenueCat's names, and
// anything else is null — so no sentence is worded for a source nobody has read.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

core.Entitlements _pro(Object? store) =>
    core.Entitlements.fromJson(<String, Object?>{
      'app_id': 'subscriptiontracker',
      'is_pro': true,
      'entitlements': <Object?>[
        <String, Object?>{
          'entitlement': 'pro',
          'product_id': 'pro_monthly',
          'store': store,
          'is_active': true,
          'expires_at': DateTime.now()
              .add(const Duration(days: 20))
              .toUtc()
              .toIso8601String(),
        },
      ],
    });

void main() {
  test('our own rows: the server serves store null, and that is web', () {
    expect(BillingSource.ofStore(BillingSource.webStore), BillingSource.web);
    expect(
      BillingSource.activePlanOf(_pro(null), DateTime.now())?.source,
      BillingSource.web,
    );
  });

  test('the two stores, by RevenueCat\'s names', () {
    expect(BillingSource.ofStore('APP_STORE'), BillingSource.appStore);
    expect(BillingSource.ofStore('MAC_APP_STORE'), BillingSource.appStore);
    expect(BillingSource.ofStore('PLAY_STORE'), BillingSource.googlePlay);
  });

  test('a store this client cannot name is null, never web', () {
    for (final String store in <String>[
      'PROMOTIONAL',
      'STRIPE',
      'AMAZON',
      'RC_BILLING',
      'PADDLE',
      'web',
    ]) {
      expect(BillingSource.ofStore(store), isNull, reason: store);
      final ({BillingSource? source, DateTime? periodEnds})? plan =
          BillingSource.activePlanOf(_pro(store), DateTime.now());
      expect(plan, isNotNull, reason: 'the plan is still active: $store');
      expect(plan!.source, isNull, reason: store);
    }
  });
}
