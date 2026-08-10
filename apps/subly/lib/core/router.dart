// ═══════════════════════════════════════════════════════════════════════════
// SUBLY'S ROUTER — the single one. P2.5 de-duplicated the live
// `lib/core/router/app_router.dart` and the stamped router into this file, at
// the STAMP's path (anchored by tooling/ci/assert-stamp-properties.mjs
// `const ROUTER = 'lib/core/router.dart'`; Subly is EXEMPT_APPS today and
// Phase 5 drops that exemption). `lib/core/router/` no longer exists.
//
// Route inventory (the union — nothing live was lost, every stamped route is
// reachable):
//   FROM LIVE : /onboarding /scan /notifications /sub/:id
//               /home /calendar /insights /budget /settings   (shell)
//   FROM STAMP: / /sign-in /sign-up /paywall /manage-plan  + errorBuilder
//   COLLISIONS: /onboarding (live screen wins) · /settings (live shell
//               placement wins) · / (stamp entry kept as a redirect to /home)
//
// ── THE AUTH ROUTE IS `/sign-in`, AND IT IS THE ONLY ONE (owner, 2026-08-09) ─
// P2.5 mounted BOTH `/login` (live) and `/sign-in` (stamp) and deferred the
// choice as a product decision. It is now made: **`/sign-in` is canonical and
// `/login` is a redirect onto it.** Two URLs for one gate is a fork that leaks
// everywhere a link can be written — a marketing page, a password-reset mail, a
// stale bookmark, a deep link built by a Worker — and each of them ages into a
// different answer.
//
// 🔴 THE SCREEN DID NOT MOVE; ONLY THE URL DID. `/sign-in` builds the LIVE
// `LoginScreen`, which is the screen a signed-out Subly user has always landed
// on. It is the surface that carries the ADR-027 account-deletion notice (the
// deletion outcome has NO other place to render — the sign-out redirect tears
// down settings, its dialog and any SnackBar), the `E2EKeys.login*` anchors the
// integration suite and the nightly E2E legs drive, and the localized
// `_friendlyMessage` mapping that keeps a raw GoTrue exception off the screen.
// Canonicalising the URL onto the stamped `SignInScreen` instead would have
// dropped all three, so the stamped twin — unreachable the moment `/sign-in`
// stopped building it — was REMOVED rather than left as a pane no user can
// open. `assert-responsive-coverage.mjs`'s floor moved 16 → 15 in the same
// change, which is exactly the deliberate, noisy way that guard requires a
// surface to leave the app.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/login_screen.dart';
import '../features/auth/reaccept_terms_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/auth/verify_email_screen.dart';
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

