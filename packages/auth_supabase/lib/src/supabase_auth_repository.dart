import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

/// Supabase (GoTrue) implementation of core's [core.AuthRepository].
///
/// [pipeline C-15] THE ONLY PLACE THE SUPABASE SDK IS IMPORTED. Everything above
/// the data layer programs against the interface in `packages/core`, so swapping
/// identity providers means writing one more class here — not touching an app.
/// `assert-package-boundaries.mjs` fails the build if an app reaches for the SDK
/// directly.
///
/// Pure REST underneath, so the same class serves all six platforms with no
/// desktop-specific package.
class SupabaseAuthRepository implements core.AuthRepository {
  SupabaseAuthRepository({
    sb.GoTrueClient? client,
    Future<void> Function()? requestServerDeletion,
    DateTime Function()? clock,
    this.passwordResetRedirectTo,
    this.refreshSkew = const Duration(seconds: 30),
  })  : _injected = client,
        _requestServerDeletion = requestServerDeletion,
        _now = clock ?? (() => DateTime.now().toUtc());

  final sb.GoTrueClient? _injected;

  /// Where the emailed password-reset link sends the user back to.
  ///
  /// 🔴 NULL MEANS "THE PROJECT'S SITE URL", WHICH IS A REAL DESTINATION AND
  /// USUALLY THE WRONG ONE. gotrue substitutes `site_url` when no `redirect_to`
  /// is given, and this project's Site URL is app #1's web home — so with this
  /// left null, app #2's reset mail sends its users into app #1. Nothing about
  /// that is visible from inside app #2: the mail sends, the link works, and the
  /// person lands somewhere else entirely.
  ///
  /// Injected rather than computed here because the answer is a property of the
  /// BUILD, not of this class: on web it is the origin this binary was served
  /// from (see `passwordResetRedirectUrl`), and on a native target it is a
  /// custom scheme that must be registered with the OS and added to the
  /// project's redirect allow-list before it resolves at all. Neither is
  /// knowable from inside the adapter.
  ///
  /// ⚠️ THE VALUE MUST BE ON THE PROJECT'S REDIRECT ALLOW-LIST. gotrue does not
  /// error on a URL that is not: it silently falls back to the Site URL, which
  /// is the same observable behaviour as passing null. A misconfigured
  /// allow-list therefore looks exactly like a working one.
  final String? passwordResetRedirectTo;

  /// How far AHEAD of the real expiry a token counts as expired.
  ///
  /// A token that is valid for another two seconds is worthless: the request
  /// carrying it takes longer than that to reach the Worker, so it arrives
  /// expired and comes back 401. The skew is what makes "not expired" mean
  /// "still valid when it lands".
  final Duration refreshSkew;

  /// Injectable so expiry is testable with a FAKE CLOCK rather than by sleeping.
  /// `Session.isExpired` reads the wall clock internally, so a test that used it
  /// could only ever assert on real time.
  final DateTime Function() _now;

  /// The single in-flight refresh, or null. See [currentAccessToken].
  Future<String?>? _refreshInFlight;

  /// Calls the backend's `DELETE /v1/account`. Injected rather than built here
  /// because the route lives behind the app's own REST client — see
  /// [deleteAccount]. The brick wires it; leaving it null keeps the honest
  /// refusal for a caller that has no such route.
  final Future<void> Function()? _requestServerDeletion;

  sb.GoTrueClient get _auth => _injected ?? sb.Supabase.instance.client.auth;

  /// 🔴 `emailConfirmedAt`, NOT THE DEPRECATED `confirmedAt`, AND NOT
  /// `identities`. gotrue keeps three things that look like this answer and only
  /// one of them is it:
  ///   · `confirmedAt` is deprecated and gotrue populates it from EITHER the
  ///     email or the PHONE confirmation, so a phone-confirmed account with an
  ///     unproven address would read as verified — the exact hole the rule
  ///     exists to close;
  ///   · `identities` being non-empty says an identity row exists, which it does
  ///     from the instant of sign-up, confirmed or not.
  ///
  /// Absent ⇒ NOT verified. Every unreadable shape lands on the closed side by
  /// construction (`!= null` on a nullable timestamp), which is the direction
  /// `core.AuthUser.emailVerified`'s own default is chosen for.
  core.AuthUser? _map(sb.User? u) => u == null
      ? null
      : core.AuthUser(
          id: u.id,
          email: u.email ?? '',
          displayName: u.userMetadata?['full_name'] as String?,
          emailVerified: u.emailConfirmedAt != null,
        );

