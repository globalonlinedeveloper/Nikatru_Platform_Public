// THE DESIGN FOUNDATION REACHES THIS STAMP — train ST-D0.
//
// The foundation lives in `packages/design_system` and every stamped app gets
// it through `buildAppTheme`. That is a claim about a package; this file is
// the same claim measured on THIS app, with the seed it was stamped with,
// because a seed is the one input the package cannot test for every app: a
// status tone that clears 4.5:1 on the six seeds the package sweeps can still
// miss on the seventh.
//
// It builds the theme the way `lib/app.dart` does and measures, in both
// schemes: the 12 px type floor, the scheme-forked status pairs, and their
// contrast on every surface slot this app's scheme derives.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

// One line, deliberately: `seed_hex` is always six hex characters, so the
// substituted length is fixed and `dart format` leaves this alone.
const Color kStampedSeed = Color(0xFF{{{seed_hex}}});

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

void main() {
  for (final Brightness b in Brightness.values) {
    group('the stamped theme carries the foundation, ${b.name}', () {
      final ThemeData theme = buildAppTheme(seed: kStampedSeed, brightness: b);
      final ColorScheme cs = theme.colorScheme;
      final StatusTones tones = StatusTones.forBrightness(b);

      test('no text role is under the 12 px floor', () {
        final TextTheme t = theme.textTheme;
        for (final TextStyle? s in <TextStyle?>[
          t.displayLarge,
          t.displayMedium,
          t.displaySmall,
          t.headlineLarge,
          t.headlineMedium,
          t.headlineSmall,
          t.titleLarge,
          t.titleMedium,
          t.titleSmall,
          t.bodyLarge,
          t.bodyMedium,
          t.bodySmall,
          t.labelLarge,
          t.labelMedium,
          t.labelSmall,
        ]) {
          expect(s!.fontSize, greaterThanOrEqualTo(AppTypeRamp.minimumSize));
        }
      });

      test('the status trio is the scheme half, not one shared literal', () {
        final AppThemeX x = theme.extension<AppThemeX>()!;
        expect(x.positive, tones.positive);
        expect(x.warn, tones.warn);
        expect(x.danger, tones.danger);
      });

      test('every status tone clears AA on every surface of THIS seed', () {
        final List<Color> grounds = <Color>[
          theme.scaffoldBackgroundColor,
          AppCard.fillOf(theme),
          cs.surface,
          cs.surfaceContainerLowest,
          cs.surfaceContainerLow,
          cs.surfaceContainer,
          cs.surfaceContainerHigh,
          cs.surfaceContainerHighest,
        ];
        for (final StatusKind k in StatusKind.values) {
          expect(
            contrast(tones.toneOf(k), tones.tintOf(k)),
            greaterThanOrEqualTo(4.5),
            reason: '${k.name} on its tint',
          );
          for (final Color g in grounds) {
            expect(
              contrast(tones.toneOf(k), g),
              greaterThanOrEqualTo(4.5),
              reason: '${k.name} on $g',
            );
          }
        }
      });

      test('the decision strip words clear AA on every tint', () {
        for (final StatusKind k in StatusKind.values) {
          final Color tint = tones.tintOf(k);
          expect(contrast(cs.onSurface, tint), greaterThanOrEqualTo(4.5));
          expect(
            contrast(cs.onSurfaceVariant, tint),
            greaterThanOrEqualTo(4.5),
          );
          expect(contrast(cs.primary, tint), greaterThanOrEqualTo(4.5));
        }
      });

      test('navigation badges are neutral, not the error red', () {
        expect(theme.badgeTheme.backgroundColor, cs.inverseSurface);
        expect(theme.badgeTheme.backgroundColor, isNot(cs.error));
        expect(
          contrast(
            theme.badgeTheme.textColor!,
            theme.badgeTheme.backgroundColor!,
          ),
          greaterThanOrEqualTo(4.5),
        );
      });
    });
  }
}
