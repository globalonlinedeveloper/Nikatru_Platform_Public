import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';

/// Button styles the Material theme cannot express as a default, because a
/// screen chooses them per button (train ST-D5).
class AppButtonStyles {
  AppButtonStyles._();

  /// The DESTRUCTIVE button: "Cancel plan", "Delete", "Remove".
  ///
  /// 🔴 TONAL, NOT A SOLID DANGER FILL. A solid fill needs an ink that clears
  /// 4.5:1 on BOTH danger tones, and the pair forks precisely because no one
  /// colour does: the light tone takes white ink, the dark tone
  /// (`BrandTokensDark.danger`, a light pink) takes near-black. The OPAQUE
  /// danger tint with the danger tone as ink is the pair
  /// `test/status_contrast_test.dart` already measures in both schemes, so
  /// this style inherits a measured number instead of adding an unmeasured
  /// one. The app's hand-rolled button painted `AppColors.danger` with the
  /// theme's white ink in both schemes.
  ///
  /// The corner is [AppRadius.control]; the height is the theme's standard
  /// density, 48 on every platform.
  static ButtonStyle destructive(BuildContext context) {
    final StatusTones tones = StatusTones.of(context);
    return FilledButton.styleFrom(
      backgroundColor: tones.dangerTint,
      foregroundColor: tones.danger,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
      ),
    );
  }
}
