import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../features/auth/check_inbox_screen.dart';
import '../features/auth/reaccept_terms_screen.dart';
import '../features/auth/reset_password_screen.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/auth/verify_email_screen.dart';
import '../features/firstrun/onboarding_screen.dart';
import '../features/auth/sign_up_screen.dart';
import '../features/home/home_screen.dart';
import '../features/monetization/manage_plan_screen.dart';
import '../features/monetization/paywall_screen.dart';
import '../l10n/app_localizations.dart';
import '../state/providers.dart';
import '../features/settings/settings_screen.dart';

/// Thin seam onto `package:nikatru_core`'s shared implementation — the WHY,
/// and the measured incidents behind each rule, live in
/// `packages/core/lib/src/routing/gate_destination.dart`. It was duplicated
/// byte-for-byte in this file and in the other tree until 2026-09-04, which
/// meant a security fix to one was invisible to the other.
String? _pendingAddress(GoRouterState state) =>
    core.pendingAddress(state.extra);

/// Locations that must never be banked as a gate's `?next=` destination.
///
/// Nobody can be "returning" to any of these: four are the interstitials
/// themselves, and handing one back re-opens the gate the user has just
/// cleared. `/sign-in` is the load-bearing entry — `refreshListenable` can
/// re-run this redirect at `/sign-in` in the gap between the session appearing
/// and a screen's own post-sign-in `context.go(...)` landing, so a naive
/// capture banks `/sign-in`, and the signed-in bounce at the foot of the
/// redirect sends that straight home again.
///
/// 🔴 A DENYLIST ON PURPOSE, AND [signedOutMayStay] IS THE WRONG SET. An app is
/// free to put a REAL destination on its signed-out allowlist — apps/subly does
/// exactly that with `/scan`, which is where its sign-in form navigates — and
/// such a location must still be reachable after a gate. Deriving this from
/// "everything the signed-out rule tolerates" makes the capture a no-op for the
/// one journey it exists to protect.
const Set<String> _neverADestination = <String>{
  '/onboarding',
  '/sign-in',
  '/sign-up',
  '/check-inbox',
  '/verify-email',
  '/reaccept-terms',
  '/reset-password',
};

/// Thin seam onto `package:nikatru_core`'s shared implementation — the WHY,
/// and the measured incidents behind each rule, live in
/// `packages/core/lib/src/routing/gate_destination.dart`. It was duplicated
/// byte-for-byte in this file and in the other tree until 2026-09-04, which
/// meant a security fix to one was invisible to the other.
String _gateWithNext(String gate, GoRouterState state) => core.gateWithNext(
  gate,
  matchedLocation: state.matchedLocation,
  uri: state.uri,
  neverADestination: _neverADestination,
);

/// Thin seam onto `package:nikatru_core`'s shared implementation — the WHY,
/// and the measured incidents behind each rule, live in
/// `packages/core/lib/src/routing/gate_destination.dart`. It was duplicated
/// byte-for-byte in this file and in the other tree until 2026-09-04, which
/// meant a security fix to one was invisible to the other.
String _nextOr(GoRouterState state, String fallback) =>
    core.nextOr(state.uri, fallback, neverADestination: _neverADestination);

