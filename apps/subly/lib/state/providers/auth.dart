// SECTION F of the spine — identity: the repository, the token, the two REST
// clients, password recovery, and the whole of what a sign-out is. It also
// carries the two account-deletion OUTCOME holders that stood under SECTION K,
// because the erasure flow they report on is declared here. Re-exported from
// `../providers.dart`.
//
// 🔴 `.signOut()` MAY BE CALLED FROM THIS FILE AND NOWHERE ELSE. That is not a
// convention: `tooling/ci/assert-seams-wired.mjs`'s `session_end` exclusive
// trigger names this exact path as the one permitted call site and fails the
// build on any other. See [signOutAndForgetUser].

import 'dart:async';

import 'package:flutter/foundation.dart' show ChangeNotifier, kIsWeb;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show
        AuthCapabilities,
        AuthProviders,
        InMemoryAuthRepository,
        SupabaseAuthRepository,
        passwordResetArrivalOf,
        passwordResetRedirectUrl;
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../../data/auth/auth_repository.dart';
import 'notifications.dart';
import 'persistence.dart';

/// THE OUTER SWITCH, checked before consent is even considered.
///
/// It is a provider rather than a bare `AppConfig.isBackendLive` read precisely
/// so that "silent by design" can be told apart from "broken": the chassis
/// property test overrides it to true and drives a real event all the way to a
/// transport.
///
// ═════════════════════════════════════════════════════════════════════════════
// SECTION F · IDENTITY ([pipeline C-15] · [ADR 027])
// ═════════════════════════════════════════════════════════════════════════════

/// Auth: real Supabase when configured, else the in-memory mock (demo mode).
///
/// 🔴 KEPT VERBATIM FROM LIVE — the chassis version of this PROVIDER is the one
/// thing in the whole spine that must NOT win, because of where it points
/// `requestServerDeletion`. See note 2 in the file header.
///
/// ⚠️ THAT IS ABOUT THE PROVIDER, NOT THE CLASS, AND THE TWO USED TO BE
/// CONFUSED. `SupabaseAuthRepository` is now the CHASSIS class
/// (`packages/auth_supabase`) — 39-CHASSIS cut 1 reversed, owner 2026-08-09.
/// The fork this replaces was a hand-copy that had fallen three fixes behind:
/// `currentAccessToken()` handed back whatever was in memory, expired or not
/// (a resumed app's first request 401s, and the brick used to read that as
/// "signed out"); there was no single-flight, so a burst of requests each
/// started its own refresh and gotrue retired the token the losers were still
/// holding; and `signInWithApple()` had no `kIsWeb` launch-mode arm, which is a
/// popup on web and a login that never completes in a standalone PWA. Wiring
/// the shared class in is the whole point of the reversal: the one-identity
/// lock means every future app takes THIS class, so a fix here has to reach
/// every app including this one.
///
/// 🔴 `requestServerDeletion` IS WHAT MAKES "DELETE ACCOUNT" A BUTTON THAT
/// DELETES. Without it `deleteAccount()` took an unconditional refusal branch —
/// the user was signed out and never deleted — and the app shipped no control at
/// all because there was nothing honest to point one at. [ADR 027].
///
/// It goes to [platformRestClientProvider], NOT to [apiClientProvider] and NOT
/// to the chassis's [restClientProvider], and it stays ONE call. The shared
/// platform Worker is the erasure ENTRY POINT: it checks the service-role
/// precondition, empties `platform_db`, relays to each app's own
/// `DELETE /v1/account` (subly-api's, since 2026-08-04), and deletes the
/// identity LAST. That ordering is the whole safety property, and the client
/// must not own it — two calls from here could interleave with the shared
/// Worker's 501 and destroy this app's data for an account that then survives.
///
/// `ref.read` INSIDE the closure, never at build time: the REST client's token
/// provider reads THIS provider, so resolving it out here would be a cycle.
/// Deletion happens long after both exist.
///
/// ⚠️ AND THAT ALONE IS NOT ENOUGH — see [platformRestClientProvider]. Moving
/// the read late fixes the BUILD ORDER; Riverpod's cycle check is about the
/// dependency GRAPH, and it runs on every `ref.read`, however late.
///
/// 🔴 THE PREDICATE IS `isBackendLive`, AND IT MUST MATCH `main.dart`'S.
/// `main.dart` gates `initNikatruAuth` — the call that initialises the Supabase
/// SDK before the first frame — on `AppConfig.isBackendLive`. This provider used
/// to select on `isSupabaseConfigured` alone, so a build carrying SUPABASE_URL /
/// SUPABASE_ANON_KEY but no API_BASE_URL resolved a LIVE `SupabaseAuthRepository`
/// against an SDK nobody had initialised. The router reads this provider through
/// `refreshListenable` while it is being built, so that build died at LAUNCH on
/// `Supabase.instance` — AssertionError in debug, LateInitializationError in
/// release — before a screen rendered, and no widget test could see it because
/// widget tests take no `--dart-define`s. Two predicates for one decision is the
/// bug; there is now one, and `isBackendLive` is it
/// (`isSupabaseConfigured && isApiConfigured`).
final Provider<AuthRepository> authRepositoryProvider =
    Provider<AuthRepository>(
      (ref) => AppConfig.isBackendLive
          ? SupabaseAuthRepository(
              requestServerDeletion: () =>
                  requestAccountDeletion(ref.read(platformRestClientProvider)),
              // 🔴 UNSET, THE RESET LINK RESOLVES TO THE PROJECT'S SITE URL —
              // one URL shared by every app the portfolio's single Supabase
              // project authenticates. gotrue does not error on an absent
              // `redirect_to`; it substitutes, so the mail sends, the link
              // works, and the only difference is which app the person lands
              // in. Invisible from inside this one.
              //
              // Read off the RUNNING ORIGIN so a Pages preview and a localhost
              // run each send their own users back to themselves. Null off web:
              // no native target here registers a URI scheme yet, and a
              // fabricated one is not on the allow-list, so gotrue would fall
              // back to the Site URL anyway with the reason hidden.
              passwordResetRedirectTo: passwordResetRedirectUrl(
                isWeb: kIsWeb,
                base: Uri.base,
              ),
            )
          : InMemoryAuthRepository(),
    );

