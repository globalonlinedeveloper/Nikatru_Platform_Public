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
// 🔴 `SupabaseAuthRepository` NOW COMES FROM HERE — 39-CHASSIS CUT 1 IS
// REVERSED (owner approval, 2026-08-09: "Cut-1 reversal APPROVED — supabase
// auth repository moves into the chassis").
//
// The `show` that used to sit here explained that this package AND
// `../data/auth/supabase_auth_repository.dart` each exported that name, so an
// unnarrowed import would not compile. That collision was the fork: two classes,
// one job, and the app's copy was the one that ran. It had drifted — no token
// refresh on expiry, no single-flight, no `kIsWeb` launch-mode rule for Apple —
// so every fix landed in the chassis served an app that did not use it. The
// app-side file is DELETED; the `show` list stays narrow because it still keeps
// `PrefsKeyValueStore`-class collisions out (see the barrel note below), not
// because a twin exists.
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show
        AuthCapabilities,
        InMemoryAuthRepository,
        SupabaseAuthRepository,
        passwordResetArrivalOf,
        passwordResetRedirectUrl;
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
import '../data/subscriptions/subscription_repository.dart';
import '../services/notifications/notification_service.dart';
import 'analytics_providers.dart';

/// 🔴 THE AMBIGUITY FIX — see note 1 in the header. These names are declared
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
        applyLegalAcceptance,
        consentControllerProvider,
        consentDecidedProvider,
        consentTransportProvider,
        eventTransportProvider,
        installIdProvider,
        kLegalVersions,
        kPrivacyPolicyVersion,
        kTermsVersion,
        keyValueStoreProvider,
        privacySignalProvider,
        promoObjectedProvider,
        promoObjectionKnownProvider,
        recordAnalyticsConsent,
        recordPromoObjection;

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
/// 🔴 KEPT VERBATIM FROM LIVE — the chassis version of this PROVIDER is the one
/// thing in the whole spine that must NOT win, because of where it points
/// `requestServerDeletion`. See note 2 in the file header.
///
/// ⚠️ THAT IS ABOUT THE PROVIDER, NOT THE CLASS, AND THE TWO USED TO BE
/// CONFUSED. `SupabaseAuthRepository` is now the CHASSIS class
/// (`packages/auth_supabase`) — 39-CHASSIS cut 1 reversed, owner 2026-08-09.
/// The fork this replaces was a hand-copy that had fallen three fixes behind:
/// `currentAccessToken()` handed back whatever was in memory, expired or not
/// (a resumed app's first request 401s, and the brick used to read that as
/// "signed out"); there was no single-flight, so a burst of requests each
/// started its own refresh and gotrue retired the token the losers were still
/// holding; and `signInWithApple()` had no `kIsWeb` launch-mode arm, which is a
/// popup on web and a login that never completes in a standalone PWA. Wiring
/// the shared class in is the whole point of the reversal: the one-identity
/// lock means every future app takes THIS class, so a fix here has to reach
/// every app including this one.
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
              // 🔴 UNSET, THE RESET LINK RESOLVES TO THE PROJECT'S SITE URL —
              // one URL shared by every app the portfolio's single Supabase
              // project authenticates. gotrue does not error on an absent
              // `redirect_to`; it substitutes, so the mail sends, the link
              // works, and the only difference is which app the person lands
              // in. Invisible from inside this one.
              //
              // Read off the RUNNING ORIGIN so a Pages preview and a localhost
              // run each send their own users back to themselves. Null off web:
              // no native target here registers a URI scheme yet, and a
              // fabricated one is not on the allow-list, so gotrue would fall
              // back to the Site URL anyway with the reason hidden.
              passwordResetRedirectTo: passwordResetRedirectUrl(
                isWeb: kIsWeb,
                base: Uri.base,
              ),
            )
          : InMemoryAuthRepository(),
    );

/// Whether a PASSWORD-RECOVERY session is in flight.
///
/// 🔴 NOTHING ELSE CAN ANSWER THIS. A user who follows a reset link is handed a
/// real session, so `currentUser`, `currentSession()` and `authStateChanges()`
/// report an ordinary sign-in — indistinguishable from somebody typing their
/// password. The reason rides on the `AuthEvent` at the instant it is delivered
/// and the Supabase adapter used to map it away, which is why a reset link could
/// only ever land the user on the home screen.
///
/// ⚠️ THE ARMS THAT DO NOTHING ARE AS DELIBERATE AS THE TWO THAT DO:
///   · `passwordRecovery` ARMS it; the gate then holds the user on
///     `/reset-password` however they navigate;
///   · `signedOut` RELEASES it, and is the ONLY release. `ResetPasswordScreen`
///     signs out to leave, so finishing and abandoning take one exit rather than
///     two that must be kept in step;
///   · `userUpdated` must NOT release it — it fires the moment the new password
///     lands, and releasing there tears the confirmation page down under the
///     user before they can read it ([ADR 027]'s lesson again);
///   · `signedIn` must NOT release it — gotrue can follow a recovery with an
///     ordinary arrival event, and releasing on one drops somebody out of the
///     form mid-typing.
///
/// A plain synchronous `bool`, not an `AsyncValue`: the redirect guard that
/// reads it cannot await, which is the same reason the seam exposes
/// `currentUser` separately from `currentSession()`.
class PasswordRecoveryController extends Notifier<bool> {
  @override
  bool build() {
    final AuthRepository auth = ref.watch(authRepositoryProvider);
    final StreamSubscription<core.AuthEvent> sub = auth.authEvents().listen((
      core.AuthEvent event,
    ) {
      if (event.startsPasswordRecovery) {
        state = true;
      } else if (event.kind == core.AuthEventKind.signedOut) {
        state = false;
      }
    });
    ref.onDispose(sub.cancel);
    return false;
  }
}

