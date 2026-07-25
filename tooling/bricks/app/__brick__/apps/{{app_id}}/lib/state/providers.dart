import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/app_config.dart';
import '../data/config/dio_config_transport.dart';

/// Compiled-in default runtime config for THIS app. core's `kDefaultConfigs`
/// only knows the reference apps, so a freshly-stamped app seeds its own default
/// — that's what makes config resolution offline-safe here (network → last-good
/// → this default). Built from the compile-time [AppConfig] values.
final core.AppConfig kAppDefaultConfig = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: AppConfig.apiBaseUrl,
  features: const <String, bool>{},
  paywall: const core.PaywallConfig(enabled: false),
  contentPack: null,
  copy: const <String, String>{},
  minSupportedVersion: '1.0.0',
);

/// CFG-1 transport: dio `GET {configBaseUrl}/config/<app>`.
final Provider<core.ConfigTransport> configTransportProvider =
    Provider<core.ConfigTransport>(
      (ref) => DioConfigTransport(configBaseUrl: AppConfig.configBaseUrl),
    );

/// CFG-1 loader: network → last-good cache → the compiled-in default above.
final Provider<core.ConfigLoader> configLoaderProvider =
    Provider<core.ConfigLoader>(
      (ref) => core.ConfigLoader(
        transport: ref.watch(configTransportProvider),
        cache: core.ConfigCache(
          seed: <String, core.AppConfig>{AppConfig.appId: kAppDefaultConfig},
        ),
      ),
    );

/// Runtime config for this app, resolved at launch. Offline-safe: falls back to
/// the compiled-in default, so it resolves even with no network. Demo/test
/// builds (backend not live) skip the network entirely so widget tests stay
/// hermetic (no `pumpAndSettle` hang on a real request).
final FutureProvider<core.AppConfig> appConfigProvider =
    FutureProvider<core.AppConfig>((ref) async {
      final core.ConfigLoader loader = ref.watch(configLoaderProvider);
      // NOT isBackendLive — the config service is not the identity service.
      // See AppConfig.remoteConfigEnabled for why they are separate flags.
      if (!AppConfig.remoteConfigEnabled) {
        return loader.peek(AppConfig.appId) ?? kAppDefaultConfig;
      }
      final core.Result<core.AppConfig> r = await loader.load(AppConfig.appId);
      return r.fold(
        (core.AppConfig c) => c,
        (core.Failure _) => loader.peek(AppConfig.appId) ?? kAppDefaultConfig,
      );
    });

/// The running app version (e.g. "1.2.0"), or null when it can't be determined
/// (widget tests / an unsupported platform) — in which case force-update fails
/// OPEN. Resilient: a plugin error resolves to null, never throws.
final FutureProvider<String?> packageVersionProvider = FutureProvider<String?>((
  ref,
) async {
  try {
    return (await PackageInfo.fromPlatform()).version;
  } catch (_) {
    return null;
  }
});

/// Whether the running version is below the CFG-1 `min_supported_version` floor
/// (the force-update kill-switch). Fails OPEN (false) while either the config or
/// the version is still resolving, so a slow load never blocks the app behind
/// the update wall.
final Provider<bool> mustForceUpdateProvider = Provider<bool>((ref) {
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  final String? version = ref.watch(packageVersionProvider).valueOrNull;
  if (cfg == null || version == null) return false;
  return core.mustForceUpdate(version, cfg.minSupportedVersion);
});

// ── Persistence (G-2): concrete plugin adapters from platform_storage; core
//    stays pure Dart. Async — the stores create off the platform. ──

/// Non-secret key-value store (prefs, the flag install-id, last-good config).
final FutureProvider<core.KeyValueStore> keyValueStoreProvider =
    FutureProvider<core.KeyValueStore>((ref) => PrefsKeyValueStore.create());

/// Secure store (auth tokens, the entitlement cache).
final Provider<core.SecureStore> secureStoreProvider =
    Provider<core.SecureStore>((ref) => FlutterSecureStore());

const String _installIdKey = 'nikatru.install_id';

/// A stable, persisted per-install id for deterministic feature-flag bucketing.
/// Generated once (secure random), then the same id returns on every launch so a
/// device's rollout decision never changes underfoot.
final FutureProvider<String> installIdProvider = FutureProvider<String>((
  ref,
) async {
  final core.KeyValueStore kv = await ref.watch(keyValueStoreProvider.future);
  final String? existing = await kv.read(_installIdKey);
  if (existing != null && existing.isNotEmpty) return existing;
  final String id = _generateInstallId();
  await kv.write(_installIdKey, id);
  return id;
});

/// Resolved feature flags for this install: `AppConfig.flags` (rollout percents)
/// bound to the persisted install id. Callers ask `.isOn('flag')`.
final FutureProvider<core.FeatureFlags> featureFlagsProvider =
    FutureProvider<core.FeatureFlags>((ref) async {
      final core.AppConfig cfg = await ref.watch(appConfigProvider.future);
      final String id = await ref.watch(installIdProvider.future);
      return core.FeatureFlags(rollouts: cfg.flags, stableId: id);
    });

/// The offline entitlement cache (SecureStore-backed): a paid user stays
/// unlocked across restarts; honours expires_at + a grace window (ADR 005).
final Provider<core.EntitlementCache> entitlementCacheProvider =
    Provider<core.EntitlementCache>(
      (ref) => core.EntitlementCache(store: ref.watch(secureStoreProvider)),
    );

String _generateInstallId() {
  final Random rng = Random.secure();
  final List<int> bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  return bytes.map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
}
