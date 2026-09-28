import '../../core/app_config.dart';
import '../models/budget_info.dart';
import '../models/entitlement.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';
import '../seed/demo_data.dart';
import 'api_client.dart';

/// Demo client — full CRUD against an in-memory list seeded from the design.
/// Selected automatically until a real API base URL is configured.
///
/// ⚠️ IT IS STILL IN-MEMORY, AND THAT IS DELIBERATE. Durability is a SEPARATE
/// object: `PersistedApiClient` wraps one of these and mirrors the working set
/// into the device's key-value store. Keeping the two apart means this class
/// stays the single implementation of what a create/update/delete MEANS
/// (id minting, the glyph and plan defaults, the derived payment history) while
/// the decorator owns only WHERE the bytes end up — so the two can never drift
/// into two different answers for "what does adding a subscription do".
class SeedApiClient implements ApiClient {
  List<Subscription> _subs = DemoData.subscriptions();
  BudgetInfo _budget = DemoData.budget();

  /// Replace the working set with what a durable store already held.
  ///
  /// 🔴 THE ONE WAY THE SEED IS OVERRULED, and it exists for exactly one caller:
  /// `PersistedApiClient` hydrating a device that has run this app before. It
  /// takes both halves at once because a device that has a stored list but no
  /// stored budget (a write that failed between the two) must not end up with
  /// one half of somebody's data and one half of the demo's — the caller passes
  /// what it read and the seed for whatever it did not.
  ///
  /// The list is COPIED: the caller's list came out of a decoder and this object
  /// mutates its own in place.
  void restore({required List<Subscription> subs, required BudgetInfo budget}) {
    _subs = List<Subscription>.of(subs);
    _budget = budget;
  }

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
      // ST-U5 (B11): a new row has NO usage. This said `usedPct: 50` and
      // `usageNote: 'Just added.'` — an English literal in data, and a
      // fabricated "Occasional" band on home and an "Active 50 %" card on
      // detail for a plan the user added a second ago.
      usedPct: 0,
      usageNote: '',
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
    _subs[i] = _subs[i]
        .copyWith(
          name: changes['name'] as String?,
          price: (changes['price'] as num?)?.toDouble(),
          unused: changes['unused'] as bool?,
        )
        .withReminderPatch(changes);
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
        productId: 'subscriptiontracker_pro_monthly',
        store: 'demo',
        isActive: true,
      ),
    ],
  );
}
