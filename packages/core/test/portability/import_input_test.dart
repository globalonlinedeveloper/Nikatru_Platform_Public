import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

import 'test_fields.dart';

// Pure and inline — no fixture file — so the chrome lane runs every case too.

void main() {
  group('classifyImportInput — one surface, three engines', () {
    test('a header and rows of its width is CSV', () {
      expect(
        classifyImportInput('name,price,currency\nNetflix,649,INR\n'),
        ImportInputKind.csv,
      );
    });

    test('a backup envelope is a backup, never a table', () {
      final String json = BackupEnvelope(
        appId: 'app',
        exportedAt: DateTime.utc(2026, 10, 1),
        records: const <Map<String, Object?>>[
          <String, Object?>{'id': '1'},
        ],
      ).encode();
      expect(classifyImportInput(json), ImportInputKind.backup);
      expect(
        classifyImportInput(json, fileName: 'x.json'),
        ImportInputKind.backup,
      );
    });

    test('a receipt with a comma on one line is text, not a table', () {
      const String receipt =
          'Payment Receipt\nNetflix\nDate: 12 Sep 2026\n'
          'Total, incl. GST ₹649.00\nPaid via UPI\n';
      expect(classifyImportInput(receipt), ImportInputKind.text);
    });

    test('JSON that is not a backup is not a backup', () {
      expect(classifyImportInput('{"a": 1}'), ImportInputKind.text);
    });

    test('a .csv name with a header and no rows is still CSV', () {
      expect(
        classifyImportInput('name,price\n', fileName: 'export.CSV'),
        ImportInputKind.csv,
      );
    });
  });

  group('ImportedFile.fromBytes', () {
    test('decodes UTF-8 on the device and keeps the name', () {
      final ImportedFile? f = ImportedFile.fromBytes('a.csv', <int>[
        0x6e, 0x61, 0x6d, 0x65, 0x2c, 0x70, 0x0a, // "name,p\n"
        0xe2, 0x82, 0xb9, 0x2c, 0x31, //              "₹,1"
      ]);
      expect(f, isNotNull);
      expect(f!.name, 'a.csv');
      expect(f.text, 'name,p\n₹,1');
      expect(f.kind, ImportInputKind.csv);
    });

    test('a file over the cap is refused, not read', () {
      expect(
        ImportedFile.fromBytes(
          'big.csv',
          List<int>.filled(ImportedFile.maxBytes + 1, 0x41),
        ),
        isNull,
      );
    });
  });

  group('ColumnPreset — recognised by header, mapping only', () {
    const ColumnPreset other = ColumnPreset(
      name: 'Other tracker',
      fieldByHeader: <String, String>{
        'Service Name': 'name',
        'Amount Paid': 'price',
        'Currency Code': 'currency',
        'Billing Every': 'cycle',
        'Due On': 'next_renewal',
      },
    );
    const List<String> header = <String>[
      'Service Name',
      'Amount Paid',
      'Currency Code',
      'Billing Every',
      'Due On',
    ];

    test('THE RED CONTROL: a matching header maps every column', () {
      final ColumnPreset? p = ColumnPreset.recognise(header, <ColumnPreset>[
        other,
      ]);
      expect(p, same(other));
      final ColumnMapping m = p!.apply(header, TestFields.all);
      expect(m.unknownColumns, isEmpty, reason: '${m.unknownHeaders}');
      expect(m.columnOf('name'), 0);
      expect(m.columnOf('price'), 1);
      expect(m.columnOf('cycle'), 3);
      expect(m.columnOf('next_renewal'), 4);
    });

    test('without the preset the same header leaves columns unmapped', () {
      final ColumnMapping m = ColumnMapping.infer(header, TestFields.all);
      expect(m.unknownColumns, isNotEmpty);
    });

    test('a header missing one named column is not recognised', () {
      expect(
        ColumnPreset.recognise(header.sublist(0, 4), <ColumnPreset>[other]),
        isNull,
      );
    });

    test('case and punctuation do not matter; extra columns are kept', () {
      final List<String> h = <String>[
        'service-name',
        'AMOUNT PAID',
        'currency_code',
        'billing every',
        'due on',
        'Category',
      ];
      final ColumnMapping m = other.apply(h, TestFields.all);
      expect(m.columnOf('name'), 0);
      expect(m.columnOf('category'), 5, reason: 'inferred from synonyms');
    });

    test('the longer signature wins when two match', () {
      const ColumnPreset shorter = ColumnPreset(
        name: 'Shorter',
        fieldByHeader: <String, String>{'Service Name': 'name'},
      );
      expect(
        ColumnPreset.recognise(header, <ColumnPreset>[shorter, other]),
        same(other),
      );
    });
  });
}
