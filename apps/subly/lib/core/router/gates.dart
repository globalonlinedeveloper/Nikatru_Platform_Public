// ═══════════════════════════════════════════════════════════════════════════
// THE GATE CHAIN — the whole of the router's `redirect`, one function per gate.
//
// 🔴 THE ORDER OF [kGateChain] IS THE MOST LOAD-BEARING THING IN THIS APP, AND
// IT IS WHY THIS IS A LIST OF NAMED FUNCTIONS RATHER THAN ONE LONG METHOD. The
// sequence is now six lines that can be read at once, and each gate carries the
// measured reason it sits where it does on the gate itself. Three of those
// reasons are incidents rather than opinions, and every one of them is recorded
// in full below:
//
//   · VERIFICATION ABOVE RE-ACCEPTANCE — reverse the two and an unverified user
//     is asked to accept the terms first, recording a legal acceptance against
//     an identity nobody has proven.
//   · RECOVERY ABOVE VERIFICATION — following a recovery link IS proof of the
//     mailbox, so bouncing that user to `/verify-email` sends them back to the
//     inbox they just came from, where the Resend button sends a SIGN-UP
//     confirmation: the wrong mail entirely.
//   · THE SIGNED-OUT RULE ABOVE BOTH, and the re-acceptance gate conditioned on
//     `loggedIn` — without it a fresh install went `/sign-in` →
//     `/reaccept-terms` → `/sign-in` → … past go_router's redirect limit and
//     the app could not be signed into at all.
//
// P1b MOVED LINES, NOT BEHAVIOUR. The chain is composed in the SAME order it
// ran in when this was one 220-line closure, every comment travels with the
// code it explains, and `_gateWithNext` and `_nextOr` are still the thin
// wrappers onto `package:nikatru_core` that PR #449 left behind — NOT
// re-inlined. (The third of that set, `_pendingAddress`, has its one caller in
// `routes.dart` and travelled there.)
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../state/providers.dart';

