import 'package:flutter/widgets.dart';

// `AppBreakpoints` is shown for the doc references below — the page gutter and
// the body cap are two halves of one decision and should link to each other.
import '../widgets/app_scaffold.dart' show AppBreakpoints, WindowClass;

/// Spacing scale (4-pt base grid) shared across NIKATRU apps.
class AppSpacing {
  AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;

  // ── PAGE GUTTERS ───────────────────────────────────────────────────────────
  //
  // Deliberately NOT drawn from the [xs]…[xxxl] steps above. Those are the
  // rhythm BETWEEN elements inside a page; these are the frame AROUND it. They
  // are two different decisions that happen to be measured in the same unit,
  // and spending `lg` on both would mean that tightening the gap between two
  // buttons also moves every page's left edge — a coupling nobody asked for and
  // nothing would catch. 18 is not on the 4-pt grid for exactly that reason:
  // it is not a step, it is a margin.

  /// Compact and medium windows — a phone, a split pane, a small tablet.
  static const double gutterCompact = 18;

  /// Expanded windows (840–1199). The extra width is worth spending on air
  /// before it is worth spending on line length.
  static const double gutterExpanded = 24;

  /// Large and extra-large windows (1200+), where the body is already capped at
  /// [AppBreakpoints.kMaxBodyWidth] and the gutter is what keeps the cap from
  /// looking like a crop.
  static const double gutterLarge = 32;

  /// The page inset for a window class — one decision, inherited, instead of a
  /// hand-picked `EdgeInsets.all(…)` per screen.
  ///
  /// 🔴 THE BOTTOM INSET IS ZERO WHENEVER THE NAVIGATION IS A RAIL OR DRAWER,
  /// and that asymmetry is the substance of this function rather than a
  /// rounding error. In the compact class the body sits directly on top of a
  /// bottom [NavigationBar]; without an inset the last row of content touches
  /// the bar and reads as part of it. From `medium` upward the navigation moves
  /// to the SIDE, so the bottom edge of the body is the bottom edge of the
  /// window — and a fixed inset there is subtracted from the scrollable extent
  /// of whatever the page put inside, producing a dead stripe under the last
  /// item that looks exactly like "the list ended". A scrolling body knows how
  /// much room its own last item needs; the chassis does not, so at those
  /// widths it hands the bottom edge back.
  ///
  /// Per class — the table is the contract, so a change here is visible in a
  /// diff rather than distributed across screens:
  ///
  /// | class      | left/right | top | bottom |
  /// |------------|-----------:|----:|-------:|
  /// | compact    |         18 |  18 |     18 |
  /// | medium     |         18 |  18 |      0 |
  /// | expanded   |         24 |  18 |      0 |
  /// | large      |         32 |  24 |      0 |
  /// | extraLarge |         32 |  24 |      0 |
  ///
  /// The top inset grows a step later than the sides because vertical space is
  /// the scarce one: a wider window is usually not a taller window.
  static EdgeInsets pagePadding(WindowClass windowClass) {
    switch (windowClass) {
      case WindowClass.compact:
        return const EdgeInsets.all(gutterCompact);
      case WindowClass.medium:
        return const EdgeInsets.fromLTRB(
          gutterCompact,
          gutterCompact,
          gutterCompact,
          0,
        );
      case WindowClass.expanded:
        return const EdgeInsets.fromLTRB(
          gutterExpanded,
          gutterCompact,
          gutterExpanded,
          0,
        );
      case WindowClass.large:
      case WindowClass.extraLarge:
        return const EdgeInsets.fromLTRB(
          gutterLarge,
          gutterExpanded,
          gutterLarge,
          0,
        );
    }
  }
}

/// Corner-radius scale.
class AppRadius {
  AppRadius._();

  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 22;
  static const double pill = 999;
}
