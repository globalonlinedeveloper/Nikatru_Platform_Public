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

/// The address a confirmation mail was just sent to, as carried by
/// `context.go('/check-inbox', extra: …)`.
///
/// An empty string is treated as absent: a sign-up cannot have mailed nowhere,
/// so the honest answer for one is the same as for a missing address.
String? _pendingAddress(GoRouterState state) {
  final Object? extra = state.extra;
  return extra is String && extra.isNotEmpty ? extra : null;
}

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
            : '/verify-email';
      }
      // A verified user has no business on the waiting room; without this it is
      // reachable by typing the URL.
      if (state.matchedLocation == '/verify-email') return '/';

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
            : '/reaccept-terms';
      }
      // Reached by a signed-out visitor too, now that `/reaccept-terms` is a
      // [signedOutMayStay] location: they are handed to '/', which the
      // signed-out rule turns into '/sign-in' on the next pass. It terminates.
      if (state.matchedLocation == '/reaccept-terms') return '/';

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
      // ── THE TWO GATE SCREENS ────────────────────────────────────────────
      // Routed rather than dialog-shaped: both appear BECAUSE of a redirect, so
      // a dialog here would be a pageless route on a page being replaced as it
      // opens — the shape [ADR 027]'s deletion notice had to be rebuilt out of.
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
      GoRoute(
        path: '/reset-password',
        builder: (BuildContext context, GoRouterState state) =>
            const ResetPasswordScreen(),
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
