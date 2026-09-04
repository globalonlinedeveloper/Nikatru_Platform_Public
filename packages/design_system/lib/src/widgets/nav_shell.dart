import 'package:flutter/material.dart';

import 'app_scaffold.dart';

/// One destination of a [NavShell], and the ROUTER LOCATION it stands for.
///
/// 🔴 THE TWO HALVES ARE SEPARATE ON PURPOSE, AND COLLAPSING THEM IS THE BUG
/// THIS TYPE EXISTS TO PREVENT. [location] answers "which tab should look
/// selected while the app is HERE?" and [onSelected] answers "what happens when
/// somebody TAPS this tab?". They look like one fact and they are not:
///
///   · A tab owns more locations than the one it navigates to — Settings owns
///     `/manage-plan` as well as `/settings` (see [alsoOwns]), and a shell that
///     derives selection from "the location I would navigate to" lights nothing
///     while the user is standing on the cancellation screen.
///   · The navigation VERB is the app's, not this widget's. A `ShellRoute` app
///     taps through `context.go(...)`; a `StatefulShellRoute` app taps through
///     `navigationShell.goBranch(i)`, which restores that branch's own stack and
///     is NOT the same call. Hard-coding either one here would force every app
///     onto one shell shape, and this package must not know which one an app
///     chose — it may not import the app's router at all.
///
/// So this widget owns the SELECTION rule (a real, testable decision with real
/// edge cases) and the app owns the navigation call.
@immutable
class NavTab {
  const NavTab({
    required this.destination,
    required this.location,
    required this.onSelected,
    this.alsoOwns = const <String>[],
  });

  /// The icons and label shown in the bar, rail or drawer.
  ///
  /// The LABEL is user-visible copy and this package deliberately supplies no
  /// default for it — the label arrives already localised, resolved by the app
  /// from its own arb. `tooling/ci/assert-no-hardcoded-strings.mjs` scans
  /// exactly two roots (the brick template and `apps/subly/lib`, :119-131) and
  /// NOT `packages/`, so an English sentence defaulted in here would be a
  /// shipped literal that escaped the guard by moving house.
  final AppDestination destination;

  /// The location this tab navigates to, and the primary one it OWNS.
  final String location;

  /// Further locations this tab owns for SELECTION only — never navigated to.
  ///
  /// A screen that hangs off a tab but is not the tab: the brick's
  /// `/manage-plan` hangs off Settings.
  ///
  /// 🔴 THIS IS WHAT DECIDES WHETHER THE SCREEN KEEPS THE NAVIGATION AT ALL,
  /// not merely which tab lights up. A location no tab owns renders bare (see
  /// [NavShell.build]), so leaving `/manage-plan` undeclared would take the bar
  /// away from the CANCELLATION screen — the one screen whose user must be able
  /// to leave. It is also why the list is per-tab rather than a flat set: the
  /// answer to "keep the chrome?" and "which tab?" is one declaration.
  ///
  /// Sub-locations need no entry: ownership already matches on a path boundary,
  /// so `/settings` owns `/settings/notifications` by itself.
  final List<String> alsoOwns;

  /// What tapping this destination does. See the class doc for why the widget
  /// does not simply navigate to [location] itself.
  final VoidCallback onSelected;
}

/// Does [owned] own [location]?
///
/// Exact match, or a sub-location of it on a PATH BOUNDARY — `/settings` owns
/// `/settings/notifications` but not `/settings-export`, which a bare
/// `startsWith` would hand it.
///
/// 🔴 `/` OWNS ONLY ITSELF. Every location starts with `/`, so under a bare
/// prefix rule the home tab owns the entire app — including the auth gates that
/// live ABOVE the shell, which no tab may claim.
///
/// ⚠️ THE `owned == '/'` LINE IS REDUNDANT WITH THE BOUNDARY FORM, AND IT IS
/// KEPT ON PURPOSE. For `owned == '/'` the boundary form is `'//'`, which no
/// location starts with, so either rule alone gives the right answer. MEASURED
/// by mutation, not assumed: breaking EITHER line on its own leaves all of
/// `test/nav_shell_test.dart` green, and breaking BOTH turns `/sign-in` into the
/// home tab's property. That is belt-and-braces rather than dead weight — the
/// day somebody "simplifies" `'$owned/'` to `owned`, this line is what still
/// keeps `/` honest — and saying which line is load-bearing is cheaper than a
/// reader deriving it from two-character string arithmetic.
bool _owns(String owned, String location) {
  if (owned == location) return true;
  if (owned == '/') return false;
  return location.startsWith('$owned/');
}

/// The index of the [NavTab] that owns [location], or null when none does.
///
/// LONGEST OWNED PREFIX WINS, so a nested tab beats the tab it nests under
/// (`/settings/billing` selects a `/settings/billing` tab rather than
/// `/settings`) regardless of declaration order. Order-independence is the
/// point: a selection rule that depends on which tab was listed first is a rule
/// that changes when somebody reorders the bar.
///
/// Pure and public so the rule is testable without pumping a shell at five
/// widths — the same reason `windowClassFor` is public in `app_scaffold.dart`.
///
/// NULL IS A REAL ANSWER, not a failure to compute one: it means the app is
/// somewhere no tab claims. See [NavShell.build] for what is done with it and
/// why it cannot simply be rendered as "nothing selected".
int? navIndexForLocation(String location, List<NavTab> tabs) {
  int? best;
  int bestLength = -1;
  for (int i = 0; i < tabs.length; i++) {
    for (final String owned in <String>[
      tabs[i].location,
      ...tabs[i].alsoOwns
    ]) {
      if (_owns(owned, location) && owned.length > bestLength) {
        best = i;
        bestLength = owned.length;
      }
    }
  }
  return best;
}

