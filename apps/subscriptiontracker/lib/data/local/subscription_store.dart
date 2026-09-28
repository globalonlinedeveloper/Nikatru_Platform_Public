import 'dart:convert';

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
// configured branch is untouched and keeps its server as the record — an
// offline write queue in front of a live Worker is a different piece of work
// with different failure modes (conflict resolution, replay ordering), and
// pretending this file is a step towards it would be the wrong claim.
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
/// it had been kept. On the next launch it was gone, and three tests ASSERTED
/// that silence (`completes`, then `readSubscriptions()` is null). A write the
/// user cannot see fail is a write the user finds out about a week later, so
/// the failure now travels: the persisted client rolls back and rethrows, and
/// the cache client counts and reports it.
class LocalStoreWriteFailure implements Exception {
  const LocalStoreWriteFailure(this.key, this.cause);

  /// The store key the write was for.
  final String key;

  /// What the store threw.
  final Object cause;

  @override
  String toString() => 'LocalStoreWriteFailure: could not write $key — $cause';
}

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
  LocalSubscriptionStore(this._store);

  /// A store that never persists anything — the honest no-op for a posture that
  /// has no backing store, and what a failed [_store] degrades to.
  LocalSubscriptionStore.inMemory()
    : _store = Future<core.KeyValueStore>.value(core.InMemoryKeyValueStore());

  final Future<core.KeyValueStore> _store;

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
  Future<List<Subscription>?> readSubscriptions() async {
    final String? raw = await _read(kLocalSubscriptionsKey);
    return raw == null ? null : SubscriptionCodec.decodeSubscriptions(raw);
  }

  /// Replace the stored subscriptions with [subs].
  ///
  /// Throws [LocalStoreWriteFailure] when the store refuses — never silently.
  Future<void> writeSubscriptions(List<Subscription> subs) => _write(
    kLocalSubscriptionsKey,
    SubscriptionCodec.encodeSubscriptions(subs),
  );

  /// The stored budget, or null when nothing is stored yet or it is unreadable.
  Future<BudgetInfo?> readBudget() async {
    final String? raw = await _read(kLocalBudgetKey);
    return raw == null ? null : SubscriptionCodec.decodeBudget(raw);
  }

  /// Replace the stored budget with [budget].
  ///
  /// Throws [LocalStoreWriteFailure] when the store refuses — never silently.
  Future<void> writeBudget(BudgetInfo budget) =>
      _write(kLocalBudgetKey, SubscriptionCodec.encodeBudget(budget));

  /// Forget everything this store owns.
  ///
  /// Exists so account deletion and a consent withdrawal have one call to make
  /// rather than a list of keys to keep in step with this file.
  ///
  /// A store that was never reachable has nothing to forget and answers
  /// normally; a store that IS there and refuses throws [LocalStoreWriteFailure],
  /// because "forgotten" is a promise `forgetSignedInUser` relays to the user.
  Future<void> clear() async {
    final core.KeyValueStore kv;
    try {
      kv = await _store;
    } catch (_) {
      return; // never reachable ⇒ nothing was ever written here
    }
    try {
      await kv.remove(kLocalSubscriptionsKey);
      await kv.remove(kLocalBudgetKey);
    } catch (e) {
      throw LocalStoreWriteFailure(kLocalSubscriptionsKey, e);
    }
  }

  Future<String?> _read(String key) async {
    try {
      return await (await _store).read(key);
    } catch (_) {
      return null;
    }
  }

  Future<void> _write(String key, String value) async {
    try {
      await (await _store).write(key, value);
    } catch (e) {
      // 🔴 NOT SWALLOWED. The caller is holding the user's data; it decides.
      throw LocalStoreWriteFailure(key, e);
    }
  }
}
