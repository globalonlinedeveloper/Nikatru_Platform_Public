import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/sign_in_screen.dart';
import '../features/firstrun/onboarding_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/home/home_screen.dart';
import '../features/monetization/manage_plan_screen.dart';
import '../features/monetization/paywall_screen.dart';
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
    refreshListenable: ref.watch(routerRefreshProvider),
    redirect: (BuildContext context, GoRouterState state) {
      // [pipeline C-13] ONBOARDING COMES FIRST, before the auth gate. It is what
      // explains the app; asking someone to sign into something nobody has
      // introduced is the wrong order, and it is also the order that makes the
      // sign-up conversion number mean anything.
      //
      // `read`, not `watch`: watching here would rebuild the ROUTER on every
      // change and throw away the navigation stack. The flag is applied in
      // memory before the onboarding screen navigates away, so this read sees
      // it immediately.
      // 🔴 RETURNS EARLY, and that is the whole subtlety. Onboarding must be
      // EXEMPT from the auth gate below: a first run happens before there is an
      // account, so falling through would hand `/onboarding` to the signed-out
      // rule, which sends it to `/sign-in` — and the user never sees onboarding
      // at all. Measured, not reasoned: the redirect log read
      // `/` → `/onboarding` → `/sign-in` on the first run.
      final bool? onboarded = ref.read(onboardingSeenProvider);
      // Still reading the disk. Decline to decide rather than guessing: guessing
      // `false` sends a returning user to the carousel they finished months ago.
      if (onboarded == null) return null;
      if (!onboarded) {
        return state.matchedLocation == '/onboarding' ? null : '/onboarding';
      }
      if (state.matchedLocation == '/onboarding') return '/';

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
        path: '/onboarding',
        builder: (BuildContext context, GoRouterState state) =>
            const OnboardingScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (BuildContext context, GoRouterState state) =>
            const SettingsScreen(),
      ),
      // ── THE MONEY RAIL'S TWO SCREENS ([pipeline 5]M-6, M-9) ──────────────
      //
      // 🔴 BOTH ROUTES ARE THE STEP-COUNT SOURCE. `assert-purchase-path.mjs`
      // derives the purchase step count and the cancel step count from THIS
      // file, from the same navigation graph, so ROSCA's "cancelling is no
      // harder than buying" is checked against the router rather than against
      // somebody's description of it. Renaming a path here changes both counts
      // together, which is the point.
      GoRoute(
        path: '/paywall',
        builder: (BuildContext context, GoRouterState state) =>
            const PaywallScreen(),
      ),
      GoRoute(
        path: '/manage-plan',
        builder: (BuildContext context, GoRouterState state) =>
            const ManagePlanScreen(),
      ),
    ],
  );
});
