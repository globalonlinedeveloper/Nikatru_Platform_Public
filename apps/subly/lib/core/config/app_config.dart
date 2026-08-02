/// Per-app + shared configuration for the whole portfolio template.
///
/// Nothing secret is hardcoded here. Runtime values come from `--dart-define`
/// (or a dart-define-from-file JSON), so the public repo never carries keys:
///
///   flutter run --dart-define=SUPABASE_URL=https://xxx.supabase.co \
///               --dart-define=SUPABASE_ANON_KEY=eyJ... \
///               --dart-define=API_BASE_URL=https://subly-api.you.workers.dev
///
/// Left at their placeholders, the app boots in DEMO mode: mock auth + local
/// seed data, no network — so you can see every screen before wiring a backend.
class AppConfig {
  AppConfig._();

  // ── Per-app identity — change these three blocks when cloning app #2..N ──
  static const String appId = 'subly';
  static const String appName = 'Subly';
  static const String appTagline = 'Every subscription, one clean board';

  // ── Supabase (shared across ALL apps in the portfolio) ──
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: _phSupabaseUrl,
  );
  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '',
  );

  // ── This app's Cloudflare Worker API ──
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: _phApiBase,
  );

  // ── CFG-1 config chassis host — where the app reads runtime config at
  // launch. Public, non-secret; overridable via --dart-define for a staging
  // config host.
  /// Marketing version of this build, for regression + rollout analysis in the
  /// analytics envelope. Injected at build time (`--dart-define=APP_VERSION`)
  /// rather than read from a plugin, so it also resolves on the web build and
  /// in tests without a platform channel.
  static const String appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: 'dev',
  );

  /// Which CHANNEL this binary was built for — [pipeline 9]R-10.
  ///
  /// 🔴 COMPILE-TIME, AND DELIBERATELY UNLIKE `updateUrl`. The two look
  /// similar and are opposites. `update_url` is runtime config because baking
  /// in the destination means shipping an update to change where updates come
  /// from (owner decision #19). This is the reverse: the channel is a FACT
  /// ABOUT THE BINARY — the same commit built for `web` and for `windows-store`
  /// produces two artifacts that differ in nothing else, so a value fetched at
  /// runtime could not distinguish them at all. It identifies the artifact
  /// exactly as the GlitchTip release id does.
  ///
  /// Every value any workflow passes must resolve to a row id in
  /// `tooling/channel-register.json`; `tooling/ci/assert-channel-register.mjs`
  /// fails the build on a typo, which is the one failure mode a free-text
  /// string has. `'dev'` is the default because an unstamped build IS a
  /// developer build, and saying so is better than claiming a channel.
  static const String releaseChannel = String.fromEnvironment(
    'RELEASE_CHANNEL',
    defaultValue: 'dev',
  );

  /// The SHARED platform Worker: first-party analytics ingest + the consent
  /// artifact (G-12), and in future entitlements and account deletion. Every
  /// app in the portfolio points here — it is not per-app ([ADR 020]).
  static const String platformBaseUrl = String.fromEnvironment(
    'PLATFORM_BASE_URL',
    defaultValue: 'https://platform.nikatru.com',
  );

  static const String configBaseUrl = String.fromEnvironment(
    'CONFIG_BASE_URL',
    defaultValue: 'https://config.nikatru.com',
  );

  // ── RevenueCat (paid subscriptions) ──
  static const String revenueCatApiKey = String.fromEnvironment(
    'REVENUECAT_KEY',
    defaultValue: '',
  );
  static const String proEntitlementId = 'pro';

  // ── Publisher / company (SHARED across every app in the portfolio) ──
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
  static const String privacyUrl = 'https://nikatru.com/privacy.html';
  static const String termsUrl = 'https://nikatru.com/terms.html';
  static const String refundUrl = 'https://nikatru.com/refund.html';
  static const String contactUrl = 'https://nikatru.com/contact.html';

  static const String _phSupabaseUrl = 'https://YOUR_PROJECT.supabase.co';
  static const String _phApiBase =
      'https://subly-api.YOUR_SUBDOMAIN.workers.dev';

  static bool get isSupabaseConfigured =>
      supabaseUrl != _phSupabaseUrl && supabaseAnonKey.isNotEmpty;
  static bool get isApiConfigured => apiBaseUrl != _phApiBase;
  static bool get isRevenueCatConfigured => revenueCatApiKey.isNotEmpty;

  /// True when we should run against real services vs. the in-app demo stubs.
  static bool get isBackendLive => isSupabaseConfigured && isApiConfigured;
}
