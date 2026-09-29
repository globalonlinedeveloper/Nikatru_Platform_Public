// AppSectionHeader — train ST-D1. The heading role, the 48 px keyboard-reachable
// action, the mirrored arrow, the three required windows and every word
// measured against the ground it sits on, in both schemes.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget w, {
  Brightness brightness = Brightness.light,
  TextDirection direction = TextDirection.ltr,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: brightness,
      ),
      home: Directionality(
        textDirection: direction,
        child: Scaffold(
          body: ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: <Widget>[w],
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('the title is a HEADING node', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    await pumpAt(
      tester,
      kPhone,
      const AppSectionHeader(title: 'All subscriptions', count: '12'),
    );
    expect(
      tester.getSemantics(find.text('All subscriptions')),
      isSemantics(label: 'All subscriptions', isHeader: true),
    );
    expect(find.text('12'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('the action is a 48 px button a keyboard can reach and press', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    int taps = 0;
    await pumpAt(
      tester,
      kPhone,
      AppSectionHeader(
        title: 'Upcoming renewals',
        actionLabel: 'Calendar',
        onAction: () => taps++,
      ),
    );
    final Finder action = find.byType(FocusableTap);
    expect(tester.getSize(action).height, greaterThanOrEqualTo(48));
    expect(tester.getSize(action).width, greaterThanOrEqualTo(48));
    // The arrow is excluded: the node is the WORD, announced as a button.
    expect(
      tester.getSemantics(action),
      isSemantics(
        label: 'Calendar',
        isButton: true,
        hasTapAction: true,
        isFocusable: true,
      ),
    );

    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pump();
    expect(taps, 1, reason: 'Tab reaches the action and Enter presses it');

    await tester.tap(action);
    expect(taps, 2);
    handle.dispose();
  });

  testWidgets('the arrow mirrors in RTL', (WidgetTester tester) async {
    await pumpAt(
      tester,
      kPhone,
      AppSectionHeader(title: 'x', actionLabel: 'y', onAction: () {}),
      direction: TextDirection.rtl,
    );
    final Icon arrow = tester.widget<Icon>(find.byIcon(Icons.arrow_forward));
    expect(Icons.arrow_forward.matchTextDirection, isTrue);
    // The action sits at the START edge's opposite — the left — in RTL.
    expect(
      tester.getCenter(find.byWidget(arrow)).dx,
      lessThan(tester.getCenter(find.text('x')).dx),
    );
  });

  test('a count and an action are exclusive; an action needs both halves', () {
    expect(
      () => AppSectionHeader(
        title: 'x',
        count: '1',
        actionLabel: 'y',
        onAction: () {},
      ),
      throwsAssertionError,
    );
    expect(
      () => AppSectionHeader(title: 'x', actionLabel: 'y'),
      throwsAssertionError,
    );
  });

  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('spans the pane and lays out clean at ${size.width.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        size,
        AppSectionHeader(
          title:
              'A section title long enough to need an ellipsis on a phone '
              'and still one line on a desktop window',
          actionLabel: 'Calendar',
          onAction: () {},
        ),
      );
      expect(
        tester.getSize(find.byType(AppSectionHeader)).width,
        size.width - 2 * AppSpacing.lg,
      );
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets('200 % text on a 320 px phone: no overflow', (
    WidgetTester tester,
  ) async {
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    await pumpAt(
      tester,
      const Size(320, 800),
      AppSectionHeader(
        title: 'Upcoming renewals',
        actionLabel: 'Calendar',
        onAction: () {},
      ),
    );
    expect(tester.takeException(), isNull);
  });

  for (final Brightness b in Brightness.values) {
    testWidgets('${b.name}: every word clears AA on the scaffold', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kPhone,
        Column(
          children: <Widget>[
            AppSectionHeader(title: 'T', actionLabel: 'A', onAction: () {}),
            const AppSectionHeader(title: 'U', count: '9'),
          ],
        ),
        brightness: b,
      );
      final ThemeData theme = Theme.of(tester.element(find.text('T')));
      final Color ground = theme.scaffoldBackgroundColor;
      for (final String s in <String>['T', 'A', 'U', '9']) {
        final Color ink = tester.widget<Text>(find.text(s)).style!.color!;
        expect(
          contrast(ink, ground),
          greaterThanOrEqualTo(4.5),
          reason: '"$s" is $ink on $ground',
        );
      }
    });
  }
}
