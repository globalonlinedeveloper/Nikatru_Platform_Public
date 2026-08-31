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
  /// ⚠️ CORRECTION 2026-08-25, SAME DAY — THE SPLIT IN THE PARAGRAPH ABOVE IS
  /// INVERTED. It is left standing unedited because renumbering a dated record
  /// falsifies it rather than repairing it; read it as history and read this as
  /// the number. Re-measured at commit `a028cc0`, this branch's merge base,
  /// over all 1260 files tracked there with no language filter. The TOTAL of
  /// nine is right. The split is:
  ///   · 2 — this class's own sites, `this.theme` in the constructor and
  ///     `theme ?? this.theme` in `copyWith`. The class touches the IDENTIFIER
  ///     `theme` six times (declare/parse/serialise/copyWith), which is where
  ///     the six came from, but only two of those are the DOTTED token, and the
  ///     dotted token is what the scan matches.
  ///   · 1 — `packages/core/test/config_test.dart`, asserting it is null.
  ///   · 6 — `MaterialApp.theme`, the different symbol.
  /// Not 6 / 1 / 2.
  ///
  /// AND THE SIX SIT IN TWO WIDGET TESTS, NOT ONE. The record above names a
  /// single widget test; there are two, 3 hits each:
  ///   `apps/subly/test/chassis_properties_test.dart`
  ///   `tooling/bricks/app/__brick__/apps/{{app_id}}/test/chassis_properties_test.dart`
  /// The brick copy was never mentioned. It is the same test stamped into every
  /// app the factory makes, so it is the copy that MULTIPLIES.
  ///
  /// DIRECTION OF THE ERROR: it UNDERSTATED the false-positive population this
  /// note exists to warn about. Two thirds of the tree-wide hits are the
  /// different symbol, not two ninths — the trap is three times larger than the
  /// record admitted, and understating it is the direction that makes a careless
  /// sweep look safer than it is.
  ///
  /// VERDICT UNCHANGED. All nine sit either in this file or under a `/test/`
  /// segment, and limb 9 cuts both — `dartFiles` filters
  /// `/(?:test|integration_test)/` and the reader loop skips `APP_CONFIG_DART`
  /// (search `assert-config-registry.mjs` for `integration_test` and for
  /// `rel === APP_CONFIG_DART`). The reader scan's domain does not move, so the
  /// conclusion below is untouched: DECLARED-BUT-DEAD, owner-gated, NOT DELETED.
  ///
  /// STATED OVER COMMENT-STRIPPED SOURCE — CODE POSITIONS ONLY. That is the
  /// domain limb 9 actually reads (`stripSourceComments` from
  /// `tooling/ci/text-reductions.mjs`; this package's `.dart` strip is
  /// byte-identical to `assert-stamp-properties`' `stripDartComments`), and it
  /// is the only domain in which this paragraph can state a count without
  /// changing it — the sentence lives in a comment, the count does not. That is
  /// not a hypothetical worry: this corpus once shipped a "grep returns 12"
  /// correction that was itself the 13th hit. A raw tree-wide grep at HEAD is
  /// now 21 and rising, and every one of the extra twelve is prose about the
  /// nine.
  ///
  /// SWEEP RULE — run from the repo root; both print 9, and they agree because
  /// at `a028cc0` no comment in the tree carried the token, which is exactly
  /// what stopped being true when this correction was written:
  ///
  ///     git grep -o -E '\.theme\b' a028cc0 -- . | wc -l
  ///
  ///     node --input-type=module -e "
  ///     import {execSync as x} from 'node:child_process';
  ///     import {extname} from 'node:path';
  ///     import {stripSourceComments as s} from './tooling/ci/text-reductions.mjs';
  ///     const T = 'a028cc0', g = (c) => x(c, {encoding: 'utf8', maxBuffer: 1e9});
  ///     let n = 0;
  ///     for (const f of g('git ls-tree -r --name-only ' + T).split('\n').filter(Boolean))
  ///       n += (s(g('git show ' + T + ':' + JSON.stringify(f)), extname(f))
  ///             .match(/\.theme\b/g) || []).length;
  ///     console.log(n);
  ///     "
  ///
  /// The commit is part of the rule. A tree-wide count with no commit named rots
  /// the next time anyone writes the token, including into a comment like this
  /// one. Code positions in THIS file: 2 before this correction, 2 after.
  ///
  /// ⚠️ CORRECTION 2026-08-25, PART TWO — THE DOMAIN CLAIM IS ALSO WRONG, AND
  /// IT IS THE WORSE OF THE TWO ERRORS. The paragraph at the top declares the
  /// sweep ran "over every git-tracked file in this repository AND the three
  /// sibling repositories, with no language filter", and then states a result
  /// that was only ever true of ONE repository's Dart. Run the rule as written
  /// over the domain as written and it does not reproduce. Measured this run,
  /// `git grep -o -E '\.theme\b' -- .` in each repo's working tree:
  ///
  ///     Nikatru_Platform_Public      9   PINNED AT a028cc0. The live worktree
  ///                                      figure is larger and climbs with every
  ///                                      note like this one, which is the whole
  ///                                      reason it is pinned.
  ///     Nikatru_Platform_Private     2
  ///     Nikatru_Extensions_Public   51   🔴
  ///     Nikatru_Extensions_Private   0
  ///     ─────────────────────────────
  ///     four-repo total             62
  ///
  /// FIFTY-ONE OF THOSE SIXTY-TWO ARE A THIRD SYMBOL the sentence does not
  /// admit exists, and it is not `MaterialApp.theme` either. Every one is
  /// JavaScript: `Nikatru_Extensions_Public` tracks ZERO `.dart` files and does
  /// not contain the string `AppConfig` or `MaterialApp` in any file. Receivers,
  /// via `git grep -o -E '\w+\.theme\b' -- . | awk -F: '{print $NF}' | sort |
  /// uniq -c | sort -rn` — `dataset.theme` 12, `r.theme` 11, `s.theme` 7,
  /// `sync.theme` 6, `settings.theme` 3, then a tail of local names. It is a
  /// browser extension's own light/dark settings key:
  /// `document.documentElement.dataset.theme` and the stored record behind it,
  /// concentrated in `Extension/Full_Screen_Shot/test/editor-sim.node.js`,
  /// `core/test/settings.node.js` and `templates/tool/test/skeleton-sim.node.js`.
  /// Different language, different product, same six letters.
  ///
  /// The remaining 2 are PROSE. `notes/HANDOFF-2026-08-21.md` and
  /// `research/RESEARCH-dead-seams-2026-08-21.md` in `Nikatru_Platform_Private`
  /// each cite `AppConfig.theme` in a markdown sentence — the same symbol this
  /// time, but nothing executes a note.
  ///
  /// THE SHAPE OF THE MISTAKE MATTERS MORE THAN THE COUNT. It is the same error
  /// twice in one sentence. The record WIDENED ITS DOMAIN to four repositories
  /// and seven extensions in order to sound rigorous — it says so, correcting an
  /// earlier sweep for having been "language scoped and wrong" — and then stated
  /// a RESULT it had only ever checked in one repository's Dart. A domain
  /// claimed wider than the result checked is WORSE than the narrow claim it was
  /// improving on, because it reads as more careful. The repair is not to widen
  /// again. It is to state the domain that actually carries the verdict.
  ///
  /// THE DOMAIN THAT ACTUALLY CARRIES THE VERDICT — non-test Dart, THIS
  /// repository, comment-stripped, pinned. That is limb 9's real reach: it walks
  /// `DART_ROOTS` (`apps`, `packages`, `tooling/bricks`), cuts
  /// `/(?:test|integration_test)/`, takes every file through
  /// `stripSourceComments`, and skips `APP_CONFIG_DART` itself. It reads no
  /// JavaScript, no markdown and no other repository, so nothing outside this
  /// domain can arm it or disarm it. From this repo's root, over every tracked
  /// `.dart` — a SUPERSET of that walk — this prints 0:
  ///
  ///     node --input-type=module -e "
  ///     import {execSync as x} from 'node:child_process';
  ///     import {stripSourceComments as s} from './tooling/ci/text-reductions.mjs';
  ///     const T = 'a028cc0';
  ///     const SELF = 'packages/core/lib/src/config/app_config.dart';
  ///     const g = (c) => x(c, {encoding: 'utf8', maxBuffer: 1e9});
  ///     let n = 0;
  ///     for (const f of g('git ls-tree -r --name-only ' + T).split('\n'))
  ///       if (f.endsWith('.dart') && !/\/(?:test|integration_test)\//.test(f)
  ///           && f !== SELF)
  ///         n += (s(g('git show ' + T + ':' + JSON.stringify(f)), '.dart')
  ///               .match(/\.theme\b/g) || []).length;
  ///     console.log(n);
  ///     "
  ///
  /// ZERO — not "nine, of which some are false positives". Zero, in the only
  /// domain the guard can see. The self-reference trap is closed by the same two
  /// devices as above: the commit is pinned, and this file is excluded BY NAME
  /// exactly as limb 9 excludes it, so no quantity of prose written here can
  /// move the number this paragraph states.
  ///
  /// 🔴 THE FOUR-REPO SWEEP STRENGTHENS THE VERDICT, IT DOES NOT SOFTEN IT.
  /// Every one of the 53 hits outside this repository is either prose in a
  /// markdown note or another language's unrelated settings key, in a repository
  /// that contains no Dart at all. Not one of them is STRUCTURALLY CAPABLE of
  /// being a reader of `AppConfig.theme` — reading this field requires Dart that
  /// parses this class, and there is none of that outside this tree. So the wide
  /// sweep is not a concession; it is the strongest evidence yet for READ BY
  /// NOTHING, and it now rests on a domain small enough to re-run in seconds.
  ///
  /// HOW LIMB 9 READS IT TODAY — rewritten 2026-08-25; do NOT describe the old
  /// matcher. It no longer banks a bare `.theme` on any receiver as a reader. It
  /// computes a LOOSE set (the access on any receiver) and a BOUND set (the
  /// access resolved textually to an AppConfig-typed identifier), and feeds each
  /// branch the set whose error direction is a visible FAIL; loose-only files
  /// print as NEAR MISS instead of counting. Search `assert-config-registry.mjs`
  /// for `boundReaders` and for `NEAR MISS`. Consequence for this note:
  /// `MaterialApp.theme` would no longer be banked as a reader even if it left
  /// `/test/`. The false positive the paragraph at the top warns about is now a
  /// warning for the HUMAN running the sweep rather than for the guard — which
  /// is exactly who got it wrong here, twice.
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
