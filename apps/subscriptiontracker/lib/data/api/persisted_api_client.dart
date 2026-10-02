import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_core/nikatru_core.dart' show Entitlements, Money;

import '../local/subscription_store.dart';
import '../models/budget_info.dart';
import '../models/category.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
import '../models/subscription.dart';
import 'api_client.dart';
import 'seed_api_client.dart';

/// [SeedApiClient]'s working set, mirrored into the device's key-value store so
/// it is still there on the next launch.
///
/// ═══════════════════════════════════════════════════════════════════════════
/// 🔴 THE DEFECT THIS CLOSES. With no `--dart-define=API_BASE_URL` — which is
/// the DEFAULT, and what every unconfigured build and every developer run
/// actually is — `apiClientProvider` handed out a bare [SeedApiClient], whose
/// list and budget were plain in-memory fields on a non-auto-dispose provider.
/// A subscription the user added survived every navigation and died with the
/// process. Nothing logged it, because nothing was wrong: there was simply
/// nowhere for it to go.
///
/// 🔴 WHY A DECORATOR AND NOT A FLAG ON [SeedApiClient]. Two reasons, and the
/// second is mechanical.
///   · One implementation of the CRUD semantics. `createSubscription` mints an
///     id, defaults the plan and the glyph and sets the usage copy; a second
///     copy of that inside a persistent client is a second answer to the same
///     question, and the two would drift the first time either moved.
///   · `tooling/ci/assert-sworn-store-files.mjs` anchors the Play data-safety
///     declaration's "!isApiConfigured -> SeedApiClient" citation on the literal
///     `SeedApiClient()` in `state/providers/subscriptions.dart`. Wrapping keeps
///     that construct exactly where the sworn record says it is; a constructor
///     parameter would have deleted the anchor's text and left the guard aimed
///     at nothing.
///
/// ⚠️ THIS IS NOT AN OFFLINE CACHE, and the distinction is load-bearing. It sits
/// on the branch that has NO server, where the device is the system of record,
/// so there is nothing to reconcile against and no write to replay. The
/// configured branch still goes straight to the Worker. A write queue in front
/// of a live API is a different piece of work with conflict resolution and
/// replay ordering in it, and it is deliberately not started here.
/// ═══════════════════════════════════════════════════════════════════════════
class PersistedApiClient implements ApiClient, CategoriesApi, PaymentWrites {
  /// Mirror [_seed]'s working set into [_store].
  PersistedApiClient(this._seed, this._store);

  final SeedApiClient _seed;
  final LocalSubscriptionStore _store;

  /// The hydration, memoised so it runs ONCE per client however many reads
  /// arrive at the same time.
  ///
  /// 🔴 IT IS AWAITED BY EVERY METHOD, INCLUDING THE WRITES. An add that landed
  /// before the first read — an add sheet submitted while the list was still
  /// loading — would otherwise mutate the DEMO seed and then have the stored
  /// list dropped on top of it by the hydration that was still in flight, which
  /// is a silent loss of the very row the user just typed.
  Future<void>? _hydration;

  Future<void> _ready() => _hydration ??= _hydrate();

  /// Adopt what the device already held; plant the seed where it held nothing.
  ///
  /// 🔴 ABSENT IS NOT EMPTY. [LocalSubscriptionStore.readSubscriptions] answers
  /// null for "this device has never written a list" and `[]` for "the user
  /// deleted them all", and only the FIRST may be answered with the demo seed.
  /// Reading `[]` as absent would re-plant twelve demo rows onto every user who
  /// had cleared their list, on every launch, for ever.
  Future<void> _hydrate() async {
    final List<Subscription>? storedSubs = await _store.readSubscriptions();
    final BudgetInfo? storedBudget = await _store.readBudget();

    if (storedSubs != null || storedBudget != null) {
      _seed.restore(
        subs: storedSubs ?? await _seed.getSubscriptions(),
        budget: storedBudget ?? await _seed.getBudget(),
      );
    }

    // Whatever the device did not have yet is written now, so the set the user
    // sees on a first launch is the set they keep — including the case where a
    // half-written store left one of the two behind.
    //
    // ⚠️ A FAILURE HERE IS REPORTED, NOT THROWN. Nothing the user typed is at
    // stake yet — this is the demo seed — and a launch must not fail on a
    // store that is not there. It is still said out loud, because it is the
    // earliest warning that the writes below will fail too.
    try {
      if (storedSubs == null) await _persistSubscriptions();
      if (storedBudget == null) await _persistBudget();
    } on LocalStoreWriteFailure catch (e) {
      debugPrint('🔴 [subscriptions] could not persist the seed: $e');
    }
  }