/// Whether a PASSWORD-RECOVERY session is in flight.
///
/// 🔴 NOTHING ELSE CAN ANSWER THIS. A user who follows a reset link is handed a
/// real session, so `currentUser`, `currentSession()` and `authStateChanges()`
/// report an ordinary sign-in — indistinguishable from somebody typing their
/// password. The reason rides on the `AuthEvent` at the instant it is delivered
/// and the Supabase adapter used to map it away, which is why a reset link could
/// only ever land the user on the home screen.
///
/// ⚠️ THE ARMS THAT DO NOTHING ARE AS DELIBERATE AS THE TWO THAT DO:
///   · `passwordRecovery` ARMS it; the gate then holds the user on
///     `/reset-password` however they navigate;
///   · `signedOut` RELEASES it, and is the ONLY release. `ResetPasswordScreen`
///     signs out to leave, so finishing and abandoning take one exit rather than
///     two that must be kept in step;
///   · `userUpdated` must NOT release it — it fires the moment the new password
///     lands, and releasing there tears the confirmation page down under the
///     user before they can read it ([ADR 027]'s lesson again);
///   · `signedIn` must NOT release it — gotrue can follow a recovery with an
///     ordinary arrival event, and releasing on one drops somebody out of the
///     form mid-typing.
///
/// A plain synchronous `bool`, not an `AsyncValue`: the redirect guard that
/// reads it cannot await, which is the same reason the seam exposes
/// `currentUser` separately from `currentSession()`.
class PasswordRecoveryController extends Notifier<bool> {
  @override
  bool build() {
    final AuthRepository auth = ref.watch(authRepositoryProvider);
    final StreamSubscription<core.AuthEvent> sub = auth.authEvents().listen((
      core.AuthEvent event,
    ) {
      if (event.startsPasswordRecovery) {
        state = true;
      } else if (event.kind == core.AuthEventKind.signedOut) {
        state = false;
      }
    });
    ref.onDispose(sub.cancel);
    return false;
  }
}

final NotifierProvider<PasswordRecoveryController, bool>
passwordRecoveryProvider = NotifierProvider<PasswordRecoveryController, bool>(
  PasswordRecoveryController.new,
);

/// The URL this build was launched with.
///
/// A PROVIDER rather than a direct `Uri.base` read, for one reason: `Uri.base`
/// is a property of the process, so a test that needs a reset-link arrival could
/// not otherwise construct one, and the arrival path would be exactly the
/// fail-closed-and-untested limb [pipeline C-6] is about.
final Provider<Uri> launchUriProvider = Provider<Uri>((ref) => Uri.base);

