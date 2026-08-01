import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => FlutterSecureStorage.setMockInitialValues(<String, String>{}));

  test('write / read / delete round-trip + deleteAll', () async {
    final SecureStore s = FlutterSecureStore();
    await s.write('token', 'abc');
    await s.write('refresh', 'xyz');
    expect(await s.read('token'), 'abc');

    await s.delete('token');
    expect(await s.read('token'), isNull);
    expect(await s.read('refresh'), 'xyz');

    await s.deleteAll();
    expect(await s.read('refresh'), isNull);
  });

  test('backs an EntitlementCache (saveVerified → readValid → clear)',
      () async {
    // Proves the adapter satisfies the core EntitlementCache contract.
    //
    // ⚠️ `saveVerified`, and a `now` INSIDE the ceiling. [pipeline 5]M-8 gave
    // the cache a staleness bound, and an answer with no `verified_at` is
    // treated as infinitely stale — deliberately, because that is the shape of a
    // cache written before the field existed and the shape of a corrupt one, and
    // neither is evidence that a server confirmed anything. Reading at year 2099
    // off a plain `save` therefore (correctly) returns not-Pro now.
    //
    // The subject here is the ADAPTER — that a real FlutterSecureStore round-
    // trips what the cache writes — so the fixture uses the same clock for both
    // ends and leaves the ceiling's own behaviour to packages/core's suite,
    // which tests it in both directions.
    final DateTime at = DateTime.utc(2026, 8, 1);
    final EntitlementCache cache =
        EntitlementCache(store: FlutterSecureStore());
    await cache.saveVerified(
      const Entitlements(
        appId: 'subly',
        isPro: true,
        items: <Entitlement>[
          Entitlement(
            entitlement: 'pro',
            productId: 'subly_pro',
            store: 'paddle',
            isActive: true,
          ),
        ],
      ),
      now: at,
    );
    final Entitlements v = await cache.readValid(now: at);
    expect(v.isPro, isTrue);

    await cache.clear();
    expect(await cache.readRaw(), isNull);
  });
}
