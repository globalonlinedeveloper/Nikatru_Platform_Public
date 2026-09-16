/// Provider-agnostic identity + session types.
///
/// Pure Dart, in `core`, so the auth CONTRACT is shared by every app and every
/// stamped clone while the SDK stays behind a swappable implementation
/// (`packages/auth_supabase` today). Lifted verbatim from
/// `apps/subscriptiontracker/lib/data/auth/` — Subly re-exports these, so no feature file
/// changed (the F0-4 shim pattern).
library;

/// A signed-in user, mapped off whatever the provider's SDK returns.
class AuthUser {
  const AuthUser({
    required this.id,
    required this.email,
    this.displayName,
    this.emailVerified = false,
    this.hasPasswordIdentity = true,
    this.lastSignInAt,
  });

  /// The provider's stable subject id — this is the `user_id` every server-side
  /// row is keyed by, so it must never be a display value.
  final String id;
  final String email;
  final String? displayName;

  /// 🔴 WHETHER THE PROVIDER HAS PROVEN THIS ADDRESS BELONGS TO THIS PERSON,
  /// AND IT DEFAULTS TO **FALSE** BECAUSE THE WRONG DEFAULT HERE IS AN ACCOUNT
  /// TAKEOVER (owner lock, 2026-08-09).
  ///
  /// Email is the MATCHING KEY for the one-identity-across-the-portfolio lock:
  /// a social sign-in whose address equals an existing account's is merged into
  /// that account. So an address nobody proved is a way IN to somebody else's
  /// Google/Apple-linked identity — register with their address, wait for them
  /// to arrive through the social door, and the two are now one account.
  ///
  /// Defaulting to false means an implementation that FORGETS to map this
  /// locks its own users out of everything past [sessionIsUnverified] until it
  /// is fixed — loudly, at once, on the first sign-in. Defaulting to true means
  /// the same omission ships the takeover path and nothing goes red. One of
  /// those two failures is recoverable.
  ///
  /// A provider with no notion of verification (the in-memory demo identity)
  /// must say so EXPLICITLY at its construction site rather than inherit this.
  final bool emailVerified;

  /// ⏱ 2026-09-15 · O-OAUTH-DELETE-REAUTH. Whether this account can prove who it is
  /// with a PASSWORD. False for an account created through Sign in with Apple
  /// (or any provider) that never set one: it has nothing to type into the delete
  /// dialog, and confirms deletion by signing in with its provider again (owner
  /// ruling on OWNER_QUEUE A-10). Supabase maps it from `app_metadata.providers`
  /// containing `email` — the same claim the platform Worker reads off the
  /// verified token, so the app and the server decide it one way.
  ///
  /// ⚠️ DEFAULTS TO TRUE, which is today's behaviour for every implementation that
  /// does not map it (the in-memory repository, fixtures): the password dialog.
  /// Neither default is safe for an adapter that FORGETS to map it — true strands
  /// a password-less user at a password box, false sends a password user to a
  /// provider sheet they have no account with — so the Supabase mapping is pinned
  /// by its own test rather than by this default.
  final bool hasPasswordIdentity;

  /// When this person last AUTHENTICATED (a sign-in, not a token refresh), as the
  /// identity provider records it. Null when unknown. Read by
  /// [confirmIdentityWithProvider] to skip a second provider sheet when the user
  /// has just come back from one.
  final DateTime? lastSignInAt;

  String get initial {
    final String source = (displayName != null && displayName!.isNotEmpty)
        ? displayName!
        : email;
    return source.isEmpty ? '?' : source.substring(0, 1).toUpperCase();
  }

  /// ⚠️ `emailVerified` IS READ WITH THE SAME FAIL-CLOSED DEFAULT AS THE
  /// CONSTRUCTOR: anything that is not literally `true` is not verification. A
  /// `j['email_verified'] != false` test would read a MISSING key as verified,
  /// which is exactly the round-trip a stale cache produces.
  factory AuthUser.fromJson(Map<String, Object?> j) => AuthUser(
    id: j['id'] is String ? j['id']! as String : '',
    email: j['email'] is String ? j['email']! as String : '',
    displayName: j['display_name'] is String
        ? j['display_name'] as String
        : null,
    emailVerified: j['email_verified'] == true,
    // Absent ⇒ the constructor default (a password account), as before this field.
    hasPasswordIdentity: j['has_password_identity'] != false,
    lastSignInAt: j['last_sign_in_at'] is String
        ? DateTime.tryParse(j['last_sign_in_at']! as String)
        : null,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'id': id,
    'email': email,
    if (displayName != null) 'display_name': displayName,
    'email_verified': emailVerified,
    'has_password_identity': hasPasswordIdentity,
    if (lastSignInAt != null)
      'last_sign_in_at': lastSignInAt!.toUtc().toIso8601String(),
  };

