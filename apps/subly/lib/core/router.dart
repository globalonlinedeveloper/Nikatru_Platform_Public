// ═══════════════════════════════════════════════════════════════════════════
// SUBLY'S ROUTER — the single one. P2.5 de-duplicated the live
// `lib/core/router/app_router.dart` and the stamped router into this file, at
// the STAMP's path (anchored by tooling/ci/assert-stamp-properties.mjs
// `const ROUTER = 'lib/core/router.dart'`; Subly is EXEMPT_APPS today and
// Phase 5 drops that exemption). `lib/core/router/` no longer exists.
//
// Route inventory (the union — nothing live was lost, every stamped route is
// reachable):
//   FROM LIVE : /onboarding /login /scan /notifications /sub/:id
//               /home /calendar /insights /budget /settings   (shell)
//   FROM STAMP: / /sign-in /sign-up /paywall /manage-plan  + errorBuilder
//   COLLISIONS: /onboarding (live screen wins) · /settings (live shell
//               placement wins) · / (stamp entry kept as a redirect to /home)
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/budget/budget_screen.dart';
import '../features/calendar/calendar_screen.dart';
import '../features/detail/subscription_detail_screen.dart';
import '../features/home/home_screen.dart';
import '../features/insights/insights_screen.dart';
import '../features/monetization/manage_plan_screen.dart';
import '../features/monetization/paywall_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/scan/scan_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/shell/app_shell.dart';
import '../l10n/app_localizations.dart';
import '../state/money_providers.dart';
import '../state/providers.dart';

/// The root Navigator's key — public, not an implementation detail, because
/// [pipeline C-6] ConsentGate is installed via `MaterialApp.router`'s `builder`,
/// which Flutter inserts ABOVE this Navigator. A dialog launched from up there
/// has no Navigator ancestor of its own, so the consent prompt borrows this
/// key's context to reach the real Navigator (see consent_prompt.dart).
///
/// 🔴 CARRIED FROM app_router.dart UNCHANGED. The stamped router declares no
/// navigatorKey at all; dropping this breaks consent_prompt.dart:61 and
/// consent_gate_open_path_test.dart:39, which anchor on the real key.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

/// Router is built once (authRepositoryProvider is a stable instance) and
/// refreshed on auth changes.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authRepositoryProvider);

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    // LIVE entry point kept. The stamp starts at '/', but Subly's first frame
    // is the onboarding carousel and three tests drive that assumption.
    // '/' is still mounted below, so the chassis entry path resolves.
    initialLocation: '/onboarding',
    // 🔴 WITHOUT THIS THE GUARD BELOW NEVER RE-RUNS. `redirect` fires on
    // navigation, not on a session appearing, so a user who signed in stayed on
    // the form they had just completed.
    // Anchored verbatim by assert-stamp-properties.mjs:714.
    refreshListenable: ref.watch(routerRefreshProvider),
    redirect: (BuildContext context, GoRouterState state) {
      final String loc = state.matchedLocation;

      // [pipeline C-13] ONBOARDING COMES FIRST, before the auth gate.
      //
      // `read`, not `watch`: watching here would rebuild the ROUTER on every
      // change and throw away the navigation stack.
      // 🔴 RETURNS EARLY, and that is the whole subtlety. Onboarding must be
      // EXEMPT from the auth gate below: a first run happens before there is an
      // account, so falling through would hand '/onboarding' to the signed-out
      // rule, and the user never sees onboarding at all.
      final bool? onboarded = ref.read(onboardingSeenProvider);
      // Still reading the disk. Decline to decide rather than guessing.
      if (onboarded == null) return null;
      if (!onboarded) {
        return state.matchedLocation == '/onboarding' ? null : '/onboarding';
      }
      // LIVE DIVERGENCE FROM THE STAMP: home is '/home' here, not '/'.
      if (loc == '/onboarding') return '/home';

      final bool loggedIn = auth.currentUser != null;
      // The live allowlist, WIDENED by the two stamped auth paths. Without
      // '/sign-in' and '/sign-up' here a signed-out user is bounced to '/login'
      // and the stamped auth routes are mounted but unreachable.
      const List<String> authFlow = <String>[
        '/onboarding',
        '/login',
        '/sign-in',
        '/sign-up',
        '/scan',
      ];

      if (!loggedIn && !authFlow.contains(loc)) return '/login';
      if (loggedIn &&
          (loc == '/login' || loc == '/sign-in' || loc == '/sign-up')) {
        return '/home';
      }
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
      onGoHome: () => context.go('/home'),
    ),
    routes: <RouteBase>[
      // ── CHASSIS ENTRY PATH ────────────────────────────────────────────────
      // The stamp's home is '/'; Subly's is '/home' (inside the shell, so it
      // keeps the bottom nav). Mounting '/' as a redirect keeps the chassis
      // path resolvable without giving Subly a second, nav-less home.
      GoRoute(path: '/', redirect: (_, __) => '/home'),

      // ── LIVE AUTH FLOW ────────────────────────────────────────────────────
      GoRoute(
        path: '/onboarding',
        builder: (_, __) => const OnboardingScreen(),
      ),
      GoRoute(path: '/login', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/scan', builder: (_, __) => const ScanScreen()),

      // ── STAMPED AUTH FLOW (chassis) ───────────────────────────────────────
      // Kept alongside /login rather than replacing it: login_screen.dart is
      // the live product surface and is test-protected
      // (sign_out_destination_test.dart:154 expects LoginScreen after logout).
      // Choosing ONE of the two is a P2.6b product decision, not a P2.5 one.
      GoRoute(path: '/sign-in', builder: (_, __) => const SignInScreen()),
      GoRoute(path: '/sign-up', builder: (_, __) => const SignUpScreen()),

      // ── LIVE ROOT-NAVIGATOR ROUTES ────────────────────────────────────────
      // parentNavigatorKey pins these ABOVE the shell so they cover the nav bar.
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

      // ── THE MONEY RAIL'S TWO SCREENS ([pipeline 5]M-6, M-9) ───────────────
      // Full-screen above the shell: a purchase flow with a bottom nav bar
      // underneath it is a way out of a funnel mid-transaction.
      GoRoute(
        path: '/paywall',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, __) => const PaywallScreen(),
      ),
      GoRoute(
        path: '/manage-plan',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, __) => const ManagePlanScreen(),
      ),

      // ── THE LIVE SHELL — five branches, unchanged ─────────────────────────
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
                builder: (_, __) => const _GatedInsights(),
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
          // COLLISION: the stamp mounts /settings top-level. Subly's settings
          // is a shell branch (it keeps the nav bar) and the screen FILE is the
          // same path in both trees, so the live placement wins and no stamped
          // screen is lost.
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

/// The INSIGHTS branch behind the chassis [PaywallGate] — [pipeline 5]M-5's
/// open path, moved here in P2.6b when VARIANT B took the AppScaffold out of
/// HomeScreen (the stamped shell gated its Explore tab; Subly's 5-tab nav has
/// no Explore, and Insights — the savings surface — is the premium-surface
/// default until Phase 4 decides finally). `paywallLockedProvider` resolves
/// from the SERVER's entitlement read; with `PaywallConfig(enabled: false)`
/// (today's default) it locks nothing, so the gate costs Subly nothing while
/// staying a live, consumed seam rather than the [pipeline C-6] dead shape.
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
