/// Typed runtime configuration for an app (CFG-1).
///
/// Mirrors the server contract served by `services/platform`
/// `GET /config/<app>` (see `services/platform/src/types.ts` `AppConfig` and
/// `src/config.ts` `DEFAULT_CONFIGS`). DATA/flags only — never UI. JSON is
/// snake_case to match the Worker response and the committed `defaults.json`.
library;

/// Paywall sub-config. [enabled] is the known flag; [extra] preserves any other
/// paywall keys the server sends so the client stays forward-compatible.
class PaywallConfig {
  const PaywallConfig({
    required this.enabled,
    this.extra = const <String, Object?>{},
  });

  final bool enabled;
  final Map<String, Object?> extra;

  factory PaywallConfig.fromJson(Map<String, Object?> json) {
    final Map<String, Object?> rest = <String, Object?>{...json}
      ..remove('enabled');
    return PaywallConfig(enabled: json['enabled'] == true, extra: rest);
  }

  Map<String, Object?> toJson() =>
      <String, Object?>{'enabled': enabled, ...extra};
}

/// Resolved runtime config for an app.
class AppConfig {
  const AppConfig({
    required this.appId,
    required this.apiBaseUrl,
    required this.features,
    required this.paywall,
    required this.contentPack,
    required this.copy,
    required this.minSupportedVersion,
    this.flags = const <String, int>{},
    this.theme,
    this.updateUrl,
  });

  final String appId;
  final String apiBaseUrl;
  final Map<String, bool> features;
  final PaywallConfig paywall;
  final String? contentPack;
  final Map<String, String> copy;
  final String minSupportedVersion;

  /// Percentage-rollout flags (`name → 0..100`), resolved per-device with
  /// `FeatureFlags`/`resolveFlag` (CFG G-14). Distinct from [features], which is
  /// a hard on/off toggle.
  final Map<String, int> flags;
  final Map<String, Object?>? theme;

  /// Where the force-update wall sends users, resolved at RUNTIME.
  ///
  /// [pipeline C-8] This was compile-time only, which made the kill-switch
  /// circular: the one thing the wall must do in an emergency is send users
  /// somewhere, but its destination was frozen at build time — so redirecting it
  /// meant shipping the very build the wall exists to replace. Owner decision
  /// 2026-07-27: UPDATE_URL moves to runtime config; GLITCHTIP_DSN deliberately
  /// does not, because a build must report crashes as itself.
  ///
  /// Null means "the server has no opinion" and the app keeps its compiled-in
  /// default, so this stays offline-safe: an unreachable config service can
  /// never leave the wall with nowhere to send anyone.
  final String? updateUrl;

  /// Whether feature [key] is enabled ([orElse] when the key is absent).
  bool feature(String key, {bool orElse = false}) => features[key] ?? orElse;

  /// The rollout percentage (0..100) for [flag], or 0 (off) when absent.
  int rolloutPercent(String flag) => flags[flag] ?? 0;

  /// Override copy for [key], or [key] itself when absent.
  String text(String key) => copy[key] ?? key;

  /// Parse the Worker / `defaults.json` JSON shape.
  ///
  /// Throws [FormatException] when a required key (`app_id`, `api_base_url`,
  /// `min_supported_version`) is missing or the wrong type — callers fall back
  /// to bundled defaults, mirroring the server's "malformed ⇒ defaults" rule.
  factory AppConfig.fromJson(Map<String, Object?> json) {
    final Object? appId = json['app_id'];
    final Object? apiBaseUrl = json['api_base_url'];
    final Object? minVer = json['min_supported_version'];
    if (appId is! String || appId.isEmpty) {
      throw const FormatException('AppConfig: missing or invalid app_id');
    }
    if (apiBaseUrl is! String || apiBaseUrl.isEmpty) {
      throw const FormatException('AppConfig: missing or invalid api_base_url');
    }
    if (minVer is! String || minVer.isEmpty) {
      throw const FormatException(
          'AppConfig: missing or invalid min_supported_version');
    }
    return AppConfig(
      appId: appId,
      apiBaseUrl: apiBaseUrl,
      features: _boolMap(json['features']),
      paywall: PaywallConfig.fromJson(_asMap(json['paywall'])),
      // Non-required: coerce a wrong-typed value to null rather than throwing a
      // TypeError (only the three keys above are strict). Keeps a corrupt cached
      // or drifted server body from crashing load()/hydrate().
      contentPack: json['content_pack'] is String
          ? json['content_pack'] as String
          : null,
      copy: _stringMap(json['copy']),
      minSupportedVersion: minVer,
      flags: _intMap(json['flags']),
      theme: json['theme'] == null ? null : _asMap(json['theme']),
      // Empty string coerces to null, not to "": a blank value in a config body
      // must mean "no opinion", never "send users to nowhere".
      updateUrl: json['update_url'] is String &&
              (json['update_url'] as String).isNotEmpty
          ? json['update_url'] as String
          : null,
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'app_id': appId,
        'api_base_url': apiBaseUrl,
        'features': features,
        'paywall': paywall.toJson(),
        'content_pack': contentPack,
        'copy': copy,
        'min_supported_version': minSupportedVersion,
        if (flags.isNotEmpty) 'flags': flags,
        if (theme != null) 'theme': theme,
      };

  AppConfig copyWith({
    String? appId,
    String? apiBaseUrl,
    Map<String, bool>? features,
    PaywallConfig? paywall,
    String? contentPack,
    Map<String, String>? copy,
    String? minSupportedVersion,
    Map<String, int>? flags,
    Map<String, Object?>? theme,
    String? updateUrl,
  }) =>
      AppConfig(
        appId: appId ?? this.appId,
        apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
        features: features ?? this.features,
        paywall: paywall ?? this.paywall,
        contentPack: contentPack ?? this.contentPack,
        copy: copy ?? this.copy,
        minSupportedVersion: minSupportedVersion ?? this.minSupportedVersion,
        flags: flags ?? this.flags,
        theme: theme ?? this.theme,
        updateUrl: updateUrl ?? this.updateUrl,
      );

  @override
  String toString() => 'AppConfig($appId, api=$apiBaseUrl)';
}

Map<String, bool> _boolMap(Object? v) {
  if (v is! Map) return <String, bool>{};
  final Map<String, bool> out = <String, bool>{};
  v.forEach((Object? k, Object? val) {
    if (val is bool) out['$k'] = val;
  });
  return out;
}

Map<String, int> _intMap(Object? v) {
  if (v is! Map) return const <String, int>{};
  final Map<String, int> out = <String, int>{};
  v.forEach((Object? k, Object? val) {
    if (val is num) out['$k'] = val.toInt();
  });
  return out;
}

Map<String, String> _stringMap(Object? v) {
  if (v is! Map) return <String, String>{};
  final Map<String, String> out = <String, String>{};
  v.forEach((Object? k, Object? val) {
    out['$k'] = '${val ?? ''}';
  });
  return out;
}

Map<String, Object?> _asMap(Object? v) => v is Map
    ? v.map((Object? k, Object? val) => MapEntry<String, Object?>('$k', val))
    : <String, Object?>{};
