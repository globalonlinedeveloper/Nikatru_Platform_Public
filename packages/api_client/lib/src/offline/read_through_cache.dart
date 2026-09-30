import 'dart:async';
import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart' show OutboxFailure;

import '../rest_client.dart' show ApiException;
import 'json_store.dart';

// ═════════════════════════════════════════════════════════════════════════════
// A READ-THROUGH CACHE OF WHAT THE SERVER LAST SAID — GENERIC, IN THE BRICK.
//
// ⏱ 2026-09-30 · moved here from apps/subscriptiontracker's `CachedApiClient`
// (audit D28). The app keeps its row type and a thin adapter; every stamped app
// gets this through the brick's `readThroughCacheProvider`.
//
// 🔴 WHEN THE CACHE MAY ANSWER. Only for a TRANSPORT failure (status 0: no
// network, DNS, timeout) or a SERVER failure (5xx). A 401 is not "offline" —
// it is "this session is not accepted" — and serving a cached list there would
// show one account's rows to whoever signs in next on the same device. Every
// other 4xx is a real answer about the request and travels unchanged. The same
// account boundary is why every app drops this cache on sign-out.
//
// 🔴 A CACHED ANSWER IS MARKED, PER KEY (audit D19; review #1075 finding 12).
// A read served from the copy marks ITS key stale; a live read of another key
// never clears it. `onStaleChanged` reports whether ANY key is stale.
//
// 🔴 A READ THAT HOLDS A CACHED ANSWER NEVER WAITS ON THE CONNECT TIMEOUT
// (audit D24). It waits at most [ReadThroughCache.revalidateAfter] and then
// answers from the copy, marked stale, while the request carries on
// (stale-while-revalidate); once the device is proven offline it answers at
// once.
//
// 🔴 AND A REVALIDATION NEVER STARTS ANOTHER (review #1075 finding 3). The
// request that carried on is the ONLY one in flight for its key — a second read
// joins it — and when it lands it is mirrored, it CLEARS the stale mark, and
// `onRevalidated` fires. The read that notification prompts is answered from
// the fresh mirror without a request for [ReadThroughCache.minRevalidateInterval]
// (30 s). Before this, a network slower than the 2 s probe re-read, timed out,
// revalidated and re-read again: a GET every 2.5 s for as long as the list was
// open, and the list marked stale the whole time.
//
// ⚠️ A CACHE WRITE FAILURE NEVER FAILS THE OPERATION — the server has the
// truth — BUT IT IS NEVER SILENT EITHER: it is counted, kept, and reported
// through `onWriteFailed`, which production wires to the crash sink (AB-O2-03).
// ═════════════════════════════════════════════════════════════════════════════

/// Where a cache records the keys it has written, for [ReadThroughCache.forget].
const String kCacheIndexKey = 'nikatru.cache.keys';

/// How long a read that HAS a cached answer waits for the network before it
/// answers from the cache. Well inside `RestClient`'s 15 s connect timeout, and
/// long enough that a slow-but-working network still wins the race.
const Duration kRevalidateAfter = Duration(seconds: 2);

/// How long a background revalidation's answer is served without a new
/// request — the debounce that stops a slow network from looping.
const Duration kMinRevalidateInterval = Duration(seconds: 30);

/// How the shared outbox should treat a failed send over [RestClient]: the one
/// mapping from this client's failures to `OutboxFailure`.
OutboxFailure classifyForOutbox(Object error) {
  if (error is! ApiException) return OutboxFailure.transient;
  final int s = error.statusCode;
  if (s == 0) return OutboxFailure.offline;
  if (s == 401) return OutboxFailure.unauthorized;
  if (s == 408 || s == 409 || s == 429 || s >= 500) {
    return OutboxFailure.transient;
  }
  return OutboxFailure.refused;
}

/// The device's copy of what the server last answered, served only when the
/// server cannot be asked — and marked when it is.
class ReadThroughCache {
  ReadThroughCache(
    this._store, {
    void Function(Object error)? onWriteFailed,
    void Function(bool stale)? onStaleChanged,
    this.revalidateAfter = kRevalidateAfter,
    this.minRevalidateInterval = kMinRevalidateInterval,
    DateTime Function()? now,
  }) : _onWriteFailed = onWriteFailed ?? _ignore,
       _onStaleChanged = onStaleChanged ?? _ignoreStale,
       _now = now ?? DateTime.now;

