// ═══════════════════════════════════════════════════════════════════════════
// THE SHELL AND ITS FIVE BRANCHES — the bottom-nav half of the route table, and
// the one router-local wrapper (`_GatedInsights`) that stands between a branch
// and its screen.
//
// ⚠️ A FUNCTION, NOT A TOP-LEVEL `final`, FOR THE REASON `routes.dart` GIVES:
// `StatefulShellBranch` mints a `GlobalKey` per branch, so a shared instance
// would hand two live routers the same keys.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../features/budget/budget_screen.dart';
import '../../features/calendar/calendar_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/insights/insights_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/shell/app_shell.dart';
import '../../l10n/app_localizations.dart';
import '../../state/money_providers.dart';

/// ── THE LIVE SHELL — five branches, unchanged ─────────────────────────
RouteBase appShellRoute() => StatefulShellRoute.indexedStack(
  builder: (_, __, StatefulNavigationShell navShell) =>
      AppShell(navigationShell: navShell),
  branches: <StatefulShellBranch>[
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(path: '/home', builder: (_, __) => const HomeScreen()),
      ],
    ),
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(path: '/calendar', builder: (_, __) => const CalendarScreen()),
      ],
    ),
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(path: '/insights', builder: (_, __) => const _GatedInsights()),
      ],
    ),
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(path: '/budget', builder: (_, __) => const BudgetScreen()),
      ],
    ),
    // COLLISION: the stamp mounts /settings top-level. Subly's settings
    // is a shell branch (it keeps the nav bar) and the screen FILE is the
    // same path in both trees, so the live placement wins and no stamped
    // screen is lost.
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(path: '/settings', builder: (_, __) => const SettingsScreen()),
      ],
    ),
  ],
);

/// The INSIGHTS branch behind the chassis [PaywallGate] — [pipeline 5]M-5's
/// open path, moved here in P2.6b when VARIANT B took the AppScaffold out of
/// HomeScreen (the stamped shell gated its Explore tab; Subly's 5-tab nav has
/// no Explore, and Insights — the savings surface — is the premium-surface
/// default until Phase 4 decides finally). `paywallLockedProvider` resolves
/// from the SERVER's entitlement read; with `PaywallConfig(enabled: false)`
/// (today's default) it locks nothing, so the gate costs Subly nothing while
/// staying a live, consumed seam rather than the [pipeline C-6] dead shape.
///
/// 🔴 STILL PRIVATE, AND THE UNDERSCORE IS LOAD-BEARING TO TWO GUARDS.
/// `assert-a11y-coverage.mjs` and `assert-responsive-coverage.mjs` both treat a
/// builder target starting with `_` as a ROUTER-LOCAL WRAPPER and resolve one
/// level through it to the feature surface it builds. Renaming it public makes
/// it a builder target they cannot classify — neither a screen under
/// `lib/features` nor an argued non-pane — and both guards fail by design
/// rather than guess.
class _GatedInsights extends ConsumerWidget {
  const _GatedInsights();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return PaywallGate(
      locked: ref.watch(paywallLockedProvider),
      onUpgrade: () => context.go('/paywall'),
      title: l10n.paywallHeadline,
      message: l10n.paywallGateMessage,
      upgradeLabel: l10n.paywallUpgrade,
      child: const InsightsScreen(),
    );
  }
}