  /// 🔴 `emailVerified` IS PART OF IDENTITY EQUALITY, and leaving it out is how
  /// the gate would stop moving: `authStateChanges()` emits the SAME id/email
  /// the moment a user confirms their address, so a `==` blind to this field
  /// reports "no change" and every Riverpod listener keeps the unverified view.
  @override
  bool operator ==(Object other) =>
      other is AuthUser &&
      other.id == id &&
      other.email == email &&
      other.displayName == displayName &&
      other.emailVerified == emailVerified &&
      other.hasPasswordIdentity == hasPasswordIdentity &&
      other.lastSignInAt == lastSignInAt;

  @override
  int get hashCode => Object.hash(
    id,
    email,
    displayName,
    emailVerified,
    hasPasswordIdentity,
    lastSignInAt,
  );

  @override
  String toString() => 'AuthUser($id)';
}

/// A live session: the bearer token the Worker verifies, plus what is needed to
/// refresh it.
///
/// Modelled explicitly (rather than passing a bare token string around) because
/// the session is the thing that must be PERSISTED SECURELY — never in
/// `shared_preferences`, which is plaintext on every platform. `packages/
/// auth_supabase` overrides the SDK's default storage with a `SecureStore`
/// implementation for exactly this reason (G-43).
class AuthSession {
  const AuthSession({
    required this.accessToken,
    this.refreshToken,
    this.expiresAt,
    this.providerRefreshToken,
  });

  final String accessToken;
  final String? refreshToken;

  /// ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE. The IDENTITY PROVIDER'S own
  /// refresh token — Apple's, not ours — present only in the session that
  /// completes an OAuth sign-in and null in every session after it. It is here so
  /// [keepAppleRefreshToken] can hand it to the server that revokes it when the
  /// account is deleted; nothing else reads it, and nothing writes it to the
  /// device.
  final String? providerRefreshToken;

  /// Absolute expiry, UTC. Null when the provider does not report one — treated
  /// as "unknown", never as "never expires".
  final DateTime? expiresAt;

  /// Whether the token is still usable at [now], allowing [leeway] for clock
  /// skew and for the request still being in flight when it lapses.
  ///
  /// An unknown expiry returns TRUE: the server is the authority on token
  /// validity and answers with 401. Refusing to send a token we merely cannot
  /// date would sign the user out on the client's guess.
  bool isValidAt(
    DateTime now, {
    Duration leeway = const Duration(seconds: 30),
  }) {
    final DateTime? exp = expiresAt;
    if (exp == null) return true;
    return now.toUtc().add(leeway).isBefore(exp.toUtc());
  }

  factory AuthSession.fromJson(Map<String, Object?> j) => AuthSession(
    accessToken: j['access_token'] is String
        ? j['access_token']! as String
        : '',
    refreshToken: j['refresh_token'] is String
        ? j['refresh_token'] as String
        : null,
    expiresAt: j['expires_at'] is String
        ? DateTime.tryParse(j['expires_at']! as String)
        : null,
  );

  Map<String, Object?> toJson() => <String, Object?>{
    'access_token': accessToken,
    if (refreshToken != null) 'refresh_token': refreshToken,
    if (expiresAt != null) 'expires_at': expiresAt!.toUtc().toIso8601String(),
  };

  @override
  String toString() =>
      'AuthSession(expiresAt: ${expiresAt?.toIso8601String() ?? 'unknown'})';
}

/// Raised by an [AuthRepository] when a sign-in / sign-up / reset fails.
///
/// [message] is safe to show a user. Provider SDK exceptions must be mapped
/// onto this at the implementation boundary so nothing above the data layer
/// ever catches a Supabase (or any other vendor's) type.
class AuthFailure implements Exception {
  AuthFailure(this.message);
  final String message;
  @override
  String toString() => 'AuthFailure: $message';
}
