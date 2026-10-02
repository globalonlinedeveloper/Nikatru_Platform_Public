// ═══════════════════════════════════════════════════════════════════════════
// THE SHELL AND ITS FOUR BRANCHES — the bottom-nav half of the route table, and
// the one router-local wrapper (`_GatedInsights`) that stands between a branch
// and its screen.
//
// ⚠️ A FUNCTION, NOT A TOP-LEVEL `final`, FOR THE REASON `routes.dart` GIVES:
// `StatefulShellBranch` mints a `GlobalKey` per branch, so a shared instance
// would hand two live routers the same keys.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:go_router/go_router.dart';

import '../../features/calendar/calendar_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/insights/insights_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/shell/app_shell.dart';

/// ── THE LIVE SHELL — four branches (ST-D3 D3-3, ADR 077 §A) ──────────────
///
/// Home, Calendar, Insights, Settings. The Budget branch is GONE, not hidden:
/// its card and its editor live on Insights, and `/budget` is a redirect in
/// `routes.dart` so every link already written against it still lands.
RouteBase appShellRoute() => StatefulShellRoute.indexedStack(
  builder: (_, __, StatefulNavigationShell navShell) =>
      AppShell(navigationShell: navShell),
  branches: <StatefulShellBranch>[
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(
          path: '/home',
          // T12 (IN-07): `?category=` is the drill-down from an Insights
          // category row; Home lists only that category until it is cleared.
          builder: (_, GoRouterState state) =>
              HomeScreen(category: state.uri.queryParameters['category']),
          caseSensitive: false,
        ),
      ],
    ),
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(
          path: '/calendar',
          builder: (_, __) => const CalendarScreen(),
          caseSensitive: false,
        ),
      ],
    ),
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(
          path: '/insights',
          builder: (_, __) => const InsightsScreen(),
          caseSensitive: false,
        ),
      ],
    ),
    // COLLISION: the stamp mounts /settings top-level. Subly's settings
    // is a shell branch (it keeps the nav bar) and the screen FILE is the
    // same path in both trees, so the live placement wins and no stamped
    // screen is lost.
    StatefulShellBranch(
      routes: <RouteBase>[
        GoRoute(
          path: '/settings',
          builder: (_, __) => const SettingsScreen(),
          caseSensitive: false,
        ),
      ],
    ),
  ],
);

// ⏱ ST-D3 D3-6 (ST-P2): `_GatedInsights`, the whole-tab PaywallGate that stood
// here, is gone. It hid the FREE Insights cards from a locked user along with
// the premium one. The lock now sits on the one Pro card, through the design
// system's `PaywallGate.card` in `features/insights/forecast_card.dart`, and
// `/insights` builds the screen directly.
