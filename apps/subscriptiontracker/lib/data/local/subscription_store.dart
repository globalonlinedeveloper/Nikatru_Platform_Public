import 'dart:convert';

import 'package:nikatru_api_client/nikatru_api_client.dart'
    show CacheCodec, KeyValueJsonStore, StoreWriteFailure, kCacheIndexKey;
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../models/budget_info.dart';
import '../models/subscription.dart';

// ═════════════════════════════════════════════════════════════════════════════
// THE DEVICE IS THE BACKEND WHEN NO BACKEND IS CONFIGURED.
//
// 🔴 WHAT WAS BROKEN. Without `--dart-define=API_BASE_URL` the app resolves
// `SeedApiClient`, whose subscription list and budget were PLAIN IN-MEMORY
// FIELDS. `apiClientProvider` is a non-auto-dispose `Provider`, so an edit
// survived the container and died with the process: every subscription a user
// added was gone on the next launch, with no error, no empty-store warning and
// nothing in any log. That is the shipped default posture — it is what an
// unconfigured build, every store artefact built without the define, and every
// developer run actually does.
//
// ⚠️ SO THIS IS NOT A CACHE. There is no server behind the unconfigured branch
// to be a cache OF; this store is the system of record for that posture. The
// configured branch keeps its server as the record; its offline write queue is
// packages/core's `DurableOutbox` (audit D22), stored under [kLocalOutboxKey]
// and scoped per user, so a sign-out drops only the signed-out user's entries.
//
// ⏱ 2026-09-30 · the read/write/remove mechanics moved to the shared
// `KeyValueJsonStore` (audit D28). This file keeps the ROW TYPE: the keys, the
// codec and the typed read/write pairs.
//
// 🔴 WHY KEY-VALUE JSON AND NOT A DATABASE, measured rather than assumed.
// There is no sqlite/drift/isar/hive anywhere in this tree, so a database is a
// NEW cross-platform dependency with seven-target consequences (Android, iOS,
// macOS, Windows, Linux, web, apps.gov.in — which resolves to the Android
// artefact, `tooling/channel-register.json` `apps-gov-in.platforms == [android]`,
// so it inherits Android's answer exactly and adds no target of its own).
// `shared_preferences` already covers all six Flutter targets and is already
// wired, already namespaced, and already the thing every other persisted
// feature here uses (`nikatru.settings`, `nikatru.install_id`, consent, locale,
// promo, review). The measurement that says JSON holds: the payload is one
// `List<Subscription>` — the demo set is 12 rows and a row serialises to ~200
// bytes, so a 500-subscription hoarder is ~100 KB, well inside every backing
// store's per-key ceiling, and the app already reads the WHOLE list on every
// `fetchAll()` so there is no query this shape cannot answer. If a future
// feature needs indexed or partial reads, that is the measurement that would
// justify a database, and it does not exist today.
//
// ⚠️ EVERY KEY GOES THROUGH THE NAMESPACE, and there is no way to opt out of it
// here — this store takes a [core.KeyValueStore] and the one the app hands it is
// `PrefsKeyValueStore`, which wraps core's `NamespacedKeyValueStore`. That
// matters most on web: every app now serves from ONE origin
// (`nikatru.com/<app>`), `localStorage` is origin-scoped and never path-scoped,
// so an un-prefixed `nikatru.subscriptions` would be read and clobbered by a
// sibling app with no error of any kind. See `packages/core`'s
// `key_value_store.dart` for the whole argument.
// ═════════════════════════════════════════════════════════════════════════════

/// The user's subscription list, as one JSON array.
///
/// Same `nikatru.` prefix as every other persisted key in this app so the
/// stored keys read as one family; the app id in front of it is added by
/// [core.NamespacedKeyValueStore] and never written here.
const String kLocalSubscriptionsKey = 'nikatru.subscriptions';

/// The user's budget (monthly cap + per-category caps), as one JSON object.
const String kLocalBudgetKey = 'nikatru.budget';

/// Writes made offline, waiting for the server — packages/core's
/// `DurableOutbox` (audit D22), one document of user-scoped entries.
const String kLocalOutboxKey = 'nikatru.subscriptions.outbox';

/// The subscriptions the user has ANSWERED "yes, still using" for on Insights
/// (ST-D3 D3-4). A JSON list of ids. Asked, never inferred: nothing in the app
/// measures usage, so the only signal is the one the user gives.
const String kLocalStillUsingKey = 'nikatru.still_using';

