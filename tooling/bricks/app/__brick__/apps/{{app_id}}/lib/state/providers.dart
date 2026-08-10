import 'dart:async';
import 'dart:convert';
import 'dart:math';

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
// ThemeMode only — this file is state wiring, not UI, and a narrow `show` keeps
// it that way. Without the import the stamped app fails to compile, which no
// amount of analyzing the TEMPLATE would reveal: the template is mustache, not
// valid Dart, so only a real stamp can catch it. [pipeline C-16]
import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
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
  // 🔴 NON-NULL, AND THAT IS THE WHOLE POINT ([pipeline 7]P-9, [8]K-9). This
  // read `null` in the brick AND in apps/subly, so `contentPackProvider` below
  // had an empty antecedent everywhere and the entire pack rail was green by
  // inaction — the self-disabling shape K-16 was diagnosed for. A pack that
  // cannot be fetched yet still has to be ASKED for, or nothing ever exercises
  // the verifier, the hash check or the identity binding.
  //
  // Server-overridable: `AppConfig.contentPack` comes from the resolved runtime
  // config, so pointing a build at an immutable versioned path is a config
  // change rather than a release.
  contentPack: 'https://packs.nikatru.com/${AppConfig.appId}/latest',
  copy: const <String, String>{},
  minSupportedVersion: '1.0.0',
);

/// 🔴 [pipeline C-13] THE OFFLINE SIGNAL — TRUE ONLY AFTER A REQUEST HAS FAILED.
///
/// `OfflineNotice` shipped in the design system on 2026-07-28 and had **zero
/// consumers anywhere in the repository** until 2026-08-06; `offlineMessage` sat
/// in both ARB files with nothing reading it. That is the [pipeline C-6] shape
/// in its purest form — a screen that exists, is anchored, and which no user of
/// any stamped app could ever see — and `assert-screen-set.mjs` reported it
/// green because the register asked whether it EXISTED and never whether
/// anything reached it.
///
/// ⚠️ DRIVEN BY A FAILED REQUEST, NEVER BY A CONNECTIVITY PLUGIN, which is the
/// widget's own documented contract. Knowing the radio is on says nothing about
/// whether the API is reachable: a captive portal, a DNS failure, an origin
/// outage and airplane mode all look different to `connectivity_plus` and
/// identical to the user. The app already knows when a request failed.
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

/// Passes the fetch straight through and reports whether it succeeded.
///
/// A decorator rather than a change to [appConfigProvider]: the config's public
/// type is read in a dozen places, and widening it to carry a reachability flag
/// would make every consumer pay for a fact only one banner needs.

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

