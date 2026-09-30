import 'package:nikatru_core/nikatru_core.dart'
    show InMemoryKeyValueStore, KeyValueStore;

// ═════════════════════════════════════════════════════════════════════════════
// THE DEVICE COPY OF WHAT A SERVER SAID — ONE STORE, EVERY APP.
//
// ⏱ 2026-09-30 · moved here from apps/subscriptiontracker (audit D28, ST-N5).
// The read-through cache, the store under it and the write-failure type lived
// only in that app, so the brick stamped apps with no offline copy at all and a
// second app would have forked the first. The app now keeps its ROW TYPE and
// its codec; the mechanics below are shared, and the brick stamps an adapter.
//
// 🔴 READS DEGRADE, WRITES DO NOT. A store that is missing, locked or unreadable
// answers a read with "nothing stored" so a launch never fails on it — under
// `flutter test` there is no `shared_preferences` plugin unless a test installs
// one. A WRITE that fails throws [StoreWriteFailure]: the caller holds data the
// user just typed, and only the caller can decide whether to roll back, retry
// or tell them. Swallowing it was how a full disk turned into "it was there
// yesterday" (the app's `LocalStoreWriteFailure`, which is now this type).
//
// ⚠️ IT TAKES A `Future<KeyValueStore>`, NOT A STORE. Every app's
// `keyValueStoreProvider` is a `FutureProvider` (SharedPreferences is async on
// every platform) while the clients built on this are synchronous `Provider`s.
// Taking the future lets the seam be constructed synchronously and resolved on
// first use, which is when the first read happens anyway.
//
// ⚠️ THE KEYS ARE THE CALLER'S AND THE NAMESPACE IS THE STORE'S. Apps hand in a
// `NamespacedKeyValueStore`, so a key written here is never read by a sibling
// app on the same web origin; nothing in this file prefixes anything.
// ═════════════════════════════════════════════════════════════════════════════

/// A write to the device store failed, and the caller is being told.
class StoreWriteFailure implements Exception {
  const StoreWriteFailure(this.key, this.cause);

  /// The store key the write was for.
  final String key;

  /// What the store threw.
  final Object cause;

  @override
  String toString() => 'StoreWriteFailure: could not write $key — $cause';
}

/// How one cached value becomes text and back.
///
/// 🔴 [decode] RETURNS NULL FOR "UNREADABLE", and the cache treats that exactly
/// as "nothing stored": a payload this build cannot read is never served.
class CacheCodec<T> {
  const CacheCodec({required this.encode, required this.decode});

  final String Function(T value) encode;
  final T? Function(String raw) decode;
}

/// String values under caller-chosen keys, over a key-value store that may not
/// be there. See the header for the read/write asymmetry.
class KeyValueJsonStore {
  /// Persist through [store] once it resolves.
  KeyValueJsonStore(this._store);

  /// A store that keeps nothing past the process — the honest no-op for a
  /// posture with no backing store, and what tests reach for.
  KeyValueJsonStore.inMemory()
    : _store = Future<KeyValueStore>.value(InMemoryKeyValueStore());

  final Future<KeyValueStore> _store;

  /// The text under [key], or null when nothing is stored or the store is
  /// unreachable.
  Future<String?> readRaw(String key) async {
    try {
      return await (await _store).read(key);
    } catch (_) {
      return null;
    }
  }

  /// The value under [key] through [codec], or null when absent or unreadable.
  Future<T?> read<T>(String key, CacheCodec<T> codec) async {
    final String? raw = await readRaw(key);
    return raw == null ? null : codec.decode(raw);
  }

  /// Replace the text under [key]. Throws [StoreWriteFailure] — never silently.
  Future<void> writeRaw(String key, String value) async {
    try {
      await (await _store).write(key, value);
    } catch (e) {
      // 🔴 NOT SWALLOWED. The caller is holding the user's data; it decides.
      throw StoreWriteFailure(key, e);
    }
  }

  /// Replace the value under [key] through [codec]. Throws [StoreWriteFailure].
  Future<void> write<T>(String key, T value, CacheCodec<T> codec) =>
      writeRaw(key, codec.encode(value));

  /// Forget [keys].
  ///
  /// A store that was never reachable has nothing to forget and answers
  /// normally; a store that IS there and refuses throws [StoreWriteFailure],
  /// because "forgotten" is a promise a sign-out relays to the user.
  Future<void> remove(Iterable<String> keys) async {
    final KeyValueStore kv;
    try {
      kv = await _store;
    } catch (_) {
      return; // never reachable ⇒ nothing was ever written here
    }
    for (final String key in keys) {
      try {
        await kv.remove(key);
      } catch (e) {
        throw StoreWriteFailure(key, e);
      }
    }
  }
}
