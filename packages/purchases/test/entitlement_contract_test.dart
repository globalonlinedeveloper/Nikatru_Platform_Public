// The Dart end of contracts/entitlement/. These cases read the GENERATED table
// through the package's public surface — the same way an app would — so a
// generator that stopped emitting the table, or emitted it empty, fails here as
// well as in `generate-dart.mjs --check` and in
// tooling/ci/assert-entitlement-contract.mjs limb 4.
//
// ⚠️ THESE ARE NOT A SECOND COPY OF THE SET. Listing all eight reasons here
// would be the fourth transcription this whole arrangement exists to prevent —
// and a test that restates its subject passes forever after the subject is
// wrong. So the assertions are about SHAPE and about the one member with
// consequences: that the table is non-empty, that exactly one member restores
// access, and that it is the chargeback reversal. Everything else is the guard's
// job, because only the guard can see the SQL seed.
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

void main() {
  group('[5]M-3 · the Dart copy of the entitlement vocabulary is generated', () {
    test('the table is not empty — an empty set agrees with anything', () {
      expect(kRevocationReasons, isNotEmpty);
      expect(kMoneyEnvironments, isNotEmpty);
    });

    test('the two money worlds are live and sandbox, and nothing else', () {
      expect(kMoneyEnvironments, <String>['live', 'sandbox']);
      expect(isMoneyEnvironment('live'), isTrue);
      expect(isMoneyEnvironment('sandbox'), isTrue);
      expect(isMoneyEnvironment('production'), isFalse);
      expect(isMoneyEnvironment(''), isFalse);
    });

    test('EXACTLY ONE reason restores access, and it is the reversal', () {
      final List<String> restoring = kRevocationReasons
          .where((EntitlementRevocationReason r) => r.restoresAccess)
          .map((EntitlementRevocationReason r) => r.reason)
          .toList();
      // Nothing else in this rail gives access back. A copy that loses this flag
      // leaves a customer who raised a dispute in error, and lost it, locked out
      // forever.
      expect(restoring, <String>['chargeback_reversed']);
      expect(revocationRestoresAccess('chargeback_reversed'), isTrue);
      expect(revocationRestoresAccess('chargeback'), isFalse);
    });

    test('a reason outside the set is not recognised', () {
      expect(isRevocationReason('chargeback'), isTrue);
      expect(isRevocationReason('refunded_maybe'), isFalse);
      expect(revocationRestoresAccess('refunded_maybe'), isFalse);
    });

    test('every member has a non-empty reason and no duplicates', () {
      for (final EntitlementRevocationReason r in kRevocationReasons) {
        expect(r.reason, isNotEmpty);
        expect(r.toString(), r.reason);
      }
      final Set<String> unique = kRevocationReasons
          .map((EntitlementRevocationReason r) => r.reason)
          .toSet();
      expect(unique.length, kRevocationReasons.length);
    });
  });
group('the RevenueCat event map is generated, and it maps into OUR set', () {
    test('the map is not empty and at least one event really revokes', () {
      // A table whose every row is null is valid Dart that silently means "no
      // store event ever revokes anything" — it renders, compiles and reads
      // exactly like a working table.
      expect(kRevenueCatEventReasons, isNotEmpty);
      expect(
        kRevenueCatEventReasons
            .where((RevenueCatEventReason r) => r.reason != null),
        isNotEmpty,
      );
    });

    test('every mapped reason is a member of the revocation reason set', () {
      // 🔴 THE ONE THAT MATTERS. A mapping to a reason the database has never
      // seeded is a write that fails AFTER the money has moved, and it is
      // invisible to any check that only reads the reason list.
      for (final RevenueCatEventReason r in kRevenueCatEventReasons) {
        if (r.reason == null) continue;
        expect(isRevocationReason(r.reason!), isTrue, reason: r.event);
      }
    });

    test('an event we deliberately do not revoke on is RECORDED, not absent',
        () {
      // BILLING_ISSUE is a grace-period warning and the store retries; the
      // final outcome arrives later as EXPIRATION. Mapping it to
      // payment_failed_final would lock out a customer whose card recovers.
      // Recording it as null is a different fact from never having mapped it,
      // and the table has to be able to say so.
      final Iterable<RevenueCatEventReason> billingIssue =
          kRevenueCatEventReasons
              .where((RevenueCatEventReason r) => r.event == 'BILLING_ISSUE');
      expect(billingIssue, isNotEmpty);
      expect(billingIssue.single.reason, isNull);
    });

    test('an unknown event revokes nothing — the safe direction', () {
      expect(revocationReasonForRevenueCatEvent('NOT_A_REAL_EVENT'), isNull);
      expect(revocationReasonForRevenueCatEvent('EXPIRATION'),
          'subscription_expired');
      expect(revocationReasonForRevenueCatEvent('BILLING_ISSUE'), isNull);
    });

    test('no event is mapped twice', () {
      final Set<String> unique = kRevenueCatEventReasons
          .map((RevenueCatEventReason r) => r.event)
          .toSet();
      expect(unique.length, kRevenueCatEventReasons.length);
    });
  });
}
