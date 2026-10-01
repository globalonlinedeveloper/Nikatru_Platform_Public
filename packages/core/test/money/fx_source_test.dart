// O-ST-FX-RATES-UNUSED-BY-THE-APP · the loader every app fetches its FxTable
// through, and the bag fold every "one total" figure takes.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The vector's own shape (contracts/fx/latest.v1.example.json `response`),
/// two rates only.
Map<String, Object?> _payload(String asOf) => <String, Object?>{
  'source': 'Euro foreign exchange reference rates, European Central Bank',
  'base': 'EUR',
  'asOf': asOf,
  'rates': <String, Object?>{'USD': 1.1732, 'INR': 103.987},
};

class _Transport implements FxTransport {
  _Transport(this.answer);
  Result<Map<String, Object?>> answer;
  int calls = 0;

  @override
  Future<Result<Map<String, Object?>>> fetchLatest() async {
    calls++;
    return answer;
  }
}

void main() {
  group('FxRatesLoader', () {
    test('fetches, caches, and serves the cache inside the hour', () async {
      DateTime now = DateTime.utc(2026, 9, 26, 7);
      final _Transport t = _Transport(Result.ok(_payload('2026-09-25')));
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final FxRatesLoader loader = FxRatesLoader(
        transport: t,
        store: Future<KeyValueStore>.value(store),
        clock: () => now,
      );
      final FxTable? first = await loader.load();
      expect(first?.asOf, DateTime.utc(2026, 9, 25));
      expect(t.calls, 1);
      expect(await store.read(FxRatesLoader.storeKey), isNotNull);

      now = now.add(const Duration(minutes: 59));
      await loader.load();
      expect(t.calls, 1, reason: 'inside the hour the device copy serves');

      now = now.add(const Duration(minutes: 2));
      await loader.load();
      expect(t.calls, 2, reason: 'past the hour the wire is asked again');
    });

    test('offline: the last cached table, with ITS date', () async {
      DateTime now = DateTime.utc(2026, 9, 26, 7);
      final _Transport t = _Transport(Result.ok(_payload('2026-09-25')));
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final FxRatesLoader loader = FxRatesLoader(
        transport: t,
        store: Future<KeyValueStore>.value(store),
        clock: () => now,
      );
      await loader.load();
      t.answer = const Result<Map<String, Object?>>.err(Failure('offline'));
      now = now.add(const Duration(days: 3));
      final FxTable? offline = await loader.load();
      expect(t.calls, 2);
      expect(offline, isNotNull);
      expect(offline!.asOf, DateTime.utc(2026, 9, 25));
    });

    test('never answered and offline: null, not a table', () async {
      final FxRatesLoader loader = FxRatesLoader(
        transport: const UnavailableFxTransport(),
        store: Future<KeyValueStore>.value(InMemoryKeyValueStore()),
      );
      expect(await loader.load(), isNull);
    });

    test('an unreadable answer is not cached and not served', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final FxRatesLoader loader = FxRatesLoader(
        transport: _Transport(
          Result.ok(<String, Object?>{'base': 'USD', 'asOf': '2026-09-25'}),
        ),
        store: Future<KeyValueStore>.value(store),
      );
      expect(await loader.load(), isNull);
      expect(await store.read(FxRatesLoader.storeKey), isNull);
    });

    test('overrides reach the table it returns', () async {
      final FxRatesLoader loader = FxRatesLoader(
        transport: _Transport(Result.ok(_payload('2026-09-25'))),
        store: Future<KeyValueStore>.value(InMemoryKeyValueStore()),
      );
      final FxTable? t = await loader.load(
        overrides: <String, num>{'USD/INR': 90},
      );
      expect(
        t!.convert(const Money(1000, 'USD'), 'INR'),
        const Money(90000, 'INR'),
      );
    });
  });

  group('FxTable.convertBag', () {
    final FxTable table = FxTable.tryFromJson(_payload('2026-09-25'))!;

    test('₹649 + \$10 is ONE rupee total at the vector rate', () {
      final FxConvertedBag r = table.convertBag(
        MoneyBag.sum(const <Money>[Money(64900, 'INR'), Money(1000, 'USD')]),
        'INR',
      );
      // \$10.00 → 88635 paise (the vector's own row), + 64900.
      expect(r.bag.byCurrency.keys, <String>['INR']);
      expect(r.bag.single, const Money(153535, 'INR'));
      expect(r.converted, isTrue);
    });

    test('a currency the table cannot price stays beside the total', () {
      final FxConvertedBag r = table.convertBag(
        MoneyBag.sum(const <Money>[Money(500, 'NZD'), Money(1000, 'USD')]),
        'INR',
      );
      expect(r.bag.byCurrency.keys, <String>['INR', 'NZD']);
      expect(r.bag.byCurrency['NZD'], const Money(500, 'NZD'));
    });

    test('one currency already home: nothing converted, no caption owed', () {
      final FxConvertedBag r = table.convertBag(
        MoneyBag.sum(const <Money>[Money(64900, 'INR')]),
        'INR',
      );
      expect(r.converted, isFalse);
      expect(r.bag.single, const Money(64900, 'INR'));
    });
  });
}
