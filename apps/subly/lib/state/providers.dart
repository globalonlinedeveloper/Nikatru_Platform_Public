import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../core/config/app_config.dart';
import '../data/api/api_client.dart';
import '../data/api/dio_api_client.dart';
import '../data/api/seed_api_client.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import '../data/auth/auth_models.dart';
import '../data/auth/auth_repository.dart';
import '../data/auth/mock_auth_repository.dart';
import '../data/auth/supabase_auth_repository.dart';
import '../data/subscriptions/subscription_repository.dart';
import '../services/notifications/notification_service.dart';

/// Auth: real Supabase when configured, else the in-memory mock (demo mode).
final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
      (ref) => AppConfig.isSupabaseConfigured
          ? SupabaseAuthRepository()
          : MockAuthRepository(),
    );

/// Reactive auth stream (drives sign-in UI; router uses its own refresh bridge).
final StreamProvider<AuthUser?> authStateProvider = StreamProvider<AuthUser?>(
  (ref) => ref.watch(authRepositoryProvider).authStateChanges(),
);

/// CFG-1 transport: dio `GET {configBaseUrl}/config/<app>`.
final Provider<core.ConfigTransport> configTransportProvider =
    Provider<core.ConfigTransport>(
      (ref) => DioConfigTransport(configBaseUrl: AppConfig.configBaseUrl),
    );

/// Subly's compiled-in default runtime config.
///
/// [pipeline C-10] Lives HERE, not in `packages/core`. It used to sit in core's
/// `kDefaultConfigs` as a hardcoded `'subly'` entry, exported from the barrel
/// every stamped app imports — so app #7 shipped knowing app #1's feature names.
/// Core must not know any app's name.
///
/// 🔒 MIRRORS the server's authoritative defaults in
/// `services/platform/src/config.ts` `DEFAULT_CONFIGS` — keep the two in
/// lockstep. `test/config_default_test.dart` pins these values so drift fails CI
/// (that contract test moved here from core along with the values).
const core.AppConfig kSublyDefaultConfig = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: 'https://api.nikatru.com/v1',
  features: <String, bool>{'renewals': true, 'budgets': true, 'exports': true},
  paywall: core.PaywallConfig(enabled: false),
  contentPack: null,
  copy: <String, String>{},
  minSupportedVersion: '1.0.0',
);

/// CFG-1 loader: network -> last-good cache -> this app's compiled-in default.
///
/// The seed is load-bearing, not decoration: [appConfigProvider] THROWS when the
/// loader cannot produce a config, so without it a network failure — or any demo
/// build — would crash at launch.
final Provider<core.ConfigLoader> configLoaderProvider =
    Provider<core.ConfigLoader>(
      (ref) => core.ConfigLoader(
        transport: ref.watch(configTransportProvider),
        cache: core.ConfigCache(
          seed: <String, core.AppConfig>{AppConfig.appId: kSublyDefaultConfig},
        ),
      ),
    );

/// Runtime config for this app, resolved at launch. Offline-safe: the loader
/// falls back to the compiled-in default, so this resolves even with no network.
/// Demo/test builds (no backend configured) skip the network entirely and use
/// the bundled default, keeping widget tests hermetic.
final FutureProvider<core.AppConfig> appConfigProvider =
    FutureProvider<core.AppConfig>((ref) async {
      final core.ConfigLoader loader = ref.watch(configLoaderProvider);
      if (!AppConfig.isApiConfigured) {
        return loader.peek(AppConfig.appId) ??
            (throw StateError('no config for ${AppConfig.appId}'));
      }
      final core.Result<core.AppConfig> r = await loader.load(AppConfig.appId);
      return r.fold(
        (core.AppConfig c) => c,
        (core.Failure f) =>
            loader.peek(AppConfig.appId) ??
            (throw StateError('no config for ${AppConfig.appId}')),
      );
    });

/// API: real Worker via Dio when configured, else the seed client (demo mode).
/// The Dio base URL comes from the CFG-1 `api_base_url` (runtime, swappable with
/// no store release), falling back to the compile-time define until it resolves.
final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((ref) {
  if (!AppConfig.isApiConfigured) return SeedApiClient();
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  final String baseUrl = cfg?.apiBaseUrl ?? '${AppConfig.apiBaseUrl}/v1';
  return DioApiClient(
    baseUrl: baseUrl,
    tokenProvider: ref.watch(authRepositoryProvider).currentAccessToken,
  );
});

final Provider<SubscriptionRepository> subscriptionRepositoryProvider =
    Provider<SubscriptionRepository>(
      (ref) => SubscriptionRepository(ref.watch(apiClientProvider)),
    );

final Provider<NotificationService> notificationServiceProvider =
    Provider<NotificationService>((ref) => NotificationService.instance);

// ── `purchasesServiceProvider` WAS HERE, AND IT IS GONE ON PURPOSE ──────────
// [pipeline 5]M-11/M-13/M-15, [ADR 026]. `lib/services/purchases/` held a
// RevenueCat-shaped stub: a `PurchasesService` whose `purchase()` returned
// `success: false`, whose `restore()` returned `false`, and whose offerings were
// the hardcoded literals `$2.99` and `$24.99` — prices the owner replaced on
// 2026-07-27 and which nothing could contradict, because a hardcoded string is
// consistent with itself forever. The provider had zero consumers.
//
// It was REPLACED, not extended: its `PurchaseResult{isPro}` shape hands the
// unlock decision to the client, and this rail's whole design is that only the
// server grants. The real path now lives in `packages/purchases` and is wired by
// the brick, so every stamped app inherits it. See knowledge/decisions/
// 026-purchases-adapter-replaces-revenuecat-stub.md.
