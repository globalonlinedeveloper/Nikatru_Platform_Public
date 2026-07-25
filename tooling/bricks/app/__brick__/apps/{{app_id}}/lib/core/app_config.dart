/// Runtime configuration for {{display_name}}.
///
/// Secrets arrive via --dart-define at build time; nothing sensitive is
/// committed. Left at placeholders, the app runs in demo mode.
class AppConfig {
  AppConfig._();

  static const String appId = '{{app_id.snakeCase()}}';
  static const String appName = '{{display_name}}';
  static const String category = '{{category}}';

  // Shared NIKATRU identity (all apps inherit).
  static const String companyName = 'Nikatru';
  static const String companyUrl = 'https://nikatru.com';
  static const String supportEmail = 'support@nikatru.com';
  static const String privacyUrl = 'https://nikatru.com/privacy.html';
  static const String termsUrl = 'https://nikatru.com/terms.html';

  // The API this app calls. Soft via CFG: the host can change with no app
  // release (API_BASE_URL --dart-define overrides the default).
  //
  // {{#needs_backend}}This app was stamped with needs_backend=true, so it has its OWN Worker
  // (services/{{app_id}}-api) holding its private D1. Shared concerns — config,
  // analytics, entitlements — still come from the platform Worker.{{/needs_backend}}{{^needs_backend}}This app is CLIENT-ONLY: it stamps no Worker and no database, and points
  // straight at the ONE shared platform Worker. That is the default on purpose
  // — D1 Free allows 10 databases per ACCOUNT in total, so a per-app database
  // is a scarce resource, not a default.{{/needs_backend}}
  static const String _phApiBase =
      {{#needs_backend}}'https://{{api_domain}}'{{/needs_backend}}{{^needs_backend}}'https://platform.nikatru.com/v1'{{/needs_backend}};
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
  // Owner overrides per platform via --dart-define=UPDATE_URL.
  static const String updateUrl = String.fromEnvironment(
    'UPDATE_URL',
    defaultValue: companyUrl,
  );

  // Shared Supabase auth (portfolio-wide).
  static const String supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: '',
  );
  static const String supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: '',
  );

  // Gated on the identity creds, which are absent in tests and demo builds —
  // that is what keeps widget tests hermetic (no launch-time config fetch to
  // hang `pumpAndSettle`).{{#needs_backend}} Also requires the per-app API host to have been
  // pointed somewhere real, since the stamped default is a placeholder.{{/needs_backend}}
  static bool get isBackendLive =>
      supabaseUrl.isNotEmpty &&
      supabaseAnonKey.isNotEmpty{{#needs_backend}} &&
      apiBaseUrl != _phApiBase{{/needs_backend}};
}
