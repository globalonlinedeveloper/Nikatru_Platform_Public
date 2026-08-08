import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/app_config.dart';
import '../../core/e2e_keys.dart';
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

  static const List<_TabSpec> _tabs = <_TabSpec>[
    _TabSpec(Icons.home_rounded, 'Home'),
    _TabSpec(Icons.calendar_month_rounded, 'Calendar'),
    _TabSpec(Icons.insights_rounded, 'Insights'),
    _TabSpec(Icons.account_balance_wallet_rounded, 'Budget'),
    _TabSpec(Icons.menu_rounded, 'More'),
  ];

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      destinations: <AppDestination>[
        for (final _TabSpec t in _tabs)
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
                  child: const Text(
                    'Demo data - sample subscriptions, not your account',
                    textAlign: TextAlign.center,
                    style: TextStyle(
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
        // the same mechanism IconButton uses internally.
        child: Tooltip(
          message: 'Add subscription',
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
      // The floating pill, unchanged in look, now delivered through the seam:
      // it renders ONLY in the compact window class. The ColoredBox paints the
      // reserved nav strip in Subly's background so the pill keeps floating on
      // the same colour it floated on when it was a Positioned overlay.
      compactNavigationBar: ColoredBox(
        color: AppColors.bg,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 20),
          child: Container(
            height: 66,
            padding: const EdgeInsets.symmetric(horizontal: 6),
            decoration: BoxDecoration(
              color: const Color.fromRGBO(255, 255, 255, 0.9),
              borderRadius: BorderRadius.circular(22),
              boxShadow: kCardShadow,
              border: Border.all(
                color: const Color.fromRGBO(255, 255, 255, 0.6),
              ),
            ),
            child: Row(
              children: List<Widget>.generate(
                _tabs.length,
                (int i) => _tab(context, i, _tabs[i].icon, _tabs[i].label),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _tab(BuildContext context, int index, IconData icon, String label) {
    final bool selected = navigationShell.currentIndex == index;
    final Color color = selected ? AppColors.accent : AppColors.muted;
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