// ── THE CONTENT-PACK RAIL, WIRED ([pipeline 7]P-9 · [8]K-9 · [2]C-1) ─────────
//
// 🔴 WHAT WAS WRONG. `ContentPackLoader` existed, complete and well tested, with
// ZERO non-test call sites in the entire repository — its own class declaration
// and its constructor were the only occurrences outside `test/`. `PackVerifier`
// sat in `assert-seams-wired.mjs` as `wired: false`. So the pack rail was a
// fail-closed seam with no proven open path: every check passed, because
// refusing to serve a pack nobody asked for is correct. Nothing was red and
// nothing worked.
//
// These three providers are the consumer half. They are deliberately separate
// so a test can replace the SOURCE (the bytes) without replacing the LOADER
// (the verification) — swapping the loader would assert that a fake returns
// what the fake was told to return, which is how `PaywallGate` came to exist
// for months with no consumer.

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
///
/// 🔴 THE TYPE IS [core.ObservedFeatureFlags], AND IT IS NOT AN UPGRADE — it is
/// the only way a rollout is measurable at all ([pipeline 11]E-12). A raw
/// `core.FeatureFlags` decides on/off locally and tells nobody, so the treatment
/// group can only ever be re-derived later from a rollout percentage that has
/// since moved: percents are not versioned, so once ramped the past is gone.
/// The wrapper emits `variant_exposed{flag, variant, bucket}` on the FIRST read
/// of each flag per session, with the bucket coming from the same `flagBucket`
/// the decision used — two independent bucketing ids would attribute sessions to
/// the wrong arm with nothing ever looking wrong.
///
/// ⚠️ The `core.FeatureFlags` construction MUST stay inside the wrapper's
/// argument list. `tooling/ci/assert-flag-exposure.mjs` fails the build on a raw
/// one escaping, because a chassis that can read a flag silently is a chassis
/// where the next fifty stamped apps ship unmeasurable rollouts.
final FutureProvider<core.ObservedFeatureFlags> featureFlagsProvider =
    FutureProvider<core.ObservedFeatureFlags>((ref) async {
      final core.AppConfig cfg = await ref.watch(appConfigProvider.future);
      final String id = await ref.watch(installIdProvider.future);
      return core.ObservedFeatureFlags(
        flags: core.FeatureFlags(rollouts: cfg.flags, stableId: id),
        analytics: await ref.watch(analyticsProvider.future),
      );
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

// ─────────────────────────────────────────────────────────────────────────────
// G-12 FIRST-PARTY ANALYTICS + DPDP CONSENT ([ADR 011], stage 11).
//
// WHY THIS IS IN THE BRICK. Stage 11's charter is to answer is-it-working /
// is-it-converting / is-it-broken with NO per-app instrumentation work. That
// only holds if a stamped app is born with the rail. It was not: the whole rail
// existed only in apps/subly, so app #2 onwards measured nothing until somebody
// hand-rebuilt it — which is precisely the copy-per-app failure the chassis is
// for.
//
// 🔴 THE C-6 TRAP, AND HOW THIS AVOIDS IT. The last bug here was a fail-closed
// seam with no on-switch: `ConsentController.record` had zero call sites, so
// every event was silently discarded and NO TEST WENT RED, because refusing is
// the correct behaviour when consent is absent. So two things are true here and
// both are load-bearing:
//   1. `lib/app.dart` mounts `AnalyticsGate`, a REAL on-switch that asks the
//      question and calls [recordAnalyticsConsent].
//   2. [analyticsEnabledProvider] and [eventTransportProvider] are providers,
//      not inlined constants, SO THAT the open path can be exercised —
//      `test/chassis_properties_test.dart` flips the switch on and asserts an
//      event actually reaches a transport. A seam nobody has watched carry a
//      payload is a dead feature that reports healthy.
// ─────────────────────────────────────────────────────────────────────────────

/// 🔒 The privacy-policy version the consent prompt claims the user was shown.
///
/// MUST equal `data-policy-version` on `sites/nikatru/privacy.html`. Without
/// that equality a consent artifact proves someone tapped a button but not what
/// they were shown, which is the one thing the record exists to establish.
const String kPrivacyPolicyVersion = '2026-08-10';

/// 🔒 The Terms-of-Service version the sign-up clickwrap accepts.
///
/// ⚠️ NOT PINNED TO A PUBLISHED PAGE, and saying so is the point.
/// `kPrivacyPolicyVersion` above is checked against `data-policy-version` on
/// `sites/nikatru/privacy.html` by `assert-seams-wired.mjs`; `terms.html`
/// carries no machine-readable version marker, so there is nothing an
/// equivalent limb could compare against. A conditional check that passes when
/// the marker is absent is the assertion-that-cannot-fail this factory refuses
/// to stamp into every app it makes.
///
/// 🔴 BUMPING THIS PUTS AN INTERSTITIAL IN FRONT OF EVERY SIGNED-IN USER of
/// every stamped app. That is re-acceptance working — a MATERIAL-CHANGE flag
/// (research/43), never a version bump for its own sake.
const String kTermsVersion = '2026-08-01';

/// The pair the clickwrap accepts and the interstitial compares against. ONE
/// constant, so no caller can compare half the question.
const core.LegalVersions kLegalVersions = core.LegalVersions(
  terms: kTermsVersion,
  privacy: kPrivacyPolicyVersion,
);

/// The SHARED platform Worker: analytics ingest + the consent artifact ([ADR 020]).
///
/// Deliberately NOT [AppConfig.apiBaseUrl] and deliberately NOT per-app — every
/// app in the portfolio posts to the same host, which is what makes one query
/// answer "is the portfolio working" instead of six.
const String kPlatformBaseUrl = String.fromEnvironment(
  'PLATFORM_BASE_URL',
  defaultValue: 'https://platform.nikatru.com',
);

/// The marketing version stamped on BOTH events and consent artifacts.
///
/// Injected at BUILD time rather than read from `package_info_plus`, and that is
/// not a shortcut — it was measured. The plugin needs a platform round trip that
/// does NOT resolve inside a widget test's fake clock, so routing the consent
/// write through it made `recordAnalyticsConsent` hang forever: the prompt stayed
/// on screen, no artifact was ever written, and the only symptom was a test that
/// looked like a timing flake. A version string must never be able to block a
/// consent decision. It also resolves on web, where the force-update path's
/// [packageVersionProvider] can legitimately return null.
///
/// ONE source for all THREE, deliberately: two would let a consent record, the
/// events it authorises, and the crash report they accompany disagree about
/// which build produced them. It is an alias for [AppConfig.appVersion] rather
/// than a second `String.fromEnvironment('APP_VERSION')` for the same reason —
/// two spellings of the same define is one rename away from two values.
const String kAnalyticsAppVersion = AppConfig.appVersion;

/// Which of the six platforms this build runs on, for the analytics envelope.
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
/// 🔴 A FRESHLY STAMPED APP IS BORN WITH THIS OFF. [AppConfig.isBackendLive] is
/// false until the owner supplies real identity `--dart-define`s, so a demo
/// build and every widget test collect nothing and show no prompt — which is
/// required (a widget test must never reach the network). Making a build
/// collect for real is therefore an OWNER step, not an agent step, and this
/// comment is the visible marker the task asked for: **until those defines are
/// supplied the stamped app is instrumented but silent, by design.**
///
/// It is a provider rather than a bare `AppConfig.isBackendLive` read precisely
/// so that "silent by design" can be told apart from "broken": the property test
/// overrides it to true and drives a real event all the way to a transport.
final Provider<bool> analyticsEnabledProvider = Provider<bool>(
  (ref) => AppConfig.isBackendLive,
);

/// [pipeline K-15] The device-level opt-out (Global Privacy Control), as an
/// overridable seam. On Web this reads `navigator.globalPrivacyControl`; on the
/// other five platforms there is no such concept and it is always false.
final Provider<core.PrivacySignal> privacySignalProvider =
    Provider<core.PrivacySignal>((ref) => core.createPrivacySignal());

/// The DPDP consent seam, hydrated from disk. Resolves to `unknown` — which
/// blocks all collection — if the store is unreadable.
final FutureProvider<core.ConsentController> consentControllerProvider =
    FutureProvider<core.ConsentController>((ref) async {
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      // [pipeline K-15] The device-level opt-out is wired HERE, in the chassis,
      // so every stamped app honours Global Privacy Control with zero per-app
      // edits. On Web this reads `navigator.globalPrivacyControl`; on the other
      // five platforms there is no such concept and it is always false, so
      // nothing changes for them.
      final core.ConsentController c = core.ConsentController(
        store: kv,
        // A PROVIDER rather than a direct `createPrivacySignal()` call, for
        // the reason this file gives about every other switch: on the VM the
        // real signal is always false, so the honoured-GPC branch could not be
        // driven by any test and would be a seam nobody has watched carry a
        // payload. [research/44 rung 4] made that branch load-bearing for a
        // second purpose, so it needed to become reachable.
        privacySignal: ref.watch(privacySignalProvider),
      );
      await c.hydrate(core.ConsentPurpose.analytics);
      // [research/44 rung 4] The GDPR Art 21 objection to in-app
      // promotion rides the SAME controller. Hydrated here rather
      // than lazily at the first promo consult: a lazy read decides
      // the very first card against an unread store, and "we had not
      // loaded it yet" is no defence for processing someone objected
      // to. One extra key read at launch, no extra request, and born
      // into every stamped app rather than remembered per app.
      await c.hydrate(core.ConsentPurpose.promo);
      return c;
    });

/// Current analytics consent, for the UI to read.
final Provider<core.ConsentStatus> analyticsConsentProvider =
    Provider<core.ConsentStatus>((ref) {
      final core.ConsentController? c = ref
          .watch(consentControllerProvider)
          .valueOrNull;
      return c?.statusOf(core.ConsentPurpose.analytics) ??
          core.ConsentStatus.unknown;
    });

/// **Has this person objected to promotional processing?** (GDPR Art 21.)
///
/// The single read every promo surface consults. It answers `true` — objected —
/// in three different situations, and they are kept three because collapsing
/// them would hide the last one:
///
///   1. a stored `promo` artifact with `granted: false` — they used the control;
///   2. a live GPC signal — an automated objection under Art 21(5), which
///      [core.ConsentController] applies without writing an artifact;
///   3. 🔴 **the controller has not resolved yet.** `valueOrNull` is null for the
///      first frames of every launch, and a promo rendered in that window is
///      rendered against an objection nobody has read yet.
///      Unknown-because-unloaded is not the same as unknown-because-untouched,
///      and only the second may show. This is the one place they are told apart:
///      below this line `unknown` means "never objected" and PERMITS, because
///      the surface runs on legitimate interest and not on consent.
final Provider<bool> promoObjectedProvider = Provider<bool>((ref) {
  final core.ConsentController? c = ref
      .watch(consentControllerProvider)
      .valueOrNull;
  if (c == null) return true; // still loading — hold, do not show
  return core.PromoObjection(c).objected;
});

/// **Has the rail been read yet?** — the third state [promoObjectedProvider]
/// deliberately hides, exposed for the one caller that must not lose it.
///
/// 🔴 A GATE AND A CONTROL NEED OPPOSITE ANSWERS WHILE THE RAIL IS LOADING.
/// Case 3 above falls closed because a promotional surface rendered against an
/// unread objection is the outcome Art 21(3) forbids. A SETTINGS ROW that read
/// the same boolean would tell a person who has never objected "Offers are off"
/// on every launch — and a tap in that window calls `recordPromoObjection(ref,
/// objected: false)`, which writes AND uploads a `promo granted: true` artifact
/// recording a decision they never made. Falling closed protects someone from a
/// card; it does not license a claim about what they chose.
///
/// So the control reads BOTH: [promoObjectedProvider] for the value and this for
/// whether the value means anything yet. One derivation, two readings, and the
/// asymmetry written down once instead of inferred twice.
final Provider<bool> promoObjectionKnownProvider = Provider<bool>(
  (ref) => ref.watch(consentControllerProvider).valueOrNull != null,
);

/// Whether the consent question has been ANSWERED — distinct from answered yes.
///
/// `unknown` means two different things to two callers: to the recorder it means
/// "collect nothing" (correct), but to the UI it must mean "still ask" — and
/// while [consentControllerProvider] is resolving from disk the status also
/// reads `unknown`. Prompting on that would flash the sheet at every launch for
/// a user who already decided, so the UI keys off the RESOLVED controller.
final Provider<bool> consentDecidedProvider = Provider<bool>((ref) {
  final AsyncValue<core.ConsentController> c = ref.watch(
    consentControllerProvider,
  );
  if (!c.hasValue) return true; // still loading — do NOT prompt yet
  return c.requireValue.statusOf(core.ConsentPurpose.analytics) !=
      core.ConsentStatus.unknown;
});

/// Ships the consent artifact to the append-only server record. Discards when
/// the switch is off, so a widget test never reaches the network.
final Provider<core.ConsentTransport> consentTransportProvider =
    Provider<core.ConsentTransport>((ref) {
      if (!ref.watch(analyticsEnabledProvider)) {
        return const core.DiscardingConsentTransport();
      }
      return DioConsentTransport(platformBaseUrl: kPlatformBaseUrl);
    });

/// Ships event batches. A provider so the property test can watch a real event
/// arrive — see the C-6 note at the top of this section.
final Provider<core.EventTransport> eventTransportProvider =
    Provider<core.EventTransport>(
      (ref) => DioEventTransport(platformBaseUrl: kPlatformBaseUrl),
    );

/// The decision path, with no Riverpod and no Flutter in it.
///
/// Split out from [recordAnalyticsConsent] so it can be driven directly against
/// fakes. That is the point of the split rather than a nicety: the C-6 bug was
/// that nothing ever called [core.ConsentController.record], and a path only
/// reachable through a widget tree and three async providers is one nobody
/// writes a test for.
/// ⚠️ ONE DECISION PATH FOR EVERY PURPOSE, NOT ONE PER PURPOSE. [purpose] is a
/// parameter (defaulting to analytics, which is every pre-existing caller) so
/// the `promo` objection inherits this function's whole contract — the
/// append-only artifact, the policy-version stamp, the shared anon id, the
/// best-effort upload — instead of a second copy that drifts from it.
/// [pipeline C-3]: no capability exists twice, and in the template a fork is a
/// fork per stamped app.
Future<core.ConsentArtifact> applyConsentDecision({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool granted,
  core.ConsentPurpose purpose = core.ConsentPurpose.analytics,
  core.Analytics? analytics,
  String appVersion = kAnalyticsAppVersion,
  String? platform,
  DateTime? now,
}) async {
  final core.ConsentArtifact artifact = await controller.record(
    purpose,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
    anonId: anonId,
    now: now ?? DateTime.now(),
    appVersion: appVersion,
    platform: platform ?? analyticsPlatformName(),
  );
  // 🔴 WITHDRAWAL DROPS WHAT IS ALREADY QUEUED (DPDP §6(3)). Recording the
  // artifact above shuts new collection instantly — the recorder holds this same
  // controller — but the outbox still contains everything gathered under the old
  // grant, in memory AND on disk, and it would ship on the next flush. Stopping
  // the enqueue is not withdrawal; dropping the payload is. Born into the
  // template on purpose: a stamped app that had to remember this itself is a
  // compliance defect the factory would reproduce once per app.
  //
  // Before the upload, not after: the user's right to have it dropped does not
  // depend on the network being up.
  //
  // 🔴 SCOPED TO THE PURPOSE THE OUTBOX BELONGS TO. The queue holds ANALYTICS
  // events, so a `promo` objection must not empty it: objecting to being shown
  // an offer says nothing about analytics the person separately consented to,
  // and deleting it would destroy lawfully-held data on the strength of an
  // unrelated control. The opposite mistake — purging on every purpose "to be
  // safe" — is the one an untyped `if (!granted)` makes silently.
  if (!granted && purpose == core.ConsentPurpose.analytics) {
    await analytics?.purge();
  }
  // Best-effort by contract. The decision already applies on-device, so an
  // upload failure must never make the user's choice look rejected.
  await transport.send(appId: appId, artifact: artifact);
  return artifact;
}

/// Record the sign-up legal decisions: the BLOCKING terms acceptance and the
/// EXPRESS marketing-email opt-in, as two separate artifacts.
///
/// Split out from the widget for the same reason [applyConsentDecision] is: the
/// C-6 bug class is a decision path nothing ever calls, and a path reachable
/// only through a widget tree and three async providers is one nobody writes a
/// test for. Born into the template so a stamped app inherits the compliance
/// shape rather than reinventing it once per app.
///
/// 🔴 TWO ARTIFACTS, NEVER ONE. Bundling them makes the marketing opt-in a limb
/// of a consent the user cannot decline — the "optional consent riding on a
/// mandatory one" shape research/43 declined — and it makes the signups KV's
/// purpose limitation unprovable.
///
/// 🔴 THE DECLINE IS RECORDED TOO. `granted: false` for `marketing-email` is the
/// evidence that the box existed and was left unticked; an ABSENT row proves
/// nothing, because it is also what "we never asked" looks like. The artifact
/// carries an anon id, never the address.
///
/// 🔴 `marketingEmail` IS NULLABLE, AND NULL IS NOT FALSE. Null means THIS
/// SURFACE DID NOT ASK, so nothing is recorded for that purpose and the previous
/// decision stands. The re-acceptance interstitial passes null: it shows no
/// marketing box, and writing `granted: false` from it would silently
/// unsubscribe somebody for accepting a terms change.
///
/// The terms artifact's `policyVersion` is the COMPOSITE stamp, because a
/// terms-only change has to be visible to the re-acceptance check and cannot be
/// if only the privacy version is written down.
Future<core.ConsentArtifact> applyLegalAcceptance({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool? marketingEmail,
  core.LegalVersions versions = kLegalVersions,
  String appVersion = kAnalyticsAppVersion,
  String? platform,
  DateTime? now,
}) async {
  final DateTime at = now ?? DateTime.now();
  final String plat = platform ?? analyticsPlatformName();
  final core.ConsentArtifact terms = await controller.record(
    core.ConsentPurpose.terms,
    granted: true,
    policyVersion: versions.stamp,
    anonId: anonId,
    now: at,
    appVersion: appVersion,
    platform: plat,
  );
  // Best-effort by contract, exactly as the analytics decision is.
  await transport.send(appId: appId, artifact: terms);
  if (marketingEmail != null) {
    final core.ConsentArtifact marketing = await controller.record(
      core.ConsentPurpose.marketingEmail,
      granted: marketingEmail,
      policyVersion: versions.stamp,
      anonId: anonId,
      now: at,
      appVersion: appVersion,
      platform: plat,
    );
    await transport.send(appId: appId, artifact: marketing);
  }
  return terms;
}

/// Record the user's analytics decision, upload the artifact, and make the new
/// decision visible to everything watching.
///
/// The invalidate at the end is load-bearing, not tidiness:
/// [core.ConsentController.record] mutates the controller's own cache, so
/// Riverpod sees no new object and would never rebuild [analyticsProvider] — the
/// recorder would keep its stale fail-closed view and go on discarding for the
/// rest of the session, which is indistinguishable from the bug this wiring
/// exists to prevent. Invalidating re-reads the decision from disk, which also
/// proves the write landed.
Future<void> recordAnalyticsConsent(
  WidgetRef ref, {
  required bool granted,
}) async {
  final core.ConsentController controller = await ref.read(
    consentControllerProvider.future,
  );
  await applyConsentDecision(
    controller: controller,
    transport: ref.read(consentTransportProvider),
    appId: AppConfig.appId,
    // 🔒 THE SAME id feature flags bucket on. Minting a second one here would
    // make the rollout bucket and the analytics cohort impossible to join, which
    // silently renders every experiment unmeasurable — and it cannot be repaired
    // across installs already in the field.
    anonId: await ref.read(installIdProvider.future),
    granted: granted,
    // The LIVE recorder, read before the invalidate below disposes it. A
    // `valueOrNull` miss (analytics still resolving) is survivable and not a
    // hole: the rebuilt recorder's `hydrate` refuses to restore a queue under a
    // denied decision and deletes the persisted copy, so the disk half dies
    // either way.
    analytics: ref.read(analyticsProvider).valueOrNull,
  );
  ref.invalidate(consentControllerProvider);
}

/// Record the GDPR **Art 21 objection** to promotional processing, upload the
/// artifact, and make it visible to every promo surface. [objected] `true` =
/// stop; `false` = the person turned offers back on themselves.
///
/// It is [recordAnalyticsConsent]'s twin down to the invalidate, and it is a
/// separate function rather than a `purpose:` argument on that one for a reason
/// worth stating: the two are wired to different controls with different legal
/// bases, and one entry point would let a settings row pass the wrong purpose
/// and silently move the wrong decision. The SHARED half is
/// [applyConsentDecision], which is where the reuse belongs.
///
/// 🔴 `granted` IS INVERTED, ONCE, THROUGH A NAMED HELPER. The rail's field
/// means *may this purpose be processed*, so an objection is `granted: false`.
/// Spelling that inversion out at every call site is how one of them ends up
/// spelled the other way round; `core.PromoObjection.grantedForObjection` is
/// the one place it happens.
Future<void> recordPromoObjection(
  WidgetRef ref, {
  required bool objected,
}) async {
  final core.ConsentController controller = await ref.read(
    consentControllerProvider.future,
  );
  await applyConsentDecision(
    controller: controller,
    transport: ref.read(consentTransportProvider),
    appId: AppConfig.appId,
    // 🔒 The same install id every other artifact and event carries.
    anonId: await ref.read(installIdProvider.future),
    purpose: core.ConsentPurpose.promo,
    granted: core.PromoObjection.grantedForObjection(objected: objected),
    // No `analytics:` — see the purge note in [applyConsentDecision]. A promo
    // objection has no outbox of its own and must not empty anyone else's.
  );
  ref.invalidate(consentControllerProvider);
}

/// The analytics facade the app programs against.
///
/// Resolves to [core.NoOpAnalytics] while [analyticsEnabledProvider] is off, so
/// demo mode and tests are hermetic. When on, the recorder ITSELF still refuses
/// to collect until consent is granted — this provider being non-noop is NOT
/// consent.
final FutureProvider<core.Analytics> analyticsProvider =
    FutureProvider<core.Analytics>((ref) async {
      if (!ref.watch(analyticsEnabledProvider)) {
        return const core.NoOpAnalytics();
      }
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      final core.ConsentController consent = await ref.watch(
        consentControllerProvider.future,
      );
      final core.AnalyticsRecorder recorder = core.AnalyticsRecorder(
        appId: AppConfig.appId,
        // 🔒 Same id as the flag bucket — see [recordAnalyticsConsent].
        anonId: await ref.watch(installIdProvider.future),
        transport: ref.watch(eventTransportProvider),
        consent: consent,
        queueStore: kv,
        envelope: <String, Object?>{
          'platform': analyticsPlatformName(),
          'app_version': kAnalyticsAppVersion,
        },
      );
      // 🔴 THE RECORDER OWNS A TIMER NOW ([11]E-4a), SO SOMETHING MUST OWN THE
      // RECORDER. This provider is rebuilt every time a consent decision lands
      // (`recordAnalyticsConsent` invalidates `consentControllerProvider`), and
      // without this the discarded recorder's armed deadline outlives it. In a
      // `testWidgets` body that is not a leak that goes unnoticed — it is an
      // outright failure ("A Timer is still pending even after the widget tree
      // was disposed") attributed to the stamped app.
      //
      // It is also what stops `AnalyticsRecorder.dispose` from being a method
      // with no call site, which is the shape `assert-seams-wired` exists to
      // catch: an implementation nobody calls does nothing, quietly.
      ref.onDispose(recorder.dispose);
      await recorder.hydrate();
      return recorder;
    });

/// Record [event].
///
/// AWAITS the provider rather than reading `.valueOrNull` and giving up. At
/// launch [analyticsProvider] is still resolving, so a `valueOrNull` read would
/// silently drop exactly the launch events the funnel's denominator is made of —
/// the metric would look like a conversion problem rather than a wiring one.
/// It does NOT await the network: the recorder queues and ships in batches.
Future<void> logEvent(
  WidgetRef ref,
  String event, {
  Map<String, Object?>? params,
}) async {
  final core.Analytics analytics = await ref.read(analyticsProvider.future);
  await analytics.log(event, params: params);
}

/// 🔴 THE LAUNCH TRIO ([pipeline 11]E-5). `first_launch` · `app_open` ·
/// `return_visit` — all three, from the CHASSIS, so a stamped app inherits them
/// with zero per-app instrumentation edits.
///
/// The brick used to log `app_open` here and nothing else: 1 of the 3 lifecycle
/// events the taxonomy requires, with the property test asserting only the one
/// that existed. `first_launch` is the denominator every activation and
/// retention number is divided by, so an app without it is not partly
/// instrumented — it is unmeasurable.
///
/// The rule and the persistence live in [core.AnalyticsLifecycle] rather than
/// here so they are ONE implementation for fifty stamps, and so "once per
/// install, ever" is testable without a widget tree.
///
/// Uses the SAME storage seam as everything else the chassis persists —
/// [keyValueStoreProvider] — so no app acquires a dependency to be measured.
///
/// ⚠️ CONSENT IS THE CALLER'S JOB, and its only caller is `AnalyticsGate`. Do
/// not call this anywhere a consent decision has not already been granted.
Future<void> logLaunchLifecycle(WidgetRef ref) async {
  final core.Analytics analytics = await ref.read(analyticsProvider.future);
  final core.KeyValueStore kv = await ref.read(keyValueStoreProvider.future);
  await core.AnalyticsLifecycle(analytics: analytics, store: kv).onLaunch();
}

String _generateInstallId() {
  final Random rng = Random.secure();
  final List<int> bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  return bytes.map((int b) => b.toRadixString(16).padLeft(2, '0')).join();
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY ([pipeline C-15]).
//
// The app programs against core's `AuthRepository`. The Supabase SDK is imported
// by exactly ONE package — `nikatru_auth_supabase` — so swapping identity
// providers means writing one more implementation of the seam, not touching a
// single screen. `assert-package-boundaries.mjs` fails the build if an app
// reaches for `package:supabase_flutter` directly.
//
// 🔴 WIRED, NOT MOCKED. A stamped app with no Supabase project still gets a REAL
// implementation — `InMemoryAuthRepository` signs in, holds a session, emits on
// authStateChanges, expires and signs out. The alternative is a stub that
// returns null from everything, which is the fail-closed shape [pipeline C-6]
// exists to catch: every test passes because refusing is correct when nothing is
// configured, and the open path is never exercised.
// ─────────────────────────────────────────────────────────────────────────────

/// The identity seam. Real Supabase once the owner supplies the identity
/// `--dart-define`s; a real in-memory implementation until then.
///
/// 🔴 G2 · `requestServerDeletion` IS WHAT MAKES "DELETE ACCOUNT" A BUTTON THAT
/// DELETES. It was hard-coded to `null` on the grounds that the server route was
/// stage 4's and did not exist — but the SAME brick stamps it
/// (`services/{{app_id}}-api/src/routes/account.ts`, mounted behind the
/// Supabase-JWT middleware). So every account-bearing backend-live stamp shipped
/// a Delete Account control that took the refusal branch every single time: the
/// user was signed OUT and never deleted. Both stores require a WORKING in-app
/// deletion path wherever an account can be created.
///
/// `ref.read` INSIDE the closure, not at build time: [restClientProvider]
/// watches [authTokenProvider], which reads this provider, so resolving the
/// client out here would be a cycle. Deletion happens long after both exist.
///
/// 🔴 `requestAccountDeletion`, NOT a bare `delete('/account')`, and the
/// difference is the honesty of the message the user finally sees. A bare call
/// throws `ApiException`, `deleteAccount` wraps it in an `AuthFailure`, and by
/// the time the screen catches it the STATUS is a substring of a sentence — so
/// 501 (nothing was deleted) and 502 (the data is gone, the login is not) arrive
/// indistinguishable. The helper maps the status ONCE, at the only layer that
/// still has it, into a `core.AccountDeletionFailure` that names the outcome.
/// [ADR 027].
final Provider<core.AuthRepository>
authRepositoryProvider = Provider<core.AuthRepository>((ref) {
  if (!AppConfig.isBackendLive) return InMemoryAuthRepository();
  return SupabaseAuthRepository(
    requestServerDeletion: () =>
        requestAccountDeletion(ref.read(restClientProvider)),
    // 🔴 WITHOUT THIS THE RESET MAIL POINTS AT THE PROJECT'S SITE URL, which
    // is ONE URL for the whole portfolio — so a stamped app's users would
    // follow their reset link into a DIFFERENT app. Nothing inside this app
    // could see it: the mail sends, the link resolves, the page loads.
    //
    // Resolved from the running origin rather than compiled in, so a preview
    // deployment and a local run each send their own users back to
    // themselves. Off web it is null — no native target here registers a URI
    // scheme yet — and null means "fall back to the Site URL", which for a
    // native build is at least a page that exists.
    passwordResetRedirectTo: passwordResetRedirectUrl(
      isWeb: kIsWeb,
      base: Uri.base,
    ),
  );
});

/// Whether a PASSWORD-RECOVERY session is in flight.
///
/// 🔴 THE ROUTER CANNOT ANSWER THIS FROM ANYTHING ELSE. A user who follows a
/// reset link is handed a real session, so `currentUser`, `currentSession()` and
/// `authStateChanges()` all report an ordinary sign-in — identical in every
/// observable respect to somebody typing their password. The reason exists only
/// on the `AuthEvent` at the instant it is delivered, and the adapter used to
/// map it away. This provider is the one place that reason is kept.
///
/// ⚠️ THE TWO ARMS ARE THE WHOLE STATE MACHINE, AND THE SILENT ARMS ARE
/// DELIBERATE:
///   · `passwordRecovery` ARMS it — the gate then holds the user on
///     `/reset-password` however they navigate;
///   · `signedOut` RELEASES it, and that is the ONLY release. `ResetPasswordScreen`
///     signs out to leave, so completing and abandoning take the same exit and
///     there is no second code path to keep in step;
///   · `userUpdated` must NOT release it — that event fires the moment the new
///     password lands, and releasing there would tear the confirmation page down
///     under the user;
///   · `signedIn` must NOT release it either — gotrue can follow a recovery with
///     an ordinary arrival event, and releasing on one would drop somebody out
///     of the form mid-typing.
///
/// Synchronous (a plain `bool`, not an `AsyncValue`) because the redirect guard
/// that reads it cannot await — the same reason the seam exposes `currentUser`
/// separately from `currentSession()`.
class PasswordRecoveryController extends Notifier<bool> {
  @override
  bool build() {
    final core.AuthRepository auth = ref.watch(authRepositoryProvider);
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
        state = const core.PasswordResetArrivalReport(core.PasswordResetArrival.pending);
      }
    });
    ref.onDispose(sub.cancel);
    return passwordResetArrivalOf(ref.watch(launchUriProvider));
  }

  /// The one release. Called by the screen when the user leaves it, so a dead
  /// link does not park them on `/reset-password` for the rest of the session.
  void clear() => state = core.PasswordResetArrivalReport.none;
}

