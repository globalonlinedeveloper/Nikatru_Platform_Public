import 'dart:async';

import 'auth_models.dart';
import 'auth_repository.dart';

/// ⏱ 2026-09-16 · O-SIWA-TOKEN-NOT-REVOKED-ON-DELETE — KEEP THE ONE VALUE A
/// DELETION CANNOT BE DONE WITHOUT, AND KEEP IT SERVER-SIDE.
///
/// 🔴 THE TOKEN IS OFFERED EXACTLY ONCE AND NOBODY ELSE IS HOLDING IT. Apple
/// requires an app offering Sign in with Apple to revoke the user's tokens when
/// their account is deleted, and that call takes a token. The identity provider
/// hands `provider_refresh_token` to the CLIENT in the session that completes the
/// OAuth redirect and stores none of it ("Supabase does not store them for
/// security reasons… it is up to you to store somewhere"), and supabase/auth#1308
/// — "Revoke Sign in with Apple tokens" — is closed as NOT PLANNED. It is also
/// gone from the next session: a refresh replaces it with null. So the window in
/// which it can be captured is the moment the sign-in lands, which is what this
/// watches for.
///
/// ⚠️ IT DOES NOT STORE THE TOKEN ON THE DEVICE. [send] posts it to the server
/// that will do the revoking, and nothing here writes it anywhere else: a copy in
/// device storage would be a credential this app has no use for. Nothing here
/// logs it either — see [AppleTokenNotKept].
///
/// Sends at most once per distinct token that the server ACCEPTED — a sign-out
/// and back in mints a new one and that one is sent.
///
/// ⏱ 2026-09-22 — A SEND THAT NEVER LANDED WAS RECORDED AS DONE. This used to set
/// `lastSent = token` BEFORE `await send(token)` and did not retry, on the
/// reasoning that the next sign-in offers another token. Both halves failed at
/// once in production: the shared platform Worker's CORS list left out PUT, so
/// every web send of `PUT /v1/account/apple-token` was refused at preflight — and
/// the refused token was already marked sent, so no later auth-state change ever
/// offered it again, and neither caller passed [onError], so nothing reported it.
/// "The next sign-in offers another token" is only true for a person who signs
/// out; everyone else kept a session whose one token had silently gone nowhere.
///
/// So, now:
///  • `lastSent` is set only after [send] returns — which the REST client does
///    only on a 2xx; anything else throws.
///  • A failed delivery is retried after each of [retryDelays], then STOPS and
///    reports ONE [AppleTokenNotKept] through [onError]. The next auth-state
///    change starts a fresh bounded round, because the token was never recorded
///    as delivered.
///  • Every attempt re-reads the session rather than holding the token between
///    attempts, so a retry sends what the session carries NOW — after a sign-out
///    it sends nothing, and after a switch of account it can never pair one
///    account's Apple token with another account's bearer. That is also why the
///    old worry, "a retry loop around a credential is a place for one to sit in
///    memory", does not apply: between attempts the keeper holds no copy.
///  • A sign-out, or cancelling the returned subscription, abandons a pending
///    retry and cancels its timer.
StreamSubscription<AuthUser?> keepAppleRefreshToken({
  required AuthRepository auth,
  required Future<void> Function(String refreshToken) send,
  void Function(Object error)? onError,
  List<Duration> retryDelays = appleTokenRetryDelays,
}) {
  String? lastSent;
  _Round? active;

  void abandonActive() {
    active?.abandon();
    active = null;
  }

  // One round brings the server up to date with the session: it ends when the
  // session carries no token or the token it carries is the one last ACCEPTED.
  Future<void> run(_Round round) async {
    int failures = 0;
    String? tried;
    Object? lastError;
    while (!round.abandoned) {
      try {
        final AuthSession? session = await auth.currentSession();
        final String? token = session?.providerRefreshToken;
        if (token == null || token.isEmpty || token == lastSent) break;
        tried = token;
        await send(token);
        lastSent = token;
        failures = 0;
        // Loop once more: a newer token may have landed while this one was on
        // the wire, and the next pass ends the round if not.
      } catch (e) {
        lastError = e;
        failures++;
        if (failures > retryDelays.length) {
          if (!round.abandoned) {
            // A failed capture must never break a sign-in: the person is signed
            // in either way, and the cost is that their next deletion has
            // nothing to revoke with — which the server refuses loudly.
            onError?.call(AppleTokenNotKept._(failures, lastError, tried));
          }
          break;
        }
        if (!await round.wait(retryDelays[failures - 1])) break;
      }
    }
    if (identical(active, round)) active = null;
  }

  final StreamSubscription<AuthUser?> inner =
      auth.authStateChanges().listen((AuthUser? user) {
    if (user == null) {
      abandonActive();
      return;
    }
    // A round already running re-reads the session on every pass, so it will
    // deliver whatever this event brought; a second round would only race it.
    if (active != null) return;
    final _Round round = _Round();
    active = round;
    unawaited(run(round));
  });
  return _KeeperSubscription(inner, abandonActive);
}

