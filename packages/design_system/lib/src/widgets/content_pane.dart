import 'package:flutter/material.dart';

// `AppScaffold` is shown for the doc reference below: this widget's default cap
// is the same one the scaffold applies to the extra-large window class, and the
// two must be readable as one decision.
import 'app_scaffold.dart' show AppBreakpoints, AppScaffold;

/// Caps how wide a piece of content may grow, and pins it to the TOP of the
/// space it was given.
///
/// ## What it replaces
/// `Center(child: ConstrainedBox(constraints: BoxConstraints(maxWidth: 420), …))`
/// — hand-written six times across this repo before this widget existed, with
/// the number copied each time. Six copies of a decision are six decisions; the
/// moment one of them is right and the others are stale, nothing goes red.
/// The widths themselves live on [AppBreakpoints] ([AppBreakpoints.form],
/// [AppBreakpoints.pane], [AppBreakpoints.reading]) so the constant and the
/// widget cannot drift apart either.
///
/// ## 🔴 WHY topCenter AND NOT [Center]
/// [Center] aligns on BOTH axes, and the vertical half is the one that bites.
/// A page shorter than its viewport gets pushed to the middle of the screen —
/// which looks deliberate on a static screen and is a defect on every other
/// kind:
///
///  * **A body whose height changes re-centres, so it MOVES.** A form that
///    grows by one error message shifts every field upward by half that error's
///    height — under the user's finger, at the exact moment they mistyped.
///  * **A [ListView] jumps.** Its extent changes as items load, as a paywall
///    switches phase, as an empty state becomes a list; each change re-centres
///    the whole scroller. The user sees the content slide for reasons they did
///    not cause.
///  * **The first line stops being where the eye already is.** Reading starts at
///    the top. A short page that begins halfway down asks the reader to find it.
///
/// Vertical centring is a real choice for one shape only — a short blocking
/// card (an update wall, a consent scrim) that is *meant* to sit in the middle
/// of an otherwise dead screen. Those keep an explicit [Center] and take their
/// width from [AppBreakpoints] directly. Everything that behaves like a PAGE
/// uses this widget. Choosing per site is the point; [ContentPane] just makes
/// the common answer the short one.
///
/// ## Layout
/// `Align(topCenter) → ConstrainedBox(maxWidth) → optional Padding → child`.
/// The padding is INSIDE the cap, matching what the replaced call sites did:
/// [maxWidth] is the width of the padded box, not of the text inside it.
///
/// Under a viewport narrower than [maxWidth] the cap does nothing at all —
/// `ConstrainedBox` may only tighten within the constraints it is handed — so a
/// phone renders exactly as it did before.
///
/// In an unbounded-height parent (inside a `SingleChildScrollView`, a `Column`,
/// a sliver) the [Align] shrink-wraps to the child's height, so this is safe to
/// drop into a scroll view without it swallowing the scroll extent.
class ContentPane extends StatelessWidget {
  /// A pane capped at [AppBreakpoints.kMaxBodyWidth] — the same ceiling
  /// [AppScaffold] applies to the extra-large window class. Use this when the
  /// content genuinely is the page.
  const ContentPane({
    super.key,
    required this.child,
    this.maxWidth = AppBreakpoints.kMaxBodyWidth,
    this.padding,
  });

  /// A single-column form or short card — [AppBreakpoints.form] (420).
  const ContentPane.form({
    super.key,
    required this.child,
    this.padding,
  }) : maxWidth = AppBreakpoints.form;

  /// A card or side panel — [AppBreakpoints.pane] (480).
  const ContentPane.pane({
    super.key,
    required this.child,
    this.padding,
  }) : maxWidth = AppBreakpoints.pane;

  /// Continuous prose — [AppBreakpoints.reading] (720).
  const ContentPane.reading({
    super.key,
    required this.child,
    this.padding,
  }) : maxWidth = AppBreakpoints.reading;

  /// The content being capped.
  final Widget child;

  /// The widest this pane may become. Defaults to
  /// [AppBreakpoints.kMaxBodyWidth]; the named constructors set it to one of
  /// the content widths.
  final double maxWidth;

  /// Optional inset, applied INSIDE [maxWidth] (see the class doc).
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    final EdgeInsetsGeometry? inset = padding;
    return Align(
      // topCenter, never Alignment.center — see the class doc.
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: inset == null ? child : Padding(padding: inset, child: child),
      ),
    );
  }
}
