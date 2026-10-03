import '../api/api_client.dart';
import '../models/budget_info.dart';
import '../models/entitlement.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
import '../models/subscription.dart';

/// Domain-facing wrapper over [ApiClient] — the controllers talk to this.
class SubscriptionRepository {
  SubscriptionRepository(this._api);
  final ApiClient _api;

  Future<List<Subscription>> fetchAll() => _api.getSubscriptions();
  Future<Subscription> add(Subscription draft) =>
      _api.createSubscription(draft);
  Future<Subscription> update(String id, Map<String, dynamic> changes) =>
      _api.updateSubscription(id, changes);
  Future<void> cancel(String id) => _api.deleteSubscription(id);
  Future<List<PaymentRecord>> history(String id) => _api.getPaymentHistory(id);

  /// Whether this client can record a payment (DE-04). Every [ApiClient]
  /// can since NO-10 (#1119); a test fake overrides it to hide the action.
  bool get canRecordPayments => true;

  /// "Mark as paid" — [ApiClient.recordPayment], idempotent by key.
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) => _api.recordPayment(
    id,
    amount: amount,
    paidOn: paidOn,
    idempotencyKey: idempotencyKey,
  );

  /// Every price edit on [id], newest first; none from a client that cannot
  /// read them.
  Future<List<PriceChange>> priceHistory(String id) async {
    final ApiClient api = _api;
    if (api is! PaymentWrites) return const <PriceChange>[];
    return (api as PaymentWrites).getPriceHistory(id);
  }

  Future<SpendHistory> spendHistory() => _api.getSpendHistory();
  Future<BudgetInfo> budget() => _api.getBudget();
  Future<BudgetInfo> saveBudget(BudgetInfo b) => _api.updateBudget(b);
  Future<Entitlements> entitlements() => _api.getEntitlements();
}
