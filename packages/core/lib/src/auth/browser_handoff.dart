/// ⏱ 2026-10-01 · THE SYSTEM-BROWSER HAND-OFF, client protocol (ADR draft
/// `native-sign-in-per-target`, which amends ADR no.084; row
/// O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH).
///
/// 🔴 WHY. Windows, macOS and Linux cannot attest — no Play Integrity, no App
/// Attest — so the captcha-free native route has nothing it can accept from
/// them. Their sign-in happens in the SYSTEM BROWSER instead, on nikatru.com
/// (`sites/nikatru/app/connect.html`: Sign in with Apple today, because a
/// static page may not load Turnstile; an email account through the web app's
/// Turnstile-gated sign-in is the stacked follow-up), and only a short-lived,
/// single-use, PKCE-bound code comes back to the app, which the platform Worker
/// exchanges for a session of the app's own
/// (`services/platform/src/lib/native-attest/handoff.ts` is the server half and
/// says every rule the code obeys). NO PASSWORD EVER REACHES THE NATIVE APP.
///
/// This file is the PURE part, so every target can test it: the PKCE pair, the
/// URL the browser opens, and the parse of the URL the browser comes back with.
/// The loopback listener and the exchange live in `nikatru_auth_supabase`.
library;

import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart' show sha256;

import 'native_attest.dart' show nativeAttestBase64Url;

/// The signed-in page that mints the code (`sites/nikatru/app/connect.html`).
const String kHandoffConnectUrl = 'https://nikatru.com/app/connect';

/// The path a desktop build listens on at `http://127.0.0.1:<port>` (RFC 8252
/// §7.3). The server holds the redirect to EXACTLY this shape.
const String kHandoffLoopbackPath = '/nk-auth-callback';

/// The query parameter the code comes back in. NOT `code`: `supabase_flutter`
/// treats any `?code=` arrival as its own PKCE exchange and would spend it at
/// GoTrue, where it means nothing.
const String kHandoffCodeParam = 'nk_code';

/// The loopback return address for [port].
String handoffLoopbackRedirect(int port) {
  if (port < 1024 || port > 65535) {
    throw ArgumentError.value(port, 'port', 'must be an unprivileged port');
  }
  return 'http://127.0.0.1:$port$kHandoffLoopbackPath';
}

/// One hand-off in flight: the secret half ([verifier], [state]) stays in the
/// app; [connectUrl] is what the system browser opens.
final class HandoffRequest {
  const HandoffRequest({
    required this.verifier,
    required this.challenge,
    required this.state,
    required this.redirectUri,
    required this.connectUrl,
  });

  /// RFC 7636 §4.1, 43 characters. NEVER leaves the app except in the exchange.
  final String verifier;

  /// base64url(SHA-256([verifier])) — S256, the only method the server takes.
  final String challenge;

  /// Echoed back by the page; a callback carrying any other value is not ours.
  final String state;

  /// Where the browser hands the code back: the loopback or the app's deep link.
  final String redirectUri;

  final Uri connectUrl;
}

/// base64url(SHA-256(verifier)) without padding — RFC 7636 §4.6.
String handoffS256(String verifier) =>
    nativeAttestBase64Url(sha256.convert(ascii.encode(verifier)).bytes);

/// A fresh [HandoffRequest] for [appId], returning to [redirectUri].
/// [random] defaults to the OS CSPRNG and is a parameter only so tests are
/// deterministic.
HandoffRequest newHandoffRequest({
  required String appId,
  required String redirectUri,
  Random? random,
  String connectBase = kHandoffConnectUrl,
}) {
  final Random rng = random ?? Random.secure();
  String token(int bytes) => nativeAttestBase64Url(
        List<int>.generate(bytes, (_) => rng.nextInt(256)),
      );
  final String verifier = token(32);
  final String state = token(16);
  final String challenge = handoffS256(verifier);
  final Uri base = Uri.parse(connectBase);
  return HandoffRequest(
    verifier: verifier,
    challenge: challenge,
    state: state,
    redirectUri: redirectUri,
    connectUrl: base.replace(
      queryParameters: <String, String>{
        'app': appId,
        'redirect_uri': redirectUri,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
        'state': state,
      },
    ),
  );
}

/// The code a callback URL carries for [request], or null when the URL is not
/// THIS hand-off's return: another address, another `state`, or no code.
///
/// 🔴 THE ADDRESS IS COMPARED, NOT JUST THE QUERY: a callback arriving on the
/// right port but another path, or on the deep link when the loopback was asked
/// for, is not this request's. The server refuses a mismatched redirect anyway;
/// refusing here means a stray URL never costs an exchange.
String? handoffCodeOf(Uri callback, HandoffRequest request) {
  final Uri expected = Uri.parse(request.redirectUri);
  if (callback.scheme != expected.scheme ||
      callback.host != expected.host ||
      callback.port != expected.port ||
      callback.path != expected.path) {
    return null;
  }
  final Map<String, String> q;
  try {
    q = callback.queryParameters;
  } on FormatException {
    return null;
  }
  for (final MapEntry<String, String> e in expected.queryParameters.entries) {
    if (q[e.key] != e.value) return null;
  }
  if (q['state'] != request.state) return null;
  final String? code = q[kHandoffCodeParam];
  if (code == null || code.isEmpty || code.length > 2048) return null;
  return code;
}
