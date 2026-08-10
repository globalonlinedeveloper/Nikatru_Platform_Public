// ─────────────────────────────────────────────────────────────────────────────
// SUBLY STATE SPINE ([ADR 037] productization, re-stamp).
//
// 🔴 READ THIS BEFORE EDITING. This file is the CHASSIS SPINE (the brick's
// `lib/state/providers.dart`) with Subly's own app state merged UNDER it — not
// over it. The rule the merge followed, in one line:
//
//     the chassis owns the plumbing; Subly owns its product.
//
// Three things are structural rather than stylistic, and undoing any of them
// re-creates a measured defect:
//
//  1. 🔴 `analytics_providers.dart` DOES NOT MOVE, AND IS RE-EXPORTED FROM HERE.
//     Ten symbols exist in BOTH the chassis spine and Subly's
//     `lib/state/analytics_providers.dart`. Eight files in this app import BOTH
//     files, so declaring them twice is a hard compile error ("the name X is
//     defined in the libraries …"), not a style problem. The file itself cannot
//     move: `tooling/ci/assert-seams-wired.mjs:481` and
//     `tooling/ci/assert-policy-archive.mjs:64` BOTH read
//     `kPrivacyPolicyVersion` out of that exact path with a regex, so a
//     re-export shim there fails two guards. The fix is the other direction —
//     this file imports it and re-exports the ten, so both import paths resolve
//     to ONE declaration and Dart reports no ambiguity.
//
//  2. 🔴 THE DELETION CALL STAYS POINTED AT THE SHARED PLATFORM WORKER.
//     The chassis sends `requestServerDeletion` to `restClientProvider`
//     (this app's own API). Subly sends it to [platformRestClientProvider] —
//     the SHARED Worker — because that Worker is the erasure ENTRY POINT and
//     owns the ordering (precondition → platform_db → relay to subly-api →
//     identity LAST). Taking the chassis version here would have the client own
//     an ordering it must not own. [ADR 027]. Live version kept verbatim.
//
//  3. 🔴 `notificationServiceProvider` IS THE CHASSIS ONE (`core.NotificationService`).
//     Subly's own `flutter_local_notifications` fork moved to
//     [sublyNotificationServiceProvider]. The name had to go to the chassis: the
//     stamped `RemindersEnabledController` below reads it three times, the
//     stamped `chassis_properties_test.dart` overrides it by that name, and
//     `tooling/ci/assert-stamp-properties.mjs:1083` maps it to the
//     `reminder-intent-persisted` property — a mapping `apps/subly` is exempt
//     from today (`EXEMPT_APPS`, :104) and will NOT be after Phase 5.
//
// ⚠️ THE CONFIG IMPORT IS `../core/app_config.dart` — the de-duplicated union
// at the STAMP's path. `../core/config/app_config.dart` no longer exists.
// ─────────────────────────────────────────────────────────────────────────────

import 'dart:async';
import 'dart:convert';

// kIsWeb + defaultTargetPlatform name the running platform for the analytics
// envelope. NOT `dart:io`'s `Platform`: merely IMPORTING `dart:io` makes the web
// build fail to compile, and web is one of the six targets every app here ships.
import 'package:flutter/foundation.dart'
    show
        ChangeNotifier,
        Listenable,
        TargetPlatform,
        defaultTargetPlatform,
        kIsWeb;
// ThemeMode + Locale only — this file is state wiring, not UI, and a narrow
// `show` keeps it that way. [pipeline C-16]
import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
// ⚠️ `show AuthCapabilities` IS LOAD-BEARING, not tidiness. This package also
// exports a `SupabaseAuthRepository`, and so does Subly's own
// `../data/auth/supabase_auth_repository.dart` (imported below, and the one this
// app actually constructs — see [authRepositoryProvider]). An unnarrowed import
// makes that name ambiguous and the file will not compile.
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthCapabilities, InMemoryAuthRepository;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_notifications/nikatru_notifications.dart';
// `show` for the same class of reason: the barrel also exports
// `PrefsKeyValueStore`, which `analytics_providers.dart` already owns the one
// construction of ([keyValueStoreProvider]). Naming only what this file builds
// keeps that single-source property visible.
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart'
    show FlutterSecureStore, InAppReviewPrompter;
import 'package:package_info_plus/package_info_plus.dart';

import '../core/app_config.dart';
import '../data/api/api_client.dart';
import '../data/api/dio_api_client.dart';
import '../data/api/seed_api_client.dart';
// `auth_models.dart` (AuthUser/AuthSession/AuthFailure) is deliberately NOT
// imported: `auth_repository.dart` is the F0-4 shim that already re-exports all
// three from `packages/core`, so a second import is a second path to one
// declaration and the analyzer reports it.
import '../data/auth/auth_repository.dart';
import '../data/auth/supabase_auth_repository.dart';
import '../data/subscriptions/subscription_repository.dart';
import '../services/notifications/notification_service.dart';
import 'analytics_providers.dart';

/// 🔴 THE AMBIGUITY FIX — see note 1 in the header. These ten names are declared
/// by the chassis spine AND by `analytics_providers.dart`. They are declared
/// ONCE, over there, and surfaced here so that a file importing either path
/// reaches the same declaration.
///
/// The list is EXPLICIT rather than a blanket `export 'analytics_providers.dart';`
/// so that the set is auditable: if the chassis grows an eleventh colliding
/// symbol, this list is where the collision has to be acknowledged rather than
/// absorbed. `kInstallIdKey` is deliberately NOT here — it is Subly-only and
/// reachable through the direct import that every live consumer already
/// carries. (`backendLiveProvider` used to be named alongside it; it was deleted
/// 2026-08-10 with the `ConsentGate` that was its only reader.)
export 'analytics_providers.dart'
    show
        analyticsConsentProvider,
        analyticsEnabledProvider,
        analyticsProvider,
        applyConsentDecision,
        consentControllerProvider,
        consentDecidedProvider,
        consentTransportProvider,
        eventTransportProvider,
        installIdProvider,
        kPrivacyPolicyVersion,
        keyValueStoreProvider,
        recordAnalyticsConsent;

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

// ═════════════════════════════════════════════════════════════════════════════
// SECTION B · THE CONTENT-PACK RAIL ([pipeline 7]P-9 · [8]K-9 · [2]C-1)
//
// These three providers are the consumer half. They are deliberately separate
// so a test can replace the SOURCE (the bytes) without replacing the LOADER
// (the verification) — swapping the loader would assert that a fake returns
// what the fake was told to return.
//
// ⚠️ SUBLY'S POINTER IS `null` (see [kAppDefaultConfig]), so this rail is
// dormant IN THIS APP by configuration, not by wiring — and the pointer comes
// from the RESOLVED config, so the server can turn it on without a release.
// `test/chassis_properties_test.dart` proves the open path by overriding
// `appConfigProvider` with a pointer, not by relying on the compiled default.
// ═════════════════════════════════════════════════════════════════════════════

