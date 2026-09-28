import 'dart:typed_data' show Uint8List;

import 'package:file_selector_platform_interface/file_selector_platform_interface.dart'
    as fs;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:share_plus/share_plus.dart';

import 'export_capabilities.dart';

/// Hands [params] to the platform share sheet. The plugin call, as a value, so
/// a test can prove the routing without a platform channel.
typedef ShareCall = Future<ShareResult> Function(ShareParams params);

/// Asks the user where to save [suggestedName], returning the chosen path or
/// null when the dialog was cancelled. `file_selector_linux`'s save dialog, as
/// a value.
typedef SaveLocation = Future<String?> Function(String suggestedName);

/// Writes [file] to [path]. `XFile.saveTo`, as a value.
typedef SaveBytes = Future<void> Function(XFile file, String path);

/// The real [core.FileExporter] — ST-X1 (audit D2, D31).
///
/// 🔴 IT LIVES HERE, NOT IN A PACKAGE OF ITS OWN: [pipeline C-4] adjudicated
/// `share_plus` into this existing adapter (`tooling/capability-register.json`),
/// the same ruling that put `in_app_review` here.
///
/// EVERY CALL IS ROUTED BY THE MATRIX FIRST. `share_plus` throws on linux for
/// any file, so linux asks for a save location instead, and fuchsia is refused
/// before a plugin is touched. See [ExportCapabilities].
class ShareFileExporter implements core.FileExporter {
  ShareFileExporter({
    ExportCapabilities? capabilities,
    ShareCall? share,
    SaveLocation? saveLocation,
    SaveBytes? saveBytes,
  })  : _caps = capabilities ??
            ExportCapabilities.forPlatform(defaultTargetPlatform, isWeb: kIsWeb),
        _share = share ?? SharePlus.instance.share,
        _saveLocation = saveLocation ?? _saveDialog,
        _saveBytes = saveBytes ?? _saveTo;

  final ExportCapabilities _caps;
  final ShareCall _share;
  final SaveLocation _saveLocation;
  final SaveBytes _saveBytes;

  /// What this platform can do, so a caller can explain itself.
  ExportCapabilities get capabilities => _caps;

  @override
  Future<core.ExportOutcome> export(core.ExportFile file) async {
    if (!_caps.canExportFile) return core.ExportOutcome.failed;
    final XFile x = XFile.fromData(
      Uint8List.fromList(file.bytes),
      mimeType: file.mimeType,
      name: file.fileName,
    );
    try {
      switch (_caps.route) {
        case ExportRoute.saveDialog:
          final String? path = await _saveLocation(file.fileName);
          // Cancelled: the user closed the dialog, which is not a failure.
          if (path == null || path.isEmpty) return core.ExportOutcome.dismissed;
          await _saveBytes(x, path);
          return core.ExportOutcome.exported;
        case ExportRoute.shareSheet || ExportRoute.browser:
          final ShareResult r = await _share(ShareParams(
            files: <XFile>[x],
            fileNameOverrides: <String>[file.fileName],
            // The web half of the route: a browser that cannot share a file
            // downloads it instead, so the user still ends up holding it.
            downloadFallbackEnabled: true,
          ));
          return switch (r.status) {
            ShareResultStatus.dismissed => core.ExportOutcome.dismissed,
            // `unavailable` is "this platform does not REPORT a result" (the
            // web download, windows, older android), not "nothing happened":
            // the sheet or the download ran, so the file was handed over.
            ShareResultStatus.success ||
            ShareResultStatus.unavailable =>
              core.ExportOutcome.exported,
          };
        case ExportRoute.none:
          return core.ExportOutcome.failed;
      }
    } catch (_) {
      // A plugin that throws must read as "could not export", never as a crash
      // on the screen that offered the export.
      return core.ExportOutcome.failed;
    }
  }

  static Future<String?> _saveDialog(String suggestedName) async =>
      (await fs.FileSelectorPlatform.instance.getSaveLocation(
        options: fs.SaveDialogOptions(suggestedName: suggestedName),
      ))
          ?.path;

  static Future<void> _saveTo(XFile file, String path) => file.saveTo(path);
}