final NotifierProvider<PasswordRecoveryController, bool>
passwordRecoveryProvider = NotifierProvider<PasswordRecoveryController, bool>(
  PasswordRecoveryController.new,
);

/// The URL this build was launched with.
///
/// A PROVIDER rather than a direct `Uri.base` read, for one reason: `Uri.base`
/// is a property of the process, so a test that needs a reset-link arrival could
/// not otherwise construct one, and the arrival path would be exactly the
/// fail-closed-and-untested limb [pipeline C-6] is about.
final Provider<Uri> launchUriProvider = Provider<Uri>((ref) => Uri.base);

/// What a password-reset link left in the URL, and what became of it.
///
/// 🔴 THIS EXISTS BECAUSE THE DEAD-LINK STATE WAS UNREACHABLE FROM THE FAILURE
/// IT EXPLAINS. `ResetPasswordScreen` shipped with a careful explanation for an
/// unusable link, `/reset-password` was added to `signedOutMayStay` so a
/// signed-out visitor could stand there to read it — and nothing ever put them
/// there. The ONLY thing that routed to that screen was
/// `AuthEventKind.passwordRecovery`, which is the SUCCESS event; a link that
/// cannot be exchanged emits an error and never that. So three tests proved a
/// state production could not produce, and the screen's own comment called it
/// "the state the feature reaches most often in the field".
///
/// TWO INDEPENDENT SOURCES, because the failure has two shapes and neither one
/// covers the other:
///
///   1. THE LAUNCH URL. gotrue's failure redirect answers `303` to
///      `…/?nk_auth=reset#error=access_denied&error_code=otp_expired` — measured
///      live against the real project on 2026-08-11, not inferred. The query
///      survives; the FRAGMENT does not, so with the hash URL strategy the route
///      the link asked for is gone and go_router has nothing to match: the
///      errorBuilder renders `NotFoundScreen`, which is worse than the
///      unexplained `/sign-in` the entry in `signedOutMayStay` was added to
///      prevent. Reading the marker off the query is what turns that 404 into
///      the sentence.
///
///   2. THE EVENT STREAM. A link that reaches the SDK with a code but no PKCE
///      verifier — the reset requested on one device and opened on another, or
///      site data cleared in between — throws inside the exchange and surfaces
///      as a stream ERROR. That was a FATAL CRASH in production (GlitchTip
///      SUBLY-8, 2026-08-10T18:09:25Z, release subly@1.0.189+4d85ad7,
///      `mechanism: runZonedGuarded, handled: false`). The seam now delivers it
///      as `AuthEventKind.recoveryLinkFailed`, and this is what holds it.
///
/// ⚠️ `signedOut` IS DELIBERATELY NOT A RELEASE HERE, unlike in
/// [passwordRecoveryProvider], and the difference is a race rather than a
/// preference. This state can be set by the LAUNCH URL, before any event at all,
/// while `supabase_flutter` emits `initialSession` — which maps to `signedOut`
/// when a cold start restored nothing — at a moment whose order against the
/// deep-link handler is not guaranteed. Releasing on it would let the arrival
/// this launch actually carried be erased by a routine startup emission,
/// intermittently. [clear] is the release, and `ResetPasswordScreen` calls it on
/// the way out: the exit is one deliberate act instead of two that must agree.
class PasswordResetArrivalController
    extends Notifier<core.PasswordResetArrivalReport> {
  @override
  core.PasswordResetArrivalReport build() {
    final AuthRepository auth = ref.watch(authRepositoryProvider);
    final StreamSubscription<core.AuthEvent> sub = auth.authEvents().listen((
      core.AuthEvent event,
    ) {
      if (event.recoveryLinkIsUnusable) {
        state = core.PasswordResetArrivalReport(
          core.PasswordResetArrival.unusable,
          problem: event.problem ?? core.AuthLinkProblem.unknown,
        );
      } else if (event.startsPasswordRecovery) {
        state = const core.PasswordResetArrivalReport(
          core.PasswordResetArrival.pending,
        );
      }
    });
    ref.onDispose(sub.cancel);
    return passwordResetArrivalOf(ref.watch(launchUriProvider));
  }

  /// The one release. Called by the screen when the user leaves it, so a dead
  /// link does not park them on `/reset-password` for the rest of the session.
  void clear() => state = core.PasswordResetArrivalReport.none;
}

final NotifierProvider<
  PasswordResetArrivalController,
  core.PasswordResetArrivalReport
>
passwordResetArrivalProvider =
    NotifierProvider<
      PasswordResetArrivalController,
      core.PasswordResetArrivalReport
    >(PasswordResetArrivalController.new);

