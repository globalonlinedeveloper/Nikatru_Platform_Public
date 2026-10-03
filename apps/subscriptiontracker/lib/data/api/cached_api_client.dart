import 'package:flutter/foundation.dart' show debugPrint;
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show ReadThroughCache, classifyForOutbox, kRevalidateAfter, retryAfterFor;
import 'package:nikatru_core/nikatru_core.dart'
    show
        DurableOutbox,
        Entitlements,
        Money,
        OutboxEnqueueResult,
        OutboxEntry,
        OutboxOp,
        OutboxReplayResult,
        OutboxStoreFailure,
        newOutboxId;

import '../local/subscription_store.dart';
import '../models/category.dart';
import '../models/budget_info.dart';
import '../models/payment_record.dart';
import '../models/price_change.dart';
import '../models/spend_history.dart';
import '../models/subscription.dart';
import 'api_client.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE PRODUCTION PATH KEPT NOTHING ON THE DEVICE.
//
// 🔴 WHAT WAS BROKEN. `PersistedApiClient` (#590/#595) wrapped ONLY the seed
// client, and only when `!AppConfig.isApiConfigured`. Every real build carries
// the API (`catalog/apps.json` sets `api`), so the shipped app used a bare
// `DioApiClient`: the list was fetched on every launch and nothing was kept.
//
// ⏱ 2026-09-30 · THE MECHANICS ARE SHARED (audit D28, ST-N5; lead ruling on
// #1075). The copy is packages/api_client's `ReadThroughCache`; the write queue
// is packages/core's `DurableOutbox` — user-scoped, persisted, serialised,
// bounded, ordered and coalesced per record (its header says how). This file is
// the ADAPTER: which read goes through which key, and what a queued write means
// for THIS app's rows.
//
// 🔴 AN ADD MADE OFFLINE IS KEPT, NOT LOST (audit D22). A create that fails for
// TRANSPORT reasons (status 0) is queued under the signed-in user with a client
// id, and replayed with that id as its `Idempotency-Key` — before the next read
// or write, and never under another account (review finding 1). The server
// answers a replay of a create that DID commit with the row it made.
//
// 🔴 A ROW THAT EXISTS ONLY ON THE DEVICE IS EDITED AND DELETED ON THE DEVICE
// (review finding 4). An edit merges into its queued create; a delete cancels
// the create and nothing goes to the server. Once a create syncs, the client id
// resolves to the server id for every later call (`DurableOutbox.resolve`).
//
// 🔴 QUEUED ROWS STAY VISIBLE (finding 8). Every list this returns — live or
// from the copy — has the user's queued creates laid over it until they sync,
// including a dead letter, which [syncProblems] offers to retry or discard
// (finding 9: a refused add is shown, never silently dropped).
//
// ⚠️ EDITS AND DELETES OF A SYNCED ROW ARE NOT QUEUED. Offline, they fail
// honestly ("could not save"), which the sheets render.
//
// ⚠️ ENTITLEMENTS ARE DELIBERATELY NOT CACHED HERE. The durable entitlement
// path is `EntitlementCache` over the SECURE store with its own staleness
// ceiling; an `isPro` in ordinary key-value storage is an unlock anyone with a
// text editor could grant themselves.
// ═════════════════════════════════════════════════════════════════════════════

/// The outbox kind this adapter sends. A kind it does not know is held.
const String kSubscriptionWrite = 'subscription';

/// [ApiClient] over a network client, with the device's key-value store as a
/// read-through cache of what the server last said and an outbox of the
/// writes it has not heard yet.
class CachedApiClient implements ApiClient, CategoriesApi, PaymentWrites {
  CachedApiClient(
    this._network,
    LocalSubscriptionStore store, {
    String? Function()? currentUser,
    void Function(Object error)? onCacheWriteFailed,
    void Function(bool stale)? onStaleChanged,

    /// A LIST read answered from the copy has since been refreshed in the
    /// background: the surface showing it should read again.
    void Function()? onRevalidated,

    /// The outbox changed (an entry queued, synced, died or was discarded).
    void Function()? onOutboxChanged,
    Duration revalidateAfter = kRevalidateAfter,
  }) : _currentUser = currentUser ?? _nobody,
       _onRevalidated = onRevalidated,
       _report = onCacheWriteFailed ?? _reportCacheWriteFailure,
       _onOutboxChanged = onOutboxChanged,
       _cache = ReadThroughCache(
         store.json,
         onWriteFailed: onCacheWriteFailed ?? _reportCacheWriteFailure,
         onStaleChanged: onStaleChanged,
         // Review round 2, major 2: the copy is the signed-in user's own.
         owner: currentUser,
         revalidateAfter: revalidateAfter,
       ),
       _outbox = DurableOutbox(
         store.kv,
         key: kLocalOutboxKey,
         onChanged: onOutboxChanged,
       );

