/// Per-app + shared configuration for Subly — Subscription Tracker.
///
/// 🔴 THIS FILE IS THE MERGE OF TWO `AppConfig` CLASSES ([ADR 037] P2.5). Until
/// P2.5 the tree carried both `lib/core/app_config.dart` (Subly's, 12
/// importers) and the stamped `lib/core/app_config.dart` (the chassis's, 9
/// importers). Two classes of the same name, each individually plausible, is how
/// a `--dart-define` lands in the one nobody reads: the build looks configured,
/// the branch that reads the OTHER constant stays on its placeholder, and the
/// app ships in demo mode with every guard green. The stamped PATH won because
/// nine incoming chassis files import it and every future stamp will; the live
/// CONTENT won wherever the two disagreed, because the live values are the ones
/// with a measured production behaviour behind them.
///
/// Nothing secret is hardcoded here. Runtime values come from `--dart-define`
/// (or a dart-define-from-file JSON), so the public repo never carries keys:
///
///   flutter run --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///               --dart-define=SUPABASE_ANON_KEY=sb_publishable_... \
///               --dart-define=API_BASE_URL=https://api.nikatru.com
///
/// or, for a local live-mode run, the whole set at once:
///
///   cp config/defaults.example.json config/defaults.json   # gitignored
///   flutter run --dart-define-from-file=config/defaults.json
///
/// Left at their placeholders, the app boots in DEMO mode: mock auth + local
/// seed data, no network — so you can see every screen before wiring a backend.
class AppConfig {
  AppConfig._();

  // ── Per-app identity — change these blocks when cloning app #2..N ─────────

  static const String appId = 'subly';

  /// The SHORT name, and the one the UI uses everywhere.
  ///
  /// 🔴 DELIBERATELY NOT THE STORE DISPLAY NAME. The stamp writes
  /// `'Subly — Subscription Tracker'` here, and every live call site reads badly
  /// with it: `'$appName by $companyName'` (shared/widgets.dart) becomes
  /// "Subly — Subscription Tracker by Nikatru", the consent prompt asks "Help
  /// improve Subly — Subscription Tracker?", and `AboutListTile`'s
  /// applicationName gets an em-dash subtitle. It is the same call the web shell
  /// already makes twice — `overrides.md` §5/§6 re-assert the short `"Subly"`
  /// for `apple-mobile-web-app-title` and for the manifest's `short_name`,
  /// because an em-dash subtitle under a home-screen icon is truncated by every
  /// launcher. The full name has ONE correct home and it is [displayName].
  static const String appName = 'Subly';

  /// The STORE / BROWSER-TITLE name. Byte-identical to `<title>` in
  /// `web/index.html` and to the stamp's `display_name` var — the one place the
  /// long form belongs.
  static const String displayName = 'Subly — Subscription Tracker';

  /// The store category this app lists under (chassis field, arrives with the
  /// stamp). Not read by app code today; the listing register is the consumer.
  static const String category = 'productivity';

  /// ⚠️ MEASURED DEAD at P2.5: zero references outside this declaration
  /// (`grep -rn appTagline apps/subly/{lib,test,integration_test}`). Kept
  /// because a de-duplication increment must not quietly delete live content —
  /// it is a Phase-3 deletion candidate, listed as one rather than removed here.
  static const String appTagline = 'Every subscription, one clean board';

