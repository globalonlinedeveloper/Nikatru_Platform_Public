// ═══════════════════════════════════════════════════════════════════════════
// THE ROUTE TABLE — everything that sits OUTSIDE the shell, in declaration
// order. The five shell branches are `shell.dart`; the `GoRouter` that consumes
// both is `router_provider.dart`.
//
// ⚠️ [appRoutes] IS A FUNCTION, NOT A TOP-LEVEL `final` LIST, AND THAT IS
// DELIBERATE. The list used to be built inside the `GoRouter(...)` call, so a
// second `ProviderContainer` got a second set of route objects. A shared `final`
// would hand every container the SAME `StatefulShellBranch` navigator keys —
// two live routers, one set of GlobalKeys — which is a crash, not a saving.
// Building on each call reproduces exactly what the single file did.
//
// ⚠️ ORDER IS NOT DECORATIVE. `go_router` matches in declaration order, and
// `test/chassis_properties_test.dart` reads every `path:` off this spine and
// visits it, so a route added here is a route the whole UI-invariant sweep must
// stand up to.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../features/auth/check_inbox_screen.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/reaccept_terms_screen.dart';
import '../../features/auth/reset_password_screen.dart';
import '../../features/auth/verify_email_screen.dart';
import '../../features/detail/subscription_detail_screen.dart';
import '../../features/import/import_screen.dart';
import '../../features/setup/setup_screen.dart';
import '../../features/monetization/manage_plan_screen.dart';
import '../../features/monetization/paywall_screen.dart';
import '../../features/notifications/notifications_screen.dart';
import '../../features/onboarding/onboarding_screen.dart';
import '../../features/stop/stop_flow.dart';
import 'navigator_key.dart';

/// Thin seam onto `package:nikatru_core`'s shared implementation — the WHY,
/// and the measured incidents behind each rule, live in
/// `packages/core/lib/src/routing/gate_destination.dart`. It was duplicated
/// byte-for-byte in this file and in the other tree until 2026-09-04, which
/// meant a security fix to one was invisible to the other.
String? _pendingAddress(GoRouterState state) =>
    core.pendingAddress(state.extra);