  /// Run [write] against the seed, persist the result, and if persisting fails
  /// PUT THE SEED BACK and rethrow.
  ///
  /// 🔴 THE ROLLBACK IS WHAT MAKES THE FAILURE HONEST. Without it the row the
  /// user just added sits in memory for the rest of the session, looks saved,
  /// and is gone at the next launch — the exact defect `_write`'s old
  /// `catch (_)` produced. With it, "could not save" is true in both places at
  /// once: the store did not take it and the list does not show it.
  Future<T> _writeThrough<T>(Future<T> Function() write) async {
    await _ready();
    final List<Subscription> subsBefore = await _seed.getSubscriptions();
    final BudgetInfo budgetBefore = await _seed.getBudget();
    final T result = await write();
    try {
      await _persistSubscriptions();
      await _persistBudget();
    } on LocalStoreWriteFailure {
      _seed.restore(subs: subsBefore, budget: budgetBefore);
      rethrow;
    }
    return result;
  }

  Future<void> _persistSubscriptions() async =>
      _store.writeSubscriptions(await _seed.getSubscriptions());

  Future<void> _persistBudget() async =>
      _store.writeBudget(await _seed.getBudget());

  @override
  Future<List<Subscription>> getSubscriptions() async {
    await _ready();
    return _seed.getSubscriptions();
  }

  /// Throws [LocalStoreWriteFailure] — with the seed rolled back — when the
  /// device refuses the write. The add sheet renders that as "could not save".
  @override
  Future<Subscription> createSubscription(Subscription draft) =>
      _writeThrough(() => _seed.createSubscription(draft));

  @override
  Future<Subscription> getSubscription(String id) async {
    await _ready();
    return _seed.getSubscription(id);
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) => _writeThrough(() => _seed.updateSubscription(id, changes));

  @override
  Future<void> deleteSubscription(String id) =>
      _writeThrough(() => _seed.deleteSubscription(id));

  // ST-T9 (AD-05): categories through the seed, written through like every
  // other write — a rename moves rows and a cap, both of which persist.
  @override
  Future<List<SubscriptionCategory>> getCategories() async {
    await _ready();
    return _seed.getCategories();
  }

  @override
  Future<SubscriptionCategory> createCategory(String name) =>
      _writeThrough(() => _seed.createCategory(name));

  @override
  Future<SubscriptionCategory> renameCategory(String id, String name) =>
      _writeThrough(() => _seed.renameCategory(id, name));

  @override
  Future<void> deleteCategory(String id) =>
      _writeThrough(() => _seed.deleteCategory(id));

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    await _ready();
    return _seed.getPaymentHistory(id);
  }

  @override
  Future<List<PriceChange>> getPriceHistory(String id) async {
    await _ready();
    return _seed.getPriceHistory(id);
  }

  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async {
    await _ready();
    await _seed.recordPayment(
      id,
      amount: amount,
      paidOn: paidOn,
      idempotencyKey: idempotencyKey,
    );
  }

  @override
  Future<SpendHistory> getSpendHistory() async {
    await _ready();
    return _seed.getSpendHistory();
  }

  @override
  Future<BudgetInfo> getBudget() async {
    await _ready();
    return _seed.getBudget();
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) =>
      _writeThrough(() => _seed.updateBudget(budget));

  /// ⚠️ NOT PERSISTED, AND THAT IS THE POINT. Entitlements are granted by the
  /// server and only by the server ([ADR 026]); the demo posture's answer is a
  /// compiled-in constant with no user state in it, so there is nothing here to
  /// keep. The durable entitlement path is `EntitlementCache` over the SECURE
  /// store, which is a different seam with a different threat model — writing an
  /// `isPro: true` into ordinary key-value storage would be an unlock anyone
  /// with a text editor could grant themselves.
  @override
  Future<Entitlements> getEntitlements() => _seed.getEntitlements();
}
