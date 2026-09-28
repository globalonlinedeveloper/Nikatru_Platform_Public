import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// ST-X1 — the export codecs. No dart:io here, so this file also runs in the
/// `dart test -p chrome` lane: the web build exports through the same code.
void main() {
  const CsvCodec codec = CsvCodec();

  group('CsvCodec.encode', () {
    test('opens with a BOM and ends EVERY record with CRLF, the last too', () {
      final String out = codec.encode(
        <String>['name', 'price'],
        <List<String>>[
          <String>['Netflix', '649.00'],
          <String>['Spotify', '119.00'],
        ],
      );
      expect(out.codeUnitAt(0), 0xFEFF);
      expect(out, '\uFEFFname,price\r\nNetflix,649.00\r\nSpotify,119.00\r\n');
      // No bare LF anywhere: every \n is preceded by \r.
      expect(RegExp(r'(?<!\r)\n').hasMatch(out), isFalse);
    });

    test('encodeBytes is the UTF-8 of encode, BOM bytes first', () {
      final List<int> bytes = codec.encodeBytes(
        <String>['name'],
        <List<String>>[
          <String>['₹ plan'],
        ],
      );
      expect(bytes.take(3), <int>[0xEF, 0xBB, 0xBF]);
      // Sliced off by hand: `utf8.decode` silently drops a leading BOM, so
      // decoding the whole list would pass whether or not one was written.
      expect(utf8.decode(bytes.sublist(3)), 'name\r\n₹ plan\r\n');
      expect(
        bytes,
        utf8.encode(codec.encode(<String>['name'], <List<String>>[
          <String>['₹ plan'],
        ])),
      );
      expect(CsvCodec.mimeType, 'text/csv');
    });

    test('quotes a field with a quote or comma, doubling inner quotes', () {
      final String out = codec.encode(
        <String>['name'],
        <List<String>>[
          <String>['Netflix, "Premium"'],
        ],
      );
      expect(out, '\uFEFFname\r\n"Netflix, ""Premium"""\r\n');
    });

    test('quotes a field holding CR or LF', () {
      final String out = codec.encode(
        <String>['notes'],
        <List<String>>[
          <String>['line one\nline two'],
        ],
      );
      expect(out, '\uFEFFnotes\r\n"line one\nline two"\r\n');
    });

    test('`Netflix, "Premium"` round-trips through CsvReader to ONE cell', () {
      final String out = codec.encode(
        <String>['name', 'price'],
        <List<String>>[
          <String>['Netflix, "Premium"', '649.00'],
        ],
      );
      final CsvTable t = const CsvReader().read(out);
      expect(t.delimiter, ',');
      expect(t.header, <String>['name', 'price']);
      expect(t.rows, <List<String>>[
        <String>['Netflix, "Premium"', '649.00'],
      ]);
    });

    test('a ragged row is refused, not shifted', () {
      expect(
        () => codec.encode(
          <String>['a', 'b'],
          <List<String>>[
            <String>['only one'],
          ],
        ),
        throwsArgumentError,
      );
    });

    test('the header is neutralised too', () {
      final String out =
          codec.encode(<String>['=HYPERLINK("x")'], const <List<String>>[]);
      expect(out, '\uFEFF"\'=HYPERLINK(""x"")"\r\n');
    });
  });

  group('CsvCodec.neutralise — CSV / formula injection', () {
    test('=cmd becomes \'=cmd', () {
      expect(CsvCodec.neutralise('=cmd'), "'=cmd");
    });

    test('+, -, @, TAB and CR leads are all neutralised', () {
      expect(CsvCodec.neutralise('+1+1'), "'+1+1");
      expect(CsvCodec.neutralise('-2+3'), "'-2+3");
      expect(CsvCodec.neutralise('@SUM(A1)'), "'@SUM(A1)");
      expect(CsvCodec.neutralise('\t=1'), "'\t=1");
      expect(CsvCodec.neutralise('\r=1'), "'\r=1");
    });

    test('everything else is returned unchanged', () {
      expect(CsvCodec.neutralise(''), '');
      expect(CsvCodec.neutralise('Netflix'), 'Netflix');
      expect(CsvCodec.neutralise('a=b'), 'a=b');
      expect(CsvCodec.neutralise("'=already"), "'=already");
    });

    test('encode applies it to every cell', () {
      final String out = codec.encode(
        <String>['name'],
        <List<String>>[
          <String>['=cmd|/C calc'],
        ],
      );
      expect(out, "\uFEFFname\r\n'=cmd|/C calc\r\n");
    });

    test('CsvReader undoes it only when asked', () {
      final String out = codec.encode(
        <String>['name'],
        <List<String>>[
          <String>['=cmd'],
        ],
      );
      expect(const CsvReader().read(out).rows.single.single, "'=cmd");
      expect(
        const CsvReader(restoreNeutralised: true).read(out).rows.single.single,
        '=cmd',
      );
    });
  });

  group('CsvCodec.moneyCells', () {
    test('INR: major units with two digits, and the code', () {
      expect(CsvCodec.moneyCells(const Money(64900, 'INR')),
          <String>['649.00', 'INR']);
      expect(CsvCodec.moneyCells(const Money(129950, 'INR')),
          <String>['1299.50', 'INR']);
    });

    test('JPY: no minor digits, no decimal point', () {
      expect(CsvCodec.moneyCells(const Money(1200, 'JPY')),
          <String>['1200', 'JPY']);
    });

    test('USD: cents padded, never a symbol or grouping', () {
      expect(CsvCodec.moneyCells(const Money(999, 'USD')),
          <String>['9.99', 'USD']);
      expect(CsvCodec.moneyCells(const Money(5, 'USD')),
          <String>['0.05', 'USD']);
      expect(CsvCodec.moneyCells(const Money(123456789, 'USD')),
          <String>['1234567.89', 'USD']);
      expect(CsvCodec.moneyCells(const Money(-250, 'USD')),
          <String>['-2.50', 'USD']);
    });

    test('the amount cell reads back through parseLocalized exactly', () {
      for (final Money m in <Money>[
        const Money(64900, 'INR'),
        const Money(1200, 'JPY'),
        const Money(999, 'USD'),
        const Money(500, 'KWD'),
      ]) {
        final List<String> cells = CsvCodec.moneyCells(m);
        expect(Money.parseLocalized(cells[0], cells[1]), m, reason: '$m');
      }
    });
  });

  group('BackupEnvelope', () {
    final BackupEnvelope envelope = BackupEnvelope(
      appId: 'subscriptiontracker',
      exportedAt: DateTime.utc(2026, 9, 28, 10, 30),
      records: <Map<String, Object?>>[
        <String, Object?>{
          'id': 'a1',
          'name': 'Netflix, "Premium" ₹',
          'price': <String, Object?>{'minor_units': 64900, 'currency': 'INR'},
        },
        <String, Object?>{'id': 'b2', 'name': 'Spotify', 'tags': <Object?>[]},
      ],
    );

    test('carries {format, version, appId, exportedAt, records}', () {
      final Map<String, Object?> j = envelope.toJson();
      expect(j.keys, <String>[
        'format',
        'version',
        'appId',
        'exportedAt',
        'records',
      ]);
      expect(j['format'], 'nikatru-backup');
      expect(j['version'], 1);
      expect(j['exportedAt'], '2026-09-28T10:30:00.000Z');
      expect(BackupEnvelope.mimeType, 'application/json');
    });

    test('exportedAt is written as UTC whatever zone it was built in', () {
      final DateTime local = DateTime.utc(2026, 9, 28, 10, 30).toLocal();
      final BackupEnvelope e = BackupEnvelope(
        appId: 'x',
        exportedAt: local,
        records: const <Map<String, Object?>>[],
      );
      expect(e.toJson()['exportedAt'], '2026-09-28T10:30:00.000Z');
    });

    test('encode → decode round-trips, non-ASCII included', () {
      final List<int> bytes = envelope.encodeBytes();
      final Result<BackupEnvelope> back =
          BackupEnvelope.decode(utf8.decode(bytes));
      final BackupEnvelope d = (back as Ok<BackupEnvelope>).value;
      expect(d.format, BackupEnvelope.formatId);
      expect(d.version, BackupEnvelope.currentVersion);
      expect(d.appId, 'subscriptiontracker');
      expect(d.exportedAt, DateTime.utc(2026, 9, 28, 10, 30));
      expect(d.exportedAt.isUtc, isTrue);
      expect(d.records, envelope.records);
      expect(d.encode(), envelope.encode());
    });

    test('a leading BOM is tolerated', () {
      expect(BackupEnvelope.decode('\uFEFF${envelope.encode()}').isOk, isTrue);
    });

    String? refusal(String text) => BackupEnvelope.decode(text).fold(
          (BackupEnvelope _) => null,
          (Failure f) => f.message,
        );

    Map<String, Object?> valid() =>
        jsonDecode(envelope.encode()) as Map<String, Object?>;

    test('malformed JSON is an Err, not a throw', () {
      expect(refusal('{"format": "nikatru-backup",'), contains('malformed'));
      expect(refusal('[]'), contains('not a JSON object'));
    });

    test('a wrong format is refused', () {
      expect(
        refusal(jsonEncode(valid()..['format'] = 'other-backup')),
        contains('"other-backup"'),
      );
    });

    test('each missing field is refused', () {
      for (final String field in <String>[
        'format',
        'version',
        'appId',
        'exportedAt',
        'records',
      ]) {
        expect(
          refusal(jsonEncode(valid()..remove(field))),
          isNotNull,
          reason: 'missing $field',
        );
      }
    });

    test('records that are not a list of objects are refused', () {
      expect(
        refusal(jsonEncode(valid()..['records'] = <String, Object?>{})),
        contains('not a list'),
      );
      expect(
        refusal(jsonEncode(valid()..['records'] = <Object?>[1, 'two'])),
        contains('record 0 is not a JSON object'),
      );
    });

    test('the control: the unmutated envelope decodes', () {
      expect(refusal(jsonEncode(valid())), isNull);
    });
  });
}
