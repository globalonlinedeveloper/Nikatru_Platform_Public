/// WHY the session changed, not merely THAT it changed.
///
/// 🔴 THIS TYPE EXISTS BECAUSE THE REASON WAS BEING THROWN AWAY, AND ONE
/// PRODUCT FEATURE WAS UNBUILDABLE WITHOUT IT. `AuthRepository.authStateChanges`
/// emits `AuthUser?` — a session appeared, or it went — and every identity
/// provider worth using distinguishes several ways a session can appear.
/// Supabase's `onAuthStateChange` carries an `AuthChangeEvent`, and the adapter
/// mapped it straight out of existence (`.map((s) => _map(s.session?.user))`).
///
/// The one that matters is **password recovery**. A user who follows a reset
/// link is handed a real session, so from above the seam their arrival is
/// byte-for-byte an ordinary sign-in: same user, same token, same emission. The
/// router therefore sends them to the home screen, which is exactly where they
/// did not want to go — they came to set a password, and nothing in the app can
/// know that. There is no way to recover the distinction later; it is only
/// present at the moment the event is delivered.
library;

import 'auth_models.dart';

/// The kinds of change an [AuthEvent] can report.
///
/// Deliberately SMALLER than any one provider's enum. This is the set the app
/// can act on differently; a provider value that does not change a decision maps
/// onto the nearest of these rather than earning a member here, because an enum
/// arm nothing switches on is a decision nobody makes.
enum AuthEventKind {
  /// A session arrived through an ordinary door: email+password, OAuth, or the
  /// session restored from storage at launch.
  signedIn,

  /// The session is gone. The user object on the event is null.
  signedOut,

  /// The same session, with a fresh access token. Not an arrival — a screen
  /// that treats it as one re-runs its arrival logic every hour.
  tokenRefreshed,

  /// The user record changed (a display name, an email, a password). The
  /// session is the same one.
  userUpdated,

  /// 🔴 THE ONE THE ROUTER CANNOT INFER. A session created by following a
  /// PASSWORD-RESET link. It looks like [signedIn] in every observable respect
  /// except this label, and the app owes this user a different screen.
  passwordRecovery,

  /// 🔴 A RESET LINK ARRIVED AND COULD NOT BE TURNED INTO A SESSION — the state
  /// that was CRASHING PRODUCTION rather than being reported.
  ///
  /// GlitchTip SUBLY-8, event 2026-08-10T18:09:25Z, release subly@1.0.189: an
  /// arrival carrying `?code=…` with no matching PKCE verifier in that browser
  /// threw `AuthException(Code verifier could not be found in local storage)`
  /// with `mechanism: runZonedGuarded, handled: false, level: fatal`. The path
  /// is ordinary, not exotic: `supabase_flutter`'s `_handleDeeplink` catches the
  /// exception and re-emits it as a STREAM ERROR on `onAuthStateChange`
  /// (`supabase_auth.dart:290-297` → `gotrue_client.dart:1586` `notifyException`),
  /// and a listener with no `onError` sends it to the zone. Every real user who
  /// asks for a reset on one device and opens the mail on another lands here, as
  /// does anyone who cleared site data in between.
  ///
  /// It is an EVENT rather than an exception because the honest answer is a
  /// sentence on a screen, not a crash: the link is unusable, here is why, ask
  /// for another. [problem] carries which flavour.
  recoveryLinkFailed,
}

/// Why a reset link could not be exchanged, as far as the seam can tell.
///
/// ⚠️ CLASSIFIED FROM THE PROVIDER'S ENGLISH, and that is a deliberate,
/// bounded compromise rather than an oversight — the same one
/// `SupabaseAuthRepository` already makes when it remaps `sb.AuthException` and
/// keeps the server's message. gotrue ships no code for this case. The
/// mitigation is that MISCLASSIFYING COSTS NOTHING A USER CAN SEE: both real
/// arms end in "this link cannot be used, ask for a new one", and the split
/// exists so the screen can add the one sentence that turns a dead end into an
/// action ("open it on the device you asked from") only where that is the
/// actual cause.
enum AuthLinkProblem {
  /// The PKCE code verifier is not in THIS installation's storage. Opened on a
  /// different device or browser, or the storage was cleared in between.
  verifierMissing,