  @override
  core.AuthUser? get currentUser => _map(_auth.currentUser);

  @override
  Stream<core.AuthUser?> authStateChanges() => _auth.onAuthStateChange
      .map((sb.AuthState s) => _map(s.session?.user))
      // 🔴 THE ERROR IS DROPPED HERE AND REPORTED ON [authEvents], WHICH IS NOT
      // A SHRUG. `onAuthStateChange` carries ERRORS as well as states, and this
      // stream's type — "who is signed in" — has nothing it could truthfully say
      // about a failed arrival. Leaving the error on it does not report it
      // either: an unhandled stream error goes to the zone and, in this app,
      // straight to GlitchTip as a FATAL crash (SUBLY-8). So the typed report
      // goes out on the event stream, where there is a member for it, and this
      // one keeps answering only the question it is named after.
      .handleError((Object _) {});

  /// 🔴 THIS LINE USED TO BE `authStateChanges` AND NOTHING ELSE, AND THE
  /// DISCARDED HALF WAS AN ENTIRE FEATURE. `onAuthStateChange` delivers an
  /// `AuthState` — a session AND the `AuthChangeEvent` that produced it — and
  /// the map above keeps the session and drops the event on the floor. So a user
  /// arriving on a password-recovery link was reported to every listener as an
  /// ordinary sign-in, because after the mapping that is literally all they
  /// were. The router then did the correct thing with the wrong information and
  /// sent them to the home screen.
  ///
  /// The reason exists ONLY at delivery. There is no later read — not
  /// `currentUser`, not the session, not the JWT — that can tell a recovery
  /// session from a normal one, so a discarded event is information the app can
  /// never get back.
  /// 🔴 AND THE ERROR CHANNEL IS AN EVENT, NOT A CRASH. This was
  /// `.map(_event)` and nothing else, which is why GlitchTip SUBLY-8 exists:
  /// a `?code=` arriving in a browser with no PKCE verifier makes
  /// `exchangeCodeForSession` throw `AuthException(Code verifier could not be
  /// found in local storage)` (`gotrue_client.dart:386-390`);
  /// `supabase_flutter`'s `_handleDeeplink` catches it and re-emits it as a
  /// STREAM ERROR via `notifyException` (`supabase_auth.dart:290-296` →
  /// `gotrue_client.dart:1586-1592`); and a `.map`ped stream with no `onError`
  /// hands that to the zone. `mechanism: runZonedGuarded, handled: false,
  /// level: fatal` — a production crash for the ordinary act of opening the mail
  /// on a phone when the reset was requested on a laptop.
  ///
  /// `handleError` converts it into the one thing the app can act on: a typed
  /// [core.AuthEventKind.recoveryLinkFailed] that the router turns into a
  /// sentence. Nothing is swallowed — the failure is louder than it was, because
  /// before this it reached a crash reporter and never reached the user.
  @override
  Stream<core.AuthEvent> authEvents() =>
      _auth.onAuthStateChange.map(_event).transform(
            StreamTransformer<core.AuthEvent, core.AuthEvent>.fromHandlers(
              handleData: (core.AuthEvent e, EventSink<core.AuthEvent> sink) =>
                  sink.add(e),
              handleError: (
                Object error,
                StackTrace stack,
                EventSink<core.AuthEvent> sink,
              ) =>
                  sink.add(
                core.AuthEvent(
                  core.AuthEventKind.recoveryLinkFailed,
                  null,
                  problem: core.authLinkProblemOf(error),
                ),
              ),
            ),
          );

