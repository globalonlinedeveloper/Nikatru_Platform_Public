/// Provider-agnostic identity + session types.
///
/// Pure Dart, in `core`, so the auth CONTRACT is shared by every app and every
/// stamped clone while the SDK stays behind a swappable implementation
/// (`packages/auth_supabase` today). Lifted verbatim from
/// `apps/subly/lib/data/auth/` — Subly re-exports these, so no feature file
/// changed (the F0-4 shim pattern).
library;

/// A signed-in user, mapped off whatever the provider's SDK returns.
class AuthUser {
  const AuthUser({required this.id, required this.email, this.displayName});

  /// The provider's stable subject id — this is the `user_id` every server-side
  /// row is keyed by, so it must never be a display value.
  final String id;
  final String email;
  final String? displayName;

  String get initial {
    final String source =
        (displayName != null && displayName!.isNotEmpty) ? displayName! : email;
    return source.isEmpty ? '?' : source.substring(0, 1).toUpperCase();
  }

  factory AuthUser.fromJson(Map<String, Object?> j) => AuthUser(
        id: j['id'] is String ? j['id']! as String : '',
        email: j['email'] is String ? j['email']! as String : '',
        displayName:
            j['display_name'] is String ? j['display_name'] as String : null,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'email': email,
        if (displayName != null) 'display_name': displayName,
      };

  @override
  bool operator ==(Object other) =>
      other is AuthUser &&
      other.id == id &&
      other.email == email &&
      other.displayName == displayName;

  @override
  int get hashCode => Object.hash(id, email, displayName);

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
  });

  final String accessToken;
  final String? refreshToken;

  /// Absolute expiry, UTC. Null when the provider does not report one — treated
  /// as "unknown", never as "never expires".
  final DateTime? expiresAt;

  /// Whether the token is still usable at [now], allowing [leeway] for clock
  /// skew and for the request still being in flight when it lapses.
  ///
  /// An unknown expiry returns TRUE: the server is the authority on token
  /// validity and answers with 401. Refusing to send a token we merely cannot
  /// date would sign the user out on the client's guess.
  bool isValidAt(DateTime now,
      {Duration leeway = const Duration(seconds: 30)}) {
    final DateTime? exp = expiresAt;
    if (exp == null) return true;
    return now.toUtc().add(leeway).isBefore(exp.toUtc());
  }

  factory AuthSession.fromJson(Map<String, Object?> j) => AuthSession(
        accessToken:
            j['access_token'] is String ? j['access_token']! as String : '',
        refreshToken:
            j['refresh_token'] is String ? j['refresh_token'] as String : null,
        expiresAt: j['expires_at'] is String
            ? DateTime.tryParse(j['expires_at']! as String)
            : null,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'access_token': accessToken,
        if (refreshToken != null) 'refresh_token': refreshToken,
        if (expiresAt != null)
          'expires_at': expiresAt!.toUtc().toIso8601String(),
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
