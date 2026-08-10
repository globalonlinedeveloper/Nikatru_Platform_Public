// `AppBreakpoints` is shown for the doc references below — the page gutter and
// the body cap are two halves of one decision and should link to each other.
import '../widgets/app_scaffold.dart' show AppBreakpoints;

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

  // 🪦 `pagePadding(WindowClass)` LIVED HERE AND WAS DELETED 2026-08-11, NOT
  // MOVED. It shipped with #207 beside `ContentPane` and the
  // `compactNavigationBar` seam, and unlike those two it never acquired a
  // production call site: at deletion it was reachable only from its own unit
  // test, which is apparent coverage over a function nothing calls.
  //
  // 🔑 IT WAS NOT DELETED FOR BEING UNUSED — IT WAS DELETED BECAUSE NOTHING
  // HANDS A SCREEN ITS PARAMETER, AND THE OBVIOUS RE-DERIVATION IS SILENTLY
  // WRONG. `windowClassFor` has exactly ONE production call site
  // (`app_scaffold.dart:178`, inside [AppScaffold]'s own `LayoutBuilder`) and
  // the class it resolves is never passed down; every other reference in the
  // tree is a test. A screen that re-derived it from ITS OWN constraints — a
  // `LayoutBuilder` inside the pane, which is the natural way to reach for it —
  // gets the WRONG answer with no error, because every page here sits inside a
  // `ContentPane` capped at `kMaxBodyWidth`: on a 1920 window the pane hands
  // down 1280, which resolves to `large`, and the page would take a 32px gutter
  // and a ZERO bottom inset while a bottom navigation bar was still under it.
  //
  // ⚠️ THE FUNCTION IS NOT UNREACHABLE, and saying so would be a fresh false
  // claim in a permanent tombstone. It is a public top-level function whose own
  // doc says "Public and pure on purpose", `app_scaffold.dart` is exported from
  // the barrel, and apps/subly's tests already call it through that barrel — so
  // any screen CAN write `windowClassFor(MediaQuery.sizeOf(context).width)` and
  // get the correct class, because MediaQuery reports the WINDOW rather than the
  // pane's constraints. That route is available; nothing takes it, and no
  // deleted function is what stops the next screen from taking it.
  //
  // What the pages actually hand-roll is ONE fixed inset, not a per-class table
  // — `fromLTRB(gutterCompact, gutterCompact, gutterCompact, xl)` in home,
  // calendar, insights and budget — and its bottom is 24, not the 18 this
  // function returned for `compact`. Substituting it would have been a visible
  // repaint dressed as a refactor.
  //
  // ⚠️ THIS ORPHANS [gutterExpanded] AND [gutterLarge], measured rather than
  // assumed: `pagePadding` was their only reader, so both now have ZERO
  // consumers, against five for [gutterCompact]. They are kept anyway, and the
  // reason is not sentiment — `sm`, `md`, `xxl` and `xxxl` have zero consumers
  // too, because a spacing SCALE is a declared ladder that screens pick rungs
  // from, and an unused rung costs nothing and forecloses nothing. The function
  // was different in kind: a constant is one any caller can use, this was one no
  // caller could call correctly.
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