/// The Ed25519 verifier this build trusts (ADR 016).
///
/// Injected rather than defaulted inside the loader so the key pinning is
/// visible at the app layer — and so a test can prove the OPEN path with a
/// throwaway keypair. Production must never narrow or widen the pinned map.
final Provider<core.PackVerifier> packVerifierProvider =
    Provider<core.PackVerifier>((ref) => core.Ed25519PackVerifier());

/// Where pack bytes come from, or null when this app is configured with no pack.
///
/// Derived from the RESOLVED config rather than from [AppConfig], so the server
/// decides which pack a shipped binary reads.
final Provider<core.ContentPackSource?> contentPackSourceProvider =
    Provider<core.ContentPackSource?>((ref) {
      final core.AppConfig cfg =
          ref.watch(appConfigProvider).value ?? kAppDefaultConfig;
      final String? pointer = cfg.contentPack;
      if (pointer == null || pointer.isEmpty) return null;
      return DioContentPackSource(packBaseUrl: pointer);
    });

/// The loader itself — CONSTRUCTED here, which is the thing that had never
/// happened anywhere outside a test.
final Provider<core.ContentPackLoader> contentPackLoaderProvider =
    Provider<core.ContentPackLoader>(
      (ref) =>
          core.ContentPackLoader(verifier: ref.watch(packVerifierProvider)),
    );

/// The pack this app is currently serving, or null when it has none.
///
/// 🔴 NULL WHEN THE POINTER IS NULL, AND NULL AGAIN WHEN IT FLIPS TO ONE THAT
/// DOES NOT VERIFY. Both matter, and the second is the one a takedown depends
/// on ([pipeline 8]K-9): retiring a pack has to actually stop it being served,
/// within hours and without a store release. `ref.watch` on the config is what
/// makes that true — the pointer changing re-runs this provider.
///
/// `expectPackId` is the app's own id: the loader refuses a pack that is
/// perfectly valid and simply not ours.
final FutureProvider<core.ContentPack?> contentPackProvider =
    FutureProvider<core.ContentPack?>((ref) async {
      final core.ContentPackSource? source = ref.watch(
        contentPackSourceProvider,
      );
      if (source == null) return null;
      final core.Result<core.ContentPack> r = await ref
          .watch(contentPackLoaderProvider)
          .load(expectPackId: AppConfig.appId, remote: source);
      // A failed load is NOT an error the app shows. The pack is optional
      // content; the app must run without it. What must never happen is a
      // failed load being served as though it succeeded.
      return r.fold((core.ContentPack p) => p, (core.Failure _) => null);
    });

// ═════════════════════════════════════════════════════════════════════════════
// SECTION C · FORCE-UPDATE KILL-SWITCH
// ═════════════════════════════════════════════════════════════════════════════

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

// ═════════════════════════════════════════════════════════════════════════════
// SECTION D · PERSISTENCE (G-2)
//
// ⚠️ `keyValueStoreProvider` AND `installIdProvider` ARE NOT DECLARED HERE.
// They live in `analytics_providers.dart` and are re-exported at the top of this
// file. Declaring a second pair would give this app two install ids and two
// prefs handles, which is the precise failure `analytics_providers.dart:27-34`
// records: two independently minted ids make the rollout bucket and the
// analytics cohort impossible to join, and it cannot be repaired across installs
// already in the field.
// ═════════════════════════════════════════════════════════════════════════════

/// Secure store (auth tokens, the entitlement cache).
final Provider<core.SecureStore> secureStoreProvider =
    Provider<core.SecureStore>((ref) => FlutterSecureStore());

/// Resolved feature flags for this install: the resolved config's rollout
/// percents bound to the persisted install id. Callers ask `.isOn('flag')`.
///
/// 🔴 THE TYPE IS [core.ObservedFeatureFlags], AND IT IS NOT AN UPGRADE — it is
/// the only way a rollout is measurable at all ([pipeline 11]E-12). A raw
/// `core.FeatureFlags` decides on/off locally and tells nobody, so the treatment
/// group can only ever be re-derived later from a rollout percentage that has
/// since moved: percents are not versioned, so once ramped the past is gone.
///
/// ⚠️ The `core.FeatureFlags` construction MUST stay inside the wrapper's
/// argument list. `tooling/ci/assert-flag-exposure.mjs` scans `apps/` (subly is
/// NOT exempt there) and fails the build on a raw one escaping.
final FutureProvider<core.ObservedFeatureFlags> featureFlagsProvider =
    FutureProvider<core.ObservedFeatureFlags>((ref) async {
      final core.AppConfig cfg = await ref.watch(appConfigProvider.future);
      final String id = await ref.watch(installIdProvider.future);
      return core.ObservedFeatureFlags(
        flags: core.FeatureFlags(rollouts: cfg.flags, stableId: id),
        analytics: await ref.watch(analyticsProvider.future),
      );
    });

