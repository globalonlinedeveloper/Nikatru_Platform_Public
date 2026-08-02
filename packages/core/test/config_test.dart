import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The exact JSON the platform Worker serves for `GET /config/subly`
/// (mirrors `services/platform/src/config.ts` DEFAULT_CONFIGS.subly).
Map<String, Object?> sublyServerJson() => <String, Object?>{
      'app_id': 'subly',
      'api_base_url': 'https://api.nikatru.com/v1',
      'features': <String, Object?>{
        'renewals': true,
        'budgets': true,
        'exports': true,
      },
      'paywall': <String, Object?>{'enabled': false},
      'content_pack': null,
      'copy': <String, Object?>{},
      'min_supported_version': '1.0.0',
    };

/// A programmable [ConfigTransport] — no network. Starts either succeeding with
/// a JSON body or failing; switch mid-test with [succeedWith] / [failWith].
class FakeTransport implements ConfigTransport {
  FakeTransport.ok(this._json);
  FakeTransport.offline()
      : _json = null,
        _failure = const Failure('offline');

  Map<String, Object?>? _json;
  Failure? _failure;
  int calls = 0;

  void succeedWith(Map<String, Object?> json) {
    _json = json;
    _failure = null;
  }

  void failWith([String message = 'offline']) {
    _failure = Failure(message);
    _json = null;
  }

  @override
  Future<Result<Map<String, Object?>>> fetch(String appId) async {
    calls++;
    final Failure? f = _failure;
    if (f != null) return Result<Map<String, Object?>>.err(f);
    return Result<Map<String, Object?>>.ok(_json!);
  }
}

/// [pipeline C-10] The "bundled default" now arrives as a SEED rather than from a
/// hardcoded entry inside core, because core must not know any app's name. These
/// tests seed it the same way every real app does (the brick's `kAppDefaultConfig`,
/// Subly's `kSublyDefaultConfig`) — so they still exercise the real
/// network -> last-good -> bundled-default ladder, just wired honestly.
AppConfig seededDefault(String appId) =>
    AppConfig.fromJson(sublyServerJson()).copyWith(appId: appId);

ConfigLoader seededLoader(ConfigTransport t, {String appId = 'subly'}) =>
    ConfigLoader(
      transport: t,
      cache: ConfigCache(
        seed: <String, AppConfig>{appId: seededDefault(appId)},
      ),
    );

