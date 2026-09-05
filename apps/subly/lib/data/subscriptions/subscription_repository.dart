import '../api/api_client.dart';
import '../models/budget_info.dart';
import '../models/entitlement.dart';
import '../models/payment_record.dart';
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
  Future<BudgetInfo> budget() => _api.getBudget();
  Future<BudgetInfo> saveBudget(BudgetInfo b) => _api.updateBudget(b);
  Future<Entitlements> entitlements() => _api.getEntitlements();
}
