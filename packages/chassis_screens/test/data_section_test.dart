// SETTINGS' YOUR DATA CARD — the chassis half of IM-01 / IM-03 (train ST
// import hub). The app-level proof, on the shipping screen, is
// apps/subscriptiontracker/test/import_hub_test.dart (the Settings › Your data
// rows open the hub; Back up writes a BackupEnvelope).
//
// MUTATION PROOF (run 2026-10-01 on this tree): swap Import and Back up in
// `rows` and "in order" goes red; make `last:` always false and "only Restore
// is last" goes red; drop `...leading` and "leading rows come first" goes red;
// wire Restore to `onImport` and "each row runs its own tap" goes red.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/settings/data_section.dart';

class _Row extends StatelessWidget {
  const _Row({
    super.key,
    required this.icon,
    required this.label,
    required this.last,
    this.subtitle,
    this.onTap,
  });

  final String icon;
  final String label;
  final bool last;
  final String? subtitle;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => InkWell(
    onTap: onTap,
    child: Text(
      '$icon $label${last ? ' (last)' : ''}${onTap == null ? ' (inert)' : ''}',
    ),
  );
}

void main() {
  final List<String> taps = <String>[];

  Future<void> pump(WidgetTester tester, {bool listLoaded = true}) async {
    taps.clear();
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (BuildContext context) => dataCard(
              context,
              decoration: const BoxDecoration(),
              row: _Row.new,
              leading: const <Widget>[Text('Connected accounts')],
              exportLabel: 'Export',
              onExport: listLoaded ? () => taps.add('export') : null,
              importLabel: 'Import',
              onImport: () => taps.add('import'),
              backupLabel: 'Back up',
              onBackup: listLoaded ? () => taps.add('backup') : null,
              restoreLabel: 'Restore',
              onRestore: () => taps.add('restore'),
            ),
          ),
        ),
      ),
    );
  }

  List<String> texts(WidgetTester tester) => tester
      .widgetList<Text>(find.byType(Text))
      .map((Text t) => t.data ?? '')
      .toList();

  testWidgets('leading rows come first, then the four rows in order', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    expect(texts(tester), <String>[
      'Connected accounts',
      '⇩ Export',
      '⇪ Import',
      '⎘ Back up',
      '↺ Restore (last)',
    ]);
  });

  testWidgets('only Restore is last, and each row carries its key', (
    WidgetTester tester,
  ) async {
    await pump(tester);
    for (final Key k in <Key>[
      DataKeys.export,
      DataKeys.import,
      DataKeys.backup,
      DataKeys.restore,
    ]) {
      expect(find.byKey(k), findsOneWidget);
    }
    expect(tester.widget<_Row>(find.byKey(DataKeys.restore)).last, isTrue);
    expect(tester.widget<_Row>(find.byKey(DataKeys.backup)).last, isFalse);
  });

  testWidgets('each row runs its own tap', (WidgetTester tester) async {
    await pump(tester);
    for (final Key k in <Key>[
      DataKeys.export,
      DataKeys.import,
      DataKeys.backup,
      DataKeys.restore,
    ]) {
      await tester.tap(find.byKey(k));
    }
    expect(taps, <String>['export', 'import', 'backup', 'restore']);
  });

  testWidgets('a list that has not loaded leaves Export and Back up inert', (
    WidgetTester tester,
  ) async {
    await pump(tester, listLoaded: false);
    expect(tester.widget<_Row>(find.byKey(DataKeys.export)).onTap, isNull);
    expect(tester.widget<_Row>(find.byKey(DataKeys.backup)).onTap, isNull);
    expect(tester.widget<_Row>(find.byKey(DataKeys.import)).onTap, isNotNull);
  });
}
