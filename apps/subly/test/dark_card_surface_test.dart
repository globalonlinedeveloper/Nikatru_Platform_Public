// ─────────────────────────────────────────────────────────────────────────────
// P4·W0 — THE SHARED CARD SURFACE, IN BOTH BRIGHTNESSES.
//
// `cardDecoration` is the single decoration behind 17 call sites across five
// screens (settings 9 · insights 2 · detail 2 · calendar 2 · budget 2). Until
// this increment it hardcoded `AppColors.surface` + `kCardShadow`, so with
// `app.dart` supplying `darkTheme` a dark-OS user got dark chassis chrome with
// WHITE cards on it — a live defect, not a polish item.
//
// 🔴 THIS FILE IS A PAIR, AND BOTH HALVES ARE LOAD-BEARING IN OPPOSITE
// DIRECTIONS. Read them together or neither is worth anything:
//
//   · The LIGHT half is a PIN, not a feature test. `apps/subly` is the frozen
//     legacy rail-prover and the owner eyeballed 1.0.151; light must stay
//     pixel-identical through the dark work. It asserts the LITERAL token
//     (0xFFFFFFFF, `AppColors.surface`) rather than `scheme.surface`, on
//     purpose — asserting against the scheme would make the natural regression
//     (someone "tidying" the light branch to `scheme.surface`) pass, because
//     both sides of the comparison would move together. An assertion that
//     cannot fail is worse than none.
//
//   · The DARK half is the FALSIFIER. Revert `cardDecoration` to the
//     unconditional `color: AppColors.surface` and the dark cases go red on
//     their first expect — verified by doing exactly that (negative test,
//     2026-08-08). Both dark clauses fail: the colour equals the light value it
//     must differ from, and the border affordance disappears.
//
// The dark expectations are computed from `buildAppTheme(...)` here rather than
// written as hex literals, because the point is that the card now DERIVES from
// the seed's scheme. A literal would re-freeze in the dark branch precisely the
// property C-11 removed from the chassis.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/shared/widgets.dart';

/// The seed `app.dart` passes to BOTH `theme:` and `darkTheme:`. Kept as a
/// literal here so a change to the app's seed shows up as a failure to explain
/// rather than as a test that silently follows it.
const Color kSublySeed = Color(0xFF6459F5);

const Key _card = Key('card-under-test');

/// Mounts a bare `Container` whose decoration is whatever `cardDecoration`
/// returns under [mode]. No screen, no providers — the unit under test is the
/// function, and pulling a real screen in would make a failure ambiguous
/// between the decoration and that screen's own state.
Future<BoxDecoration> pumpCard(WidgetTester tester, ThemeMode mode) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: buildAppTheme(seed: kSublySeed),
      darkTheme: buildAppTheme(seed: kSublySeed, brightness: Brightness.dark),
      themeMode: mode,
      home: Builder(
        builder: (BuildContext context) =>
            Container(key: _card, decoration: cardDecoration(context)),
      ),
    ),
  );
  return tester.widget<Container>(find.byKey(_card)).decoration!
      as BoxDecoration;
}

void main() {
  final ColorScheme dark = buildAppTheme(
    seed: kSublySeed,
    brightness: Brightness.dark,
  ).colorScheme;

  group('cardDecoration is theme-aware', () {
    testWidgets('LIGHT is pixel-identical to the pre-dark decoration', (
      WidgetTester tester,
    ) async {
      final BoxDecoration d = await pumpCard(tester, ThemeMode.light);

      expect(
        d.color,
        AppColors.surface,
        reason:
            'The light card MUST stay the literal AppColors.surface. This is '
            'the frozen legacy app the owner eyeballs; swapping it for '
            'scheme.surface repaints every card on five screens at once.',
      );
      expect(
        d.boxShadow,
        kCardShadow,
        reason: 'Light keeps the original two-layer shadow, unchanged.',
      );
      expect(
        d.border,
        isNull,
        reason:
            'Light gains NOTHING from the dark work — a border here would be a '
            'visible 1px inset on every card.',
      );
    });

    testWidgets('DARK derives its surface from the scheme, not the token', (
      WidgetTester tester,
    ) async {
      final BoxDecoration d = await pumpCard(tester, ThemeMode.dark);

      expect(
        d.color,
        isNot(AppColors.surface),
        reason:
            'THE DEFECT THIS INCREMENT FIXES: a white card on a dark scaffold. '
            'Reverting cardDecoration to the hardcoded colour turns this red.',
      );
      expect(
        d.color,
        dark.surfaceContainerHighest,
        reason:
            'The dark card is the scheme slot the brick home also uses — the '
            'lightest container step, so it separates from the scaffold '
            '(scheme.surface) by the widest margin the scheme offers.',
      );
    });

    testWidgets('DARK carries an edge affordance instead of the shadow', (
      WidgetTester tester,
    ) async {
      final BoxDecoration d = await pumpCard(tester, ThemeMode.dark);

      // kCardShadow is two BLACK alphas. On a dark scaffold they are invisible,
      // so a dark card with only a shadow has no edge at all — this is why the
      // border is required rather than decorative.
      expect(
        d.border,
        isNotNull,
        reason:
            'Without a border the dark card has NO boundary: kCardShadow is '
            'black-on-dark and paints nothing a user can see.',
      );
      expect(
        (d.border! as Border).top.color,
        dark.outlineVariant,
        reason:
            "The hairline is the scheme's own divider slot, not an invented "
            'colour.',
      );
    });
  });
}