/// Locations that must never be banked as a gate's `?next=` destination.
///
/// 🔴 `/scan` IS DELIBERATELY ABSENT, AND THAT ABSENCE IS THE FIX. `/scan` sits
/// on the signed-out `authFlow` allowlist below, but it is ALSO the real
/// post-sign-in destination — `LoginScreen._submit` ends on
/// `context.go('/scan')` — so excluding every `authFlow` path (the obvious
/// reading) makes the capture a no-op for the one journey that regressed.
///
/// What IS listed is listed because nobody can be "returning" to it: four are
/// the interstitials themselves, and handing one back re-opens the gate the
/// user has just cleared. `/sign-in` is the load-bearing entry —
/// `refreshListenable` can re-run this redirect at `/sign-in` in the gap
/// between the session appearing and `context.go('/scan')` landing, so a naive
/// capture banks `/sign-in`, and the signed-in rule at the foot of the redirect
/// bounces that straight home again: the regression, unchanged.
const Set<String> _neverADestination = <String>{
  '/onboarding',
  '/login',
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

/// One gate's answer — and the reason this is a wrapper rather than a `String?`.
///
/// 🔴 A GATE HAS THREE ANSWERS, NOT TWO, AND CONFLATING TWO OF THEM IS EXACTLY
/// HOW THIS CHAIN BREAKS. `GoRouter.redirect` has only two — a location, or
/// `null` meaning "leave the user where they are" — but that `null` is a
/// DECISION, and three gates below return it deliberately: the onboarding gate
/// while the first-run flag is still coming off disk, the recovery gate when the
/// user is already standing on `/reset-password`, the re-acceptance gate while
/// the acceptance is still hydrating. A chain that read `null` as "no opinion,
/// ask the next gate" would fall straight THROUGH those into the gate below —
/// which is the shape of the infinite redirect the re-acceptance gate records.
///
/// So a gate returns `null` to ABSTAIN and a [GateVerdict] to DECIDE, and
/// [GateVerdict.destination] carries `redirect`'s own two answers unchanged. The
/// type is what makes the mistake unwritable: a gate that means to decide and
/// forgets the wrapper does not compile.
class GateVerdict {
  const GateVerdict(this.destination);

  /// Exactly what `GoRouter.redirect` returns: a location to send the user to,
  /// or `null` to leave them standing where they are.
  final String? destination;
}

/// Everything the gates read, gathered once per `redirect` pass.
class GateContext {
  GateContext({required this.ref, required this.auth, required this.state});

  /// Read with `read`, never `watch`, at every use below — watching here
  /// rebuilds the ROUTER and throws away the navigation stack. The rule is
  /// restated at each call site because each one was written to it separately.
  final Ref ref;

  final core.AuthRepository auth;

  final GoRouterState state;

  /// `state.matchedLocation`. Every gate tests it, so it is named once.
  String get loc => state.matchedLocation;

  /// 🔴 `late final`, AND THAT IS NOT A MICRO-OPTIMISATION. Before P1b this was
  /// one `final bool loggedIn = auth.currentUser != null;` evaluated exactly
  /// once, and evaluated AFTER the onboarding gate had already decided — so a
  /// first run never read the session at all. A plain getter would read it once
  /// per asking gate (four of them); an eager field would read it on the
  /// first-run path that never did. `late final` is the one spelling that
  /// reproduces both halves of what the old closure did.
  late final bool loggedIn = auth.currentUser != null;
}

// Where a user who has NOT completed onboarding belongs: the carousel, unless
// they are standing on it already.
//
// 🔴 ITS OWN FUNCTION BECAUSE THE STATEMENT IS ANCHORED, NOT BECAUSE IT IS
// REUSED — it has exactly one caller. `tooling/ci/assert-stamp-properties.mjs`
// pins the `onboarding-shown-once` property to this statement VERBATIM, in this
// app's router spine. `apps/subly` is in that guard's `EXEMPT_APPS`, so the
// match is COUNTED by the ratchet rather than graded — and the ratchet fails in
// BOTH directions, so an anchor that quietly stops matching is scored as the
// property being gone. Folding this into the gate's verdict
// (`return GateVerdict(state.matchedLocation == …);`) spells the same rule in a
// shape the anchor cannot see. Keep it one statement, spelled exactly this way.
String? firstRunDestination(GoRouterState state) {
  return state.matchedLocation == '/onboarding' ? null : '/onboarding';
}

// [pipeline C-13] ONBOARDING COMES FIRST, before the auth gate.
//
// `read`, not `watch`: watching here would rebuild the ROUTER on every
// change and throw away the navigation stack.
// 🔴 RETURNS EARLY, and that is the whole subtlety. Onboarding must be
// EXEMPT from the auth gate below: a first run happens before there is an
// account, so falling through would hand '/onboarding' to the signed-out
// rule, and the user never sees onboarding at all.
GateVerdict? onboardingGate(GateContext ctx) {
  final bool? onboarded = ctx.ref.read(onboardingSeenProvider);
  // Still reading the disk. Decline to decide rather than guessing.
  if (onboarded == null) return const GateVerdict(null);
  if (!onboarded) return GateVerdict(firstRunDestination(ctx.state));
  // LIVE DIVERGENCE FROM THE STAMP: home is '/home' here, not '/'.
  if (ctx.loc == '/onboarding') return const GateVerdict('/home');
  return null;
}

// ── THE SIGNED-OUT RULE ─────────────────────────────────────────────────────
// Everything outside the allowlist below belongs to somebody with a session.
GateVerdict? signedOutGate(GateContext ctx) {
  final String loc = ctx.loc;
  final bool loggedIn = ctx.loggedIn;
  // Every location a SIGNED-OUT user is allowed to stay on. `/login` is
  // still in here even though it now renders nothing, and that is load
  // bearing rather than leftover — see below.
  const List<String> authFlow = <String>[
    '/onboarding',
    '/login',
    '/sign-in',
    '/sign-up',
    '/scan',
    // 🔴 ITS WHOLE AUDIENCE IS SIGNED OUT, WHICH IS WHY IT HAS TO BE HERE.
    // With "Confirm email" ON, `signUp` returns a user and NO SESSION, so
    // the person who has just registered fails `loggedIn` like any visitor.
    // Left out of this list they are bounced to `/sign-in` the instant the
    // sign-up screen sends them here — the stranding this destination
    // exists to end, arriving one line later.
    '/check-inbox',
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
    // 🔴 IN HERE FOR A REASON THE OTHERS DO NOT SHARE, and removing it turns
    // the commonest failure of password reset into a silent one. A link that
    // has expired, been used, or been opened where the PKCE code verifier
    // was never stored mints NO SESSION — the person arrives SIGNED OUT.
    // Without this entry the guard bounces them to `/sign-in` with no
    // explanation: they came from their inbox, did exactly as instructed,
    // and the app answers by showing them the form they already could not
    // get past.
    //
    // ⚠️ THIS ENTRY IS NECESSARY AND WAS NEVER SUFFICIENT, which is what the
    // review caught: it lets a signed-out visitor STAND here, and nothing
    // used to PUT them here. `passwordResetArrivalProvider` is what does —
    // it reads the marker gotrue preserves in the query and the seam's
    // `recoveryLinkFailed` event, and the recovery gate below acts on both.
    // Without that provider this allowance is a room with no door to it.
    '/reset-password',
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
  if (!loggedIn && !authFlow.contains(loc)) {
    return const GateVerdict('/sign-in');
  }
  return null;
}

// ── PASSWORD RECOVERY, AND IT SITS ABOVE THE VERIFICATION GATE ────────
// 🔴 THE ONLY THING IN THE APP THAT KNOWS WHY IT WAS OPENED. A recovery
// session is an ordinary session — same user, same token, same emission on
// `authStateChanges()` — so every gate below this one would see somebody
// who has just signed in and hand them the home screen. The person came
// to set a password. The distinction survives only because `authEvents()`
// now carries it and `passwordRecoveryProvider` holds it; the Supabase
// adapter used to map it away, which is why this feature had no landing
// point at all.
//
// 🔴 ABOVE THE VERIFICATION GATE ON PURPOSE, AND FOR A DIFFERENT REASON
// THAN THE ONE THAT PUTS VERIFICATION ABOVE RE-ACCEPTANCE. Following the
// recovery link IS proof of the mailbox — the same proof `/verify-email`
// exists to collect — so bouncing this user there sends them back to the
// inbox they just came from, and the Resend button on that screen sends a
// SIGN-UP confirmation, which is the wrong mail entirely. It is above
// re-acceptance for the plainer reason: agreeing to terms must not be the
// price of getting back into an account.
//
// `read`, not `watch` — watching rebuilds the ROUTER and throws away the
// stack, the same rule the onboarding and legal reads follow.
// `routerRefreshProvider` is what re-runs this when the event lands.
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
GateVerdict? passwordRecoveryGate(GateContext ctx) {
  final Ref ref = ctx.ref;
  final String loc = ctx.loc;
  final bool loggedIn = ctx.loggedIn;
  if (shouldHoldForPasswordReset(
    recovering: ref.read(passwordRecoveryProvider),
    arrival: ref.read(passwordResetArrivalProvider).arrival,
  )) {
    return GateVerdict(loc == '/reset-password' ? null : '/reset-password');
  }
  // A signed-IN user with no recovery in flight has no business here: the
  // screen would offer a silent password rotation on whatever session is in
  // hand. 🔴 CONDITIONED ON `loggedIn` so the signed-OUT dead-link case
  // above still reaches its explanation instead of being bounced.
  if (loggedIn && loc == '/reset-password') return const GateVerdict('/home');
  return null;
}

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
GateVerdict? emailVerificationGate(GateContext ctx) {
  final GoRouterState state = ctx.state;
  final String loc = ctx.loc;
  if (core.sessionIsUnverified(ctx.auth.currentUser)) {
    return GateVerdict(
      loc == '/verify-email' ? null : _gateWithNext('/verify-email', state),
    );
  }
  // A verified user has no business on the waiting room. Without this the
  // screen is reachable by typing the URL and shows "check your inbox" to
  // somebody who already did.
  //
  // 🔴 `next`, NOT A HARD-CODED '/home' — see the re-acceptance exit below
  // for the measured cost of substituting a destination here. A user who
  // verifies mid-journey is owed the screen they were heading for, and a
  // `next` banked by THIS gate can be re-banked by the re-acceptance gate
  // one block down, so the two chain rather than cancelling each other.
  if (loc == '/verify-email') return GateVerdict(_nextOr(state, '/home'));
  return null;
}

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
GateVerdict? legalReacceptanceGate(GateContext ctx) {
  final Ref ref = ctx.ref;
  final GoRouterState state = ctx.state;
  final String loc = ctx.loc;
  final bool loggedIn = ctx.loggedIn;
  final bool? mustReaccept = loggedIn
      ? ref.read(legalReacceptanceNeededProvider)
      : false;
  if (mustReaccept == null) return const GateVerdict(null);
  if (mustReaccept) {
    return GateVerdict(
      loc == '/reaccept-terms' ? null : _gateWithNext('/reaccept-terms', state),
    );
  }
  // Reached by a signed-out visitor too, now that `/reaccept-terms` is in
  // `authFlow`: they are handed to '/home' — no `next` was ever banked for
  // them — which the signed-out rule turns into '/sign-in' on the next
  // pass. Two hops, and it terminates.
  //
  // 🔴 THIS LINE ATE THE DESTINATION, AND THE NIGHTLY E2E IS WHAT NOTICED.
  // #280 (a6a0646) put the gate in front of everything. A user signing in
  // runs `context.go('/scan')` (login_screen.dart `_submit`), the gate
  // intercepts, and this line then handed them '/home' instead of the
  // '/scan' they were going to. ScanScreen is the ONLY renderer of
  // `l10n.goToDashboard`, so `find.text('Go to dashboard')` found nothing
  // at app_test.dart:849 and :1232.
  //
  // A redirect that silently SUBSTITUTES a destination is invisible to any
  // test that only asserts the user reached the INTERSTITIAL —
  // `test/legal_gates_test.dart` asserts exactly that, in both directions,
  // and stayed green through the whole regression.
  if (loc == '/reaccept-terms') return GateVerdict(_nextOr(state, '/home'));
  return null;
}

// ⚠️ `/login` IS DELIBERATELY ABSENT FROM THIS LIST, and it was here
// until the mutation said otherwise. M4 (2026-08-10): removing it changed
// NO test outcome, because a signed-in user opening `/login` is
// canonicalised to `/sign-in` by the route-level redirect and bounced
// home by this very line on the next pass. A branch no input can reach is
// dead code that reads as a safety net, so it went rather than being kept
// "just in case" — the same rule this repo applied to the Ed25519 length
// checks. The behaviour is pinned by the signed-in limb of
// `test/auth_route_canonical_test.dart`.
GateVerdict? signedInOnAuthScreenGate(GateContext ctx) {
  final String loc = ctx.loc;
  if (ctx.loggedIn && (loc == '/sign-in' || loc == '/sign-up')) {
    return const GateVerdict('/home');
  }
  return null;
}

/// 🔴 THE ORDERED CHAIN. READ IT TOP TO BOTTOM; THAT IS THE ORDER IT RUNS IN,
/// AND IT IS THE SAME ORDER THE SINGLE CLOSURE RAN THESE BLOCKS IN.
///
/// Every reason a gate sits where it does is on the gate. Two rules govern any
/// edit to this list:
///
///   · SWAPPING TWO LINES IS A BEHAVIOUR CHANGE, not a tidy-up. Swapping
///     [emailVerificationGate] and [legalReacceptanceGate] records a legal
///     acceptance against an identity nobody has proven; moving
///     [signedOutGate] below [legalReacceptanceGate] reproduces the redirect
///     loop that made the app impossible to sign into on a fresh install.
///   · A GATE THAT ABSTAINS RETURNS `null`; a gate that decides returns a
///     [GateVerdict], `null` destination included. See [GateVerdict].
const List<GateVerdict? Function(GateContext)> kGateChain =
    <GateVerdict? Function(GateContext)>[
      onboardingGate,
      signedOutGate,
      passwordRecoveryGate,
      emailVerificationGate,
      legalReacceptanceGate,
      signedInOnAuthScreenGate,
    ];

/// The router's `redirect`, composed from [kGateChain] in order.
///
/// The first gate to return a [GateVerdict] settles the pass and its
/// [GateVerdict.destination] is handed straight back to `go_router`; a gate that
/// returns `null` has no opinion and the next one is asked. Falling off the end
/// means no gate had anything to say, which is `redirect`'s own "stay here".
String? appRedirect(Ref ref, core.AuthRepository auth, GoRouterState state) {
  final GateContext ctx = GateContext(ref: ref, auth: auth, state: state);
  for (final GateVerdict? Function(GateContext) gate in kGateChain) {
    final GateVerdict? verdict = gate(ctx);
    if (verdict != null) return verdict.destination;
  }
  return null;
}