/// The offline entitlement cache (SecureStore-backed): a paid user stays
/// unlocked across restarts; honours expires_at + a grace window (ADR 005).
/// Consumed by `lib/state/money_providers.dart`.
final Provider<core.EntitlementCache> entitlementCacheProvider =
    Provider<core.EntitlementCache>(
      (ref) => core.EntitlementCache(store: ref.watch(secureStoreProvider)),
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION E · ANALYTICS ENVELOPE + TRANSPORT HOSTS
//
// 🔴 WHAT IS NOT HERE, AND WHY. The chassis spine also declares
// `kPrivacyPolicyVersion`, `consentControllerProvider`, `analyticsConsentProvider`,
// `consentDecidedProvider`, `consentTransportProvider`, `applyConsentDecision`,
// `recordAnalyticsConsent` and `analyticsProvider`. Every one of them already
// exists in `analytics_providers.dart` — which the guards anchor — so they are
// re-exported, not re-declared.
//
// `logEvent` is deliberately NOT carried, and that is a decision with a date
// on it: `analytics_providers.dart:244-250` records it being DELETED from this
// app on 2026-08-01 for having zero call sites, because "a second, never-called
// path to the analytics rail inflates apparent coverage and is exactly what
// `assert-seams-wired` exists to stop being mistaken for a wiring".
// `logLaunchLifecycle` IS carried (below) — its one caller arrived with the
// P2.6a `app.dart` merge (`AnalyticsGate`'s granted branch), and the funnel's
// `onLaunch()` was deleted in the same increment so there is exactly ONE
// launch path, exactly one `app_open` per launch.
// ═════════════════════════════════════════════════════════════════════════════

/// Emit the launch trio — `first_launch` (once per INSTALL, ever), `app_open`
/// (every launch), `return_visit{days_since_last}` — via the chassis
/// [core.AnalyticsLifecycle], which owns the rule and the persistence so they
/// are ONE implementation for fifty stamps, testable without a widget tree.
/// Uses the same storage seam as everything else ([keyValueStoreProvider]) and
/// the SAME keys Subly's old `AnalyticsFunnel.onLaunch` used
/// (core/analytics_lifecycle.dart:9,:14), so an existing install does not
/// re-emit `first_launch` after the P2.6a swap.
///
/// ⚠️ CONSENT IS THE CALLER'S JOB, and its only caller is `AnalyticsGate`'s
/// granted branch. Do not call this anywhere a consent decision has not
/// already been granted — firing pre-consent burned the install's only
/// `first_launch` on an event the fail-closed recorder then discarded.
Future<void> logLaunchLifecycle(WidgetRef ref) async {
  final core.Analytics analytics = await ref.read(analyticsProvider.future);
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  await core.AnalyticsLifecycle(analytics: analytics, store: kv).onLaunch();
}

/// The SHARED platform Worker: analytics ingest, the consent artifact, and the
/// money rail's entitlement + cancellation reads ([ADR 020]).
///
/// Deliberately NOT [AppConfig.apiBaseUrl] and deliberately NOT per-app — every
/// app in the portfolio posts to the same host, which is what makes one query
/// answer "is the portfolio working" instead of six.
///
/// ⚠️ SAME VALUE, SAME DEFINE as `AppConfig.platformBaseUrl`, which
/// `analytics_providers.dart` reads. The duplication is the chassis's shape and
/// is carried because `lib/state/money_providers.dart` reads THIS name — see
/// MANIFEST.md §7 for the convergence item.
const String kPlatformBaseUrl = String.fromEnvironment(
  'PLATFORM_BASE_URL',
  defaultValue: 'https://platform.nikatru.com',
);

/// The marketing version stamped on events, consent artifacts and crash reports.
///
/// Injected at BUILD time rather than read from `package_info_plus`, and that is
/// not a shortcut — it was measured. The plugin needs a platform round trip that
/// does NOT resolve inside a widget test's fake clock, so routing the consent
/// write through it made `recordAnalyticsConsent` hang forever. A version string
/// must never be able to block a consent decision. It also resolves on web,
/// where [packageVersionProvider] can legitimately return null.
const String kAnalyticsAppVersion = AppConfig.appVersion;

/// Which of the six platforms this build runs on, for the analytics envelope.
///
/// 🔴 `defaultTargetPlatform`, NOT `dart:io`'s `Platform`. See MANIFEST.md §8 —
/// `analytics_providers.dart:1` still imports `dart:io`, and whether that is
/// survivable on the web target is an OPEN QUESTION this merge does not settle.
String analyticsPlatformName() {
  if (kIsWeb) return 'web';
  return switch (defaultTargetPlatform) {
    TargetPlatform.android => 'android',
    TargetPlatform.iOS => 'ios',
    TargetPlatform.macOS => 'macos',
    TargetPlatform.windows => 'windows',
    TargetPlatform.linux => 'linux',
    TargetPlatform.fuchsia => 'fuchsia',
  };
}

/// THE OUTER SWITCH, checked before consent is even considered.
///
/// It is a provider rather than a bare `AppConfig.isBackendLive` read precisely
/// so that "silent by design" can be told apart from "broken": the chassis
/// property test overrides it to true and drives a real event all the way to a
/// transport.
///
// ═════════════════════════════════════════════════════════════════════════════
// SECTION F · IDENTITY ([pipeline C-15] · [ADR 027])
// ═════════════════════════════════════════════════════════════════════════════

/// Auth: real Supabase when configured, else the in-memory mock (demo mode).
///
/// 🔴 KEPT VERBATIM FROM LIVE — the chassis version of this provider is the one
/// thing in the whole spine that must NOT win. See note 2 in the file header.
///
/// 🔴 `requestServerDeletion` IS WHAT MAKES "DELETE ACCOUNT" A BUTTON THAT
/// DELETES. Without it `deleteAccount()` took an unconditional refusal branch —
/// the user was signed out and never deleted — and the app shipped no control at
/// all because there was nothing honest to point one at. [ADR 027].
///
/// It goes to [platformRestClientProvider], NOT to [apiClientProvider] and NOT
/// to the chassis's [restClientProvider], and it stays ONE call. The shared
/// platform Worker is the erasure ENTRY POINT: it checks the service-role
/// precondition, empties `platform_db`, relays to each app's own
/// `DELETE /v1/account` (subly-api's, since 2026-08-04), and deletes the
/// identity LAST. That ordering is the whole safety property, and the client
/// must not own it — two calls from here could interleave with the shared
/// Worker's 501 and destroy this app's data for an account that then survives.
///
/// `ref.read` INSIDE the closure, never at build time: the REST client's token
/// provider reads THIS provider, so resolving it out here would be a cycle.
/// Deletion happens long after both exist.
///
/// ⚠️ AND THAT ALONE IS NOT ENOUGH — see [platformRestClientProvider]. Moving
/// the read late fixes the BUILD ORDER; Riverpod's cycle check is about the
/// dependency GRAPH, and it runs on every `ref.read`, however late.
///
/// 🔴 THE PREDICATE IS `isBackendLive`, AND IT MUST MATCH `main.dart`'S.
/// `main.dart` gates `initNikatruAuth` — the call that initialises the Supabase
/// SDK before the first frame — on `AppConfig.isBackendLive`. This provider used
/// to select on `isSupabaseConfigured` alone, so a build carrying SUPABASE_URL /
/// SUPABASE_ANON_KEY but no API_BASE_URL resolved a LIVE `SupabaseAuthRepository`
/// against an SDK nobody had initialised. The router reads this provider through
/// `refreshListenable` while it is being built, so that build died at LAUNCH on
/// `Supabase.instance` — AssertionError in debug, LateInitializationError in
/// release — before a screen rendered, and no widget test could see it because
/// widget tests take no `--dart-define`s. Two predicates for one decision is the
/// bug; there is now one, and `isBackendLive` is it
/// (`isSupabaseConfigured && isApiConfigured`).
final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
      (ref) => AppConfig.isBackendLive
          ? SupabaseAuthRepository(
              requestServerDeletion: () =>
                  requestAccountDeletion(ref.read(platformRestClientProvider)),
            )
          : InMemoryAuthRepository(),
    );

