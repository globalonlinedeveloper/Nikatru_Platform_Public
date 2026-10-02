/// A report as a PDF — ST-P5 (round-2 F36), the renderer every app's "export
/// a report" row draws with.
///
/// Pure Dart, like every other file in `core`, and with NO dependency: the
/// PDF written here is the small, fixed subset a text-and-table report needs
/// (PDF 1.4, A4 portrait, the standard Helvetica face, one content stream per
/// page), so a PDF library would bring a licence row and a transitive tree for
/// four object kinds. The bytes are handed to the platform through the
/// [FileExporter] seam, exactly as the CSV export is.
///
/// 🔴 THE OUTPUT IS BYTE-FOR-BYTE DETERMINISTIC, ON PURPOSE. No creation date,
/// no producer version, no random document id: the same [PdfReport] renders
/// the same bytes on every target, so a test can pin what a user receives and
/// a golden cannot flake on the clock.
///
/// ⚠️ THE STANDARD FONTS COVER LATIN-1 AND NOTHING ELSE. Helvetica is one of
/// the fourteen faces every PDF reader carries, which is what lets this file
/// embed no font; the price is that a character outside printable Latin-1 has
/// no glyph and is written as `?` ([pdfEncodable] says which). So a caller
/// writes money as its ISO code (`INR 1,200.00`), never a symbol the font
/// lacks. A Unicode report (the Tamil locale) needs an embedded TrueType face,
/// which is a font asset and a licence row — a follow-up, not a silent `?`.
library;

import 'dart:convert' show latin1;
import 'dart:typed_data' show BytesBuilder, Uint8List;

/// One block of a report: a heading and either lines of text or a table.
class ReportSection {
  const ReportSection({
    required this.heading,
    this.lines = const <String>[],
    this.columns = const <String>[],
    this.rows = const <List<String>>[],
  });

  /// Printed in bold above the block.
  final String heading;

  /// Plain lines, printed before the table.
  final List<String> lines;

  /// The table's header cells. Empty = no table.
  final List<String> columns;

  /// The table's rows; a row shorter than [columns] leaves the rest blank.
  final List<List<String>> rows;
}

/// A whole report: a title, a subtitle under it, and its sections in order.
class PdfReport {
  const PdfReport({
    required this.title,
    this.subtitle = '',
    required this.sections,
  });

  final String title;
  final String subtitle;
  final List<ReportSection> sections;

  /// The report as the bytes of a PDF file.
  Uint8List render() => PdfReportRenderer.render(this);
}

/// Whether [char] (one UTF-16 code unit) has a glyph in the standard fonts.
bool pdfEncodable(int char) =>
    (char >= 0x20 && char <= 0x7E) || (char >= 0xA0 && char <= 0xFF);

/// Lays a [PdfReport] out on A4 pages and writes the file.
class PdfReportRenderer {
  PdfReportRenderer._();

  /// A4 in PDF points (1/72 inch).
  static const double pageWidth = 595;
  static const double pageHeight = 842;

  /// The printable box: 50 pt in from every edge.
  static const double margin = 50;

  static const double _titleSize = 18;
  static const double _headingSize = 13;
  static const double _bodySize = 10;
  static const double _leading = 14;

  /// The space kept clear at the right of every table cell.
  static const double cellGutter = 4;

  static Uint8List render(PdfReport report) {
    final List<_Page> pages = _layout(report);
    return _write(pages);
  }

  // ── layout ─────────────────────────────────────────────────────────────────

  static List<_Page> _layout(PdfReport report) {
    final List<_Page> pages = <_Page>[_Page()];
    double y = pageHeight - margin;

    void need(double height) {
      if (y - height < margin) {
        pages.add(_Page());
        y = pageHeight - margin;
      }
    }

    void text(
      String s,
      double x,
      double size, {
      bool bold = false,
      double? clip,
    }) => pages.last.runs.add(_Run(s, x, y, size, bold, clip));

    need(_titleSize);
    y -= _titleSize;
    text(report.title, margin, _titleSize, bold: true);
    if (report.subtitle.isNotEmpty) {
      need(_leading);
      y -= _leading;
      text(report.subtitle, margin, _bodySize);
    }

    const double usable = pageWidth - 2 * margin;
    for (final ReportSection s in report.sections) {
      y -= _leading;
      need(_headingSize + _leading);
      y -= _headingSize + 4;
      text(s.heading, margin, _headingSize, bold: true);
      for (final String line in s.lines) {
        need(_leading);
        y -= _leading;
        text(line, margin, _bodySize);
      }
      if (s.columns.isEmpty) continue;
      final double colWidth = usable / s.columns.length;
      void row(List<String> cells, {bool bold = false}) {
        need(_leading);
        y -= _leading;
        for (int i = 0; i < s.columns.length; i++) {
          final String cell = i < cells.length ? cells[i] : '';
          // Clipped to its column less a gutter: a long plan name is cut at
          // the column's edge instead of running into the next cell.
          text(
            cell,
            margin + i * colWidth,
            _bodySize,
            bold: bold,
            clip: colWidth - cellGutter,
          );
        }
      }

      if (s.lines.isNotEmpty) y -= 4;
      row(s.columns, bold: true);
      for (final List<String> r in s.rows) {
        row(r);
      }
    }
    return pages;
  }

