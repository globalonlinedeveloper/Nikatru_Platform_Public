// DecisionStrip — train ST-D0. The opaque tint, the reflow at 480, one primary
// answer, the three required windows, and every word measured on every tint.

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

Future<void> pumpAt(
  WidgetTester tester,
  Size size,
  Widget w, {
  Brightness brightness = Brightness.light,
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
      home: Scaffold(
        body: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: <Widget>[w],
        ),
      ),
    ),
  );
}

DecisionStrip strip({StatusKind kind = StatusKind.warn}) => DecisionStrip(
  kind: kind,
  message: 'Trial converts tomorrow',
  detail: '649 a month from 1 Oct',
  actions: <DecisionAction>[
    DecisionAction(label: 'Keep', onPressed: () {}, key: const Key('keep')),
    DecisionAction(
      label: 'Cancel',
      onPressed: () {},
      primary: true,
      key: const Key('cancel'),
    ),
  ],
);

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('${b.name}: sits on the opaque tint of its kind', (
      WidgetTester tester,
    ) async {
      for (final StatusKind k in StatusKind.values) {
        await pumpAt(tester, kPhone, strip(kind: k), brightness: b);
        final DecoratedBox box = tester.widget<DecoratedBox>(
          find
              .descendant(
                of: find.byType(DecisionStrip),
                matching: find.byType(DecoratedBox),
              )
              .first,
        );
        final Color tint = StatusTones.forBrightness(b).tintOf(k);
        expect((box.decoration as BoxDecoration).color, tint, reason: k.name);
        expect(tint.a, 1.0);
      }
    });
  }

  // The strip's inner width is the page padding and its own padding off the
  // window, both sides — so at 375 it stacks, at 768 and 1280 it is inline.
  for (final Size size in <Size>[kPhone, kTablet, kDesktop]) {
    testWidgets('reflows by its own width at ${size.width.toInt()}', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, size, strip());
      expect(tester.takeException(), isNull);
      final double inner = size.width - 4 * AppSpacing.lg;
      final double msgY = tester
          .getTopLeft(find.text('Trial converts tomorrow'))
          .dy;
      final double btnY = tester.getTopLeft(find.byKey(const Key('cancel'))).dy;
      if (inner >= DecisionStrip.inlineFrom) {
        expect(btnY, lessThan(msgY + 24), reason: 'beside the message');
      } else {
        expect(btnY, greaterThan(msgY + 16), reason: 'under the message');
      }
    });
  }

  testWidgets('the boundary is exactly 480 of its OWN width', (
    WidgetTester tester,
  ) async {
    for (final (double inner, bool inline) in <(double, bool)>[
      (DecisionStrip.inlineFrom - 1, false),
      (DecisionStrip.inlineFrom, true),
    ]) {
      await pumpAt(
        tester,
        kDesktop,
        Align(
          alignment: Alignment.topLeft,
          // + the strip's own padding, both sides.
          child: SizedBox(width: inner + 2 * AppSpacing.lg, child: strip()),
        ),
      );
      final Offset msg = tester.getTopLeft(
        find.text('Trial converts tomorrow'),
      );
      final Offset btn = tester.getTopLeft(find.byKey(const Key('cancel')));
      if (inline) {
        expect(btn.dx, greaterThan(msg.dx), reason: 'inline at $inner');
        expect(btn.dy, lessThan(msg.dy + 24), reason: 'inline at $inner');
      } else {
        expect(btn.dy, greaterThan(msg.dy + 16), reason: 'stacked at $inner');
      }
    }
  });

  testWidgets('exactly one filled answer, and it is the primary', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, strip());
    expect(find.byType(FilledButton), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('cancel')),
        matching: find.text('Cancel'),
      ),
      findsOneWidget,
    );
    expect(find.byType(TextButton), findsOneWidget);
  });

  test('two primary answers are refused', () {
    expect(
      () => DecisionStrip(
        kind: StatusKind.danger,
        message: 'x',
        actions: <DecisionAction>[
          DecisionAction(label: 'a', onPressed: () {}, primary: true),
          DecisionAction(label: 'b', onPressed: () {}, primary: true),
        ],
      ),
      throwsAssertionError,
    );
  });

  group('every word and answer clears AA on every tint', () {
    for (final Brightness b in Brightness.values) {
      for (final Color seed in const <Color>[
        Color(0xFF6459F5),
        Color(0xFFE53935),
        Color(0xFF2E7D32),
        Color(0xFFFFB300),
        Color(0xFF101010),
        Color(0xFFF5F5F5),
      ]) {
        test('${b.name}, seed $seed', () {
          final ColorScheme cs = buildAppTheme(
            seed: seed,
            brightness: b,
          ).colorScheme;
          final StatusTones tones = StatusTones.forBrightness(b);
          for (final StatusKind k in StatusKind.values) {
            final Color tint = tones.tintOf(k);
            final Map<String, Color> inks = <String, Color>{
              'message (onSurface)': cs.onSurface,
              'detail (onSurfaceVariant)': cs.onSurfaceVariant,
              'TextButton answer (primary)': cs.primary,
            };
            for (final MapEntry<String, Color> ink in inks.entries) {
              final double r = contrast(ink.value, tint);
              expect(
                r,
                greaterThanOrEqualTo(4.5),
                reason: '${ink.key} on ${k.name}: ${r.toStringAsFixed(2)}',
              );
            }
          }
          // The filled answer paints onPrimary on primary — its own ground.
          expect(contrast(cs.onPrimary, cs.primary), greaterThanOrEqualTo(4.5));
        });
      }
    }
  });
}
