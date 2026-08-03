/// Runtime configuration for {{{display_name}}}.
///
/// Secrets arrive via --dart-define at build time; nothing sensitive is
/// committed. Left at placeholders, the app runs in demo mode.
class AppConfig {
  AppConfig._();

  static const String appId = '{{app_id.snakeCase()}}';
  static const String appName = '{{{display_name_dart}}}';
  static const String category = '{{category}}';

  /// Marketing version of THIS build. Injected at build time
  /// (`--dart-define=APP_VERSION`) rather than read from `package_info_plus`,
  /// so it also resolves on the web build and inside `flutter test`, neither of
  /// which can await a platform channel. `assert-app-versioning.mjs` is what
  /// keeps the release lane passing a derived, monotonic value here.
  static const String appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: 'dev',
  );

  /// What crash reports are grouped and triaged by ([telemetryRelease] is the
  /// Sentry/GlitchTip `release`).
  ///
  /// 🔴 IT MUST NAME THIS APP. The brick used to hand `release` a hard-coded
  /// string literal naming the CI throwaway probe and a frozen 0.1.0 — a
  /// literal survives stamping unchanged, so all fifty apps would have reported
  /// the probe's identity to the ONE shared GlitchTip project. The moment a
  /// second app crashed there would be no way to tell whose crash it was, and
  /// nothing about that is visible from inside a single app: it analyzes,
  /// builds and reports successfully, just under someone else's name.
  ///
  /// Composed from the two consts above so it cannot drift from either: the id
  /// is stamped once, and the version moves with every release.
  static const String telemetryRelease = '$appId@$appVersion';

  // Shared NIKATRU identity (all apps inherit).
  static const String companyName = 'Nikatru';
  static const String companyUrl = 'https://nikatru.com';
  static const String supportEmail = 'support@nikatru.com';
  // 🔴 THE SET HERE MUST EQUAL `LEGAL_PAGES` IN check-site-integrity.mjs
  // ([pipeline 8]K-6). It declared TWO while the site publishes FOUR, so every
  // stamped app shipped a legal surface that silently omitted the refund policy
  // — the one page a store reviewer opens when a purchase is disputed, and the
  // one a paying user needs. `assert-stamp-properties.mjs` now asserts the two
  // sets are equal in BOTH directions, so publishing a fourth page without
  // linking it, or dropping one of these, fails the build.
  static const String privacyUrl = 'https://nikatru.com/privacy.html';
  static const String termsUrl = 'https://nikatru.com/terms.html';
  static const String refundUrl = 'https://nikatru.com/refund.html';

  // The API this app calls. Soft via CFG: the host can change with no app
  // release (API_BASE_URL --dart-define overrides the default).
  //
{{#needs_backend}}  // Stamped with needs_backend=true, so this app has its OWN Worker
  // (services/{{app_id}}-api) holding its private D1. Shared concerns — config,
  // analytics, entitlements — still come from the platform Worker.
{{/needs_backend}}{{^needs_backend}}  // This app is CLIENT-ONLY: it stamps no Worker and no database, and points
  // straight at the ONE shared platform Worker. That is the default on purpose
  // — D1 Free allows 10 databases per ACCOUNT in total, so a per-app database
  // is a scarce resource, not a default.
{{/needs_backend}}  static const String _phApiBase = '{{{api_base_url}}}';
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: _phApiBase,
  );

  // Runtime config service (CFG-1). Soft: the host can change with no app
  // release. The client falls back to the compiled-in default when unreachable.
  static const String configBaseUrl = String.fromEnvironment(
    'CONFIG_BASE_URL',
    defaultValue: 'https://config.nikatru.com',
  );

  // Where the force-update screen sends users (store listing / download page).
  //
  // 🔴 THE COMPILED-IN FALLBACK, NOT THE ANSWER. `app.dart` resolves
  // `appConfigProvider…updateUrl ?? AppConfig.updateUrl` — the RUNTIME value
  // from the config service wins, and this is what a build uses when the
  // service is unreachable. Owner decision #19 moved the real value to runtime
  // because a compiled-in destination means shipping an update to change where
  // updates come from, and the builds that need the change most are exactly the
  // ones that cannot receive it. The server half landed 2026-08-03
  // (`services/platform/src/types.ts` `update_url`); before that the runtime
  // branch was unreachable in production and nothing went red, because falling
  // back is the correct behaviour when the value is absent.
  static const String updateUrl = String.fromEnvironment(
    'UPDATE_URL',
    defaultValue: companyUrl,
  );

  // Which CHANNEL this binary was built for — [pipeline 9]R-10.
  //
  // COMPILE-TIME, and deliberately the OPPOSITE of `updateUrl` above. The
  // channel is a fact ABOUT THE BINARY: the same commit built for `web` and for
  // `windows-store` produces two artifacts identical in everything else, so a
  // value fetched at runtime could not tell them apart. It identifies the
  // artifact exactly as the crash-sink release id does.
  //
  // Every value a workflow passes must resolve to a row id in
  // `tooling/channel-register.json` — `assert-channel-register.mjs` fails on a
  // typo, which is the one failure mode a free-text string has. `dev` is the
  // default because an unstamped build IS a developer build.
  static const String releaseChannel = String.fromEnvironment(
    'RELEASE_CHANNEL',
    defaultValue: 'dev',
  );

  // ── STORE IDENTITY ─────────────────────────────────────────────────────────
  // 🔴 `openStoreListing()` CANNOT RUN WITHOUT THESE on the platforms that need
  // them. `in_app_review` calls `ArgumentError.checkNotNull` — a RELEASE-build
  // throw, not an assert — for `appStoreId` on iOS/macOS and `microsoftStoreId`
  // on Windows, and the adapter used to pass neither, so the "rate us" route
  // was dead on three of the four store platforms while reporting success.
  // Android needs nothing: Play resolves the listing from the package name.
  //
  // OWNER-GATED, hence a define with an empty default rather than a stamped
  // constant: neither id EXISTS until the app is registered with that store, so
  // there is no value the factory could stamp. Empty means "not registered
  // yet", and the adapter reports that as `StoreListingOutcome.notConfigured`
  // instead of pretending the store opened.
  static const String appStoreId = String.fromEnvironment('APP_STORE_ID');
  static const String microsoftStoreId = String.fromEnvironment(
    'MICROSOFT_STORE_ID',
  );

  // ── REMINDERS ──────────────────────────────────────────────────────────────
  // When the daily reminder fires, in the DEVICE's local time. A plain constant
  // rather than a define: the right hour is a product decision each app makes
  // once, not a per-build one, and 20:00 is the chassis default because an
  // evening nudge is the least intrusive time that still reaches a daily user.
  static const int reminderHour = 20;
  static const int reminderMinute = 0;

  // Shared Supabase auth (portfolio-wide).
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: '',
  );
  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '',
  );

  // Whether this build has a real IDENTITY to talk to the backend with. Absent
  // in demo builds and in `flutter test`, which take no --dart-defines.
{{#needs_backend}}  // Also requires the per-app API host to have been pointed somewhere real,
  // since the stamped default is a placeholder that will never resolve.
  static bool get isBackendLive =>
      supabaseUrl.isNotEmpty &&
      supabaseAnonKey.isNotEmpty &&
      apiBaseUrl != _phApiBase;
{{/needs_backend}}{{^needs_backend}}  static bool get isBackendLive =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;
{{/needs_backend}}
  // Whether the launch-time CFG-1 fetch may run. DELIBERATELY SEPARATE from
  // [isBackendLive]: the config service is not the identity service, and
  // overloading one flag for both is how a test run acquires a network call.
  //
  // Off when identity is absent, which is what keeps widget tests hermetic — a
  // real `GET /config/<app>` at app root would hang `pumpAndSettle`. Also force-
  // off with `--dart-define=SKIP_REMOTE_CONFIG=true`, which an `integration_test`
  // run wants: it supplies identity defines but has no reason to reach the
  // config host, and a network-restricted runner turns that fetch into a dio
  // timeout. Opt-OUT rather than opt-in, so a real release build can never
  // silently lose its runtime config by forgetting a define.
  static const bool _skipRemoteConfig = bool.fromEnvironment(
    'SKIP_REMOTE_CONFIG',
  );

  static bool get remoteConfigEnabled => !_skipRemoteConfig && isBackendLive;
}