  final ApiClient _network;
  final ReadThroughCache _cache;
  final DurableOutbox _outbox;
  final String? Function() _currentUser;
  final void Function()? _onRevalidated;

  /// The crash sink in production (`reportCacheWriteFailure`): every failure
  /// of the device store goes here, never only to `debugPrint` (review #1075
  /// round 3, minor b).
  final void Function(Object error) _report;
  final void Function()? _onOutboxChanged;

  static String? _nobody() => null;

  static void _reportCacheWriteFailure(Object e) =>
      debugPrint('🔴 [subscriptions] cache write failed: $e');

  /// Whether the most recent [getSubscriptions] or [getBudget] was answered by
  /// the cache because the server could not be reached.
  bool get lastReadWasFromCache => _cache.lastReadWasFromCache;

  /// How many mirror writes have failed on this client.
  int get cacheWriteFailures => _cache.writeFailures;

  /// The most recent mirror-write failure, kept for the UI and for tests.
  Object? get lastCacheWriteError => _cache.lastWriteError;

  /// Whether [e] is a failure the cache is allowed to stand in for.
  static bool servesFromCacheFor(ApiException e) =>
      ReadThroughCache.servesFromCacheFor(e);

  /// The signed-in user's writes still waiting (dead letters included).
  Future<List<OutboxEntry>> pendingWrites() async {
    final String? owner = _currentUser();
    return owner == null ? <OutboxEntry>[] : _outbox.entries(owner: owner);
  }

  /// The signed-in user's writes the server refused or that failed too often:
  /// "couldn't sync this change — retry or discard". Throws
  /// [OutboxStoreFailure] when the queue cannot be read, so the surface shows
  /// that instead of nothing.
  Future<List<OutboxEntry>> syncProblems() async {
    final String? owner = _currentUser();
    return owner == null ? <OutboxEntry>[] : _outbox.deadLetters(owner: owner);
  }

  /// Put a dead letter back in the queue and try at once.
  Future<void> retrySync(String id) async {
    await _outbox.retry(id);
    await replayPending();
  }

  /// Drop a dead letter; its row leaves the list.
  Future<void> discardSync(String id) => _outbox.discard(id);

  /// Forget [owner]'s queued writes — the explicit sign-out.
  Future<void> discardPendingOf(String owner) => _outbox.discardOwner(owner);

  /// Forget every cached copy and every read in flight — run by EVERY
  /// sign-out path, the forced 401 included (review round 2, major 2).
  Future<void> forgetCache() => _cache.forget();

  Future<Subscription> _create(Subscription draft, String key) {
    final ApiClient net = _network;
    return net is IdempotentCreates
        ? (net as IdempotentCreates).createSubscriptionOnce(
            draft,
            idempotencyKey: key,
          )
        : net.createSubscription(draft);
  }

  /// Send the signed-in user's queued writes. Never throws, and does nothing
  /// while the device is known to be offline (review finding 10: a write
  /// used to wait out a doomed replay's connect timeout before its own).
  Future<void> replayPending() async {
    final String? owner = _currentUser();
    if (owner == null || _cache.knownOffline) return;
    try {
      final OutboxReplayResult r = await _outbox.replay(
        owner: owner,
        currentOwner: _currentUser,
        send: _send,
        classify: classifyForOutbox,
        // A 409 "still processing" waits as long as the server says (minor d).
        retryAfter: retryAfterFor,
        accepts: (OutboxEntry e) => e.kind == kSubscriptionWrite,
      );
      final Object? storeError = r.storeError;
      if (storeError != null) _queueUnreadable(storeError);
    } catch (e) {
      _queueUnreadable(e);
    }
  }

  /// The queue could not be read (review #1075 round 3, minor b). The entries
  /// stay stored; the failure reaches the crash sink, and [onOutboxChanged]
  /// makes the sync-problems surface read again — [syncProblems] then THROWS,
  /// and the shell shows "your offline changes could not be read" instead of a
  /// list that is silently missing the user's queued adds.
  void _queueUnreadable(Object error) {
    _report(error);
    _onOutboxChanged?.call();
  }