/// What a password-reset link left in the URL, and what became of it.
///
/// 🔴 THIS EXISTS BECAUSE THE DEAD-LINK STATE WAS UNREACHABLE FROM THE FAILURE
/// IT EXPLAINS. `ResetPasswordScreen` shipped with a careful explanation for an
/// unusable link, `/reset-password` was added to `signedOutMayStay` so a
/// signed-out visitor could stand there to read it — and nothing ever put them
/// there. The ONLY thing that routed to that screen was
/// `AuthEventKind.passwordRecovery`, which is the SUCCESS event; a link that
/// cannot be exchanged emits an error and never that. So three tests proved a
/// state production could not produce, and the screen's own comment called it
/// "the state the feature reaches most often in the field".
///
/// TWO INDEPENDENT SOURCES, because the failure has two shapes and neither one
/// covers the other:
///
///   1. THE LAUNCH URL. gotrue's failure redirect answers `303` to
///      `…/?nk_auth=reset#error=access_denied&error_code=otp_expired` — measured
///      live against the real project on 2026-08-11, not inferred. The query
///      survives; the FRAGMENT does not, so with the hash URL strategy the route
///      the link asked for is gone and go_router has nothing to match: the
///      errorBuilder renders `NotFoundScreen`, which is worse than the
///      unexplained `/sign-in` the entry in `signedOutMayStay` was added to
///      prevent. Reading the marker off the query is what turns that 404 into
///      the sentence.
///
///   2. THE EVENT STREAM. A link that reaches the SDK with a code but no PKCE
///      verifier — the reset requested on one device and opened on another, or
///      site data cleared in between — throws inside the exchange and surfaces
///      as a stream ERROR. That was a FATAL CRASH in production (GlitchTip
///      SUBLY-8, 2026-08-10T18:09:25Z, release subly@1.0.189+4d85ad7,
///      `mechanism: runZonedGuarded, handled: false`). The seam now delivers it
///      as `AuthEventKind.recoveryLinkFailed`, and this is what holds it.
///
/// ⚠️ `signedOut` IS DELIBERATELY NOT A RELEASE HERE, unlike in
/// [passwordRecoveryProvider], and the difference is a race rather than a
/// preference. This state can be set by the LAUNCH URL, before any event at all,
/// while `supabase_flutter` emits `initialSession` — which maps to `signedOut`
/// when a cold start restored nothing — at a moment whose order against the
/// deep-link handler is not guaranteed. Releasing on it would let the arrival
/// this launch actually carried be erased by a routine startup emission,
/// intermittently. [clear] is the release, and `ResetPasswordScreen` calls it on
/// the way out: the exit is one deliberate act instead of two that must agree.
class PasswordResetArrivalController
    extends Notifier<core.PasswordResetArrivalReport> {
  @override
  core.PasswordResetArrivalReport build() {
    final AuthRepository auth = ref.watch(authRepositoryProvider);
    final StreamSubscription<core.AuthEvent> sub = auth.authEvents().listen((
      core.AuthEvent event,
    ) {
      if (event.recoveryLinkIsUnusable) {
        state = core.PasswordResetArrivalReport(
          core.PasswordResetArrival.unusable,
          problem: event.problem ?? core.AuthLinkProblem.unknown,
        );
      } else if (event.startsPasswordRecovery) {
        state = const core.PasswordResetArrivalReport(
          core.PasswordResetArrival.pending,
        );
      }
    });
    ref.onDispose(sub.cancel);
    return passwordResetArrivalOf(ref.watch(launchUriProvider));
  }

  /// The one release. Called by the screen when the user leaves it, so a dead
  /// link does not park them on `/reset-password` for the rest of the session.
  void clear() => state = core.PasswordResetArrivalReport.none;
}

final NotifierProvider<
  PasswordResetArrivalController,
  core.PasswordResetArrivalReport
>
passwordResetArrivalProvider =
    NotifierProvider<
      PasswordResetArrivalController,
      core.PasswordResetArrivalReport
    >(PasswordResetArrivalController.new);

/// Whether the router should hold the user on `/reset-password`.
///
/// ONE READ for the two states that mean it, so the gate cannot drift from the
/// screen: an armed recovery (the success path) or an arrival that has not been
/// dismissed (the failure path, and the moments before the exchange resolves).
bool shouldHoldForPasswordReset({
  required bool recovering,
  required core.PasswordResetArrival arrival,
}) => recovering || arrival != core.PasswordResetArrival.none;

