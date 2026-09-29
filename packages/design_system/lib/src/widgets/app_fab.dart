import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_scaffold.dart';

/// The chassis FLOATING ACTION BUTTON — the screen's one primary action
/// (train ST-D0).
///
/// ## What it decides so the app does not
///  * **Its shape per window class.** An icon-only 56 px button at COMPACT,
///    where width is scarce and the bar is right below it; the EXTENDED form
///    (icon + label) from MEDIUM up, where the label costs nothing and an
///    unlabelled glyph on a desktop window is a guess. The class is read from
///    the WINDOW (`MediaQuery`), the route `app_spacing.dart` records as the
///    correct one: the button floats over the whole scaffold, not inside a
///    pane. [extended] overrides it for a screen that knows better.
///  * **Its accessible name.** The shell's hand-rolled "+" recorded the defect
///    this closes: a `Tooltip` put the name in the `tooltip` slot and left the
///    control announced as an unlabelled tappable region. Here the [label] is
///    the node's LABEL, merged with the button's own flag and tap action into
///    one node, and the tooltip stays a visual hover affordance only.
///  * **Its corner.** [AppRadius.fab], the same family of shape as the cards it
///    floats over.
///
/// Colours are Material's FAB defaults (`primaryContainer` /
/// `onPrimaryContainer`), a pair the seeded scheme derives for contrast, so
/// every stamped app's button is its own brand without a literal here.
///
/// [label] is the app's string, already localised: this package carries no
/// copy.
class AppFab extends StatelessWidget {
  const AppFab({
    super.key,
    required this.icon,
    required this.label,
    required this.onPressed,
    this.extended,
  });

  /// The action's glyph.
  final IconData icon;

  /// The action's name: announced always, shown in the extended form.
  final String label;

  /// What the button does.
  final VoidCallback onPressed;

  /// Force the extended (true) or icon-only (false) form. Null — the
  /// default — lets the window class decide.
  final bool? extended;

  /// True when the window [width] gets the extended form by default.
  ///
  /// Public and pure, like `windowClassFor`, so the rule is testable at its
  /// edge without pumping a button at two sizes.
  static bool extendsAt(double width) =>
      windowClassFor(width) != WindowClass.compact;

  static const ShapeBorder _shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.all(Radius.circular(AppRadius.fab)),
  );

  @override
  Widget build(BuildContext context) {
    final bool wide = extended ?? extendsAt(MediaQuery.sizeOf(context).width);
    final Widget button = wide
        ? FloatingActionButton.extended(
            onPressed: onPressed,
            shape: _shape,
            icon: Icon(icon),
            // The visible label IS the name; merged below, so it is announced
            // once.
            label: Text(label),
          )
        : FloatingActionButton(
            onPressed: onPressed,
            shape: _shape,
            child: Icon(icon),
          );
    return MergeSemantics(
      child: Semantics(
        // Icon-only: the label has no visible Text to come from, so it is
        // stated. Extended: the Text is right there and stating it again would
        // announce the name twice.
        label: wide ? null : label,
        child: Tooltip(
          message: label,
          excludeFromSemantics: true,
          child: button,
        ),
      ),
    );
  }
}