/// The authenticated client for the SHARED platform Worker (`/v1/...`).
///
/// Subly's other transports already talk to the platform host (consent and
/// events), but each builds its own dio and none of them carries a bearer
/// token, because neither call is authenticated. Erasure is, so it needs the
/// shared [RestClient] — the one place the `Authorization` header is attached.
/// ⚠️ READS `AppConfig.platformBaseUrl`, NOT [kPlatformBaseUrl], and that is
/// deliberate restraint rather than an oversight: `analytics_providers.dart`
/// (which never moves) reads `AppConfig.platformBaseUrl` twice, so P2.5's
/// `AppConfig` union has to keep that member regardless. Re-pointing this line
/// at the chassis constant would change a live file for no behavioural gain —
/// both spellings resolve the same `PLATFORM_BASE_URL` define with the same
/// default. Converging the two names is MANIFEST.md §7's item, on its own.
///
/// 🔴 IT TAKES [authTokenProvider], NOT `ref.watch(authRepositoryProvider)
/// .currentAccessToken`, AND THE DIFFERENCE WAS A DELETE BUTTON THAT NEVER SENT
/// A REQUEST. Measured 2026-08-09 against the live tree: `deleteAccount()` threw
/// `AccountDeletionFailure(unknown)` wrapping a Riverpod `CircularDependencyError`,
/// and Cloudflare's zone analytics recorded ZERO `/v1/account` requests — not
/// even a CORS preflight — for the whole delete leg. Nothing was malformed; the
/// request was never formed.
///
/// The cycle is in the GRAPH, not in the timing. `authRepositoryProvider` does
/// `ref.read(this)` inside its erasure closure; `ref.read` runs
/// `_debugAssertCanDependOn`, which walks the TARGET's ancestors and throws
/// `CircularDependencyError` if it finds the reader. `ref.watch(
/// authRepositoryProvider)` here is exactly that ancestor edge, so the read
/// throws every time, no matter how late it happens. Watching
/// [authTokenProvider] instead breaks the edge — that provider only `ref.read`s
/// the repository, and a `read` registers no dependency — which is why the
/// brick's `restClientProvider` (same two-hop shape, in the brick's own
/// `providers.dart`) has never had
/// this defect. This provider was the one written by hand afterwards.
///
/// ⚠️ IT IS AN ASSERT, SO IT IS DEBUG-ONLY. A `--release` build strips it and
/// deletes accounts fine; every debug run and the whole `flutter drive` E2E
/// (DDC) does not. A defect that only exists where the tests run is still a
/// defect — and it is the reason the one automated proof of erasure could not
/// go green while production looked healthy.
final Provider<RestClient> platformRestClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: '${AppConfig.platformBaseUrl}/v1',
    tokenProvider: ref.watch(authTokenProvider),
  ),
);

/// The bearer token every API call carries. This is the shape [RestClient]
/// takes, which is why it returns a token rather than a session: the HTTP layer
/// has no business knowing about refresh.
///
/// Exposed as a PROVIDER rather than a bare function so a test can read the
/// exact object [restClientProvider] is constructed with. A test that rebuilt an
/// equivalent closure would pass while the client was wired to something else.
final Provider<Future<String?> Function()> authTokenProvider =
    Provider<Future<String?> Function()>(
      (ref) =>
          () => ref.read(authRepositoryProvider).currentAccessToken(),
    );

/// The chassis REST client, authenticated, pointed at THIS APP's own API.
///
/// Distinct from [platformRestClientProvider] (shared platform host) and from
/// [apiClientProvider] (Subly's typed dio client for the same host). Carried
/// because the stamped monetization + auth screens program against it.
///
/// 🔴 A 401 IS NOT PROOF THE SESSION IS GONE, and treating it as proof logged
/// people out. An access token that merely EXPIRED looks identical from the
/// Worker's chair, and expiry is routine — the SDK stops its refresh ticker
/// while the app is paused and restarts it asynchronously on resume, so the
/// first request of the frame after a resume carries a stale token by design.
/// The decision therefore lives in [signOutOnlyIfSessionIsGone], a NAMED
/// function rather than an inline closure precisely so a test can drive it.
final Provider<RestClient> restClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokenProvider: ref.watch(authTokenProvider),
    onUnauthorized: () =>
        signOutOnlyIfSessionIsGone(ref.read(authRepositoryProvider)),
  ),
);

/// What a 401 means, decided in one place.
///
/// Ask the seam for a token first. `currentAccessToken()` refreshes on expiry
/// and returns null ONLY when there is no session or the refresh really failed —
/// which is the one case where signing out is the truthful action. A 401 that
/// survives a good token means the server rejected a LIVE session (revoked, or a
/// permissions problem); that is a failed request, not a reason to destroy local
/// state the user can still use.
Future<void> signOutOnlyIfSessionIsGone(core.AuthRepository auth) async {
  if (await auth.currentAccessToken() == null) {
    await auth.signOut();
  }
}

/// What identity can actually do on THIS platform — declared, not assumed.
/// Ask before promising the user something the platform cannot deliver.
final Provider<AuthCapabilities> authCapabilitiesProvider =
    Provider<AuthCapabilities>((ref) => AuthCapabilities.current());

/// The signed-in user as a STREAM, so a screen showing their details updates
/// when those details change.
///
/// 🔴 SEEDED WITH THE SNAPSHOT, and that is load-bearing.
/// `authStateChanges` emits on CHANGE, so a screen built while the user is
/// already signed in would sit on `AsyncLoading` — and therefore render as
/// signed-out — until the next event, which on a settled session never comes.
final StreamProvider<core.AuthUser?> authUserProvider =
    StreamProvider<core.AuthUser?>((ref) async* {
      final core.AuthRepository auth = ref.watch(authRepositoryProvider);
      yield auth.currentUser;
      yield* auth.authStateChanges();
    });

/// Turns the auth stream into something `GoRouter` will listen to.
///
/// 🔴 [pipeline C-13] WITHOUT THIS, SIGNING IN LEAVES THE USER ON THE FORM.
/// The auth FORM deliberately does not navigate — pushing from both the screen
/// and the redirect guard is how two routes end up racing
/// to be top of the stack — so `redirect` has to be TOLD to re-run. Found
/// 2026-07-29 by driving the form in a widget test rather than by reading the
/// code.
class AuthRefreshNotifier extends ChangeNotifier {
  AuthRefreshNotifier(Stream<core.AuthUser?> changes) {
    _sub = changes.listen((core.AuthUser? _) => notifyListeners());
  }