// ─────────────────────────────────────────────────────────────────────────────
// 🔴 THE SERIALIZATION BOUNDARY, AND IT IS DELIBERATELY THE ONLY ONE.
//
// Everything this app persists about subscriptions passes through the four
// methods below and nowhere else. That is a maintenance property with a name
// attached: the money type on these models is being replaced (`double` →
// `Money{int minorUnits, String currencyCode}`) in a sibling change, and the
// models own their `toJson`/`fromJson`, so that work rebases onto ONE region
// here rather than onto every call site that ever wrote a subscription down.
// If you find yourself calling `jsonEncode` on a [Subscription] anywhere else,
// that is the defect this comment exists to prevent.
// ─────────────────────────────────────────────────────────────────────────────

/// Turns the persisted payloads into models and back.
///
/// Static-only: it holds no state and there is exactly one correct encoding, so
/// an instance would only be a second way to spell the same call.
class SubscriptionCodec {
  const SubscriptionCodec._();

  /// The JSON text for [subs].
  static String encodeSubscriptions(List<Subscription> subs) =>
      jsonEncode(subs.map((Subscription s) => s.toJson()).toList());

  /// The subscriptions in [raw], or null when [raw] is not a JSON array.
  ///
  /// 🔴 NULL IS "UNREADABLE", NOT "EMPTY", and the caller must keep them apart —
  /// see [LocalSubscriptionStore.readSubscriptions]. An empty array decodes to
  /// an empty list, which is a real answer: the user deleted everything.
  ///
  /// ⚠️ A ROW THAT WILL NOT DECODE IS SKIPPED, NOT FATAL. Rejecting the whole
  /// payload for one bad row would throw away every OTHER subscription the user
  /// owns — a data-loss repair for a display problem. One unparseable row costs
  /// that row.
  static List<Subscription>? decodeSubscriptions(String raw) {
    final Object? decoded = _tryDecode(raw);
    if (decoded is! List<Object?>) return null;
    final List<Subscription> out = <Subscription>[];
    for (final Object? row in decoded) {
      if (row is! Map<String, dynamic>) continue;
      try {
        out.add(Subscription.fromJson(row));
      } catch (_) {
        // One row that does not fit the model. Keep the rest.
      }
    }
    return out;
  }

  /// The JSON text for [budget].
  static String encodeBudget(BudgetInfo budget) => jsonEncode(budget.toJson());

  /// The budget in [raw], or null when [raw] is not a readable JSON object.
  static BudgetInfo? decodeBudget(String raw) {
    final Object? decoded = _tryDecode(raw);
    if (decoded is! Map<String, dynamic>) return null;
    try {
      return BudgetInfo.fromJson(decoded);
    } catch (_) {
      return null;
    }
  }

  /// [encodeSubscriptions]/[decodeSubscriptions] as the shared cache's codec.
  static final CacheCodec<List<Subscription>> subscriptions =
      CacheCodec<List<Subscription>>(
        encode: encodeSubscriptions,
        decode: decodeSubscriptions,
      );

  /// [encodeBudget]/[decodeBudget] as the shared cache's codec.
  static final CacheCodec<BudgetInfo> budget = CacheCodec<BudgetInfo>(
    encode: encodeBudget,
    decode: decodeBudget,
  );

  static Object? _tryDecode(String raw) {
    try {
      return jsonDecode(raw);
    } on FormatException {
      return null;
    }
  }
}

/// A write to the device store failed, and the caller is being told.
///
/// 🔴 THIS USED TO BE A `catch (_) {}`. `_write` swallowed every failure —
/// full disk, blocked storage, a plugin that is not there — and
/// `PersistedApiClient.createSubscription` then returned the created row as if
/// it had been kept. The failure now travels: the persisted client rolls back
/// and rethrows, and the cache client counts and reports it.
///
/// ⏱ 2026-09-30 · the shared `StoreWriteFailure` (packages/api_client, audit
/// D28); the name stays so every caller and test reads as before.
typedef LocalStoreWriteFailure = StoreWriteFailure;

/// The durable home of the subscriptions and the budget in the unconfigured
/// (no `API_BASE_URL`) posture, and the read-through cache of the server's
/// last answer in the configured one (see `CachedApiClient`).
///
/// ⚠️ IT TAKES A `Future<core.KeyValueStore>`, NOT A STORE. `keyValueStoreProvider`
/// is a `FutureProvider` — `SharedPreferences.getInstance()` is asynchronous on
/// every platform — while `apiClientProvider` is a synchronous `Provider` and
/// must stay one (it is read synchronously all over the app, and two guards read
/// the SHAPE of that branch). Taking the future lets the seam be constructed
/// synchronously and resolved on first use, which is also when the first read
/// happens anyway.
///
/// 🔴 READS DEGRADE, WRITES DO NOT. A store that is missing, locked or unreadable
/// answers a read with "nothing stored" so a launch never fails on it — under
/// `flutter test` there is no `shared_preferences` plugin at all unless a test
/// installs one, and an unconfigured build must still run. A WRITE that fails
/// throws [LocalStoreWriteFailure]: the caller holds data the user just typed,
/// and only the caller can decide whether to roll back, retry or tell them.
/// Swallowing it here was how a full disk turned into "it was there yesterday".
class LocalSubscriptionStore {
  /// Persist through [store] once it resolves.
  LocalSubscriptionStore(Future<core.KeyValueStore> store)
    : kv = store,
      json = KeyValueJsonStore(store);