  final KeyValueJsonStore _store;
  final void Function(Object error) _onWriteFailed;
  final void Function(bool stale) _onStaleChanged;
  final DateTime Function() _now;

  /// See [kRevalidateAfter].
  final Duration revalidateAfter;

  /// See [kMinRevalidateInterval].
  final Duration minRevalidateInterval;

  static void _ignore(Object _) {}
  static void _ignoreStale(bool _) {}

  /// Whether [e] is a failure the cache is allowed to stand in for.
  static bool servesFromCacheFor(Object? e) =>
      e is ApiException && (e.statusCode == 0 || e.statusCode >= 500);

  final Set<String> _staleKeys = <String>{};

  /// Whether any key's most recent read was answered by the copy.
  bool get lastReadWasFromCache => _staleKeys.isNotEmpty;

  /// Whether [key]'s most recent read was answered by the copy.
  bool isStale(String key) => _staleKeys.contains(key);

  /// Whether the last request this cache saw proved the device offline — the
  /// probe that lets the next read skip the wait entirely.
  bool get knownOffline => _knownOffline;
  bool _knownOffline = false;

  /// How many mirror writes have failed. Zero on a healthy device.
  int get writeFailures => _writeFailures;
  int _writeFailures = 0;

  /// The most recent mirror-write failure, kept for the UI and for tests.
  Object? get lastWriteError => _lastWriteError;
  Object? _lastWriteError;

  /// The request in flight per key — one at a time (finding 3).
  final Map<String, Future<_Settled<Object?>>> _inFlight =
      <String, Future<_Settled<Object?>>>{};

  /// Until when a key's background-revalidated mirror answers without a
  /// request.
  final Map<String, DateTime> _freshUntil = <String, DateTime>{};

  void _setStale(String key, bool stale) {
    final bool before = _staleKeys.isNotEmpty;
    if (stale) {
      _staleKeys.add(key);
    } else {
      _staleKeys.remove(key);
    }
    if (_staleKeys.isNotEmpty != before) _onStaleChanged(_staleKeys.isNotEmpty);
  }

  void _observe(Object? error) {
    _knownOffline = ApiException.isOfflineError(error);
  }

  /// The cached value under [key], without asking the network.
  Future<T?> peek<T>(String key, CacheCodec<T> codec) =>
      _store.read(key, codec);

  /// Keep [value] as the copy under [key]. A failure is counted and reported,
  /// never thrown: the server already holds the truth.
  Future<void> mirror<T>(String key, T value, CacheCodec<T> codec) async {
    try {
      await _remember(key);
      await _store.write(key, value, codec);
    } on StoreWriteFailure catch (e) {
      _writeFailures += 1;
      _lastWriteError = e;
      _onWriteFailed(e);
    }
  }

  /// The keys this cache has ever written, so [forget] needs no list from the
  /// caller: a stamped app that adds a cached read cannot forget to drop it.
  Set<String>? _keys;

  Future<void> _remember(String key) async {
    final Set<String> keys = _keys ??=
        (await _store.read(kCacheIndexKey, _indexCodec))?.toSet() ?? <String>{};
    if (!keys.add(key)) return;
    await _store.write(kCacheIndexKey, keys.toList()..sort(), _indexCodec);
  }

  static final CacheCodec<List<String>> _indexCodec = CacheCodec<List<String>>(
    encode: (List<String> keys) => jsonEncode(keys),
    decode: (String raw) {
      try {
        final Object? d = jsonDecode(raw);
        return d is List<Object?> ? d.whereType<String>().toList() : null;
      } on FormatException {
        return null;
      }
    },
  );

  /// Forget every copy this cache wrote — the sign-out drop. A cached answer
  /// is ACCOUNT state: left behind, the next person to sign in on this device
  /// offline would be shown it. Throws [StoreWriteFailure] when the store is
  /// there and refuses, because "forgotten" is a promise told to the user.
  Future<void> forget() async {
    final List<String> keys =
        await _store.read(kCacheIndexKey, _indexCodec) ?? <String>[];
    await _store.remove(<String>[...keys, kCacheIndexKey]);
    _keys = <String>{};
    _freshUntil.clear();
    final bool wasStale = _staleKeys.isNotEmpty;
    _staleKeys.clear();
    if (wasStale) _onStaleChanged(false);
    _knownOffline = false;
  }