  late final StreamSubscription<core.AuthUser?> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// The router's refresh signal. One per container, disposed with it.
final Provider<AuthRefreshNotifier> authRefreshProvider =
    Provider<AuthRefreshNotifier>((ref) {
      final AuthRefreshNotifier notifier = AuthRefreshNotifier(
        ref.watch(authRepositoryProvider).authStateChanges(),
      );
      ref.onDispose(notifier.dispose);
      return notifier;
    });

/// 🔴 [13]T-9 — the shared seam, present here for the INBOUND half only.
///
/// Subly's own fork ([sublyNotificationServiceProvider]) still owns every
/// outbound call Subly makes (renewal reminders, the weekly digest). This is the
/// tap channel it has never had, and it is the shared `packages/notifications`
/// adapter rather than a second fork method precisely so there is one
/// registration in the tree, not two.
///
/// 🔴 MUST BE OVERRIDDEN IN `main.dart` WITH THE INSTANCE THAT WAS `init()`ED,
/// and it is NOT the same thing as [notificationServiceProvider] below even
/// though both are `core.NotificationService`. The tap callback is registered by
/// `init()` and delivered on that instance's own stream, so a second,
/// uninitialised instance would expose a stream that is silent forever — working
/// code, no error, no tap. Merging the two providers would do exactly that. The
/// default below is therefore the NO-OP, never a live-looking service.
final Provider<core.NotificationService> notificationTapSourceProvider =
    Provider<core.NotificationService>(
      (ref) => const core.NoOpNotificationService(),
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION G · NOTIFICATIONS + THE REMINDER RAIL
// ═════════════════════════════════════════════════════════════════════════════

/// Local notifications (G-25): the plugin-backed impl of core's
/// [core.NotificationService] seam, or a no-op where no plugin exists.
///
/// 🔴 THIS NAME NOW MEANS THE CHASSIS SERVICE. Subly's own fork kept its
/// behaviour and moved to [sublyNotificationServiceProvider] — see note 3 in the
/// file header for the three pieces of evidence that forced the direction.
///
/// [pipeline C-2/C-7] Platform reality is DECLARED, not assumed — see
/// [NotificationCapabilities]: Android/iOS/macOS show and schedule; Linux shows
/// but cannot schedule; Windows does neither on the pinned 17.x; Web has no
/// plugin at all. Unsupported calls degrade to a safe no-op, so a caller never
/// crashes on a platform that cannot do the thing — but it also never silently
/// believes a reminder was set.
final Provider<core.NotificationService> notificationServiceProvider =
    Provider<core.NotificationService>(
      (ref) => createLocalNotificationService(),
    );

/// 🪦 SUBLY'S FROZEN NOTIFICATION FORK, renamed from `notificationServiceProvider`.
///
/// Behaviour unchanged; only the name moved, because the old name is the
/// chassis's. It stays a separate provider rather than being folded into the
/// chassis one because the two have DIFFERENT INTERFACES — this one exposes
/// `requestPermissions()` (plural), `scheduleWeeklyDigest()` and the renewal
/// scheduling `subscriptions_controller.dart` drives; `core.NotificationService`
/// exposes `requestPermission()` (singular) and `scheduleDaily`.
///
/// Consumers re-pointed with this rename (7 call sites, 5 files) are listed in
/// MANIFEST.md §4. De-forking is [pipeline 2]C-3's work item, not this merge's.
final Provider<NotificationService> sublyNotificationServiceProvider =
    Provider<NotificationService>((ref) => NotificationService.instance);

const String _remindersKey = 'nikatru.reminders_enabled';

/// The id of the one daily reminder the chassis schedules.
///
/// STABLE ON PURPOSE: `scheduleDaily` replaces an existing notification with the
/// same id, so re-arming it can never accumulate duplicates, and the OFF path
/// has something specific to cancel.
const int kDailyReminderId = 1;

/// Whether the user has turned the CHASSIS reminder on, persisted.
///
/// [pipeline C-13] Separate from the OS permission on purpose. The OS can revoke
/// permission at any time from system settings, and the app finds out only when
/// it next tries — so this stores the user's INTENT, and the platform's answer
/// is asked for fresh each time it matters. Conflating the two is how a toggle
/// reads ON while every notification is silently dropped.
///
/// ⚠️ SUBLY HAS ITS OWN REMINDER RAIL (`settings_controller.dart` +
/// `subscriptions_controller.dart` over the fork). Both rails now exist in this
/// tree. That is a REAL product question, not a merge artifact — MANIFEST.md §7
/// carries it as an open question for P2.6b, where the settings surface merges
/// and one of the two toggles has to be the one the user sees.
class RemindersEnabledController extends Notifier<bool> {
  bool _userChose = false;

  @override
  bool build() {
    _hydrate();
    return false;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool stored = (await kv.read(_remindersKey)) == 'true';
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ reminders off. Never throw at launch.
    }
  }

  Future<void> set(bool on) async {
    _userChose = true;
    state = on;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_remindersKey, on ? 'true' : 'false');
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
    // 🔴 OFF IS A PROMISE ABOUT THE OS, NOT ABOUT A BOOLEAN. Until this line the
    // only route to `cancelAll` was `applyReminderChoice`, reachable from exactly
    // one `SwitchListTile.onChanged` — so ANY second writer of the flag set the
    // switch to OFF and left every schedule armed. The reconciler hangs off the
    // STORED INTENT now, so whoever writes it, the OS is told.
    //
    // The ON direction deliberately does NOT schedule here: a reminder carries
    // USER-FACING text that only `AppLocalizations` can supply, and this layer
    // has no `BuildContext`. Under-scheduling is the safe failure — the boot-path
    // reconciler ([resyncOnStart]) closes it on the very next launch, and the
    // opposite mistake is notifying somebody who asked you not to.
    if (!on) await _cancelSchedules();
  }

  /// The one place anything is cancelled. Never throws: it is reached from a
  /// settings write and from the boot path, and neither may take the app down.
  Future<void> _cancelSchedules() async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    try {
      // `init()` first: cancel is undefined before the plugin is initialised.
      await svc.init();
      // cancelAll, not cancel(kDailyReminderId): "reminders off" is a promise
      // about all of them, including any an app schedules on top of the chassis.
      await svc.cancelAll();
    } catch (_) {
      // A platform channel that is not there must not become a crash.
    }
  }

  /// Reconcile the OS schedule with the PERSISTED intent, at start-up.
  ///
  /// 🔴 THIS IS THE REBOOT, DST AND TIMEZONE-CHANGE REPAIR PATH, and it is why
  /// no native `RECEIVE_BOOT_COMPLETED` receiver is stamped: the brick ships no
  /// native folders, so the only portable repair is to re-arm from the app's own
  /// start-up. An Android reboot drops every pending alarm; a DST transition or a
  /// flight moves the wall-clock hour a fixed-offset schedule was built against.
  ///
  /// It is also the OFF repair path — an intent of `false` re-asserts the cancel,
  /// so a store restored from a backup that carries OFF cannot leave a schedule
  /// alive from the install that made it.
  ///
  /// ⚠️ IT NEVER CALLS `requestPermission()`, and the property test asserts the
  /// count is zero across a full boot. Android 13+ makes a SECOND denial
  /// permanent (`USER_FIXED`, non-promptable), so spending the ask on a launch
  /// the user did not initiate can burn the permission for the life of the
  /// install.
  ///
  /// Idempotent: `scheduleDaily` replaces by [kDailyReminderId], so re-arming on
  /// every launch can never accumulate a second pending notification.
  Future<void> resyncOnStart({
    required String title,
    required String body,
  }) async {
    final bool intent;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      intent = (await kv.read(_remindersKey)) == 'true';
    } catch (_) {
      // An unreadable store is NOT a reason to cancel: it is a reason to change
      // nothing. Cancelling here would turn a transient disk error into a
      // silently disabled feature.
      return;
    }
    if (!intent) {
      await _cancelSchedules();
      return;
    }
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    try {
      await svc.init();
      await svc.scheduleDaily(
        core.DailyReminder(
          id: kDailyReminderId,
          title: title,
          body: body,
          hour: AppConfig.reminderHour,
          minute: AppConfig.reminderMinute,
        ),
      );
    } catch (_) {
      // Never throw on the boot path.
    }
  }

  /// Apply the user's choice FOR REAL: the persisted intent AND the OS schedule.
  ///
  /// 🔴 THIS METHOD IS THE DEFECT THAT WAS FIXED. The toggle used to call
  /// `requestPermission()` and store the answer, and nothing else — so every
  /// stamped app primed the user, spent the ONE OS permission prompt most
  /// platforms ever grant, showed the switch as ON, and then never scheduled a
  /// single notification. It was invisible to the suite because the tests
  /// asserted flag persistence, which was working perfectly.
  ///
  /// [title] and [body] are parameters because the notification is USER-FACING
  /// text and must come from `AppLocalizations`, which needs a `BuildContext`
  /// this layer does not have.
  ///
  /// Returns what actually happened, which is NOT the same as what was asked
  /// for: the OS can refuse permission, and the switch must then read OFF.
  Future<bool> applyReminderChoice({
    required bool on,
    required String title,
    required String body,
  }) async {
    final core.NotificationService svc = ref.read(notificationServiceProvider);
    // `init()` first in BOTH directions: it loads the timezone database and
    // initialises the plugin, and every other call — cancel included — is
    // undefined without it. It is idempotent, so calling it twice costs nothing.
    await svc.init();
    if (!on) {
      // The cancel lives in `set`, not here, ON PURPOSE — see the comment there.
      await set(false);
      return false;
    }
    final bool granted = await svc.requestPermission();
    if (granted) {
      await svc.scheduleDaily(
        core.DailyReminder(
          id: kDailyReminderId,
          title: title,
          body: body,
          hour: AppConfig.reminderHour,
          minute: AppConfig.reminderMinute,
        ),
      );
    }
    // The OS decides, not the switch. Storing `true` after a refusal is the
    // toggle-lies-about-the-feature shape the class doc above is about.
    await set(granted);
    return granted;
  }
}