  /// A store that never persists anything — the honest no-op for a posture that
  /// has no backing store.
  LocalSubscriptionStore.inMemory()
    : this(Future<core.KeyValueStore>.value(core.InMemoryKeyValueStore()));

  /// The raw store, for the shared `DurableOutbox` (packages/core).
  final Future<core.KeyValueStore> kv;

  /// The shared store underneath — what the read-through cache and the outbox
  /// are built on, so all three share one backing store and one namespace.
  final KeyValueJsonStore json;

  /// The stored subscriptions, or null when nothing is stored yet or the stored
  /// text is unreadable.
  ///
  /// 🔴 ABSENT IS NOT EMPTY, and this signature is the whole reason the fix is
  /// safe. `[]` means the user has deleted every subscription and that state
  /// must survive a restart; `null` means this device has never written one, and
  /// only THAT is allowed to be answered with the demo seed. Collapsing the two
  /// into `List<Subscription>` would re-seed twelve demo rows onto every user
  /// who cleared their list — the same defect shape
  /// `SubscriptionsController.addSubscription` documents at
  /// `state.value ?? const []`.
  Future<List<Subscription>?> readSubscriptions() =>
      json.read(kLocalSubscriptionsKey, SubscriptionCodec.subscriptions);

  /// Replace the stored subscriptions with [subs].
  ///
  /// Throws [LocalStoreWriteFailure] when the store refuses — never silently.
  Future<void> writeSubscriptions(List<Subscription> subs) =>
      json.write(kLocalSubscriptionsKey, subs, SubscriptionCodec.subscriptions);

  /// The stored budget, or null when nothing is stored yet or it is unreadable.
  Future<BudgetInfo?> readBudget() =>
      json.read(kLocalBudgetKey, SubscriptionCodec.budget);

  /// Replace the stored budget with [budget].
  ///
  /// Throws [LocalStoreWriteFailure] when the store refuses — never silently.
  Future<void> writeBudget(BudgetInfo budget) =>
      json.write(kLocalBudgetKey, budget, SubscriptionCodec.budget);

  /// The ids answered "still using", or an empty set when none is stored or
  /// the stored text is unreadable — a lost answer is asked again, never
  /// invented.
  Future<Set<String>> readStillUsing() async {
    final String? raw = await _read(kLocalStillUsingKey);
    if (raw == null) return <String>{};
    try {
      final Object? decoded = jsonDecode(raw);
      return decoded is List
          ? <String>{
              for (final Object? e in decoded)
                if (e is String) e,
            }
          : <String>{};
    } catch (_) {
      return <String>{};
    }
  }

  /// Replace the stored answers with [ids].
  ///
  /// Throws [LocalStoreWriteFailure] when the store refuses — never silently.
  Future<void> writeStillUsing(Set<String> ids) =>
      _write(kLocalStillUsingKey, jsonEncode(ids.toList()..sort()));

  /// Forget everything this store owns.
  ///
  /// Exists so account deletion and a consent withdrawal have one call to make
  /// rather than a list of keys to keep in step with this file.
  ///
  /// A store that was never reachable has nothing to forget and answers
  /// normally; a store that IS there and refuses throws [LocalStoreWriteFailure],
  /// because "forgotten" is a promise `forgetSignedInUser` relays to the user.
  Future<void> clear() => json.remove(<String>[
    kLocalSubscriptionsKey,
    kLocalBudgetKey,
    kLocalStillUsingKey,
    // NOT kLocalOutboxKey: the outbox is per user. An explicit sign-out drops
    // THAT user's entries (`discardPendingOf`); a forced 401 keeps them for
    // the same user's return; nobody else's replay ever sends them.
    kCacheIndexKey, // the shared cache's list of what it wrote: key names only
  ]);

  // The still-using answers (ST-D3 D3-4) read and write through the shared
  // store, with its read-degrades / write-throws contract.
  Future<String?> _read(String key) => json.readRaw(key);

  Future<void> _write(String key, String value) => json.writeRaw(key, value);
}
