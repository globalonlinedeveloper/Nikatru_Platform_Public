import 'dart:convert';

import '../result.dart';
import 'backup_envelope.dart';
import 'csv_reader.dart';

/// What a piece of brought-in text is, so one import surface can take a file,
/// a drop, a share or a paste and hand it to the right engine.
enum ImportInputKind {
  /// A table: [CsvReader] reads a header and at least one row of the same
  /// width. Goes to the column-mapping step.
  csv,

  /// A [BackupEnvelope]. Goes to the restore preview, never to the mapping.
  backup,

  /// Anything else — a pasted e-mail or receipt. Goes to `ReceiptParser`.
  text,
}

/// One file the user brought in, already decoded to text.
///
/// The bytes are decoded ON THE DEVICE and nothing here sends them anywhere:
/// an import reads the user's own file into the user's own list.
class ImportedFile {
  const ImportedFile({required this.name, required this.text});

  /// Decodes [bytes] as UTF-8 (a BOM is left for the readers, which strip it).
  /// A malformed byte becomes U+FFFD rather than refusing the whole file.
  /// Null when the file is over [maxBytes]: a subscription list is kilobytes,
  /// so a file that size is not one, and reading it would stall the screen.
  static ImportedFile? fromBytes(String name, List<int> bytes) {
    if (bytes.length > maxBytes) return null;
    return ImportedFile(
      name: name,
      text: utf8.decode(bytes, allowMalformed: true),
    );
  }

  /// The largest file an import reads: 4 MiB.
  static const int maxBytes = 4 * 1024 * 1024;

  /// The file name as the platform gave it (no directory), or a label such as
  /// `pasted text` for a paste.
  final String name;

  final String text;

  /// What [text] is. See [classifyImportInput].
  ImportInputKind get kind => classifyImportInput(text, fileName: name);
}

/// The extensions an import accepts from a picker, a drop or a share.
const List<String> kImportFileExtensions = <String>['csv', 'json', 'txt'];

/// What [text] is. A `.json` name or a leading `{` is a backup only when it
/// DECODES as one; a table is CSV only when its header has two or more columns
/// and every row is as wide as the header — a receipt with a comma in one line
/// is not a table. Everything else is text for the receipt reader.
ImportInputKind classifyImportInput(String text, {String? fileName}) {
  final String body = text.startsWith('﻿') ? text.substring(1) : text;
  final String trimmed = body.trimLeft();
  if (trimmed.startsWith('{')) {
    if (BackupEnvelope.decode(body) is Ok<BackupEnvelope>) {
      return ImportInputKind.backup;
    }
  }
  final CsvTable t = const CsvReader().read(body);
  final bool table =
      t.header.length >= 2 &&
      t.rows.isNotEmpty &&
      t.rows.every((List<String> r) => r.length == t.header.length);
  final bool namedCsv = (fileName ?? '').toLowerCase().endsWith('.csv');
  if (table || (namedCsv && t.header.length >= 2)) return ImportInputKind.csv;
  return ImportInputKind.text;
}