final NotifierProvider<PasswordResetArrivalController, core.PasswordResetArrivalReport>
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

/// The bearer token every API call carries. This is the shape [RestClient]
/// takes, which is why it returns a token rather than a session: the HTTP layer
/// has no business knowing about refresh.
/// Exposed as a PROVIDER rather than a bare function so a test can read the
/// exact object [restClientProvider] is constructed with. A test that rebuilt an
/// equivalent closure would pass while the client was wired to something else,
/// which is the whole failure this property exists to rule out.
final Provider<Future<String?> Function()> authTokenProvider =
    Provider<Future<String?> Function()>(
      (ref) =>
          () => ref.read(authRepositoryProvider).currentAccessToken(),
    );

/// The shared REST client, authenticated.
///
/// [pipeline C-15] THE ACCEPTANCE CRITERION IN ONE LINE: a `tokenProvider`
/// reaches the shared REST client. Without this the seam exists and no request
/// ever carries a token — the app authenticates and the backend never knows.
///
/// 🔴 A 401 IS NOT PROOF THE SESSION IS GONE, and treating it as proof logged
/// people out. This used to sign out unconditionally. An access token that
/// merely EXPIRED looks identical from the Worker's chair, and expiry is routine
/// — the SDK stops its refresh ticker while the app is paused and restarts it
/// asynchronously on resume, so the first request of the frame after a resume
/// carries a stale token by design. The user came back to the app and was
/// thrown out of it, on an OAuth account with no easy way back in.
///
/// So the decision moved into [signOutOnlyIfSessionIsGone], which is a NAMED
/// function rather than an inline closure precisely so a test can drive it: the
/// old closure lived inside `RestClient` where nothing could reach it, which is
/// why a rule this consequential shipped with no assertion at all.
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
/// 🔴 THIS IS A SEPARATE FUNCTION FROM [forgetSignedInUser] BECAUSE READING A
/// PROVIDER HAS A DEADLINE AND RUNNING A DROP DOES NOT — and the first shape of
/// this fix got that wrong in the one way that made it do nothing.
/// `WidgetRef.read` calls `_assertNotDisposed()`, which THROWS
/// `StateError('Cannot use "ref" after the widget was disposed.')` in release
/// (flutter_riverpod 2.6.1 `consumer.dart:548-551` — a real throw, not an
/// `assert`). A sign-out emits on the auth stream BEFORE its network leg
/// finishes, the router then replaces the shell the settings screen lives in,
/// and that screen's element is gone — so a `ref.read` placed AFTER
/// `await signOut()` threw on exactly the slow connection the fix was for:
/// nothing was cleared, and the user was told a successful sign-out had failed.
/// Resolve the drops FIRST, then await. Callers cannot get this wrong by
/// accident any more, because [forgetSignedInUser] takes the resolved list and
/// never a `ref`.
List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[
  ref.read(entitlementCacheProvider).clear,
  ref.read(notificationServiceProvider).cancelAll,
];

