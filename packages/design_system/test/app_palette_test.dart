// AppPalette — the brightness-resolved palette (ST-D0 D0-2), MEASURED.
//
// The palette makes two contrast promises a widget relies on without checking:
// `control` (a switch's OFF boundary) clears 3:1 on `surface`, and `accentInk`
// (the brand as a glyph or a word) clears 4.5:1 on it. Both are re-measured
// here across the same stress seeds `status_contrast_test.dart` sweeps, in
// both brightnesses, because a seed is an input every stamped app chooses.

// The deprecated `AppColors` neutrals are read on purpose below (their
// analyzer infos are expected): this file pins them to the palette's light
// half for the release the alias is kept.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Map<String, Color> seeds = <String, Color>{
  'subscriptiontracker indigo': Color(0xFF6459F5),
  'red': Color(0xFFE53935),
  'green': Color(0xFF2E7D32),
  'amber': Color(0xFFFFB300),
  'near-black': Color(0xFF101010),
  'near-white': Color(0xFFF5F5F5),
};

AppPalette paletteOf(ThemeData theme) => theme.extension<AppPalette>()!;

void main() {
  test('the old settings off-track literal is the defect this exists for', () {
    // #E2E2EA on the white card: 1.3:1 — under SC 1.4.11's 3:1.
    expect(
      AppPalette.contrastRatio(
        const Color(0xFFE2E2EA),
        AppPalette.lightSurface,
      ),
      lessThan(AppPalette.nonTextMinimum),
    );
  });

  for (final MapEntry<String, Color> seed in seeds.entries) {
    for (final Brightness b in Brightness.values) {
      group('${seed.key} · ${b.name}', () {
        final ThemeData theme = buildAppTheme(seed: seed.value, brightness: b);
        final AppPalette p = paletteOf(theme);

        test('control clears 3:1 on surface', () {
          final double r = AppPalette.contrastRatio(p.control, p.surface);
          expect(r, greaterThanOrEqualTo(AppPalette.nonTextMinimum));
        });

        test('accentInk clears 4.5:1 on surface', () {
          final double r = AppPalette.contrastRatio(p.accentInk, p.surface);
          expect(r, greaterThanOrEqualTo(AppPalette.textMinimum));
        });

        test('the half matches the theme it was built for', () {
          expect(p.brightness, b);
          expect(p.status, same(StatusTones.forBrightness(b)));
          expect(p.accent, seed.value);
        });
      });
    }
  }

  test('LIGHT neutrals are the Subly literals, and the deprecated AppColors '
      'names alias them', () {
    final AppPalette p = paletteOf(
      buildAppTheme(seed: const Color(0xFF6459F5)),
    );
    expect(p.bg, AppColors.bg);
    expect(p.surface, AppColors.surface);
    expect(p.ink, AppColors.ink);
    expect(p.muted, AppColors.muted);
    expect(p.line, AppColors.line);
    // The Subly seed clears 4.5:1 on white, so its ink is the seed itself —
    // the light glyph tile does not move.
    expect(p.accentInk, AppColors.accent);
  });

  test('DARK neutrals are the seeded scheme slots the app paints its cards '
      'with', () {
    final ThemeData theme = buildAppTheme(
      seed: const Color(0xFF6459F5),
      brightness: Brightness.dark,
    );
    final ColorScheme s = theme.colorScheme;
    final AppPalette p = paletteOf(theme);
    expect(p.bg, s.surface);
    expect(p.surface, s.surfaceContainerHighest);
    expect(p.ink, s.onSurface);
    expect(p.muted, s.onSurfaceVariant);
    expect(p.line, s.outlineVariant);
    // The indigo seed is under 4.5:1 on a dark card; the ink moves to the
    // scheme's primary, the seed's own light tone.
    expect(p.accentInk, isNot(const Color(0xFF6459F5)));
  });

  testWidgets('AppPalette.of reads the installed extension, and derives one '
      'from a bare theme', (WidgetTester tester) async {
    late AppPalette installed;
    late AppPalette derived;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildAppTheme(
          seed: const Color(0xFF6459F5),
          brightness: Brightness.dark,
        ),
        home: Builder(
          builder: (BuildContext context) {
            installed = AppPalette.of(context);
            return Theme(
              data: ThemeData(brightness: Brightness.dark),
              child: Builder(
                builder: (BuildContext inner) {
                  derived = AppPalette.of(inner);
                  return const SizedBox();
                },
              ),
            );
          },
        ),
      ),
    );
    expect(installed.brightness, Brightness.dark);
    expect(derived.brightness, Brightness.dark);
    expect(
      AppPalette.contrastRatio(derived.control, derived.surface),
      greaterThanOrEqualTo(AppPalette.nonTextMinimum),
    );
  });

  test('firstClearing falls back to the last candidate when none clears', () {
    expect(
      AppPalette.firstClearing(
        const <Color>[Color(0xFFFFFFFE), Color(0xFFFFFFFD)],
        on: const Color(0xFFFFFFFF),
        minimum: 3,
      ),
      const Color(0xFFFFFFFD),
    );
  });
}