/// The waits between delivery attempts: 1 s, 4 s, 15 s — four attempts over
/// about twenty seconds, then [AppleTokenNotKept]. Long enough to ride out a
/// dropped connection or a Worker cold start, short enough that the session
/// which carries the token is still the one in hand.
const List<Duration> appleTokenRetryDelays = <Duration>[
  Duration(seconds: 1),
  Duration(seconds: 4),
  Duration(seconds: 15),
];

/// What [keepAppleRefreshToken] reports through `onError` when every attempt in
/// a round failed. It carries how many attempts were made and a DESCRIPTION of
/// the last failure with the token cut out of it — never the error object
/// itself, whose message is not ours to vouch for, and never the token.
class AppleTokenNotKept implements Exception {
  AppleTokenNotKept._(this.attempts, Object? lastError, String? token)
      : lastError = _redacted(lastError, token);

  /// The FIXED sentence every app reports. Fixed, and not the failure's own
  /// words, because it is the search term somebody grepping the error tracker
  /// for this class of failure will type, and because a server's message is
  /// not ours to forward: it is the one place a token could still ride out.
  static const String reason =
      'Apple refresh token was not delivered to the server';

  /// How many times delivery was attempted in the round that gave up.
  final int attempts;

  /// The last failure, as text, with any occurrence of the token replaced.
  final String lastError;

  static String _redacted(Object? error, String? token) {
    final String text = '$error';
    if (token == null || token.isEmpty) return text;
    return text.replaceAll(token, '[apple-refresh-token]');
  }

  @override
  String toString() =>
      'AppleTokenNotKept: $attempts attempt(s) failed; last: $lastError';
}

/// ⏱ 2026-09-22 · O-APPLE-KEEPER-NO-ONERROR — WHAT A CALLER SENDS ITS ERROR
/// TRACKER, DECIDED ONCE, HERE.
///
/// 🔴 EVERY CALLER REPORTS THE SAME TWO THINGS, AND THIS IS WHY IT IS A
/// FUNCTION. The app and the app TEMPLATE both hand [keepAppleRefreshToken] an
/// `onError`, and two hand-written report strings a template apart drift: one
/// app would ship the failure's own text, which is the one string a token can
/// still be hiding in ([AppleTokenNotKept] redacts the token it KNOWS about,
/// and a server that echoed it back some other way is not covered). So the
/// payload is a REASON and a COUNT: [AppleTokenNotKept.reason] verbatim, plus
/// how many attempts the round made. Nothing else — not the token, not
/// [AppleTokenNotKept.lastError], not the bearer, not the user.
///
/// The count is carried because it is the one number that separates "the
/// server is down for everybody" from "this one account cannot deliver".
String appleTokenNotKeptReport(Object error) {
  final int attempts = error is AppleTokenNotKept ? error.attempts : 0;
  return '${AppleTokenNotKept.reason} (attempts: $attempts)';
}

/// One delivery round's cancellable wait.
class _Round {
  bool abandoned = false;
  Timer? _timer;
  Completer<bool>? _waiting;

  /// Completes `true` after [delay], or `false` as soon as the round is
  /// abandoned.
  Future<bool> wait(Duration delay) {
    if (abandoned) return Future<bool>.value(false);
    final Completer<bool> done = Completer<bool>();
    _waiting = done;
    _timer = Timer(delay, () {
      if (!done.isCompleted) done.complete(true);
    });
    return done.future;
  }

  void abandon() {
    abandoned = true;
    _timer?.cancel();
    final Completer<bool>? waiting = _waiting;
    if (waiting != null && !waiting.isCompleted) waiting.complete(false);
  }
}

/// The listener's own subscription, except that cancelling it also abandons a
/// pending retry — a timer outliving its listener would send on a session that
/// nobody is watching any more.
class _KeeperSubscription implements StreamSubscription<AuthUser?> {
  _KeeperSubscription(this._inner, this._abandon);

  final StreamSubscription<AuthUser?> _inner;
  final void Function() _abandon;

  @override
  Future<void> cancel() {
    _abandon();
    return _inner.cancel();
  }

  @override
  void onData(void Function(AuthUser? data)? handleData) =>
      _inner.onData(handleData);

  @override
  void onError(Function? handleError) => _inner.onError(handleError);

  @override
  void onDone(void Function()? handleDone) => _inner.onDone(handleDone);

  @override
  void pause([Future<void>? resumeSignal]) => _inner.pause(resumeSignal);

  @override
  void resume() => _inner.resume();

  @override
  bool get isPaused => _inner.isPaused;

  @override
  Future<E> asFuture<E>([E? futureValue]) => _inner.asFuture<E>(futureValue);
}
