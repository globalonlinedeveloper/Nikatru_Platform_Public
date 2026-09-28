import 'dart:io' show FileSystemException;

import 'package:flutter/foundation.dart' show TargetPlatform;
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_platform_storage/nikatru_platform_storage.dart';
import 'package:share_plus/share_plus.dart';

/// ST-X1 — the export matrix has SEVEN rows (six platforms and web), and each
/// is exercisable from any host because `forPlatform` takes the platform as a
/// parameter. A matrix only evaluable on the test machine leaves six of seven
/// rows permanently unexercised.
void main() {
  const List<TargetPlatform> all = <TargetPlatform>[
    TargetPlatform.android,
    TargetPlatform.iOS,
    TargetPlatform.macOS,
    TargetPlatform.windows,
    TargetPlatform.linux,
    TargetPlatform.fuchsia,
  ];

  test('seven declared rows: six platforms and web', () {
    final List<ExportCapabilities> rows = <ExportCapabilities>[
      for (final TargetPlatform p in all)
        ExportCapabilities.forPlatform(p, isWeb: false),
      ExportCapabilities.forPlatform(TargetPlatform.android, isWeb: true),
    ];
    expect(rows, hasLength(7));
    for (final ExportCapabilities c in rows) {
      expect(c.note, isNotEmpty, reason: '$c says nothing about its route');
    }
  });

  test('every shipping target can export a file', () {
    for (final TargetPlatform p in all.where(
      (TargetPlatform p) => p != TargetPlatform.fuchsia,
    )) {
      final ExportCapabilities c = ExportCapabilities.forPlatform(
        p,
        isWeb: false,
      );
      expect(c.canExportFile, isTrue, reason: '$p lost its export route');
      expect(c.route, isNot(ExportRoute.none));
    }
    expect(
      ExportCapabilities.forPlatform(
        TargetPlatform.fuchsia,
        isWeb: false,
      ).canExportFile,
      isFalse,
    );
  });

  // 🔴 THE ROW THIS MATRIX EXISTS FOR: share_plus shares text only on linux.
  test('linux saves through a portal save dialog, not a share sheet', () {
    final ExportCapabilities linux = ExportCapabilities.forPlatform(
      TargetPlatform.linux,
      isWeb: false,
    );
    expect(linux.route, ExportRoute.saveDialog);
    expect(
      linux.note,
      contains('portal'),
      reason: 'the snap is strictly confined: only the portal hands it a '
          'path in the user\'s own folders',
    );
  });

  test('isWeb takes precedence over the host platform', () {
    for (final TargetPlatform p in all) {
      expect(
        ExportCapabilities.forPlatform(p, isWeb: true).route,
        ExportRoute.browser,
        reason: 'web reported the $p route',
      );
    }
  });

  group('ShareFileExporter routes by the matrix', () {
    const core.ExportFile file = core.ExportFile(
      bytes: <int>[0xEF, 0xBB, 0xBF, 0x61],
      fileName: 'subscriptions.csv',
      mimeType: 'text/csv',
    );

    test('a share-sheet platform hands the named file to share_plus', () async {
      ShareParams? seen;
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.android,
          isWeb: false,
        ),
        share: (ShareParams p) async {
          seen = p;
          return const ShareResult('ok', ShareResultStatus.success);
        },
      );
      expect(await e.export(file), core.ExportOutcome.exported);
      expect(seen?.files, hasLength(1));
      expect(seen?.fileNameOverrides, <String>['subscriptions.csv']);
      expect(await seen!.files!.single.readAsBytes(), file.bytes);
    });

    test('a dismissed sheet is dismissed, not exported', () async {
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.iOS,
          isWeb: false,
        ),
        share: (_) async =>
            const ShareResult('', ShareResultStatus.dismissed),
      );
      expect(await e.export(file), core.ExportOutcome.dismissed);
    });

    test('linux writes where the user chose and never calls share_plus',
        () async {
      String? suggested;
      String? writtenTo;
      List<int>? written;
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.linux,
          isWeb: false,
        ),
        share: (_) async => throw StateError('share_plus on linux throws'),
        saveLocation: (String name) async {
          suggested = name;
          return '/run/user/1000/doc/ab12/subscriptions.csv';
        },
        saveBytes: (XFile x, String path) async {
          writtenTo = path;
          written = await x.readAsBytes();
        },
      );
      expect(await e.export(file), core.ExportOutcome.exported);
      expect(suggested, 'subscriptions.csv');
      expect(writtenTo, '/run/user/1000/doc/ab12/subscriptions.csv');
      expect(written, file.bytes);
    });

    test('linux: a cancelled dialog is dismissed, and nothing is written',
        () async {
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.linux,
          isWeb: false,
        ),
        saveLocation: (_) async => null,
        saveBytes: (_, _) async => fail('nothing may be written'),
      );
      expect(await e.export(file), core.ExportOutcome.dismissed);
    });

    test('linux: a write that throws is failed, never a crash', () async {
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.linux,
          isWeb: false,
        ),
        saveLocation: (_) async => '/read-only/subscriptions.csv',
        saveBytes: (_, _) async => throw const FileSystemException('EROFS'),
      );
      expect(await e.export(file), core.ExportOutcome.failed);
    });

    test('a plugin that throws reads as failed, never a crash', () async {
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.windows,
          isWeb: false,
        ),
        share: (_) async => throw Exception('platform channel gone'),
      );
      expect(await e.export(file), core.ExportOutcome.failed);
    });

    test('fuchsia is refused before any plugin is touched', () async {
      final ShareFileExporter e = ShareFileExporter(
        capabilities: ExportCapabilities.forPlatform(
          TargetPlatform.fuchsia,
          isWeb: false,
        ),
        share: (_) async => fail('share_plus must not be called'),
      );
      expect(await e.export(file), core.ExportOutcome.failed);
    });
  });
}
