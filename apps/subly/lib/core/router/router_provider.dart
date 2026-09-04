// ═══════════════════════════════════════════════════════════════════════════
// THE ASSEMBLY — the one `GoRouter` this app has, and the only place the gate
// chain, the route table and the shell meet. Nothing is decided here; every
// decision is in the file it came from.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import 'gates.dart';
import 'navigator_key.dart';
import 'routes.dart';
import 'shell.dart';

/// Router is built once (authRepositoryProvider is a stable instance) and
/// refreshed on auth changes.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authRepositoryProvider);

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    // LIVE entry point kept. The stamp starts at '/', but Subly's first frame
    // is the onboarding carousel and three tests drive that assumption.
    // '/' is still mounted (`routes.dart`), so the chassis entry path resolves.
    initialLocation: '/onboarding',
    // 🔴 WITHOUT THIS THE GUARD BELOW NEVER RE-RUNS (the `redirect:` on the
    // next line, and through it the whole of `gates.dart`). `redirect` fires on
    // navigation, not on a session appearing, so a user who signed in stayed on
    // the form they had just completed.
    // Anchored verbatim by assert-stamp-properties.mjs — the
    // `auth-redirect-follows-session` property's ROUTER source. (The line
    // number this comment used to carry, `:714`, had been stale since long
    // before P1b; that guard gets edited, so the property key is the pointer.)
    refreshListenable: ref.watch(routerRefreshProvider),
    // 🔴 THE ORDERED GATE CHAIN LIVES IN `gates.dart` AND THE ORDER IS THE
    // WHOLE POINT — see `kGateChain`, which is the six gates in the order they
    // run. Reversing two of them is a behaviour change with a legal
    // consequence, not a tidy-up.
    redirect: (BuildContext context, GoRouterState state) =>
        appRedirect(ref, auth, state),
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
    // The route table, then the shell — the same declaration order the single
    // file had, and `go_router` matches in declaration order.
    routes: <RouteBase>[...appRoutes(), appShellRoute()],
  );
});
