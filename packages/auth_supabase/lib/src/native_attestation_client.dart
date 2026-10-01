/// ⏱ 2026-09-29 · the HTTP half of native sign-in attestation — the transport
/// the native credential client ([nativeCredentialClient]) sends through.
///
/// 🔴 WHY. The platform Worker's native route forwards sign-in, sign-up, reset
/// and resend to GoTrue with no captcha, so it answered any script. The server
/// now refuses every one of those four ops unless it carries an attestation
/// bound to a fresh single-use challenge, to the request's path and query, and
/// to the EXACT body sent (wire protocol v2, `core`'s `native_attest.dart`).
/// gotrue-dart builds and sends the request itself and has no hook for extra
/// headers per call, so the binding is done HERE, one layer down, on the URL
/// and the bytes gotrue-dart actually hands over.
///
/// ⏱ 2026-09-30 · v2: the op's `target` is [core.nativeAttestTarget] of the
/// REAL outgoing request URL — the one sent, query included, so a changed
/// `redirect_to` changes the proof — and the install's is that of the install
/// URL it posts to.
///
/// For a POST to one of the four ops under the native base, and nothing else:
///   1. registers the install first when the kind needs it and it is not
///      registered (`<base>/attest/install`, its own challenge);
///   2. fetches a fresh challenge (`<base>/attest/challenge`) — one per op,
///      never reused;
///   3. computes clientData over the request's target and the exact body
///      bytes, asks the attestor for the proof, and sends the op, to that same
///      URL, with the attest headers;
///   4. on a 401 whose `error_code` is `attestation_key_unknown`, forgets the
///      registration, re-registers ONCE and retries ONCE with a new challenge.
///
/// Every other request passes through untouched — no attest header ever leaves
/// for a URL outside the native base. A refusal from the challenge or install
/// endpoint is handed back to gotrue-dart AS the op's response, so its
/// `{code, error_code, msg}` still becomes an `AuthApiException` with that code
/// (a 429 stays a rate limit). An attestor that cannot prove THROWS: the op is
/// never sent without a proof.
library;

import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:nikatru_core/nikatru_core.dart' as core;

/// ⏱ 2026-10-01 · EN-02 — the `Retry-After` of the native route's LAST
/// answer, handed from the transport to the adapter that wraps the refusal.
///
/// gotrue-dart's `AuthException` carries a status, a code and a message — never
/// a header — so the wait the platform Worker states on its 429s
/// (`native-auth.ts` `refusedBy`) was dropped before any screen could say it.
/// The transport [observe]s every answer (one with no header clears the
/// latch, so a stale wait can never ride on a later refusal) and the adapter
/// [take]s it once, when it wraps the failure.
final class RetryAfterLatch {
  Duration? _last;

  /// Records [header] from an answer; anything but whole seconds reads as none.
  void observe(String? header) {
    final int? seconds = int.tryParse(header?.trim() ?? '');
    _last = seconds == null || seconds <= 0 ? null : Duration(seconds: seconds);
  }

  /// The last observed wait, once.
  Duration? take() {
    final Duration? wait = _last;
    _last = null;
    return wait;
  }
}

/// The attesting transport for the native route at [baseUrl] (from
/// `nativeCredentialBaseUrl`) and [appId].
final class NativeAttestationClient extends http.BaseClient {
  NativeAttestationClient({
    required String baseUrl,
    required String appId,
    required core.NativeAttestor attestor,
    http.Client? inner,
    RetryAfterLatch? retryAfter,
  }) : _base = Uri.parse(baseUrl.replaceFirst(RegExp(r'/+$'), '')),
       _app = appId,
       _attestor = attestor,
       _inner = inner ?? http.Client(),
       _retryAfter = retryAfter;

  final Uri _base;
  final String _app;
  final core.NativeAttestor _attestor;
  final http.Client _inner;
  final RetryAfterLatch? _retryAfter;

  Uri _at(String path) => _base.replace(path: '${_base.path}$path');

