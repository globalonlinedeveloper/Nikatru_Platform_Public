import 'package:file_selector_platform_interface/file_selector_platform_interface.dart'
    as fs;
import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;

/// Opens one file and returns its name and bytes, or null when dismissed.
/// `file_selector`'s open dialog, as a value, so a test can stand in for it.
typedef OpenFile =
    Future<({String name, List<int> bytes})?> Function(List<String> extensions);

/// The real [core.FileImporter]: the platform's open-file dialog.
///
/// 🔴 LINUX ONLY TODAY, AND [canPick] SAYS SO RATHER THAN THROWING. This
/// package links `file_selector_linux` (the XDG portal dialog the exporter
/// already saves through) and NO other `file_selector` implementation, so on
/// every other target `FileSelectorPlatform.instance` is the bare method
/// channel and `openFile` would throw `MissingPluginException`. Linking the
/// other five implementations is a dependency change with its own store
/// declarations; until it lands the import screen offers paste (and, where the
/// platform hands one over, a share or a drop) on those targets, never a dead
/// "Choose a file" button.
class SelectorFileImporter implements core.FileImporter {
  SelectorFileImporter({bool? canPick, OpenFile? open})
    : _canPick = canPick ?? (!kIsWeb && defaultTargetPlatform == TargetPlatform.linux),
      _open = open ?? _openDialog;

  final bool _canPick;
  final OpenFile _open;

  @override
  bool get canPick => _canPick;

  @override
  Future<core.ImportedFile?> pick({required List<String> extensions}) async {
    if (!_canPick) return null;
    try {
      final ({String name, List<int> bytes})? f = await _open(extensions);
      if (f == null) return null;
      return core.ImportedFile.fromBytes(f.name, f.bytes);
    } catch (_) {
      // A plugin that throws reads as "nothing was chosen", never as a crash
      // on the screen that offered the picker.
      return null;
    }
  }

  static Future<({String name, List<int> bytes})?> _openDialog(
    List<String> extensions,
  ) async {
    final fs.XFile? x = await fs.FileSelectorPlatform.instance.openFile(
      acceptedTypeGroups: <fs.XTypeGroup>[
        fs.XTypeGroup(label: 'import', extensions: extensions),
      ],
    );
    if (x == null) return null;
    return (name: x.name, bytes: await x.readAsBytes());
  }
}
