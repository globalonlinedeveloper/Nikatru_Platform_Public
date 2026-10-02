// ─────────────────────────────────────────────────────────────────────────────
// sessions_transport.dart — "Your devices" (SE-03): the account's signed-in
// sessions, and signing ONE other device out.
//
// ⏱ 2026-10-01 · train ST-SETTINGS. The platform Worker has served
// `GET /v1/sessions` and `DELETE /v1/sessions/:id` since AUTH-REVOKE-AT-WORKERS
// (services/platform/src/routes/sessions.ts), and no client called either:
// the only control a person had was "Log out of all devices", which takes the
// device in their hand with it. This is the contract every app's devices list
// reads; the dio client is `DioSessionsTransport` in packages/api_client.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';

import 'auth/auth_models.dart';
import 'result.dart';

/// One signed-in session, as `GET /v1/sessions` describes it (`SessionView`
/// in sessions.ts). No IP address, ever — the host never sends one.
class DeviceSession {
  const DeviceSession({
    required this.id,
    required this.current,
    required this.device,
    this.createdAt,
    this.lastActiveAt,
  });

  /// The session id `DELETE /v1/sessions/:id` takes.
  final String id;

  /// Whether this is the session the CALLER holds — "this device". The host
  /// refuses to revoke it by id (409 `current_session`); signing this device
  /// out is "Log out", which also forgets its local state.
  final bool current;

  /// A short label the host derived from the User-Agent, e.g. "Chrome on
  /// Windows" — or "Unknown device".
  final String device;

  final DateTime? createdAt;
  final DateTime? lastActiveAt;

  /// The host's row, or null when it is not one. A row without an id cannot
  /// be acted on, so it is not shown rather than shown inert.
  static DeviceSession? tryParse(Map<String, Object?> j) {
    final Object? id = j['id'];
    final Object? current = j['current'];
    final Object? device = j['device'];
    if (id is! String || id.isEmpty || current is! bool) return null;
    return DeviceSession(
      id: id,
      current: current,
      device: device is String && device.isNotEmpty ? device : 'Unknown device',
      createdAt: _time(j['createdAt']),
      lastActiveAt: _time(j['lastActiveAt']),
    );
  }

  static DateTime? _time(Object? v) =>
      v is String ? DateTime.tryParse(v)?.toUtc() : null;
}

/// What `DELETE /v1/sessions/:id` answered, by STATUS — the route's refusals
/// carry `{error}` and nothing a client needs beyond the status, so the status
/// set IS the wire contract (`assert-analytics-contract` pins it, as it pins
/// account deletion's).
enum SessionRevokeOutcome {
  /// 204: the session can no longer refresh, and its token is refused.
  revoked,

  /// 404: no such session on this account — already signed out, or never
  /// this account's. Either way it is not signed in here any more.
  gone,

  /// 409: the caller's OWN session. Signing this device out is "Log out".
  currentSession,

  /// 429: too many session calls for this account in the last minute.
  rateLimited,

  /// 503: the session store cannot be reached; nothing was changed.
  unavailable,

  /// No status, or one this contract does not model.
  unknown;

  /// Whether the device is now signed out — what the list acts on.
  bool get signedOut => this == revoked || this == gone;

  static SessionRevokeOutcome forStatus(int? status) {
    switch (status) {
      case 200:
      case 204:
        return SessionRevokeOutcome.revoked;
      case 404:
        return SessionRevokeOutcome.gone;
      case 409:
        return SessionRevokeOutcome.currentSession;
      case 429:
        return SessionRevokeOutcome.rateLimited;
      case 503:
        return SessionRevokeOutcome.unavailable;
      default:
        return SessionRevokeOutcome.unknown;
    }
  }
}

/// The two session routes, AUTHED like every per-person route: a null or
/// empty [accessToken] is a signed-out caller, refused before any request.
abstract interface class SessionsTransport {
  /// Every session the account holds, the caller's marked [DeviceSession.current].
  Future<Result<List<DeviceSession>>> list({required String? accessToken});

  /// Sign ONE OTHER session out. The caller's own session is untouched — the
  /// host refuses it by id — so this never ends the session in hand. Ok when
  /// the session is signed out ([SessionRevokeOutcome.signedOut]); otherwise
  /// the failure's cause is the [SessionRevokeOutcome].
  Future<Result<void>> revoke({
    required String id,
    required String? accessToken,
  });
}

/// The default for demo builds, widget tests and any app with no backend: it
/// cannot ask, and says so — never an empty list, which would read as "no
/// other devices are signed in".
class UnavailableSessionsTransport implements SessionsTransport {
  const UnavailableSessionsTransport();

  static const Failure _unavailable = Failure(
    'sessions unavailable in this build',
  );

  @override
  Future<Result<List<DeviceSession>>> list({
    required String? accessToken,
  }) async => const Result<List<DeviceSession>>.err(_unavailable);

  @override
  Future<Result<void>> revoke({
    required String id,
    required String? accessToken,
  }) async => const Result<void>.err(_unavailable);
}

/// The `session_id` claim of a GoTrue access token — which of the account's
/// sessions the token belongs to — or null when [accessToken] is absent or is
/// not a JWT carrying one.
///
/// ⏱ 2026-10-01 · review of #1129, finding 5. Re-authenticating by password
/// (or with the provider again) MINTS A NEW SESSION and leaves the old one
/// alive server-side, forever — sessions never expire there (ADR 059
/// decision 6). Reading the id before and after the re-authentication is how
/// the settings change knows which session to sign out once it has replaced
/// it. Nothing here verifies the token: it is the app's own, read only to
/// name a session the host will check again on `DELETE /v1/sessions/:id`.
String? sessionIdOfAccessToken(String? accessToken) {
  final List<String> parts = (accessToken ?? '').split('.');
  if (parts.length != 3) return null;
  try {
    final Object? claims = jsonDecode(
      utf8.decode(base64Url.decode(base64Url.normalize(parts[1]))),
    );
    final Object? id = claims is Map<String, Object?>
        ? claims['session_id']
        : null;
    return id is String && id.isNotEmpty ? id : null;
  } on FormatException {
    return null;
  }
}

/// Whether going from [before] to [after] is a CONFIRMED e-mail change: the
/// same account, now under a different address.
///
/// ⏱ 2026-10-01 · ADR 059 decision 2 ("global sign-out after a successful
/// change"), review of #1129 finding 2. With secure e-mail change the address
/// moves only once BOTH links are followed, and only then does a session or a
/// refresh carry the new address — so this is true exactly when the change
/// has completed, never at the request and never on the first link. A
/// different account (a sign-out and a sign-in) is not a change.
bool emailChangeCompleted(AuthUser? before, AuthUser? after) =>
    before != null &&
    after != null &&
    before.id == after.id &&
    before.email.toLowerCase() != after.email.toLowerCase();
