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
          Positioned.fill(child: navigationShell),
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
                  child: Text(
                    l10n.demoDataBanner,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
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
        // Tooltip is what a screen reader announces for this icon-only FAB —
        // the same mechanism IconButton uses internally. It REUSES the sheet's
        // own title key: the control and the surface it opens must not be able
        // to drift into two different words for one action.
        child: Tooltip(
          message: l10n.addSubscriptionTitle,
          child: InkWell(
            key: E2EKeys.fabAdd,
            borderRadius: BorderRadius.circular(18),
            onTap: () => showAddSubscriptionSheet(context),
            child: Container(
              width: 56,
              height: 56,
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
    return Expanded(
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
            color: selected
                ? const Color.fromRGBO(100, 89, 245, 0.1)
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
    );
  }
}

class _TabSpec {
  const _TabSpec(this.icon, this.label);
  final IconData icon;
  final String label;
}