  Future<String?> _send(OutboxEntry e) async {
    switch (e.op) {
      case OutboxOp.create:
        final Subscription created;
        try {
          created = await _create(Subscription.fromJson(e.body), e.id);
        } on ApiException catch (x) {
          // 410: the key made a row the user has since deleted — done.
          if (x.statusCode == 410) return null;
          rethrow;
        }
        await _upsertCached(created);
        return created.id;
      case OutboxOp.update:
        await _upsertCached(
          await _network.updateSubscription(e.recordId, e.body),
        );
        return null;
      case OutboxOp.delete:
        try {
          await _network.deleteSubscription(e.recordId);
        } on ApiException catch (x) {
          // Already gone is what a delete wanted (the row a lost add may or
          // may not have made): done, not failed.
          if (x.statusCode != 404 && x.statusCode != 410) rethrow;
        }
        await _removeCached(e.recordId);
        return null;
    }
  }

  Future<void> _upsertCached(Subscription row) => _cache.amend(
    kLocalSubscriptionsKey,
    SubscriptionCodec.subscriptions,
    (List<Subscription> cached) => <Subscription>[
      ...cached.where((Subscription s) => s.id != row.id),
      row,
    ],
  );

  Future<void> _removeCached(String id) => _cache.amend(
    kLocalSubscriptionsKey,
    SubscriptionCodec.subscriptions,
    (List<Subscription> cached) =>
        cached.where((Subscription s) => s.id != id).toList(),
  );

  /// [rows] with the signed-in user's queued writes laid over them.
  Future<List<Subscription>> _overlay(List<Subscription> rows) async {
    final List<OutboxEntry> queued;
    try {
      queued = await pendingWrites();
    } on OutboxStoreFailure catch (e) {
      // The queue could not be READ (review round 2, minor e): it is kept as
      // stored, the list still shows, and the failure is reported — never
      // taken for an empty queue.
      _queueUnreadable(e);
      return rows;
    }
    if (queued.isEmpty) return rows;
    final List<Subscription> out = <Subscription>[...rows];
    for (final OutboxEntry e in queued) {
      final int i = out.indexWhere((Subscription s) => s.id == e.recordId);
      switch (e.op) {
        case OutboxOp.create:
          if (i < 0) out.add(_placeholder(e));
        case OutboxOp.update:
          if (i >= 0) out[i] = out[i].patched(e.body);
        case OutboxOp.delete:
          if (i >= 0) out.removeAt(i);
      }
    }
    return out;
  }

  static Subscription _placeholder(OutboxEntry e) =>
      Subscription.fromJson(<String, dynamic>{...e.body, 'id': e.recordId});

  /// The queued create of [id] — a row the server may or may not have. Its
  /// edits and its delete go through the outbox, which decides (on whether the
  /// create was ever dispatched) to merge, cancel, or queue behind it.
  Future<OutboxEntry?> _unsyncedCreate(String id) async =>
      (await pendingWrites())
          .where((OutboxEntry e) => e.recordId == id && e.op == OutboxOp.create)
          .firstOrNull;

  @override
  Future<List<Subscription>> getSubscriptions() async => _overlay(
    await _cache.read(
      kLocalSubscriptionsKey,
      SubscriptionCodec.subscriptions,
      () async {
        await replayPending();
        return _network.getSubscriptions();
      },
      onRevalidated: (_) => _onRevalidated?.call(),
    ),
  );

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    await replayPending();
    final String key = newOutboxId();
    final String? known = _currentUser();
    if (_cache.knownOffline && known != null) {
      // Known offline: no doomed request (and no connect wait). Queued as
      // NEVER dispatched, so the device may still merge an edit into it or
      // cancel it outright on a delete (review round 2, major 1).
      final OutboxEnqueueResult queued = await _outbox.enqueue(
        owner: known,
        recordId: key,
        op: OutboxOp.create,
        kind: kSubscriptionWrite,
        body: draft.toJson(),
        id: key,
      );
      return _placeholder(queued.entry!);
    }
    final Subscription created;
    try {
      created = await _create(draft, key);
    } on ApiException catch (e) {
      final String? owner = _currentUser();
      // An unreadable answer is queued too: the request arrived, so the key
      // is replayed rather than a second row being made by a retyped add.
      if (!(e.isOffline || e.malformed) || owner == null) rethrow;
      // Kept for replay FIRST: if the device will not keep it either, the
      // failure travels and the sheet keeps the draft, exactly as before.
      final OutboxEnqueueResult queued = await _outbox.enqueue(
        owner: owner,
        recordId: key,
        op: OutboxOp.create,
        kind: kSubscriptionWrite,
        body: draft.toJson(),
        id: key,
        // The first attempt WAS dispatched: its response, not the request, is
        // what went missing (review round 2, major 1).
        mayHaveReached: true,
      );
      return _placeholder(queued.entry!);
    }
    await _upsertCached(created);
    return created;
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    final OutboxEntry? queued = await _unsyncedCreate(id);
    if (queued != null) {
      // The server has never had this row: the device's queued copy is it.
      return (await _overlay(<Subscription>[])).firstWhere(
        (Subscription s) => s.id == id,
        orElse: () => _placeholder(queued),
      );
    }
    final String serverId = await _outbox.resolve(id);
    try {
      return await _network.getSubscription(serverId);
    } on ApiException catch (e) {
      if (!servesFromCacheFor(e)) rethrow;
      final List<Subscription>? cached = await _cache.peek(
        kLocalSubscriptionsKey,
        SubscriptionCodec.subscriptions,
      );
      final Subscription? hit = cached
          ?.where((Subscription s) => s.id == serverId)
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
    final String? owner = _currentUser();
    final OutboxEntry? queued = await _unsyncedCreate(id);
    if (queued != null && owner != null) {
      // A soft delete of a row the server never had is a delete.
      if (changes['deleted_at'] != null) {
        await deleteSubscription(id);
        return _placeholder(queued).patched(changes);
      }
      final OutboxEnqueueResult r = await _outbox.enqueue(
        owner: owner,
        recordId: id,
        op: OutboxOp.update,
        kind: kSubscriptionWrite,
        body: changes,
      );
      return r.entry != null && r.entry!.op == OutboxOp.create
          ? _placeholder(r.entry!)
          : _placeholder(queued).patched(changes);
    }
    if (!_cache.knownOffline) await replayPending();
    final Subscription updated = await _network.updateSubscription(
      await _outbox.resolve(id),
      changes,
    );
    await _upsertCached(updated);
    return updated;
  }

