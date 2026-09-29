// VM-ONLY: the fixtures are read off disk through dart:io, which the
// `dart test -p chrome` lane cannot do. `dart test` defaults to the VM, so the
// VM lane still runs every case below; the reader and the plan themselves are
// pure and also exercised from csv_codec_test.dart, which runs in both.
@TestOn('vm')
library;

import 'dart:convert';
import 'dart:io';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

import 'test_fields.dart';

/// Reads a hand-authored fixture from test/fixtures/import/, from the package
/// root or the repo root, and FAILS LOUDLY when it is absent — a missing file
/// read as empty would turn every assertion below into a test of nothing.
List<int> _fixtureBytes(String name) {
  for (final String p in <String>[
    'test/fixtures/import/$name',
    'packages/core/test/fixtures/import/$name',
  ]) {
    final File f = File(p);
    if (f.existsSync()) return f.readAsBytesSync();
  }
  fail('COVERAGE LOST — fixture $name not found from ${Directory.current.path}');
}

String _fixture(String name) => utf8.decode(_fixtureBytes(name));

ImportPlan _plan(
  String text, {
  DateOrder? dateOrder,
  Iterable<String> existingKeys = const <String>[],
  String? defaultCurrency,
}) {
  final CsvTable t = const CsvReader().read(text);
  return ImportPlan.build(
    t,
    ColumnMapping.infer(t.header, TestFields.all),
    fields: TestFields.all,
    keyOf: testKey,
    dateOrder: dateOrder,
    existingKeys: existingKeys,
    defaultCurrency: defaultCurrency,
  );
}

void _expectAccountedFor(ImportPlan p) {
  expect(p.accountedFor, p.rowCount, reason: 'a row was dropped silently');
}

