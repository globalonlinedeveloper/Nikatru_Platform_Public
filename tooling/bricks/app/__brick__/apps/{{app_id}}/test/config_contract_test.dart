import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:{{app_id.snakeCase()}}/core/app_config.dart';
import 'package:{{app_id.snakeCase()}}/state/providers.dart';

/// [pipeline 4]B-14 — THE CLIENT HALF OF THE `GET /config/<app>` WIRE CONTRACT,
/// IN THE BRICK.
///
/// 🔴 WHY IT IS HERE AND NOT IN AN APP. The pair that pins this route used to be
/// `services/platform/test/config.test.ts` ↔ `apps/subly/test/config_default_test.dart`.
/// Subly is ONE stamped app: a pin living there proves the contract holds for
/// Subly and for nothing the factory stamps next, so every new app was born
/// outside the one contract stage 4 had actually built. B-14's replacement
/// acceptance says so in as many words — *"the client half of each pair must
/// live where a stamped app inherits it — the brick's test tree — not in
/// `apps/subly`"*. This file is that half, and `assert-analytics-contract.mjs`
/// limb 5 now REFUSES a client half that resolves anywhere else.
///
/// 🔒 [kConfigWireKeys] MUST EQUAL `REQUIRED_KEYS` in
/// `services/platform/test/config.test.ts`, both directions, and that equality is
/// enforced by the guard rather than by anybody remembering — the two files are
/// in different languages and cannot import each other. So:
///   · a field ADDED on the server and not here → the guard goes red;
///   · a field DELETED here → the guard goes red;
///   · a field the server sends that `core.AppConfig.fromJson` does not read →
///     the guard goes red, and the `dropping one changes what this app resolves`
///     test below goes red in EVERY stamped app's own suite.
///
/// ⚠️ NOT A LIST OF NAMES ANYBODY LIKES THE LOOK OF. Every key below is
/// exercised against a real parse in this file; a key that could be deleted from
/// [kConfigWireKeys] with nothing going red would be inflating coverage rather
/// than providing it.
const List<String> kConfigWireKeys = <String>[
  'app_id',
  'api_base_url',
  'features',
  'flags',
  'paywall',
  'content_pack',
  'copy',
  'min_supported_version',
  'max_promos_per_week',
  'update_url',
];

/// ONE server body carrying every key in [kConfigWireKeys], each with a value
/// the parser's fallback cannot produce by accident.
///
/// That last part is load-bearing: `AppConfig.fromJson` coerces an absent or
/// wrong-typed non-required value to a default (`{}`, `null`, `0`) rather than
/// throwing, which is correct — a drifted config body must never crash a launch
/// — and it is also exactly what would make a key silently stop being read. A
/// probe value that equals the fallback would test nothing.
Map<String, Object?> _serverBody() => <String, Object?>{
  'app_id': AppConfig.appId,
  'api_base_url': 'https://contract.invalid/v1',
  'features': <String, bool>{'contract_probe': true},
  'flags': <String, int>{'contract_rollout': 42},
  'paywall': <String, Object?>{'enabled': true},
  'content_pack': 'https://contract.invalid/pack',
  'copy': <String, String>{'contract_probe': 'copy'},
  'min_supported_version': '9.9.9',
  'max_promos_per_week': 3,
  'update_url': 'https://contract.invalid/update',
};

/// Every TYPED field the parse produces, as one comparable string.
///
/// Deliberately NOT `AppConfig.toJson()`: that method omits `update_url`
/// entirely, so a drop-one comparison built on it would report "no difference"
/// for the one field the force-update wall depends on and the loop below would
/// pass while covering nine keys instead of ten.
String _fingerprint(core.AppConfig c) => jsonEncode(<String, Object?>{
  'app_id': c.appId,
  'api_base_url': c.apiBaseUrl,
  'features': c.features,
  'flags': c.flags,
  'paywall': c.paywall.toJson(),
  'content_pack': c.contentPack,
  'copy': c.copy,
  'min_supported_version': c.minSupportedVersion,
  'max_promos_per_week': c.maxPromosPerWeek,
  'update_url': c.updateUrl,
});

/// [_fingerprint] of a parsed body, or null when the parse REFUSES it outright.
String? _tryFingerprint(Map<String, Object?> body) {
  try {
    return _fingerprint(core.AppConfig.fromJson(body));
  } on FormatException {
    return null;
  }
}

void main() {
  group('GET /config/<app> — the wire contract this app is born inside', () {
    test('the pinned key set is exactly what the probe body carries', () {
      // Keeps the probe honest: a key added to the contract without a value
      // here would be "pinned" by a body that never carries it.
      expect(_serverBody().keys.toSet(), kConfigWireKeys.toSet());
    });

    test('every pinned key lands on a typed field of the parsed config', () {
      final core.AppConfig c = core.AppConfig.fromJson(_serverBody());
      expect(c.appId, AppConfig.appId);
      expect(c.apiBaseUrl, 'https://contract.invalid/v1');
      expect(c.features['contract_probe'], isTrue);
      expect(c.flags['contract_rollout'], 42);
      expect(c.paywall.enabled, isTrue);
      expect(c.contentPack, 'https://contract.invalid/pack');
      expect(c.copy['contract_probe'], 'copy');
      expect(c.minSupportedVersion, '9.9.9');
      expect(c.maxPromosPerWeek, 3);
      expect(c.updateUrl, 'https://contract.invalid/update');
    });

    test('every pinned key is READ — dropping one changes what this app '
        'resolves', () {
      final String full = _fingerprint(core.AppConfig.fromJson(_serverBody()));
      for (final String key in kConfigWireKeys) {
        final String? without = _tryFingerprint(_serverBody()..remove(key));
        // `app_id`, `api_base_url` and `min_supported_version` are STRICT: the
        // parse refuses the body outright, which is a stronger statement than
        // "the result differs" and is what makes the client fall back to its
        // compiled-in default instead of running on a half-config.
        if (without == null) continue;
        expect(
          without,
          isNot(full),
          reason:
              '`$key` is on the wire and this app cannot tell whether it '
              'arrived. Either the server stopped needing it — in which case it '
              'leaves REQUIRED_KEYS and this list together — or core\'s '
              'AppConfig.fromJson stopped reading it, and every stamped app is '
              'now ignoring a field the shared server still sends.',
        );
      }
    });

    test("this app's compiled-in default is a body of the same contract", () {
      // The offline half. `configLoaderProvider` seeds the cache with
      // `kAppDefaultConfig`, so a default that could not survive its own parse
      // would leave a freshly stamped app with no resolvable config the first
      // time the config host is unreachable — which, for a demo build or any
      // test run, is every launch.
      final core.AppConfig round = core.AppConfig.fromJson(
        kAppDefaultConfig.toJson(),
      );
      expect(round.appId, AppConfig.appId);
      expect(round.apiBaseUrl, kAppDefaultConfig.apiBaseUrl);
      expect(round.minSupportedVersion, kAppDefaultConfig.minSupportedVersion);
      expect(round.contentPack, kAppDefaultConfig.contentPack);
    });
  });
}
