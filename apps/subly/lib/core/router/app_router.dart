import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/login_screen.dart';
import '../../features/budget/budget_screen.dart';
import '../../features/calendar/calendar_screen.dart';
import '../../features/detail/subscription_detail_screen.dart';
import '../../features/home/home_screen.dart';
import '../../features/insights/insights_screen.dart';
import '../../features/notifications/notifications_screen.dart';
import '../../features/onboarding/onboarding_screen.dart';
import '../../features/scan/scan_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/shell/app_shell.dart';
import '../../state/providers.dart';

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
    refreshListenable: GoRouterRefreshStream(auth.authStateChanges()),
    redirect: (BuildContext context, GoRouterState state) {
      final bool loggedIn = auth.currentUser != null;
      final String loc = state.matchedLocation;
      const List<String> authFlow = <String>['/onboarding', '/login', '/scan'];

      if (!loggedIn && !authFlow.contains(loc)) return '/login';
      if (loggedIn && (loc == '/onboarding' || loc == '/login')) return '/home';
      return null;
    },
    routes: <RouteBase>[
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingScreen(),
      ),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/scan', builder: (_, __) => const ScanScreen()),
      GoRoute(
        path: '/notifications',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, __) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/sub/:id',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, GoRouterState state) =>
            SubscriptionDetailScreen(id: state.pathParameters['id']!),
      ),
      StatefulShellRoute.indexedStack(
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
              GoRoute(
                path: '/calendar',
                builder: (_, __) => const CalendarScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/insights',
                builder: (_, __) => const InsightsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/budget',
                builder: (_, __) => const BudgetScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: <RouteBase>[
              GoRoute(
                path: '/settings',
                builder: (_, __) => const SettingsScreen(),
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