final NotifierProvider<RemindersEnabledController, bool>
remindersEnabledProvider = NotifierProvider<RemindersEnabledController, bool>(
  RemindersEnabledController.new,
);

const String _lastNudgeShownKey = 'nikatru.last_nudge_shown_at';

/// When the in-app catch-up nudge was last shown, persisted — [pipeline T-8].
///
/// 🔴 THE HALF OF THE REMINDER PROMISE THE OS CANNOT KEEP. Three of the six
/// platforms cannot schedule a repeating local notification and **no version of
/// the pinned plugin family can** — Windows throws on repeating notifications,
/// Linux has no scheduler API, browsers support neither — and web is the only
/// live platform today.
///
/// It is a STANDING part of the chassis, not a bridge to a plugin release, and
/// the mechanism is deliberately the humblest one that works: no background
/// work, no polling, no wake-up the OS refuses to grant.
///
/// Null means "never shown", and the decision itself lives in
/// [core.CatchUpNudge] so every platform row — including the web row, which
/// `kIsWeb` makes unreachable from a widget test — is decidable from a unit test.
class CatchUpNudgeController extends Notifier<DateTime?> {
  bool _marked = false;

  @override
  DateTime? build() {
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_lastNudgeShownKey);
      if (_marked) return; // a nudge shown while we were reading wins
      if (raw == null) return;
      final DateTime? parsed = DateTime.tryParse(raw);
      if (parsed != null) state = parsed;
    } catch (_) {
      // Unreadable store ⇒ "never shown". The worst case is one extra nudge,
      // which is strictly better than crashing at launch.
    }
  }

  /// Record that the nudge has been shown for the current occurrence.
  Future<void> markShown(DateTime at) async {
    _marked = true;
    state = at;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      // Stored in UTC and compared in local time by [core.CatchUpNudge]: an
      // ISO-8601 string without a zone is ambiguous the moment the device
      // travels, and this is exactly the family of bug that made a 09:00
      // reminder fire at 14:30 IST.
      await kv.write(_lastNudgeShownKey, at.toUtc().toIso8601String());
    } catch (_) {
      // Best-effort: a failed write means at most one repeated nudge.
    }
  }
}

final NotifierProvider<CatchUpNudgeController, DateTime?> catchUpNudgeProvider =
    NotifierProvider<CatchUpNudgeController, DateTime?>(
      CatchUpNudgeController.new,
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION H · USER PREFERENCES THE CHASSIS PERSISTS
// ═════════════════════════════════════════════════════════════════════════════

const String _themeModeKey = 'nikatru.theme_mode';

/// The user's light/dark/system choice, persisted ([pipeline C-14] via C-16).
///
/// WHY A PERSISTED OVERRIDE AT ALL: `MaterialApp` already defaults to
/// `ThemeMode.system`, so a stamped app follows the OS setting with no code. What
/// was missing is a user who wants dark while their phone is light — and the DoD
/// requires `theme` + `darkTheme` + a **persisted** themeMode.
///
/// Starts at [ThemeMode.system] and hydrates from storage in the background
/// rather than awaiting it, so first paint never blocks on disk.
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

const String _localeKey = 'nikatru.locale';

/// The user's language choice, persisted — [pipeline C-13].
///
/// 🔴 NULL MEANS "FOLLOW THE DEVICE", and that is the important state. Storing a
/// concrete locale as the default would freeze every app to whatever language
/// the first launch happened to see, and a user who later changes their phone's
/// language would find the app ignoring them. So null is the default and is a
/// real, selectable option — not merely the absence of a choice.
class LocaleController extends Notifier<Locale?> {
  bool _userChose = false;

  @override
  Locale? build() {
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_localeKey);
      if (_userChose) return; // the user got there first — never clobber
      state = _decode(raw);
    } catch (_) {
      // Unreadable store ⇒ follow the device. Never throw at launch.
    }
  }

  /// Pass null to go back to following the device.
  Future<void> set(Locale? locale) async {
    _userChose = true;
    state = locale;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_localeKey, locale?.languageCode ?? '');
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
  }

  static Locale? _decode(String? raw) =>
      (raw == null || raw.isEmpty) ? null : Locale(raw);
}

final NotifierProvider<LocaleController, Locale?> localeProvider =
    NotifierProvider<LocaleController, Locale?>(LocaleController.new);

const String _onboardingSeenKey = 'nikatru.onboarding_seen';

/// Whether first-run onboarding has been completed or skipped — [pipeline C-13].
///
/// Persisted, because the cost of getting this wrong is asymmetric: showing it
/// twice is an irritation, and showing it never is a user who was dropped into
/// an app nobody introduced.
class OnboardingSeenController extends Notifier<bool?> {
  bool _userChose = false;

  /// 🔴 NULL MEANS "NOT KNOWN YET", AND IT IS NOT THE SAME AS FALSE. Hydration
  /// is async, so a plain `false` default meant the router's FIRST redirect —
  /// which runs before the disk read lands — saw "not onboarded" and sent a
  /// RETURNING user to the carousel. Nothing re-ran the redirect afterwards, so
  /// they were stuck there, and finishing it just wrote the flag they already
  /// had. Every launch. Found by the property test, not by reading the code.
  ///
  /// With three states the redirect can decline to decide until it knows, which
  /// is the only honest answer while the disk is still being read.
  @override
  bool? build() {
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool stored = (await kv.read(_onboardingSeenKey)) == 'true';
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ SHOW onboarding. Resolving to false rather than
      // staying null matters: null blocks the decision forever, and the cost is
      // asymmetric — showing it twice is an irritation, never showing it drops
      // the user into an app nobody introduced.
      if (!_userChose) state = false;
    }
  }

  Future<void> set(bool seen) async {
    _userChose = true;
    // In memory FIRST: the router's redirect reads this synchronously the
    // moment the screen navigates away, and a slow write must not bounce the
    // user straight back into onboarding.
    state = seen;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_onboardingSeenKey, seen ? 'true' : 'false');
    } catch (_) {
      // Best-effort: a failed write only means it is shown once more.
    }
  }
}

