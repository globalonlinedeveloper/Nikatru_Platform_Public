import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/core/config/app_config.dart';
import 'package:subly/state/providers.dart';

/// [pipeline C-10] The CFG-1 bundled-default contract, MOVED HERE FROM
/// `packages/core/test/config_test.dart`.
///
/// The values it pins used to live in core's `kDefaultConfigs` under a hardcoded
/// `'subly'` key — an app-specific value in shared code, exported from the barrel
/// every stamped app imports. The values moved into this app; this test moved with
/// them, so the protection is relocated rather than lost.
///
/// 🔒 WHAT IT PROTECTS: `kSublyDefaultConfig` must equal the server's
/// authoritative defaults in `services/platform/src/config.ts` `DEFAULT_CONFIGS`.
/// The mirror image of this assertion lives in that Worker's `config.test.ts`, so
/// adding or changing a config field on EITHER side fails the other's lane.
void main() {
  group('bundled default mirrors the server DEFAULT_CONFIGS', () {
    test('kSublyDefaultConfig equals the server contract values', () {
      const core.AppConfig d = kSublyDefaultConfig;
      expect(d.appId, 'subly');
      expect(d.apiBaseUrl, 'https://api.nikatru.com/v1');
      expect(d.features, <String, bool>{
        'renewals': true,
        'budgets': true,
        'exports': true,
      });
      expect(d.paywall.enabled, isFalse);
      expect(d.contentPack, isNull);
      expect(d.copy, isEmpty);
      expect(d.minSupportedVersion, '1.0.0');
      // `flags` is TYPED on the server too (services/platform/src/types.ts +
      // config.ts `flags: {}`), so adding a field on either side fails the other.
      expect(d.flags, isEmpty);
    });

    test('the default is keyed to THIS app', () {
      expect(kSublyDefaultConfig.appId, AppConfig.appId);
    });
  });

  group('the offline fallback actually resolves', () {
    // The regression this guards: core's kDefaultConfigs is now EMPTY, and
    // appConfigProvider THROWS when the loader cannot produce a config. If the
    // seed were ever dropped from configLoaderProvider, Subly would crash at
    // launch on any network failure — and in demo mode, every launch.
    test('a seeded cache resolves without any network', () {
      final core.ConfigCache cache = core.ConfigCache(
        seed: <String, core.AppConfig>{AppConfig.appId: kSublyDefaultConfig},
      );
      final core.AppConfig? resolved = cache.get(AppConfig.appId);
      expect(resolved, isNotNull, reason: 'offline launch would throw');
      expect(resolved!.apiBaseUrl, 'https://api.nikatru.com/v1');
    });

    test(
      'core no longer answers for this app — the seed is the only source',
      () {
        // Proves the clone tell is genuinely gone from shared code, not merely
        // shadowed by the seed.
        expect(core.defaultConfigFor('subly'), isNull);
        expect(core.kDefaultConfigs, isEmpty);
      },
    );
  });
}