/// The root Navigator's key — public, not an implementation detail, because the
/// routes below that must cover the shell rather than sit inside it
/// (`parentNavigatorKey:`, four of them) have to name the Navigator they are
/// pushed onto, and a shell route's own Navigator is the wrong one.
///
/// 🔴 ITS ORIGINAL REASON IS GONE, AND SAYING SO IS THE POINT. This comment used
/// to explain that [pipeline C-6]'s `ConsentGate` — installed via
/// `MaterialApp.router`'s `builder`, which Flutter inserts ABOVE this Navigator
/// — borrowed the key's context so `showDialog` had somewhere to push. That
/// widget lost its last mount in the P2.6 chassis merge (the consent question is
/// now an inline scrim inside `AnalyticsGate`, which needs no Navigator at all)
/// and was deleted 2026-08-10. The key survives on the four uses below, which
/// are reason enough on their own — but a symbol kept alive by a comment
/// describing a deleted caller is a symbol nobody dares touch.
///
/// 🔴 CARRIED FROM app_router.dart UNCHANGED. The stamped router declares no
/// navigatorKey at all, so dropping this line un-roots those four routes.
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
      // Every location a SIGNED-OUT user is allowed to stay on. `/login` is
      // still in here even though it now renders nothing, and that is load
      // bearing rather than leftover — see below.
      const List<String> authFlow = <String>[
        '/onboarding',
        '/login',
        '/sign-in',
        '/sign-up',
        '/scan',
        // 🔴 THE SECOND HALF OF A TWO-PART FIX, and not redundant with the
        // `loggedIn` condition on the gate below. MEASURED (2026-08-10, real
        // router, real provider): with the gate unconditioned and this entry
        // absent, a signed-out visitor on a fresh install went `/sign-in` →
        // `/reaccept-terms` → (not logged in, not in this list) → `/sign-in` →
        // … past go_router's redirect limit, and the errorBuilder rendered
        // NotFoundScreen — `SETTLED AT: /reaccept-terms`, `"Page not found"
        // ×1`, `"Welcome" ×0`. THE APP COULD NOT BE SIGNED INTO AT ALL, on
        // every install today and again after every `kTermsVersion` bump.
        // Conditioning the gate on `loggedIn` is the real fix. This entry is
        // the containment: with it, the worst case if that condition is ever
        // edited away is a visitor parked on an interstitial they can complete
        // and leave — never a 404 with no way back to the form.
        '/reaccept-terms',
      ];

      // 🔴 `/login` MUST STAY IN `authFlow`, OR THE DEEP LINK IS EATEN HERE.
      // MEASURED, not reasoned (mutation M5, 2026-08-10): drop it and
      // `/login?next=%2Fbudget&ref=mail` settles on a bare `/sign-in` with
      // `{}` for a query. This guard returns a PATH; the route-level redirect
      // returns a URI. So letting the guard fire on `/login` throws the query
      // away one step before the redirect that would have carried it — and a
      // lost `next=` is invisible, because the user is on the right screen and
      // simply arrives somewhere they did not ask for afterwards. Leaving
      // `/login` allowed makes the guard decline and hands the job to the
      // route-level redirect below.
      if (!loggedIn && !authFlow.contains(loc)) return '/sign-in';

      // ── EMAIL VERIFICATION, AND IT SITS ABOVE EVERYTHING A USER CAME FOR ──
      // Owner lock, 2026-08-09: verification is MANDATORY for email+password
      // registration, because email is the matching key the one-identity lock
      // merges on — so an unproven address is a route into somebody else's
      // Google/Apple account.
      //
      // 🔴 THE CLIENT HALF IS NOT REDUNDANT WITH THE SUPABASE DASHBOARD SWITCH.
      // With "Confirm email" OFF, gotrue hands back a full session on sign-up
      // and this gate is the ONLY thing between an unproven address and the
      // product. The e2e suite cannot stand in for it either: it mints its users
      // through the admin API, which bypasses confirmation entirely, so a green
      // nightly says nothing at all about this. `test/legal_gates_test.dart`
      // is the assertion — group (a), which drives this gate in both
      // directions through the real router.
      //
      // 🔴 ABOVE THE RE-ACCEPTANCE GATE ON PURPOSE. Both send the user
      // somewhere that is not where they asked to go, and if the order were
      // reversed an unverified user would be asked to accept the terms first —
      // recording a legal acceptance against an identity nobody has proven.
      if (core.sessionIsUnverified(auth.currentUser)) {
        return loc == '/verify-email' ? null : '/verify-email';
      }
      // A verified user has no business on the waiting room. Without this the
      // screen is reachable by typing the URL and shows "check your inbox" to
      // somebody who already did.
      if (loc == '/verify-email') return '/home';

      // ── MATERIAL-CHANGE RE-ACCEPTANCE (research/43) ───────────────────────
      // Shown when `kTermsVersion`/`kPrivacyPolicyVersion` have moved past what
      // the user accepted. `read`, not `watch`, for the same reason onboarding
      // is read: watching rebuilds the ROUTER and throws away the stack.
      //
      // 🔴 NULL DECLINES TO DECIDE. The acceptance is hydrated from disk async;
      // treating "not read yet" as "not accepted" flashes the interstitial at
      // every launch for a user who accepted months ago — the exact defect
      // `OnboardingSeenController`'s three states were introduced to fix, and
      // the reason `routerRefreshProvider` now listens to this provider too.
      // 🔴 `loggedIn` IS LOAD-BEARING HERE, AND ITS ABSENCE MADE THE APP
      // UNUSABLE. A person with no session cannot owe an acceptance — there is
      // nobody to have accepted. Without this condition the gate fired for
      // SIGNED-OUT visitors, who are then bounced straight back by the
      // signed-out rule above: `/sign-in` → `/reaccept-terms` → `/sign-in` → …
      // until go_router gives up and the errorBuilder renders NotFoundScreen.
      // That is every install today (nobody has a clickwrap record yet) and
      // every install again after any `kTermsVersion` bump. Pinned in BOTH
      // directions by the signed-out group in `test/legal_gates_test.dart`,
      // which drives the REAL `legalReacceptanceNeededProvider` over an empty
      // store rather than overriding it to the one value that cannot fail.
      final bool? mustReaccept = loggedIn
          ? ref.read(legalReacceptanceNeededProvider)
          : false;
      if (mustReaccept == null) return null;
      if (mustReaccept) {
        return loc == '/reaccept-terms' ? null : '/reaccept-terms';
      }
      // Reached by a signed-out visitor too, now that `/reaccept-terms` is in
      // `authFlow`: they are handed to '/home', which the signed-out rule turns
      // into '/sign-in' on the next pass. Two hops, and it terminates.
      if (loc == '/reaccept-terms') return '/home';
      // ⚠️ `/login` IS DELIBERATELY ABSENT FROM THIS LIST, and it was here
      // until the mutation said otherwise. M4 (2026-08-10): removing it changed
      // NO test outcome, because a signed-in user opening `/login` is
      // canonicalised to `/sign-in` by the route-level redirect and bounced
      // home by this very line on the next pass. A branch no input can reach is
      // dead code that reads as a safety net, so it went rather than being kept
      // "just in case" — the same rule this repo applied to the Ed25519 length
      // checks. The behaviour is pinned by the signed-in limb of
      // `test/auth_route_canonical_test.dart`.
      if (loggedIn && (loc == '/sign-in' || loc == '/sign-up')) return '/home';
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
      // ── THE OLD AUTH URL, KEPT AS A REDIRECT ──────────────────────────────
      // Not deleted. A route that 404s is worse than the duplication it
      // replaced: every link already written against `/login` — a bookmark, a
      // reset mail, a stale share — would land on `NotFoundScreen` instead of
      // the form the person came to use. Deleting it is a decision for the day
      // nobody holds such a link, and nothing here can know that day.
      //
      // 🔴 `state.uri.replace(path:)`, NOT the literal `'/sign-in'`. The whole
      // URI comes in and only the PATH is rewritten, so `?next=/budget` and any
      // `#fragment` survive the hop. Returning a bare string here is the exact
      // shape that turns a working deep link into a silent trip to the home
      // screen, and it is invisible in review because both spellings redirect.
      GoRoute(
        path: '/login',
        redirect: (BuildContext context, GoRouterState state) =>
            state.uri.replace(path: '/sign-in').toString(),
      ),
      GoRoute(path: '/scan', builder: (_, __) => const ScanScreen()),

      // ── THE CANONICAL AUTH FLOW ───────────────────────────────────────────
      // `/sign-in` is the chassis path and `LoginScreen` is Subly's live form:
      // the URL is the stamp's, the screen is the app's. The stamped
      // `SignInScreen` twin went with this change — see the file header.
      GoRoute(path: '/sign-in', builder: (_, __) => const LoginScreen()),
      GoRoute(path: '/sign-up', builder: (_, __) => const SignUpScreen()),

      // ── THE TWO GATE SCREENS ──────────────────────────────────────────────
      // Routed rather than dialog-shaped, and that is a decision this repo has
      // already paid to learn: a dialog is a PAGELESS ROUTE, and the account-
      // deletion notice had to be rebuilt as an inline widget because a page
      // change carried its dialog away ([ADR 027]). Both of these appear
      // BECAUSE of a redirect, so a dialog here would be a pageless route on a
      // page that is being replaced as it opens.
      //
      // Above the shell (`parentNavigatorKey`) for the same reason the paywall
      // is: a bottom nav bar under a gate is a way around the gate.
      GoRoute(
        path: '/verify-email',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, __) => const VerifyEmailScreen(),
      ),
      GoRoute(
        path: '/reaccept-terms',
        parentNavigatorKey: rootNavigatorKey,
        builder: (_, __) => const ReacceptTermsScreen(),
      ),

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
