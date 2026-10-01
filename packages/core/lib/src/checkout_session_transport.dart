import 'result.dart';

/// What `POST /v1/checkout` answered: a hosted checkout the merchant of record
/// created for THIS account, and the page to open for it.
///
/// ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START. The hosted rail used to
/// open a URL filled from a `checkout_url_template` that no config serves, so
/// on web, Windows and Linux a served `paywall.enabled: true` still sold
/// nothing. The platform route already creates the transaction with our
/// `custom_data` attribution ([ADR 044] §6) and refuses when it does not come
/// back, so the rail asks it instead of building a URL itself.
class CheckoutSession {
  const CheckoutSession({
    required this.checkoutUrl,
    required this.transactionId,
  });

  /// The merchant of record's page for this transaction. Always absolute
  /// `https:` — [fromJson] refuses anything else.
  final Uri checkoutUrl;

  /// The transaction the page completes, for the log only.
  final String transactionId;

  /// Parses the route's 200 body. Null for anything not exactly the shape the
  /// route promises: a session we half understand is a page we must not open.
  static CheckoutSession? fromJson(Map<String, Object?> j) {
    final Object? url = j['checkout_url'];
    final Object? txn = j['transaction_id'];
    if (url is! String || txn is! String || txn.isEmpty) return null;
    final Uri? u = Uri.tryParse(url);
    if (u == null || u.scheme != 'https' || u.host.isEmpty) return null;
    return CheckoutSession(checkoutUrl: u, transactionId: txn);
  }
}

/// Asks the shared platform host to open a hosted checkout for one offering.
///
/// A seam in `core` beside [CancellationTransport] for the same reason: the
/// rail in `nikatru_purchases` programs against it, and the dio implementation
/// lives in `nikatru_api_client`.
abstract interface class CheckoutSessionTransport {
  /// Whether this build can ask at all. False for the discard transport, so a
  /// rail can say "not configured" without a network round trip.
  bool get isAvailable;

  Future<Result<CheckoutSession>> createSession({
    required String appId,
    required String offeringId,
    required String? accessToken,
  });
}

/// The discard transport: a demo build, a widget test, a build whose backend is
/// not live. It answers "could not ask", never a URL.
class UnavailableCheckoutSessionTransport implements CheckoutSessionTransport {
  const UnavailableCheckoutSessionTransport();

  @override
  bool get isAvailable => false;

  @override
  Future<Result<CheckoutSession>> createSession({
    required String appId,
    required String offeringId,
    required String? accessToken,
  }) async => const Result<CheckoutSession>.err(
    Failure('checkout session transport unavailable in this build'),
  );
}
