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
const String kPrivacyPolicyVersion = '2026-07-26';

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

/// The DPDP consent seam, hydrated from disk. Resolves to `unknown` — which
/// blocks all collection — if the store is unreadable.
final FutureProvider<core.ConsentController> consentControllerProvider =
    FutureProvider<core.ConsentController>((ref) async {
      final core.KeyValueStore kv = await ref.watch(
        keyValueStoreProvider.future,
      );
      final core.ConsentController c = core.ConsentController(store: kv);
      await c.hydrate(core.ConsentPurpose.analytics);
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
Future<core.ConsentArtifact> applyConsentDecision({
  required core.ConsentController controller,
  required core.ConsentTransport transport,
  required String appId,
  required String anonId,
  required bool granted,
  String appVersion = kAnalyticsAppVersion,
  String? platform,
  DateTime? now,
}) async {
  final core.ConsentArtifact artifact = await controller.record(
    core.ConsentPurpose.analytics,
    granted: granted,
    policyVersion: kPrivacyPolicyVersion,
    anonId: anonId,
    now: now ?? DateTime.now(),
    appVersion: appVersion,
    platform: platform ?? analyticsPlatformName(),
  );
  // Best-effort by contract. The decision already applies on-device, so an
  // upload failure must never make the user's choice look rejected.
  await transport.send(appId: appId, artifact: artifact);
  return artifact;
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
/// A non-2xx — including the 501 the route returns when it cannot delete the
/// IDENTITY record — throws `ApiException`, which `deleteAccount` turns into an
/// `AuthFailure`. The honest refusal is preserved; it has just moved to the end
/// of a chain that can actually succeed.
final Provider<core.AuthRepository> authRepositoryProvider =
    Provider<core.AuthRepository>((ref) {
      if (!AppConfig.isBackendLive) return InMemoryAuthRepository();
      return SupabaseAuthRepository(
        requestServerDeletion: () =>
            ref.read(restClientProvider).delete('/account'),
      );
    });

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
Future<void> signOutOnlyIfSessionIsGone(core.AuthRepository auth) async {
  if (await auth.currentAccessToken() == null) {
    await auth.signOut();
  }
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
  }
}

final NotifierProvider<RemindersEnabledController, bool>
remindersEnabledProvider = NotifierProvider<RemindersEnabledController, bool>(
  RemindersEnabledController.new,
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
final Provider<core.ReviewPrompter> reviewPrompterProvider =
    Provider<core.ReviewPrompter>((ref) => InAppReviewPrompter());

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
  ref.onDispose(onboarding.dispose);
  return Listenable.merge(<Listenable>[
    ref.watch(authRefreshProvider),
    onboarding,
  ]);
});