final NotifierProvider<OnboardingSeenController, bool?> onboardingSeenProvider =
    NotifierProvider<OnboardingSeenController, bool?>(
      OnboardingSeenController.new,
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION I · STORE REVIEW ([pipeline C-13])
//
// ⚠️ THE ONE-CHANCE PROBLEM. iOS ignores requests beyond roughly three a year
// WITHOUT SAYING SO: the call returns normally and nothing appears. So asking at
// a bad moment does not annoy anybody — it silently spends the app's remaining
// requests on a dialog nobody sees. Everything below exists to make that
// unspendable by accident.
// ═════════════════════════════════════════════════════════════════════════════

const String _reviewStateKey = 'nikatru.review_gate';

/// The real prompter. Platform reality is DECLARED ([pipeline C-7]): the adapter
/// consults [ReviewCapabilities] before touching the plugin, because
/// `in_app_review` has no Linux or web implementation and reaching it there
/// throws.
///
/// 🔴 THE STORE IDS ARE NOT OPTIONAL DECORATION. Constructed bare, the listing
/// call reaches `ArgumentError.checkNotNull` inside the plugin on iOS, macOS and
/// Windows — in release, swallowed by the adapter's catch — so the only route to
/// a store on Windows silently did nothing. Empty defines mean "not registered
/// with that store yet" and the adapter reports that as
/// `core.StoreListingOutcome.notConfigured`.
final Provider<core.ReviewPrompter> reviewPrompterProvider =
    Provider<core.ReviewPrompter>(
      (ref) => InAppReviewPrompter(
        appStoreId: AppConfig.appStoreId,
        microsoftStoreId: AppConfig.microsoftStoreId,
      ),
    );

/// The timing rule. A provider rather than a constant so a test can shorten the
/// thresholds instead of simulating four months of calendar time.
final Provider<core.ReviewGate> reviewGateProvider = Provider<core.ReviewGate>(
  (ref) => const core.ReviewGate(),
);

/// The persisted history plus the decision, in one place.
class ReviewPromptController extends Notifier<core.ReviewGateState> {
  /// 🔴 EVERY MUTATOR AWAITS THIS, and it is not tidiness — the property test
  /// caught the bug. The other persisted controllers here guard hydration with a
  /// `_userChose` flag, which is right for a CHOICE: last writer wins, and the
  /// user is the last writer. These are COUNTERS, and for a counter that rule
  /// loses data. `recordLaunch()` fired from the app's first frame while
  /// `_hydrate()` was still in flight, incremented the EMPTY default to 1, and
  /// then hydration completed and overwrote it with the stored 20 — so the
  /// launch went uncounted and the write was silently discarded.
  Future<void>? _hydrating;

  @override
  core.ReviewGateState build() {
    _hydrating = _hydrate();
    return const core.ReviewGateState();
  }

  /// Wait for the disk read, but never let its failure become the caller's.
  Future<void> _ensureHydrated() async {
    try {
      await _hydrating;
    } catch (_) {
      // Unreadable store ⇒ carry on as a fresh install.
    }
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_reviewStateKey);
      if (raw == null || raw.isEmpty) return;
      state = core.ReviewGateState.fromJson(
        jsonDecode(raw) as Map<String, Object?>,
      );
    } catch (_) {
      // Unreadable or corrupt ⇒ behave like a fresh install. Never throw at
      // launch, and never fail OPEN into asking.
    }
  }

  Future<void> _persist(core.ReviewGateState next) async {
    state = next;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_reviewStateKey, jsonEncode(next.toJson()));
    } catch (_) {
      // Best-effort: a failed write only means the counter restarts.
    }
  }

  /// Count this launch, and stamp the install date the first time we see it.
  Future<void> recordLaunch({DateTime? now}) async {
    await _ensureHydrated();
    final DateTime at = now ?? DateTime.now().toUtc();
    await _persist(
      state.copyWith(
        launches: state.launches + 1,
        firstLaunch: state.firstLaunch ?? at,
      ),
    );
  }

  /// The user has asked not to be asked again. Never cleared by the chassis.
  Future<void> suppress() async {
    await _ensureHydrated();
    await _persist(state.copyWith(suppressed: true));
  }

  /// Ask, but only if the gate agrees.
  ///
  /// Returns what actually happened, so a caller can tell "we asked" from "the
  /// platform cannot" from "not yet" — three outcomes that are identical from a
  /// bool and need completely different responses.
  Future<core.ReviewRequestOutcome> maybeAsk({DateTime? now}) async {
    await _ensureHydrated();
    final core.ReviewPrompter prompter = ref.read(reviewPrompterProvider);
    // The DEVICE half, asked before the calendar half: on Android this depends
    // on the Play Store being installed, which no build-time fact can tell us.
    final bool canAsk = await prompter.isAvailable();
    final core.ReviewGateVerdict verdict = ref
        .read(reviewGateProvider)
        .decide(
          state,
          now: now ?? DateTime.now().toUtc(),
          platformCanAsk: canAsk,
        );
    if (verdict == core.ReviewGateVerdict.platformCannotAsk) {
      return core.ReviewRequestOutcome.unavailable;
    }
    if (verdict != core.ReviewGateVerdict.ask) {
      return core.ReviewRequestOutcome.gated;
    }
    // Recorded BEFORE the call, deliberately. The platform never tells us
    // whether anything was drawn, so a crash or a kill between the request and
    // the write would let the app ask again on the next launch — and the second
    // ask is the one the store silently discards.
    await _persist(
      state.copyWith(
        lastAskedAt: now ?? DateTime.now().toUtc(),
        timesAsked: state.timesAsked + 1,
      ),
    );
    await prompter.requestReview();
    return core.ReviewRequestOutcome.requested;
  }
}

final NotifierProvider<ReviewPromptController, core.ReviewGateState>
reviewPromptProvider =
    NotifierProvider<ReviewPromptController, core.ReviewGateState>(
      ReviewPromptController.new,
    );

// ═════════════════════════════════════════════════════════════════════════════
// SECTION J · THE ROUTER'S REFRESH SIGNAL
// ═════════════════════════════════════════════════════════════════════════════

/// A ChangeNotifier something outside it can fire. `notifyListeners` is
/// protected, which is the right default and the wrong one for a bridge whose
/// entire job is to be fired from elsewhere.
class _Bump extends ChangeNotifier {
  void bump() => notifyListeners();
}