/// Whether the router should hold the user on `/reset-password`.
///
/// ONE READ for the two states that mean it, so the gate cannot drift from the
/// screen: an armed recovery (the success path) or an arrival that has not been
/// dismissed (the failure path, and the moments before the exchange resolves).
bool shouldHoldForPasswordReset({
  required bool recovering,
  required core.PasswordResetArrival arrival,
}) => recovering || arrival != core.PasswordResetArrival.none;

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
///
/// ⚠️ THIS PATH DOES NOT RUN THE PER-USER FORGET, and the omission is stated
/// rather than left to be discovered. It takes a [core.AuthRepository] because
/// it is called from inside [restClientProvider]'s `onUnauthorized`, where there
/// is no `WidgetRef` to resolve [userStateDrops] from; wiring it would mean
/// either a second copy of the drop list (the one thing that list exists to
/// prevent) or a second reader shape. So a session that dies of a failed refresh
/// still leaves the entitlement cache behind until the next deliberate sign-out.
/// It is the narrowest of the leaks — nobody hands the device over on a 401 —
/// and it is the only one left. Named here, and in [signOutAndForgetUser]'s doc,
/// so the count in that doc stays honest.
Future<void> signOutOnlyIfSessionIsGone(core.AuthRepository auth) async {
  if (await auth.currentAccessToken() == null) {
    await auth.signOut();
  }
}

/// One user-scoped clear, with its provider read ALREADY DONE.
typedef UserStateDrop = Future<void> Function();

/// Everything on this device that belongs to the person who was signed in,
/// RESOLVED — the read half, which is synchronous and has a deadline.
///
/// 🔴 `EntitlementCache.clear()` HAD ZERO PRODUCTION CALLERS. The cache exists
/// so a paid user stays unlocked offline, and it honours a cached answer for up
/// to [core.kEntitlementStalenessCeiling] — seven days. Nothing dropped it when
/// a session ended, so the NEXT person to sign in on a shared, borrowed, resold
/// or family device inherited the previous one's Pro for a week. `cancelAll()`
/// was in the same state on this path: a user who deleted their account went on
/// being reminded about it by a device that had forgotten nothing.
///
/// The LIST is the definition — one place that says what "user-scoped" means, so
/// adding a per-user store is one line here rather than an omission in four
/// screens. [pipeline C-6]: a fail-closed store nothing ever clears is a dead
/// capability that reports healthy.
///
/// ⚠️ BOTH NOTIFICATION SERVICES, and they are not the same object.
/// [notificationServiceProvider] is the chassis seam (the daily reminder);
/// [sublyNotificationServiceProvider] is Subly's frozen fork, and it is the one
/// that schedules the RENEWAL reminders and the weekly digest — the notifications
/// a deleted user would actually keep receiving. Cancelling only the chassis one
/// would look like a fix and change nothing about the reported symptom.
///
/// 🔴 THIS IS A SEPARATE FUNCTION FROM [forgetSignedInUser] BECAUSE READING A
/// PROVIDER HAS A DEADLINE AND RUNNING A DROP DOES NOT — and the first shape of
/// this fix got that wrong in the one way that made it do nothing.
/// `WidgetRef.read` calls `_assertNotDisposed()`, which THROWS
/// `StateError('Cannot use "ref" after the widget was disposed.')` in release
/// (flutter_riverpod 2.6.1 `consumer.dart:548-551` — a real throw, not an
/// `assert`). A sign-out emits on the auth stream BEFORE its network leg
/// finishes, the router then replaces the shell `/settings` lives in, and this
/// screen's element is gone — so a `ref.read` placed AFTER `await signOut()`
/// threw on exactly the slow connection the fix was for: nothing was cleared,
/// and the user was told a successful sign-out had failed. Resolve the drops
/// FIRST, then await. Callers cannot get this wrong by accident any more,
/// because [forgetSignedInUser] takes the resolved list and never a `ref`.
List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[
  ref.read(entitlementCacheProvider).clear,
  ref.read(notificationServiceProvider).cancelAll,
  ref.read(sublyNotificationServiceProvider).cancelAll,
];

/// Run the resolved drops — the half that is allowed to take as long as it likes.
///
/// 🔴 EVERY DROP IS ATTEMPTED EVEN AFTER ONE THROWS, and the FIRST failure is
/// rethrown once they all have been. Returning early leaves exactly the
/// half-forgotten state this exists to prevent (cache gone, reminders still
/// firing); swallowing restores the defect it fixes. The caller decides what to
/// say about it — see `_signOut` in `settings_screen.dart`.
Future<void> forgetSignedInUser(List<UserStateDrop> drops) async {
  Object? failure;
  StackTrace? stack;
  for (final UserStateDrop drop in drops) {
    try {
      await drop();
    } catch (e, s) {
      failure ??= e;
      stack ??= s;
    }
  }
  if (failure != null) Error.throwWithStackTrace(failure, stack!);
}