void main() {
  group('AppConfig.fromJson (CFG-1 contract shape)', () {
    test('parses the server config into typed fields', () {
      final AppConfig c = AppConfig.fromJson(sublyServerJson());
      expect(c.appId, 'subly');
      expect(c.apiBaseUrl, 'https://api.nikatru.com/v1');
      expect(c.feature('renewals'), isTrue);
      expect(c.feature('budgets'), isTrue);
      expect(c.feature('exports'), isTrue);
      expect(c.paywall.enabled, isFalse);
      expect(c.contentPack, isNull);
      expect(c.copy, isEmpty);
      expect(c.minSupportedVersion, '1.0.0');
      expect(c.theme, isNull);
    });

    test('round-trips through toJson with snake_case keys', () {
      final Map<String, Object?> j =
          AppConfig.fromJson(sublyServerJson()).toJson();
      expect(j.containsKey('api_base_url'), isTrue);
      expect(j.containsKey('min_supported_version'), isTrue);
      final AppConfig again = AppConfig.fromJson(j);
      expect(again.apiBaseUrl, 'https://api.nikatru.com/v1');
      expect(again.feature('renewals'), isTrue);
      expect(again.paywall.enabled, isFalse);
    });

    test('preserves unknown paywall keys (forward-compatible)', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['paywall'] = <String, Object?>{'enabled': true, 'plan': 'pro'};
      final AppConfig c = AppConfig.fromJson(j);
      expect(c.paywall.enabled, isTrue);
      expect(c.paywall.extra['plan'], 'pro');
      expect(c.paywall.toJson()['plan'], 'pro');
    });

    test('throws FormatException when api_base_url is missing', () {
      final Map<String, Object?> j = sublyServerJson()..remove('api_base_url');
      expect(() => AppConfig.fromJson(j), throwsFormatException);
    });

    test('coerces a wrong-typed content_pack to null (non-required, lenient)',
        () {
      // A non-string content_pack must not throw a TypeError — only app_id,
      // api_base_url and min_supported_version are strict.
      final Map<String, Object?> j = sublyServerJson()..['content_pack'] = 123;
      final AppConfig c = AppConfig.fromJson(j);
      expect(c.contentPack, isNull);
    });

    test('parses flags (percentage rollout); toJson omits them when empty', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['flags'] = <String, Object?>{'new_home': 25, 'beta_search': 100};
      final AppConfig c = AppConfig.fromJson(j);
      expect(c.rolloutPercent('new_home'), 25);
      expect(c.rolloutPercent('beta_search'), 100);
      expect(c.rolloutPercent('absent'), 0); // absent ⇒ off
      // round-trips through toJson
      expect(AppConfig.fromJson(c.toJson()).rolloutPercent('new_home'), 25);
      // a config with no flags does not emit the key (drift-safe)
      expect(
          AppConfig.fromJson(sublyServerJson()).toJson().containsKey('flags'),
          isFalse);
      // lenient/fail-safe: a wrong-typed value drops to 0 (off), a non-map
      // flags block parses to empty — a garbled percent can never ship a flag.
      expect(
          AppConfig.fromJson(
                  sublyServerJson()..['flags'] = <String, Object?>{'x': '50'})
              .rolloutPercent('x'),
          0);
      expect(AppConfig.fromJson(sublyServerJson()..['flags'] = 'nope').flags,
          isEmpty);
    });

    test('feature() and text() honor their fallbacks', () {
      final AppConfig c = AppConfig.fromJson(sublyServerJson())
          .copyWith(copy: <String, String>{'welcome': 'Hi'});
      expect(c.text('welcome'), 'Hi');
      expect(c.text('missing'), 'missing');
      expect(c.feature('nope'), isFalse);
      expect(c.feature('nope', orElse: true), isTrue);
    });
  });

  // ── [pipeline 13]T-6 · the promo cap is on BOTH sides of the contract ──────
  //
  // The server declares `max_promos_per_week` and its contract test asserts the
  // full key set in both directions. This is the client half: the key parses,
  // it survives a round trip, and — the part that matters — a config body that
  // omits it or sends rubbish resolves to ZERO rather than to "no opinion".
  //
  // "No opinion" is the wrong default for a cap. A cap that disappears when the
  // server is unreachable is not a cap; it is a cap that stops applying exactly
  // when nobody is watching.
  group('[13]T-6 max_promos_per_week is read, and its absence means ZERO', () {
    test('parses the value the server sends', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['max_promos_per_week'] = 2;
      expect(AppConfig.fromJson(j).maxPromosPerWeek, 2);
    });

    test('an ABSENT key is zero, not unlimited and not null', () {
      // sublyServerJson() deliberately does not carry the key: an older cached
      // body, or an offline fall back to a bundled default, looks exactly like
      // this — and must not be a way to lift the cap.
      expect(AppConfig.fromJson(sublyServerJson()).maxPromosPerWeek, 0);
    });

    test('a WRONG-TYPED value is zero, and does not throw', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['max_promos_per_week'] = 'lots';
      expect(AppConfig.fromJson(j).maxPromosPerWeek, 0);
    });

    test('a NEGATIVE value cannot make the cap smaller than off', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['max_promos_per_week'] = -5;
      expect(AppConfig.fromJson(j).maxPromosPerWeek, 0);
    });

    test('the key survives a toJson round trip, so a cache cannot drop it', () {
      final Map<String, Object?> j = sublyServerJson()
        ..['max_promos_per_week'] = 3;
      final Map<String, Object?> out = AppConfig.fromJson(j).toJson();
      expect(out['max_promos_per_week'], 3);
      expect(AppConfig.fromJson(out).maxPromosPerWeek, 3);
    });

    test('copyWith carries it, so a merge cannot silently reset it', () {
      final AppConfig c = AppConfig.fromJson(
        sublyServerJson()..['max_promos_per_week'] = 4,
      );
      expect(c.copyWith(appId: 'other').maxPromosPerWeek, 4);
      expect(c.copyWith(maxPromosPerWeek: 0).maxPromosPerWeek, 0);
    });
  });

  group('bundled defaults carry NO app-specific values', () {
    // [pipeline C-10] This group used to pin the hardcoded `'subly'` entry that
    // lived in core's kDefaultConfigs — an app name in shared code, exported from
    // the barrel every stamped app imports. The values AND the contract test that
    // pins them against the server moved to `apps/subly/test/config_default_test.dart`;
    // what is asserted here now is that core stayed generic.
    test('core knows the name of NO app', () {
      expect(
        kDefaultConfigs,
        isEmpty,
        reason: 'an app id here is inherited by every stamped app',
      );
    });

    test('any app id returns null — each app seeds its own default', () {
      expect(defaultConfigFor('subly'), isNull);
      expect(defaultConfigFor('ghost'), isNull);
    });
  });

  group('ConfigLoader (network → cache → bundled default)', () {
    test('returns the server config on a successful fetch', () async {
      final FakeTransport t = FakeTransport.ok(sublyServerJson());
      final ConfigLoader loader = ConfigLoader(transport: t);
      final Result<AppConfig> r = await loader.load('subly');
      expect(r.isOk, isTrue);
      expect(r.fold((AppConfig c) => c.apiBaseUrl, (_) => 'err'),
          'https://api.nikatru.com/v1');
      expect(t.calls, 1);
    });

    test('falls back to the bundled default when offline (offline-safe)',
        () async {
      final FakeTransport t = FakeTransport.offline();
      final ConfigLoader loader = seededLoader(t);
      final Result<AppConfig> r = await loader.load('subly');
      expect(r.isOk, isTrue);
      expect(r.fold((AppConfig c) => c.apiBaseUrl, (_) => 'err'),
          'https://api.nikatru.com/v1');
    });

    test('prefers the last-good cache over the bundled default', () async {
      final Map<String, Object?> override = sublyServerJson()
        ..['api_base_url'] = 'https://api-canary.nikatru.com/v1'
        ..['paywall'] = <String, Object?>{'enabled': true};
      final FakeTransport t = FakeTransport.ok(override);
      final ConfigLoader loader = ConfigLoader(transport: t);

      final Result<AppConfig> first = await loader.load('subly');
      expect(first.fold((AppConfig c) => c.apiBaseUrl, (_) => 'err'),
          'https://api-canary.nikatru.com/v1');

      t.failWith(); // network drops
      final Result<AppConfig> second = await loader.load('subly');
      expect(second.isOk, isTrue);
      expect(second.fold((AppConfig c) => c.apiBaseUrl, (_) => 'err'),
          'https://api-canary.nikatru.com/v1');
      expect(second.fold((AppConfig c) => c.paywall.enabled, (_) => false),
          isTrue);
    });

    test('falls back to the default when the body is malformed', () async {
      final FakeTransport t =
          FakeTransport.ok(<String, Object?>{'nonsense': 1});
      final ConfigLoader loader = seededLoader(t);
      final Result<AppConfig> r = await loader.load('subly');
      expect(r.isOk, isTrue);
      expect(r.fold((AppConfig c) => c.apiBaseUrl, (_) => 'err'),
          'https://api.nikatru.com/v1');
    });

    test('errs for an unknown app with no default when offline', () async {
      final FakeTransport t = FakeTransport.offline();
      final ConfigLoader loader = ConfigLoader(transport: t);
      final Result<AppConfig> r = await loader.load('ghost');
      expect(r.isOk, isFalse);
    });

    test('peek returns the bundled default without any network call', () async {
      final FakeTransport t = FakeTransport.offline();
      final ConfigLoader loader = seededLoader(t);
      expect(loader.peek('subly')?.apiBaseUrl, 'https://api.nikatru.com/v1');
      expect(loader.peek('ghost'), isNull);
      expect(t.calls, 0);
    });
  });
}