/// The ROOT Navigator's key — named, so the one Navigator above the shell has
/// an identity that dialogs, and any future above-shell route, can address.
///
/// 🔴 IT IS NO LONGER ON ANY ROUTE, AND THAT IS A MEASUREMENT, NOT A TIDY-UP.
/// The first version of this shell put the auth gates ABOVE the shell as
/// top-level siblings, each with `parentNavigatorKey: rootNavigatorKey`, so a
/// gate's page covered the navigation bar. It stamped and it crashed. Two
/// findings, both from a probe run on 2026-09-04:
///
///   1. A route that sits above the shell makes the shell LEAVE the page stack
///      and RE-ENTER it. go_router keys the shell's Navigator with
///      `GlobalObjectKey(navigatorKey.hashCode)` — one key per `ShellRoute`
///      instance (`go_router-14.8.1/lib/src/builder.dart:287`) — so the moment
///      an outgoing shell page and an incoming one are alive in the same frame
///      they claim the same GlobalKey: `Duplicate GlobalKey detected in widget
///      tree`, thrown from `BuildOwner.finalizeTree`, on the ordinary sign-in
///      journey. It is not a test artefact — the window is real in a shipped
///      app, it is just short (one page transition).
///   2. The obvious repair — keep the gates as CHILDREN of the shell so the
///      shell never leaves, but let them escape upward with
///      `parentNavigatorKey: rootNavigatorKey` — is FORBIDDEN by go_router:
///      `route.dart:481` asserts *"sub-route's parent navigator key must either
///      be null or has the same navigator key as parent's key"*. Measured: 47
///      failing tests, every one of them that assertion.
///
/// So the gates keep their chrome-free full screen a different way — see the
/// shell's own comment below and `NavShell.build`: a location no tab owns
/// renders bare. The invariant "no navigation bar under a gate" moved from
/// WHERE A ROUTE IS DECLARED to a widget that can be tested, which is the
/// stronger place for it.
///
/// ⚠️ ADDING A ROUTE OUTSIDE THE SHELL REOPENS FINDING 1. If one ever has to
/// live up here, it must be a route the app never leaves the shell FOR and
/// comes back from — and the probe's chassis property run is what will say so.
final GlobalKey<NavigatorState> rootNavigatorKey = GlobalKey<NavigatorState>();

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
    navigatorKey: rootNavigatorKey,
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
      // 🔴 A SEPARATE PREDICATE, AND THE `/reaccept-terms` ENTRY IS THE SECOND
      // HALF OF A TWO-PART FIX. It is not redundant with the `signedIn`
      // condition on the gate below. MEASURED in the app tree the same day this
      // template was written (2026-08-10, real router, real provider): with the
      // gate unconditioned and this list absent, a signed-out visitor on a
      // fresh install went `/sign-in` → `/reaccept-terms` → (not signed in, not
      // an auth screen) → `/sign-in` → … past go_router's redirect limit, and
      // the errorBuilder rendered NotFoundScreen. EVERY STAMPED APP WOULD HAVE
      // BEEN BORN UNABLE TO SIGN IN, on every install and again after every
      // `kTermsVersion` bump.
      // Conditioning the gate on `signedIn` is the real fix; this entry is the
      // containment — the worst case if that condition is ever edited away is a
      // visitor parked on an interstitial they can complete and leave, never a
      // 404 with no way back to the form. Kept apart from [onAuthScreen]
      // because that one also drives the signed-IN bounce below, where
      // `/reaccept-terms` has a different answer.
      // 🔴 `/check-inbox` IS IN HERE BECAUSE ITS WHOLE AUDIENCE IS SIGNED OUT.
      // With "Confirm email" ON, `signUp` returns a user and NO SESSION, so the
      // person who has just registered is signed out by every test this router
      // makes. Left out of this list they are bounced to `/sign-in` the instant
      // the sign-up screen sends them here — which is the stranding this
      // destination exists to end, arriving one line later.
      //
      // 🔴 `/reset-password` IS IN HERE FOR A REASON THE OTHERS DO NOT SHARE,
      // and dropping it turns the commonest failure of this feature into a
      // silent one. A reset link that has expired, been used already, or been
      // opened where the PKCE code verifier was never stored mints NO SESSION —
      // so the person arrives signed out, and without this entry the guard
      // bounces them to `/sign-in` with no explanation at all. They came from
      // their inbox, followed the instruction, and the app answers by showing
      // them the same form they could not get past. The screen's dead-link state
      // get past.
      //
      // ⚠️ THIS ENTRY IS NECESSARY AND WAS NEVER SUFFICIENT, which is what the
      // review caught: it lets a signed-out visitor STAND here, and nothing
      // used to PUT them here. `passwordResetArrivalProvider` is what does —
      // it reads the marker gotrue preserves in the query and the seam's
      // `recoveryLinkFailed` event, and the recovery gate below acts on both.
      // Without that provider this allowance is a room with no door to it.
      final bool signedOutMayStay =
          onAuthScreen ||
          state.matchedLocation == '/reaccept-terms' ||
          state.matchedLocation == '/check-inbox' ||
          state.matchedLocation == '/reset-password';
      // Signed out and heading somewhere gated → the sign-in screen.
      if (!signedIn && !signedOutMayStay) return '/sign-in';

      // ── PASSWORD RECOVERY, ABOVE THE VERIFICATION GATE ───────────────────
      // 🔴 THE ONLY THING THAT KNOWS WHY THE APP WAS OPENED. A recovery session
      // is an ordinary session — same user, same token — so nothing further down
      // can tell this person apart from somebody who just signed in, and they
      // would be handed the home screen instead of the form they came for. The
      // distinction survives only because `authEvents()` carries it and
      // `passwordRecoveryProvider` holds it; see that provider.
      //
      // 🔴 ABOVE THE VERIFICATION GATE ON PURPOSE. Following the recovery link
      // PROVES the mailbox — it is the same proof `/verify-email` is asking
      // for — so bouncing this user to "check your inbox" sends them back to the
      // inbox they just came from, and the Resend button there sends a SIGN-UP
      // confirmation, which is the wrong mail entirely. Above the re-acceptance
      // gate for the ordinary reason: nobody should be asked to agree to terms
      // as the price of getting back into their account.
      //
      // 🔴 AND THE ARRIVAL IS READ ALONGSIDE IT, WHICH IS WHAT MAKES THE
      // FAILURE PATH REACHABLE AT ALL. `passwordRecoveryProvider` arms on the
      // SUCCESS event and on nothing else, so a link that cannot be exchanged —
      // expired, already spent, or opened where the PKCE verifier was never
      // stored — routed nowhere: the person landed on `/`, was bounced to
      // `/sign-in`, and the screen that explains their exact situation was
      // unreachable from the situation. `passwordResetArrivalProvider` reads the
      // launch URL and the seam's `recoveryLinkFailed` event, so BOTH halves of
      // the feature land here now. See `shouldHoldForPasswordReset`.
      if (shouldHoldForPasswordReset(
        recovering: ref.read(passwordRecoveryProvider),
        arrival: ref.read(passwordResetArrivalProvider).arrival,
      )) {
        return state.matchedLocation == '/reset-password'
            ? null
            : '/reset-password';
      }
      // A signed-IN user with no recovery in flight has no business here — the
      // screen would offer a silent password rotation on whatever session is in
      // hand. Conditioned on `signedIn` so the signed-OUT dead-link case above
      // still reaches its explanation.
      if (signedIn && state.matchedLocation == '/reset-password') return '/';

      // ── EMAIL VERIFICATION, ABOVE EVERYTHING THE USER CAME FOR ───────────
      // Owner lock, 2026-08-09: verification is MANDATORY for email+password
      // registration, because email is the matching key the one-identity lock
      // merges social sign-ins on — so an address nobody proved is a route into
      // somebody else's Google/Apple account.
      //
      // 🔴 THE CLIENT HALF IS NOT REDUNDANT WITH THE SUPABASE DASHBOARD SWITCH.
      // With "Confirm email" OFF, gotrue hands back a full session on sign-up
      // and this gate is the ONLY refusal in the system. Stamped into the
      // template rather than left to each app, because a security default that
      // depends on every future app remembering it is one app #3 forgets.
      //
      // 🔴 ABOVE THE RE-ACCEPTANCE GATE ON PURPOSE. Reversed, an unverified user
      // would be asked to accept the terms first — recording a legal acceptance
      // against an identity nobody has proven.
      if (core.sessionIsUnverified(auth.currentUser)) {
        return state.matchedLocation == '/verify-email'
            ? null
            : _gateWithNext('/verify-email', state);
      }
      // A verified user has no business on the waiting room; without this it is
      // reachable by typing the URL.
      //
      // 🔴 `next`, NOT A HARD-CODED HOME. A gate must give back the destination
      // it took. Substituting one is invisible to every test that asserts only
      // that the user reached the INTERSTITIAL — apps/subly shipped exactly
      // that in #280 and the nightly E2E was the first thing to notice, three
      // weeks later, when a signed-in user bound for /scan kept arriving home.
      if (state.matchedLocation == '/verify-email') {
        return _nextOr(state, '/');
      }

      // ── MATERIAL-CHANGE RE-ACCEPTANCE (research/43) ──────────────────────
      // `read`, not `watch`, for the same reason onboarding is read: watching
      // rebuilds the ROUTER and throws away the stack.
      //
      // 🔴 NULL DECLINES TO DECIDE — the acceptance hydrates from disk async,
      // and treating "not read yet" as "not accepted" flashes the interstitial
      // at every launch. Same three-state shape, same measured reason, as
      // `onboardingSeenProvider`.
      //
      // 🔴 `signedIn` IS LOAD-BEARING. A person with no session cannot owe an
      // acceptance — there is nobody to have accepted. Unconditioned, this gate
      // fires for signed-OUT visitors, who the rule above then bounces straight
      // back: `/sign-in` → `/reaccept-terms` → `/sign-in` → … until go_router
      // gives up and shows NotFoundScreen. See [signedOutMayStay] above for the
      // measurement; a stamped app carrying that defect cannot be signed into
      // on any install.
      final bool? mustReaccept = signedIn
          ? ref.read(legalReacceptanceNeededProvider)
          : false;
      if (mustReaccept == null) return null;
      if (mustReaccept) {
        return state.matchedLocation == '/reaccept-terms'
            ? null
            : _gateWithNext('/reaccept-terms', state);
      }
      // Reached by a signed-out visitor too, now that `/reaccept-terms` is a
      // [signedOutMayStay] location: they are handed to '/' — no `next` was
      // ever banked for them — which the signed-out rule turns into '/sign-in'
      // on the next pass. It terminates.
      //
      // 🔴 THE STAMPED TWIN OF THE LINE THAT ATE apps/subly's DESTINATION.
      // #280 (a6a0646) put this gate in front of everything, and the hard-coded
      // home here meant a user signing in and navigating to their own landing
      // screen was silently delivered to the home tab instead. See
      // [_neverADestination] for why the exclusion set is a denylist.
      if (state.matchedLocation == '/reaccept-terms') {
        return _nextOr(state, '/');
      }

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
    // ═══════════════════════════════════════════════════════════════════════
    // THE ROUTE TABLE — ONE shell, and every route inside it.
    //
    // 🔴 WHY THE SHELL EXISTS. Every route used to be flat, so the navigation
    // bar could only live INSIDE a screen — it was built by `HomeScreen`, and
    // `context.go('/settings')` replaced the screen that owned it. Settings and
    // Manage-plan were therefore dead ends in every app the factory stamps: no
    // bar, no back control, and on web and desktop no reliable system Back
    // either. Manage-plan is the CANCELLATION screen, so that was an app-store
    // review risk, not only a papercut.
    //
    // 🔴 WHY EVERY ROUTE IS INSIDE IT, INCLUDING THE ONES THAT SHOW NO BAR.
    // The shape you would write first — gates ABOVE the shell, tabs inside —
    // was written first, stamped, and it CRASHED. A route above the shell makes
    // the shell leave the page stack and come back, and go_router gives the
    // shell's Navigator one process-wide `GlobalObjectKey` per `ShellRoute`
    // (`go_router-14.8.1/lib/src/builder.dart:287`), so an outgoing shell page
    // and an incoming one claim the same key in one frame: `Duplicate GlobalKey
    // detected in widget tree`, on the ordinary sign-in journey. The repair
    // that keeps both properties — gates as shell CHILDREN that escape upward
    // with `parentNavigatorKey` — is forbidden outright by `route.dart:481`
    // (*"sub-route's parent navigator key must either be null or has the same
    // navigator key as parent's key"*): 47 tests, all that one assertion.
    //
    // So the shell is mounted for EVERY location and never leaves, and what
    // decides whether a screen shows navigation is `NavShell`: a location no
    // tab owns renders bare. Each entry below says which it is and why. The
    // ordering is unchanged — go_router matches in declaration order.
    // ═══════════════════════════════════════════════════════════════════════
    routes: <RouteBase>[
      // ── THE SHELL ───────────────────────────────────────────────────────
      // ONE `ShellRoute` over the whole table, mounted for the app's entire
      // life. Its `builder` runs for every location; `AppShell` decides, per
      // location, whether that means chrome or a bare screen.
      //
      // A `ShellRoute` rather than a `StatefulShellRoute`, deliberately, and the
      // difference is one Navigator versus one per branch:
      //   · Each destination is a SINGLE screen with nothing pushed on top of
      //     it, so there is no per-branch stack to preserve — which is the
      //     entire thing `StatefulShellRoute` buys.
      //   · It keeps ONE navigation verb in the chassis. `context.go(location)`
      //     is what every screen, the promo card and the settings register row
      //     already speak, and it is what `assert-purchase-path.mjs:369-378`
      //     reads to derive the ROSCA step counts. `goBranch(i)` is invisible to
      //     that guard, so a branch shell would make the measured navigation
      //     graph a subset of the real one.
      //   · `StatefulShellBranch` mints a `GlobalKey` per branch, which is why
      //     apps/subly's route list has to be a function rather than a shared
      //     value (`lib/core/router/routes.dart:6-11`) — a cost worth paying for
      //     five stateful tabs and not for three leaves.
      // The day a stamped app grows a stack inside a tab, `StatefulShellRoute`
      // is the upgrade — and the guard has to learn `goBranch` first.
      ShellRoute(
        // 🔴 `state.uri.path` IS PASSED DOWN, NOT RE-READ WITH
        // `GoRouterState.of(context)` INSIDE THE SHELL. Measured 2026-09-04 on a
        // stamped probe: the `.of(context)` version threw
        // `InheritedGoRouter … '_dependents.isEmpty': is not true` — 73 times in
        // one run, taking 37 property tests with it. A shell that reads the
        // router through an inherited lookup registers a DEPENDENCY on an
        // element go_router disposes while the shell is still mounted across a
        // route change; the builder already HANDS the state, so the lookup buys
        // nothing and costs that. `NavShell` takes a plain `String` for exactly
        // this reason — see its `currentLocation` doc.
        builder: (BuildContext context, GoRouterState state, Widget child) =>
            AppShell(location: state.uri.path, child: child),
        routes: <RouteBase>[
          // ── NO CHROME: THE AUTH GATES ──────────────────────────────────
          // All five are reached BY A REDIRECT from `redirect:` above, and each
          // one exists to stop a user going somewhere. A nav bar under any of
          // them is a one-tap way past the thing the gate is for — so none of
          // these locations appears in any `NavTab` (`home_screen.dart`), and
          // `NavShell` therefore renders them with no bar, rail or drawer at
          // all. THAT is the enforcement; it is checked by
          // `packages/design_system/test/nav_shell_test.dart` rather than
          // inferred from where these lines sit in this file.
          //
          // `/sign-in` and `/sign-up`: there is no session yet, so there is
          // nothing for the tabs to show — every destination is a gated
          // surface.
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
          // Onboarding is what EXPLAINS the app, before there is an account.
          // A user who could tab away from it has not been onboarded, and the
          // redirect above would only put them straight back — a loop the tabs
          // would appear to cause. Owned by no tab, so there are none.
          GoRoute(
            path: '/onboarding',
            builder: (BuildContext context, GoRouterState state) =>
                const OnboardingScreen(),
          ),
          // ── THE TWO GATE SCREENS ────────────────────────────────────────────
          // Routed rather than dialog-shaped: both appear BECAUSE of a redirect, so
          // a dialog here would be a pageless route on a page being replaced as it
          // opens — the shape [ADR 027]'s deletion notice had to be rebuilt out of.
          //
          // Chrome-free for the sharper version of the same reason: these two
          // are the gates the redirect enforces on a user who DOES have a
          // session, so a bar under them would be one tap away from an
          // unverified account or from terms nobody accepted.
          GoRoute(
            path: '/verify-email',
            builder: (BuildContext context, GoRouterState state) =>
                const VerifyEmailScreen(),
          ),
          GoRoute(
            path: '/reaccept-terms',
            builder: (BuildContext context, GoRouterState state) =>
                const ReacceptTermsScreen(),
          ),
          // ── THE NO-SESSION HALF OF EMAIL CONFIRMATION ────────────────────────
          // Reached from the sign-up screen when `signUp` returns a user but no
          // session. `/verify-email` cannot serve this person: its gate is
          // `sessionIsUnverified`, which answers FALSE for a null user by design.
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
          //
          // Chrome-free: its whole audience is SIGNED OUT (sign-up returned a
          // user and no session), so tabs here would lead nowhere but back to
          // `/sign-in`.
          GoRoute(
            path: '/check-inbox',
            redirect: (BuildContext context, GoRouterState state) =>
                _pendingAddress(state) == null ? '/sign-in' : null,
            builder: (BuildContext context, GoRouterState state) =>
                CheckInboxScreen(email: _pendingAddress(state)!),
          ),
          // Where a password-reset link lands. Reachable by a SIGNED-OUT visitor on
          // purpose — see `signedOutMayStay` above — because a link that could not
          // complete its exchange leaves exactly that state, and it is the state
          // this screen exists to explain.
          //
          // Chrome-free for the gate reason AND a second one this route does
          // not share with the others: the person here cannot get into their
          // account at all, so every tab would be a locked door.
          GoRoute(
            path: '/reset-password',
            builder: (BuildContext context, GoRouterState state) =>
                const ResetPasswordScreen(),
          ),
          // ── NO CHROME: THE CHECKOUT ([pipeline 5]M-6) ──────────────────
          //
          // NOT a gate — the only chrome-free route that is not. A purchase flow
          // with a navigation bar underneath it is a way out of a funnel
          // mid-transaction, which is apps/subly's reading too
          // (`lib/core/router/routes.dart:154`). It is not a dead end: the
          // screen carries its own way back (`paywall_screen.dart:251`).
          //
          // 🔴 THIS ROUTE AND `/manage-plan` ARE THE STEP-COUNT SOURCE.
          // `assert-purchase-path.mjs` derives the purchase step count and the
          // cancel step count from THIS file, from the same navigation graph, so
          // ROSCA's "cancelling is no harder than buying" is checked against the
          // router rather than against somebody's description of it. Renaming a
          // path here changes both counts together, which is the point.
          GoRoute(
            path: '/paywall',
            builder: (BuildContext context, GoRouterState state) =>
                const PaywallScreen(),
          ),
          // ── THE TABS ────────────────────────────────────────────────────
          // The three destinations a signed-in user moves BETWEEN, and the one
          // screen that hangs off one of them. These are the locations a
          // `NavTab` OWNS (`home_screen.dart`), which is what makes the shell
          // draw its chrome around them.
          GoRoute(
            path: '/',
            builder: (BuildContext context, GoRouterState state) =>
                const HomeScreen(),
          ),
          // The premium destination. It was a TAB INDEX inside the home screen
          // and never a location, so nothing could link to it, `/explore` 404ed,
          // and the paywall gate was decided by a `setState` — see
          // `ExploreScreen`.
          GoRoute(
            path: '/explore',
            builder: (BuildContext context, GoRouterState state) =>
                const ExploreScreen(),
          ),
          GoRoute(
            path: '/settings',
            builder: (BuildContext context, GoRouterState state) =>
                const SettingsScreen(),
          ),
          // ── THE CANCELLATION SCREEN ([pipeline 5]M-9) ──────────────────
          // KEEPS THE CHROME, unlike the checkout above it, and the asymmetry
          // is the argument: the reason to keep a nav bar out of a purchase
          // funnel is that it is a way out of the funnel, and a way out is
          // exactly what this screen owes its user. It is where cancelling
          // happens, so a user who cannot leave it is the review risk.
          //
          // It is not a tab of its own; the Settings destination OWNS it
          // (`home_screen.dart`, `NavTab.alsoOwns`), because that is the
          // register row it hangs off — and that declaration is the only reason
          // the bar is here at all. The screen also carries its own back
          // control to `/settings` — the bar answers "somewhere else", the back
          // control answers "back".
          GoRoute(
            path: '/manage-plan',
            builder: (BuildContext context, GoRouterState state) =>
                const ManagePlanScreen(),
          ),
        ],
      ),
    ],
  );
});