  /// Apply [change] to the copy under [key], if there is one. A device that has
  /// never cached the value has nothing to keep in step.
  Future<void> amend<T>(
    String key,
    CacheCodec<T> codec,
    T Function(T cached) change,
  ) async {
    final T? cached = await _store.read(key, codec);
    if (cached == null) return;
    await mirror(key, change(cached), codec);
  }

  /// The server's answer from [fetch], mirrored under [key]; or, when the
  /// server cannot answer, the copy — marked stale. See the header.
  ///
  /// Nothing cached is nothing to show: then the read waits for [fetch] and
  /// its failure travels, so a screen renders its failed state with a retry.
  Future<T> read<T>(
    String key,
    CacheCodec<T> codec,
    Future<T> Function() fetch, {
    void Function(T fresh)? onRevalidated,
  }) async {
    final DateTime? freshUntil = _freshUntil[key];
    if (freshUntil != null && _now().isBefore(freshUntil)) {
      final T? fresh = await _store.read(key, codec);
      if (fresh != null) {
        _setStale(key, false);
        return fresh;
      }
    }
    _freshUntil.remove(key);

    final bool joined = _inFlight.containsKey(key);
    final Future<_Settled<T>> settled = _start(key, fetch);
    final T? cached = await _store.read(key, codec);

    if (cached == null) {
      final _Settled<T> s = await settled;
      _observe(s.error);
      if (s.error != null) Error.throwWithStackTrace(s.error!, s.stack!);
      _setStale(key, false);
      await mirror(key, s.value as T, codec);
      return s.value as T;
    }

    final _Settled<T>? first = await _race(settled);
    if (first == null) {
      // The network is late (or known to be gone): answer now, keep asking —
      // unless another read already is.
      _setStale(key, true);
      if (!joined) {
        unawaited(
          settled.then((_Settled<T> s) async {
            _observe(s.error);
            if (s.error != null) return;
            await mirror(key, s.value as T, codec);
            _freshUntil[key] = _now().add(minRevalidateInterval);
            _setStale(key, false);
            onRevalidated?.call(s.value as T);
          }),
        );
      }
      return cached;
    }
    _observe(first.error);
    if (first.error == null) {
      _setStale(key, false);
      await mirror(key, first.value as T, codec);
      return first.value as T;
    }
    if (!servesFromCacheFor(first.error)) {
      Error.throwWithStackTrace(first.error!, first.stack!);
    }
    _setStale(key, true);
    return cached;
  }

  /// The request in flight for [key], started with [fetch] when there is none.
  Future<_Settled<T>> _start<T>(String key, Future<T> Function() fetch) {
    final Future<_Settled<Object?>>? running = _inFlight[key];
    if (running != null) {
      return running.then(
        (_Settled<Object?> s) => s.error != null
            ? _Settled<T>.error(s.error!, s.stack!)
            : _Settled<T>.value(s.value as T),
      );
    }
    final Future<_Settled<T>> started = _settle(fetch());
    _inFlight[key] = started;
    started.whenComplete(() {
      if (identical(_inFlight[key], started)) _inFlight.remove(key);
    });
    return started;
  }

  /// [settled], or null when [revalidateAfter] passes first — or at once when
  /// the previous request proved the device offline.
  Future<_Settled<T>?> _race<T>(Future<_Settled<T>> settled) {
    if (_knownOffline) return Future<_Settled<T>?>.value();
    final Completer<_Settled<T>?> winner = Completer<_Settled<T>?>();
    // A Timer, not Future.delayed: it is cancelled when the network wins, so a
    // widget test never ends with a pending timer it did not start.
    final Timer timer = Timer(revalidateAfter, () {
      if (!winner.isCompleted) winner.complete();
    });
    settled.then((_Settled<T> s) {
      timer.cancel();
      if (!winner.isCompleted) winner.complete(s);
    });
    return winner.future;
  }

  static Future<_Settled<T>> _settle<T>(Future<T> f) => f.then(
    (T v) => _Settled<T>.value(v),
    onError: (Object e, StackTrace s) => _Settled<T>.error(e, s),
  );
}

/// A request's outcome, held so a race never leaves an error unhandled.
class _Settled<T> {
  _Settled.value(this.value) : error = null, stack = null;
  _Settled.error(Object this.error, StackTrace this.stack) : value = null;

  final T? value;
  final Object? error;
  final StackTrace? stack;
}