/// End the session AND forget the user — the whole of what a sign-out is.
///
/// 🔴 THE FORGET RUNS EVEN WHEN THE SIGN-OUT THREW, and that direction is
/// chosen. `SecureSessionStorage.removePersistedSession` throws on purpose when
/// it can neither delete the persisted session nor tombstone it, so a throw here
/// is the case where local state is MOST likely to outlive the user, not least.
/// The cost of clearing for a session that turns out to have survived is one
/// server read that puts the entitlement straight back.
///
/// 🔴 WHICH SESSION-ENDING PATHS RUN IT, COUNTED RATHER THAN ASSERTED. This doc
/// said "both paths (the Log out control and account deletion)" and there were
/// FOUR user-facing ones in this root; the two it did not name went on leaking
/// the previous user's Pro, and the sentence is how the next reader stops
/// looking. All four go through this function or through
/// [forgetSignedInUser] today:
///   1. Settings → Log out (`settings_screen.dart`, `_signOut`);
///   2. Settings → Delete account (the same file, after `deleteAccount()`);
///   3. `reaccept_terms_screen.dart` → Decline, the way out of the mandatory
///      interstitial every signed-in user meets on a `kTermsVersion` bump;
///   4. `verify_email_screen.dart` → Sign out, which its own comment calls "the
///      only way OUT of the gate".
/// `assert-seams-wired.mjs`'s `session_end` exclusive trigger is what keeps that
/// list true: this spine file is the ONLY place allowed to call `.signOut()`, so
/// a fifth control cannot be added without either routing through here or
/// turning the build red.
///
/// ⚠️ ONE PATH DELIBERATELY DOES NOT, and it is not a control:
/// [signOutOnlyIfSessionIsGone], the 401 handler on [restClientProvider]. It
/// takes a repository rather than a `WidgetRef` because it runs from inside a
/// provider with no widget anywhere near it, so it cannot resolve the drops the
/// way the four above do. Out of scope on purpose rather than by omission — see
/// the note at its declaration.
///
/// A NAMED function for the same reason [signOutOnlyIfSessionIsGone] is: a test
/// has to be able to drive it without a widget.
Future<void> signOutAndForgetUser(WidgetRef ref) async {
  // 🔴 BOTH READS HAPPEN HERE, BEFORE ANY AWAIT. See [userStateDrops].
  final core.AuthRepository auth = ref.read(authRepositoryProvider);
  final List<UserStateDrop> drops = userStateDrops(ref);
  Object? failure;
  StackTrace? stack;
  try {
    await auth.signOut();
  } catch (e, s) {
    failure = e;
    stack = s;
  }
  try {
    await forgetSignedInUser(drops);
  } catch (e, s) {
    failure ??= e;
    stack ??= s;
  }
  if (failure != null) Error.throwWithStackTrace(failure, stack!);
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
// SECTION H2 · LEGAL ACCEPTANCE (research/43 riders, owner 2026-08-09)
//
// The clickwrap the user ticked at sign-up, and the interstitial that asks
// again when the documents materially change. One store, one artifact, one
// append-only trail: this reads the SAME `ConsentController` every other
// purpose is recorded through, rather than minting a second private key that
// could drift from the record the server holds.
// ═════════════════════════════════════════════════════════════════════════════

/// The `LegalVersions.stamp` the signed-in user last accepted.
///
/// 🔴 THREE STATES, EXACTLY AS [OnboardingSeenController] HAS THREE, AND FOR
/// THE SAME MEASURED REASON. Hydration is async and the router's redirect runs
/// before the disk read lands:
///   · `null`  — not known yet. The redirect DECLINES TO DECIDE. A plain `''`
///     default would flash the re-acceptance interstitial at every launch for a
///     user who accepted months ago, and the router does not re-run on its own.
///   · `''`    — read, and nothing was ever accepted.
///   · a stamp — read, and this is what they agreed to.
///
/// ⚠️ ONLY A GRANTED ARTIFACT COUNTS. A `terms` artifact with `granted: false`
/// is a refusal, and reading its `policyVersion` would turn "I declined" into "I
/// accepted this version". The clickwrap never records a decline today — it
/// blocks instead — but the store is append-only and shared, so the reader must
/// not depend on a writer's current manners.
class LegalAcceptanceController extends Notifier<String?> {
  bool _userChose = false;

  /// Whether the identity stream has resolved at least once, and whether there
  /// was a session when it did. Two plain bools: no identifier is kept here,
  /// and that is the point — see [_reaskKey].
  bool _sawSession = false;
  bool _hadSession = false;

  @override
  String? build() {
    // 🔴 A SESSION ENDING RETIRES THE ACCEPTANCE ON THIS DEVICE. Without it the
    // acceptance is device-scoped while the router treats it as user-scoped,
    // and on a shared or family device that difference admits somebody who
    // never accepted anything: A signs up and accepts → A signs out → B signs
    // in to a pre-clickwrap account → the gate compares A's stamp, answers "no
    // re-acceptance needed", and B is inside the product having agreed to
    // nothing, with a record on file saying somebody did.
    //
    // 🔴 WHY IT IS A SIGN-OUT MARKER AND NOT THE OBVIOUS "REMEMBER WHO
    // ACCEPTED". Storing the accepting user's id beside this device's consent
    // artifact is a PAID identifier next to a PSEUDONYMOUS one, which [ADR 020]
    // forbids and `tooling/ci/assert-pseudonymity-firewall.mjs` fails the build
    // on — it was written that way first and the guard caught it in both trees.
    // The lock is not a formality: creating that mapping once retroactively
    // reclassifies the whole analytics corpus as personal data, for every app,
    // and deleting the pairing afterwards does not undo it. Nothing here
    // records WHO accepted; it records only that a session ended, which is
    // enough to make the next person answer for themselves.
    //
    // ⚠️ THE COST, STATED: a user who signs out and back in is asked once more.
    // research/43 declined re-asking on EVERY sign-in, and this is not that —
    // it is triggered by an explicit sign-out, never by a launch. Between the
    // two errors, asking one returning user again and admitting a different
    // person ungated, only the second is unrecoverable.
    ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (
      AsyncValue<core.AuthUser?>? previous,
      AsyncValue<core.AuthUser?> next,
    ) {
      if (next.isLoading) return;
      final bool hasSession = next.valueOrNull != null;
      // ⚠️ THE TRANSITION, NOT THE VALUE. `authUserProvider` resolves to null on
      // every signed-out launch, and treating THAT as a sign-out would mark a
      // re-ask before anybody had signed in — which is the "ask on every
      // sign-in" pattern research/43 declined, arriving by accident.
      final bool wasSignedIn = _sawSession && _hadSession;
      _sawSession = true;
      _hadSession = hasSession;
      if (!wasSignedIn || hasSession) return;
      _userChose = false;
      state = '';
      _markReask();
    });
    _hydrate();
    return null;
  }

  /// Set when a session ENDS, cleared when somebody accepts.
  ///
  /// Holds the literal string `true` and nothing else. It deliberately carries
  /// no user id, no address and no anon id: its only job is to make the next
  /// person on this device answer the clickwrap for themselves, and any
  /// identifier stored here would be the [ADR 020] pairing described above.
  static const String _reaskKey = 'nikatru.legal.reask';

  Future<void> _markReask() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_reaskKey, 'true');
    } catch (_) {
      // Best-effort. The in-memory `state = ''` above already gates THIS
      // session; a failed write only means a relaunch forgets, which is the
      // same direction every other decision in this class takes.
    }
  }

  Future<void> _hydrate() async {
    try {
      final core.ConsentController c = await ref.read(
        consentControllerProvider.future,
      );
      final core.ConsentStatus status = await c.hydrate(
        core.ConsentPurpose.terms,
      );
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool reask = (await kv.read(_reaskKey)) == 'true';
      // 🔴 EVERY ASSIGNMENT BELOW THE GUARD, NONE ABOVE IT. The read above is
      // an `await`, so a value assigned before this line would clobber a user
      // who ticked the box while the disk was still being read — and a partial
      // clobber is still a clobber.
      if (_userChose) return; // the user got there first — never clobber
      final core.ConsentArtifact? a = c.artifactOf(core.ConsentPurpose.terms);
      // A session ended on this device since the last acceptance, so whoever is
      // holding it now has to answer for themselves. The ARTIFACT is untouched:
      // it is the append-only legal record and it is not this flag's business.
      state = (!reask && status == core.ConsentStatus.granted && a != null)
          ? a.policyVersion
          : '';
    } catch (_) {
      // Unreadable store ⇒ ASK AGAIN. Resolving to '' rather than staying null
      // matters: null blocks the decision forever and the user sees a spinner
      // where the app should be. The cost is asymmetric in the same direction
      // as onboarding's — asking twice is a nuisance, never asking means
      // somebody is using the product under terms they were never shown.
      if (!_userChose) state = '';
    }
  }

  /// Record acceptance of [kLegalVersions] plus the express marketing decision,
  /// and make the router's gate open.
  ///
  /// In memory FIRST, exactly as [OnboardingSeenController.set] is: the redirect
  /// reads this synchronously the moment the screen navigates away, and a slow
  /// write must not bounce the user straight back into the interstitial.
  ///
  /// [marketingEmail] null = THIS SURFACE DID NOT ASK — see [acceptTermsOnly].
  Future<void> accept({required bool? marketingEmail}) async {
    _userChose = true;
    state = kLegalVersions.stamp;
    try {
      final core.ConsentController controller = await ref.read(
        consentControllerProvider.future,
      );
      final String anonId = await ref.read(installIdProvider.future);
      await applyLegalAcceptance(
        controller: controller,
        transport: ref.read(consentTransportProvider),
        appId: AppConfig.appId,
        anonId: anonId,
        marketingEmail: marketingEmail,
      );
      // The re-ask marker is cleared AFTER the artifact, so a half-written pair
      // reads as "still owed" rather than "settled" over a record that is not
      // there. Safe direction, same as everywhere else in this class.
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.remove(_reaskKey);
    } catch (_) {
      // Best-effort, and the in-memory state above is what the user experiences.
      // A failed write means the interstitial returns next launch — the safe
      // direction, and the same one every other decision here takes.
    }
  }

  /// Re-accept the documents WITHOUT touching the marketing decision.
  ///
  /// The interstitial's entry point. A named method rather than
  /// `accept(marketingEmail: null)` at the call site, because the thing being
  /// prevented is somebody "tidying" that null into a `false` — which reads
  /// harmless and silently unsubscribes every user who accepts a terms change.
  ///
  Future<void> acceptTermsOnly() => accept(marketingEmail: null);
}