  /// Maps one SDK `AuthState` onto the seam's [core.AuthEvent].
  ///
  /// ⚠️ THE DEFAULT ARM DECIDES BY SESSION, NOT BY EVENT NAME, and that is what
  /// keeps `initialSession` honest: it fires at every cold start whether or not
  /// a session was restored, so mapping it to a bare `signedIn` would announce
  /// an arrival to a signed-OUT app on every launch. Anything unrecognised —
  /// including an event a future SDK adds — lands here too, and the worst it can
  /// say is "somebody signed in" or "nobody is signed in". It can never
  /// fabricate a recovery, which is the one arm with consequences.
  core.AuthEvent _event(sb.AuthState s) {
    final core.AuthUser? user = _map(s.session?.user);
    final core.AuthEventKind kind = switch (s.event) {
      sb.AuthChangeEvent.passwordRecovery =>
        core.AuthEventKind.passwordRecovery,
      sb.AuthChangeEvent.signedOut => core.AuthEventKind.signedOut,
      sb.AuthChangeEvent.tokenRefreshed => core.AuthEventKind.tokenRefreshed,
      sb.AuthChangeEvent.userUpdated => core.AuthEventKind.userUpdated,
      _ => user == null
          ? core.AuthEventKind.signedOut
          : core.AuthEventKind.signedIn,
    };
    return core.AuthEvent(kind, user);
  }

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signInWithPassword(
      email: email,
      password: password,
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Sign-in failed');
    return u;
  }

  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
  }) async {
    final sb.AuthResponse res = await _auth.signUp(
      email: email,
      password: password,
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Sign-up failed');
    return u;
  }

  @override
  Future<void> signInWithApple() async {
    // 🔴 [G-43] WEB MUST BE A FULL-PAGE REDIRECT, NEVER A POPUP. Popups are
    // blocked by default in several browsers unless the call sits inside a
    // direct user-gesture handler, and they break outright in embedded webviews
    // and in PWAs launched standalone. `authScreenLaunchMode: platformDefault`
    // on web means the SDK navigates the page itself; forcing an external
    // application there is what produces the popup.
    //
    // Completion surfaces on authStateChanges(), never as a return value —
    // the app is torn down and rebuilt by the redirect on some platforms, so
    // there is no continuation to return to.
    await _auth.signInWithOAuth(
      sb.OAuthProvider.apple,
      authScreenLaunchMode: kIsWeb
          ? sb.LaunchMode.platformDefault
          : sb.LaunchMode.externalApplication,
    );
  }

  /// 🔴 `redirectTo:` IS THE ARGUMENT THAT WAS MISSING, and without it the link
  /// resolves to the PROJECT's Site URL — one URL shared by every app in the
  /// portfolio. See [passwordResetRedirectTo] for why the value is injected.
  ///
  /// ⚠️ THIS CALL MINTS A PKCE VERIFIER AND KEEPS IT HERE. gotrue generates a
  /// code challenge inside `resetPasswordForEmail` and stores the verifier in
  /// THIS client's local storage under the `passwordRecovery` key. The emailed
  /// link carries only the challenge, so the exchange can only be completed by
  /// the same installation that made this call — a link opened on a second
  /// device, or in a different browser, or in a browser when the request came
  /// from a desktop build, arrives with nothing to match and cannot mint a
  /// session. That is a property of the flow, not a bug to be worked around
  /// here; the reset screen's job is to say so plainly when it happens.
  @override
  Future<void> sendPasswordReset(String email) =>
      _auth.resetPasswordForEmail(email, redirectTo: passwordResetRedirectTo);

  /// 🔴 REFUSES WITH NO SESSION RATHER THAN LETTING THE SDK THROW ITS OWN TYPE.
  /// `updateUser` raises `AuthSessionMissingException` — a Supabase class — and
  /// this seam's contract is that nothing above the data layer ever catches a
  /// vendor type. The refusal is also the COMMONEST real outcome, not an edge
  /// case: a recovery link that has expired, been used already, or been opened
  /// on a device that never held the PKCE verifier leaves exactly this state.
  ///
  /// The `AuthException` remap keeps the SERVER's English in [core.AuthFailure.
  /// message] on purpose. Screens match on that text to choose a localized
  /// sentence (`login_screen.dart`'s `_friendlyMessage`), so translating it here
  /// would break the matching — the mapping is from a vendor TYPE to ours, not
  /// from their words to ours.
  @override
  Future<core.AuthUser> updatePassword({required String newPassword}) async {
    if (_auth.currentSession == null) {
      throw core.AuthFailure(
        'Your reset link is no longer valid. Ask for a new one.',
      );
    }
    try {
      final sb.UserResponse res = await _auth.updateUser(
        sb.UserAttributes(password: newPassword),
      );
      final core.AuthUser? u = _map(res.user);
      if (u == null) throw core.AuthFailure('Could not set your new password');
      return u;
    } on sb.AuthException catch (e) {
      throw core.AuthFailure(e.message);
    }
  }

  @override
  Future<void> signOut() => _auth.signOut();

  /// 🔴 THE ADDRESS COMES FROM THE SESSION, NEVER FROM A CALLER. gotrue's
  /// `resend` takes an arbitrary email; passing one through from a screen would
  /// make this a mail cannon anybody can aim, and it would let an unverified
  /// session redirect its own confirmation to a second inbox.
  ///
  /// [sb.OtpType.signup] specifically — `emailChange` is a different mail with a
  /// different link, and sending it to a user who has not confirmed their
  /// ORIGINAL address confirms nothing.
  @override
  Future<void> resendVerificationEmail() async {
    final String? email = _auth.currentUser?.email;
    if (email == null || email.isEmpty) {
      throw core.AuthFailure('Sign in first, then we can resend the email.');
    }
    await _auth.resend(type: sb.OtpType.signup, email: email);
  }

  /// 🔴 `refreshSession()`, NOT A LOCAL RE-READ. Confirmation happens in a mail
  /// client on a link this app never sees, so the in-memory user says
  /// "unverified" indefinitely — and the JWT carries the claim too, so a fresh
  /// TOKEN is what the Worker needs as well as a fresh user object.
  ///
  /// The SDK emits `tokenRefreshed` on its own stream, so `authStateChanges()`
  /// carries the new user without this doing anything extra — which is the half
  /// the router reads.
  ///
  /// Returns the CURRENT user rather than throwing when the refresh fails: the
  /// user pressed "I've confirmed", and a network blip must leave them on the
  /// verify screen, not staring at an exception.
  @override
  Future<core.AuthUser?> reloadUser() async {
    try {
      final sb.AuthResponse res = await _auth.refreshSession();
      return _map(res.user) ?? currentUser;
    } catch (_) {
      return currentUser;
    }
  }

  /// 🔴 REFUSES ON AN UNVERIFIED SESSION, AND THAT REFUSAL IS THE FEATURE.
  /// Identities merge by email; an unproven email is somebody else's account.
  /// `core.mayLinkIdentity` states the rule once so this and every future
  /// provider answer it the same way — see `identity_assurance.dart` for the
  /// three-step takeover it closes.
  ///
  /// Supabase's own default is verified-only linking, and this does not lean on
  /// it: a dashboard setting is mutable and the control that calls this lives
  /// here.
  @override
  Future<void> linkAppleIdentity() async {
    if (!core.mayLinkIdentity(currentUser)) {
      throw core.AuthFailure(
        'Confirm your email address before linking another sign-in method.',
      );
    }
    // Same web-vs-native launch rule as signInWithApple above, and for the same
    // reason: a popup is blocked by default in several browsers and breaks
    // outright in embedded webviews and standalone PWAs [G-43].
    await _auth.linkIdentity(
      sb.OAuthProvider.apple,
      authScreenLaunchMode: kIsWeb
          ? sb.LaunchMode.platformDefault
          : sb.LaunchMode.externalApplication,
    );
  }

  /// 🔴 REFRESHES ON EXPIRY, and that is the whole point of this override.
  ///
  /// This used to be `_auth.currentSession?.accessToken` — whatever was in
  /// memory, expired or not — while the sibling [InMemoryAuthRepository]
  /// enforced the opposite invariant and every test drove the sibling. The SDK's
  /// auto-refresh ticker covers cold start and foreground steady state, but it
  /// is STOPPED while the app is paused/detached and restarted asynchronously on
  /// resume: the first request of the frame after a resume reads the still-stale
  /// token, the Worker answers 401, and the brick used to turn that into a
  /// sign-out. A token store that hands back an expired token is how a caller
  /// ends up retrying a 401 forever — or, worse, logged out.
  ///
  /// 🔴 SINGLE-FLIGHT, and that is not an optimisation. A resumed screen fires
  /// several requests at once; without this every one of them starts its own
  /// refresh, and gotrue INVALIDATES the old refresh token as it issues a new
  /// one — so the losers of the race present a token the server has already
  /// retired and the session dies. One refresh per burst, shared by every
  /// caller. The future is cleared in `finally`, so a later expiry refreshes
  /// again rather than replaying a stale result forever.
  ///
  /// Returns null only when there is no session, or when refresh genuinely
  /// failed — which is the signal the brick's `onUnauthorized` uses to decide
  /// whether a 401 really means the session is gone.
  @override
  Future<String?> currentAccessToken() async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    if (!_isExpiring(s)) return s.accessToken;
    return _refreshInFlight ??= _refreshOnce();
  }

  /// Whether [s] is expired, or close enough that it will be by the time a
  /// request carrying it arrives. Unknown expiry (`expiresAt == null`, which is
  /// what a token whose `exp` claim cannot be read reports) is treated as NOT
  /// expiring: refreshing on every single call would be worse than trusting a
  /// token the SDK's own ticker is already managing.
  bool _isExpiring(sb.Session s) {
    final int? exp = s.expiresAt;
    if (exp == null) return false;
    final DateTime expiry = DateTime.fromMillisecondsSinceEpoch(
      exp * 1000,
      isUtc: true,
    );
    return !expiry.isAfter(_now().toUtc().add(refreshSkew));
  }

  Future<String?> _refreshOnce() async {
    try {
      final sb.AuthResponse res = await _auth.refreshSession();
      return res.session?.accessToken;
    } catch (_) {
      // A failed refresh means "no usable token", never a crash in an HTTP
      // interceptor. The caller decides what to do about it.
      return null;
    } finally {
      _refreshInFlight = null;
    }
  }

  @override
  Future<core.AuthSession?> currentSession() async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    return core.AuthSession(
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      // GoTrue reports expiry as UNIX seconds; null when it does not know.
      expiresAt: s.expiresAt == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(
              s.expiresAt! * 1000,
              isUtc: true,
            ),
    );
  }

  /// [pipeline C-13] gotrue's `updateUser` writes `auth.users.user_metadata`,
  /// which is a REAL store — the profile screen was refused on the grounds that
  /// no profile data model existed, and that was never true.
  ///
  /// Writes the SAME `full_name` key [_map] reads. A write to any other key
  /// would succeed forever and change nothing the app displays.
  ///
  /// The SDK emits `userUpdated` on its auth stream, so [authStateChanges]
  /// carries the new user without this doing anything extra.
  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async {
    final sb.UserResponse res = await _auth.updateUser(
      sb.UserAttributes(
        // Empty clears it: storing `''` would give callers a second "no name"
        // case that renders as a blank line instead of the not-set label.
        data: <String, dynamic>{
          'full_name': displayName.isEmpty ? null : displayName,
        },
      ),
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Could not save your profile');
    return u;
  }

  /// 🔴 [pipeline C-15] THE CLIENT HALF. The caller injects the request because
  /// the route is reached through the app's own REST client. When nothing is
  /// injected this still signs out and then throws — it does NOT pretend to have
  /// deleted anything, because silently succeeding on a deletion request is the
  /// one outcome a user can never detect and never recover from.
  ///
  /// The same rule binds the SERVER half, and it is why wiring this hook was not
  /// enough on its own: the stamped route used to purge the app's rows and the
  /// user's entitlements while leaving the identity record intact, so "your
  /// account is deleted" would have been followed by a login that still worked.
  /// The route now refuses (501) unless it can delete the identity too, and that
  /// refusal arrives here as a thrown [core.AuthFailure] rather than as success.
  @override
  Future<void> deleteAccount() async {
    Object? failure;
    try {
      if (_requestServerDeletion == null) {
        // 🔴 AN `AccountDeletionFailure(notConfigured)`, NOT A BARE
        // `AuthFailure` CARRYING A SENTENCE. Carried in from the app-side fork
        // when 39-CHASSIS cut 1 was reversed (owner, 2026-08-09) — this is the
        // one place the fork was AHEAD of the chassis, so the reversal moved it
        // here rather than dropping it.
        //
        // The sentence that used to live here went NOWHERE: every screen
        // renders `outcome.plainMessage`, so a `message` no UI reads is a cause
        // written into a void ([ADR 027]). `notConfigured` is also the exact
        // outcome the SERVER returns (501) for the same situation — nothing was
        // deleted, and the user was signed out of this device — so the client
        // and the server now name one state one way.
        failure = core.AccountDeletionFailure(
          core.AccountDeletionOutcome.notConfigured,
        );
      } else {
        await _requestServerDeletion();
      }
    } catch (e) {
      failure = e;
    }
    // Sign out REGARDLESS. A user who has asked to be deleted must not be left
    // holding a live session — that is the worst of both outcomes.
    try {
      await signOut();
    } catch (_) {
      // Already failing; a sign-out error must not mask the real cause.
    }
    if (failure != null) {
      // 🔴 THE FALLBACK IS AN `AccountDeletionFailure`, NOT A BARE `AuthFailure`,
      // AND THE CAUSE RIDES IN `detail`. A plain `AuthFailure` resolves through
      // `accountDeletionOutcomeOf` to `unknown` just the same — but with the
      // outcome INVENTED at the screen instead of carried, and with `$failure`
      // buried in a `message` no UI renders (every screen shows
      // `outcome.plainMessage`). That is how the 2026-08-09 delete-account
      // failure spent three sessions unnamed: the thrower knew exactly what went
      // wrong and every layer above it could only say "we cannot tell".
      throw failure is core.AuthFailure
          ? failure
          : core.AccountDeletionFailure(
              core.AccountDeletionOutcome.unknown,
              detail: '$failure',
            );
    }
  }
}
