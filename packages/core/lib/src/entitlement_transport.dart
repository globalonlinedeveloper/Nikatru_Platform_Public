import 'models/entitlement.dart';
import 'result.dart';

/// How the app ASKS the server whether this user has paid — [pipeline 5]M-5.
///
/// ## The seam that was missing, and what its absence cost
/// `EntitlementCache` and `PaywallGate` have both existed and been tested for
/// months, and neither had ever been given a real answer to hold: nothing in the
/// tree fetched an entitlement. That is the [pipeline C-6] shape in its purest
/// form — every part worked, no test went red, and the capability was dead,
/// because refusing is the correct behaviour when nobody has paid.
///
/// Declared here beside [ConfigTransport], [EventTransport] and
/// [ConsentTransport] so `core` keeps stating the contract while the HTTP client
/// stays in the adapter layer (ADR 005), and so a test can drive the whole gate
/// without a network.
///
/// 🔒 THE SERVER IS THE ONLY SOURCE OF TRUTH FOR AN UNLOCK. There is deliberately
/// no client-side `grant()` anywhere in this rail: the checkout returns before
/// the merchant of record's notification arrives, so a client that granted on
/// its own return would unlock on an abandoned checkout, on a declined card, and
/// on a back button.
abstract interface class EntitlementTransport {
  /// Read this user's entitlements for [appId] from the shared platform host.
  ///
  /// [accessToken] is the caller's bearer token; a null or empty one is a
  /// signed-out user, and an implementation must refuse rather than send an
  /// unauthenticated read that the host would answer 401 to anyway.
  Future<Result<Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  });
}

/// The default for demo builds, widget tests and any app with no backend: it
/// answers "we could not ask", which every caller already has to handle.
///
/// 🔴 NOT `Entitlements.none` AND NOT AN OK RESULT. Returning a successful
/// "not Pro" would let the convergence poller treat a build that cannot ask as a
/// build that asked and got a no — so a purchase would converge on a terminal
/// failure rather than on "this build has no rail". Named for what it does, for
/// the same reason [DiscardingConsentTransport] is.
class UnavailableEntitlementTransport implements EntitlementTransport {
  const UnavailableEntitlementTransport();

  @override
  Future<Result<Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async => const Result<Entitlements>.err(
    Failure('entitlement transport unavailable in this build'),
  );
}