  /// The link is expired, already spent, or otherwise refused by the server.
  expiredOrUsed,

  /// Something else went wrong on the arrival. Reported rather than guessed at.
  unknown,
}

/// Classify an error raised while turning a reset link into a session.
///
/// PURE and exported so it has a test of its own: the string it matches lives in
/// a vendored SDK (`gotrue_client.dart:390`), which is exactly the kind of input
/// that changes under you without anything going red.
AuthLinkProblem authLinkProblemOf(Object error) {
  final String m = error.toString().toLowerCase();
  if (m.contains('code verifier')) return AuthLinkProblem.verifierMissing;
  if (m.contains('expired') ||
      m.contains('already been used') ||
      m.contains('otp_expired') ||
      m.contains('invalid')) {
    return AuthLinkProblem.expiredOrUsed;
  }
  return AuthLinkProblem.unknown;
}

/// One emission from [AuthRepository.authEvents].
///
/// [user] is null exactly when the change left nobody signed in — which is
/// [AuthEventKind.signedOut], and nothing else.
class AuthEvent {
  const AuthEvent(this.kind, this.user, {this.problem});

  final AuthEventKind kind;
  final AuthUser? user;

  /// Set only on [AuthEventKind.recoveryLinkFailed], where it is the whole
  /// content of the event. Null everywhere else.
  final AuthLinkProblem? problem;

  /// Whether this event should put the app into the reset-password flow.
  ///
  /// A named predicate rather than `kind == passwordRecovery` at each call site:
  /// there is exactly one rule and it belongs where it can be read once. It also
  /// refuses a recovery event with NO USER — which a provider should never send,
  /// and which would otherwise strand a signed-out visitor on a screen whose
  /// only action needs a session.
  bool get startsPasswordRecovery =>
      kind == AuthEventKind.passwordRecovery && user != null;

  /// Whether a reset link arrived and could not be exchanged.
  ///
  /// Named beside [startsPasswordRecovery] because the two are the SAME
  /// question answered opposite ways, and a screen that handles one and not the
  /// other is the shape that shipped: the success path was routed and the
  /// failure path was a fatal crash.
  bool get recoveryLinkIsUnusable => kind == AuthEventKind.recoveryLinkFailed;

  @override
  bool operator ==(Object other) =>
      other is AuthEvent &&
      other.kind == kind &&
      other.user == user &&
      other.problem == problem;

  @override
  int get hashCode => Object.hash(kind, user, problem);

  @override
  String toString() => 'AuthEvent(${kind.name}, ${user ?? 'none'}'
      '${problem == null ? '' : ', ${problem!.name}'})';
}

/// What a reset link left in the URL the app was opened with.
enum PasswordResetArrival {
  /// This launch is nothing to do with a reset link.
  none,

  /// A reset link brought the app here and the SDK has something to exchange —
  /// or has already exchanged it. The recovery event decides what happens next.
  pending,

  /// A reset link brought the app here and it CANNOT produce a session: the
  /// server refused it (expired, already spent) or the exchange failed. This is
  /// the state the dead-link explanation exists for, and until this parser
  /// existed nothing could reach it — the failure redirect lands on `/` with an
  /// unroutable fragment, so the app showed the sign-in form or a 404 instead.
  unusable,
}

/// An arrival, with the reason when there is one.
///
/// A PAIR rather than two providers reading the same source: the arrival and the
/// reason change at the same instant and are read by the same build, and two
/// notifiers over one stream is two chances to disagree about one fact.
class PasswordResetArrivalReport {
  const PasswordResetArrivalReport(this.arrival, {this.problem});

  static const PasswordResetArrivalReport none = PasswordResetArrivalReport(
    PasswordResetArrival.none,
  );

  final PasswordResetArrival arrival;

  /// Set only when [arrival] is [PasswordResetArrival.unusable]; null otherwise.
  final AuthLinkProblem? problem;

  @override
  bool operator ==(Object other) =>
      other is PasswordResetArrivalReport &&
      other.arrival == arrival &&
      other.problem == problem;

  @override
  int get hashCode => Object.hash(arrival, problem);

  @override
  String toString() => 'PasswordResetArrivalReport(${arrival.name}'
      '${problem == null ? '' : ', ${problem!.name}'})';
}
