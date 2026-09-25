import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'auth_redirect.dart';

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
    this.redirects = AuthRedirects.none,
    this.refreshSkew = const Duration(seconds: 30),
  })  : _injected = client,
        _requestServerDeletion = requestServerDeletion,
        _now = clock ?? (() => DateTime.now().toUtc());

  final sb.GoTrueClient? _injected;

  /// Where each mail or browser hop this adapter starts sends the user back to
  /// — one answer per [AuthFlow], asked at the call that starts the flow.
  ///
  /// 🔴 A NULL ANSWER MEANS "THE PROJECT'S SITE URL", WHICH IS A REAL
  /// DESTINATION AND USUALLY THE WRONG ONE. gotrue substitutes `site_url` when
  /// no `redirect_to` is given, and this project's Site URL is app #1's web
  /// home — so app #2's confirmation, reset and OAuth hops would all send its
  /// users into app #1, and every NATIVE build's hop would land on a web page
  /// that does not hold the PKCE verifier. Nothing about that is visible from
  /// inside app #2: the mail sends, the link works, and the person lands
  /// somewhere else entirely.
  ///
  /// ⏱ 2026-09-23 — this was `passwordResetRedirectTo`, ONE URL for ONE flow.
  /// `signUp`, `resend`, `signInWithOAuth` and `linkIdentity` passed nothing.
  /// `tooling/ci/assert-auth-callbacks.mjs` now fails the build on any
  /// link-sending GoTrue call in this package that does not pass
  /// `redirects(AuthFlow.<flow>)`.
  ///
  /// Injected rather than computed here because the answer is a property of the
  /// BUILD, not of this class: on web it is the origin this binary was served
  /// from, and on a native target it is the `com.nikatru.<app id>` scheme that
  /// target registers with its OS (see `authRedirectUrl`). Neither is knowable
  /// from inside the adapter. [AuthRedirects.none], the default, sends nothing.
  ///
  /// ⚠️ EVERY VALUE MUST BE ON THE PROJECT'S REDIRECT ALLOW-LIST. gotrue does
  /// not error on a URL that is not: it silently falls back to the Site URL,
  /// which is the same observable behaviour as passing null. A misconfigured
  /// allow-list therefore looks exactly like a working one.
  final AuthRedirects redirects;

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
          hasPasswordIdentity: hasPasswordIdentityOf(u.appMetadata),
          lastSignInAt: u.lastSignInAt == null
              ? null
              : DateTime.tryParse(u.lastSignInAt!),
          oauthProviders: oauthProvidersOf(u.appMetadata),
        );

  /// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. The OAuth sign-in methods on
  /// the account: `app_metadata.providers` without `email`, the same claim
  /// [hasPasswordIdentityOf] reads. Empty when the claim is absent.
  @visibleForTesting
  static List<String> oauthProvidersOf(Map<String, dynamic>? appMetadata) {
    final Object? providers = appMetadata?['providers'];
    if (providers is! List) return const <String>[];
    return List<String>.unmodifiable(
      providers.whereType<String>().where((String p) => p != 'email'),
    );
  }

  /// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. Password-less ONLY when the provider
  /// POSITIVELY says so: `app_metadata.providers` is a list without `email`. The
  /// SAME rule `services/platform/src/middleware/auth.ts` `authRecencyOf` applies
  /// to the verified token, so the dialog the app shows and the check the server
  /// makes cannot disagree about which kind of account this is.
  @visibleForTesting
  static bool hasPasswordIdentityOf(Map<String, dynamic>? appMetadata) {
    final Object? providers = appMetadata?['providers'];
    return providers is! List || providers.contains('email');
  }

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
    String? captchaToken,
  }) async {
    final sb.AuthResponse res = await _auth.signInWithPassword(
      email: email,
      password: password,
      captchaToken: captchaToken,
    );
    final core.AuthUser? u = _map(res.user);
    if (u == null) throw core.AuthFailure('Sign-in failed');
    return u;
  }

  /// ⏱ 2026-09-24 · A vendor refusal as OUR type, with its MACHINE half kept.
  ///
  /// This was `core.AuthFailure(e.message)`, which kept GoTrue's English and
  /// threw away the two things a screen can map without guessing: the
  /// `error_code`, and — for `AuthWeakPasswordException` — the `reasons` list.
  /// The reset screen could therefore never say "this password is in a data
  /// breach": `pwned` arrived here and was dropped on this line.
  static core.AuthFailure _failureOf(sb.AuthException e) => core.AuthFailure(
        e.message,
        code: e.code,
        reasons:
            e is sb.AuthWeakPasswordException ? e.reasons : const <String>[],
      );

  /// 🔴 WRAPS THE VENDOR EXCEPTION, which it did not until 2026-09-24:
  /// `sb.AuthException` escaped this method as itself, so a sign-up screen had
  /// to catch a Supabase type — or, as five screens did, print it.
  @override
  Future<core.AuthUser> signUpWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    final sb.AuthResponse res;
    try {
      res = await _auth.signUp(
        email: email,
        password: password,
        captchaToken: captchaToken,
        // The confirmation mail's link. Without it the user confirms into the
        // project's Site URL — app #1's web home — whichever app they signed up in.
        emailRedirectTo: redirects(AuthFlow.signUpConfirm),
      );
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
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
    await _signInWithOAuth(sb.OAuthProvider.apple, 'apple');
  }

  /// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. The same door as
  /// [signInWithApple], through the same call, plus [googleQueryParams]. No
  /// scope is added: Supabase's default Google scopes (email, profile) are the
  /// whole of what this app reads.
  @override
  Future<void> signInWithGoogle() =>
      _signInWithOAuth(sb.OAuthProvider.google, 'google',
          queryParams: googleQueryParams);

  /// 🔴 WHY GOOGLE IS ASKED FOR `offline` ACCESS WITH `consent`: without both,
  /// Google issues no refresh token on a returning sign-in, so there is nothing
  /// for the platform to store and nothing for account deletion to revoke at
  /// Google (O-GOOGLE-SIGN-IN-NOT-BUILT, PR C's `provider_tokens`).
  @visibleForTesting
  static const Map<String, String> googleQueryParams = <String, String>{
    'access_type': 'offline',
    'prompt': 'consent',
  };

  /// The OAuth provider this repository last sent the user to, recorded
  /// BEFORE the redirect: the PKCE verifier is overwritten by every launch, so
  /// the only exchange that can complete is the last one launched. Lost when
  /// the process is (a web full-page redirect reloads it) — see
  /// [oauthProviderOf] for what is read then.
  String? _launchedProvider;

  /// The one `signInWithOAuth` call every provider door goes through.
  Future<void> _signInWithOAuth(
    sb.OAuthProvider provider,
    String name, {
    Map<String, String>? queryParams,
  }) async {
    _launchedProvider = name;
    await _auth.signInWithOAuth(
      provider,
      // On native this is the scheme the OS hands back to THIS installation,
      // which is the only one holding the PKCE verifier the exchange needs.
      redirectTo: redirects(AuthFlow.oauth),
      authScreenLaunchMode: kIsWeb
          ? sb.LaunchMode.platformDefault
          : sb.LaunchMode.externalApplication,
      queryParams: queryParams,
    );
  }

  /// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT (PB-1). Which provider issued a
  /// session's provider refresh token, or null when that cannot be told.
  ///
  /// 🔴 NULL IS READ AS APPLE BY `keepProviderRefreshToken`, so a Google token
  /// left unnamed is stored in the Apple row and revoked at Apple. The order:
  ///   1. the provider this process launched ([launched]) — the PKCE verifier
  ///      makes that the only exchange that can land;
  ///   2. otherwise the account's OAuth identities, when there is exactly one;
  ///   3. otherwise null, and [currentSession] then WITHHOLDS the token. A
  ///      token that is not kept is recoverable (the next sign-in offers
  ///      another); one filed under the wrong provider is not.
  @visibleForTesting
  static String? oauthProviderOf({
    required String? launched,
    required List<String> identityProviders,
  }) {
    if (launched != null) return launched;
    final Set<String> oauth = identityProviders
        .where((String p) => p == 'apple' || p == 'google')
        .toSet();
    return oauth.length == 1 ? oauth.single : null;
  }

  /// 🔴 `redirectTo:` IS THE ARGUMENT THAT WAS MISSING, and without it the link
  /// resolves to the PROJECT's Site URL — one URL shared by every app in the
  /// portfolio. See [redirects] for why the value is injected.
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
  Future<void> sendPasswordReset(String email, {String? captchaToken}) =>
      _auth.resetPasswordForEmail(
        email,
        redirectTo: redirects(AuthFlow.reset),
        captchaToken: captchaToken,
      );

  /// 🔴 REFUSES WITH NO SESSION RATHER THAN LETTING THE SDK THROW ITS OWN TYPE.
  /// `updateUser` raises `AuthSessionMissingException` — a Supabase class — and
  /// this seam's contract is that nothing above the data layer ever catches a
  /// vendor type. The refusal is also the COMMONEST real outcome, not an edge
  /// case: a recovery link that has expired, been used already, or been opened
  /// on a device that never held the PKCE verifier leaves exactly this state.
  ///
  /// The `AuthException` remap keeps the SERVER's English in [core.AuthFailure.
  /// message] on purpose, and — ⏱ 2026-09-24 — its `code` and weak-password
  /// `reasons` beside it ([_failureOf]). Screens map the code first and the
  /// text only as a fallback (`authErrorText`, in `nikatru_chassis_screens`),
  /// so translating it here would break the fallback — the mapping is from a
  /// vendor TYPE to ours, not from their words to ours.
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
      throw _failureOf(e);
    }
  }

  /// 🔴 THE SCOPE IS MAPPED, NEVER DROPPED. gotrue's own default is
  /// [sb.SignOutScope.local], so a `signOut()` here that forgot to pass the
  /// scope would compile, sign this device out, and leave every other device
  /// signed in — a "Log out of all devices" that looks like it worked.
  /// `packages/auth_supabase/test/supabase_auth_repository_test.dart` asserts
  /// the scope that reaches the client for both values.
  ///
  /// 🔴 A GLOBAL SIGN-OUT FIRST MAKES SURE IT HOLDS A LIVE TOKEN, because gotrue
  /// will not. gotrue 2.26.0 `_signOut` (`gotrue_client.dart:984-1008`) sends
  /// whatever access token is IN MEMORY and IGNORES a 401 (and a 403 and a
  /// 404). An app resumed after an hour in the background still holds an
  /// expired token — the ticker is stopped while paused, see
  /// [currentAccessToken] — so without this the server would 401 the revoke,
  /// gotrue would swallow it, this device would sign out, and every other
  /// device would stay signed in behind a control that reported success.
  ///
  /// So, for [core.SignOutScope.global] with a session in hand:
  ///   · a token that refreshes (or never needed to) → the revoke is sent;
  ///   · a refresh that could not REACH the server (gotrue kept the session;
  ///     see [sessionIsGone]) → refuse BEFORE touching anything, so the user
  ///     is still signed in here and can simply try again;
  ///   · a refresh the server REFUSED → gotrue has already dropped the session
  ///     and emitted `signedOut` (`gotrue_client.dart:1533-1541`), so this
  ///     device is signed out; nothing proves the others are, so it throws.
  /// Anything the global call itself throws — the revoke request, or clearing
  /// the session stored on this device — is rethrown as [core.AuthFailure],
  /// never as the SDK's own type, and says only that it did not finish.
  ///
  /// [core.SignOutScope.local] is exactly the call it always was.
  @override
  Future<void> signOut({
    core.SignOutScope scope = core.SignOutScope.local,
  }) async {
    // A launch record outlives nothing it names: the next account on this
    // device must not inherit the last one's provider.
    _launchedProvider = null;
    if (scope == core.SignOutScope.local) {
      return _auth.signOut(scope: sdkSignOutScopeOf(scope));
    }
    if (_auth.currentSession != null && await currentAccessToken() == null) {
      throw core.AuthFailure(
        _auth.currentSession != null
            ? 'Could not reach the server. You are still signed in on every '
                'device.'
            : 'Signed out on this device, but the other devices could not be '
                'reached.',
      );
    }
    try {
      await _auth.signOut(scope: sdkSignOutScopeOf(scope));
    } catch (_) {
      throw core.AuthFailure('Signing out of every device did not finish.');
    }
  }

  /// The SDK's name for [scope]. An exhaustive switch, so a third value added
  /// to [core.SignOutScope] fails to compile here instead of falling through to
  /// a default.
  @visibleForTesting
  static sb.SignOutScope sdkSignOutScopeOf(core.SignOutScope scope) =>
      switch (scope) {
        core.SignOutScope.local => sb.SignOutScope.local,
        core.SignOutScope.global => sb.SignOutScope.global,
      };

  /// 🔴 THE ADDRESS COMES FROM THE SESSION, NEVER FROM A CALLER. gotrue's
  /// `resend` takes an arbitrary email; passing one through from a screen would
  /// make this a mail cannon anybody can aim, and it would let an unverified
  /// session redirect its own confirmation to a second inbox.
  ///
  /// [sb.OtpType.signup] specifically — `emailChange` is a different mail with a
  /// different link, and sending it to a user who has not confirmed their
  /// ORIGINAL address confirms nothing.
  @override
  Future<void> resendVerificationEmail({String? captchaToken}) async {
    final String? email = _auth.currentUser?.email;
    if (email == null || email.isEmpty) {
      throw core.AuthFailure('Sign in first, then we can resend the email.');
    }
    await _auth.resend(
      type: sb.OtpType.signup,
      email: email,
      captchaToken: captchaToken,
      // The same destination as the first confirmation mail — a resend that
      // pointed somewhere else would confirm the user into a different app.
      emailRedirectTo: redirects(AuthFlow.signUpConfirm),
    );
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
  Future<void> linkAppleIdentity() =>
      _linkIdentity(sb.OAuthProvider.apple, 'apple');

  /// ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT. [linkAppleIdentity]'s rules
  /// exactly, with Google's [googleQueryParams].
  @override
  Future<void> linkGoogleIdentity() => _linkIdentity(
        sb.OAuthProvider.google,
        'google',
        queryParams: googleQueryParams,
      );

  /// The one `linkIdentity` call every provider's link goes through.
  Future<void> _linkIdentity(
    sb.OAuthProvider provider,
    String name, {
    Map<String, String>? queryParams,
  }) async {
    if (!core.mayLinkIdentity(currentUser)) {
      throw core.AuthFailure(
        'Confirm your email address before linking another sign-in method.',
      );
    }
    _launchedProvider = name;
    // Same web-vs-native launch rule as signInWithApple above, and for the same
    // reason: a popup is blocked by default in several browsers and breaks
    // outright in embedded webviews and standalone PWAs [G-43].
    await _auth.linkIdentity(
      provider,
      redirectTo: redirects(AuthFlow.linkIdentity),
      authScreenLaunchMode: kIsWeb
          ? sb.LaunchMode.platformDefault
          : sb.LaunchMode.externalApplication,
      queryParams: queryParams,
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
  /// Returns null when there is no session, or when a needed refresh did not
  /// produce a token — for EITHER reason: the provider refused it, or the
  /// provider could not be reached. A null here is therefore NOT the signal
  /// that the session is gone; [sessionIsGone] is.
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

  /// Gone ⇔ gotrue itself no longer holds a session.
  ///
  /// 🔴 THE CLASSIFICATION IS GOTRUE'S, NOT A GUESS OF OURS. In gotrue 2.27.2
  /// `_doRefresh` (`gotrue_client.dart:1624-1633`) REMOVES the session and
  /// emits `signedOut` for every refresh failure that is NOT an
  /// `AuthRetryableFetchException` — a revoked, reused or invalid refresh
  /// token — and KEEPS it for a retryable one, which is what a transport
  /// failure is (a non-`AuthException` error keeps it too: `:1635-1640`). So
  /// after a failed refresh, "is there still a current session?" is exactly
  /// "was the refresh refused, or merely unreachable?", answered by the SDK
  /// that made the call. Re-deriving it from exception types here would be a
  /// second copy of that rule, free to drift from the one that acts on it.
  @override
  Future<bool> sessionIsGone() async {
    if (_auth.currentSession == null) return true;
    if (await currentAccessToken() != null) return false;
    return _auth.currentSession == null;
  }

  @override
  Future<core.AuthSession?> currentSession() async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    // ⏱ 2026-09-25 · O-GOOGLE-SIGN-IN-NOT-BUILT (PB-1): the provider is NAMED
    // on every session that carries a provider token, and a token whose
    // provider cannot be told is withheld rather than sent as Apple's.
    final String? provider = s.providerRefreshToken == null
        ? null
        : oauthProviderOf(
            launched: _launchedProvider,
            identityProviders: <String>[
              for (final sb.UserIdentity i
                  in s.user.identities ?? const <sb.UserIdentity>[])
                i.provider,
            ],
          );
    return core.AuthSession(
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      // ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE: the provider's own
      // refresh token, which gotrue puts on the session that completes the
      // OAuth redirect and on no session after it.
      providerRefreshToken: provider == null ? null : s.providerRefreshToken,
      oauthProvider: provider,
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
    // ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. THE ONE REFUSAL THAT KEEPS THE SESSION:
    // the server said this password-less account has not signed in recently
    // (`reauth_required`). Nothing was touched, the person is being asked to prove
    // who they are, and signing them out would make the very next step — signing
    // in with their provider — start from nothing. `reauthFailed`'s own sentence
    // says "You are still signed in", so this is what makes it true.
    if (failure is core.AccountDeletionFailure &&
        failure.outcome == core.AccountDeletionOutcome.reauthFailed) {
      throw failure;
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
