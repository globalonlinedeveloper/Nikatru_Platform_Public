// GENERATED FILE — DO NOT EDIT.
//
// Written by `node contracts/entitlement/generate-dart.mjs` from
// contracts/entitlement/contract.js, the one authored copy of the money
// vocabulary. `--check` fails CI on drift, and
// tooling/ci/assert-entitlement-contract.mjs limb 4 compares the values below
// against the SQL seed in services/platform/migrations/0004_money_rail.sql,
// so a hand edit here is caught twice.
//
// WHY DART GETS A GENERATED COPY AND NOBODY ELSE DOES: the Worker and the
// extensions import contract.js itself, byte for byte. Dart cannot import
// JavaScript, so this is the one transcription — and it is machine-made
// rather than remembered.
//
// `restoresAccess` MARKS THE ONE MEMBER THAT GIVES ACCESS BACK. A copy that
// loses that flag leaves a customer who raised a dispute in error, and lost
// it, locked out forever — nothing else in this rail restores access.

/// One revocation reason, and whether it RESTORES access.
class EntitlementRevocationReason {
  const EntitlementRevocationReason(this.reason, {required this.restoresAccess});

  /// The value written to `entitlements.revocation_reason`.
  final String reason;

  /// True for the one member that gives access back.
  final bool restoresAccess;

  @override
  String toString() => reason;
}

/// The money worlds a credential, a notification and an entitlement row can
/// belong to. Configuration decides which one; a payload never does.
const List<String> kMoneyEnvironments = <String>[
  'live',
  'sandbox',
];

/// The revocation-lifecycle reason set, in the order it is authored.
const List<EntitlementRevocationReason> kRevocationReasons =
    <EntitlementRevocationReason>[
  EntitlementRevocationReason('refund_approved', restoresAccess: false),
  EntitlementRevocationReason('chargeback', restoresAccess: false),
  EntitlementRevocationReason('chargeback_reversed', restoresAccess: true),
  EntitlementRevocationReason('subscription_expired', restoresAccess: false),
  EntitlementRevocationReason('trial_expired', restoresAccess: false),
  EntitlementRevocationReason('payment_failed_final', restoresAccess: false),
  EntitlementRevocationReason('cancelled_at_period_end', restoresAccess: false),
  EntitlementRevocationReason('subscription_paused', restoresAccess: false),
];

/// Whether `value` is a money environment this portfolio recognises.
bool isMoneyEnvironment(String value) => kMoneyEnvironments.contains(value);

/// Whether `reason` is a revocation reason this portfolio recognises.
bool isRevocationReason(String reason) =>
    kRevocationReasons.any((r) => r.reason == reason);

/// Whether `reason` GIVES ACCESS BACK. Resolved, never remembered.
bool revocationRestoresAccess(String reason) =>
    kRevocationReasons.any((r) => r.reason == reason && r.restoresAccess);