final NotifierProvider<LegalAcceptanceController, String?>
legalAcceptanceProvider = NotifierProvider<LegalAcceptanceController, String?>(
  LegalAcceptanceController.new,
);

/// Whether the signed-in user must be shown the re-acceptance interstitial.
///
/// Null means "cannot tell yet" and the router must decline to decide — the
/// third state exists precisely so this question has an honest "not yet".
final Provider<bool?> legalReacceptanceNeededProvider = Provider<bool?>((ref) {
  final String? accepted = ref.watch(legalAcceptanceProvider);
  if (accepted == null) return null;
  return core.needsLegalReacceptance(
    // '' is "never accepted", and it is passed through as a real value rather
    // than mapped back to null: `needsLegalReacceptance` treats both the same,
    // and collapsing them here would re-create the loading ambiguity one layer
    // down.
    acceptedStamp: accepted,
    current: kLegalVersions,
  );
});

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

// ─────────────────────────────────────────────────────────────────────────────
// THE IN-APP PROMOTIONAL CARD — [research/44 §7 rung 3].
//
// 🔴 SAME-APP ONLY, AND THAT IS A DECLARATION FACT, NOT A PRODUCT PREFERENCE.
// This surface promotes THE APP THE USER IS ALREADY IN. It matches none of
// Google Play's three ads-declaration YES triggers — the house-ad trigger is
// worded "to promote MY OTHER APPS" — so it carries no ads label and puts no
// "Contains ads" badge on a listing (research/44 V2). A cross-app version is a
// DIFFERENT component with a DIFFERENT config key and a different declaration
// consequence, and the two must never share a widget or a flag.
//
// ⚠️ EVERYTHING HERE IS DORMANT BY DEFAULT, HONESTLY. The on-switch is
// `features.promo_card_enabled`, and an ABSENT key reads false
// (`AppConfig.feature` defaults to `orElse: false`), so a stamped app that has
// never reached the network — and every stamped app today — renders nothing.
// The dormancy is not a placeholder: the card's open path is proven in
// `test/chassis_properties_test.dart` by serving the flag, which is the only
// thing that distinguishes this from the four capabilities that shipped
// fail-closed with no proven open path ([pipeline C-6]).
// ─────────────────────────────────────────────────────────────────────────────

