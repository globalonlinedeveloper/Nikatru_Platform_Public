import 'dart:async';

import 'package:app_links/app_links.dart' show AppLinks;
import 'package:flutter/foundation.dart'
    show debugPrint, kIsWeb, visibleForTesting;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'auth_redirect.dart';
import 'browser_handoff_client.dart' show HandoffTokens;
import 'native_attestation_client.dart' show RetryAfterLatch;

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
    sb.GoTrueClient? nativeCredentials,
    Future<void> Function()? requestServerDeletion,
    Future<void> Function(String accessToken)? revokeAtWorkers,
    DateTime Function()? clock,
    this.redirects = AuthRedirects.none,
    this.refreshSkew = const Duration(seconds: 30),
    Uri Function()? launchUri,
    Future<Uri?> Function()? deepLink,
    this.deepLinkTimeout = const Duration(seconds: 2),
    RetryAfterLatch? retryAfter,
  })  : _injected = client,
        _retryAfter = retryAfter,
        _launchUri = launchUri ?? (() => Uri.base),
        _deepLink = deepLink ?? (kIsWeb ? null : _latestAppLink),
        _native = nativeCredentials,
        _requestServerDeletion = requestServerDeletion,
        _revokeAtWorkers = revokeAtWorkers,
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

  /// ⏱ 2026-10-02 · AB-A4-01 — calls the platform Worker's
  /// `POST /v1/sessions/revoke-all`, so every Worker refuses the access tokens
  /// already issued to this account. Injected for the reason
  /// [_requestServerDeletion] is: the route lives behind the app's own REST
  /// client. GoTrue's global sign-out ends refresh tokens only, so without this
  /// another device keeps calling both Workers for up to an hour after "Log out
  /// of all devices" or a password reset. Null (a test, an app with no platform
  /// Worker) keeps the GoTrue-only behaviour; tooling/ci/assert-session-
  /// revocation.mjs limb 3 refuses an app that builds this adapter without it.
  ///
  /// ⏱ 2026-10-02 · review 1 of #1140 — it is handed the BEARER to send, rather
  /// than reading this adapter's current token, because "Log out of all
  /// devices" calls it AFTER GoTrue's global sign-out (see [signOut]), when this
  /// device holds no session any more. The token it is handed is the one this
  /// device held a moment before, still inside its `exp`.
  final Future<void> Function(String accessToken)? _revokeAtWorkers;

  sb.GoTrueClient get _auth => _injected ?? sb.Supabase.instance.client.auth;

  /// ⏱ 2026-09-28 · ST-N1d — the client a native build sends its CAPTCHA-GATED
  /// calls through, or null (web, a demo build, a test that wires none).
  ///
  /// 🔴 WITHOUT IT EVERY NATIVE SIGN-IN IS REFUSED `captcha_failed`. Box C's
  /// GoTrue captchas the password grant, /signup, /recover and /resend, and no
  /// store build carries a Turnstile site key (ADR 084). This client's base is
  /// the platform Worker's native route (`nativeCredentialClient`), which
  /// forwards exactly those four calls without the captcha. Refresh, the PKCE
  /// exchange, OAuth and id_token stay on [_auth], direct to GoTrue.
  final sb.GoTrueClient? _native;

  /// Where a captcha-gated call goes: the native route's client, or the main
  /// one. EVERY core method that declares `captchaToken` calls through this —
  /// the set `tooling/ci/assert-captcha-gated-call-sites.mjs` derives.
  sb.GoTrueClient get _credentials => _native ?? _auth;

  /// The captcha token for a gated call: dropped on the native route, which
  /// strips `gotrue_meta_security` anyway. A token minted for the web site key
  /// has no business leaving a native build.
  String? _captcha(String? token) => _native == null ? token : null;

  /// ⏱ 2026-10-01 · ADOPTS A SESSION THE SYSTEM-BROWSER HAND-OFF MINTED
  /// (`signInThroughBrowser`, browser_handoff_client.dart) — the desktop
  /// sign-in, where no attestation exists and no password reaches the app. The
  /// main client takes it the way [_handOver] gives it a native-route session,
  /// and for the same reason: `setSession` emits `signedIn`.
  Future<void> adoptHandoffSession(HandoffTokens tokens) async {
    if (tokens.refreshToken.isEmpty) throw core.AuthFailure('Sign-in failed');
    await _auth.setSession(tokens.refreshToken, accessToken: tokens.accessToken);
  }

  /// Hands a session the native client minted to the MAIN client, which owns
  /// persistence, refresh and the auth stream.
  ///
  /// 🔴 `setSession(refresh, accessToken:)`, NOT `recoverSession`. On the pinned
  /// gotrue-dart 2.26.0 `recoverSession` emits `tokenRefreshed`
  /// (`gotrue_client.dart:1177-1187`), so the router would hear of a sign-in as
  /// a refresh; `setSession` with an unexpired access token saves the session
  /// and emits `signedIn` (`:835-880`), after one `GET /user` straight to
  /// GoTrue, which no captcha gates. `native_credential_route_test.dart` holds
  /// that event.
  Future<void> _handOver(sb.Session? session) async {
    if (_native == null || session == null) return;
    final String? refreshToken = session.refreshToken;
    if (refreshToken == null || refreshToken.isEmpty) {
      throw core.AuthFailure('Sign-in failed');
    }
    await _auth.setSession(refreshToken, accessToken: session.accessToken);
  }

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

  /// The URL this process was launched with — the only place a WEB arrival's
  /// `nk_auth` marker can be read. Injectable because `Uri.base` is a property
  /// of the process.
  final Uri Function() _launchUri;

  /// ⏱ 2026-09-28 · ST-N1f (O-NATIVE-AUTH-CALLBACK-UNBUILT follow-up 3) — the
  /// one subscription that says, in the device log, what became of an auth
  /// callback. Started by the first [authEvents] or [authStateChanges] call,
  /// which every app makes at launch, and never twice: each of those streams
  /// is listened to by several providers, and a line per listener would count
  /// one callback three times.
  StreamSubscription<sb.AuthState>? _callbackLog;

  /// Whether the launch URL's own arrival has been reported ok already.
  bool _launchArrivalLogged = false;

  /// ⏱ 2026-10-01 · EN-04 / EN-15 — the latest deep link the OS handed this
  /// process, or null on web (where the callback IS the launch URL).
  ///
  /// 🔴 THE NATIVE HALF OF THE CLASSIFIER, AND WHY IT IS NOT `Uri.base`. Off
  /// web the marked callback `com.nikatru.<app>://auth-callback?nk_auth=…`
  /// reaches only `supabase_flutter`'s `app_links` listener; `Uri.base` stays
  /// `file:///`, so `failedArrivalFlowOf(Uri.base) ?? AuthFlow.reset` filed
  /// every native failure — a stale confirmation, a cancelled Apple or Google
  /// return — as a dead RESET link. `getLatestLink()` is what that listener
  /// was handed, cold start included (a late `uriLinkStream` subscriber misses
  /// the initial link; the latest-link read does not). Injectable so a widget
  /// test can be the OS.
  final Future<Uri?> Function()? _deepLink;

  static Future<Uri?> _latestAppLink() => AppLinks().getLatestLink();

  /// How long [_failedArrivalUri] waits for the deep-link read before it
  /// answers "no deep link".
  ///
  /// 🔴 BOUNDED BECAUSE THE READ SITS IN AN IN-ORDER `asyncMap`
  /// ([_authEvents]). `getLatestLink()` is a platform-channel call with no
  /// timeout of its own; a native side that never answers would pause the
  /// whole event stream behind one failed link — `signedIn`, `signedOut`,
  /// `tokenRefreshed` and `passwordRecovery` included. A `try` covers a
  /// throw, not a hang. Injectable for the test that proves it.
  final Duration deepLinkTimeout;

  /// Where the link whose exchange just FAILED came from: the latest deep link
  /// when it carries our marker, else the launch URL. Never throws — a
  /// platform that cannot answer reads as "no deep link".
  Future<Uri> _failedArrivalUri() async {
    final Future<Uri?> Function()? read = _deepLink;
    if (read != null) {
      try {
        final Uri? link = await read().timeout(
          deepLinkTimeout,
          onTimeout: () => null,
        );
        if (link != null && authArrivalOf(link).flow != null) return link;
      } catch (_) {
        // No plugin (a test), or the platform refused: the launch URL decides.
      }
    }
    return _launchUri();
  }

  /// The flow a failed exchange belonged to — reset when nothing says
  /// otherwise (ST-A2's rule, unchanged for an unmarked link).
  Future<AuthFlow> _failedFlow() async =>
      authArrivalOf(await _failedArrivalUri()).flow ?? AuthFlow.reset;

  /// Starts [_callbackLog]. Writes ONE line per outcome:
  /// `nk_auth_callback flow=<marker> outcome=<ok|failed>` — never a code, a
  /// token or an address, so a device log or a CI artefact can carry it.
  ///
  ///   · failed — the SDK re-emits every failed link exchange as a stream
  ///     ERROR (see [authEvents]); the flow is the one the router shows it as
  ///     ([_failedFlow]: the deep link's marker off web, the launch URL's on
  ///     web, else reset — ST-A2's rule).
  ///   · ok — `passwordRecovery` is only ever a reset link's exchange; a web
  ///     arrival's `signedIn` is the launch URL's marked flow, once.
  ///
  /// ⚠️ A NATIVE confirm / OAuth / link SUCCESS IS NOT LOGGED: off web the
  /// marked URL reaches only `supabase_flutter`'s own `app_links` listener, and
  /// Flutter's deep linking is off on every target (the router must not see
  /// the callback). A native FAILURE is classed by the deep link since
  /// 2026-10-01 (EN-04) — see [_deepLink].
  void _watchCallbacks() {
    _callbackLog ??= _auth.onAuthStateChange.listen(
      (sb.AuthState s) {
        if (s.event == sb.AuthChangeEvent.passwordRecovery) {
          _logCallback(AuthFlow.reset, ok: true);
        } else if (s.event == sb.AuthChangeEvent.signedIn &&
            !_launchArrivalLogged) {
          final AuthFlow? flow = authArrivalOf(_launchUri()).flow;
          if (flow != null && flow != AuthFlow.reset) {
            _launchArrivalLogged = true;
            _logCallback(flow, ok: true);
          }
        }
      },
      onError: (Object _) async => _logCallback(
        await _failedFlow(),
        ok: false,
      ),
    );
  }

  static void _logCallback(AuthFlow flow, {required bool ok}) => debugPrint(
        'nk_auth_callback flow=${flow.marker} outcome=${ok ? 'ok' : 'failed'}',
      );

  @override
  Stream<core.AuthUser?> authStateChanges() {
    _watchCallbacks();
    return _authStateChanges();
  }

  Stream<core.AuthUser?> _authStateChanges() => _auth.onAuthStateChange
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
  Stream<core.AuthEvent> authEvents() {
    _watchCallbacks();
    return _authEvents();
  }

  ///
  /// ⏱ 2026-10-01 · EN-04 / EN-15 — the failure now also says WHICH flow's
  /// link failed ([core.AuthEvent.linkFlow]), read from the deep link the SDK
  /// was handed ([_failedArrivalUri]). That read is async, so the error is
  /// carried through the stream as a [_FailedExchange] and resolved by an
  /// in-order `asyncMap`: a state that follows a failure is never delivered
  /// ahead of it, and every ordinary state passes straight through.
  Stream<core.AuthEvent> _authEvents() => _auth.onAuthStateChange
      .map<Object>((sb.AuthState s) => s)
      .transform(
        StreamTransformer<Object, Object>.fromHandlers(
          handleError: (Object error, StackTrace _, EventSink<Object> sink) =>
              sink.add(_FailedExchange(error)),
        ),
      )
      .asyncMap<core.AuthEvent>(
        (Object o) => o is _FailedExchange
            ? _failedEvent(o.error)
            : _event(o as sb.AuthState),
      );

  Future<core.AuthEvent> _failedEvent(Object error) async => core.AuthEvent(
        core.AuthEventKind.recoveryLinkFailed,
        null,
        problem: core.authLinkProblemOf(error),
        linkFlow: (await _failedFlow()).marker,
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

  /// 🔴 WRAPS THE VENDOR EXCEPTION, which it did not until 2026-09-25: a wrong
  /// password or a captcha refusal escaped this method as `sb.AuthException`,
  /// so the screen could map it only by its English, never by its code.
  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    final sb.AuthResponse res;
    try {
      res = await _credentials.signInWithPassword(
        email: email,
        password: password,
        captchaToken: _captcha(captchaToken),
      );
      await _handOver(res.session);
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
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
  ///
  /// ⏱ 2026-09-27 · ST-A3 (audit BUG-3): a fetch that never reached the server
  /// arrives as `AuthRetryableFetchException` with NO code (on web its message
  /// is "ClientException: Failed to fetch", which no sentence arm matched), so
  /// it is stamped [core.AuthFailure.network] here.
  ///
  /// ⏱ 2026-10-01 · EN-02: and the wait the native route asked for, which the
  /// vendor exception cannot carry (see [RetryAfterLatch]).
  core.AuthFailure _failureOf(sb.AuthException e) => core.AuthFailure(
        e.message,
        code: e is sb.AuthRetryableFetchException
            ? core.AuthFailure.network
            : e.code,
        reasons:
            e is sb.AuthWeakPasswordException ? e.reasons : const <String>[],
        retryAfter: _retryAfter?.take(),
      );

  /// The latch the native route's transport writes `Retry-After` into; null on
  /// web and wherever no native route is wired.
  final RetryAfterLatch? _retryAfter;

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
      res = await _credentials.signUp(
        email: email,
        password: password,
        captchaToken: _captcha(captchaToken),
        // The confirmation mail's link. Without it the user confirms into the
        // project's Site URL — app #1's web home — whichever app they signed up in.
        emailRedirectTo: redirects(AuthFlow.signUpConfirm),
      );
      // A project with confirmation off answers sign-up with a session.
      await _handOver(res.session);
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
  ///
  /// ⏱ 2026-09-25 — a refusal (the captcha, a rate limit) leaves as
  /// [core.AuthFailure] with its code, never as the SDK's own type.
  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {
    try {
      await _credentials.resetPasswordForEmail(
        email,
        redirectTo: redirects(AuthFlow.reset),
        captchaToken: _captcha(captchaToken),
      );
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
  }

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
  ///
  /// [currentPassword] travels as `current_password` in the same `PUT /user`
  /// ([_PasswordChange]) — gotrue 2.26.0's `UserAttributes` has no such field,
  /// and the live project refuses a signed-in change without it (see the
  /// contract on [core.AuthRepository.updatePassword]).
  @override
  Future<core.AuthUser> updatePassword({
    required String newPassword,
    String? currentPassword,
  }) async {
    if (_auth.currentSession == null) {
      throw core.AuthFailure(
        'Your reset link is no longer valid. Ask for a new one.',
      );
    }
    try {
      // Two calls, not one with a ternary inside: assert-auth-callbacks reads
      // `updateUser(sb.UserAttributes(password: …),` as the reset's literal
      // call, and its own mutation test edits exactly that text.
      final sb.UserResponse res = currentPassword == null
          ? await _auth.updateUser(
              sb.UserAttributes(password: newPassword),
            )
          : await _auth.updateUser(
              _PasswordChange(newPassword, currentPassword),
            );
      final core.AuthUser? u = _map(res.user);
      if (u == null) throw core.AuthFailure('Could not set your new password');
      await _revokeAfterReset();
      return u;
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
  }

  /// ⏱ 2026-10-02 · AB-A4-01 — after a NEW PASSWORD, every Worker refuses the
  /// access tokens issued before it. GoTrue has ended the other sessions'
  /// refresh tokens; their access tokens kept working at the Workers for up to
  /// an hour. revoke-all refuses this device's current token too, so the
  /// session is refreshed straight after: the new token is issued after the
  /// watermark and passes. A refresh that fails here is not the reset's
  /// failure: the next Worker 401 refreshes or signs out, as any 401 does.
  ///
  /// The order is already the one that leaves no window: GoTrue ended the
  /// other sessions' refresh tokens when it set the password, so no device
  /// can mint a token between that and the revoke.
  ///
  /// 🔴 A WORKER FAILURE IS SURFACED: the password IS set and the other devices
  /// are NOT signed out, so the refusal carries its own code
  /// ([sessionsNotRevokedCode]) and the screen says exactly that.
  ///
  /// ⏱ 2026-10-02 · review 1 of #1140, finding 1 — and the session is refreshed
  /// EVEN THEN. A failed revoke may still have written the Workers' record (a
  /// `d1Pending` answer, a lost response), which refuses this device's token
  /// too; refreshing before the refusal is raised leaves this device with a
  /// token issued after any such record, so "Log out of all devices", the
  /// advice the refusal gives, can still be sent.
  Future<void> _revokeAfterReset() async {
    final Future<void> Function(String accessToken)? revoke = _revokeAtWorkers;
    final String? token = _auth.currentSession?.accessToken;
    if (revoke == null || token == null) return;
    bool revoked = true;
    try {
      await revoke(token);
    } catch (_) {
      revoked = false;
    }
    try {
      await _auth.refreshSession();
    } catch (_) {
      // The 401 path owns a refresh that fails; see above.
    }
    if (!revoked) {
      throw core.AuthFailure(
        'Your new password is set, but your other devices could not be '
        'signed out.',
        code: sessionsNotRevokedCode,
      );
    }
  }

  /// The code of the refusal [_revokeAfterReset] raises: the new password is
  /// set and the other devices are not signed out. The chassis maps it to
  /// `authSessionsNotRevoked`.
  static const String sessionsNotRevokedCode = 'sessions_not_revoked';

  /// SE-02 (2026-10-01). The confirmation mail is the one the project
  /// already templates for an e-mail change; its link carries
  /// [AuthFlow.emailChange] so it lands back in THIS app, not on the
  /// project's Site URL (`assert-auth-callbacks.mjs` holds every
  /// `updateUser(email:)` to that). Refuses with no session, as
  /// [updatePassword] does, rather than letting the SDK throw its own type.
  @override
  Future<core.AuthUser> updateEmail({required String newEmail}) async {
    if (_auth.currentSession == null) {
      throw core.AuthFailure('You are signed out. Sign in and try again.');
    }
    try {
      final sb.UserResponse res = await _auth.updateUser(
        sb.UserAttributes(email: newEmail.trim()),
        emailRedirectTo: redirects(AuthFlow.emailChange),
      );
      final core.AuthUser? u = _map(res.user);
      if (u == null) throw core.AuthFailure('Could not change your e-mail');
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
  /// ⏱ 2026-10-02 · AB-A4-01 — and the Workers are told ([_revokeAtWorkers]):
  /// GoTrue ends refresh tokens, never an access token already issued, and
  /// only the Workers' revocation list does that.
  ///
  /// 🔴 GOTRUE FIRST, THEN THE WORKERS (review 1 of #1140, finding 2). The
  /// other order left a window: between revoke-all (which refuses tokens issued
  /// BEFORE it) and GoTrue's call, another device that refreshed was issued a
  /// token AFTER the watermark, which every Worker then admitted for up to an
  /// hour. With GoTrue first the refresh tokens are dead before the watermark
  /// is written, so no device can be issued a token after it. The Worker call
  /// is made with the access token this device held a moment earlier (read,
  /// and refreshed if under five minutes remain, before GoTrue's call):
  /// GoTrue's sign-out ends sessions, not the signature, so the Worker still
  /// accepts it until the revoke it carries.
  ///
  /// A GoTrue failure is surfaced and the Workers are NOT told (nothing proves
  /// the refresh tokens are dead, so a watermark would only re-open the
  /// window). A Worker failure AFTER GoTrue is surfaced too, and says what is
  /// true: every device is signed out of GoTrue, and the sign-ins already open
  /// elsewhere may not be refused yet.
  ///
  /// 🔴 THE HELD TOKEN MUST OUTLIVE THE WHOLE FLOW (review 2 of #1140,
  /// finding 2). It is refreshed whenever less than [globalSignOutTokenLife]
  /// remains, not merely inside [refreshSkew]: GoTrue's `/logout` may be
  /// retried by the edge-shield inside 30 s, and each Worker attempt may take
  /// 15 s to connect plus 20 s to answer, twice. A token with 30-100 s left
  /// could expire in between, and the Worker answers an expired token and a
  /// revoked one with the same 401, which the retry reads as done: other
  /// devices' access tokens would stay valid while the user was told nothing.
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
    final bool hadSession = _auth.currentSession != null;
    final String? token =
        hadSession ? await _tokenOutliving(globalSignOutTokenLife) : null;
    if (hadSession && token == null) {
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
    final Future<void> Function(String accessToken)? revoke = _revokeAtWorkers;
    if (revoke == null || token == null) return;
    try {
      await revoke(token);
    } catch (_) {
      throw core.AuthFailure(
        'You are signed out on every device, but the sign-ins already open '
        'on other devices could not all be ended. Sign in and use Log out '
        'of all devices again to finish.',
        code: core.AuthFailure.othersNotRevoked,
      );
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
  ///
  /// ⏱ 2026-09-25 — a refusal (the captcha, a rate limit) leaves as
  /// [core.AuthFailure] with its code, never as the SDK's own type.
  /// ST-A5 (audit A-6): the NO-SESSION resend, for "check your inbox" — see
  /// [core.AuthRepository.resendSignUpConfirmation] for why an address is
  /// taken here and nowhere else. Same mail, same destination as the first.
  @override
  Future<void> resendSignUpConfirmation(
    String email, {
    String? captchaToken,
  }) async {
    if (email.isEmpty) throw core.AuthFailure('Email is required');
    try {
      await _credentials.resend(
        type: sb.OtpType.signup,
        email: email,
        captchaToken: _captcha(captchaToken),
        emailRedirectTo: redirects(AuthFlow.signUpConfirm),
      );
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
  }

  @override
  Future<void> resendVerificationEmail({String? captchaToken}) async {
    final String? email = _auth.currentUser?.email;
    if (email == null || email.isEmpty) {
      throw core.AuthFailure('Sign in first, then we can resend the email.');
    }
    try {
      await _credentials.resend(
        type: sb.OtpType.signup,
        email: email,
        captchaToken: _captcha(captchaToken),
        // The same destination as the first confirmation mail — a resend that
        // pointed somewhere else would confirm the user into a different app.
        emailRedirectTo: redirects(AuthFlow.signUpConfirm),
      );
    } on sb.AuthException catch (e) {
      throw _failureOf(e);
    }
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

  /// How long the token held for "Log out of all devices" must still be valid
  /// when the flow starts: GoTrue's `/logout` (the edge-shield retries it
  /// inside 30 s) plus two Worker attempts of up to 35 s each is 100 s, and
  /// five minutes covers that three times over. See [signOut].
  @visibleForTesting
  static const Duration globalSignOutTokenLife = Duration(minutes: 5);

  /// The current access token, refreshed first (through the same single-flight
  /// refresh as [currentAccessToken]) if less than [life] remains; null when
  /// there is no session or the refresh failed.
  Future<String?> _tokenOutliving(Duration life) async {
    final sb.Session? s = _auth.currentSession;
    if (s == null) return null;
    if (!_expiresWithin(s, life)) return s.accessToken;
    return _refreshInFlight ??= _refreshOnce();
  }

  /// Whether [s] is expired, or close enough that it will be by the time a
  /// request carrying it arrives. Unknown expiry (`expiresAt == null`, which is
  /// what a token whose `exp` claim cannot be read reports) is treated as NOT
  /// expiring: refreshing on every single call would be worse than trusting a
  /// token the SDK's own ticker is already managing.
  bool _isExpiring(sb.Session s) => _expiresWithin(s, refreshSkew);

  /// Whether [s] expires within [margin] of now (see [_isExpiring] for an
  /// unknown expiry).
  bool _expiresWithin(sb.Session s, Duration margin) {
    final int? exp = s.expiresAt;
    if (exp == null) return false;
    final DateTime expiry = DateTime.fromMillisecondsSinceEpoch(
      exp * 1000,
      isUtc: true,
    );
    return !expiry.isAfter(_now().toUtc().add(margin));
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

/// A failed link exchange, carried through [SupabaseAuthRepository.authEvents]
/// until its flow is known.
final class _FailedExchange {
  const _FailedExchange(this.error);
  final Object error;
}

/// A password change that carries the CURRENT password, as `current_password`
/// beside `password` in the one `PUT /user` gotrue already sends — the field
/// the project's `security_update_password_require_current_password` demands
/// and gotrue 2.26.0's [sb.UserAttributes] cannot express.
class _PasswordChange extends sb.UserAttributes {
  _PasswordChange(String newPassword, this.currentPassword)
      : super(password: newPassword);

  final String currentPassword;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        ...super.toJson(),
        'current_password': currentPassword,
      };
}