/// The authenticated client for the SHARED platform Worker (`/v1/...`).
///
/// Subly's other transports already talk to the platform host (consent and
/// events), but each builds its own dio and none of them carries a bearer
/// token, because neither call is authenticated. Erasure is, so it needs the
/// shared [RestClient] — the one place the `Authorization` header is attached.
/// ⚠️ READS `AppConfig.platformBaseUrl`, NOT [kPlatformBaseUrl], and that is
/// deliberate restraint rather than an oversight: `analytics_providers.dart`
/// (which never moves) reads `AppConfig.platformBaseUrl` twice, so P2.5's
/// `AppConfig` union has to keep that member regardless. Re-pointing this line
/// at the chassis constant would change a live file for no behavioural gain —
/// both spellings resolve the same `PLATFORM_BASE_URL` define with the same
/// default. Converging the two names is MANIFEST.md §7's item, on its own.
///
/// 🔴 IT TAKES [authTokenProvider], NOT `ref.watch(authRepositoryProvider)
/// .currentAccessToken`, AND THE DIFFERENCE WAS A DELETE BUTTON THAT NEVER SENT
/// A REQUEST. Measured 2026-08-09 against the live tree: `deleteAccount()` threw
/// `AccountDeletionFailure(unknown)` wrapping a Riverpod `CircularDependencyError`,
/// and Cloudflare's zone analytics recorded ZERO `/v1/account` requests — not
/// even a CORS preflight — for the whole delete leg. Nothing was malformed; the
/// request was never formed.
///
/// The cycle is in the GRAPH, not in the timing. `authRepositoryProvider` does
/// `ref.read(this)` inside its erasure closure; `ref.read` runs
/// `_debugAssertCanDependOn`, which walks the TARGET's ancestors and throws
/// `CircularDependencyError` if it finds the reader. `ref.watch(
/// authRepositoryProvider)` here is exactly that ancestor edge, so the read
/// throws every time, no matter how late it happens. Watching
/// [authTokenProvider] instead breaks the edge — that provider only `ref.read`s
/// the repository, and a `read` registers no dependency — which is why the
/// brick's `restClientProvider` (same two-hop shape, in the brick's own
/// `providers.dart`) has never had
/// this defect. This provider was the one written by hand afterwards.
///
/// ⚠️ IT IS AN ASSERT, SO IT IS DEBUG-ONLY. A `--release` build strips it and
/// deletes accounts fine; every debug run and the whole `flutter drive` E2E
/// (DDC) does not. A defect that only exists where the tests run is still a
/// defect — and it is the reason the one automated proof of erasure could not
/// go green while production looked healthy.
final Provider<RestClient> platformRestClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: '${AppConfig.platformBaseUrl}/v1',
    tokenProvider: ref.watch(authTokenProvider),
  ),
);

/// The bearer token every API call carries. This is the shape [RestClient]
/// takes, which is why it returns a token rather than a session: the HTTP layer
/// has no business knowing about refresh.
///
/// Exposed as a PROVIDER rather than a bare function so a test can read the
/// exact object [restClientProvider] is constructed with. A test that rebuilt an
/// equivalent closure would pass while the client was wired to something else.
final Provider<Future<String?> Function()> authTokenProvider =
    Provider<Future<String?> Function()>(
      (ref) =>
          () => ref.read(authRepositoryProvider).currentAccessToken(),
    );

/// The chassis REST client, authenticated, pointed at THIS APP's own API.
///
/// Distinct from [platformRestClientProvider] (shared platform host) and from
/// [apiClientProvider] (Subly's typed dio client for the same host). Carried
/// because the stamped monetization + auth screens program against it.
///
/// 🔴 A 401 IS NOT PROOF THE SESSION IS GONE, and treating it as proof logged
/// people out. An access token that merely EXPIRED looks identical from the
/// Worker's chair, and expiry is routine — the SDK stops its refresh ticker
/// while the app is paused and restarts it asynchronously on resume, so the
/// first request of the frame after a resume carries a stale token by design.
/// The decision therefore lives in [signOutOnlyIfSessionIsGone], a NAMED
/// function rather than an inline closure precisely so a test can drive it.
final Provider<RestClient> restClientProvider = Provider<RestClient>(
  (ref) => RestClient(
    baseUrl: AppConfig.apiBaseUrl,
    tokenProvider: ref.watch(authTokenProvider),
    onUnauthorized: () =>
        signOutOnlyIfSessionIsGone(ref.read(authRepositoryProvider)),
  ),
);