void main() {
  group('the RED control — a quoted comma is one cell', () {
    test('"Netflix, Premium",649 parses as TWO cells, not three', () {
      const String line = '"Netflix, Premium",649';
      // What a naive split would do — the defect this reader exists to avoid.
      expect(line.split(','), hasLength(3));
      final CsvTable t = const CsvReader().read('name,price\n$line\n');
      expect(t.rows.single, <String>['Netflix, Premium', '649']);
    });
  });

  group('generic.csv — a comma sheet with an unknown column', () {
    final String text = _fixture('generic.csv');
    final CsvTable table = const CsvReader().read(text);
    final ColumnMapping mapping =
        ColumnMapping.infer(table.header, TestFields.all);

    test('sniffs the comma and maps headers by synonym', () {
      expect(table.delimiter, ',');
      expect(table.rows, hasLength(7));
      expect(mapping.columnOf('name'), 0);
      expect(mapping.columnOf('price'), 1);
      expect(mapping.columnOf('currency'), 2);
      expect(mapping.columnOf('cycle'), 3); // "Billing Cycle"
      expect(mapping.columnOf('next_renewal'), 4); // "Next Renewal"
      expect(mapping.columnOf('category'), 5);
    });

    test('the unknown "Card" column is listed and its cells kept', () {
      expect(mapping.unknownHeaders, <String>['Card']);
      final ImportPlan p = ImportPlan.build(
        table,
        mapping,
        fields: TestFields.all,
        keyOf: testKey,
      );
      expect(p.candidates.first.extras, <String, String>{'Card': 'HDFC'});
    });

    test('every row lands in exactly one bucket, and the counts add up', () {
      final ImportPlan p = _plan(
        text,
        existingKeys: <String>[
          ImportPlan.keyFor(
            name: 'NETFLIX',
            price: const Money(64900, 'INR'),
            cycle: 'monthly',
          ),
        ],
      );
      _expectAccountedFor(p);
      expect(p.rowCount, 7);
      expect(p.questions, isEmpty);
      expect(p.candidates.map((ImportCandidate c) => c.row), <int>[2, 3, 4]);
      expect(
        p.duplicates.map((ImportDuplicate d) => (d.candidate.row, d.ofRow)),
        <(int, int?)>[(1, null), (6, 2)],
      );
      expect(p.errors.map((ImportRowError e) => e.row), <int>[5, 7]);
      expect(p.errors[0].problems.single.fieldId, 'price');
      expect(p.errors[1].problems.single.fieldId, 'cycle');
      expect(p.errors[1].problems.single.reason, contains('monthly, yearly'));
    });

    test('values are typed: Money, cycle, UTC date', () {
      final ImportPlan p = _plan(text);
      final ImportCandidate prime =
          p.candidates.firstWhere((ImportCandidate c) => c.row == 4);
      expect(prime.text('name'), 'Amazon Prime');
      expect(prime.money('price'), const Money(149900, 'INR'));
      expect(prime.text('cycle'), 'yearly');
      expect(prime.date('next_renewal'), DateTime.utc(2027, 2, 1));
      final ImportCandidate quoted =
          p.candidates.firstWhere((ImportCandidate c) => c.row == 3);
      expect(quoted.text('name'), 'Netflix, Premium');
    });

    test('a caller override remaps a column and the old one goes unknown', () {
      final ColumnMapping m = mapping.withOverride(6, 'notes');
      expect(m.columnOf('notes'), 6);
      expect(m.unknownHeaders, isEmpty);
      final ColumnMapping unmapped = m.withOverride(5, null);
      expect(unmapped.columnOf('category'), isNull);
      expect(unmapped.unknownHeaders, <String>['Category']);
    });
  });

  group('semicolon_decimal_comma.csv — a European export', () {
    final String text = _fixture('semicolon_decimal_comma.csv');

    test('sniffs `;` although `,` appears in every price', () {
      final CsvTable t = const CsvReader().read(text);
      expect(t.delimiter, ';');
      expect(t.header, hasLength(6));
      expect(t.rows.every((List<String> r) => r.length == 6), isTrue);
      expect(t.rows[2][5], 'billed; yearly');
    });

    test('decimal-comma prices and dd.mm.yyyy dates read without a question',
        () {
      final ImportPlan p = _plan(text);
      _expectAccountedFor(p);
      expect(p.questions, isEmpty);
      expect(p.errors, isEmpty);
      expect(
        p.candidates.map((ImportCandidate c) => c.money('price')),
        <Money>[
          const Money(1299, 'EUR'),
          const Money(1099, 'EUR'),
          const Money(107148, 'EUR'),
          const Money(899, 'EUR'),
        ],
      );
      expect(
        p.candidates.map((ImportCandidate c) => c.text('cycle')),
        <String>['monthly', 'monthly', 'yearly', 'monthly'],
      );
      // 15.10.2026 has a 15 in the first place, so the file is day-first.
      expect(p.candidates[1].date('next_renewal'), DateTime.utc(2026, 10, 3));
      expect(p.candidates[0].text('notes'), 'Standard plan');
    });
  });

  group('bom_crlf_quoted_newline.csv — BOM, CRLF, a newline inside quotes', () {
    // .gitattributes has `* text=auto eol=lf` and no rule marks .csv binary, so
    // a CRLF fixture would be normalised to LF on commit and the test would
    // silently stop testing CRLF. The fixture is therefore committed with its
    // BOM and LF endings, and the CRLF variant is BUILT here from its content.
    //
    // ⚠️ `utf8.decode` DROPS a leading BOM, so decoding the file whole would
    // hand the reader BOM-free text and the BOM case would never run. The BOM
    // is asserted on the BYTES and put back into the string by hand.
    final List<int> bytes = _fixtureBytes('bom_crlf_quoted_newline.csv');
    final String lf = '\uFEFF${utf8.decode(bytes.sublist(3))}';
    final String crlf = lf.replaceAll('\n', '\r\n');

    test('the input really is BOM + CRLF', () {
      expect(bytes.take(3), <int>[0xEF, 0xBB, 0xBF]);
      expect(crlf.codeUnitAt(0), 0xFEFF);
      expect(RegExp(r'(?<!\r)\n').hasMatch(crlf), isFalse);
      expect('\r\n'.allMatches(crlf).length, 5);
    });

    for (final (String label, String text) in <(String, String)>[
      ('CRLF', crlf),
      ('LF', lf),
      ('lone CR', lf.replaceAll('\n', '\r')),
    ]) {
      test('$label: BOM stripped, quoted newline kept in its one cell', () {
        final CsvTable t = const CsvReader().read(text);
        expect(t.header.first, 'name');
        expect(t.header, hasLength(6));
        expect(t.rows, hasLength(3));
        expect(
          t.rows[0][5].split(RegExp('\r\n|\r|\n')),
          <String>['Family plan', 'shared with Asha'],
        );
        expect(t.rows[1][0], 'Netflix, "Premium"');
        expect(t.rows[2][5], '');
        final ImportPlan p = ImportPlan.build(
          t,
          ColumnMapping.infer(t.header, TestFields.all),
          fields: TestFields.all,
          keyOf: testKey,
        );
        _expectAccountedFor(p);
        expect(p.candidates, hasLength(3));
      });
    }
  });

  group('ambiguous_dates.csv — the engine does not guess', () {
    final String text = _fixture('ambiguous_dates.csv');

    test('every day and month ≤ 12: a DateOrderQuestion, no dated candidate',
        () {
      final ImportPlan p = _plan(text);
      _expectAccountedFor(p);
      final DateOrderQuestion q = p.questions.single as DateOrderQuestion;
      expect(q.fieldId, 'next_renewal');
      expect(q.options, <DateOrder>[DateOrder.dayFirst, DateOrder.monthFirst]);
      expect(q.samples, contains('03/04/2026'));
      expect(p.isResolved, isFalse);
      expect(p.awaiting, <int>[1, 2, 3]);
      // The undated row is not held hostage by a question about dates.
      expect(p.candidates.single.text('name'), 'Notion');
      expect(
        p.candidates.where((ImportCandidate c) => c.date('next_renewal') != null),
        isEmpty,
      );
    });

    test('answered day-first: 03/04/2026 is 3 April', () {
      final ImportPlan p = _plan(text, dateOrder: DateOrder.dayFirst);
      _expectAccountedFor(p);
      expect(p.questions, isEmpty);
      expect(p.isResolved, isTrue);
      expect(p.candidates, hasLength(4));
      expect(p.candidates[0].date('next_renewal'), DateTime.utc(2026, 4, 3));
      expect(p.candidates[2].date('next_renewal'), DateTime.utc(2026, 11, 12));
    });

    test('answered month-first: 03/04/2026 is March 4', () {
      final ImportPlan p = _plan(text, dateOrder: DateOrder.monthFirst);
      expect(p.candidates[0].date('next_renewal'), DateTime.utc(2026, 3, 4));
      expect(p.candidates[2].date('next_renewal'), DateTime.utc(2026, 12, 11));
    });

    test('one value with a part > 12 decides the order; no question asked',
        () {
      final String decided = '${text.trimRight()}\nHulu,9,USD,monthly,13/05/2026\n';
      final ImportPlan p = _plan(decided);
      expect(p.questions, isEmpty);
      expect(p.candidates[0].date('next_renewal'), DateTime.utc(2026, 4, 3));
      final String us = '${text.trimRight()}\nHulu,9,USD,monthly,05/13/2026\n';
      expect(
        _plan(us).candidates[0].date('next_renewal'),
        DateTime.utc(2026, 3, 4),
      );
    });

    test('an impossible date under the chosen order is a row error', () {
      final ImportPlan p = _plan(
        'name,price,currency,cycle,next_renewal\n'
        'A,1,USD,monthly,31/02/2026\n'
        'B,1,USD,monthly,15/01/2026\n',
      );
      _expectAccountedFor(p);
      expect(p.errors.single.row, 1);
      expect(p.errors.single.problems.single.fieldId, 'next_renewal');
    });
  });

  group('ColumnMapping', () {
    test('synonyms are case-, space- and punctuation-insensitive', () {
      final ColumnMapping m = ColumnMapping.infer(
        <String>['SERVICE', 'price (major)', 'Currency-Code', 'Renewal_Date'],
        TestFields.all,
      );
      expect(m.columnOf('name'), 0);
      expect(m.columnOf('price'), 1);
      expect(m.columnOf('currency'), 2);
      expect(m.columnOf('next_renewal'), 3);
      expect(m.unknownColumns, isEmpty);
    });

    test('the leftmost of two matching columns wins; the other is kept', () {
      final ColumnMapping m = ColumnMapping.infer(
        <String>['Amount', 'Cost', 'Name'],
        TestFields.all,
      );
      expect(m.columnOf('price'), 0);
      expect(m.unknownHeaders, <String>['Cost']);
    });

    test('overrides passed to infer have the last word', () {
      final ColumnMapping m = ColumnMapping.infer(
        <String>['Name', 'Amount', 'Owner'],
        TestFields.all,
        overrides: <int, String?>{1: null, 2: 'notes'},
      );
      expect(m.columnOf('price'), isNull);
      expect(m.columnOf('notes'), 2);
      expect(m.unknownHeaders, <String>['Amount']);
    });

    test('a required field with no column errors every row, never drops it',
        () {
      final ImportPlan p = _plan('Name,Owner\nNetflix,Asha\nSpotify,Ravi\n');
      _expectAccountedFor(p);
      expect(p.errors, hasLength(2));
      expect(
        p.errors.first.problems.map((ImportProblem x) => x.fieldId),
        contains('price'),
      );
    });
  });

  group('CsvReader edge cases', () {
    test('a TAB file is sniffed', () {
      final CsvTable t = const CsvReader().read('name\tprice\nNetflix\t649\n');
      expect(t.delimiter, '\t');
      expect(t.rows.single, <String>['Netflix', '649']);
    });

    test('blank lines and ,,,, padding are counted, not silently lost', () {
      final CsvTable t =
          const CsvReader().read('name,price\nNetflix,649\n\n,\n,\n');
      expect(t.rows, hasLength(1));
      expect(t.skippedBlankRecords, 3);
    });

    test('a caller-named delimiter is used as-is', () {
      final CsvTable t =
          const CsvReader().read('a;b,c\n1;2,3\n', delimiter: ',');
      expect(t.header, <String>['a;b', 'c']);
    });

    test('a row wider than the header with data in the extra cell is an error',
        () {
      final ImportPlan p = _plan(
        'name,price,currency\nNetflix,649,INR,surprise\nSpotify,119,INR,\n',
      );
      _expectAccountedFor(p);
      expect(p.errors.single.row, 1);
      expect(p.candidates.single.text('name'), 'Spotify');
    });

    test('a row with no currency uses the default, or errors without one', () {
      const String text = 'name,price\nNetflix,649\n';
      expect(
        _plan(text, defaultCurrency: 'INR').candidates.single.money('price'),
        const Money(64900, 'INR'),
      );
      expect(_plan(text).errors.single.problems.single.fieldId, 'price');
    });
  });
}
