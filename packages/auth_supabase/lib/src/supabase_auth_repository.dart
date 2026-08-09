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
    this.refreshSkew = const Duration(seconds: 30),
  })  : _injected = client,
        _requestServerDeletion = requestServerDeletion,
        _now = clock ?? (() => DateTime.now().toUtc());

  final sb.GoTrueClient? _injected;

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

  core.AuthUser? _map(sb.User? u) => u == null
      ? null
      : core.AuthUser(
          id: u.id,
          email: u.email ?? '',
          displayName: u.userMetadata?['full_name'] as String?,
        );

  @override
  core.AuthUser? get currentUser => _map(_auth.currentUser);

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      _auth.onAuthStateChange.map((sb.AuthState s) => _map(s.session?.user));

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

  @override
  Future<void> sendPasswordReset(String email) =>
      _auth.resetPasswordForEmail(email);

  @override
  Future<void> signOut() => _auth.signOut();

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
        failure = core.AuthFailure(
          'Account deletion is not available yet: the server route is not '
          'wired. Your account has NOT been deleted.',
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