/// What a 401 means, decided in one place.
///
/// Ask the seam for a token first. `currentAccessToken()` refreshes on expiry
/// and returns null ONLY when there is no session or the refresh really failed —
/// which is the one case where signing out is the truthful action. A 401 that
/// survives a good token means the server rejected a LIVE session (revoked, or a
/// permissions problem); that is a failed request, not a reason to destroy local
/// state the user can still use.
///
/// ⚠️ THIS PATH DOES NOT RUN THE PER-USER FORGET, and the omission is stated
/// rather than left to be discovered. It takes a [core.AuthRepository] because
/// it is called from inside [restClientProvider]'s `onUnauthorized`, where there
/// is no `WidgetRef` to resolve [userStateDrops] from; wiring it would mean
/// either a second copy of the drop list (the one thing that list exists to
/// prevent) or a second reader shape. So a session that dies of a failed refresh
/// still leaves the entitlement cache behind until the next deliberate sign-out.
/// It is the narrowest of the leaks — nobody hands the device over on a 401 —
/// and it is the only one left. Named here, and in [signOutAndForgetUser]'s doc,
/// so the count in that doc stays honest.
Future<void> signOutOnlyIfSessionIsGone(core.AuthRepository auth) async {
  if (await auth.currentAccessToken() == null) {
    await auth.signOut();
  }
}

/// One user-scoped clear, with its provider read ALREADY DONE.
typedef UserStateDrop = Future<void> Function();

/// Everything on this device that belongs to the person who was signed in,
/// RESOLVED — the read half, which is synchronous and has a deadline.
///
/// 🔴 `EntitlementCache.clear()` HAD ZERO PRODUCTION CALLERS. The cache exists
/// so a paid user stays unlocked offline, and it honours a cached answer for up
/// to [core.kEntitlementStalenessCeiling] — seven days. Nothing dropped it when
/// a session ended, so the NEXT person to sign in on a shared, borrowed, resold
/// or family device inherited the previous one's Pro for a week. `cancelAll()`
/// was in the same state on this path: a user who deleted their account went on
/// being reminded about it by a device that had forgotten nothing.
///
/// The LIST is the definition — one place that says what "user-scoped" means, so
/// adding a per-user store is one line here rather than an omission in four
/// screens. [pipeline C-6]: a fail-closed store nothing ever clears is a dead
/// capability that reports healthy.
///
/// ⚠️ BOTH NOTIFICATION SERVICES, and they are not the same object.
/// [notificationServiceProvider] is the chassis seam (the daily reminder);
/// [sublyNotificationServiceProvider] is Subly's frozen fork, and it is the one
/// that schedules the RENEWAL reminders and the weekly digest — the notifications
/// a deleted user would actually keep receiving. Cancelling only the chassis one
/// would look like a fix and change nothing about the reported symptom.
///
/// 🔴 THIS IS A SEPARATE FUNCTION FROM [forgetSignedInUser] BECAUSE READING A
/// PROVIDER HAS A DEADLINE AND RUNNING A DROP DOES NOT — and the first shape of
/// this fix got that wrong in the one way that made it do nothing.
/// `WidgetRef.read` calls `_assertNotDisposed()`, which THROWS
/// `StateError('Cannot use "ref" after the widget was disposed.')` in release
/// (flutter_riverpod 2.6.1 `consumer.dart:548-551` — a real throw, not an
/// `assert`). A sign-out emits on the auth stream BEFORE its network leg
/// finishes, the router then replaces the shell `/settings` lives in, and this
/// screen's element is gone — so a `ref.read` placed AFTER `await signOut()`
/// threw on exactly the slow connection the fix was for: nothing was cleared,
/// and the user was told a successful sign-out had failed. Resolve the drops
/// FIRST, then await. Callers cannot get this wrong by accident any more,
/// because [forgetSignedInUser] takes the resolved list and never a `ref`.
List<UserStateDrop> userStateDrops(WidgetRef ref) => <UserStateDrop>[
  ref.read(entitlementCacheProvider).clear,
  ref.read(notificationServiceProvider).cancelAll,
  ref.read(sublyNotificationServiceProvider).cancelAll,
];