  /// Marketing version of this build, for regression + rollout analysis in the
  /// analytics envelope. Injected at build time (`--dart-define=APP_VERSION`)
  /// rather than read from a plugin, so it also resolves on the web build and
  /// in tests without a platform channel. `assert-app-versioning.mjs` is what
  /// keeps the release lane passing a derived, monotonic value here.
  static const String appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: 'dev',
  );

  /// What crash reports are grouped and triaged by (the GlitchTip `release`).
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
  ///
  /// ⚠️ NOT WIRED YET. `main.dart` still passes the equivalent literal
  /// `'subly@${AppConfig.appVersion}'`; swapping it for this const is a P2.6a
  /// line, deliberately not folded into P2.5 (the values are identical today,
  /// so the swap is a readability change with no behaviour to verify here).
  static const String telemetryRelease = '$appId@$appVersion';

  // ── Supabase (shared across ALL apps in the portfolio) ────────────────────
  //
  // 🔴 THE DEFAULT IS A PLACEHOLDER, NOT AN EMPTY STRING. The stamp defaults
  // `supabaseUrl` to `''` and tests `isNotEmpty`; live defaults it to
  // [_phSupabaseUrl] and tests `!= _phSupabaseUrl`. The live shape is kept
  // because `assert-store-build-config.mjs` derives the set of defines a store
  // artifact must pass by WALKING `isBackendLive` through the getters it names,
  // and the live shape keeps that walk three getters long and legible. Both
  // shapes reach the same three defines; only one of them also survives a
  // future field being added to `isSupabaseConfigured`.
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: _phSupabaseUrl,
  );
  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '',
  );

  // ── This app's Cloudflare Worker API ──────────────────────────────────────
  //
  // 🔴 [_phApiBase] IS A SENTINEL, NOT THE HOST. Read this before changing it.
  //
  // The real host is `https://api.nikatru.com` and it arrives as
  // `--dart-define=API_BASE_URL` — every one of the eight shipping lanes passes
  // it (deploy-web.yml, build-platforms.yml ×3, submit-play, submit-appstore ×2,
  // submit-windows-store), and a local live run gets it from
  // `config/defaults.json`. It is NOT written into the constant below, and the
  // obvious "override the constant to the live value" is a PRODUCTION DEFECT:
  // [isApiConfigured] is `apiBaseUrl != _phApiBase`, so making the constant
  // equal the value the lanes pass makes the comparison FALSE for exactly the
  // builds that are correctly configured. `providers.dart` would then hand out
  // `SeedApiClient()` — in-memory demo data — in production, `app_shell.dart`
  // would paint the demo banner, and `analytics_providers.dart` would install
  // `NoOpAnalytics`. `assert-store-build-config.mjs` cannot catch it: it checks
  // that the define is PASSED, and prints on every run that it cannot see values.
  //
  // So the sentinel must stay a string no real build ever passes, and it stays
  // the self-describing one — `YOUR_SUBDOMAIN` cannot be mistaken for a host,
  // whereas the stamp's `https://api-subly.nikatru.com` reads exactly like one.
  static const String _phApiBase =
      'https://subly-api.YOUR_SUBDOMAIN.workers.dev';
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: _phApiBase,
  );

  /// The SHARED platform Worker: first-party analytics ingest + the consent
  /// artifact (G-12), and in future entitlements and account deletion. Every
  /// app in the portfolio points here — it is not per-app ([ADR 020]).
  static const String platformBaseUrl = String.fromEnvironment(
    'PLATFORM_BASE_URL',
    defaultValue: 'https://platform.nikatru.com',
  );

  /// CFG-1 config chassis host — where the app reads runtime config at launch.
  /// Public, non-secret; overridable via `--dart-define` for a staging host.
  /// Soft on purpose: the host can change with no app release, and the client
  /// falls back to the compiled-in default when it is unreachable.
  static const String configBaseUrl = String.fromEnvironment(
    'CONFIG_BASE_URL',
    defaultValue: 'https://config.nikatru.com',
  );

  /// Where the force-update screen sends users (store listing / download page).
  ///
  /// 🔴 THE COMPILED-IN FALLBACK, NOT THE ANSWER. `app.dart` resolves
  /// `appConfigProvider…updateUrl ?? AppConfig.updateUrl` — the RUNTIME value
  /// from the config service wins, and this is what a build uses when the
  /// service is unreachable. Owner decision #19 moved the real value to runtime
  /// because a compiled-in destination means shipping an update to change where
  /// updates come from, and the builds that need the change most are exactly the
  /// ones that cannot receive it.
  static const String updateUrl = String.fromEnvironment(
    'UPDATE_URL',
    defaultValue: companyUrl,
  );

  /// Which CHANNEL this binary was built for — [pipeline 9]R-10.
  ///
  /// 🔴 COMPILE-TIME, AND DELIBERATELY UNLIKE [updateUrl]. The two look similar
  /// and are opposites. `update_url` is runtime config because baking in the
  /// destination means shipping an update to change where updates come from.
  /// This is the reverse: the channel is a FACT ABOUT THE BINARY — the same
  /// commit built for `web` and for `windows-store` produces two artifacts that
  /// differ in nothing else, so a value fetched at runtime could not distinguish
  /// them at all. It identifies the artifact exactly as the GlitchTip release
  /// id does.
  ///
  /// Every value any workflow passes must resolve to a row id in
  /// `tooling/channel-register.json`; `tooling/ci/assert-channel-register.mjs`
  /// fails the build on a typo, which is the one failure mode a free-text
  /// string has. `'dev'` is the default because an unstamped build IS a
  /// developer build, and saying so is better than claiming a channel.
  ///
  /// ✅ CORRECTED 2026-09-03 — THIS CONSTANT IS NO LONGER DEAD IN DART, and the
  /// old text is amended rather than deleted because it was a DATED MEASUREMENT
  /// and it was true when it was taken. It read: "⚠️ MEASURED DEAD IN DART at
  /// P2.5: three workflows pass the define and `assert-channel-register.mjs`
  /// validates the value, but no Dart call site reads this constant. The define
  /// is doing real work; the const is not."
  ///
  /// `main.dart` now passes it as `TelemetryConfig.dist`, which is the second
  /// half of the key GlitchTip stores an uploaded source map under. So the
  /// constant has exactly one reader and that reader decides whether a minified
  /// web stack trace can be read at all. ⛔ Do not "clean up" this declaration
  /// on the strength of the paragraph above; re-grep before believing any
  /// dead-code note in this file.
  static const String releaseChannel = String.fromEnvironment(
    'RELEASE_CHANNEL',
    defaultValue: 'dev',
  );

  // ── STORE IDENTITY ────────────────────────────────────────────────────────
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

  // ── REMINDERS ─────────────────────────────────────────────────────────────
  // When the daily reminder fires, in the DEVICE's local time. A plain constant
  // rather than a define: the right hour is a product decision each app makes
  // once, not a per-build one, and 20:00 is the chassis default because an
  // evening nudge is the least intrusive time that still reaches a daily user.
  static const int reminderHour = 20;
  static const int reminderMinute = 0;

  // ── RevenueCat (paid subscriptions) ───────────────────────────────────────
  // ⚠️ MEASURED DEAD at P2.5: `revenueCatApiKey`, `proEntitlementId` and
  // `isRevenueCatConfigured` have zero references outside this file. The money
  // rail that landed in P2.4b is `nikatru_purchases`; these three predate it.
  // Kept for the same reason as `appTagline` — Phase 3 deletes them on purpose,
  // a dedup increment does not delete them by accident.
  static const String revenueCatApiKey = String.fromEnvironment(
    'REVENUECAT_KEY',
    defaultValue: '',
  );
  static const String proEntitlementId = 'pro';

  // ── Publisher / company (SHARED across every app in the portfolio) ────────
  // Each app is "<appName> by Nikatru". Surfaced in Settings→About + auth
  // footers; the legal URLs point at the live nikatru.com pages (also the
  // store-required Privacy Policy link). Change here once → all apps inherit.
  static const String companyName = 'Nikatru';
  static const String companyUrl = 'https://nikatru.com';

  /// The one address a user — or a stranger with a security finding — writes to.
  ///
  /// 🔴 THIS APP HAD NONE while the brick every future app is stamped from did
  /// ([pipeline K-12]). It declared `contactUrl` only, so the single shipping app
  /// was the one app in the portfolio with no compiled-in address, and nothing
  /// could see the difference because each file was individually plausible.
  /// `tooling/ci/assert-repo-posture.mjs` now fails if this, the brick's
  /// `AppConfig.supportEmail`, the address on `sites/nikatru/contact.html` and
  /// the one published in `SECURITY.md` are not all the same string.
  static const String supportEmail = 'support@nikatru.com';

  // 🔴 THE SET OF `nikatru.com/<page>.html` CONSTANTS HERE MUST EQUAL
  // `LEGAL_PAGES` IN check-site-integrity.mjs ([pipeline 8]K-6) — in the BRICK's
  // copy of this file, which is what `assert-stamp-properties.mjs` reads. The
  // brick declared TWO while the site publishes FOUR, so every stamped app
  // shipped a legal surface silently omitting the refund policy — the one page a
  // store reviewer opens when a purchase is disputed.
  static const String privacyUrl = 'https://nikatru.com/privacy';
  static const String termsUrl = 'https://nikatru.com/terms';
  static const String refundUrl = 'https://nikatru.com/refund';

  /// The SUPPORT page — deliberately NOT one of the three above.
  ///
  /// It is app-local rather than chassis: `assert-stamp-properties.mjs` treats
  /// every `https://nikatru.com/<page>.html` constant in the BRICK's
  /// `app_config.dart` as a LEGAL page that `check-site-integrity.mjs` must
  /// publish and the settings screen must link, and contact.html is a support
  /// page, not a legal document — forcing it into that set would drag a
  /// 1000-character legal-text floor onto a contact page (channel-register.json
  /// `storeMetadataContract.portfolioUrls._why`). That guard reads the brick
  /// only, so declaring it HERE is safe; the store listings get the same URL
  /// from the register's `portfolioUrls.supportUrl`.
  static const String contactUrl = 'https://nikatru.com/contact';

  static const String _phSupabaseUrl = 'https://YOUR_PROJECT.supabase.co';

  /// Whether this build has a real IDENTITY to talk to the backend with.
  static bool get isSupabaseConfigured =>
      supabaseUrl != _phSupabaseUrl && supabaseAnonKey.isNotEmpty;

  /// Whether the per-app API host has been pointed at something real. See the
  /// sentinel note on [_phApiBase] before touching this.
  static bool get isApiConfigured => apiBaseUrl != _phApiBase;

  static bool get isRevenueCatConfigured => revenueCatApiKey.isNotEmpty;

  /// True when we should run against real services vs. the in-app demo stubs.
  ///
  /// 🔴 THE SHAPE OF THIS GETTER IS READ BY A GUARD.
  /// `assert-store-build-config.mjs` derives the set of `--dart-define`s every
  /// store artifact must supply by walking THIS expression through the getters
  /// it names down to their `String.fromEnvironment` keys. Renaming it, or
  /// flattening it to something that reaches no define, does not fail loudly —
  /// it makes the required set EMPTY, at which point every store lane trivially
  /// supplies all zero of the things it needs. The guard COVERAGE-LOSTs on both,
  /// which is the only reason that is survivable.
  ///
  /// Its four consumers are also the four rows `store/android-play/
  /// data-safety.json` swears to: `providers.dart` auth repo, `providers.dart`
  /// api client, `analytics_providers.dart` analytics, and the first-run consent
  /// prompt — `app.dart`'s `_ConsentPrompt`, which is where the fourth row moved
  /// when the unmounted `consent_prompt.dart` was deleted on 2026-08-10. The
  /// sworn document cites live line numbers; this comment deliberately does not,
  /// because it is a list of consumers and not a citation.
  static bool get isBackendLive => isSupabaseConfigured && isApiConfigured;

  // ── CFG-1 launch fetch ────────────────────────────────────────────────────
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
