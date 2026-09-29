import 'package:flutter/material.dart';

import 'brand_tokens.dart';

/// The chassis TYPE RAMP: the fifteen Material 3 roles, their sizes stated
/// here rather than inherited, and a 12 px floor (train ST-D0).
///
/// 🔴 WHY THE SIZES ARE WRITTEN OUT. `buildAppTheme` used to take Flutter's
/// `Typography.material2021` sizes by default and change only the face. That
/// made the ramp a property of whichever Flutter release a stamp resolved, and
/// it shipped one role under the floor: `labelSmall` is 11 px, and it is what
/// Material's own [Badge] and several chip and caption slots paint with. A
/// ramp nobody wrote down is a ramp nobody can hold to a minimum.
///
/// 🔴 THE FLOOR IS [minimumSize], AND IT IS A LEGIBILITY RULE, NOT A TASTE.
/// Every role is at least 12 logical pixels before the user's own text scale
/// is applied; `test/type_ramp_test.dart` reads every role of a built theme in
/// both schemes and fails on an 11.
///
/// The FACES come from the contract: display and headline roles take
/// [BrandTokens.fontDisplay], everything else [BrandTokens.fontBody]. That is
/// the split `AppText` already makes by hand (numerals and headings in the
/// display face, prose in the body face), applied to the unnamed Material
/// roles every stamped screen paints with.
class AppTypeRamp {
  AppTypeRamp._();

  /// The smallest font size any role may carry, in logical pixels.
  static const double minimumSize = 12;

  /// Size, line height (as a pixel figure) and weight per role.
  ///
  /// Material 3's published ramp — sizes, line heights and weights — except
  /// `labelSmall`, which is raised from 11 to [minimumSize]. Line heights stay
  /// the published ones, so the raised role keeps the rhythm of the role
  /// beside it (`labelMedium`, 12/16). The weights are Material's on purpose:
  /// weight is a per-screen emphasis decision (`AppText` makes it), and a
  /// foundation that re-weighted every unnamed role would repaint every
  /// stamped screen as a side effect of setting a floor.
  static const Map<String, ({double size, double line, FontWeight weight})>
  roles = <String, ({double size, double line, FontWeight weight})>{
    'displayLarge': (size: 57, line: 64, weight: FontWeight.w400),
    'displayMedium': (size: 45, line: 52, weight: FontWeight.w400),
    'displaySmall': (size: 36, line: 44, weight: FontWeight.w400),
    'headlineLarge': (size: 32, line: 40, weight: FontWeight.w400),
    'headlineMedium': (size: 28, line: 36, weight: FontWeight.w400),
    'headlineSmall': (size: 24, line: 32, weight: FontWeight.w400),
    'titleLarge': (size: 22, line: 28, weight: FontWeight.w400),
    'titleMedium': (size: 16, line: 24, weight: FontWeight.w500),
    'titleSmall': (size: 14, line: 20, weight: FontWeight.w500),
    'bodyLarge': (size: 16, line: 24, weight: FontWeight.w400),
    'bodyMedium': (size: 14, line: 20, weight: FontWeight.w400),
    'bodySmall': (size: 12, line: 16, weight: FontWeight.w400),
    'labelLarge': (size: 14, line: 20, weight: FontWeight.w500),
    'labelMedium': (size: 12, line: 16, weight: FontWeight.w500),
    'labelSmall': (size: 12, line: 16, weight: FontWeight.w500),
  };

  static TextStyle? _role(TextStyle? base, String name, String family) {
    final ({double size, double line, FontWeight weight}) r = roles[name]!;
    return (base ?? const TextStyle()).copyWith(
      fontFamily: family,
      fontSize: r.size,
      height: r.line / r.size,
      fontWeight: r.weight,
    );
  }

  /// [base] with every role set to this ramp. Colours and decorations on
  /// [base] are kept; size, height, weight and face are replaced.
  static TextTheme apply(TextTheme base) {
    const String display = BrandTokens.fontDisplay;
    const String body = BrandTokens.fontBody;
    return base.copyWith(
      displayLarge: _role(base.displayLarge, 'displayLarge', display),
      displayMedium: _role(base.displayMedium, 'displayMedium', display),
      displaySmall: _role(base.displaySmall, 'displaySmall', display),
      headlineLarge: _role(base.headlineLarge, 'headlineLarge', display),
      headlineMedium: _role(base.headlineMedium, 'headlineMedium', display),
      headlineSmall: _role(base.headlineSmall, 'headlineSmall', display),
      titleLarge: _role(base.titleLarge, 'titleLarge', body),
      titleMedium: _role(base.titleMedium, 'titleMedium', body),
      titleSmall: _role(base.titleSmall, 'titleSmall', body),
      bodyLarge: _role(base.bodyLarge, 'bodyLarge', body),
      bodyMedium: _role(base.bodyMedium, 'bodyMedium', body),
      bodySmall: _role(base.bodySmall, 'bodySmall', body),
      labelLarge: _role(base.labelLarge, 'labelLarge', body),
      labelMedium: _role(base.labelMedium, 'labelMedium', body),
      labelSmall: _role(base.labelSmall, 'labelSmall', body),
    );
  }
}