/// Run the resolved drops — the half that is allowed to take as long as it likes.
///
/// 🔴 EVERY DROP IS ATTEMPTED EVEN AFTER ONE THROWS, and the FIRST failure is
/// rethrown once they all have been. Returning early leaves exactly the
/// half-forgotten state this exists to prevent (cache gone, reminders still
/// firing); swallowing restores the defect it fixes. The caller decides what to
/// say about it — see the sign-out handler in `settings_screen.dart`.
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
/// it can neither delete the session nor tombstone it, so a throw here is the
/// case where local state is MOST likely to outlive the user, not least. The
/// cost of clearing for a session that turns out to have survived is one server
/// read that puts the entitlement straight back.
///
/// 🔴 WHICH SESSION-ENDING PATHS RUN IT, COUNTED RATHER THAN ASSERTED. This doc
/// said "both paths (the sign-out control and account deletion)" and there were
/// FOUR user-facing ones in this template; the two it did not name went on
/// leaking the previous user's Pro, and the sentence is how the next reader
/// stops looking. All four go through this function or through
/// [forgetSignedInUser] today:
///   1. Settings → sign out (`settings_screen.dart`, `_signOut`);
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

/// Turns the auth stream into something `GoRouter` will listen to.
///
/// 🔴 [pipeline C-13] WITHOUT THIS, SIGNING IN LEAVES THE USER ON THE FORM.
/// `sign_in_screen.dart` deliberately does not navigate — pushing from both the
/// screen and the redirect guard is how two routes end up racing to be top of
/// the stack — and its comment said the guard "moves the user the moment the
/// session appears". It did not. `redirect` re-runs when the router is TOLD to,
/// and nothing in the brick was watching [core.AuthRepository.authStateChanges],
/// so a freshly stamped app signed the user in and then went on showing them the
/// form they had just completed. The session was real; the app looked broken.
///
/// Found 2026-07-29 by driving the form in a widget test rather than by reading
/// the code. It is the [pipeline C-6] shape once more — every part worked and
/// nothing joined them — and it passed `assert-screen-set` because that guard
/// checks the redirect guard EXISTS, which was never the thing in doubt.
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

