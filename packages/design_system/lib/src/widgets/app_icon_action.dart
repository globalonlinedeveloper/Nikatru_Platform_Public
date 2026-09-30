import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'focusable_tap.dart';

/// The chassis ICON ACTION — an icon-only control in a page's own chrome:
/// the back arrow of a pushed detail page, the close of a full-screen sheet,
/// a "more options" (train ST-D5).
///
/// ## What it fixes by construction
///  * **Named, focusable, one Tab stop.** It is a [FocusableTap], so it has a
///    `FocusNode`, answers Enter and Space, paints a focus ring, and announces
///    [label] as a BUTTON. The two hand-rolled versions this replaces were
///    `Semantics(button: true)` over a bare `GestureDetector` — a role for a
///    screen reader and nothing for a keyboard — on the notifications close,
///    and a white-on-gradient `FocusableTap` on the detail hero whose colours
///    were literals that only worked on that one gradient.
///  * **48 × 48 whatever the platform density.** [size] is the tap-target
///    floor, stated here rather than inherited from a density that is compact
///    on the desktop three.
///  * **Its colours are the scheme's, in both schemes.** An opaque
///    `surfaceContainerHighest` well with an `outlineVariant` hairline and an
///    `onSurface` glyph, so it reads on the scaffold, on a card and on a
///    `surfaceContainer` header band alike, with no brightness fork.
///
/// [label] is the app's string, already localised: it is the control's whole
/// name, because an icon has no text to merge.
class AppIconAction extends StatelessWidget {
  const AppIconAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
  });

  /// The glyph.
  final IconData icon;

  /// What a screen reader announces, and the control's only name.
  final String label;

  /// What activating it does.
  final VoidCallback onPressed;

  /// The control's side: the WCAG 2.2 / Material 48 px target floor.
  static const double size = AppSpacing.xxxl;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    final BorderRadius corner = BorderRadius.circular(AppRadius.control);
    return FocusableTap(
      onTap: onPressed,
      label: label,
      mergeDescendants: false,
      borderRadius: corner,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: scheme.surfaceContainerHighest,
          borderRadius: corner,
          border: Border.all(color: scheme.outlineVariant),
        ),
        child: Icon(icon, color: scheme.onSurface),
      ),
    );
  }
}
