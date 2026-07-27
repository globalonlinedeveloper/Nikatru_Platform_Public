import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_config.dart';
import '../../core/e2e_keys.dart';
import '../../core/theme/app_colors.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/widgets.dart';

/// Tabbed shell: hosts the branch content plus the floating nav bar and FAB.
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
    return Scaffold(
      backgroundColor: AppColors.bg,
      body: Stack(
        children: <Widget>[
          Positioned.fill(child: navigationShell),
          // DEMO-DATA MARKER. Without a backend configured the app serves
          // SeedApiClient - Netflix, Spotify, ChatGPT Plus and friends - and until
          // 2026-07-27 that was indistinguishable from the user's own data. Paired
          // with the old "detected across your accounts" copy it read as a real
          // account scan. Seed data is fine; seed data wearing real data's clothes
          // is not. Shows ONLY when unconfigured, so production never sees it.
          if (!AppConfig.isApiConfigured)
            Positioned(
              left: 0,
              right: 0,
              top: 0,
              child: SafeArea(
                bottom: false,
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
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
          Positioned(
            left: 16,
            right: 16,
            bottom: 20,
            child: Container(
              height: 66,
              padding: const EdgeInsets.symmetric(horizontal: 6),
              decoration: BoxDecoration(
                color: const Color.fromRGBO(255, 255, 255, 0.9),
                borderRadius: BorderRadius.circular(22),
                boxShadow: kCardShadow,
                border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.6)),
              ),
              child: Row(
                children: List<Widget>.generate(_tabs.length,
                    (int i) => _tab(context, i, _tabs[i].icon, _tabs[i].label)),
              ),
            ),
          ),
          Positioned(
            right: 20,
            bottom: 98,
            child: Material(
              color: Colors.transparent,
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
                          spreadRadius: -8),
                    ],
                  ),
                  child: const Icon(Icons.add, color: Colors.white, size: 28),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _tab(BuildContext context, int index, IconData icon, String label) {
    final bool selected = navigationShell.currentIndex == index;
    final Color color = selected ? AppColors.accent : AppColors.muted;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(15),
        onTap: () => navigationShell.goBranch(index,
            initialLocation: index == navigationShell.currentIndex),
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
              Text(label,
                  style: TextStyle(
                      fontFamily: 'Manrope',
                      fontWeight: FontWeight.w700,
                      fontSize: 9,
                      color: color)),
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
