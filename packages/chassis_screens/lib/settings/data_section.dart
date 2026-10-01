// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS' "YOUR DATA" CARD — IM-01 / IM-03 / IM-08 (train ST import hub).
//
// 🏗️ CHASSIS, NOT APP. Every app this factory stamps holds the user's own rows
// and owes them the same four doors: export them, bring rows in, back the
// whole list up, and restore that backup. The ORDER and the keys of those
// rows are decided once here; an app adopts it with its own strings, its own
// card, its own row widget and its own taps. The shipping app's settings
// screen is a capped private fork (assert-chassis-parity), so the rows cannot
// grow there.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';

import 'help_section.dart' show HelpRowBuilder;

/// The Your data rows' keys, so a test finds a ROW and not a string.
abstract final class DataKeys {
  static const Key export = Key('settings.data.export');
  static const Key import = Key('settings.data.import');
  static const Key backup = Key('settings.data.backup');
  static const Key restore = Key('settings.data.restore');
}

/// Settings' Your data card in [decoration], top to bottom: whatever the app
/// puts in [leading] (rows that are not about data portability but share the
/// card), then Export, Import, Back up, Restore — each drawn by [row].
///
/// * **Export** and **Back up** take a nullable tap: an app whose list has
///   not loaded passes `null` and the row says it is not available, rather
///   than writing a file that reads like an empty account.
/// * **Import** and **Restore** both open the app's import surface: it tells
///   a backup from a CSV by the file's envelope, so there is one way in.
Widget dataCard(
  BuildContext context, {
  required Decoration decoration,
  required HelpRowBuilder row,
  List<Widget> leading = const <Widget>[],
  required String exportLabel,
  required VoidCallback? onExport,
  required String importLabel,
  required VoidCallback onImport,
  required String backupLabel,
  required VoidCallback? onBackup,
  required String restoreLabel,
  required VoidCallback onRestore,
}) {
  final List<(Key, String, String, VoidCallback?)> rows =
      <(Key, String, String, VoidCallback?)>[
        (DataKeys.export, '⇩', exportLabel, onExport),
        (DataKeys.import, '⇪', importLabel, onImport),
        (DataKeys.backup, '⎘', backupLabel, onBackup),
        (DataKeys.restore, '↺', restoreLabel, onRestore),
      ];
  return Container(
    decoration: decoration,
    clipBehavior: Clip.antiAlias,
    child: Column(
      children: <Widget>[
        ...leading,
        for (final (int i, (Key, String, String, VoidCallback?) r)
            in rows.indexed)
          row(
            key: r.$1,
            icon: r.$2,
            label: r.$3,
            last: i == rows.length - 1,
            onTap: r.$4,
          ),
      ],
    ),
  );
}
