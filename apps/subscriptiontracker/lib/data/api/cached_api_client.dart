import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show Outbox, PendingWrite, ReadThroughCache, kRevalidateAfter;
import 'package:nikatru_core/nikatru_core.dart' show Entitlements;

import '../local/subscription_store.dart';
import '../models/budget_info.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';
import 'api_client.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE PRODUCTION PATH KEPT NOTHING ON THE DEVICE.
//
// 🔴 WHAT WAS BROKEN. `PersistedApiClient` (#590/#595) wrapped ONLY the seed
// client, and only when `!AppConfig.isApiConfigured`. Every real build carries
// the API (`catalog/apps.json` sets `api`), so the shipped app used a bare
// `DioApiClient`: the list was fetched on every launch and nothing was kept.
// Offline, or with the Worker down, the home screen had NOTHING to show a user
// who had been looking at their own subscriptions an hour earlier.
//
// ⏱ 2026-09-30 · THE MECHANICS ARE SHARED NOW (audit D28, ST-N5). The cache is
// packages/api_client's `ReadThroughCache` and the write queue its `Outbox`;
// the brick stamps both. This file is the ADAPTER: which [ApiClient] read goes
// through which key and codec, and what an offline add means for this app's
// rows. The rules the shared file states — when the cache may answer (transport
// or 5xx only, never a 401), a stale answer is marked (D19), a read with a copy
// never waits on the connect timeout (D24), a mirror failure is reported and
// never thrown — hold here because they are enforced there.
//
// 🔴 AN ADD MADE OFFLINE IS KEPT, NOT LOST (audit D22). A create that fails for
// TRANSPORT reasons (status 0 — no network, DNS, a timeout that may have lost
// the response) is queued in the outbox with a client id, shown at once as a
// row under that id, and replayed with the id as its `Idempotency-Key` before
// the next list read or write — so a replay of an add that DID commit is
// answered with the row it made, never a second one. A 4xx or a 5xx still
// fails honestly: the server answered, and it said no.
//
// ⚠️ EDITS AND DELETES ARE NOT QUEUED, on purpose. An edit to a row that exists
// only in the outbox has no server id to PATCH, and ordering a delete behind a
// create it races is conflict resolution this train does not claim. Offline,
// they fail as before ("could not save"), which the sheets already render.
//
// ⚠️ ENTITLEMENTS ARE DELIBERATELY NOT CACHED HERE. The durable entitlement
// path is `EntitlementCache` over the SECURE store with its own staleness
// ceiling; an `isPro` in ordinary key-value storage is an unlock anyone with a
// text editor could grant themselves.
// ═════════════════════════════════════════════════════════════════════════════

/// What an outbox entry for an offline add is called.
const String kCreateSubscriptionWrite = 'subscription.create';

/// [ApiClient] over a network client, with the device's key-value store as a
/// read-through cache of what the server last said and an outbox of the adds
/// it has not heard yet.
class CachedApiClient implements ApiClient {
  CachedApiClient(
    this._network,
    LocalSubscriptionStore store, {
    void Function(Object error)? onCacheWriteFailed,
    void Function(bool stale)? onStaleChanged,
    /// A LIST read answered from the copy has since been refreshed in the
    /// background: the surface showing it should read again.
    void Function()? onRevalidated,
    Duration revalidateAfter = kRevalidateAfter,
  }) : _onRevalidated = onRevalidated,
       _cache = ReadThroughCache(
         store.json,
         onWriteFailed: onCacheWriteFailed ?? _reportCacheWriteFailure,
         onStaleChanged: onStaleChanged,
         revalidateAfter: revalidateAfter,
       ),
       _outbox = Outbox(
         store.json,
         key: kLocalOutboxKey,
         onRefused: (PendingWrite w, ApiException e) =>
             (onCacheWriteFailed ?? _reportCacheWriteFailure)(
               StateError('a queued add was refused on replay: $e'),
             ),
       );

  final ApiClient _network;
  final ReadThroughCache _cache;
  final Outbox _outbox;
  final void Function()? _onRevalidated;

  static void _reportCacheWriteFailure(Object e) =>
      debugPrint('🔴 [subscriptions] cache write failed: $e');

  /// Whether the most recent [getSubscriptions] or [getBudget] was answered by
  /// the cache because the server could not be reached. Observable so a
  /// surface can say "showing your last synced copy" rather than nothing.
  bool get lastReadWasFromCache => _cache.lastReadWasFromCache;

  /// How many mirror writes have failed on this client. Zero on a healthy
  /// device; anything else is the cause of "it did not survive restart".
  int get cacheWriteFailures => _cache.writeFailures;

