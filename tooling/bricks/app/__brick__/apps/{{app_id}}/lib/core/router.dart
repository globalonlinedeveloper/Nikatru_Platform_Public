import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/sign_in_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/home/home_screen.dart';
import '../l10n/app_localizations.dart';
import '../state/providers.dart';
import '../features/settings/settings_screen.dart';

/// The app router. A [Provider] so screens and tests can override it.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  // [pipeline C-13] THE REDIRECT GUARD. Screens do not navigate after a
  // successful sign-in — this does. Pushing from both places is how two routes
  // end up racing to be the top of the stack, and the loser wins about half the
  // time.
  //
  // `currentUser` is the SYNCHRONOUS snapshot for exactly this reason: a
  // redirect cannot await. That is why the seam exposes it separately from
  // `currentSession()`.
  final core.AuthRepository auth = ref.watch(authRepositoryProvider);

  return GoRouter(
    initialLocation: '/',
    // 🔴 WITHOUT THIS THE GUARD BELOW NEVER RE-RUNS. `redirect` fires on
    // navigation, not on a session appearing, so a user who signed in stayed on
    // the form they had just completed — the seam worked, the guard worked, and
    // nothing connected them. See [AuthRefreshNotifier].
    refreshListenable: ref.watch(authRefreshProvider),
    redirect: (BuildContext context, GoRouterState state) {
      final bool signedIn = auth.currentUser != null;
      final bool onAuthScreen =
          state.matchedLocation == '/sign-in' ||
          state.matchedLocation == '/sign-up';
      // Signed out and heading somewhere gated → the sign-in screen.
      if (!signedIn && !onAuthScreen) return '/sign-in';
      // Signed in and still on an auth screen → home. Without this, a user who
      // signs in stays looking at the form they just completed.
      if (signedIn && onAuthScreen) return '/';
      return null;
    },
    // [pipeline C-13] A route that does not resolve must land somewhere the user
    // can act on. Without this go_router shows its OWN error page, which names
    // internal route patterns — and a 404 matters most on web, where a user can
    // type a URL, follow a stale link, or land on a route an update removed.
    errorBuilder: (BuildContext context, GoRouterState state) => NotFoundScreen(
      title: AppLocalizations.of(context).notFoundTitle,
      message: AppLocalizations.of(context).notFoundMessage,
      goHomeLabel: AppLocalizations.of(context).goHome,
      attemptedLocation: state.uri.toString(),
      onGoHome: () => context.go('/'),
    ),
    routes: <RouteBase>[
      GoRoute(
        path: '/',
        builder: (BuildContext context, GoRouterState state) =>
            const HomeScreen(),
      ),
      GoRoute(
        path: '/sign-in',
        builder: (BuildContext context, GoRouterState state) =>
            const SignInScreen(),
      ),
      GoRoute(
        path: '/sign-up',
        builder: (BuildContext context, GoRouterState state) =>
            const SignUpScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (BuildContext context, GoRouterState state) =>
            const SettingsScreen(),
      ),
    ],
  );
});