  @override
  Future<void> deleteSubscription(String id) async {
    final String? owner = _currentUser();
    if (owner != null && await _unsyncedCreate(id) != null) {
      // Cancels a create that never reached the server (nothing is sent), or
      // queues the delete behind one that may have.
      await _outbox.enqueue(
        owner: owner,
        recordId: id,
        op: OutboxOp.delete,
        kind: kSubscriptionWrite,
      );
      return;
    }
    if (!_cache.knownOffline) await replayPending();
    final String serverId = await _outbox.resolve(id);
    await _network.deleteSubscription(serverId);
    await _removeCached(serverId);
  }

  /// Not cached: a payment history is a detail-screen read, and a stale one
  /// is worse than a failed one that offers a retry.
  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async =>
      _network.getPaymentHistory(await _outbox.resolve(id));

  /// Not cached, for [getPaymentHistory]'s reason: an Insights read, and a
  /// failed one hides the trend rather than drawing a stale one.
  @override
  Future<SpendHistory> getSpendHistory() => _network.getSpendHistory();

  /// A write: the network or an error, never the cache, and not queued — the
  /// outbox carries subscription rows only, so an offline "Mark as paid"
  /// fails where the user sees it (the notification stays up, the row says
  /// so) and a second press is the same payment (the key is derived). A row
  /// added offline is resolved to its server id first, as on every read.
  @override
  Future<void> recordPayment(
    String id, {
    required Money amount,
    required DateTime paidOn,
    required String idempotencyKey,
  }) async => _network.recordPayment(
    await _outbox.resolve(id),
    amount: amount,
    paidOn: paidOn,
    idempotencyKey: idempotencyKey,
  );

  /// Not cached, for the reason [getPaymentHistory] is not.
  @override
  Future<List<PriceChange>> getPriceHistory(String id) async {
    final ApiClient network = _network;
    if (network is! PaymentWrites) return const <PriceChange>[];
    return (network as PaymentWrites).getPriceHistory(
      await _outbox.resolve(id),
    );
  }

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

  // ST-T9 (AD-05): categories are not cached or queued — a rename has to
  // reach the server to move its rows and its cap — so they pass straight to
  // the network client, or to the built-ins when it serves none.
  CategoriesApi? get _categories =>
      _network is CategoriesApi ? _network as CategoriesApi : null;

  @override
  Future<List<SubscriptionCategory>> getCategories() async =>
      await _categories?.getCategories() ?? kBuiltinCategoryRows;

  @override
  Future<SubscriptionCategory> createCategory(String name) =>
      _categoriesOrThrow.createCategory(name);

  @override
  Future<SubscriptionCategory> renameCategory(String id, String name) =>
      _categoriesOrThrow.renameCategory(id, name);

  @override
  Future<void> deleteCategory(String id) =>
      _categoriesOrThrow.deleteCategory(id);

  CategoriesApi get _categoriesOrThrow =>
      _categories ?? (throw UnsupportedError('no /v1/categories client'));
}