  /// The op [request] is, or null when it is not an attested op: a POST whose
  /// origin is the base's and whose path is `<base path>/<op>`.
  String? _opOf(http.BaseRequest request) {
    if (request.method.toUpperCase() != 'POST') return null;
    final Uri url = request.url;
    if (url.scheme != _base.scheme ||
        url.host != _base.host ||
        url.port != _base.port) {
      return null;
    }
    final String prefix = '${_base.path}/';
    if (!url.path.startsWith(prefix)) return null;
    final String op = url.path.substring(prefix.length);
    return core.kNativeAttestOps.contains(op) ? op : null;
  }

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final String? op = _opOf(request);
    final http.StreamedResponse response = op == null
        ? await _inner.send(request)
        : await _attested(request, op, await request.finalize().toBytes());
    _retryAfter?.observe(response.headers['retry-after']);
    return response;
  }

  Future<http.StreamedResponse> _attested(
    http.BaseRequest original,
    String op,
    List<int> body,
  ) async {
    bool retried = false;
    while (true) {
      if (_attestor.needsInstall && !await _attestor.isRegistered(app: _app)) {
        final _Buffered? refused = await _register();
        if (refused != null) return refused.toStreamed();
      }
      final (String? challenge, _Buffered? refused) = await _challenge();
      if (refused != null) return refused.toStreamed();
      final String clientData = core.nativeAttestClientData(
        app: _app,
        op: op,
        challenge: challenge!,
        target: core.nativeAttestTarget(original.url),
        body: body,
      );
      final core.NativeAttestProof proof = await _attestor.prove(
        clientData: clientData,
      );
      final http.Request request = _copy(original, body)
        ..headers.addAll(proof.headers(challenge));
      final http.StreamedResponse response = await _inner.send(request);
      if (response.statusCode != 401 || retried || !_attestor.needsInstall) {
        return response;
      }
      // Read the 401 to see whether it is the one refusal answered here; hand
      // gotrue-dart the SAME bytes back whatever it is.
      final _Buffered answered = await _Buffered.read(response);
      if (_errorCode(answered.bytes) != core.kNativeAttestKeyUnknown) {
        return answered.toStreamed();
      }
      retried = true;
      await _attestor.forget(app: _app);
    }
  }

  /// A fresh challenge, or the endpoint's refusal to hand back as the op's.
  Future<(String?, _Buffered?)> _challenge() async {
    final Uri url = _at(core.kNativeAttestChallengePath);
    final http.Request request = http.Request('POST', url)
      ..headers['Content-Type'] = 'application/json'
      ..body = '{}';
    final _Buffered answer = await _Buffered.read(await _inner.send(request));
    if (answer.status < 200 || answer.status > 299) return (null, answer);
    final Object? json = _json(answer.bytes);
    final Object? challenge = json is Map ? json['challenge'] : null;
    if (challenge is! String || challenge.isEmpty) {
      throw http.ClientException(
        'native attestation: the challenge answer carried no challenge',
        url,
      );
    }
    return (challenge, null);
  }

  /// Registers this install's key; null on success, else the refusal to hand
  /// back as the op's response.
  Future<_Buffered?> _register() async {
    final (String? challenge, _Buffered? refused) = await _challenge();
    if (refused != null) return refused;
    final Uri url = _at(core.kNativeAttestInstallPath);
    final core.NativeAttestInstall install = await _attestor.register(
      app: _app,
      challenge: challenge!,
      target: core.nativeAttestTarget(url),
    );
    final http.Request request = http.Request('POST', url)
      ..headers['Content-Type'] = 'application/json'
      ..headers.addAll(install.headers(challenge))
      ..bodyBytes = install.body;
    final _Buffered answer = await _Buffered.read(await _inner.send(request));
    if (answer.status == 200 || answer.status == 201) {
      await _attestor.markRegistered(app: _app);
      return null;
    }
    return answer;
  }

  /// A sendable copy of [original] carrying [body] — the bytes the binding was
  /// computed over, byte for byte.
  static http.Request _copy(http.BaseRequest original, List<int> body) =>
      http.Request(original.method, original.url)
        ..headers.addAll(original.headers)
        ..bodyBytes = body
        ..followRedirects = original.followRedirects
        ..maxRedirects = original.maxRedirects
        ..persistentConnection = original.persistentConnection;

  static Object? _json(List<int> bytes) {
    try {
      return jsonDecode(utf8.decode(bytes));
    } on Object {
      return null;
    }
  }

  static String? _errorCode(List<int> bytes) {
    final Object? json = _json(bytes);
    final Object? code = json is Map ? json['error_code'] : null;
    return code is String ? code : null;
  }

  @override
  void close() => _inner.close();
}

/// A response read into memory, so it can be inspected AND still handed on.
final class _Buffered {
  _Buffered(this.source, this.bytes);

  static Future<_Buffered> read(http.StreamedResponse r) async =>
      _Buffered(r, await r.stream.toBytes());

  final http.StreamedResponse source;
  final List<int> bytes;

  int get status => source.statusCode;

  http.StreamedResponse toStreamed() => http.StreamedResponse(
    Stream<List<int>>.value(bytes),
    source.statusCode,
    contentLength: bytes.length,
    request: source.request,
    headers: source.headers,
    isRedirect: source.isRedirect,
    persistentConnection: source.persistentConnection,
    reasonPhrase: source.reasonPhrase,
  );
}
