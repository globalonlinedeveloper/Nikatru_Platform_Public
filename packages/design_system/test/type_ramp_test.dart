// THE TYPE RAMP AND ITS 12 PX FLOOR — train ST-D0.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

Map<String, TextStyle?> rolesOf(TextTheme t) => <String, TextStyle?>{
  'displayLarge': t.displayLarge,
  'displayMedium': t.displayMedium,
  'displaySmall': t.displaySmall,
  'headlineLarge': t.headlineLarge,
  'headlineMedium': t.headlineMedium,
  'headlineSmall': t.headlineSmall,
  'titleLarge': t.titleLarge,
  'titleMedium': t.titleMedium,
  'titleSmall': t.titleSmall,
  'bodyLarge': t.bodyLarge,
  'bodyMedium': t.bodyMedium,
  'bodySmall': t.bodySmall,
  'labelLarge': t.labelLarge,
  'labelMedium': t.labelMedium,
  'labelSmall': t.labelSmall,
};

void main() {
  test('the ramp table names all fifteen Material roles, none under 12', () {
    expect(AppTypeRamp.roles.keys.toSet(), rolesOf(const TextTheme()).keys);
    for (final MapEntry<String, ({double size, double line, FontWeight weight})>
        r
        in AppTypeRamp.roles.entries) {
      expect(
        r.value.size,
        greaterThanOrEqualTo(AppTypeRamp.minimumSize),
        reason: r.key,
      );
      expect(r.value.line, greaterThanOrEqualTo(r.value.size), reason: r.key);
    }
  });

  test('the floor is 12 and it is what raised labelSmall', () {
    expect(AppTypeRamp.minimumSize, 12);
    expect(AppTypeRamp.roles['labelSmall']!.size, 12);
    // Control: Flutter's own ramp, which the chassis used to inherit, still
    // ships an 11 — so this file would go red if the ramp were bypassed.
    expect(
      Typography.material2021().englishLike.labelSmall!.fontSize,
      lessThan(AppTypeRamp.minimumSize),
    );
  });

  for (final Brightness b in Brightness.values) {
    group('buildAppTheme, ${b.name}', () {
      final ThemeData theme = buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: b,
      );

      test('every role of the BUILT theme is on the ramp and >= 12', () {
        rolesOf(theme.textTheme).forEach((String name, TextStyle? style) {
          expect(style, isNotNull, reason: name);
          expect(style!.fontSize, AppTypeRamp.roles[name]!.size, reason: name);
          expect(
            style.fontSize,
            greaterThanOrEqualTo(AppTypeRamp.minimumSize),
            reason: name,
          );
        });
      });

      test('display and headline take the display face, the rest the body '
          'face — both read from the contract', () {
        rolesOf(theme.textTheme).forEach((String name, TextStyle? style) {
          final bool display =
              name.startsWith('display') || name.startsWith('headline');
          expect(
            style!.fontFamily,
            display ? BrandTokens.fontDisplay : BrandTokens.fontBody,
            reason: name,
          );
        });
      });

      test('every role is painted in the scheme ink', () {
        rolesOf(theme.textTheme).forEach((String name, TextStyle? style) {
          expect(style!.color, theme.colorScheme.onSurface, reason: name);
        });
      });
    });
  }
}
