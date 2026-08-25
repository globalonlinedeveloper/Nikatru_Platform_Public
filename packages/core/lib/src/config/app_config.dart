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
    this.maxPromosPerWeek = 0,
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
  /// ⬜ PARSED, SERIALISED, COPY-WITHED — AND READ BY NOTHING. Printed by
  /// `tooling/ci/assert-config-registry.mjs` limb 9 on every CI run rather than
  /// deleted, because the decision it is holding a place for is the owner's.
  ///
  /// MEASURED 2026-08-25 over every git-tracked file in this repository AND the
  /// three sibling repositories, with no language filter — the last dead-key
  /// sweep in this project was language-scoped and wrong, so this one was not.
  /// `"theme"` as a JSON key occurs ZERO times in
  /// `services/platform/src/app-config-data.json`, so no `defaults` and no
  /// `apps.*` entry emits it and it can only arrive through a hand-written
  /// CONFIG_KV override that the server's `deepMerge` passes through
  /// unvalidated. `.theme` occurs nine times tree-wide: six are this class's own
  /// declare/parse/serialise/copyWith sites, one is `config_test.dart` asserting
  /// it is null, and two are `MaterialApp.theme` in a widget test — a DIFFERENT
  /// SYMBOL, and exactly the false positive a careless sweep banks as a reader.
  ///
  /// 🔴 DO NOT DELETE IT AS DEAD CODE. It is the client-side half of the
  /// brand-vs-seed decision, which the owner has half taken (#6459F5 is Subly's
  /// brand under a two-layer model; only the accent migration is open).
  /// `services/platform/src/types.ts` carries the server-side half and the same
  /// note. Limb 9 fails the build in BOTH directions — emitted and unread, or
  /// read and unemitted, which is the `update_url` shape that reported healthy
  /// for weeks — so whichever end moves first, the other is forced.
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

  /// How many PROMOTIONAL notifications a week an app may send — [pipeline
  /// 13]T-6.
  ///
  /// 🔴 THE DEFAULT IS ZERO, AND THAT IS THE POINT. There is no promo sender in
  /// this repo and no code path that posts a promotional touch, so zero is the
  /// only value that cannot be wrong before there is anything to be wrong
  /// about. Raising it is a deliberate decision, taken once, priced at the time
  /// — not a number that drifted upward while nobody was looking.
  ///
  /// Typed on BOTH sides of the config contract on purpose. `services/platform`
  /// declares the same key and its test asserts the full key set in both
  /// directions, so adding it here alone fails the server's lane and adding it
  /// there alone fails the stray-key check. A cap the server can send and the
  /// client cannot read is a cap that does not exist.
  ///
  /// Deliberately NOT a rate limiter: nothing enforces this at runtime, because
  /// nothing sends. The tripwire that makes the first promo sender read it
  /// lives in `tooling/ci/assert-adapter-capabilities.mjs`, and that guard
  /// PRINTS every run that its domain is empty today.
  final int maxPromosPerWeek;

  /// Whether feature [key] is enabled ([orElse] when the key is absent).
  bool feature(String key, {bool orElse = false}) => features[key] ?? orElse;

  /// The rollout percentage (0..100) for [flag], or 0 (off) when absent.
  int rolloutPercent(String flag) => flags[flag] ?? 0;

  /// Override copy for [key], or [key] itself when absent.
  ///
  /// ⬜ ZERO NON-TEST CALLERS, AND THE THREE LIVE COPY SITES ALL BYPASS IT ON
  /// PURPOSE. Measured 2026-08-25 across every `.dart` file in this repository:
  /// the only `AppConfig.text(` call sites in existence are
  /// `packages/core/test/config_test.dart:144` and `:145`. Meanwhile [copy]
  /// itself IS live — `home_screen.dart`, `onboarding_screen.dart` and the
  /// brick's `onboarding_screen.dart` each read `cfg?.copy[key]` DIRECTLY. So
  /// the map reaches paint on three surfaces and only this accessor is dead.
  ///
  /// 🔴 THEY BYPASS IT BECAUSE ITS FALLBACK IS THE WRONG ONE, and the chassis
  /// says so in its own words: "`AppConfig.text(key)` returns the KEY ITSELF
  /// when there is no override — by design, and exactly wrong here: a freshly
  /// stamped app has no overrides, so a purely config-driven carousel would
  /// greet its first user with `onboarding.1.title`."
  /// Subly's [O3] states the rule positively: an override REPLACES designed
  /// copy, designed copy is the FALLBACK, never the raw key. Every live site
  /// therefore reads the map and supplies an l10n default, and each additionally
  /// treats a blank override as absent — which this accessor does not do either.
  ///
  /// ⚠️ IT IS KEPT ONLY BECAUSE ITS DELETION IS NOT THIS CHANGE'S TO MAKE (two
  /// assertions in `packages/core/test/config_test.dart` still call it, and that
  /// file is outside this edit's ownership). `assert-config-registry.mjs` limb
  /// 10 holds the line meanwhile: the FIRST non-test caller fails the build,
  /// with the [O3] reason, so this accessor cannot quietly acquire a user-facing
  /// reader while it waits to be removed. Prefer `copy[key] ?? designedDefault`.
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
      // A wrong-typed or absent value reads as 0 rather than throwing: a
      // drifted config body must never be able to RAISE the cap, and it
      // must never crash a client that is only trying to load its config.
      maxPromosPerWeek: json['max_promos_per_week'] is num
          ? (json['max_promos_per_week']! as num).toInt().clamp(0, 1 << 20)
          : 0,
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
        'max_promos_per_week': maxPromosPerWeek,
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
    int? maxPromosPerWeek,
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
        maxPromosPerWeek: maxPromosPerWeek ?? this.maxPromosPerWeek,
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