/// Run the resolved drops — the half that is allowed to take as long as it likes.
///
/// 🔴 EVERY DROP IS ATTEMPTED EVEN AFTER ONE THROWS, and the FIRST failure is
/// rethrown once they all have been. Returning early leaves exactly the
/// half-forgotten state this exists to prevent (cache gone, reminders still
/// firing); swallowing restores the defect it fixes. The caller decides what to
/// say about it — see `_signOut` in `settings_screen.dart`.
Future<void> forgetSignedInUser(List<UserStateDrop> drops) async {
  Object? failure;
  StackTrace? stack;
  for (final UserStateDrop drop in drops) {
    try {
      await drop();
    } catch (e, s) {
      failure ??= e;
      stack ??= s;
    }
  }
  if (failure != null) Error.throwWithStackTrace(failure, stack!);
}

/// End the session AND forget the user — the whole of what a sign-out is.
///
/// 🔴 THE FORGET RUNS EVEN WHEN THE SIGN-OUT THREW, and that direction is
/// chosen. `SecureSessionStorage.removePersistedSession` throws on purpose when
/// it can neither delete the persisted session nor tombstone it, so a throw here
/// is the case where local state is MOST likely to outlive the user, not least.
/// The cost of clearing for a session that turns out to have survived is one
/// server read that puts the entitlement straight back.
///
/// 🔴 WHICH SESSION-ENDING PATHS RUN IT, COUNTED RATHER THAN ASSERTED. This doc
/// said "both paths (the Log out control and account deletion)" and there were
/// FOUR user-facing ones in this root; the two it did not name went on leaking
/// the previous user's Pro, and the sentence is how the next reader stops
/// looking. All four go through this function or through
/// [forgetSignedInUser] today:
///   1. Settings → Log out (`settings_screen.dart`, `_signOut`);
///   2. Settings → Delete account (the same file, after `deleteAccount()`);
///   3. `reaccept_terms_screen.dart` → Decline, the way out of the mandatory
///      interstitial every signed-in user meets on a `kTermsVersion` bump;
///   4. `verify_email_screen.dart` → Sign out, which its own comment calls "the
///      only way OUT of the gate".
/// `assert-seams-wired.mjs`'s `session_end` exclusive trigger is what keeps that
/// list true: this spine file is the ONLY place allowed to call `.signOut()`, so
/// a fifth control cannot be added without either routing through here or
/// turning the build red.
///
/// ⚠️ ONE PATH DELIBERATELY DOES NOT, and it is not a control:
/// [signOutOnlyIfSessionIsGone], the 401 handler on [restClientProvider]. It
/// takes a repository rather than a `WidgetRef` because it runs from inside a
/// provider with no widget anywhere near it, so it cannot resolve the drops the
/// way the four above do. Out of scope on purpose rather than by omission — see
/// the note at its declaration.
///
/// A NAMED function for the same reason [signOutOnlyIfSessionIsGone] is: a test
/// has to be able to drive it without a widget.
Future<void> signOutAndForgetUser(WidgetRef ref) async {
  // 🔴 BOTH READS HAPPEN HERE, BEFORE ANY AWAIT. See [userStateDrops].
  final core.AuthRepository auth = ref.read(authRepositoryProvider);
  final List<UserStateDrop> drops = userStateDrops(ref);
  Object? failure;
  StackTrace? stack;
  try {
    await auth.signOut();
  } catch (e, s) {
    failure = e;
    stack = s;
  }
  try {
    await forgetSignedInUser(drops);
  } catch (e, s) {
    failure ??= e;
    stack ??= s;
  }
  if (failure != null) Error.throwWithStackTrace(failure, stack!);
}

/// What identity can actually do on THIS platform — declared, not assumed.
/// Ask before promising the user something the platform cannot deliver.
final Provider<AuthCapabilities> authCapabilitiesProvider =
    Provider<AuthCapabilities>((ref) => AuthCapabilities.current());

/// Which federated providers the SERVER will accept — the other half of the
/// question [authCapabilitiesProvider] answers, and the half that was missing.
///
/// A provider rather than a bare constant read at the call site so a test can
/// override it and drive BOTH arms of the gate. That is not ceremony: every
/// row of `AuthCapabilities.forPlatform` except fuchsia says `oauthRedirect:
/// true`, so with the platform axis alone the "button is hidden" case is
/// unreachable on anything this portfolio ships, and an assertion that cannot
/// fail is worse than none.
final Provider<AuthProviders> authProvidersProvider = Provider<AuthProviders>(
  (ref) => AuthProviders.configured,
);