/// `features.promo_card_enabled` — the campaign's on-switch, named once.
const String kPromoCardFeature = 'promo_card_enabled';

/// `flags.promo_card_variant` — which wording this install sees.
const String kPromoCardVariantFlag = 'promo_card_variant';

const String _promoCardStateKey = 'nikatru.promo_card';

/// The frequency rule. A provider rather than a constant so a test can shorten
/// the thresholds instead of simulating a fortnight of calendar time — the same
/// reason [reviewGateProvider] is one.
final Provider<core.PromoGate> promoGateProvider = Provider<core.PromoGate>(
  (ref) => const core.PromoGate(),
);

/// The persisted promo history: how often this card has been shown, when, and
/// the two latches.
///
/// 🔴 THE LATCHES ARE NOT PREFERENCES. `dismissed` is the close control's answer
/// and `suppressed` is the GDPR Art 21 objection, which is ABSOLUTE — "the data
/// subject shall have the right to object at any time", after which "the
/// personal data shall no longer be processed for such purposes". Neither is
/// reachable from `copyWith`, by construction in [core.PromoGateState]; this
/// controller adds the other half of that promise, which is that nothing here
/// clears them either. There is deliberately no `reset()`.
///
/// 🔴 AN [AsyncNotifier], AND THE `Notifier` IT REPLACES SHIPPED TWO REAL
/// DEFECTS THAT ONLY THE TYPE COULD CLOSE. The first version published
/// `const core.PromoGateState()` synchronously and hydrated behind it, so for
/// the length of one disk read the card's caller could not tell "this person
/// never objected" from "we have not looked yet" — and those two must produce
/// opposite behaviour. Measured on the real tree before the change, with a
/// store whose read lands 40 ms after the config read: a record holding
/// `"suppressed": true` still rendered a promotional card at t+0, t+5, t+10 and
/// t+20 ms, and only came off screen at t+60. Every widget test hid that window
/// behind `pumpAndSettle()`.
///
/// Making the value an [AsyncValue] moves the barrier from a comment into the
/// type: `valueOrNull == null` covers *loading* and *unreadable* in one
/// expression, and the caller cannot decide without a record because there is
/// no record to decide from. Art 21(3) has no grace period in it, so neither
/// does this.
///
/// Counters, not a choice — so every mutator awaits hydration, exactly as
/// [ReviewPromptController] does. That distinction cost a lost launch on every
/// cold start when it was got wrong there: a counter incremented before the
/// disk read lands is overwritten by the stored value the moment it does.
class PromoCardStateController extends AsyncNotifier<core.PromoGateState> {
  /// Did the record we are holding actually come off disk?
  ///
  /// 🔴 THE SECOND DEFECT, AND THE WORSE ONE: A CORRUPT RECORD WAS NOT ONLY
  /// IGNORED, IT WAS OVERWRITTEN. `jsonDecode` and the map cast used to sit
  /// inside one `catch` that fell back to the empty default, so an interrupted
  /// write — `'{"shown_count":0,"dismissed":false,"suppressed":true'`, with the
  /// objection plainly in the bytes — read as a fresh device, showed the card,
  /// and then `markShown` rewrote the key as `"suppressed":false`. Proven on
  /// the real tree; the objection was gone from disk after one launch, and a
  /// truncated write is the ordinary way a mobile key/value store fails.
  ///
  /// [core.PromoGateState.fromJson] already falls closed on every FIELD it can
  /// read at all ("present but not `false`" reads as a set latch) — but it only
  /// gets to do that for bytes that parse. What lands here is the case where
  /// they do not, and a record we could not read is not a record that says no
  /// one objected. So the read fails to [AsyncError], which the card renders as
  /// nothing, and this flag blocks every write that could clobber the bytes we
  /// failed to read.
  bool _recordRead = false;

