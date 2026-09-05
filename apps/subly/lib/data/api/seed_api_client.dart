import '../../core/app_config.dart';
import '../models/budget_info.dart';
import '../models/entitlement.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';
import '../seed/demo_data.dart';
import 'api_client.dart';

/// Demo client — full CRUD against an in-memory list seeded from the design.
/// Selected automatically until a real API base URL is configured.
class SeedApiClient implements ApiClient {
  final List<Subscription> _subs = DemoData.subscriptions();
  BudgetInfo _budget = DemoData.budget();

  @override
  Future<List<Subscription>> getSubscriptions() async =>
      List<Subscription>.unmodifiable(_subs);

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    final Subscription created = Subscription(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: draft.name.isEmpty ? 'New subscription' : draft.name,
      category: draft.category,
      price: draft.price,
      cycle: draft.cycle,
      nextRenewal: draft.nextRenewal,
      plan: draft.plan.isEmpty ? 'Standard' : draft.plan,
      glyph: draft.glyph.isEmpty
          ? draft.name.padRight(3, 'X').substring(0, 3).toUpperCase()
          : draft.glyph,
      usedPct: 50,
      usageNote: 'Just added.',
    );
    _subs.add(created);
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async =>
      _subs.firstWhere((Subscription s) => s.id == id);

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    final int i = _subs.indexWhere((Subscription s) => s.id == id);
    if (i < 0) throw ApiException(404, 'Not found');
    _subs[i] = _subs[i].copyWith(
      name: changes['name'] as String?,
      price: (changes['price'] as num?)?.toDouble(),
      unused: changes['unused'] as bool?,
    );
    return _subs[i];
  }

  @override
  Future<void> deleteSubscription(String id) async =>
      _subs.removeWhere((Subscription s) => s.id == id);

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    final Subscription s = _subs.firstWhere((Subscription s) => s.id == id);
    return List<PaymentRecord>.generate(4, (int i) {
      final DateTime d = DateTime(
        s.nextRenewal.year,
        s.nextRenewal.month - (i + 1),
        s.nextRenewal.day,
      );
      return PaymentRecord(date: d, amount: s.price);
    });
  }

  @override
  Future<BudgetInfo> getBudget() async => _budget;

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    _budget = budget;
    return _budget;
  }

  @override
  Future<Entitlements> getEntitlements() async => Entitlements(
    appId: AppConfig.appId,
    isPro: true,
    items: const <Entitlement>[
      Entitlement(
        entitlement: 'pro',
        productId: 'subly_pro_monthly',
        store: 'demo',
        isActive: true,
      ),
    ],
  );
}
