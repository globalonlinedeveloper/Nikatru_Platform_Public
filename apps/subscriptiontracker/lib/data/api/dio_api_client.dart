import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show Entitlements, Money, newOutboxId;

import '../models/budget_info.dart';
import '../models/category.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
import '../models/subscription.dart';
import 'api_client.dart';

/// Live Subly client against the Cloudflare Worker. All HTTP goes through the
/// shared generic [RestClient] (bearer auth, 401 handling, transport-error →
/// ApiException); this class maps Subly's endpoints to its domain models, and
/// routes every parse through `_rest.decode` so a malformed 2xx body also
/// surfaces as an ApiException (single failure contract).
class DioApiClient
    implements ApiClient, IdempotentCreates, CategoriesApi, PaymentWrites {
  DioApiClient({
    required String baseUrl,
    required Future<String?> Function() tokenProvider,
    Future<void> Function()? onUnauthorized,
    Dio? httpClient,
    String Function()? currencyCode,
  }) : _currencyCode = currencyCode ?? _noCurrency,
       _rest = RestClient(
         baseUrl: baseUrl,
         tokenProvider: tokenProvider,
         onUnauthorized: onUnauthorized,
         httpClient: httpClient,
       );

  final RestClient _rest;

  /// The base URL this client sends to; see [rebase].
  String get baseUrl => _rest.baseUrl;

  /// Moves every later request to [baseUrl] — [RestClient.rebase], so a
  /// config resolve does not rebuild the client and re-read the list (HO-10).
  void rebase(String baseUrl) => _rest.rebase(baseUrl);

  /// 🔴 THE UNIT A ROW WITH NO `currency` OF ITS OWN IS READ IN — THE USER'S
  /// CHOICE, ASKED AT DECODE TIME (ST-C1, audit B21/D5/D18).
  ///
  /// The Worker stores `price` as a bare REAL with no currency column, so every
  /// row it returns is currency-less. Decoded with the model's default, a ₹649
  /// row the user typed under the rupee chip came back as "$649.00" — on the
  /// POST response, on every reload, and into the offline cache. The digits
  /// were typed in the user's currency, so that is the only honest reading
  /// until the additive `currency` column lands (ST-T3); a row that DOES carry
  /// a currency still wins (`Subscription.readPrice`). A function, not a
  /// string: the user can change it while this client lives.
  final String Function() _currencyCode;

  static String _noCurrency() => Money.fallbackCurrencyCode;

  /// Rows asked for per page of `GET /subscriptions?limit=` (keyset paging,
  /// lane fix-st-api-bounds, rv2-services-008). The Worker serves at most 500.
  static const int subscriptionsPageSize = 200;

  /// The most pages one list read follows before it gives up. The Worker caps
  /// an account at 500 rows, so 3 pages hold any account; a cursor that never
  /// ends is a server fault, and a client that followed it would never return.
  static const int _maxSubscriptionPages = 20;

  /// The WHOLE list, page by page.
  ///
  /// 🔴 BOTH WIRE SHAPES ARE READ (lane fix-st-api-bounds). A Worker that pages
  /// answers `?limit=` with `{items, next}` and this follows `next` until it is
  /// null; a Worker deployed BEFORE paging ignores the query and answers the
  /// bare array it always did, which is the whole list. Reading only the new
  /// shape would break this build against the Worker as deployed, and reading
  /// only the first page would silently drop every row past it.
  @override
  Future<List<Subscription>> getSubscriptions() async {
    final List<Subscription> out = <Subscription>[];
    String? after;
    for (int page = 0; page < _maxSubscriptionPages; page++) {
      final String cursor = after == null
          ? ''
          : '&after=${Uri.encodeQueryComponent(after)}';
      final Object? data = await _rest.get(
        '/subscriptions?limit=$subscriptionsPageSize$cursor',
      );
      final ({List<Subscription> rows, String? next}) parsed = _rest.decode(
        data,
        (Object? b) {
          if (b is List<dynamic>) {
            return (rows: _subscriptionRows(b), next: null);
          }
          final Map<String, dynamic> m = b! as Map<String, dynamic>;
          return (
            rows: _subscriptionRows(m['items']! as List<dynamic>),
            next: m['next'] as String?,
          );
        },
      );
      out.addAll(parsed.rows);
      if (parsed.next == null) return out;
      after = parsed.next;
    }
    throw ApiException(
      0,
      'Malformed response: GET /subscriptions paged past '
      '$_maxSubscriptionPages pages',
      malformed: true,
    );
  }

  List<Subscription> _subscriptionRows(List<dynamic> rows) => rows
      .map(
        (dynamic e) => Subscription.fromJson(
          e as Map<String, dynamic>,
          fallbackCurrencyCode: _currencyCode(),
        ),
      )
      .toList();

  /// A one-shot create still carries a key: a lost response to it is then at
  /// worst a missing row, never a duplicate one.
  @override
  Future<Subscription> createSubscription(Subscription draft) =>
      createSubscriptionOnce(draft, idempotencyKey: newOutboxId());

  @override
  Future<Subscription> createSubscriptionOnce(
    Subscription draft, {
    required String idempotencyKey,
  }) async {
    final Object? data = await _rest.post(
      '/subscriptions',
      body: draft.toJson(),
      idempotencyKey: idempotencyKey,
    );
    return _rest.decode(
      data,
      (Object? b) => Subscription.fromJson(
        b! as Map<String, dynamic>,
        fallbackCurrencyCode: _currencyCode(),
      ),
    );
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    final Object? data = await _rest.get('/subscriptions/$id');
    return _rest.decode(data, (Object? b) {
      final Map<String, dynamic> m = b! as Map<String, dynamic>;
      final Map<String, dynamic> sub = m.containsKey('subscription')
          ? m['subscription'] as Map<String, dynamic>
          : m;
      return Subscription.fromJson(sub, fallbackCurrencyCode: _currencyCode());
    });
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    final Object? data = await _rest.patch('/subscriptions/$id', body: changes);
    return _rest.decode(
      data,
      (Object? b) => Subscription.fromJson(
        b! as Map<String, dynamic>,
        fallbackCurrencyCode: _currencyCode(),
      ),
    );
  }

  @override
  Future<void> deleteSubscription(String id) =>
      _rest.delete('/subscriptions/$id');

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    final Object? data = await _rest.get('/subscriptions/$id');
    return _rest.decode(data, (Object? b) {
      final Map<String, dynamic> m = b! as Map<String, dynamic>;
      final List<dynamic> hist =
          (m['payment_history'] as List<dynamic>?) ?? <dynamic>[];
      return hist
          .map(
            (dynamic e) => PaymentRecord.fromJson(
              e as Map<String, dynamic>,
              fallbackCurrencyCode: _currencyCode(),
            ),
          )
          .toList();
    });
  }

  /// `price_history` off `GET /v1/subscriptions/:id` (DE-05). A server that
  /// predates 0005 serves no such key: no edits, not a failure.
  @override
  Future<List<PriceChange>> getPriceHistory(String id) async {
    final Object? data = await _rest.get('/subscriptions/$id');
    return _rest.decode(data, (Object? b) {
      final Map<String, dynamic> m = b! as Map<String, dynamic>;
      final List<dynamic> rows =
          (m['price_history'] as List<dynamic>?) ?? <dynamic>[];
      return rows
          .map(
            (dynamic e) => PriceChange.fromJson(
              e as Map<String, dynamic>,
              fallbackCurrencyCode: _currencyCode(),
            ),
          )
          .toList();
    });
  }

  @override
  Future<List<SubscriptionCategory>> getCategories() async {
    final Object? data = await _rest.get('/categories');
    return _rest.decode(
      data,
      (Object? b) => (b! as List<dynamic>)
          .map(
            (dynamic j) =>
                SubscriptionCategory.fromJson(j as Map<String, dynamic>),
          )
          .toList(),
    );
  }

  @override
  Future<SubscriptionCategory> createCategory(String name) async {
    final Object? data = await _rest.post(
      '/categories',
      body: <String, dynamic>{'name': name},
    );
    return _rest.decode(
      data,
      (Object? b) => SubscriptionCategory.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<SubscriptionCategory> renameCategory(String id, String name) async {
    final Object? data = await _rest.patch(
      '/categories/$id',
      body: <String, dynamic>{'name': name},
    );
    return _rest.decode(
      data,
      (Object? b) => SubscriptionCategory.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<void> deleteCategory(String id) async {
    await _rest.delete('/categories/$id');
  }

  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    final String ymd =
        '${paidOn.year.toString().padLeft(4, '0')}-'
        '${paidOn.month.toString().padLeft(2, '0')}-'
        '${paidOn.day.toString().padLeft(2, '0')}';
    await _rest.post(
      '/subscriptions/$id/payments',
      body: <String, Object?>{
        'amount': amount.toMajorUnits(),
        'paid_on': ymd,
        'currency': amount.currencyCode,
      },
      idempotencyKey: idempotencyKey,
    );
  }

  @override
  Future<SpendHistory> getSpendHistory() async {
    final Object? data = await _rest.get('/insights');
    return _rest.decode(
      data,
      (Object? b) => SpendHistory.fromJson(
        b! as Map<String, dynamic>,
        fallbackCurrencyCode: _currencyCode(),
      ),
    );
  }

  @override
  Future<BudgetInfo> getBudget() async {
    final Object? data = await _rest.get('/budget');
    return _rest.decode(
      data,
      (Object? b) => BudgetInfo.fromJson(
        b! as Map<String, dynamic>,
        currencyCode: _currencyCode(),
      ),
    );
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    final Object? data = await _rest.put('/budget', body: budget.toJson());
    return _rest.decode(
      data,
      (Object? b) => BudgetInfo.fromJson(
        b! as Map<String, dynamic>,
        currencyCode: _currencyCode(),
      ),
    );
  }

  @override
  Future<Entitlements> getEntitlements() async {
    final Object? data = await _rest.get('/entitlements');
    return _rest.decode(
      data,
      (Object? b) => Entitlements.fromJson(b! as Map<String, dynamic>),
    );
  }
}
