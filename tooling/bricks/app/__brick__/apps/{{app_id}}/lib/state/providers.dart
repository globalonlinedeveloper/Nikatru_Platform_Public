import 'dart:math';

// ThemeMode only — this file is state wiring, not UI, and a narrow `show` keeps
// it that way. Without the import the stamped app fails to compile, which no
// amount of analyzing the TEMPLATE would reveal: the template is mustache, not
// valid Dart, so only a real stamp can catch it. [pipeline C-16]
import 'package:flutter/material.dart' show ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/app_config.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';

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

/// Local notifications (G-25): the plugin-backed impl of core's
/// [core.NotificationService] seam, or a no-op where no plugin exists.
///
/// [pipeline C-2/C-7] Platform reality is DECLARED, not assumed — see
/// [NotificationCapabilities]: Android/iOS/macOS show and schedule; Linux shows
/// but cannot schedule; Windows does neither on the pinned 17.x; Web has no
/// plugin at all. Unsupported calls degrade to a safe no-op, so a caller never
/// crashes on a platform that cannot do the thing — but it also never silently
/// believes a reminder was set. Check `capabilities` before promising the user.
///
/// ⚠️ Any stamped app that ships Android MUST enable core-library desugaring
/// (two lines in its Gradle config) — flutter_local_notifications requires it.
final Provider<core.NotificationService> notificationServiceProvider =
    Provider<core.NotificationService>(
      (ref) => createLocalNotificationService(),
    );

const String _themeModeKey = 'nikatru.theme_mode';

/// The user's light/dark/system choice, persisted ([pipeline C-14] via C-16).
///
/// WHY A PERSISTED OVERRIDE AT ALL: `MaterialApp` already defaults to
/// `ThemeMode.system`, so a stamped app follows the OS setting with no code. What
/// was missing is a user who wants dark while their phone is light — and the DoD
/// requires `theme` + `darkTheme` + a **persisted** themeMode.
///
/// Starts at [ThemeMode.system] and hydrates from storage in the background
/// rather than awaiting it, so first paint never blocks on disk. The stored value
/// arrives a frame or two later, which is invisible and is the same fail-open
/// posture the force-update gate uses.
class ThemeModeController extends Notifier<ThemeMode> {
  /// Whether the user has made an explicit choice this session.
  ///
  /// 🔴 LOAD-BEARING, and found by the property test on its very first run.
  /// Hydration is async, so a user tapping Dark during launch could be overtaken
  /// by the disk read completing afterwards and resetting them to the stored
  /// value — the setting visibly snapping back. Hydration must never overwrite a
  /// live choice.
  bool _userChose = false;

  @override
  ThemeMode build() {
    // Deliberately not awaited: see the class doc.
    _hydrate();
    return ThemeMode.system;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final ThemeMode stored = _decode(await kv.read(_themeModeKey));
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ keep following the OS. Never throw at launch.
    }
  }

  /// Persist and apply a new choice. Applied in memory first so the UI responds
  /// immediately even if the write is slow or fails.
  Future<void> set(ThemeMode mode) async {
    _userChose = true;
    state = mode;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_themeModeKey, _encode(mode));
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
  }

  static String _encode(ThemeMode m) => switch (m) {
    ThemeMode.light => 'light',
    ThemeMode.dark => 'dark',
    ThemeMode.system => 'system',
  };

  static ThemeMode _decode(String? raw) => switch (raw) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
}

final NotifierProvider<ThemeModeController, ThemeMode> themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);

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
