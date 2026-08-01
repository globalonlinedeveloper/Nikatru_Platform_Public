import 'result.dart';

/// What our own host says came of a cancellation request — [pipeline 5]M-9.
///
/// THREE FACTS, NOT ONE BOOLEAN, because they are genuinely independent and the
/// user is owed the difference:
/// - [hasActivePlan]   — was there anything to cancel?
/// - [recorded]        — did WE write the request down? True today.
/// - [executed]        — did the merchant of record act on it? False until a
///                       seller account and an API credential exist.
///
/// Collapsing these into "success" would let the app tell a user their
/// subscription is cancelled when all that happened is that we made a note of
/// their asking. That sentence is the difference between a cancellation flow and
/// a cancellation theatre.
class CancellationReceipt {
  const CancellationReceipt({
    required this.hasActivePlan,
    required this.recorded,
    required this.executed,
  });

  final bool hasActivePlan;
  final bool recorded;
  final bool executed;

  static CancellationReceipt fromJson(Map<String, Object?> j) =>
      CancellationReceipt(
        // Every field defaults to the pessimistic answer. A response we half
        // understand must not read as a cancellation that half happened.
        hasActivePlan: j['has_active_plan'] == true,
        recorded: j['recorded'] == true,
        executed: j['executed'] == true,
      );
}

/// How the app asks OUR host to cancel — the ROSCA path's server call.
///
/// A seam in `core` beside [EntitlementTransport] for the same reason: `core`
/// states the contract, the HTTP client lives in the adapter layer, and a widget
/// test can drive the whole cancel screen without a network.
abstract interface class CancellationTransport {
  Future<Result<CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  });
}

/// The default for demo builds and tests: it cannot ask, and says so.
///
/// Deliberately NOT a receipt with `recorded: false` — that is an answer, and
/// this transport has none. A caller must be able to distinguish "the host said
/// there is nothing to cancel" from "there is no host in this build".
class UnavailableCancellationTransport implements CancellationTransport {
  const UnavailableCancellationTransport();

  @override
  Future<Result<CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  }) async => const Result<CancellationReceipt>.err(
    Failure('cancellation transport unavailable in this build'),
  );
}