/// The signed-in user as a STREAM, so a screen showing their details updates
/// when those details change.
///
/// 🔴 SEEDED WITH THE SNAPSHOT, and that is load-bearing.
/// [core.AuthRepository.authStateChanges] emits on CHANGE, so a screen built
/// while the user is already signed in would sit on `AsyncLoading` — and
/// therefore render as signed-out — until the next event, which on a settled
/// session never comes.
///
/// Distinct from [authRepositoryProvider]'s synchronous `currentUser`, which is
/// the right read for a redirect guard (it cannot await) and the wrong one for
/// UI: it never rebuilds, so a name edited in place would go on showing the old
/// value. [pipeline C-13]
final StreamProvider<core.AuthUser?> authUserProvider =
    StreamProvider<core.AuthUser?>((ref) async* {
      final core.AuthRepository auth = ref.watch(authRepositoryProvider);
      yield auth.currentUser;
      yield* auth.authStateChanges();
    });

/// The router's refresh signal. One per container, disposed with it.
final Provider<AuthRefreshNotifier> authRefreshProvider =
    Provider<AuthRefreshNotifier>((ref) {
      final AuthRefreshNotifier notifier = AuthRefreshNotifier(
        ref.watch(authRepositoryProvider).authStateChanges(),
      );
      ref.onDispose(notifier.dispose);
      return notifier;
    });

