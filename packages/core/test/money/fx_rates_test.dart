// ST-I3 · FxTable against the SHARED VECTOR, contracts/fx/latest.v1.example.json.
//
// 🔴 THE EXPECTED MINOR UNITS ARE READ, NOT RESTATED. The platform Worker's
// test (services/platform/test/fx.test.ts) asserts it stores and serves the
// vector's `response` for a document in the ECB's own format, and re-derives
// every `conversions` row from `response.rates` with its own exact arithmetic;
// this file reads the same `response` into FxTable and requires the same minor
// units. A shape or rounding change made on one side alone is red on the other.
//
// VM-ONLY: it reads the vector off disk through `dart:io`, and workspace_gate
// also runs this package under `dart test -p chrome`.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// The vector, found from either cwd the suite runs in: the package root
/// (`melos run test`) or the workspace root (`flutter test packages/core`).
/// Finding it NOWHERE fails: every expectation below would otherwise run
/// against nothing.
Map<String, Object?> _vector() {
  const String rel = 'contracts/fx/latest.v1.example.json';
  Directory d = Directory.current;
  for (int i = 0; i < 6; i++) {
    final File f = File('${d.path}/$rel');
    if (f.existsSync()) {
      return jsonDecode(f.readAsStringSync()) as Map<String, Object?>;
    }
    if (d.parent.path == d.path) break;
    d = d.parent;
  }
  fail('COVERAGE LOST — $rel was not found above ${Directory.current.path}.');
}

void main() {
  final Map<String, Object?> vector = _vector();
  final Object? response = vector['response'];
  final List<Object?> conversions = vector['conversions']! as List<Object?>;

  FxTable table() {
    final FxTable? t = FxTable.tryFromJson(response);
    expect(t, isNotNull, reason: 'the vector response must read as a table');
    return t!;
  }

  group('FxTable reads the vector', () {
    test('asOf, source and every quoted currency come through', () {
      final FxTable t = table();
      final Map<String, Object?> r = response! as Map<String, Object?>;
      expect(t.asOf, DateTime.utc(2026, 9, 25));
      expect(t.source, r['source']);
      expect(t.currencies.toSet(), <String>{
        'EUR',
        ...(r['rates']! as Map<String, Object?>).keys,
      });
    });

    test('every conversion row lands on the vector\'s minor units', () {
      expect(conversions, isNotEmpty);
      final FxTable t = table();
      for (final Object? raw in conversions) {
        final Map<String, Object?> c = raw! as Map<String, Object?>;
        final Money from = Money.tryFromJson(c['from'])!;
        final Money expected = Money.tryFromJson(c['expect'])!;
        expect(
          t.convert(from, c['to']! as String),
          expected,
          reason: '${c['why']}',
        );
      }
    });

    test('₹649 in dollars through EUR is the vector\'s 732 cents', () {
      // Named on its own because it is the case ST-I3 exists for.
      expect(
        table().convert(const Money(64900, 'INR'), 'USD'),
        const Money(732, 'USD'),
      );
    });
  });

  group('overrides win', () {
    test('a user rate for the pair beats the table, both directions', () {
      final FxTable t = table().withOverrides(<String, num>{'USD/INR': 88});
      // $10.00 at the user's 88: exactly ₹880.00, not the table's ₹886.35.
      expect(
        t.convert(const Money(1000, 'USD'), 'INR'),
        const Money(88000, 'INR'),
      );
      // ₹649 back at 1/88: 737.5 cents, half to even → 738.
      expect(
        t.convert(const Money(64900, 'INR'), 'USD'),
        const Money(738, 'USD'),
      );
      // A pair the override does not name still uses the table.
      expect(
        t.convert(const Money(64900, 'INR'), 'EUR'),
        const Money(624, 'EUR'),
      );
    });

    test('an override can price a currency the ECB does not quote', () {
      final FxTable t = table();
      expect(t.convert(const Money(1000, 'AED'), 'INR'), isNull);
      expect(
        t
            .withOverrides(<String, num>{'AED/INR': 24.5})
            .convert(const Money(1000, 'AED'), 'INR'),
        const Money(24500, 'INR'),
      );
    });

    test('a malformed override is a caller bug, not a silent skip', () {
      expect(
        () => table().withOverrides(<String, num>{'USDINR': 88}),
        throwsArgumentError,
      );
      expect(
        () => table().withOverrides(<String, num>{'USD/INR': 0}),
        throwsArgumentError,
      );
    });
  });

  group('rounding is half to even, in the target minor units', () {
    // An override of 1.5 turns cents into exact halves, so the tie is real and
    // not a float accident: 1 → 1.5 → 2, 3 → 4.5 → 4 (half away would say 5).
    final FxTable t = FxTable(
      asOf: DateTime.utc(2026, 9, 25),
      ratesPerEuro: <String, num>{'USD': 1.5},
    );
    test('ties go to the even neighbour', () {
      expect(t.convert(const Money(1, 'EUR'), 'USD'), const Money(2, 'USD'));
      expect(t.convert(const Money(3, 'EUR'), 'USD'), const Money(4, 'USD'));
      expect(t.convert(const Money(-3, 'EUR'), 'USD'), const Money(-4, 'USD'));
    });
    test('the same currency is returned untouched', () {
      expect(
        t.convert(const Money(649, 'INR'), 'INR'),
        const Money(649, 'INR'),
      );
    });
    test('an unquoted currency is null, never a guess', () {
      expect(t.convert(const Money(100, 'EUR'), 'INR'), isNull);
      expect(t.canConvert('EUR', 'INR'), isFalse);
    });
  });

  group('staleness', () {
    test('a 5-day-old table is stale; a 4-day-old one is not', () {
      final FxTable t = table(); // asOf 2026-09-25
      expect(t.isStaleAt(DateTime.utc(2026, 9, 30)), isTrue);
      expect(t.isStaleAt(DateTime.utc(2026, 9, 29)), isFalse);
      // An ordinary weekend: Friday's fix read on Monday morning.
      expect(t.isStaleAt(DateTime.utc(2026, 9, 28, 6)), isFalse);
    });
  });

  group('tryFromJson refuses what the Worker would refuse', () {
    Map<String, Object?> mutate(void Function(Map<String, Object?>) edit) {
      final Map<String, Object?> copy =
          jsonDecode(jsonEncode(response)) as Map<String, Object?>;
      edit(copy);
      return copy;
    }

    test('a zero rate, a non-EUR base, a non-day asOf — each null', () {
      expect(
        FxTable.tryFromJson(
          mutate((Map<String, Object?> j) {
            (j['rates']! as Map<String, Object?>)['INR'] = 0;
          }),
        ),
        isNull,
      );
      expect(
        FxTable.tryFromJson(
          mutate((Map<String, Object?> j) {
            j['base'] = 'USD';
          }),
        ),
        isNull,
      );
      expect(
        FxTable.tryFromJson(
          mutate((Map<String, Object?> j) {
            j['asOf'] = '2026-02-30';
          }),
        ),
        isNull,
      );
      expect(FxTable.tryFromJson('not a map'), isNull);
    });
  });
}
