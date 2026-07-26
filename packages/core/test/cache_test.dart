import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A neutral fixture config. [pipeline C-10] These tests used to reach into
/// core's own `kDefaultConfigs` for a real app's bundled default. That map is now
/// empty by design, so the fixture is declared locally — which is also the honest
/// shape for a test: it should not depend on which apps happen to exist.
const AppConfig _fixture = AppConfig(
  appId: 'fixture',
  apiBaseUrl: 'https://api.nikatru.com/v1',
  features: <String, bool>{},
  paywall: PaywallConfig(enabled: false),
  contentPack: null,
  copy: <String, String>{},
  minSupportedVersion: '1.0.0',
);

void main() {
  group('ConfigCache persistence (KeyValueStore-backed last-good)', () {
    test('put writes through and a fresh cache hydrates the last-good value',
        () async {
      final KeyValueStore kv = InMemoryKeyValueStore();
      final AppConfig canary =
          _fixture.copyWith(apiBaseUrl: 'https://api-canary.nikatru.com/v1');

      final ConfigCache writer = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      writer.put(canary);

      // A brand-new cache over the same store first sees only the bundled
      // default, then the persisted last-good after hydrate().
      final ConfigCache fresh = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      expect(fresh.get('fixture')!.apiBaseUrl, 'https://api.nikatru.com/v1');
      await fresh.hydrate(<String>['fixture']);
      expect(fresh.get('fixture')!.apiBaseUrl,
          'https://api-canary.nikatru.com/v1');
    });

    test('hydrate skips a corrupt persisted entry (bundled default survives)',
        () async {
      final KeyValueStore kv = InMemoryKeyValueStore(<String, String>{
        'nikatru.cfg.fixture': 'not-json{',
        'nikatru.cfg.fixture2': '{"foo":1}', // valid JSON, invalid AppConfig
      });
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['fixture']);
      expect(cache.get('fixture')!.apiBaseUrl, 'https://api.nikatru.com/v1');
    });

    test('hydrate tolerates a wrong-typed content_pack (coerced, not a crash)',
        () async {
      // Regression: content_pack as a non-string used to throw a TypeError that
      // escaped hydrate's on-FormatException catch and could crash startup.
      final KeyValueStore kv = InMemoryKeyValueStore(<String, String>{
        'nikatru.cfg.fixture': '{"app_id":"fixture",'
            '"api_base_url":"https://persisted.nikatru.com/v1",'
            '"min_supported_version":"1.0.0","content_pack":123}',
      });
      final ConfigCache cache = ConfigCache(
          store: kv, seed: <String, AppConfig>{'fixture': _fixture});
      await cache.hydrate(<String>['fixture']); // must not throw
      final AppConfig? c = cache.get('fixture');
      expect(c!.apiBaseUrl, 'https://persisted.nikatru.com/v1'); // loaded
      expect(c.contentPack, isNull); // wrong-typed value coerced away
    });

    test('without a store, put stays in-memory and hydrate is a no-op',
        () async {
      final ConfigCache cache = ConfigCache(
        seed: <String, AppConfig>{'fixture': _fixture},
      );
      final AppConfig canary =
          _fixture.copyWith(apiBaseUrl: 'https://x.example/v1');
      cache.put(canary);
      expect(cache.get('fixture')!.apiBaseUrl, 'https://x.example/v1');
      await cache.hydrate(<String>['fixture']); // no throw
    });
  });

  group('EntitlementCache (offline entitlement, ADR 005 grace window)', () {
    Entitlements lifetime() => const Entitlements(
          appId: 'fixture',
          isPro: true,
          items: <Entitlement>[
            Entitlement(
              entitlement: 'pro',
              productId: 'subly_pro',
              store: 'paddle',
              isActive: true, // no expiresAt => lifetime
            ),
          ],
        );

    Entitlements subscriptionExpiring(DateTime at) => Entitlements(
          appId: 'loop',
          isPro: true,
          items: <Entitlement>[
            Entitlement(
              entitlement: 'pro',
              productId: 'loop_annual',
              store: 'paddle',
              isActive: true,
              expiresAt: at,
            ),
          ],
        );

    test('save then readRaw round-trips', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(lifetime());
      final Entitlements? back = await cache.readRaw();
      expect(back, isNotNull);
      expect(back!.appId, 'fixture');
      expect(back.isPro, isTrue);
      expect(back.items.single.productId, 'subly_pro');
    });

    test('lifetime entitlement stays Pro offline indefinitely', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(lifetime());
      final Entitlements v =
          await cache.readValid(now: DateTime.utc(2099, 1, 1));
      expect(v.isPro, isTrue);
    });

    test('subscription within the grace window stays Pro', () async {
      final DateTime now = DateTime.utc(2026, 8, 1);
      final EntitlementCache cache = EntitlementCache(
        store: InMemorySecureStore(),
        grace: const Duration(days: 3),
      );
      // Expired yesterday, but inside the 3-day grace.
      await cache
          .save(subscriptionExpiring(now.subtract(const Duration(days: 1))));
      final Entitlements v = await cache.readValid(now: now);
      expect(v.isPro, isTrue);
    });

    test('subscription past expiry + grace drops to not-Pro (appId kept)',
        () async {
      final DateTime now = DateTime.utc(2026, 8, 1);
      final EntitlementCache cache = EntitlementCache(
        store: InMemorySecureStore(),
        grace: const Duration(days: 3),
      );
      await cache
          .save(subscriptionExpiring(now.subtract(const Duration(days: 10))));
      final Entitlements v = await cache.readValid(now: now);
      expect(v.isPro, isFalse);
      expect(v.appId, 'loop'); // still identifies the app for a re-check
    });

    test('clear removes the cache; readValid then reports none', () async {
      final EntitlementCache cache =
          EntitlementCache(store: InMemorySecureStore());
      await cache.save(lifetime());
      await cache.clear();
      expect(await cache.readRaw(), isNull);
      final Entitlements v = await cache.readValid(now: DateTime.utc(2026));
      expect(v.isPro, isFalse);
      expect(v.items, isEmpty);
    });

    test('corrupt secure-store value is treated as absent', () async {
      final SecureStore s = InMemorySecureStore(
          <String, String>{'nikatru.entitlements': 'garbage{'});
      final EntitlementCache cache = EntitlementCache(store: s);
      expect(await cache.readRaw(), isNull);
    });
  });
}
