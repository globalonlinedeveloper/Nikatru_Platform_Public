// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS › SHARE — train T20, IN-12. The month, in the two shapes a person
// actually hands on: a picture of the summary tiles (a chat, a partner) and a
// CSV of the month's charges (a spreadsheet, an accountant).
//
// 🔴 NO NUMBER LEAVES THE DEVICE UNLESS THE USER SHARES IT. Both files are
// built here, from the list already on screen — the tiles are painted off
// their own layer, the CSV is encoded in memory — and handed to the ONE export
// seam (`exportFileTap` → `FileExporter`), which opens the platform's share
// sheet, download or save dialog. No network call is made to build either,
// and the seam is off with `features.exports`, as Settings' export is.
// ═══════════════════════════════════════════════════════════════════════════

import 'dart:typed_data' show ByteData;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show RenderRepaintBoundary;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show showAdaptiveSheet;

import '../../data/models/subscription.dart';
import '../../data/portability/month_charges.dart';
import '../../l10n/app_localizations.dart';

/// The two ways to share, as the sheet's tiles.
class ShareMonthKeys {
  ShareMonthKeys._();

  /// The header control that opens the sheet.
  static const Key open = Key('insights.share');

  /// The picture of the summary tiles.
  static const Key image = Key('insights.share.image');

  /// The month's charges, as a CSV.
  static const Key csv = Key('insights.share.csv');
}

/// Opens Insights › Share for [subs] in [month]'s calendar month. [tiles] is
/// the `RepaintBoundary` the summary tiles are painted in; [export] is the
/// export seam (`exportFileTap`), never null here — the caller offers no
/// Share at all while exports are off.
Future<void> showShareMonthSheet(
  BuildContext context, {
  required List<Subscription> subs,
  required DateTime month,
  required GlobalKey tiles,
  required Future<core.ExportOutcome> Function(core.ExportFile) export,
}) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  final double pixelRatio = MediaQuery.devicePixelRatioOf(context);
  final Future<core.ExportFile?> Function()? build =
      // The design system's width decision: a sheet on a phone, a dialog
      // capped at AppBreakpoints.medium from a tablet up — never a sheet
      // stretched across a desktop window (width_share_month_test.dart).
      await showAdaptiveSheet<Future<core.ExportFile?> Function()>(
        context: context,
        builder: (BuildContext sheet) => SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              ListTile(
                key: ShareMonthKeys.image,
                leading: const Icon(Icons.image_outlined),
                title: Text(l10n.shareSummaryImage),
                onTap: () => Navigator.of(sheet).pop(
                  () => summaryImageFile(tiles, month, pixelRatio: pixelRatio),
                ),
              ),
              ListTile(
                key: ShareMonthKeys.csv,
                leading: const Icon(Icons.table_view_outlined),
                title: Text(l10n.shareMonthCsv),
                onTap: () => Navigator.of(
                  sheet,
                ).pop(() async => monthChargesCsvFile(subs, month)),
              ),
            ],
          ),
        ),
      );
  if (build == null) return;
  final core.ExportFile? file = await build();
  final core.ExportOutcome outcome = file == null
      ? core.ExportOutcome.failed
      : await export(file);
  if (outcome == core.ExportOutcome.failed) {
    messenger?.showSnackBar(SnackBar(content: Text(l10n.exportFailed)));
  }
}

/// The summary tiles as a PNG, painted off their own layer at [pixelRatio] —
/// or null when they are not on screen to paint (the caller says so rather
/// than sharing an empty picture).
Future<core.ExportFile?> summaryImageFile(
  GlobalKey tiles,
  DateTime month, {
  double pixelRatio = 1,
}) async {
  final RenderObject? box = tiles.currentContext?.findRenderObject();
  if (box is! RenderRepaintBoundary) return null;
  final ui.Image image = await box.toImage(pixelRatio: pixelRatio);
  try {
    final ByteData? png = await image.toByteData(
      format: ui.ImageByteFormat.png,
    );
    if (png == null) return null;
    return core.ExportFile(
      bytes: png.buffer.asUint8List(png.offsetInBytes, png.lengthInBytes),
      fileName: 'insights-${monthStamp(month)}.png',
      mimeType: 'image/png',
    );
  } finally {
    image.dispose();
  }
}