const String _remindersKey = 'nikatru.reminders_enabled';

/// The id of the one daily reminder the chassis schedules.
///
/// STABLE ON PURPOSE: `scheduleDaily` replaces an existing notification with the
/// same id, so re-arming it can never accumulate duplicates, and the OFF path
/// has something specific to cancel.
const int kDailyReminderId = 1;

/// Whether the user has turned reminders on, persisted.
///
/// [pipeline C-13] Separate from the OS permission on purpose. The OS can revoke
/// permission at any time from system settings, and the app finds out only when
/// it next tries — so this stores the user's INTENT, and the platform's answer
/// is asked for fresh each time it matters. Conflating the two is how a toggle
/// reads ON while every notification is silently dropped.
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
    // one `SwitchListTile.onChanged` — so ANY second writer of the flag (a
    // settings sync, a restore, a future prefs screen, the refusal branch below)
    // set the switch to OFF and left every schedule armed. The reconciler hangs
    // off the STORED INTENT now, so whoever writes it, the OS is told.
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
  /// Without this, "reminders are on" degrades silently to "reminders were on
  /// once", and nothing in the app or the tests would ever say so.
  ///
  /// It is also the OFF repair path — an intent of `false` re-asserts the cancel,
  /// so a store restored from a backup that carries OFF cannot leave a schedule
  /// alive from the install that made it.
  ///
  /// ⚠️ IT NEVER CALLS `requestPermission()`, and the property test asserts the
  /// count is zero across a full boot. Android 13+ makes a SECOND denial
  /// permanent (`USER_FIXED`, non-promptable), so spending the ask on a launch
  /// the user did not initiate is not a papercut — it can burn the permission for
  /// the life of the install. The ask stays in the in-context path behind the
  /// priming dialog.
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
  /// `requestPermission()` and store the answer, and nothing else — no `init()`,
  /// no `scheduleDaily`, no call site for either anywhere in the template. So
  /// every stamped app primed the user, spent the ONE OS permission prompt most
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
      // Routing the OFF path through the persisted intent is what makes "off"
      // true for every writer of the flag rather than only for this switch.
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
/// live platform today. The settings screen is already honest about it (it
/// refuses to offer a switch it cannot honour); this is the other half, which
/// says the reminder's moment passed the next time the app is opened.
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

