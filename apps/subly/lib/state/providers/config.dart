// SECTION A of the spine — CFG-1 runtime config resolution and the offline
// signal it produces. Re-exported from `../providers.dart`; import that.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';

// ═════════════════════════════════════════════════════════════════════════════
// SECTION A · CFG-1 RUNTIME CONFIG
// ═════════════════════════════════════════════════════════════════════════════

/// Compiled-in default runtime config for THIS app. core's `kDefaultConfigs`
/// only knows the reference apps, so a freshly-stamped app seeds its own default
/// — that's what makes config resolution offline-safe here (network → last-good
/// → this default).
///
/// 🔴 THE NAME IS THE CHASSIS'S; THE VALUES ARE SUBLY'S, AND BOTH HALVES ARE
/// MEASURED. The chassis calls this `kAppDefaultConfig` and the stamped
/// `test/config_contract_test.dart` reads it by that name, so the name had to
/// move. The chassis's VALUES did not, because they are wrong for this app:
/// `services/platform/src/app-config-data.json` serves `subly`
/// `features: {renewals, budgets, exports}` and `content_pack: null`, and
/// `test/config_default_test.dart` pins exactly that against the server. The
/// chassis template's `features: {}` + `contentPack: 'https://packs…/latest'`
/// would put the client and the server into disagreement on the app's own
/// launch path.
///
/// 🔒 MIRRORS the server's authoritative defaults in
/// `services/platform/src/app-config-data.json` (`defaults` overlaid with
/// `apps.subly`), surfaced through `services/platform/src/config.ts`
/// `DEFAULT_CONFIGS` — keep the two in lockstep. `test/config_default_test.dart`
/// pins these values so drift fails CI.
const core.AppConfig kAppDefaultConfig = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: 'https://api.nikatru.com/v1',
  features: <String, bool>{'renewals': true, 'budgets': true, 'exports': true},
  paywall: core.PaywallConfig(enabled: false),
  contentPack: null,
  copy: <String, String>{},
  minSupportedVersion: '1.0.0',
);

/// 🪦 COMPAT ALIAS — the pre-re-stamp name, kept for ONE increment.
///
/// `tooling/ci/assert-analytics-contract.mjs:318` pins
/// `apps/subly/test/config_default_test.dart` by the marker string
/// `'kSublyDefaultConfig equals the server contract values'`, so renaming the
/// symbol AND editing that test in the same increment would mean editing a guard
/// to make a merge pass — the one move this repo's verification discipline says
/// never to make casually. The alias makes the rename a NO-OP for every existing
/// consumer instead, and because it is the same object the two names cannot
/// drift.
///
/// RETIREMENT (a separate, purely mechanical increment): re-point
/// `test/config_default_test.dart` (3 uses at :21, :39, :50) and the guard's
/// marker string together, then delete this line.
const core.AppConfig kSublyDefaultConfig = kAppDefaultConfig;

/// 🔴 [pipeline C-13] THE OFFLINE SIGNAL — TRUE ONLY AFTER A REQUEST HAS FAILED.
///
/// ⚠️ DRIVEN BY A FAILED REQUEST, NEVER BY A CONNECTIVITY PLUGIN. Knowing the
/// radio is on says nothing about whether the API is reachable: a captive
/// portal, a DNS failure, an origin outage and airplane mode all look different
/// to `connectivity_plus` and identical to the user. The app already knows when
/// a request failed.
///
/// Starts FALSE and only ever becomes true because a real fetch returned an
/// error, so a launch that never touches the network never accuses itself of
/// being offline.
class NetworkReachabilityController extends Notifier<bool> {
  @override
  bool build() => false;

  /// Reported by the config transport on EVERY fetch, in both directions — a
  /// banner that appears on the first failure and then never leaves is worse
  /// than none, because the user learns to ignore it.
  void report({required bool unreachable}) {
    if (state != unreachable) state = unreachable;
  }
}

/// Whether the last real request this app made could not be reached.
final NotifierProvider<NetworkReachabilityController, bool>
networkUnreachableProvider =
    NotifierProvider<NetworkReachabilityController, bool>(
      NetworkReachabilityController.new,
    );

/// CFG-1 transport: dio `GET {configBaseUrl}/config/<app>`.
///
/// Decorated so the outcome of that fetch — the one network call every stamped
/// app makes at launch — becomes the offline signal above. The decorator is
/// where the signal has to live: `ConfigLoader.load` deliberately SWALLOWS a
/// transport failure and answers `ok(lastGoodConfig)`, which is the right
/// behaviour for config resolution and the reason the failure is invisible to
/// every consumer further up.
final Provider<core.ConfigTransport> configTransportProvider =
    Provider<core.ConfigTransport>(
      (ref) => core.ReportingConfigTransport(
        inner: DioConfigTransport(configBaseUrl: AppConfig.configBaseUrl),
        report: (bool unreachable) => ref
            .read(networkUnreachableProvider.notifier)
            .report(unreachable: unreachable),
      ),
    );

/// CFG-1 loader: network → last-good cache → the compiled-in default above.
///
/// The seed is load-bearing, not decoration: core's `kDefaultConfigs` is empty,
/// so without it a network failure — or any demo build — resolves to nothing.
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
/// builds skip the network entirely so widget tests stay hermetic (no
/// `pumpAndSettle` hang on a real request).
///
/// 🔄 TWO CHASSIS CHANGES ADOPTED HERE, both strictly safer than the live shape:
///   · the gate is `remoteConfigEnabled`, NOT `isApiConfigured` — the config
///     service is not the identity service, and `SKIP_REMOTE_CONFIG=true` is
///     what lets an `integration_test` run supply identity defines without
///     reaching the config host;
///   · the miss path answers `kAppDefaultConfig` instead of THROWING. With the
///     seed present `peek` never misses, so the two are observationally
///     identical today — but a `StateError` at launch is not a failure mode this
///     app should be one dropped seed away from.
final FutureProvider<core.AppConfig> appConfigProvider =
    FutureProvider<core.AppConfig>((ref) async {
      final core.ConfigLoader loader = ref.watch(configLoaderProvider);
      if (!AppConfig.remoteConfigEnabled) {
        return loader.peek(AppConfig.appId) ?? kAppDefaultConfig;
      }
      final core.Result<core.AppConfig> r = await loader.load(AppConfig.appId);
      return r.fold(
        (core.AppConfig c) => c,
        (core.Failure _) => loader.peek(AppConfig.appId) ?? kAppDefaultConfig,
      );
    });