  // ── the file ───────────────────────────────────────────────────────────────

  /// Objects: 1 catalog, 2 page tree, 3 Helvetica, 4 Helvetica-Bold, then a
  /// (page, content) pair per page.
  static Uint8List _write(List<_Page> pages) {
    final _Bytes out = _Bytes();
    final List<int> offsets = <int>[];
    void obj(int n, String body) {
      offsets.add(out.length);
      out.addAscii('$n 0 obj\n$body\nendobj\n');
    }

    out.addAscii('%PDF-1.4\n');
    // A binary comment, so a transfer that assumes text does not mangle it.
    out.addBytes(<int>[0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]);

    final List<int> pageIds = <int>[
      for (int i = 0; i < pages.length; i++) 5 + i * 2,
    ];
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(
      2,
      '<< /Type /Pages /Kids [${pageIds.map((int id) => '$id 0 R').join(' ')}] '
      '/Count ${pages.length} >>',
    );
    obj(
      3,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica '
      '/Encoding /WinAnsiEncoding >>',
    );
    obj(
      4,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold '
      '/Encoding /WinAnsiEncoding >>',
    );
    for (int i = 0; i < pages.length; i++) {
      final int pageId = pageIds[i];
      obj(
        pageId,
        '<< /Type /Page /Parent 2 0 R '
        '/MediaBox [0 0 ${_num(pageWidth)} ${_num(pageHeight)}] '
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> '
        '/Contents ${pageId + 1} 0 R >>',
      );
      final List<int> stream = _content(pages[i]);
      offsets.add(out.length);
      out.addAscii(
        '${pageId + 1} 0 obj\n<< /Length ${stream.length} >>\nstream\n',
      );
      out.addBytes(stream);
      out.addAscii('\nendstream\nendobj\n');
    }

    final int xref = out.length;
    final int count = offsets.length + 1;
    out.addAscii('xref\n0 $count\n0000000000 65535 f \n');
    for (final int o in offsets) {
      out.addAscii('${o.toString().padLeft(10, '0')} 00000 n \n');
    }
    out.addAscii(
      'trailer\n<< /Size $count /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n',
    );
    return out.takeBytes();
  }

  static List<int> _content(_Page page) {
    final StringBuffer b = StringBuffer();
    for (final _Run r in page.runs) {
      final double? clip = r.clip;
      final String run =
          'BT /${r.bold ? 'F2' : 'F1'} ${_num(r.size)} Tf '
          '${_num(r.x)} ${_num(r.y)} Td (${escapeText(r.text)}) Tj ET';
      if (clip == null) {
        b.write('$run\n');
      } else {
        // A clipping rectangle [clip] wide around the run, from below the
        // descenders to above the cap height; `q`/`Q` scope it to this run.
        b.write(
          'q ${_num(r.x)} ${_num(r.y - r.size / 2)} ${_num(clip)} '
          '${_num(r.size * 2)} re W n $run Q\n',
        );
      }
    }
    return latin1.encode(b.toString());
  }

  /// [s] as a PDF literal string body: `\`, `(` and `)` escaped, and every
  /// character the standard fonts cannot draw written as `?`.
  static String escapeText(String s) {
    final StringBuffer b = StringBuffer();
    for (final int c in s.codeUnits) {
      if (c == 0x5C || c == 0x28 || c == 0x29) {
        b.writeCharCode(0x5C);
        b.writeCharCode(c);
      } else if (pdfEncodable(c)) {
        b.writeCharCode(c);
      } else {
        b.write('?');
      }
    }
    return b.toString();
  }

  static String _num(double v) =>
      v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);
}

class _Page {
  final List<_Run> runs = <_Run>[];
}

class _Run {
  const _Run(this.text, this.x, this.y, this.size, this.bold, this.clip);
  final String text;
  final double x;
  final double y;
  final double size;
  final bool bold;

  /// The width the run is clipped to, from [x]; null = not clipped.
  final double? clip;
}

/// [BytesBuilder] with the two appends this file makes.
class _Bytes {
  final BytesBuilder _b = BytesBuilder(copy: false);

  int get length => _b.length;

  void addAscii(String s) => _b.add(latin1.encode(s));

  void addBytes(List<int> bytes) => _b.add(bytes);

  Uint8List takeBytes() => _b.takeBytes();
}
