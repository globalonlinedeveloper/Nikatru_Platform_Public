// ─────────────────────────────────────────────────────────────────────────────
// a11y_detail_components_test.dart — the accessibility sweep for the detail
// components (train ST-D5): AppIconAction, AppMonogram, AppFigureTile and
// AppDetailHeader, both schemes.
//
// Named `a11y_*_test.dart` on purpose: `assert-a11y-coverage.mjs` reads a
// corpus of exactly that shape, and credits a sweep to a surface only when the
// surface is CONSTRUCTED and the guideline CALLED in one `testWidgets` body —
// so each component has its own body below rather than one shared gallery, and
// the four guideline calls are written out in each body rather than behind a
// helper the guard cannot see through.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

Future<void> _pump(WidgetTester tester, Brightness b, Widget child) async {
  await tester.binding.setSurfaceSize(const Size(375, 812));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
      home: Scaffold(body: child),
    ),
  );
}

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('AppIconAction, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        b,
        Center(
          child: AppIconAction(
            icon: Icons.close,
            label: 'Close',
            onPressed: () {},
          ),
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('AppMonogram, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        b,
        ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: const <Widget>[
            AppListRow(
              leading: AppMonogram(text: 'NF'),
              title: 'Netflix',
              figure: '15.49',
            ),
            AppListRow(
              leading: AppMonogram.icon(
                Icons.notifications_none,
                status: StatusKind.warn,
              ),
              title: 'Netflix renews tomorrow',
            ),
          ],
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('AppFigureTile, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        b,
        ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: const <Widget>[
            AppFigureTile(label: 'Price', figure: '15.49', caption: 'month'),
            AppFigureTile(
              label: 'Next charge',
              figure: 'Jul 22',
              caption: 'Renews tomorrow',
              status: StatusKind.warn,
            ),
          ],
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('AppDetailHeader, ${b.name}', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        b,
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            AppDetailHeader(
              title: 'Netflix',
              subtitle: 'Entertainment · Premium',
              leading: const AppMonogram(text: 'NF', size: AppMonogram.large),
              backLabel: 'Back',
              onBack: () {},
              actions: <AppHeaderAction>[
                AppHeaderAction(
                  icon: Icons.more_horiz,
                  label: 'More options',
                  onPressed: () {},
                ),
              ],
            ),
          ],
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  }
}