  @override
  Future<core.PromoGateState> build() async {
    _recordRead = false;
    final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
    final String? raw = await kv.read(_promoCardStateKey);
    if (raw == null || raw.isEmpty) {
      // A device that has never run this app: the ONE state that may be shown a
      // card, and the only one an absent key is allowed to mean.
      _recordRead = true;
      return const core.PromoGateState();
    }
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map<String, Object?>) {
      // A non-object top level (`'["suppressed"]'`) used to reach the same
      // silent fallback as a truncated one. Named as a failure instead.
      throw FormatException('promo record is not a JSON object', raw);
    }
    final core.PromoGateState stored = core.PromoGateState.fromJson(decoded);
    _recordRead = true;
    return stored;
  }

  /// The record, once the read has settled — and never the read's exception.
  ///
  /// A failed hydration is not a caller's problem to handle; it is a reason to
  /// do nothing, which every caller here does by consulting [_recordRead].
  Future<core.PromoGateState> _settled() async {
    try {
      return await future;
    } catch (_) {
      return state.valueOrNull ?? const core.PromoGateState();
    }
  }

  Future<void> _persist(core.PromoGateState next) async {
    state = AsyncValue<core.PromoGateState>.data(next);
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_promoCardStateKey, jsonEncode(next.toJson()));
    } catch (_) {
      // Best-effort. A failed write on a SHOW means at most one extra
      // impression; a failed write on a latch is the one that matters, and it
      // is why the latch is also held in memory for the life of the process.
    }
  }

  /// Record that the card was really put on screen.
  ///
  /// ⚠️ CALLED ON RENDER, NOT ON DECIDE. `PromoGate.decide` is pure and
  /// idempotent, so deciding twice from the same stored state says `show`
  /// twice; the write is the moment of truth. Persisting here — and only here —
  /// is what keeps the card from vanishing mid-frame under its own cooldown.
  ///
  /// 🔴 IT DOES NOT WRITE [decided] STRAIGHT THROUGH. The counter is incremented
  /// against the HYDRATED record rather than the one the decision saw — the same
  /// distinction [ReviewPromptController] records, where treating a counter like
  /// a choice cost one uncounted launch on every cold start — and a latch that
  /// arrived from storage WINS, abandoning this write. An impression is worth
  /// one counter tick; it is not worth a legal obligation.
  ///
  /// 🔴 AND IT WRITES NOTHING AT ALL OVER A RECORD WE COULD NOT READ. That is
  /// [_recordRead]'s whole job: an impression counter is the least important
  /// thing on this key, and it must never be the thing that destroys the most
  /// important one.
  Future<void> markShown(core.PromoGateState decided) async {
    final core.PromoGateState current = await _settled();
    if (!_recordRead) return;
    if (current.dismissed || current.suppressed) return;
    await _persist(
      current.copyWith(
        shownCount: current.shownCount + 1,
        lastShownAt: decided.lastShownAt,
      ),
    );
  }

  /// The user closed the card. One-way.
  ///
  /// Also refuses to write over an unread record: `dismissed: true` is a WEAKER
  /// latch than `suppressed: true`, so writing it over bytes that may have held
  /// an objection would trade a legal obligation for a preference. Unreachable
  /// in practice — a card the user can close is a card that rendered, and a
  /// failed read renders nothing — which is exactly why it is asserted rather
  /// than assumed.
  Future<void> dismiss() async {
    final core.PromoGateState current = await _settled();
    if (!_recordRead) return;
    await _persist(current.dismiss());
  }

  /// The user objected to promotional processing (GDPR Art 21). Ends every
  /// promotion on this device, not just this campaign.
  ///
  /// ⚠️ THE ONE MUTATOR THAT WRITES EVEN WHEN THE READ FAILED, and the asymmetry
  /// is deliberate. `suppressed: true` is the MAXIMAL latch — the gate consults
  /// it before the dismissal and before every counter — so the record this
  /// writes is at least as restrictive as anything the unreadable bytes could
  /// have encoded. Refusing the write is the only option that could lose an
  /// objection, and losing an objection is the one outcome Art 21(3) forbids
  /// outright.
  ///
  /// ⬜ NOT YET SURFACED, AND SAID OUT LOUD RATHER THAN LEFT TO BE NOTICED.
  /// research/44 rung 4 is the objection surface — a `promo` purpose on the
  /// existing `ConsentPurpose` rail, presented in/beside the first card per
  /// Art 21(4). Until that lands the latch is honoured everywhere it is read
  /// and set from nowhere, so this method has no UI caller. That is a real gap
  /// and it belongs to rung 4; what it is NOT is a reason to leave the latch
  /// out of the primitive, because retrofitting an objection across fifty
  /// shipped apps is the expensive path.
  Future<void> objectToPromotion() async {
    final core.PromoGateState current = await _settled();
    await _persist(current.objectToPromotion());
  }
}