/// The signed-in user as a STREAM, so a screen showing their details updates
/// when those details change.
///
/// 🔴 SEEDED WITH THE SNAPSHOT, and that is load-bearing.
/// `authStateChanges` emits on CHANGE, so a screen built while the user is
/// already signed in would sit on `AsyncLoading` — and therefore render as
/// signed-out — until the next event, which on a settled session never comes.
final StreamProvider<core.AuthUser?> authUserProvider =
    StreamProvider<core.AuthUser?>((ref) async* {
      final core.AuthRepository auth = ref.watch(authRepositoryProvider);
      yield auth.currentUser;
      yield* auth.authStateChanges();
    });

/// Turns the auth stream into something `GoRouter` will listen to.
///
/// 🔴 [pipeline C-13] WITHOUT THIS, SIGNING IN LEAVES THE USER ON THE FORM.
/// The auth FORM deliberately does not navigate — pushing from both the screen
/// and the redirect guard is how two routes end up racing
/// to be top of the stack — so `redirect` has to be TOLD to re-run. Found
/// 2026-07-29 by driving the form in a widget test rather than by reading the
/// code.
class AuthRefreshNotifier extends ChangeNotifier {
  AuthRefreshNotifier(Stream<core.AuthUser?> changes) {
    _sub = changes.listen((core.AuthUser? _) => notifyListeners());
  }

  late final StreamSubscription<core.AuthUser?> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}

/// The router's refresh signal. One per container, disposed with it.
final Provider<AuthRefreshNotifier> authRefreshProvider =
    Provider<AuthRefreshNotifier>((ref) {
      final AuthRefreshNotifier notifier = AuthRefreshNotifier(
        ref.watch(authRepositoryProvider).authStateChanges(),
      );
      ref.onDispose(notifier.dispose);
      return notifier;
    });

// ═════════════════════════════════════════════════════════════════════════════
// ACCOUNT-DELETION OUTCOME (stood under SECTION K · Subly's own product state)
// ═════════════════════════════════════════════════════════════════════════════

/// 🔴 WHERE THE DELETION OUTCOME LIVES ONCE THE SCREEN IS GONE.
///
/// `deleteAccount()` signs out whichever way the request went; the auth stream
/// fires, and go_router replaces the page stack with `/sign-in`. A `SnackBar`
/// — or a dialog, which is a PAGELESS ROUTE on the page being removed — goes
/// with it.
/// **Measured, not assumed:** the first version of this flow rendered the result
/// in the dialog, and the router-driven test in `test/delete_account_test.dart`
/// found zero widgets with the result key after the redirect settled. So the
/// message that matters most — 502: your data is gone and your login still
/// works — was the one message the user never saw.
///
/// The outcome therefore outlives the screen here, and `LoginScreen` renders it.
/// Cleared when the user dismisses it, so it cannot resurface at a later
/// sign-out. [ADR 027]
final StateProvider<core.AccountDeletionOutcome?>
lastAccountDeletionOutcomeProvider =
    StateProvider<core.AccountDeletionOutcome?>((ref) => null);

/// WHY that outcome, for a developer — parked next to it and NEVER shown in a
/// release build.
///
/// 🔴 IT EXISTS BECAUSE `unknown` IS A BUCKET WITH NO LABEL, AND THE LABEL COST
/// FOUR DAYS. The live delete leg reported "we cannot tell how much of it was
/// removed" on 2026-08-09; the cause was a Riverpod `CircularDependencyError`
/// thrown before a request was formed, and three sessions went looking for an
/// HTTP status that had never existed — one of them reading Cloudflare's zone
/// analytics to prove the request had never been sent. `_deleteAccount` had the
/// exception in its hand and threw it away, because the screen renders
/// `outcome.plainMessage` and nothing else.
///
/// It holds `error.toString()`, which for an [core.AccountDeletionFailure] now
/// carries the status or the underlying throw in `[...]`. `LoginScreen` renders
/// it under the notice IN DEBUG BUILDS ONLY — that is where `flutter drive`
/// runs, so the E2E can name the cause in one run, and a user never sees it.
final StateProvider<String?> lastAccountDeletionDetailProvider =
    StateProvider<String?>((ref) => null);
