/// ⏱ 2026-10-01 · THE SYSTEM-BROWSER HAND-OFF, app side (ADR draft
/// `native-sign-in-per-target`; row O-DESKTOP-EMAIL-SIGN-IN-HAS-NO-ATTESTED-PATH).
///
/// Windows, macOS and Linux cannot attest, so the captcha-free native route has
/// nothing to accept from them. Their sign-in runs in the SYSTEM BROWSER:
/// [signInThroughBrowser] opens nikatru.com/app/connect, waits for the code to
/// come back on the loopback (or the deep link), and exchanges it at
/// `<platform>/v1/auth/native/<app>/handoff/token` for a session of the app's
/// own. The protocol's pure half (PKCE, the URL, the callback parse) is core's
/// `browser_handoff.dart`; the server's rules are
/// `services/platform/src/lib/native-attest/handoff.ts`.
///
/// 🔴 NO PASSWORD EVER REACHES THIS APP, and the browser's own session is never
/// shared: the server mints a new one.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:nikatru_core/nikatru_core.dart' as core;

/// How long the app waits for the browser to come back before giving up.
const Duration kHandoffWaitLimit = Duration(minutes: 10);

/// The session the exchange answered — handed to the main GoTrue client by
/// `SupabaseAuthRepository.adoptHandoffSession`.
final class HandoffTokens {
  const HandoffTokens({required this.accessToken, required this.refreshToken});
  final String accessToken;
  final String refreshToken;
}

/// Where the browser hands the code back, and the arrival when it does.
abstract interface class HandoffReturn {
  /// The exact `redirect_uri` this return listens on.
  String get redirectUri;

  /// Arms the return for THIS hand-off's `state`, before the browser opens.
  /// Unarmed, nothing completes the wait; armed, only an arrival carrying
  /// [state] does, and any other is answered 404 while the wait goes on
  /// (⏱ 2026-10-02, review of #1133, finding 6: a local process or a page
  /// probing loopback that hit the path first used to end the sign-in).
  void expectState(String state);

  /// Completes with the first callback URL that carries the armed `state`.
  Future<Uri> get callback;

  Future<void> close();
}

/// Exchanges [code] for a session. Throws [core.AuthFailure] on every refusal —
/// the server answers ONE body for expired, reused and mismatched, so the app
/// can only say "start again".
Future<HandoffTokens> exchangeHandoffCode({
  required http.Client client,
  required String nativeBaseUrl,
  required String code,
  required String verifier,
  required String redirectUri,
}) async {
  final http.Response res;
  try {
    res = await client.post(
      Uri.parse('$nativeBaseUrl/handoff/token'),
      headers: const <String, String>{'Content-Type': 'application/json'},
      body: jsonEncode(<String, String>{
        'code': code,
        'code_verifier': verifier,
        'redirect_uri': redirectUri,
      }),
    );
  } on Exception {
    throw core.AuthFailure('Sign-in is unavailable. Try again shortly.');
  }
  if (res.statusCode != 200) {
    throw core.AuthFailure(
      res.statusCode == 400
          ? 'That sign-in did not complete. Start again from the app.'
          : 'Sign-in is unavailable. Try again shortly.',
    );
  }
  final Object? body;
  try {
    body = jsonDecode(res.body);
  } on FormatException {
    throw core.AuthFailure('Sign-in is unavailable. Try again shortly.');
  }
  if (body is! Map<String, dynamic>) {
    throw core.AuthFailure('Sign-in is unavailable. Try again shortly.');
  }
  final Object? access = body['access_token'];
  final Object? refresh = body['refresh_token'];
  if (access is! String || refresh is! String || access.isEmpty || refresh.isEmpty) {
    throw core.AuthFailure('Sign-in is unavailable. Try again shortly.');
  }
  return HandoffTokens(accessToken: access, refreshToken: refresh);
}

/// The whole hand-off: open the browser, wait for THIS request's code, exchange
/// it. [open] launches the system browser (the app's `url_launcher`, injected so
/// this package takes no new dependency); [ret] is where the code comes back.
/// The return is always closed, whatever happens.
Future<HandoffTokens> signInThroughBrowser({
  required String appId,
  required String nativeBaseUrl,
  required HandoffReturn ret,
  required Future<bool> Function(Uri url) open,
  required http.Client client,
  Duration waitLimit = kHandoffWaitLimit,
}) async {
  try {
    final core.HandoffRequest request =
        core.newHandoffRequest(appId: appId, redirectUri: ret.redirectUri);
    ret.expectState(request.state);
    if (!await open(request.connectUrl)) {
      throw core.AuthFailure('The browser could not be opened.');
    }
    final Uri arrived;
    try {
      arrived = await ret.callback.timeout(waitLimit);
    } on TimeoutException {
      throw core.AuthFailure('Sign-in timed out. Start again from the app.');
    }
    final String? code = core.handoffCodeOf(arrived, request);
    if (code == null) {
      throw core.AuthFailure('That sign-in did not complete. Start again from the app.');
    }
    return await exchangeHandoffCode(
      client: client,
      nativeBaseUrl: nativeBaseUrl,
      code: code,
      verifier: request.verifier,
      redirectUri: request.redirectUri,
    );
  } finally {
    await ret.close();
  }
}
