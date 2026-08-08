// ═══════════════════════════════════════════════════════════════════════════
// DRAFT — P2.5 ROUTER DEDUP · THE INCREMENT THAT CAN ACTUALLY LAND
//
// Destination path: apps/subly/lib/core/router.dart   (stamp path — anchored by
//   assert-stamp-properties.mjs:95; subly is EXEMPT_APPS:109 until Phase 5)
// Replaces:         apps/subly/lib/core/router/app_router.dart  (dir then dies)
//
// WHY THIS FILE EXISTS SEPARATELY FROM router.dart (the union):
//   The union needs `routerRefreshProvider`, `onboardingSeenProvider` and
//   `authCapabilitiesProvider`. All three arrive with the 1467-line providers
//   spine in P2.6a — none exists in the live 202-line providers.dart. Landing
//   the union at P2.5 is a compile error, not a merge.
//
// WHAT THIS FILE IS: the live router, MOVED to the anchored path, plus exactly
//   those chassis additions whose symbols resolve at P2.5. Nothing live is
//   lost, no live behaviour changes, and the three router tests stay green
//   untouched (they only change their import line — see importer-edits.md).
//
// DEFERRED TO P2.6a (add when the spine lands — they are in router.dart):
//   · refreshListenable: ref.watch(routerRefreshProvider)   [guard :714]
//   · the onboarding-gate redirect line                     [guard :780]
//   · GoRoute /sign-in → SignInScreen
// Both guard lines are INERT today (subly is exempt); Phase 5 makes them real.
// ═══════════════════════════════════════════════════════════════════════════

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/budget/budget_screen.dart';
import '../features/calendar/calendar_screen.dart';
import '../features/detail/subscription_detail_screen.dart';
import '../features/home/home_screen.dart';
import '../features/insights/insights_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/scan/scan_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/shell/app_shell.dart';
import '../l10n/app_localizations.dart';
import '../state/providers.dart';

/// The root Navigator's key — public, not an implementation detail, because
/// [pipeline C-6] ConsentGate is installed via `MaterialApp.router`'s `builder`,
/// which Flutter inserts ABOVE this Navigator. A dialog launched from up there
/// has no Navigator ancestor of its own, so the consent prompt borrows this
/// key's context to reach the real Navigator (see consent_prompt.dart).
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Router is built once (authRepositoryProvider is a stable instance) and
/// refreshed on auth changes via [GoRouterRefreshStream].
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authRepositoryProvider);

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/onboarding',
    // P2.6a REPLACES THIS with `ref.watch(routerRefreshProvider)` (guard :714).
    // Kept as-is here: routerRefreshProvider does not exist yet, and the live
    // stream already covers the auth-change case these tests exercise.
    refreshListenable: GoRouterRefreshStream(auth.authStateChanges()),
    redirect: (BuildContext context, GoRouterState state) {
      final bool loggedIn = auth.currentUser != null;
      final String loc = state.matchedLocation;
      // LIVE allowlist + '/sign-up'. The stamped route is mounted below; without
      // it here a signed-out visitor is bounced to '/login' and the route is
      // unreachable — mounted-but-unreachable is the dead-feature shape the
      // seam guards exist to prevent.
      const List<String> authFlow = <String>[
        '/onboarding',
        '/login',
        '/sign-up',
        '/scan',
      ];

      if (!loggedIn && !authFlow.contains(loc)) return '/login';
      if (loggedIn && (loc == '/onboarding' || loc == '/login')) return '/home';
      return null;
    },
    // Chassis 404. Purely additive — live had none, so go_router's default
    // error page (which names internal route patterns) was what a bad URL got.
    errorBuilder: (BuildContext context, GoRouterState state) => NotFoundScreen(
      title: AppLocalizations.of(context).notFoundTitle,
      message: AppLocalizations.of(context).notFoundMessage,
      goHomeLabel: AppLocalizations.of(context).goHome,
      attemptedLocation: state.uri.toString(),
      onGoHome: () => context.go('/home'),
    ),
    routes: <RouteBase>[
      // Chassis entry path. Subly's home is '/home' (shell branch, keeps the
      // nav bar); a redirect keeps '/' resolvable without a second home.
      GoRoute(path: '/', redirect: (_, _) => '/home'),

      GoRoute(path: '/onboarding', builder: (_, _) => const OnboardingScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      // '/sign-in' is NOT here: sign_in_screen.dart needs authCapabilitiesProvider
      // (P2.6a). Adding the route without the screen is a compile error.
      GoRoute(path: '/sign-up', builder: (_, _) => const SignUpScreen()),
      GoRoute(path: '/scan', builder: (_, _) => const ScanScreen()),

      GoRoute(
        path: '/notifications',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, _) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/sub/:id',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, GoRouterState state) =>
            SubscriptionDetailScreen(id: state.pathParameters['id']!),
      ),

      StatefulShellRoute.indexedStack(
        builder: (_, _, StatefulNavigationShell navShell) =>
            AppShell(navigationShell: navShell),
        branches: <StatefulShellBranch>[
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/calendar',
                builder: (_, _) => const CalendarScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/insights',
                builder: (_, _) => const InsightsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(path: '/budget', builder: (_, _) => const BudgetScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/settings',
                builder: (_, _) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});

/// Bridges a [Stream] (auth changes) to a [Listenable] go_router can refresh on.
class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _sub = stream.asBroadcastStream().listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
