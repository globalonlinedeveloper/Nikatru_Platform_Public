// AppFab — train ST-D0. Behaviour, semantics, the three required windows and
// the label's measured contrast.

import 'package:flutter/material.dart';
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
      home: Scaffold(body: Center(child: w)),
    ),
  );
}

void main() {
  test('extends from the medium class up, and not below', () {
    expect(AppFab.extendsAt(AppBreakpoints.medium - 1), isFalse);
    expect(AppFab.extendsAt(AppBreakpoints.medium), isTrue);
    expect(AppFab.extendsAt(1920), isTrue);
  });

  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('at ${size.width.toInt()}: ONE labelled button node, and the '
        'label shows exactly when the class extends it', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      int taps = 0;
      await pumpAt(
        tester,
        size,
        AppFab(
          key: const Key('fab'),
          icon: Icons.add,
          label: 'Add subscription',
          onPressed: () => taps++,
        ),
      );
      expect(tester.takeException(), isNull);
      expect(
        find.text('Add subscription'),
        AppFab.extendsAt(size.width) ? findsOneWidget : findsNothing,
      );
      expect(
        tester.getSemantics(find.byKey(const Key('fab'))),
        matchesSemantics(
          label: 'Add subscription',
          isButton: true,
          hasTapAction: true,
          hasFocusAction: true,
          hasEnabledState: true,
          isEnabled: true,
          isFocusable: true,
        ),
      );
      await tester.tap(find.byKey(const Key('fab')));
      expect(taps, 1);
      final Size s = tester.getSize(find.byType(FloatingActionButton));
      expect(s.height, greaterThanOrEqualTo(48));
      expect(s.width, greaterThanOrEqualTo(48));
      handle.dispose();
    });
  }

  testWidgets('extended: true overrides the class at a phone width', (
    WidgetTester tester,
  ) async {
    await pumpAt(
      tester,
      kPhone,
      AppFab(icon: Icons.add, label: 'Add', onPressed: () {}, extended: true),
    );
    expect(find.text('Add'), findsOneWidget);
  });

  testWidgets('its corner is the FAB role radius', (WidgetTester tester) async {
    await pumpAt(
      tester,
      kPhone,
      AppFab(icon: Icons.add, label: 'Add', onPressed: () {}),
    );
    final FloatingActionButton fab = tester.widget(
      find.byType(FloatingActionButton),
    );
    expect(
      (fab.shape! as RoundedRectangleBorder).borderRadius,
      const BorderRadius.all(Radius.circular(AppRadius.fab)),
    );
  });

  for (final Brightness b in Brightness.values) {
    test('${b.name}: the label clears AA on the button', () {
      final ColorScheme cs = buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: b,
      ).colorScheme;
      final double r = contrast(cs.onPrimaryContainer, cs.primaryContainer);
      expect(r, greaterThanOrEqualTo(4.5), reason: r.toStringAsFixed(2));
    });
  }
}
