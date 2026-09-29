// THE SCHEME-FORKED STATUS PAIRS, MEASURED — train ST-D0 (absorbs ST-Y1).
//
// Every status tone is computed here with the WCAG 2.2 relative-luminance
// formula against its own OPAQUE tint and against every surface slot of a
// sweep of seeded schemes, in both brightnesses. A ratio in a doc comment is
// true on the day it was measured; these are re-measured on every run.
//
// 🔴 THE BAR IS 4.5:1, not 3:1. A status is painted as a WORD at or near the
// 12 px floor (`AppTypeRamp.minimumSize`), which WCAG 1.4.3 calls normal text
// however bold it is.
//
// The seeds are chosen to stress the palette, not to flatter it: the shipping
// app's indigo, and a red, a green and an amber that each share a hue with one
// status (a red-seeded surface under a danger word is where a tone and its
// ground are most alike), plus a near-black and a near-white seed.
//
// The component grounds (a card, a decision strip's words on the tints, a
// badge, the FAB) are measured beside the component that paints them.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

double contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}

const Map<String, Color> seeds = <String, Color>{
  'subscriptiontracker indigo': Color(0xFF6459F5),
  'red': Color(0xFFE53935),
  'green': Color(0xFF2E7D32),
  'amber': Color(0xFFFFB300),
  'near-black': Color(0xFF101010),
  'near-white': Color(0xFFF5F5F5),
};

const double aa = 4.5;

void main() {
  test('the WCAG formula is the one this file thinks it is', () {
    // Known values: black on white is 21:1, a colour on itself is 1:1.
    expect(contrast(const Color(0xFF000000), const Color(0xFFFFFFFF)), 21);
    expect(contrast(const Color(0xFF777777), const Color(0xFF777777)), 1);
    // And a known AA miss stays a miss: the old shared amber on white, which
    // is why the pairs exist.
    expect(contrast(AppColors.warn, const Color(0xFFFFFFFF)), lessThan(aa));
  });

  for (final Brightness b in Brightness.values) {
    final StatusTones tones = StatusTones.forBrightness(b);

    group('${b.name} scheme', () {
      test('each status tone clears AA on its own OPAQUE tint', () {
        for (final StatusKind k in StatusKind.values) {
          final double r = contrast(tones.toneOf(k), tones.tintOf(k));
          expect(r, greaterThanOrEqualTo(aa), reason: '${k.name}: $r');
        }
      });

      test('every tone and every tint is opaque', () {
        for (final StatusKind k in StatusKind.values) {
          expect(tones.tintOf(k).a, 1.0, reason: k.name);
          expect(tones.toneOf(k).a, 1.0, reason: k.name);
        }
      });

      test('the pairs come from the contract, not from a literal here', () {
        final bool light = b == Brightness.light;
        expect(
          tones.positive,
          light ? BrandTokens.positive : BrandTokensDark.positive,
        );
        expect(
          tones.dangerTint,
          light ? BrandTokens.dangerTint : BrandTokensDark.dangerTint,
        );
      });

      test('StatusTones.of and AppThemeX resolve the half for the scheme', () {
        final ThemeData theme = buildAppTheme(
          seed: const Color(0xFF6459F5),
          brightness: b,
        );
        expect(StatusTones.forBrightness(theme.brightness), same(tones));
        final AppThemeX x = theme.extension<AppThemeX>()!;
        expect(x.positive, tones.positive);
        expect(x.warn, tones.warn);
        expect(x.danger, tones.danger);
      });

      for (final MapEntry<String, Color> seed in seeds.entries) {
        test(
          'seed ${seed.key}: every tone clears AA on every surface slot',
          () {
            final ThemeData theme = buildAppTheme(
              seed: seed.value,
              brightness: b,
            );
            final ColorScheme cs = theme.colorScheme;
            final Map<String, Color> grounds = <String, Color>{
              'scaffold': theme.scaffoldBackgroundColor,
              'surface': cs.surface,
              'surfaceContainerLowest': cs.surfaceContainerLowest,
              'surfaceContainerLow': cs.surfaceContainerLow,
              'surfaceContainer': cs.surfaceContainer,
              'surfaceContainerHigh': cs.surfaceContainerHigh,
              'surfaceContainerHighest': cs.surfaceContainerHighest,
            };
            for (final StatusKind k in StatusKind.values) {
              for (final MapEntry<String, Color> g in grounds.entries) {
                final double r = contrast(tones.toneOf(k), g.value);
                expect(
                  r,
                  greaterThanOrEqualTo(aa),
                  reason: '${k.name} on ${g.key}: ${r.toStringAsFixed(2)}',
                );
              }
            }
          },
        );
      }
    });
  }

  test(
    'the status trio stays seed-independent (green means good everywhere)',
    () {
      final AppThemeX red = buildAppTheme(
        seed: const Color(0xFFFF0000),
      ).extension<AppThemeX>()!;
      final AppThemeX green = buildAppTheme(
        seed: const Color(0xFF00FF00),
      ).extension<AppThemeX>()!;
      expect(red.positive, green.positive);
      expect(red.warn, green.warn);
      expect(red.danger, green.danger);
    },
  );
}
