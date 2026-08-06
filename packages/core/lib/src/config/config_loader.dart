import 'dart:async';
import 'dart:convert';

import '../result.dart';
import '../storage/key_value_store.dart';
import 'app_config.dart';
import 'default_configs.dart';

/// Seam for fetching raw config JSON for an app. Implementations live in the
/// app layer (e.g. a dio-based transport in Subly) so `core` stays pure Dart.
abstract interface class ConfigTransport {
  /// Fetch the raw config document for [appId]. Returns [Ok] with the decoded
  /// JSON map on a 2xx response, or [Err] on any network / HTTP / parse failure
  /// (an unknown app 404s ⇒ [Err], and the loader then falls back to defaults).
  Future<Result<Map<String, Object?>>> fetch(String appId);
}

/// Best-known config per app, seeded from the compiled-in defaults. Reads are
/// synchronous (in-memory) so `peek`/`load` never block; when a [KeyValueStore]
/// is supplied the last-good value ALSO persists across restarts (ADR 005).
///
/// A successful fetch updates the entry; reads fall back to the bundled default.
class ConfigCache {
  ConfigCache({
    Map<String, AppConfig>? seed,
    KeyValueStore? store,
    String keyPrefix = 'nikatru.cfg.',
  })  : _store = <String, AppConfig>{...?seed},
        _persist = store,
        _keyPrefix = keyPrefix;

  final Map<String, AppConfig> _store;
  final KeyValueStore? _persist;
  final String _keyPrefix;

  /// Best-known config for [appId]: last successful fetch, else the compiled-in
  /// default, else null for an unregistered app.
  AppConfig? get(String appId) => _store[appId] ?? defaultConfigFor(appId);

  /// Record a freshly fetched config as the new last-good value. With a backing
  /// [KeyValueStore] the value is also written through to durable storage,
  /// fire-and-forget: the in-memory value is authoritative for the session and
  /// config resolution must never block on disk.
  void put(AppConfig config) {
    _store[config.appId] = config;
    final KeyValueStore? persist = _persist;
    if (persist != null) {
      // Best-effort + fault-isolated: a failed disk write must not surface as an
      // unhandled zone error (the in-memory value already succeeded).
      unawaited(persist
          .write('$_keyPrefix${config.appId}', jsonEncode(config.toJson()))
          .catchError((Object _) {}));
    }
  }

  /// Load persisted last-good configs for [appIds] into memory. Call once at
  /// startup — BEFORE the first [ConfigLoader.peek]/`load` — so a relaunched app
  /// resolves its last-good config synchronously and offline. A corrupt persisted
  /// entry is skipped (the bundled default still applies). No-op without a store.
  Future<void> hydrate(Iterable<String> appIds) async {
    final KeyValueStore? persist = _persist;
    if (persist == null) return;
    for (final String appId in appIds) {
      try {
        // THE STORE READ IS INSIDE THE TRY. It used to sit above it, so a
        // throwing store — a corrupt shared_preferences file, a plugin
        // `PlatformException`, a disk error — escaped as an unhandled error
        // instead of taking the documented "skip the entry" path. This is called
        // at STARTUP, before the first peek/load, so that error surfaced as a
        // launch crash on the exact devices whose storage was already unhappy.
        final String? raw = await persist.read('$_keyPrefix$appId');
        if (raw == null) continue;
        final Object? decoded = jsonDecode(raw);
        if (decoded is Map) {
          _store[appId] = AppConfig.fromJson(decoded.cast<String, Object?>());
        }
      } catch (_) {
        // Unreadable store OR a corrupt/tampered entry (bad JSON, wrong shape,
        // wrong-typed field) — ignore; the bundled default remains available.
        // Neither may ever crash startup (matches EntitlementCache.readRaw).
      }
    }
  }
}

/// Loads runtime config for an app: network first, then the last-good cache,
/// then the compiled-in bundled default — so a known app is ALWAYS offline-safe.
class ConfigLoader {
  ConfigLoader({required ConfigTransport transport, ConfigCache? cache})
      : _transport = transport,
        _cache = cache ?? ConfigCache();

  final ConfigTransport _transport;
  final ConfigCache _cache;

  /// Best-known config WITHOUT a network call (last-good or bundled default).
  AppConfig? peek(String appId) => _cache.get(appId);

  /// Resolve config for [appId]. Never fails for a known app: a network or
  /// parse failure falls back to the last-good cache, then the bundled default.
  /// Returns [Err] only for an unknown app with no default and no cached value.
  Future<Result<AppConfig>> load(String appId) async {
    final Result<Map<String, Object?>> fetched = await _transport.fetch(appId);
    return fetched.fold(
      (Map<String, Object?> json) {
        try {
          final AppConfig config = AppConfig.fromJson(json);
          _cache.put(config);
          return Result<AppConfig>.ok(config);
        } on FormatException catch (e) {
          return _fallback(
              appId, Failure('malformed config for "$appId"', cause: e));
        }
      },
      (Failure failure) => _fallback(appId, failure),
    );
  }

  Result<AppConfig> _fallback(String appId, Failure failure) {
    final AppConfig? best = _cache.get(appId);
    if (best != null) return Result<AppConfig>.ok(best);
    return Result<AppConfig>.err(failure);
  }
}

/// A [ConfigTransport] that reports whether each fetch reached the network,
/// without changing what the loader sees.
///
/// 🔴 THIS LIVES IN `packages/core`, NOT IN THE BRICK, AND THAT IS THE POINT.
/// It was first written inside `__brick__/…/lib/state/providers.dart`, where
/// `assert-no-seam-forks.mjs` immediately caught it: a class re-implementing a
/// registered seam **inside the template** is a fork every stamped app
/// inherits, which is exactly what [pipeline C-3] and [pipeline C-9] forbid.
/// The behaviour was right; the address was wrong.
///
/// Why a decorator rather than a field on the result: `ConfigLoader.load`
/// deliberately swallows transport failures so an offline launch still gets the
/// last-good config, so the reachability signal has to be observed BELOW it.
/// Widening [Result] would make a dozen consumers pay for a fact one banner
/// needs.
class ReportingConfigTransport implements ConfigTransport {
  ReportingConfigTransport({required this.inner, required this.report});

  final ConfigTransport inner;

  /// Called once per fetch with `true` when the fetch did NOT reach the network.
  final void Function(bool unreachable) report;

  @override
  Future<Result<Map<String, Object?>>> fetch(String appId) async {
    final Result<Map<String, Object?>> r = await inner.fetch(appId);
    report(!r.isOk);
    return r;
  }
}