  /// The most recent mirror-write failure, kept for the UI and for tests.
  Object? get lastCacheWriteError => _cache.lastWriteError;

  /// The adds made offline that the server has not acknowledged yet.
  Future<List<PendingWrite>> pendingWrites() => _outbox.pending();

  /// Whether [e] is a failure the cache is allowed to stand in for.
  static bool servesFromCacheFor(ApiException e) =>
      ReadThroughCache.servesFromCacheFor(e);

  Future<Subscription> _create(Subscription draft, String key) {
    final ApiClient net = _network;
    return net is IdempotentCreates
        ? (net as IdempotentCreates).createSubscriptionOnce(
            draft,
            idempotencyKey: key,
          )
        : net.createSubscription(draft);
  }

  /// Send every queued add, oldest first; each acknowledged one replaces its
  /// placeholder row in the copy. Never throws: an unreachable server leaves
  /// the queue as it was for the next attempt.
  Future<void> replayPending() async {
    await _outbox.replay((PendingWrite w) async {
      final Subscription created = await _create(
        Subscription.fromJson(w.body),
        w.id,
      );
      await _cache.amend(
        kLocalSubscriptionsKey,
        SubscriptionCodec.subscriptions,
        (List<Subscription> cached) =>
            cached.map((Subscription s) => s.id == w.id ? created : s).toList(),
      );
    });
  }

  @override
  Future<List<Subscription>> getSubscriptions() => _cache.read(
    kLocalSubscriptionsKey,
    SubscriptionCodec.subscriptions,
    () async {
      await replayPending();
      return _network.getSubscriptions();
    },
    onRevalidated: (_) => _onRevalidated?.call(),
  );

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    await replayPending();
    final String key = Outbox.newClientId();
    final Subscription created;
    try {
      created = await _create(draft, key);
    } on ApiException catch (e) {
      if (!e.isOffline) rethrow;
      // Kept for replay FIRST: if the device will not keep it either, the
      // failure travels and the sheet keeps the draft, exactly as before.
      await _outbox.enqueue(
        PendingWrite(
          id: key,
          kind: kCreateSubscriptionWrite,
          body: draft.toJson(),
          queuedAt: DateTime.now(),
        ),
      );
      final Subscription pending = Subscription.fromJson(<String, dynamic>{
        ...draft.toJson(),
        'id': key,
      }, fallbackCurrencyCode: draft.price.currencyCode);
      await _cache.amend(
        kLocalSubscriptionsKey,
        SubscriptionCodec.subscriptions,
        (List<Subscription> cached) => <Subscription>[...cached, pending],
      );
      return pending;
    }
    await _cache.amend(
      kLocalSubscriptionsKey,
      SubscriptionCodec.subscriptions,
      (List<Subscription> cached) => <Subscription>[...cached, created],
    );
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    try {
      return await _network.getSubscription(id);
    } on ApiException catch (e) {
      if (!servesFromCacheFor(e)) rethrow;
      final List<Subscription>? cached = await _cache.peek(
        kLocalSubscriptionsKey,
        SubscriptionCodec.subscriptions,
      );
      final Subscription? hit = cached
          ?.where((Subscription s) => s.id == id)
          .firstOrNull;
      if (hit == null) rethrow;
      return hit;
    }
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    await replayPending();
    final Subscription updated = await _network.updateSubscription(id, changes);
    await _cache.amend(
      kLocalSubscriptionsKey,
      SubscriptionCodec.subscriptions,
      (List<Subscription> cached) =>
          cached.map((Subscription s) => s.id == id ? updated : s).toList(),
    );
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    await replayPending();
    await _network.deleteSubscription(id);
    await _cache.amend(
      kLocalSubscriptionsKey,
      SubscriptionCodec.subscriptions,
      (List<Subscription> cached) =>
          cached.where((Subscription s) => s.id != id).toList(),
    );
  }

  /// Not cached: a payment history is a detail-screen read, and a stale one
  /// is worse than a failed one that offers a retry.
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) =>
      _network.getPaymentHistory(id);

  @override
  Future<BudgetInfo> getBudget() => _cache.read(
    kLocalBudgetKey,
    SubscriptionCodec.budget,
    // A budget copy refreshed in the background waits for the budget screen's
    // next read; [onRevalidated] re-reads the LIST, the surface that is open.
    _network.getBudget,
  );

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    final BudgetInfo saved = await _network.updateBudget(budget);
    await _cache.mirror(kLocalBudgetKey, saved, SubscriptionCodec.budget);
    return saved;
  }

  /// Never cached here — see the header. The server grants; the secure
  /// `EntitlementCache` remembers.
  @override
  Future<Entitlements> getEntitlements() => _network.getEntitlements();
}
