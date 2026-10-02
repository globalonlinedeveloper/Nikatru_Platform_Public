// ST-P5 (round-2 F36) — the report renderer writes a PDF a reader can open.
//
// Red control: before this file's subject existed, `package:nikatru_core` had
// no `PdfReport`, so this suite did not compile.
import 'dart:convert' show latin1;
import 'dart:typed_data' show Uint8List;

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

String _text(Uint8List bytes) => latin1.decode(bytes);

PdfReport _report({int rows = 3}) => PdfReport(
  title: 'Subscription report',
  subtitle: 'September 2026',
  sections: <ReportSection>[
    const ReportSection(
      heading: 'Totals',
      lines: <String>['Charged in September: INR 1,849.00'],
    ),
    ReportSection(
      heading: 'Plans',
      columns: const <String>['Name', 'Charge'],
      rows: <List<String>>[
        for (int i = 0; i < rows; i++) <String>['Plan $i', 'INR 100.00'],
      ],
    ),
  ],
);

void main() {
  test('a report is a PDF: header, trailer and a page per page', () {
    final String pdf = _text(_report().render());
    expect(pdf, startsWith('%PDF-1.4\n'));
    expect(pdf, endsWith('%%EOF\n'));
    expect(pdf, contains('/Type /Catalog'));
    expect(pdf, contains('/Count 1'));
  });

  test('the totals and every row are drawn as text', () {
    final String pdf = _text(_report().render());
    expect(pdf, contains('(Charged in September: INR 1,849.00) Tj'));
    expect(pdf, contains('(Plan 0) Tj'));
    expect(pdf, contains('(Plan 2) Tj'));
    expect(pdf, contains('(Totals) Tj'));
  });

  test('every xref offset points at its own object', () {
    final Uint8List bytes = _report(rows: 120).render();
    final String pdf = _text(bytes);
    final int xref = int.parse(
      RegExp(r'startxref\n(\d+)\n').firstMatch(pdf)!.group(1)!,
    );
    expect(pdf.substring(xref), startsWith('xref\n'));
    final List<String> entries = pdf
        .substring(xref)
        .split('\n')
        .where((String l) => l.endsWith(' 00000 n '))
        .toList();
    expect(entries, isNotEmpty);
    for (int i = 0; i < entries.length; i++) {
      final int at = int.parse(entries[i].substring(0, 10));
      expect(
        pdf.substring(at),
        startsWith('${i + 1} 0 obj\n'),
        reason: 'obj ${i + 1}',
      );
    }
  });

  test('a long table flows onto more pages', () {
    final String pdf = _text(_report(rows: 120).render());
    final int pages = int.parse(
      RegExp(r'/Count (\d+)').firstMatch(pdf)!.group(1)!,
    );
    expect(pages, greaterThan(1));
    expect(pdf, contains('(Plan 119) Tj'));
  });

  test('each stream /Length is the stream it announces', () {
    final String pdf = _text(_report(rows: 60).render());
    for (final RegExpMatch m in RegExp(
      r'<< /Length (\d+) >>\nstream\n',
    ).allMatches(pdf)) {
      final int len = int.parse(m.group(1)!);
      expect(pdf.substring(m.end + len), startsWith('\nendstream'));
    }
  });

  test('parentheses and backslashes are escaped; no glyph is a ?', () {
    expect(PdfReportRenderer.escapeText(r'a (b) \c'), r'a \(b\) \\c');
    expect(PdfReportRenderer.escapeText('₹100'), '?100');
    expect(PdfReportRenderer.escapeText('café'), 'café');
  });

  test('the same report renders the same bytes', () {
    expect(_report().render(), _report().render());
  });
}
