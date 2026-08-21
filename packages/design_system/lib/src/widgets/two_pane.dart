import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// The MASTER-DETAIL primitive: a list, and beside it the thing the list is
/// about — but only once there is width to hold both.
///
/// ## What it replaces
/// A full-screen push. Home, Calendar, Insights and Budget are all
/// list-plus-detail shapes, and every one of them opens its detail by pushing a
/// route over the list. On a phone that is exactly right. On a 1440 px window it
/// is two defects at once: the list occupies a 720 px column with the rest of
/// the window empty, and opening an item THROWS THE LIST AWAY — the user loses
/// their place, their scroll position and the comparison they were making, to
/// look at something that would have fitted beside it.
///
/// [TwoPane] is the smallest widget that fixes both without any screen having to
/// re-derive the widths.
///
/// ## 🔴 IT MEASURES THE SPACE IT WAS GIVEN, NOT THE WINDOW
/// The split is decided from `LayoutBuilder`'s `maxWidth` — the width of the box
/// this widget occupies — and NOT from `MediaQuery`. The two are different
/// numbers inside the chassis, and using the wrong one puts a two-column layout
/// into a one-column space:
///
///  * `AppScaffold` hands its body `min(W - 361, 1280)` in the drawer classes
///    (measured 2026-08-21) — a 360 px drawer and its 1 px divider take width
///    first. A window of 1200 leaves the body 839, one pixel short of a split.
///  * In the rail classes the rail likewise takes its width before the body
///    does. How much is a Flutter internal and is NOT sourced here, so this doc
///    does not name it — only that the body is narrower than the window.
///
/// So a window at exactly 840 does NOT produce a two-pane body: the body is
/// narrower than that, and it is the body that has to hold two columns. That is
/// the honest reading, and it composes — a [TwoPane] nested inside a narrow pane
/// behaves like a narrow pane, with no special case.
///
/// ## The split, and where every number in it comes from
/// 🔴 Not one of these widths is new. All three are [AppBreakpoints] constants
/// that already carry their own reasoning, which is the point: a fourth number
/// invented here would be a fourth private decision that happens to agree with
/// the other three today.
///
///  1. The DETAIL is served first, capped at [AppBreakpoints.reading] (720) —
///     the line-length cap. Uncapped, a 1280 px body would hand the detail ~860
///     px of paragraph, which is the unreadable case [AppBreakpoints.reading]
///     exists to prevent. It is served first because it is the pane whose
///     content has a natural maximum; the list does not.
///  2. The LIST is floored at [AppBreakpoints.form] (420) — the detail may never
///     take width that would push the list below it. 420 is the single-column
///     width this repo converged on six times over, so at the boundary the list
///     is no narrower than a large phone.
///  3. The LIST is then capped at [AppBreakpoints.pane] (480) — a list row is a
///     label and a figure; past 480 the two drift apart and the row stops
///     reading as a pair. Leftover width goes to neither pane.
///
/// Worked, and pinned in `two_pane_test.dart` so the arithmetic cannot drift
/// from the prose:
///
/// | available | list | divider | detail | total               |
/// |-----------|------|---------|--------|---------------------|
/// | 839       | 839  |  —      |   —    | 839 (single column) |
/// | 840       | 420  |  1      |  419   | 840                 |
/// | 1141      | 420  |  1      |  720   | 1141                |
/// | 1280      | 480  |  1      |  720   | 1201                |
/// | 1400      | 480  |  1      |  720   | 1201                |
///
/// Past 1201 the pair stops growing and the leftover is SPLIT, not donated to
/// one side — the same correction `AppScaffold` took on 2026-08-21, where
/// pinning a capped body left produced 279 px of dead gutter on the right at
/// 1920. Inside the chassis the body is itself capped at
/// [AppBreakpoints.kMaxBodyWidth] (1280), so the leftover is at most 79 px there.
///
/// ## What it does NOT own
/// **Selection state and routing.** [TwoPane] takes a [detail] and renders it;
/// it never decides which item is selected, and it never pushes or pops. That
/// belongs to the screen and the router respectively, because both outlive the
/// layout — a deep link selects an item before this widget has been laid out
/// once.
///
/// But the screen still has to make one decision that depends on the layout: a
/// tap on a list row must PUSH a detail route in single-column mode and merely
/// SET selection in two-pane mode. If the screen re-derives that from
/// `MediaQuery`, it is deciding from the window width while this widget decided
/// from the pane width, and at the boundary the two disagree — you get a pushed
/// route ON TOP of a rendered detail pane. So the decision is published rather
/// than re-derivable: call [TwoPane.isTwoPaneOf] from anywhere inside [list] and
/// you read the decision this widget actually made, not a second one.
///
/// ## The breakpoint is deliberately NOT a parameter
/// Four screens each passing their own would be four private breakpoints, which
/// is the exact failure [AppBreakpoints] was created to end. The seam that IS
/// open is [placeholder] — the part that is genuinely per-screen, because only
/// the screen knows what "nothing selected" means and in which language to say
/// it.
class TwoPane extends StatelessWidget {
  const TwoPane({
    super.key,
    required this.list,
    required this.detail,
    required this.placeholder,
  });