const String _localeKey = 'nikatru.locale';

/// The user's language choice, persisted — [pipeline C-13].
///
/// 🔴 NULL MEANS "FOLLOW THE DEVICE", and that is the important state. Storing a
/// concrete locale as the default would freeze every app to whatever language
/// the first launch happened to see, and a user who later changes their phone's
/// language would find the app ignoring them. So null is the default and is a
/// real, selectable option — not merely the absence of a choice.
///
/// Same background-hydrate shape as [ThemeModeController], for the same reason:
/// first paint must never block on disk, and hydration must never clobber a
/// choice the user made while it was in flight.
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

// ─────────────────────────────────────────────────────────────────────────────
// STORE REVIEW ([pipeline C-13]).
//
// 🔴 THE REFUSAL THIS REPLACES said "there are no users to ask" — an argument
// about WHEN, not about whether the mechanism can be built and proven. WHEN is
// `core.ReviewGate`, which is pure arithmetic over four persisted numbers and
// is decidable today with no users at all.
//
// ⚠️ THE ONE-CHANCE PROBLEM. iOS ignores requests beyond roughly three a year
// WITHOUT SAYING SO: the call returns normally and nothing appears. So asking at
// a bad moment does not annoy anybody — it silently spends the app's remaining
// requests on a dialog nobody sees. Everything below exists to make that
// unspendable by accident.
// ─────────────────────────────────────────────────────────────────────────────

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
///
/// Starts EMPTY and hydrates in the background, like every other persisted
/// controller here. An unreadable store leaves the state empty, which the gate
/// reads as a fresh install — never as "long ago, safe to ask".
class ReviewPromptController extends Notifier<core.ReviewGateState> {
  /// 🔴 EVERY MUTATOR AWAITS THIS, and it is not tidiness — the property test
  /// caught the bug. The other persisted controllers here guard hydration with a
  /// `_userChose` flag, which is right for a CHOICE: last writer wins, and the
  /// user is the last writer. These are COUNTERS, and for a counter that rule
  /// loses data. `recordLaunch()` fired from the app's first frame while
  /// `_hydrate()` was still in flight, incremented the EMPTY default to 1, and
  /// then hydration completed and overwrote it with the stored 20 — so the
  /// launch went uncounted and the write was silently discarded. On a device
  /// that is one lost launch per cold start, forever, and the gate would take
  /// far longer to open than the rule says.
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

const String _onboardingSeenKey = 'nikatru.onboarding_seen';

/// Whether first-run onboarding has been completed or skipped — [pipeline C-13].
///
/// Persisted, because the cost of getting this wrong is asymmetric: showing it
/// twice is an irritation, and showing it never is a user who was dropped into
/// an app nobody introduced. So it starts FALSE and hydrates in the background,
/// which means a fresh install shows onboarding and a slow disk shows it again
/// rather than skipping it.
///
/// Same background-hydrate shape as the other persisted controllers, and the
/// same `_userChose` guard: hydration must never clobber a choice made while it
/// was in flight. (This one IS a choice, not a counter — see
/// [ReviewPromptController], where that distinction cost a lost launch on every
/// cold start.)
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

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL ACCEPTANCE (research/43 riders, owner 2026-08-09)
//
// The clickwrap the user ticked at sign-up, and the interstitial that asks
// again when the documents materially change. ONE store, ONE artifact, ONE
// append-only trail: this reads the SAME `ConsentController` every other
// purpose is recorded through rather than minting a second private key that can
// drift from the record the server holds.
// ─────────────────────────────────────────────────────────────────────────────

/// The `LegalVersions.stamp` the signed-in user last accepted.
///
/// 🔴 THREE STATES, EXACTLY AS [OnboardingSeenController] HAS THREE, AND FOR
/// THE SAME MEASURED REASON — hydration is async and the router's redirect runs
/// before the disk read lands:
///   · `null`  — not known yet; the redirect DECLINES TO DECIDE. A `''` default
///     flashes the interstitial at every launch for a user who accepted months
///     ago, and nothing re-runs the redirect on its own.
///   · `''`    — read, and nothing was ever accepted.
///   · a stamp — read, and this is what they agreed to.
///
/// ⚠️ ONLY A GRANTED ARTIFACT COUNTS. Reading a `granted: false` terms artifact's
/// version would turn "I declined" into "I accepted this version". The clickwrap
/// never records a decline today — it blocks instead — but the store is
/// append-only and shared, so the reader must not depend on a writer's manners.
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
      await applyLegalAcceptance(
        controller: controller,
        transport: ref.read(consentTransportProvider),
        appId: AppConfig.appId,
        anonId: await ref.read(installIdProvider.future),
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
/// Null means "cannot tell yet" and the router must decline to decide.
final Provider<bool?> legalReacceptanceNeededProvider = Provider<bool?>((ref) {
  final String? accepted = ref.watch(legalAcceptanceProvider);
  if (accepted == null) return null;
  return core.needsLegalReacceptance(
    acceptedStamp: accepted,
    current: kLegalVersions,
  );
});

/// A ChangeNotifier something outside it can fire. `notifyListeners` is
/// protected, which is the right default and the wrong one for a bridge whose
/// entire job is to be fired from elsewhere.
class _Bump extends ChangeNotifier {
  void bump() => notifyListeners();
}

/// What the router listens to — [pipeline C-13].
///
/// TWO signals, merged, because the redirect depends on two things that arrive
/// at different times: the session (auth) and the first-run flag (disk). The
/// first version listened only to auth, so the onboarding flag could resolve and
/// the router would never look again.
final Provider<Listenable> routerRefreshProvider = Provider<Listenable>((ref) {
  final _Bump onboarding = _Bump();
  ref.listen<bool?>(
    onboardingSeenProvider,
    (bool? _, bool? __) => onboarding.bump(),
  );
  // 🔴 A THIRD SIGNAL, AND WITHOUT IT THE INTERSTITIAL IS A DEAD END. `redirect`
  // fires on navigation, not on a provider settling, so a user who ticks the box
  // on `/reaccept-terms` changes the gate's answer and nothing re-runs the gate
  // — they sit on the screen they just completed. Same defect the auth signal
  // was added for, one gate later. It also covers HYDRATION: the first redirect
  // runs while the store is still being read and correctly declines to decide.
  //
  // 🔴 IT LISTENS TO THE PROVIDER THE REDIRECT READS — the DERIVED
  // `legalReacceptanceNeededProvider`, NOT `legalAcceptanceProvider` underneath
  // it. This line said `legalAcceptanceProvider` for one day and the gate did
  // not work at all on a real launch. TRACED in the app tree (2026-08-10, probe
  // prints inside this listener and inside the redirect):
  //
  //     PROBE legal listen fired null ->
  //     PROBE redirect loc=/onboarding … reaccept=null      ← STALE
  //     PROBE redirect loc=/home       … reaccept=null      ← STALE
  //
  // The bump fired and the redirect DID re-run — and read `null` both times,
  // because the listener is called while the SOURCE notifier is publishing its
  // new state and Riverpod has not yet recomputed the provider derived from it.
  // A signed-in user with no acceptance on record then settled on home: gated in
  // principle, ungated in fact, on every launch. A hand-called `router.refresh()`
  // one frame later moved it, which is what made this look like a go_router or a
  // pump-cadence problem — it is neither.
  //
  // ⚠️ THE ONBOARDING LIMB ABOVE NEVER HAD THE BUG, and the asymmetry is the
  // diagnosis: the redirect reads `onboardingSeenProvider`, which is the very
  // provider that limb listens to, so its listener cannot be early. The rule
  // this encodes for any future signal added here: take the refresh signal from
  // the SAME provider whose value the refreshed code reads. Listening one layer
  // down buys a stale read with no symptom at the listen site.
  final _Bump legal = _Bump();
  ref.listen<bool?>(
    legalReacceptanceNeededProvider,
    (bool? _, bool? __) => legal.bump(),
  );
  // 🔴 A FOURTH SIGNAL, AND WITHOUT IT THE RECOVERY GATE NEVER FIRES. The
  // recovery event arrives while the user is sitting on whatever screen the
  // browser opened — nobody navigates — so `redirect` is not consulted and the
  // gate below it might as well not exist. Exactly the defect the auth signal
  // was added for, two gates later.
  //
  // 🔴 IT LISTENS TO THE PROVIDER THE REDIRECT READS, per the rule the legal
  // limb had to learn the hard way: `passwordRecoveryProvider` itself, never
  // `authRepositoryProvider` underneath it. A listener one layer down is called
  // while the source is still publishing, and the derived read comes back stale
  // with no symptom at the listen site.
  //
  // ⚠️ `__` FOR THE SECOND PARAMETER, NOT A REPEATED `_`. The stamped app
  // resolves at a language version where a wildcard may not repeat in one
  // parameter list, and `(bool? _, bool _)` is `Error: '_' is already declared
  // in this scope` — a HARD COMPILE FAILURE of every stamped app. It cannot be
  // seen by analyzing this template, because the template is mustache and not
  // valid Dart; it was found by stamping. Same trap as the [pipeline C-16] note
  // on the `Locale, ThemeMode` import above, and `apps/subly` writes the single
  // `_` legitimately because it resolves higher.
  final _Bump recovery = _Bump();
  ref.listen<bool>(
    passwordRecoveryProvider,
    (bool? _, bool __) => recovery.bump(),
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
