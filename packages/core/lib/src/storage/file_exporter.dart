/// The file-export seam — ST-X1 (audit D2, D31).
///
/// Pure Dart, like every other seam in `core`. The concrete implementation
/// wraps `share_plus` (and, on linux, `file_selector_linux`) and lives in
/// `packages/platform_storage`, beside `ExportCapabilities`, the seven-row
/// matrix that says what "export" means on each target. The codecs that make
/// the bytes are `CsvCodec` and `BackupEnvelope` in `src/portability/`.
///
/// 🔴 WHY A SEAM AND NOT A PLUGIN CALL IN THE SCREEN. The export row in the
/// settings screen was inert for as long as the Play data-safety form said a
/// user could export their data: `onTap` was null and no test anywhere
/// referenced the row. A screen that calls this interface can be pumped with a
/// fake that keeps the bytes, so a test can parse what the user would receive.
library;

/// What came of asking for a file to be exported.
///
/// Three outcomes, because a caller is owed the difference between "the user
/// closed the sheet" and "this platform could not".
enum ExportOutcome {
  /// The bytes were handed to the platform: a share sheet accepted them, a
  /// browser download started, or the file was written where a save dialog
  /// said.
  exported,

  /// The user dismissed the share sheet or cancelled the save dialog. Nothing
  /// is wrong, and nothing was saved.
  dismissed,

  /// The platform could not export the file: no share route on this target, a
  /// plugin failure, or a write that failed. Nothing was saved.
  failed,
}

/// One file to export: its bytes, its suggested file name and its media type.
class ExportFile {
  const ExportFile({
    required this.bytes,
    required this.fileName,
    required this.mimeType,
  });

  /// The whole file. A CSV from `CsvCodec.encodeBytes` already carries its
  /// UTF-8 byte-order mark.
  final List<int> bytes;

  /// The name offered to the user, with its extension (`subscriptions.csv`).
  final String fileName;

  /// The media type (`text/csv`, `application/json`).
  final String mimeType;
}

/// Hands a file to the platform so the user ends up holding it: a share sheet
/// on a phone, a download in a browser, a real file on a desktop.
abstract interface class FileExporter {
  /// Exports [file], or says why it did not. Never throws: an export that
  /// fails must never crash the screen that offered it.
  Future<ExportOutcome> export(ExportFile file);
}