/// What the stamped router listens to — [pipeline C-13].
///
/// TWO signals, merged, because the redirect depends on two things that arrive
/// at different times: the session (auth) and the first-run flag (disk). The
/// first version listened only to auth, so the onboarding flag could resolve and
/// the router would never look again.
///
/// This IS what the live router listens to: `lib/core/router.dart` passes it to
/// `refreshListenable` (anchored verbatim by
/// `tooling/ci/assert-stamp-properties.mjs`). The old `core/router/app_router.dart`
/// and its private `GoRouterRefreshStream` bridge are gone — P2.5 de-duplicated
/// the two routers onto the STAMPED `lib/core/router.dart` path, and the bridge
/// class was retired once this provider provably covered the auth-change case.
final Provider<Listenable> routerRefreshProvider = Provider<Listenable>((ref) {
  final _Bump onboarding = _Bump();
  // 🔄 `(bool? _, bool? _)` — TWO wildcards, not `_`/`__`. The brick template
  // writes `__` for the second, which `nikatru_lints`' `unnecessary_underscores`
  // reports as an info under Subly's resolved lint set. Dart 3.7+ allows the
  // wildcard `_` to repeat in a parameter list, so this is the same code with
  // one fewer diagnostic. Measured, not assumed: it is the only NEW analyzer
  // finding this whole 1300-line merge produces inside the file itself.
  ref.listen<bool?>(
    onboardingSeenProvider,
    (bool? _, bool? _) => onboarding.bump(),
  );
  ref.onDispose(onboarding.dispose);
  return Listenable.merge(<Listenable>[
    ref.watch(authRefreshProvider),
    onboarding,
  ]);
});

// ═════════════════════════════════════════════════════════════════════════════
// SECTION K · SUBLY'S OWN PRODUCT STATE (live-only, carried verbatim)
// ═════════════════════════════════════════════════════════════════════════════

/// 🔴 WHERE THE DELETION OUTCOME LIVES ONCE THE SCREEN IS GONE.
///
/// `deleteAccount()` signs out whichever way the request went; the auth stream
/// fires, and go_router replaces the page stack with `/sign-in`. A `SnackBar`
/// — or a dialog, which is a PAGELESS ROUTE on the page being removed — goes
/// with it.
/// **Measured, not assumed:** the first version of this flow rendered the result
/// in the dialog, and the router-driven test in `test/delete_account_test.dart`
/// found zero widgets with the result key after the redirect settled. So the
/// message that matters most — 502: your data is gone and your login still
/// works — was the one message the user never saw.
///
/// The outcome therefore outlives the screen here, and `LoginScreen` renders it.
/// Cleared when the user dismisses it, so it cannot resurface at a later
/// sign-out. [ADR 027]
final StateProvider<core.AccountDeletionOutcome?>
lastAccountDeletionOutcomeProvider =
    StateProvider<core.AccountDeletionOutcome?>((ref) => null);

/// WHY that outcome, for a developer — parked next to it and NEVER shown in a
/// release build.
///
/// 🔴 IT EXISTS BECAUSE `unknown` IS A BUCKET WITH NO LABEL, AND THE LABEL COST
/// FOUR DAYS. The live delete leg reported "we cannot tell how much of it was
/// removed" on 2026-08-09; the cause was a Riverpod `CircularDependencyError`
/// thrown before a request was formed, and three sessions went looking for an
/// HTTP status that had never existed — one of them reading Cloudflare's zone
/// analytics to prove the request had never been sent. `_deleteAccount` had the
/// exception in its hand and threw it away, because the screen renders
/// `outcome.plainMessage` and nothing else.
///
/// It holds `error.toString()`, which for an [core.AccountDeletionFailure] now
/// carries the status or the underlying throw in `[...]`. `LoginScreen` renders
/// it under the notice IN DEBUG BUILDS ONLY — that is where `flutter drive`
/// runs, so the E2E can name the cause in one run, and a user never sees it.
final StateProvider<String?> lastAccountDeletionDetailProvider =
    StateProvider<String?>((ref) => null);

/// API: real Worker via Dio when configured, else the seed client (demo mode).
/// The Dio base URL comes from the CFG-1 `api_base_url` (runtime, swappable with
/// no store release), falling back to the compile-time define until it resolves.
///
/// 🔴 `tokenProvider` TAKES [authTokenProvider], AND IT IS THE SAME RULE
/// [platformRestClientProvider] IS BUILT ON — read that block, which explains how
/// the identical tear-off there became a delete button that never sent a request
/// (#258). This line held `ref.watch(authRepositoryProvider).currentAccessToken`
/// until 2026-08-09, and nothing was broken by it YET: the loop was still OPEN,
/// because nothing inside [authRepositoryProvider]'s own closure reads this
/// provider. It was ONE EDIT from closing — measured, not argued, by adding a
/// single `ref.read(apiClientProvider)` to that closure and watching
/// `assert-provider-graph-acyclic.mjs` name the chain
/// `authRepositoryProvider --read--> apiClientProvider --watch-->
/// authRepositoryProvider`. With this line as it now stands, the same addition is
/// green. The note at [authRepositoryProvider] records that routing erasure
/// through a second client was CONSIDERED; had it been chosen against the old
/// line here, the same debug-only `CircularDependencyError` would have landed on
/// a second seam, and the four days would have been spent twice.
///
/// [authTokenProvider] is a type-identical drop-in — both are
/// `Future<String?> Function()` — and it is STRICTLY FRESHER: the tear-off binds
/// whichever repository instance existed when this provider built, while
/// [authTokenProvider] resolves the repository at CALL time. A hand-written
/// client belongs on this shape; the brick's `restClientProvider` already is, and
/// is why the brick never had this defect.
final Provider<ApiClient> apiClientProvider = Provider<ApiClient>((ref) {
  if (!AppConfig.isApiConfigured) return SeedApiClient();
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  final String baseUrl = cfg?.apiBaseUrl ?? '${AppConfig.apiBaseUrl}/v1';
  return DioApiClient(
    baseUrl: baseUrl,
    tokenProvider: ref.watch(authTokenProvider),
  );
});

final Provider<SubscriptionRepository> subscriptionRepositoryProvider =
    Provider<SubscriptionRepository>(
      (ref) => SubscriptionRepository(ref.watch(apiClientProvider)),
    );

// ── `purchasesServiceProvider` WAS HERE, AND IT IS GONE ON PURPOSE ──────────
// [pipeline 5]M-11/M-13/M-15, [ADR 026]. `lib/services/purchases/` held a
// RevenueCat-shaped stub: a `PurchasesService` whose `purchase()` returned
// `success: false`, whose `restore()` returned `false`, and whose offerings were
// hardcoded price literals — prices the owner replaced on 2026-07-27 and which
// nothing could contradict, because a hardcoded string is consistent with itself
// forever. The provider had zero consumers.
//
// It was REPLACED, not extended: its `PurchaseResult{isPro}` shape hands the
// unlock decision to the client, and this rail's whole design is that only the
// server grants. The real path lives in `packages/purchases` and is wired by
// `lib/state/money_providers.dart`, which reads [appConfigProvider],
// [authRepositoryProvider], [entitlementCacheProvider], [kPlatformBaseUrl] and
// the re-exported `analyticsProvider` from this file. See
// knowledge/decisions/026-purchases-adapter-replaces-revenuecat-stub.md.
