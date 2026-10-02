import 'package:nikatru_core/nikatru_core.dart' show Money, RecurrenceRoll;

import '../../core/app_config.dart';
import '../models/budget_info.dart';
import '../models/category.dart';
import '../models/entitlement.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
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
class SeedApiClient implements ApiClient, CategoriesApi, PaymentWrites {
  List<Subscription> _subs = DemoData.subscriptions();
  BudgetInfo _budget = DemoData.budget();

  /// Every price edit, by row, newest first — the in-memory twin of the
  /// route's `INSERT INTO price_change` on a PATCH that moves the price.
  final Map<String, List<PriceChange>> _priceChanges =
      <String, List<PriceChange>>{};

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

  /// ⏱ 2026-09-28 · ST-T3b (ST-E1/E2). The row is the DRAFT, as the API
  /// stores it — this used to invent a 'Standard' plan (so the detail header
  /// read "Streaming · Standard" for a plan nobody named), a usage of 50% and
  /// a 'Just added.' note. The glyph is derived by [Subscription.glyphFor],
  /// the one rule the add sheet applies before POST, so the seed and the live
  /// Worker show the same mark.
  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    final Subscription created = Subscription.fromJson(<String, dynamic>{
      ...draft.toJson(),
      'id': DateTime.now().microsecondsSinceEpoch.toString(),
      'name': draft.name.isEmpty ? 'New subscription' : draft.name,
      'glyph': draft.glyph.isEmpty
          ? Subscription.glyphFor(draft.name)
          : draft.glyph,
      // ST-U5 (B11): a new row has NO usage. This said `usedPct: 50` and
      // `usageNote: 'Just added.'` — an English literal in data, and a
      // fabricated "Occasional" band on home and an "Active 50 %" card on
      // detail for a plan the user added a second ago.
      'used_pct': 0,
      'usage_note': '',
    }, fallbackCurrencyCode: draft.price.currencyCode);
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
    // EVERY key the body carries, with the route's cross-key rules — this
    // applied `name`, `price` and `unused` and silently dropped the rest, so
    // an edit of the cycle or the date "saved" and changed nothing.
    final Money before = _subs[i].price;
    _subs[i] = _subs[i].patched(changes);
    final Money after = _subs[i].price;
    if (before != after) {
      _priceChanges
          .putIfAbsent(id, () => <PriceChange>[])
          .insert(
            0,
            PriceChange(changedOn: DateTime.now(), from: before, to: after),
          );
    }
    return _subs[i];
  }

  @override
  Future<List<PriceChange>> getPriceHistory(String id) async =>
      List<PriceChange>.unmodifiable(
        _priceChanges[id] ?? const <PriceChange>[],
      );

  @override
  Future<void> deleteSubscription(String id) async =>
      _subs.removeWhere((Subscription s) => s.id == id);

  /// Payments recorded by hand this session, per subscription — demo data,
  /// so it lives as long as the process does. Keyed by idempotency key too,
  /// so a repeated press records one.
  final Map<String, List<PaymentRecord>> _manual =
      <String, List<PaymentRecord>>{};
  final Set<String> _manualKeys = <String>{};

  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    if (!_manualKeys.add(idempotencyKey)) return;
    (_manual[id] ??= <PaymentRecord>[]).add(
      PaymentRecord(date: paidOn, amount: amount),
    );
  }

  /// The charges this row has DATES for: every renewal from its
  /// `firstChargeOn` up to today, by the platform's own rule
  /// ([RecurrenceSchedule]) — what the nightly pass would have written. A row
  /// with no first charge date has no history, and says so.
  ///
  /// ⏱ 2026-09-28 · ST-T3b (ST-E1). This FABRICATED four monthly payments
  /// counted back from the next renewal, for every row: a yearly plan showed
  /// four monthly charges, a row added a minute ago showed four months of
  /// payments it never made, and each in a price it may never have had.
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    final Subscription s = _subs.firstWhere((Subscription s) => s.id == id);
    final DateTime? first = s.firstChargeOn;
    final Cadence? cadence = s.cycle;
    // Recorded by hand ("Mark as paid"), merged with the rolled ones below.
    final List<PaymentRecord> manual = <PaymentRecord>[...?_manual[id]];
    final List<PaymentRecord> derived;
    if (first == null || cadence == null) {
      derived = const <PaymentRecord>[];
    } else {
      final DateTime now = DateTime.now();
      final RecurrenceRoll roll = RecurrenceSchedule.rollForward(
        first,
        cadence,
        DateTime(now.year, now.month, now.day),
      );
      derived = <PaymentRecord>[
        for (final DateTime d in roll.crossings.reversed)
          PaymentRecord(date: d, amount: s.price),
      ];
    }
    // Newest first, as the route's `ORDER BY paid_at DESC` serves both kinds.
    return <PaymentRecord>[...manual, ...derived]
      ..sort((PaymentRecord a, PaymentRecord b) => b.date.compareTo(a.date));
  }

  /// Every row's derived history ([getPaymentHistory]) — what the nightly
  /// pass would have written — and NO price changes: the seed keeps no edit
  /// log, so a price rise is never invented here.
  @override
  Future<SpendHistory> getSpendHistory() async => SpendHistory(
    payments: <PaymentRecord>[
      for (final Subscription s in _subs)
        if (s.deletedAt == null) ...await getPaymentHistory(s.id),
    ],
    priceChanges: const <PlanPriceChange>[],
  );

  @override
  Future<BudgetInfo> getBudget() async => _budget;

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    _budget = budget;
    return _budget;
  }

  /// The user's own categories (ST-T9) — the in-memory twin of the API's
  /// `categories` rows with a `user_id`.
  final List<SubscriptionCategory> _own = <SubscriptionCategory>[];
  int _nextOwn = 1;

  @override
  Future<List<SubscriptionCategory>> getCategories() async {
    final Set<String> known = <String>{
      ...kBuiltinCategories.values,
      ..._own.map((SubscriptionCategory c) => c.name),
    };
    // A name a row or a cap already uses is that user's category, exactly as
    // migration 0005 back-filled them — so a demo row typed before this
    // existed is not orphaned.
    final List<SubscriptionCategory> used = <SubscriptionCategory>[
      for (final String n in <String>{
        ..._subs.map((Subscription s) => s.category),
        ..._budget.categories.map((BudgetCap c) => c.name),
      })
        if (!known.contains(n) && n != 'Other')
          SubscriptionCategory(id: 'name:$n', name: n, builtin: false),
    ];
    return <SubscriptionCategory>[...kBuiltinCategoryRows, ..._own, ...used];
  }

  @override
  Future<SubscriptionCategory> createCategory(String name) async {
    final String n = name.trim();
    final List<SubscriptionCategory> all = await getCategories();
    if (n.isEmpty || all.any((SubscriptionCategory c) => c.name == n)) {
      throw ApiException(n.isEmpty ? 400 : 409, 'invalid_body');
    }
    final SubscriptionCategory c = SubscriptionCategory(
      id: 'own-${_nextOwn++}',
      name: n,
      builtin: false,
    );
    _own.add(c);
    return c;
  }

  /// The route's one batch, mirrored: the category, every row that names it
  /// and its budget cap move to the new name together — so a rename keeps
  /// both the rows and the cap (routes/categories.ts PATCH).
  @override
  Future<SubscriptionCategory> renameCategory(String id, String name) async {
    final String n = name.trim();
    final List<SubscriptionCategory> all = await getCategories();
    final SubscriptionCategory? was = all
        .where((SubscriptionCategory c) => c.id == id)
        .firstOrNull;
    if (was == null) throw ApiException(404, 'not_found');
    if (was.builtin) throw ApiException(403, 'builtin_category');
    if (n.isEmpty) throw ApiException(400, 'invalid_body');
    if (all.any((SubscriptionCategory c) => c.name == n && c.id != id)) {
      throw ApiException(409, 'name_taken');
    }
    final SubscriptionCategory now = SubscriptionCategory(
      id: id,
      name: n,
      builtin: false,
    );
    _own.removeWhere((SubscriptionCategory c) => c.id == id);
    _own.add(now);
    _subs = <Subscription>[
      for (final Subscription s in _subs)
        s.category == was.name
            ? s.patched(<String, dynamic>{'category': n, 'category_id': id})
            : s,
    ];
    _budget = BudgetInfo(
      monthlyBudget: _budget.monthlyBudget,
      currencyKnown: _budget.currencyKnown,
      categories: <BudgetCap>[
        for (final BudgetCap c in _budget.categories)
          c.name == was.name ? BudgetCap(n, c.cap) : c,
      ],
    );
    return now;
  }

  /// Rows that named it become uncategorised and its cap goes, as the route's
  /// DELETE batch does. A built-in cannot be deleted.
  @override
  Future<void> deleteCategory(String id) async {
    final SubscriptionCategory? was = (await getCategories())
        .where((SubscriptionCategory c) => c.id == id)
        .firstOrNull;
    if (was == null) return;
    if (was.builtin) throw ApiException(403, 'builtin_category');
    _own.removeWhere((SubscriptionCategory c) => c.id == id);
    _subs = <Subscription>[
      for (final Subscription s in _subs)
        s.category == was.name
            ? s.patched(<String, dynamic>{
                'category': 'Other',
                'category_id': null,
              })
            : s,
    ];
    _budget = BudgetInfo(
      monthlyBudget: _budget.monthlyBudget,
      currencyKnown: _budget.currencyKnown,
      categories: <BudgetCap>[
        for (final BudgetCap c in _budget.categories)
          if (c.name != was.name) c,
      ],
    );
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
