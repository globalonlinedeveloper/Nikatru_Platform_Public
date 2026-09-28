import 'package:flutter/foundation.dart' show TargetPlatform, immutable;

/// How a platform hands an exported file to the user.
enum ExportRoute {
  /// The OS share sheet: the user picks Files, Drive, Mail or a folder.
  shareSheet,

  /// The browser: the Web Share API where the browser can share a file, and a
  /// plain download everywhere else.
  browser,

  /// A save dialog: the user picks the folder and the name. On linux it is
  /// GtkFileChooserNative, which the XDG desktop portal serves under a snap's
  /// strict confinement.
  saveDialog,

  /// No route at all. Nothing can be exported here.
  none,
}

/// What a platform can do about exporting a file — ST-X1 (audit D2, D31).
///
/// The same shape as `StorageCapabilities`: the platform is a PARAMETER, so
/// all seven rows are reachable from a test rather than only the host's.
///
/// Pinned to **`share_plus` 13.3.0** and **`file_selector_linux` 0.9.4+1**
/// (both BSD-3-Clause, checked against pub.dev 2026-09-28). Re-review this
/// matrix on any version bump: it is a statement about the PLUGINS, not the OS.
///
/// 🔴 THE ROW THAT MATTERS IS LINUX. `share_plus` on linux shares TEXT only —
/// its linux implementation throws `UnimplementedError('Sharing files not
/// supported on Linux')` for any file. So linux gets its own route, a save
/// dialog, and a caller told which one it got. NOT a file written into
/// `~/Downloads`: the linux channel is a strictly confined snap, whose `$HOME`
/// is its own `~/snap/<name>/<rev>/`, so a folder path would put the file where
/// the user never looks, or nowhere. The native chooser goes through the XDG
/// desktop portal, which is how a confined app is handed a path it may write.
///
/// ⚠️ WEB IS THE OTHER HONEST ROW. `navigator.share` with files exists in some
/// browsers and not others (desktop Firefox has none). `share_plus` falls back
/// to a download when the browser cannot share, so the user always ends up
/// holding the file, and the route is named [ExportRoute.browser] rather than
/// pretending there is a share sheet.
@immutable
class ExportCapabilities {
  const ExportCapabilities({
    required this.canExportFile,
    required this.route,
    required this.note,
  });

  /// Whether a file can be exported at all on this platform.
  final bool canExportFile;

  /// How the file reaches the user.
  final ExportRoute route;

  /// Why this platform differs, in one line. Empty when it does not.
  final String note;

  /// The capabilities for [platform], with [isWeb] taking precedence.
  static ExportCapabilities forPlatform(
    TargetPlatform platform, {
    required bool isWeb,
  }) {
    if (isWeb) {
      return const ExportCapabilities(
        canExportFile: true,
        route: ExportRoute.browser,
        note: 'Web: the Web Share API where the browser can share a file, and '
            'a download where it cannot (share_plus downloadFallbackEnabled). '
            'Either way the user ends up holding the file.',
      );
    }
    return switch (platform) {
      TargetPlatform.android => const ExportCapabilities(
          canExportFile: true,
          route: ExportRoute.shareSheet,
          note: 'Android: the system share sheet (Files, Drive, Mail).',
        ),
      TargetPlatform.iOS => const ExportCapabilities(
          canExportFile: true,
          route: ExportRoute.shareSheet,
          note: 'iOS: the share sheet, which offers Save to Files.',
        ),
      TargetPlatform.macOS => const ExportCapabilities(
          canExportFile: true,
          route: ExportRoute.shareSheet,
          note: 'macOS: the NSSharingServicePicker share menu.',
        ),
      TargetPlatform.windows => const ExportCapabilities(
          canExportFile: true,
          route: ExportRoute.shareSheet,
          note: 'Windows: the Windows share UI (DataTransferManager).',
        ),
      TargetPlatform.linux => const ExportCapabilities(
          canExportFile: true,
          route: ExportRoute.saveDialog,
          note: 'Linux: share_plus shares text only, so the user saves the file '
              'through a save dialog (file_selector_linux, GtkFileChooserNative: '
              'the XDG desktop portal under the snap\'s strict confinement, '
              'whose own \$HOME is not the user\'s Downloads folder).',
        ),
      TargetPlatform.fuchsia => const ExportCapabilities(
          canExportFile: false,
          route: ExportRoute.none,
          note: 'Fuchsia is not a target platform for this portfolio.',
        ),
    };
  }

  @override
  String toString() =>
      'ExportCapabilities(canExportFile: $canExportFile, route: $route)';
}
