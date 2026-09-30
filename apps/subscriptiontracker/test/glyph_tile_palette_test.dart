// B50 (round-2 review, ST-Y1) — THE GLYPH TILE PAINTED ONE INK IN BOTH SCHEMES.
//
// `GlyphTile` drew its letters in `AppColors.accent` and ringed its status dot
// in `AppColors.surface` whatever the brightness: the same indigo on a dark
// card, and a white ring on it. Both now read `AppPalette` (ST-D0 D0-2). This
// file measures the tile ON the card it sits on:
//  * dark — the glyph ink on its tint clears 3:1 (SC 1.4.11: the glyph is a
//    decorative mark, excluded from semantics, beside the name in words), and
//    the ring IS the card's fill;
//  * light — both resolve to the literals the owner-eyeballed build shipped.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart';

const Color _sublySeed = Color(0xFF6459F5);

Future<void> _pumpOnCard(WidgetTester tester, Brightness b) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: _sublySeed, brightness: b),
      home: Scaffold(
        body: Center(
          child: Builder(
            builder: (BuildContext context) => Container(
              key: const Key('card'),
              padding: const EdgeInsets.all(24),
              decoration: cardDecoration(context),
              child: const GlyphTile(glyph: 'NF', statusColor: Colors.green),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

Color _cardFill(WidgetTester tester) =>
    ((tester.widget<Container>(find.byKey(const Key('card'))).decoration!
            as BoxDecoration)
        .color)!;

Color _glyphInk(WidgetTester tester) =>
    tester.widget<Text>(find.text('NF')).style!.color!;

/// Every stop of the tile's tint, composited onto [card] — the grounds the
/// glyph actually sits on.
List<Color> _tintOn(WidgetTester tester, Color card) {
  final Iterable<BoxDecoration> decorations = tester
      .widgetList<DecoratedBox>(
        find.descendant(
          of: find.byType(GlyphTile),
          matching: find.byType(DecoratedBox),
        ),
      )
      .map((DecoratedBox d) => d.decoration)
      .whereType<BoxDecoration>()
      .where((BoxDecoration d) => d.gradient != null);
  return <Color>[
    for (final Color stop in decorations.single.gradient!.colors)
      Color.alphaBlend(stop, card),
  ];
}

Color _ringColour(WidgetTester tester) {
  final BoxDecoration dot = tester
      .widgetList<DecoratedBox>(
        find.descendant(
          of: find.byType(GlyphTile),
          matching: find.byType(DecoratedBox),
        ),
      )
      .map((DecoratedBox d) => d.decoration)
      .whereType<BoxDecoration>()
      .singleWhere((BoxDecoration d) => d.shape == BoxShape.circle);
  return (dot.border! as Border).top.color;
}

void main() {
  testWidgets('DARK: the glyph ink clears 3:1 on its tint on the dark card, '
      'and the status ring is the card fill', (WidgetTester tester) async {
    await _pumpOnCard(tester, Brightness.dark);
    final Color card = _cardFill(tester);
    final Color ink = _glyphInk(tester);
    for (final Color ground in _tintOn(tester, card)) {
      final double r = AppPalette.contrastRatio(ink, ground);
      expect(
        r,
        greaterThanOrEqualTo(AppPalette.nonTextMinimum),
        reason: 'glyph $ink on tint $ground = $r:1',
      );
    }
    expect(_ringColour(tester), card);
  });

  testWidgets('LIGHT: the tile resolves to the literals the light build '
      'shipped', (WidgetTester tester) async {
    await _pumpOnCard(tester, Brightness.light);
    expect(_glyphInk(tester), const Color(0xFF6459F5));
    expect(_ringColour(tester), const Color(0xFFFFFFFF));
    expect(_ringColour(tester), _cardFill(tester));
  });
}