// 🔴 EVERY GoRoute BELOW PASSES `caseSensitive: false`, ON PURPOSE (go_router 18).
// go_router 14.8.1 matched every path case-INsensitively (path_utils.dart:50
// hard-codes `caseSensitive: false`); 15.0.0 made each GoRoute case-SENSITIVE
// by default. Every path here is a live web URL under nikatru.com/<app>/ and an
// app link a mail client or a person may re-case, so taking the new default
// would silently turn `/Settings` from the settings screen into NotFoundScreen.
// Decided per route and the answer is the same for all of them: keep 14.x.
// The flag is each route's LAST argument: `path:` stays first and `builder:`
// stays next to it, which is what the source-reading guards and tests anchor on.
/// Every route above the shell, in declaration order.
List<RouteBase> appRoutes() => <RouteBase>[
  // ── CHASSIS ENTRY PATH ────────────────────────────────────────────────
  // The stamp's home is '/'; Subly's is '/home' (inside the shell, so it
  // keeps the bottom nav). Mounting '/' as a redirect keeps the chassis
  // path resolvable without giving Subly a second, nav-less home.
  GoRoute(path: '/', redirect: (_, __) => '/home', caseSensitive: false),

  // ── LIVE AUTH FLOW ────────────────────────────────────────────────────
  GoRoute(
    path: '/onboarding',
    builder: (_, __) => const OnboardingScreen(),
    caseSensitive: false,
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
    caseSensitive: false,
  ),
  // ── THE RETIRED BUDGET TAB, KEPT AS A REDIRECT (ST-D3 D3-3) ─────────────
  // ADR 077 §A folds the budget into Insights; the tab and its screen are
  // deleted. The URL is not: a bookmark, a mail or a `?next=/budget` written
  // before today would otherwise land on NotFoundScreen. Same shape as
  // `/login` above — only the PATH is rewritten, so a query survives the hop.
  GoRoute(
    path: '/budget',
    redirect: (BuildContext context, GoRouterState state) =>
        state.uri.replace(path: '/insights').toString(),
    caseSensitive: false,
  ),
  // ── THE RETIRED `/scan`, KEPT AS A REDIRECT (ADR 077 §2.2, IM-01) ────────
  // `/scan` was a timed loader over the ordinary list fetch that imported
  // nothing; the import hub at `/import` is what the word means now. Same shape
  // as `/login` and `/budget`: only the PATH is rewritten, so a query survives.
  GoRoute(
    path: '/scan',
    redirect: (BuildContext context, GoRouterState state) =>
        state.uri.replace(path: '/import').toString(),
    caseSensitive: false,
  ),

  // ── THE CANONICAL AUTH FLOW ───────────────────────────────────────────
  // `/sign-in` is the chassis path and `LoginScreen` is Subly's live form:
  // the URL is the stamp's, the screen is the app's. The stamped
  // `SignInScreen` twin went with this change — see the barrel's header.
  GoRoute(
    path: '/sign-in',
    builder: (_, __) => const LoginScreen(),
    caseSensitive: false,
  ),
  // ⏱ 2026-09-28 · ST-T1b (audit A-5): ONE sign-up surface. `/sign-up` was a
  // second, divergent form (plain fields, no address check, no Apple/Google)
  // that nothing linked to; it is now the same screen, opened on its sign-up
  // arm, so the path the stamp declares still resolves.
  GoRoute(
    path: '/sign-up',
    // ⏱ 2026-10-01 · EN-13 / EN-14 — an address handed back by "Wrong
    // address?" or "Use a different e-mail" arrives in `extra` and fills the box.
    builder: (_, GoRouterState state) =>
        LoginScreen(startInSignUp: true, initialEmail: _pendingAddress(state)),
    caseSensitive: false,
  ),

  // ── THE NO-SESSION HALF OF EMAIL CONFIRMATION ─────────────────────────
  // Reached from the ONE sign-up surface — `LoginScreen`'s sign-up arm, on
  // `/sign-in` or `/sign-up` — when `signUp` returns a user but no session. `/verify-email`
  // cannot serve this person: its gate is `sessionIsUnverified`, which
  // answers FALSE for a null user by design, so it never fires and they
  // were left on whatever screen the code happened to name.
  //
  // 🔴 THE ADDRESS TRAVELS AS ROUTE STATE, NEVER IN THE PATH OR A QUERY.
  // An email address in a URL is a real address in browser history, in a
  // referrer and in every log the page's assets touch. `extra` is carried
  // by the navigation and by nothing else.
  //
  // The redirect is what makes the builder's `!` total: no address, no
  // screen. It also answers the person who types this URL having signed up
  // for nothing — they are sent to the form rather than shown "we sent a
  // link to " with a blank where the address should be.
  GoRoute(
    path: '/check-inbox',
    redirect: (BuildContext context, GoRouterState state) =>
        _pendingAddress(state) == null ? '/sign-in' : null,
    builder: (BuildContext context, GoRouterState state) =>
        CheckInboxScreen(email: _pendingAddress(state)!),
    caseSensitive: false,
  ),

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
    caseSensitive: false,
  ),
  GoRoute(
    path: '/reaccept-terms',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const ReacceptTermsScreen(),
    caseSensitive: false,
  ),

  // ── WHERE A PASSWORD-RESET LINK LANDS ─────────────────────────────────
  // Above the shell for the same reason the two gates above are: a bottom
  // nav bar under a gate is a way around the gate, and this one holds a
  // person who cannot get into their account any other way.
  //
  // Reachable by a SIGNED-OUT visitor on purpose (see `/reset-password` in
  // `authFlow`): a link whose exchange could not complete leaves exactly
  // that state, and explaining it is what this screen is for.
  GoRoute(
    path: '/reset-password',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const ResetPasswordScreen(),
    caseSensitive: false,
  ),

  // ── LIVE ROOT-NAVIGATOR ROUTES ────────────────────────────────────────
  // parentNavigatorKey pins these ABOVE the shell so they cover the nav bar.
  // ⏱ ST-T9 (EN-18): the after-sign-in setup, offered once per account by
  // home when a first sign-in's list loads empty. Signed-in only (the
  // signed-out gate does not list it), above the shell like a first run.
  GoRoute(
    path: '/setup',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const SetupScreen(),
    caseSensitive: false,
  ),
  GoRoute(
    path: '/notifications',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const NotificationsScreen(),
    caseSensitive: false,
  ),
  GoRoute(
    path: '/sub/:id',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, GoRouterState state) =>
        SubscriptionDetailScreen(id: state.pathParameters['id']!),
    caseSensitive: false,
  ),
  // DE-07: the stop-a-charge flow as a page — a deep link (a "cancel by"
  // reminder, a shared URL) lands on the choose step. The detail screen opens
  // the same flow as a sheet, which also works in its two-pane mount.
  GoRoute(
    path: '/sub/:id/stop',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, GoRouterState state) =>
        StopScreen(id: state.pathParameters['id']!),
    caseSensitive: false,
  ),

  // ── THE IMPORT HUB (IM-01) ─────────────────────────────────────────────
  // Above the shell, like the notifications screen: a CSV mapping step is a
  // task with an end, and a bottom nav bar under it is a way to lose it half
  // done. Signed-in only — it writes rows through the add route, so the
  // signed-out rule sends a visitor to `/sign-in` with `?next=/import`.
  GoRoute(
    path: '/import',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const ImportScreen(),
    caseSensitive: false,
  ),

  // ── THE MONEY RAIL'S TWO SCREENS ([pipeline 5]M-6, M-9) ───────────────
  // Full-screen above the shell: a purchase flow with a bottom nav bar
  // underneath it is a way out of a funnel mid-transaction.
  GoRoute(
    path: '/paywall',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const PaywallScreen(),
    caseSensitive: false,
  ),
  GoRoute(
    path: '/manage-plan',
    parentNavigatorKey: rootNavigatorKey,
    builder: (_, __) => const ManagePlanScreen(),
    caseSensitive: false,
  ),
];
