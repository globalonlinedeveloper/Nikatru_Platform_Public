/// ⏱ 2026-09-28 · ST-N1d (rows O-BOXA-CAPTCHA-REFUSES-NATIVE-SIGN-IN,
/// O-NATIVE-AUTH-CALLBACK-UNBUILT) — the SECOND GoTrue client a native build
/// sends its captcha-gated calls through.
///
/// 🔴 WHY A SECOND CLIENT. Box C's GoTrue enforces Turnstile on the password
/// grant, /signup, /recover and /resend, for the whole server, and ADR 084 keeps
/// the site key out of every store build — so every native sign-in was refused
/// `captcha_failed`. The platform Worker's native route
/// (`services/platform/src/routes/native-auth.ts`) forwards exactly those four
/// calls with the service-role bearer, which GoTrue does not captcha, and it
/// serves them at the paths gotrue-dart builds from a base URL. So a
/// `GoTrueClient` whose base is `<platformBaseUrl>/v1/auth/native/<appId>`
/// speaks to it with no code of ours on the wire.
///
/// Everything else stays DIRECT to GoTrue on the main client: refresh, the PKCE
/// code exchange, OAuth and id_token, which GoTrue never asks for a captcha
/// (supabase/auth v2.189.0 middleware.go:253-275). Web builds get no second
/// client at all and keep Turnstile at GoTrue, unchanged.
///
/// Amendment to ADR 084 / ADR 059 lock 5 ruled 2026-09-28; ADR pending in
/// Private.
///
/// ⏱ 2026-09-29 · 🔴 AND IT NOW ATTESTS. The route took no captcha, so it took
/// any script: a sign-up / reset-mail cannon behind nothing but a rate limit.
/// The server now refuses every op that carries no attestation (wire protocol
/// v1, `core`'s `native_attest.dart`), so this client sends through
/// [NativeAttestationClient], which binds each op to a fresh challenge and to
/// its exact body with the build's [core.NativeAttestor] — Play Integrity on
/// android, App Attest on ios/macos, a per-install Ed25519 key elsewhere
/// (`platformNativeAttestor` in `nikatru_platform_storage`).
library;

import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform, kIsWeb;
import 'package:http/http.dart' as http;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

import 'native_attestation_client.dart';

/// The five targets that register `com.nikatru.<app>://auth-callback` — the
/// only ones the native route's pinned redirect can send a mail link back to.
const Set<TargetPlatform> _nativeTargets = <TargetPlatform>{
  TargetPlatform.android,
  TargetPlatform.iOS,
  TargetPlatform.macOS,
  TargetPlatform.windows,
  TargetPlatform.linux,
};

/// The native route's base for [appId], or null where no second client belongs.
///
/// NULL ON WEB (the browser keeps Turnstile; the route refuses any request that
/// carries `Origin`), on a target with no registered callback, and in a DEMO
/// build, which is one whose [platformBaseUrl] is not an absolute http(s) URL:
/// a demo build wires the in-memory repository and never reaches this, and a
/// blank define must not turn into a relative URL that some request resolves.
///
/// PURE, taking the host as inputs, for the reason `authRedirectUrl` is: a value
/// only computed on the host it describes is one five of six platforms never
/// check.
String? nativeCredentialBaseUrl(
  String platformBaseUrl,
  String appId, {
  bool isWeb = kIsWeb,
  TargetPlatform? platform,
}) {
  if (isWeb) return null;
  if (!_nativeTargets.contains(platform ?? defaultTargetPlatform)) return null;
  final Uri? base = Uri.tryParse(platformBaseUrl.trim());
  if (base == null ||
      !(base.isScheme('https') || base.isScheme('http')) ||
      base.host.isEmpty ||
      appId.isEmpty) {
    return null;
  }
  final String root = base.toString().replaceFirst(RegExp(r'/+$'), '');
  return '$root/v1/auth/native/$appId';
}

/// The second client for [appId], or null wherever [nativeCredentialBaseUrl] is
/// — and wherever [attestor] is.
///
/// 🔴 IT SHARES THE MAIN CLIENT'S PKCE STORE, AND THAT IS WHAT MAKES A MAIL LINK
/// WORK. gotrue-dart 2.26.0 keeps the code verifier under ONE fixed key,
/// `supabase.auth.token-code-verifier`, in whatever `asyncStorage` the client
/// was given (`gotrue_client.dart:440-446`), and the exchange reads it back from
/// its own (`:386-392`). The sign-up and the reset are sent by THIS client; the
/// exchange runs on the MAIN client when the link comes back. Two stores would
/// make every confirmation and every reset link "Code verifier could not be
/// found". [nikatruPkceStorage] is the one store both are handed.
///
/// `autoRefreshToken: false` because this client never owns a session: it
/// hands each one to the main client, which refreshes it directly at GoTrue.
/// No `apikey` header: the route adds its own and drops any it is sent.
///
/// ⏱ 2026-09-29 · [attestor] is REQUIRED, and null means NO client. A native
/// build with no attestor has no route to use — the server refuses every
/// unattested op — so it gets none rather than one that fails every call; it
/// falls back to the main client and GoTrue's captcha, exactly as web does.
/// Required rather than defaulted so that no call site can forget it: the one
/// argument that decides whether sign-in works on five targets is written at
/// each of them. [transport] is the attesting client's inner transport, for
/// tests; production takes `package:http`'s default.
sb.GoTrueClient? nativeCredentialClient({
  required String platformBaseUrl,
  required String appId,
  required core.NativeAttestor? attestor,
  bool isWeb = kIsWeb,
  TargetPlatform? platform,
  sb.GotrueAsyncStorage? pkceStorage,
  http.Client? transport,
  RetryAfterLatch? retryAfter,
}) {
  final String? url = nativeCredentialBaseUrl(
    platformBaseUrl,
    appId,
    isWeb: isWeb,
    platform: platform,
  );
  if (url == null || attestor == null) return null;
  return sb.GoTrueClient(
    url: url,
    autoRefreshToken: false,
    flowType: sb.AuthFlowType.pkce,
    asyncStorage: pkceStorage ?? nikatruPkceStorage,
    httpClient: NativeAttestationClient(
      baseUrl: url,
      appId: appId,
      attestor: attestor,
      inner: transport,
      retryAfter: retryAfter,
    ),
  );
}

/// The PKCE verifier store the main client ([nikatruAuthOptions]) and the
/// native client ([nativeCredentialClient]) are both handed — the SAME object.
///
/// It is `supabase_flutter`'s own default (`SharedPreferencesGotrueAsyncStorage`,
/// what `Supabase.initialize` builds when none is passed), so the verifier lands
/// where it always did. Built on first USE rather than at first read, because
/// that class starts a platform-channel read in its constructor, and reading
/// this value to wire it must not need a plugin.
final sb.GotrueAsyncStorage nikatruPkceStorage = _SharedPkceStorage();

final class _SharedPkceStorage extends sb.GotrueAsyncStorage {
  sb.GotrueAsyncStorage? _inner;

  sb.GotrueAsyncStorage get _store =>
      _inner ??= sb.SharedPreferencesGotrueAsyncStorage();

  @override
  Future<String?> getItem({required String key}) => _store.getItem(key: key);

  @override
  Future<void> removeItem({required String key}) => _store.removeItem(key: key);

  @override
  Future<void> setItem({required String key, required String value}) =>
      _store.setItem(key: key, value: value);
}