  /// The master column. Below the breakpoint this is the ENTIRE widget, so it
  /// must be a complete screen body on its own — which is what it already is
  /// today.
  final Widget list;

  /// The selected item's detail, or null when nothing is selected.
  ///
  /// 🔴 Below [AppBreakpoints.expanded] this is NOT BUILT AT ALL, even when
  /// non-null. Single column means the detail is a pushed route, and building it
  /// off-screen would run its initState, its fetches and its analytics twice.
  final Widget? detail;

  /// Shown in the detail column when [detail] is null.
  ///
  /// Required, and that is the design: a two-pane screen with nothing selected
  /// is a state a user WILL see — it is the first thing they see on every cold
  /// start — so it cannot be something a screen forgets to supply. Pass
  /// [TwoPanePlaceholder] for the house treatment, or any widget for a richer
  /// empty state (an illustration, a "create your first one" action).
  ///
  /// Never rendered in single-column mode: there is no detail column to be
  /// empty.
  final Widget placeholder;

  /// True when [context] sits inside a [TwoPane] that is currently showing both
  /// columns.
  ///
  /// Use this — not `MediaQuery` — to choose between pushing a detail route and
  /// setting selection state. It reports the decision [TwoPane] made from the
  /// width IT was given, so the screen and the layout cannot disagree at the
  /// boundary (see the class doc).
  ///
  /// False when there is no [TwoPane] ancestor. That is not a silent default: a
  /// list rendered outside a [TwoPane] IS single-column, and pushing is the
  /// correct behaviour there.
  ///
  /// This is a dependency — a widget that calls it rebuilds when the pane
  /// crosses the breakpoint, so a screen cannot be left holding a stale answer
  /// after a window resize.
  static bool isTwoPaneOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_TwoPaneScope>()?.isTwoPane ??
      false;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final TwoPaneSplit? split = TwoPaneSplit.forWidth(constraints.maxWidth);

        // Single column. Not "the two-pane layout with one pane hidden" — the
        // list is returned UNWRAPPED, so a phone renders precisely the tree it
        // rendered before this widget existed. The scope still wraps it, because
        // `isTwoPaneOf` must answer `false` here rather than "no ancestor".
        if (split == null) {
          return _TwoPaneScope(isTwoPane: false, child: list);
        }

        return _TwoPaneScope(
          isTwoPane: true,
          child: Row(
            // Centred, so leftover width past the caps is split rather than
            // donated to one edge — see the class doc.
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              SizedBox(width: split.listWidth, child: list),
              // The same divider, at the same thickness, that `AppScaffold` puts
              // between the rail and the body — so the seam inside a screen and
              // the seam around it read as one system. Its width is
              // [TwoPaneSplit.dividerWidth], the same constant the arithmetic
              // subtracted, so the drawn gap and the reserved gap cannot drift.
              const VerticalDivider(
                width: TwoPaneSplit.dividerWidth,
                thickness: 1,
              ),
              SizedBox(
                width: split.detailWidth,
                child: detail ?? placeholder,
              ),
            ],
          ),
        );
      },
    );
  }
}

/// The resolved column widths for one available width — or null when there is
/// not enough width for two columns at all.
///
/// Public and pure on purpose, exactly as `windowClassFor` is: it makes the
/// split independently testable AT ITS EDGES without pumping a widget at five
/// sizes, and the boundary is where an off-by-one in a master-detail layout
/// actually lives.
@immutable
class TwoPaneSplit {
  const TwoPaneSplit._({required this.listWidth, required this.detailWidth});

  /// Width of the master column.
  final double listWidth;

  /// Width of the detail column. Never exceeds [AppBreakpoints.reading].
  final double detailWidth;

  /// The rule between the two columns. 1 logical pixel, matching the
  /// `VerticalDivider` `AppScaffold` draws beside its rail and drawer.
  ///
  /// A named constant rather than a literal because it is subtracted in one
  /// place and drawn in another; a literal in each is two numbers that agree
  /// until someone changes one.
  static const double dividerWidth = 1;

