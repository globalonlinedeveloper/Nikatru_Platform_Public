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