/// A PERSISTENT navigation shell: [AppScaffold]'s adaptive chrome with its
/// selected destination derived from the current router location.
///
/// ## What this adds to [AppScaffold], which is the whole reason it exists
/// [AppScaffold] answers "which navigation control does this WIDTH deserve?" —
/// bar, rail or drawer — and takes the selected destination as a plain index.
/// That index is exactly the fact a routed app does not have: it has a
/// LOCATION. Deriving one from the other is a decision with edge cases that
/// have all shipped somewhere as bugs — a screen that belongs to a tab without
/// being it, a sub-route that highlights nothing, a `/` prefix that swallows
/// the app, a rule that changes meaning when the bar is reordered — and until
/// now every app that grew a shell re-derived it privately.
///
/// Nothing here duplicates [AppScaffold]: the widths, the three controls and
/// the body cap are still its decisions and this widget passes straight through
/// to them.
///
/// ## What it deliberately does NOT do
/// **It does not navigate.** It calls [NavTab.onSelected] and knows nothing
/// about `go_router`, which is what lets one shell serve both a `ShellRoute`
/// app (`context.go`) and a `StatefulShellRoute` app (`goBranch`).
///
/// **It carries no copy.** There is not one user-visible string in this file;
/// every word on screen arrives through [NavTab.destination]'s label, resolved
/// by the app from its own arb.
///
/// **It does not put chrome on a screen no tab owns.** A location outside the
/// tab set — every auth gate, and the checkout — renders as the bare [child].
/// See [build] for the measurement that made that this widget's job rather than
/// the route table's.
class NavShell extends StatelessWidget {
  const NavShell({
    super.key,
    required this.tabs,
    required this.currentLocation,
    required this.child,
    this.title,
    this.floatingActionButton,
    this.compactNavigationBar,
  });

  /// The destinations, in bar order. Two or more — [AppScaffold] asserts it.
  final List<NavTab> tabs;

  /// The router location currently displayed, e.g. `GoRouterState.of(context)
  /// .matchedLocation` in a shell route's builder.
  final String currentLocation;

  /// The routed screen. In a `ShellRoute` this is the builder's `child`.
  ///
  /// 🔴 EACH DESTINATION SCREEN BRINGS ITS OWN `Scaffold` AND APP BAR in the
  /// chassis, so [title] is normally left null here. Passing both puts a shell
  /// app bar above the screen's own — two stacked bars, at every width.
  final Widget child;

  /// Optional shell-level app-bar title — see [child] before using it.
  final Widget? title;

  /// Passed straight to [AppScaffold].
  final Widget? floatingActionButton;

  /// Passed straight to [AppScaffold]'s compact-width seam — see
  /// `app_scaffold.dart` for why only the compact bar is replaceable.
  final Widget? compactNavigationBar;

  @override
  Widget build(BuildContext context) {
    final int? owner = navIndexForLocation(currentLocation, tabs);
    // ── NO TAB OWNS THIS LOCATION ⇒ NO CHROME ─────────────────────────────
    //
    // 🔴 THIS IS WHAT KEEPS A NAVIGATION BAR OUT FROM UNDER AN AUTH GATE, AND
    // IT IS A PROPERTY OF THIS WIDGET RATHER THAN OF WHERE A ROUTE WAS
    // DECLARED. The obvious way to keep the gates chrome-free is to mount them
    // ABOVE the shell on the root Navigator — which is what this chassis did
    // first, and it does not survive contact with go_router 14.8.1: the shell
    // then LEAVES the page stack whenever a gate covers it and RE-ENTERS on the
    // way back, and go_router keys the shell's Navigator with
    // `GlobalObjectKey(navigatorKey.hashCode)` (`builder.dart:287`), one per
    // ShellRoute. Two live shell pages therefore share one GlobalKey.
    // MEASURED on a stamped probe 2026-09-04: `Duplicate GlobalKey detected in
    // widget tree`, thrown out of `BuildOwner.finalizeTree`, on the ordinary
    // sign-in journey. With every route inside ONE always-mounted shell the
    // page never leaves, the key is never duplicated — and the gate is kept
    // bare by THIS line instead.
    //
    // ⚠️ IT IS NOT A FALLBACK OR A GUESS. `null` is the answer for every
    // location the tabs do not claim — sign-in, sign-up, verify-email,
    // reaccept-terms, reset-password, check-inbox, onboarding, the paywall —
    // so it is the common case, not an error case. An earlier version asserted
    // here instead, on the theory that an unowned location was an authoring
    // mistake; that theory belonged to the topology above, and it would now
    // crash a stamped app on its own sign-in screen.
    //
    // A screen that hangs off a tab and SHOULD keep the bar says so with
    // [NavTab.alsoOwns] — `/manage-plan` under Settings is the chassis's one
    // example.
    if (owner == null) return child;
    return AppScaffold(
      destinations: <AppDestination>[
        for (final NavTab t in tabs) t.destination,
      ],
      selectedIndex: owner,
      onDestinationSelected: (int i) => tabs[i].onSelected(),
      title: title,
      floatingActionButton: floatingActionButton,
      compactNavigationBar: compactNavigationBar,
      body: child,
    );
  }
}
