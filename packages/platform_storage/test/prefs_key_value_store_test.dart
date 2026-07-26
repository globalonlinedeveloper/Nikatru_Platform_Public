import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('write / read / containsKey / remove round-trip', () async {
    final KeyValueStore kv = await PrefsKeyValueStore.create();
    expect(await kv.read('k'), isNull);
    expect(await kv.containsKey('k'), isFalse);

    await kv.write('k', 'v');
    expect(await kv.read('k'), 'v');
    expect(await kv.containsKey('k'), isTrue);

    await kv.write('k', 'v2'); // overwrite
    expect(await kv.read('k'), 'v2');

    await kv.remove('k');
    expect(await kv.read('k'), isNull);
    expect(await kv.containsKey('k'), isFalse);
  });

  test('reads values already present in the store', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{'a': '1'});
    final KeyValueStore kv = await PrefsKeyValueStore.create();
    expect(await kv.read('a'), '1');
  });

  test('backs a persisted ConfigCache (hydrate round-trip)', () async {
    // Proves the adapter satisfies the core ConfigCache persistence contract.
    final KeyValueStore kv = await PrefsKeyValueStore.create();
    // [pipeline C-10] a neutral fixture, not a real app's name: core carries no
    // app-specific default any more, and neither should its adapters' tests.
    const AppConfig fixture = AppConfig(
      appId: 'fixture',
      apiBaseUrl: 'https://api.example/v1',
      features: <String, bool>{},
      paywall: PaywallConfig(enabled: false),
      contentPack: null,
      copy: <String, String>{},
      minSupportedVersion: '1.0.0',
    );
    final AppConfig canary = fixture.copyWith(
      apiBaseUrl: 'https://persisted.example/v1',
    );
    ConfigCache(store: kv).put(canary);
    // put()'s write-through is fire-and-forget; let it settle before reading.
    await Future<void>.delayed(Duration.zero);

    final ConfigCache fresh = ConfigCache(store: kv);
    await fresh.hydrate(<String>['fixture']);
    expect(fresh.get('fixture')!.apiBaseUrl, 'https://persisted.example/v1');
  });
}