  /// The widest the two columns and their divider ever become together —
  /// [AppBreakpoints.pane] + [dividerWidth] + [AppBreakpoints.reading] = 1201.
  /// Any available width beyond this is leftover, split between the two outer
  /// edges.
  static const double maxTotalWidth =
      AppBreakpoints.pane + dividerWidth + AppBreakpoints.reading;

  /// Resolve [width] to a split, or null if it is below
  /// [AppBreakpoints.expanded].
  ///
  /// 🔴 NULL IS THE ANSWER, not a failure. "There is no split at this width" is
  /// a real state of this layout, and returning it as null means a caller cannot
  /// accidentally lay out two columns using widths computed for one — there are
  /// no widths to misuse.
  ///
  /// An INFINITE [width] (an unbounded-width parent, e.g. inside a horizontal
  /// scroller) resolves to both caps, so the row sizes to [maxTotalWidth]
  /// rather than throwing.
  static TwoPaneSplit? forWidth(double width) {
    if (width < AppBreakpoints.expanded) return null;

    // Order matters, and it is the whole design. The detail is served first up
    // to the reading cap, but never out of the list's floor; whatever the detail
    // does not take, the list takes, up to its own cap.
    final double detailWidth = math.min(
      width - AppBreakpoints.form - dividerWidth,
      AppBreakpoints.reading,
    );
    final double listWidth = math.min(
      width - dividerWidth - detailWidth,
      AppBreakpoints.pane,
    );
    return TwoPaneSplit._(listWidth: listWidth, detailWidth: detailWidth);
  }

  @override
  bool operator ==(Object other) =>
      other is TwoPaneSplit &&
      other.listWidth == listWidth &&
      other.detailWidth == detailWidth;

  @override
  int get hashCode => Object.hash(listWidth, detailWidth);

  @override
  String toString() => 'TwoPaneSplit(list: $listWidth, detail: $detailWidth)';
}

/// The house "nothing selected yet" state for [TwoPane.placeholder].
///
/// Takes its copy as a parameter for the same reason every screen in
/// `system_screens.dart` does: this package has no l10n dependency and must not
/// grow one. The app supplies the sentence; the design system supplies the
/// treatment, so four screens do not each invent a different-looking empty
/// column.
class TwoPanePlaceholder extends StatelessWidget {
  const TwoPanePlaceholder({
    super.key,
    required this.message,
    this.icon = Icons.chevron_left,
  });

  /// e.g. "Select a subscription to see its details". The app's string, already
  /// localised.
  final String message;

  /// Points back at the list by default, because the answer to "what do I do
  /// here?" is always to the left of this column.
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Center(
      // 🔴 `Center`, and this is the one shape ContentPane's doc names as the
      // real exception to its topCenter rule: a short message alone in an
      // otherwise dead column, which is MEANT to sit in the middle. None of the
      // three reasons that make vertical centring a defect apply — this content
      // has a fixed height, it never grows under the user's finger, and it is
      // not where reading starts.
      child: ConstrainedBox(
        // The same single-column width a form gets. A one-line prompt stretched
        // across 720 px of empty pane reads as a mistake.
        constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
        child: Padding(
          // The same inset the two system screens use around their centred
          // column. Not a fresh number: an empty state that sat at a different
          // distance from its edges than `AppErrorScreen` does would be a third
          // opinion about page inset in a package that already has one.
          padding: const EdgeInsets.all(AppSpacing.xl), // 24
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                icon,
                // 48, the size `AppErrorScreen` uses — the only other
                // full-column "here is the situation" state in this package.
                //
                // A LITERAL, deliberately, and NOT `AppSpacing.xxxl` even
                // though that also reads 48. Spacing is the rhythm BETWEEN
                // elements; this is the size OF one. Spending the same constant
                // on both means a future tightening of the 48 pt spacing step
                // silently shrinks this icon — the exact coupling `AppSpacing`
                // refuses when it keeps its page gutters off the 4-pt scale.
                size: 48,
                // onSurfaceVariant, the secondary slot — the same one
                // `AppText.resolve` maps `muted` to in dark. A placeholder
                // painted at full contrast would compete with the list for
                // attention while saying nothing.
                color: theme.colorScheme.onSurfaceVariant,
              ),
              const SizedBox(height: AppSpacing.md), // 12
              Text(
                message,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Publishes [TwoPane]'s own layout decision to its subtree.
///
/// Inherited rather than recomputed: one measurement, one decision, read by
/// everyone below it. See [TwoPane.isTwoPaneOf].
class _TwoPaneScope extends InheritedWidget {
  const _TwoPaneScope({required this.isTwoPane, required super.child});

  final bool isTwoPane;

  @override
  bool updateShouldNotify(_TwoPaneScope oldWidget) =>
      oldWidget.isTwoPane != isTwoPane;
}
