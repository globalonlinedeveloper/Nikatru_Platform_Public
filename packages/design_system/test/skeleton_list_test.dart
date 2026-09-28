// SkeletonList, and the empty / error / loading text grounds — train ST-D0.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 800);

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: const Color(0xFF6459F5)),
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[w],
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('one announcement, a live region, and it SETTLES', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pumpAt(
      tester,
      kPhone,
      const SkeletonList(label: 'Loading subscriptions', rows: 4),
    );
    // Static by design: pumpAndSettle returns rather than timing out, which a
    // shimmer or a spinner never lets it do.
    await tester.pumpAndSettle();
    expect(find.byKey(SkeletonList.skeletonKey), findsOneWidget);
    expect(find.bySemanticsLabel('Loading subscriptions'), findsOneWidget);
    final SemanticsNode node = tester.getSemantics(
      find.byKey(SkeletonList.skeletonKey),
    );
    expect(node.flagsCollection.isLiveRegion, isTrue);
    handle.dispose();
  });

  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('spans the pane at list-row height, ${size.width.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, size, const SkeletonList(label: 'Loading'));
      expect(tester.takeException(), isNull);
      final Size s = tester.getSize(find.byKey(SkeletonList.skeletonKey));
      expect(s.width, size.width - 2 * AppSpacing.lg);
      expect(s.height, 3 * AppListRow.minHeightFor(VisualDensity.standard));
    });
  }

  test('zero rows is refused', () {
    expect(() => SkeletonList(label: 'x', rows: 0), throwsAssertionError);
  });

  for (final Brightness b in Brightness.values) {
    test('${b.name}: the blocks separate from the card and the scaffold', () {
      final ThemeData theme = buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: b,
      );
      final Color block = theme.colorScheme.surfaceContainerHighest;
      expect(block.a, 1.0);
      expect(block, isNot(AppCard.fillOf(theme)));
      expect(block, isNot(theme.scaffoldBackgroundColor));
    });

    test('${b.name}: empty / failed / loading text clears AA on the scaffold '
        'and on a card', () {
      for (final Color seed in const <Color>[
        Color(0xFF6459F5),
        Color(0xFFE53935),
        Color(0xFF2E7D32),
        Color(0xFFFFB300),
      ]) {
        final ThemeData theme = buildAppTheme(seed: seed, brightness: b);
        final ColorScheme cs = theme.colorScheme;
        for (final Color ground in <Color>[
          theme.scaffoldBackgroundColor,
          AppCard.fillOf(theme),
        ]) {
          expect(contrast(cs.onSurface, ground), greaterThanOrEqualTo(4.5));
          expect(
            contrast(cs.onSurfaceVariant, ground),
            greaterThanOrEqualTo(4.5),
          );
        }
      }
    });
  }
}
