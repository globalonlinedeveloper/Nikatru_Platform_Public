import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../l10n/app_localizations.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/widgets.dart';

/// Tabbed shell: hosts the branch content inside the chassis's adaptive
/// [AppScaffold], supplying Subly's floating pill bar through the
/// `compactNavigationBar` seam.
///
/// DOCKED IN P2.6a ([ADR 037]). Before this, the shell hand-rolled the whole
/// thing — a bare Scaffold with a Positioned pill at `bottom: 20` and a
/// Positioned FAB above it, with NO width decision anywhere: the exact class
/// of defect PR #210 fixed for three other screens (a phone reporting ~980
/// logical px got the same floating bar a phone gets, and a 1600px desktop
/// did too). The seam's contract (app_scaffold.dart:150-169): the app supplies
/// the COMPACT bar only; rail (medium/expanded) and drawer (large+, with the
/// kMaxBodyWidth cap) stay chassis-owned, so this bar can never render at
/// 1600px again. The five padding hacks and the dead tap-zone that
/// app_test.dart documents die with the Positioned stack.
class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  /// Test seams for the two halves of the compact nav chrome.
  ///
  /// Both are reachable ONLY through the real router (a
  /// [StatefulNavigationShell] cannot be constructed standalone), so a test has
  /// to find them inside a fully-pumped app — and by TYPE they are ambiguous:
  /// the demo-data banner is also a `Container(color:)`, i.e. a second
  /// `ColoredBox` under this same widget, and the pill's own tab tiles are
  /// nearer `DecoratedBox` ancestors than the pill is. `.first` / `.last` would
  /// resolve correctly today and silently pick the wrong widget the day either
  /// is reordered — a colour assertion that passes against the wrong box.
  ///
  /// Same reasoning `width_harness.dart`'s [inPaneOf] records for multi-pane
  /// screens: when a type finder is ambiguous, the widget says which one it is
  /// rather than the test guessing.
  static const Key navStripKey = Key('shell-nav-strip');
  static const Key navPillKey = Key('shell-nav-pill');

  /// The side of the floating "+" button this shell supplies, in logical
  /// pixels. Named rather than left as two literals on the `Container` below
  /// because [fabReservedHeight] — and through it every branch's page inset —
  /// is derived from it, and a FAB that grew while the insets did not is
  /// exactly the defect recorded below.
  static const double fabSize = 56;

  /// The band the FAB occupies above the BODY's bottom edge: its own height
  /// plus the margin `FloatingActionButtonLocation.endFloat` floats it on.
  ///
  /// `kFloatingActionButtonMargin` rather than a literal 16: the margin is
  /// Flutter's number, not ours, and copying it here would be a second copy
  /// that agrees today.
  static const double fabReservedHeight = fabSize + kFloatingActionButtonMargin;

  /// The height of the fade the shell lays over the BODY's bottom edge, in
  /// logical pixels (O-STORE-FRAME-FAB-COVERS-A-PRICE-ROW, 2026-09-22).
  ///
  /// 🔴 A LIST CUT BY A HARD EDGE READS AS A BROKEN ROW. The body ends where
  /// it ends — 72 px above the pill at compact, at the window bottom in the
  /// rail classes — and a row that straddles that line was sliced mid-card,
  /// which is what phone 01-home ("Video streaming") and 04-budget ("AI
  /// tools") showed. Cropping the frame is forbidden and snapping the scroll
  /// cannot fit both the top and the fold, so the shell GHOSTS the straddling
  /// row into the page ground instead: a gradient from transparent to the
  /// exact ground colour, its last [foldFadeSolid] px solid. "Whole" is read
  /// as "no row is cut by a hard edge"; a row that straddles the fold fades
  /// out, and the eye reads "more below".
  ///
  /// ✅ NO INSET MOVES. It is [AppSpacing.xl] because [pageInsetOf] already
  /// ends every list [AppSpacing.xl] above the body's edge (plus the band in
  /// the rail classes), so at scroll end the last row sits exactly above the
  /// fade and is never touched by it. A taller fade needs a taller inset in
  /// the same change. `test/width_shell_fab_test.dart` reads the pixels.
  static const double foldFade = AppSpacing.xl;

  /// The solid tail of [foldFade]: the device rows just above the fold that
  /// are painted in the page ground outright, so the PNG check in
  /// `tooling/store/capture-row-edge.mjs` reads ground there and nothing else.
  static const double foldFadeSolid = 3;

  /// The fade overlay, keyed so a test reads THIS box and not a guess.
  static const Key foldFadeKey = Key('shell-fold-fade');

  /// The page inset EVERY scrollable branch of this shell uses, for the
  /// window class [context] is laid out in.
  ///
  /// 🔴 THE BOTTOM IS NOT ALWAYS `AppSpacing.xl`, AND THE DIFFERENCE IS A LIVE
  /// DEFECT THIS CLOSES. Four branches carried
  /// `fromLTRB(gutterCompact, gutterCompact, gutterCompact, xl)` — a 24 px
  /// bottom — and each one says in its own comment why: the live inset was
  /// `fromLTRB(18, 58, 18, 108)` and the chassis docking argued that "108
  /// cleared `AppShell`'s floating pill bar plus its FAB … so both insets are
  /// now paid twice."
  ///
  /// HALF OF THAT IS TRUE. The PILL is `compactNavigationBar`, i.e. the
  /// `Scaffold`'s `bottomNavigationBar`, and a bottom bar does reserve its own
  /// height out of the body — so paying for it again was genuinely double.
  /// The FAB is the `Scaffold`'s `floatingActionButton`, and a floating action
  /// button reserves NOTHING: it is laid out OVER the body, at
  /// `contentBottom - kFloatingActionButtonMargin - fabSize`. So the FAB's 72 px
  /// was not double-paid, it was dropped, and with a 24 px inset the last row
  /// of every branch is drawn under the button. Measured on the store frames
  /// merged as `9f548515`: `01-home.png` shows the "+" over the "per month"
  /// line of a price row, `04-budget.png` over a category amount.
  ///
  /// ⚠️ IT LIVES HERE BECAUSE THE FAB DOES. The button belongs to the shell,
  /// not to any screen, so every tab that scrolls to its own end has the same
  /// exposure and padding the two branches that happened to be photographed
  /// would leave the class open. One number, five consumers, and
  /// `test/width_shell_fab_test.dart` measures the RECTS on every branch
  /// rather than trusting this to be adopted.
  ///
  /// ⏱ 2026-09-22 · PER WINDOW CLASS, BECAUSE AN INSET ONLY MOVES WHERE A LIST
  /// ENDS. The store photographs every tab at scroll offset 0, and at rest on a
  /// phone the "+" still floated over a row in the MIDDLE of the page — the
  /// frame #854 shipped. So at COMPACT the shell insets its BODY by the band
  /// (see `build`) and nothing is ever laid out under the button; a list there
  /// would pay the band twice if it also padded for it, so this returns the
  /// plain `AppSpacing.xl`. In the rail classes the FAB still floats over the
  /// body and the band stays in the list's padding. [fabClearanceOf] is the
  /// switch.
  static EdgeInsets pageInsetOf(BuildContext context) => EdgeInsets.fromLTRB(
    AppSpacing.gutterCompact,
    AppSpacing.gutterCompact,
    AppSpacing.gutterCompact,
    AppSpacing.xl + fabClearanceOf(context),
  );

  /// The FAB band a screen must leave free at its own bottom:
  /// [fabReservedHeight] where this shell's FAB floats over its body, zero
  /// where it does not.
  ///
  /// Zero in two places, for two reasons:
  ///   · NOT UNDER THE SHELL. `SubscriptionDetailScreen` is pushed over the
  ///     shell at `/sub/:id` (no FAB above it) and also embedded as home's
  ///     detail pane at wide widths (the FAB floats over its last row). A
  ///     constant would pay 72 px on the route that has no button.
  ///   · COMPACT. The shell has already taken the band out of the body, so a
  ///     screen that padded for it too would pay it twice.
  static double fabClearanceOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_FabBand>()?.clearance ?? 0;

  /// ⚠️ STRUCTURAL CHANGE, NAMED BECAUSE IT IS THE ONE THING IN THIS FILE A
  /// REVIEWER CANNOT SEE FROM THE DIFF ALONE: this was
  /// `static const List<_TabSpec> _tabs`, a compile-time constant carrying five
  /// English labels. A label that comes from the arb is a value of the
  /// [AppLocalizations] the surrounding [Localizations] resolved, so it cannot
  /// exist before `build`. The list is therefore built per frame.
  ///
  /// That is a real cost and it is small: five records, once per shell rebuild,
  /// on a widget that already rebuilds whenever the branch index changes. The
  /// alternative — keeping the const list and localising only at the render
  /// sites — would leave the LABELS untranslated in `destinations:`, which is
  /// what the rail, the drawer and every screen reader read from.
  ///
  /// The icons stay hardcoded on purpose: an icon is not copy.
  List<_TabSpec> _tabs(AppLocalizations l10n) => <_TabSpec>[
    _TabSpec(Icons.home_rounded, l10n.navHome),
    _TabSpec(Icons.calendar_month_rounded, l10n.navCalendar),
    _TabSpec(Icons.insights_rounded, l10n.navInsights),
    _TabSpec(Icons.account_balance_wallet_rounded, l10n.navBudget),
    _TabSpec(Icons.menu_rounded, l10n.navMore),
  ];

  @override
  Widget build(BuildContext context) {
    // The window class is read the way the chassis reads it: `AppScaffold`
    // switches on `windowClassFor(constraints.maxWidth)` of ITS constraints,
    // and it is this widget's only child, so these are the same constraints.
    // Not `MediaQuery`: a window is not always the size of the screen, and
    // the width harness pins layout without moving `MediaQuery` at all.
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) => _build(
        context,
        compact: windowClassFor(constraints.maxWidth) == WindowClass.compact,
      ),
    );
  }

  Widget _build(BuildContext context, {required bool compact}) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final List<_TabSpec> tabs = _tabs(l10n);
    final ThemeData theme = Theme.of(context);
    final bool isLight = theme.brightness == Brightness.light;
    final ColorScheme scheme = theme.colorScheme;
    return AppScaffold(
      destinations: <AppDestination>[
        for (final _TabSpec t in tabs)
          AppDestination(icon: t.icon, label: t.label),
      ],
      selectedIndex: navigationShell.currentIndex,
      onDestinationSelected: (int i) => navigationShell.goBranch(
        i,
        initialLocation: i == navigationShell.currentIndex,
      ),
      body: Stack(
        children: <Widget>[
          // 🔴 AT COMPACT THE BODY STOPS ABOVE THE "+". The FAB is laid out
          // over the body and reserves nothing, so a page inset can only clear
          // it where a list ENDS; at rest the button floated over whatever row
          // sat at that height — the store frame #854 shipped, the "+" across a
          // price. Taking the band out of the body means nothing is ever laid
          // out under the button on a phone, scrolled or not, on every branch.
          // The cost is a 72 px strip of page ground above the pill, with the
          // button sitting in it (docking the "+" into the pill is ADR 077
          // §5.3's, not this). The rail classes keep the band in each list's
          // padding, as before: a full-width strip there would take 72 px
          // from every column of a wide body, including the ones the button
          // is nowhere near (home's list pane, the 720-capped desktop pages).
          // [_FabBand] tells the screens which regime they are in, so neither
          // pays twice.
          Positioned.fill(
            child: Padding(
              padding: EdgeInsets.only(bottom: compact ? fabReservedHeight : 0),
              child: _FabBand(
                clearance: compact ? 0 : fabReservedHeight,
                child: navigationShell,
              ),
            ),
          ),
          // THE FOLD FADE ([foldFade]). Laid at the BODY's bottom edge in both
          // regimes: above the band at compact, at the window bottom in the
          // rail classes. It paints the scaffold's own ground, the colour every
          // branch draws on, so the fade ends in the page and not in a grey.
          // IgnorePointer: a row under the fade stays tappable.
          Positioned(
            left: 0,
            right: 0,
            bottom: compact ? fabReservedHeight : 0,
            height: foldFade,
            child: IgnorePointer(
              child: DecoratedBox(
                key: foldFadeKey,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: <Color>[
                      // The ground at zero alpha, not `Colors.transparent`:
                      // interpolating from transparent BLACK greys the middle.
                      theme.scaffoldBackgroundColor.withAlpha(0),
                      theme.scaffoldBackgroundColor,
                      theme.scaffoldBackgroundColor,
                    ],
                    stops: const <double>[
                      0,
                      (foldFade - foldFadeSolid) / foldFade,
                      1,
                    ],
                  ),
                ),
              ),
            ),
          ),
          // DEMO-DATA MARKER. Without a backend configured the app serves
          // SeedApiClient - Netflix, Spotify, ChatGPT Plus and friends - and until
          // 2026-07-27 that was indistinguishable from the user's own data. Paired
          // with the old "detected across your accounts" copy it read as a real
          // account scan. Seed data is fine; seed data wearing real data's clothes
          // is not. Shows ONLY when unconfigured, so production never sees it.
          // (Pinned to top: 0 — safe while AppScaffold gets no `title`; an AppBar
          // would push it down, which is noted in the P2.6a docking spec.)
          if (!AppConfig.isApiConfigured)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: SafeArea(
                bottom: false,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  color: AppColors.warn,
                  // 🔴 THE LABEL WAS WHITE, AND WHITE ON #F59E0B IS 2.15:1 —
                  // the worst contrast in the app, on a banner that spans the
                  // full width of every screen. SC 1.4.3 wants 4.5:1 for 12px
                  // w600; even the large-text floor of 3:1 was out of reach.
                  //
                  // THE INK MOVES, NOT THE AMBER. `AppColors.ink` on the same
                  // fill measures 8.50:1 — AAA — so the one-word fix is the
                  // foreground, and the warn fill stays exactly the amber the
                  // design asks for. Darkening `AppColors.warn` instead would
                  // have been the wrong lever twice over: it is painted
                  // unbranched on the DARK surfaces too (where it is already
                  // correct at 8.62:1), and it would have turned a warning
                  // stripe into a brown one to fix a foreground problem.
                  //
                  // Correct in both brightnesses without a branch, because
                  // neither colour here is brightness-dependent: the fill is a
                  // fixed literal, so the ink on it is fixed too — the same
                  // on-gradient rule `GradientButton` and the calendar
                  // today-pill follow.
                  child: Text(
                    l10n.demoDataBanner,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.ink,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      floatingActionButton: Material(
        color: Colors.transparent,
        // 🔴 THE TOOLTIP WAS DOING TWO JOBS AND ONLY HALF OF ONE OF THEM. It
        // still earns its place as the DESKTOP HOVER affordance — three of the
        // six targets are pointer-first, and a 56 px glyph with no hover text is
        // a guess there. What it was ALSO being asked to do was be this
        // control's screen-reader identity, and a tooltip is a weak substitute:
        // it lands in the `tooltip` slot rather than `label`, and it carries no
        // `isButton` flag at all, so the app's most prominent action announced
        // as an unlabelled tappable region with a hint attached.
        //
        // So the two jobs are now split, and neither is lost:
        //   · `excludeFromSemantics: true` keeps the tooltip VISUAL only;
        //   · `Semantics(button:, label:)` gives the real node — one node, with
        //     the flag a reader needs to say "button".
        // The key is unchanged and still REUSED from the sheet's own title: the
        // control and the surface it opens must not be able to drift into two
        // different words for one action.
        child: Semantics(
          button: true,
          label: l10n.addSubscriptionTitle,
          child: Tooltip(
            message: l10n.addSubscriptionTitle,
            excludeFromSemantics: true,
            child: InkWell(
              key: E2EKeys.fabAdd,
              borderRadius: BorderRadius.circular(18),
              onTap: () => showAddSubscriptionSheet(context),
              child: Container(
                width: fabSize,
                height: fabSize,
                decoration: BoxDecoration(
                  gradient: AppColors.brandGradient,
                  borderRadius: BorderRadius.circular(18),
                  boxShadow: const <BoxShadow>[
                    BoxShadow(
                      color: Color.fromRGBO(100, 89, 245, 0.6),
                      blurRadius: 24,
                      offset: Offset(0, 12),
                      spreadRadius: -8,
                    ),
                  ],
                ),
                child: const Icon(Icons.add, color: Colors.white, size: 28),
              ),
            ),
          ),
        ),
      ),
      // The floating pill, delivered through the seam: it renders ONLY in the
      // compact window class. The ColoredBox paints the reserved nav strip in the
      // page background so the pill keeps floating on the same colour it floated
      // on when it was a Positioned overlay.
      //
      // 🔴 W0's OTHER NAMED DEFERRED SIBLING, AND THE WORST-PLACED ONE OF THE
      // THREE. `cardDecoration` (17 sites) and `RowCard` (3) are each visible on
      // some screens; this strip is visible on EVERY tab of the app at every
      // compact width, and all three of its colours were light-hardcoded:
      //
      //   · the strip:  `AppColors.bg`  = 0xFFF4F4F8 — a near-white band pinned
      //                 under a dark scaffold, i.e. a bright bar across the
      //                 bottom of every dark-mode screen.
      //   · the pill:   `rgba(255,255,255,.9)` over it, with a
      //                 `rgba(255,255,255,.6)` rim — white on white on dark.
      //   · the lift:   `kCardShadow`, two BLACK alphas, which on a dark ground
      //                 paints nothing at all (the same argument
      //                 `cardDecoration` records).
      //
      // The branch follows its two siblings exactly, so the three read as one
      // decision rather than three tastes:
      //   · LIGHT IS BYTE-IDENTICAL — the same four literals, in the same
      //     places. `test/dark_group_home_test.dart` pins them AS LITERALS, so
      //     "tidying" the light branch to scheme slots goes red instead of
      //     silently repainting the one surface the owner sees on every screen.
      //   · DARK derives: the strip becomes `scheme.surface`, which is exactly
      //     what `buildAppTheme` sets `scaffoldBackgroundColor` to — so the strip
      //     disappears into the page, which is what `AppColors.bg` was doing in
      //     light and what makes the pill read as floating rather than as sitting
      //     in a tray. The pill becomes `surfaceContainerHighest` (the slot the
      //     cards and rows already use) with an `outlineVariant` rim, and the
      //     shadow is DROPPED rather than dimmed for show.
      compactNavigationBar: ColoredBox(
        key: navStripKey,
        color: isLight ? AppColors.bg : scheme.surface,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
          child: Container(
            key: navPillKey,
            height: 66,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(
              color: isLight
                  ? const Color.fromRGBO(255, 255, 255, 0.9)
                  : scheme.surfaceContainerHighest,
              borderRadius: BorderRadius.circular(22),
              boxShadow: isLight ? kCardShadow : null,
              border: Border.all(
                color: isLight
                    ? const Color.fromRGBO(255, 255, 255, 0.6)
                    : scheme.outlineVariant,
              ),
            ),
            child: Row(
              children: List<Widget>.generate(
                tabs.length,
                (int i) => _tab(context, i, tabs[i].icon, tabs[i].label),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tab(BuildContext context, int index, IconData icon, String label) {
    final ThemeData theme = Theme.of(context);
    final bool selected = navigationShell.currentIndex == index;
    // The SELECTED colour stays `AppColors.accent` in both brightnesses: it is
    // the brand mark, it is what tells the user which tab they are on, and it
    // reads on both grounds. The UNSELECTED one cannot stay: `AppColors.muted`
    // is 0xFF73737F, a mid-grey chosen against white — on the dark pill it is
    // barely separable from the fill, so four of the five tabs would be labels
    // you have to hunt for. `onSurfaceVariant` is the scheme's own answer to
    // "secondary text on this surface".
    final Color color = selected
        ? AppColors.accent
        : (theme.brightness == Brightness.light
              ? AppColors.muted
              : theme.colorScheme.onSurfaceVariant);
    // 🔴 THE CHASSIS ALREADY SOLVES THIS AT EVERY OTHER WIDTH, AND CANNOT HERE.
    // `AppScaffold` is handed the `destinations:` list above, and in the medium,
    // large and extra-large classes it renders that list through Material's own
    // `NavigationRail` / `NavigationDrawer`, which supply the label, the
    // selected state and the tab role themselves — nothing in this file should
    // duplicate that, and nothing does. But COMPACT is exactly the class Subly
    // overrides, through the `compactNavigationBar` seam: the stock
    // `NavigationBar` is never built, this hand-rolled pill is, and the
    // destination semantics go with the widget that was replaced. So on a phone
    // — the one window class where this bar is the ONLY navigation — five tabs
    // announced as text with no role and, worse, no indication of WHICH ONE YOU
    // ARE ON. `selected:` is the half that carries that.
    //
    // ⏱ 2026-09-16 · [ADR 083]: medium, large and extra-large all render the
    // `NavigationRail` now; no class renders the `NavigationDrawer`.
    //
    // No `label:`: the tab's own `Text` is right there and `MergeSemantics`
    // folds it in, so restating it in Dart would announce the name twice and
    // give the arb key a second, drift-prone consumer.
    return Expanded(
      child: MergeSemantics(
        child: Semantics(
          button: true,
          selected: selected,
          child: InkWell(
            borderRadius: BorderRadius.circular(15),
            onTap: () => navigationShell.goBranch(
              index,
              initialLocation: index == navigationShell.currentIndex,
            ),
            child: Container(
              padding: const EdgeInsets.symmetric(vertical: 8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(15),
                // 🔴 0.05, NOT 0.10 — THE WASH WAS DARKENING THE GROUND UNDER
                // ITS OWN LABEL. `AppColors.accent` clears AA on every SOLID
                // light ground this app paints (4.90:1 on a white card, 4.67:1
                // on the live scaffold #FCF8FF), so the brand token is not the
                // defect. But composited at 10% over the pill's white@0.9 fill
                // this tint resolves to #F0EEFE, and the 9px w700 tab label on
                // it measures 4.28:1 — under SC 1.4.3's 4.5:1 for normal-size
                // text, and this label is the only thing naming the
                // destination. At 0.05 the ground is #F7F6FF and the label
                // measures 4.57:1.
                //
                // Halving a decorative tint rather than darkening
                // `AppColors.accent`: the accent is the brand mark and moving
                // it would repaint every gradient, hero, ring and FAB in the
                // app to fix one 9px label. The selected state survives the
                // lighter wash — it is also carried by the label/icon COLOUR
                // (accent vs muted) and by `Semantics(selected: true)` above,
                // so the tint is the fourth cue, not the only one.
                color: selected
                    ? const Color.fromRGBO(100, 89, 245, 0.05)
                    : Colors.transparent,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(icon, color: color, size: 22),
                  const SizedBox(height: 3),
                  Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontWeight: FontWeight.w700,
                      fontSize: 9,
                      color: color,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TabSpec {
  const _TabSpec(this.icon, this.label);
  final IconData icon;
  final String label;
}

/// How much of the FAB band the screens under this shell must still leave
/// free at their own bottom: the whole band in the rail classes, zero at
/// compact (the body is already inset). Read through
/// [AppShell.fabClearanceOf]; absent — so zero — on a route pushed above the
/// shell.
class _FabBand extends InheritedWidget {
  const _FabBand({required this.clearance, required super.child});

  final double clearance;

  @override
  bool updateShouldNotify(_FabBand oldWidget) =>
      clearance != oldWidget.clearance;
}
