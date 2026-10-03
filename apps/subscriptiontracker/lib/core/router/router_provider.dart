// ═══════════════════════════════════════════════════════════════════════════
// THE ASSEMBLY — the one `GoRouter` this app has, and the only place the gate
// chain, the route table and the shell meet. Nothing is decided here; every
// decision is in the file it came from.
// ═══════════════════════════════════════════════════════════════════════════

import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core show NotificationTap;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../l10n/chassis_bridge.g.dart';
import '../../state/notification_tap_observer.dart'
    show NotificationTapRouter, ReminderActionHandler;
import '../../state/providers.dart';
import '../../state/share_inbox.dart';
import '../../state/subscriptions_controller.dart'
    show subscriptionsControllerProvider;
import 'gates.dart';
import 'navigator_key.dart';
import 'routes.dart';
import 'shell.dart';

/// Router is built once (authRepositoryProvider is a stable instance) and
/// refreshed on auth changes.
final Provider<GoRouter> routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authRepositoryProvider);
  // ST-T1b (audit A-7): watched for its EFFECT, and here because the router
  // lives as long as the app — lib/app.dart is a chassis fork held at its
  // ceiling (assert-chassis-parity). Marks the device once a session is seen.
  ref.watch(signedInBeforeKeeperProvider);

  final GoRouter router = GoRouter(
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

  // ST-R5 (audit C27): a tapped reminder opens the subscription it names —
  // here because the router is what opens it and lives as long as the app
  // (lib/app.dart is a chassis fork at its ceiling). The gate chain still runs
  // on the way: a signed-out tap lands on sign-in first.
  // NO-10: the reminder's BUTTONS — "Mark as paid" and "Snooze 1 day" —
  // on the same stream; the router above takes only body taps.
  final ReminderActionHandler actions = ReminderActionHandler(
    service: ref.read(notificationTapSourceProvider),
    markPaid: (String id) =>
        ref.read(subscriptionsControllerProvider.notifier).markPaid(id),
    snooze: (String id, int notificationId) => ref
        .read(subscriptionsControllerProvider.notifier)
        .snoozeReminder(id, notificationId: notificationId),
  )..start();
  ref.onDispose(actions.stop);
  final NotificationTapRouter taps = NotificationTapRouter(
    service: ref.read(notificationTapSourceProvider),
    open: router.go,
    onLaunchAction: (core.NotificationTap t) => unawaited(actions.handle(t)),
  );
  unawaited(taps.start());
  ref.onDispose(taps.stop);

  // IM-06: a file shared to the app opens the import hub with it — here for
  // the same reason as the taps above (the router opens it and lives as long
  // as the app).
  final ShareInboxRouter shares = ShareInboxRouter(
    source: ref.read(sharedImportSourceProvider),
    deliver: (f) => ref.read(importInboxProvider.notifier).deliver(f),
    open: router.go,
  );
  unawaited(shares.start());
  ref.onDispose(shares.stop);
  return router;
});

/// The error screen's copy in the user's language, asked for where the error
/// widget is BUILT (ST truth pass, EN-17) — null before the app's
/// localizations exist, which keeps the design system's English last resort
/// for an error in the very first build.
AppErrorCopy? appErrorCopy(BuildContext context) {
  final AppLocalizations? l10n = Localizations.of<AppLocalizations>(
    context,
    AppLocalizations,
  );
  return l10n == null
      ? null
      : (
          title: l10n.errorTitle,
          message: l10n.errorMessage,
          goHomeLabel: l10n.goHome,
        );
}

/// Subly's [AppErrorScreen.install]: localized copy and a "Go home" way out
/// (ST truth pass, EN-17). Here, not inline in main.dart, because main.dart is
/// a private copy of the chassis file and may not grow (chassis parity).
void installAppErrorScreen() =>
    AppErrorScreen.install(localized: appErrorCopy, onGoHome: goHomeAfterError);

/// The error screen's recovery: `/home`, through the root navigator — the
/// error widget replaces a subtree, so the router above it is still there.
void goHomeAfterError() => rootNavigatorKey.currentContext?.go('/home');