final AsyncNotifierProvider<PromoCardStateController, core.PromoGateState>
promoCardStateProvider =
    AsyncNotifierProvider<PromoCardStateController, core.PromoGateState>(
      PromoCardStateController.new,
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
  // 🔴 WITHOUT THIS THE INTERSTITIAL IS A DEAD END. `redirect` fires on
  // navigation, not on a provider settling, so a user who ticks the box on
  // `/reaccept-terms` changes the gate's answer and nothing re-runs the gate —
  // they sit on the screen they just completed. Exactly the defect
  // `refreshListenable` was added for when a session appeared, one gate later.
  //
  // It also covers HYDRATION: the first redirect runs while the store is still
  // being read and correctly declines to decide; this is what brings the router
  // back once the answer exists.
  //
  // 🔴 LISTEN TO THE PROVIDER THE REDIRECT READS — `legalReacceptanceNeeded
  // Provider`, THE DERIVED ONE, NOT `legalAcceptanceProvider` UNDERNEATH IT.
  // This line said `legalAcceptanceProvider` and the gate did not work at all
  // on a real launch. TRACED, not reasoned (2026-08-10, probe prints inside
  // this listener and inside the redirect):
  //
  //     PROBE legal listen fired null ->
  //     PROBE redirect loc=/onboarding … reaccept=null      ← STALE
  //     PROBE redirect loc=/home       … reaccept=null      ← STALE
  //
  // The bump fired and the redirect DID re-run — and read `null` both times,
  // because the listener is called while the SOURCE notifier is publishing its
  // new state and Riverpod has not yet recomputed the derived provider that
  // depends on it. The router then settled on `/home` for a signed-in user with
  // no acceptance on record: gated in principle, ungated in fact, on every
  // launch. A hand-called `router.refresh()` one frame later moved it, which is
  // what made this look like a go_router or pump-cadence problem for a whole
  // session — it is neither.
  //
  // ⚠️ THE ONBOARDING LIMB ABOVE NEVER HAD THE BUG, and the asymmetry is the
  // whole diagnosis: the redirect reads `onboardingSeenProvider` — the very
  // provider that limb listens to — so its listener cannot be early. The rule
  // this encodes: a refresh signal must be taken from the SAME provider whose
  // value the refreshed code reads. Listening one layer down buys a stale read
  // with no symptom at the listen site.
  //
  // Both directions are pinned from a pumped app in the
  // `legal-reacceptance-gated` chassis property, which navigates nowhere — a
  // pass there is exactly the claim that this line is what re-runs the gate.
  final _Bump legal = _Bump();
  ref.listen<bool?>(
    legalReacceptanceNeededProvider,
    (bool? _, bool? _) => legal.bump(),
  );
  // 🔴 A FOURTH SIGNAL, AND WITHOUT IT THE RECOVERY GATE NEVER FIRES ON A REAL
  // LAUNCH. The recovery event arrives while the user sits on whatever screen
  // the browser opened — nobody navigates — so `redirect` is never consulted and
  // the gate might as well not be written. The same defect the auth signal was
  // added for when a session appeared, and the legal signal one gate later.
  //
  // Listens to `passwordRecoveryProvider` — the provider the redirect READS —
  // per the rule the legal limb had to learn from a traced stale read: a
  // listener one layer down is called while the source is still publishing.
  final _Bump recovery = _Bump();
  ref.listen<bool>(
    passwordRecoveryProvider,
    (bool? _, bool _) => recovery.bump(),
  );
  // 🔴 A FIFTH SIGNAL, and it is the failure half of the fourth. The recovery
  // ARRIVAL can change without any session change at all: the seam turns a
  // failed exchange into `recoveryLinkFailed` (GlitchTip SUBLY-8, which used to
  // be a fatal crash), and nobody navigates when that lands either. Same rule as
  // every limb above — listen to the provider the redirect READS.
  final _Bump resetArrival = _Bump();
  ref.listen<core.PasswordResetArrivalReport>(
    passwordResetArrivalProvider,
    (core.PasswordResetArrivalReport? _, core.PasswordResetArrivalReport _) =>
        resetArrival.bump(),
  );
  ref.onDispose(onboarding.dispose);
  ref.onDispose(legal.dispose);
  ref.onDispose(recovery.dispose);
  ref.onDispose(resetArrival.dispose);
  return Listenable.merge(<Listenable>[
    ref.watch(authRefreshProvider),
    onboarding,
    legal,
    recovery,
    resetArrival,
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
