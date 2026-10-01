/// The seam an import screen asks for a file — the mirror of `FileExporter`.
///
/// Core stays free of platform code: the real picker is
/// `package:nikatru_platform_storage`'s, and a test passes a fake that hands
/// back the file a user would have chosen.
library;

import '../portability/import_input.dart';

abstract interface class FileImporter {
  /// False on a target this build cannot open a file picker on. The screen
  /// hides its "Choose a file" action there instead of offering a dead button;
  /// paste still works everywhere.
  bool get canPick;

  /// Asks the user for one file with one of [extensions] (no dots). Null when
  /// the picker was dismissed, the file could not be read, or it was over
  /// [ImportedFile.maxBytes]. Never throws.
  Future<ImportedFile?> pick({required List<String> extensions});
}
