import 'package:dio/dio.dart';

/// Raised when an API call fails — carries the HTTP [statusCode] (0 for a
/// transport-level error, [RestClient.malformedStatus] for a 2xx whose body
/// did not decode) and a human-readable [message].
class ApiException implements Exception {
  ApiException(
    this.statusCode,
    this.message, {
    this.detail,
    this.malformed = false,
    this.retryAfter,
    this.serverSentence,
  });
  final int statusCode;
  final String message;

  /// ⏱ 2026-10-01 · AB-A5-02-client. The body's `message`, when the server
  /// wrote one FOR THE USER — today only DELETE /v1/account's 503
  /// `subscription_still_billing`, whose sentence says why nothing was deleted.
  /// [message] stays the machine code; this is never parsed, only shown.
  final String? serverSentence;

  /// True when the request never got an answer: no network, DNS, a timeout.
  ///
  /// The one question every screen asks of a failure before it picks its
  /// words — "you are offline" and "the server refused" are different states
  /// with different remedies (train ST-D7). Status 0 is this client's own
  /// transport marker, so the rule lives beside it rather than in each app.
  bool get isOffline => statusCode == 0 && !malformed;

  /// The server ANSWERED, and the answer could not be read (a 2xx whose body
  /// did not decode). Not "offline": the request arrived, so an outbox sets
  /// the entry aside as a visible problem (review #1075, round 2, minor d).
  final bool malformed;

  /// The server's `Retry-After` (seconds), when it sent one — how long to wait
  /// before asking again (a 409 "still processing" on an Idempotency-Key).
  final Duration? retryAfter;

  /// [isOffline] for any thrown [error], false for anything that is not an
  /// [ApiException]: a failure this client did not classify is never assumed
  /// to be the network's.
  static bool isOfflineError(Object? error) =>
      error is ApiException && error.isOffline;

  /// The Worker's `detail` for a refused body, when it sent one — the
  /// sentence that NAMES the field (`{"error":"invalid_body","detail":"price
  /// must be …"}`). [message] stays the machine `error` code every caller
  /// already matches on; this is additive, so a form can put the refusal on
  /// the field it is about (ST-E2) instead of reporting a network failure.
  final String? detail;
  @override
  String toString() => 'ApiException($statusCode): $message';
}

/// Generic, auth-agnostic HTTP client for NIKATRU app backends (Cloudflare
/// Workers). Inject a base URL and a token provider: every request carries the
/// bearer token, a 401 triggers [onUnauthorized], and every failure maps to an
/// [ApiException]. It knows nothing about any app's domain models — per-app
/// domain clients build on top of it, so the shared spine stays app-agnostic.
class RestClient {
  RestClient({
    required String baseUrl,
    required Future<String?> Function() tokenProvider,
    Future<void> Function()? onUnauthorized,
    Dio? httpClient,
  })  : _tokenProvider = tokenProvider,
        _onUnauthorized = onUnauthorized,
        _dio = httpClient ?? Dio() {
    _dio.options
      ..baseUrl = baseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 20)
      ..headers['Content-Type'] = 'application/json';
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest:
          (RequestOptions options, RequestInterceptorHandler handler) async {
        final String? token = await _tokenProvider();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        handler.next(options);
      },
      onError: (DioException e, ErrorInterceptorHandler handler) async {
        if (e.response?.statusCode == 401 && _onUnauthorized != null) {
          await _onUnauthorized();
        }
        handler.next(e);
      },
    ));
  }

  final Future<String?> Function() _tokenProvider;
  final Future<void> Function()? _onUnauthorized;
  final Dio _dio;

  /// The base URL every request is sent to.
  String get baseUrl => _dio.options.baseUrl;

  /// A client on this one's base URL and transport that sends [token] as its
  /// bearer, and nothing else of this one: no token provider, no
  /// [onUnauthorized] (⏱ 2026-10-02 · review 1 of #1140). For a call that must
  /// carry a token the app no longer holds: revoke-all runs after GoTrue's
  /// global sign-out (`requestWorkerSessionRevocation`).
  RestClient bearing(String token) => RestClient(
    baseUrl: baseUrl,
    tokenProvider: () async => token,
    httpClient: Dio()..httpClientAdapter = _dio.httpClientAdapter,
  );

  /// Points every LATER request at [baseUrl], in place.
  ///
  /// 🔴 WHY A CLIENT IS MOVED AND NOT REBUILT (HO-10). An app learns its API
  /// base from a runtime config document that resolves AFTER the first frame.
  /// Rebuilding the client on that resolve rebuilt everything that held it —
  /// the repository, the list — and a cold launch read the list twice. A
  /// request already in flight keeps the URL it was sent to.
  void rebase(String baseUrl) {
    if (_dio.options.baseUrl != baseUrl) _dio.options.baseUrl = baseUrl;
  }

  /// GET [path] → the decoded JSON body.
  Future<dynamic> get(String path) => _send(() => _dio.get<dynamic>(path));

  /// The query parameter a write carries so a replay of it is answered, not
  /// re-applied.
  ///
  /// 🔴 A LOST RESPONSE IS NOT A FAILED WRITE (AB-O2-02). A POST that commits
  /// and then times out looks exactly like one that never arrived, so a retry
  /// inserted a second row. With a key the server answers a repeat with the
  /// row the first attempt made. The key is minted by the caller (an outbox
  /// entry's client id) and must be the SAME on every attempt of one write.
  ///
  /// 🔴 A QUERY PARAMETER, NOT A HEADER (pre-merge E2E on #1075, run
  /// 36797465703). A new request HEADER must be on the server's CORS
  /// allow-list before a browser will send it, and a server that predates it
  /// fails the preflight: every add from the web app then failed against the
  /// API as deployed. A query parameter needs nothing from the server. A
  /// server that does not know it ignores it and creates as before (a plain,
  /// unkeyed create); one that does reads it (the Worker also still accepts
  /// the `Idempotency-Key` header). So this client works against the server
  /// as deployed AND the next one, and the server works with old clients.
  static const String idempotencyKeyParam = 'idempotency_key';

  static Map<String, dynamic>? _keyed(String? idempotencyKey) =>
      idempotencyKey == null
      ? null
      : <String, dynamic>{idempotencyKeyParam: idempotencyKey};

  /// POST [body] to [path] → the decoded JSON body. See
  /// [idempotencyKeyParam] for [idempotencyKey].
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) =>
      _send(
        () => _dio.post<dynamic>(
          path,
          data: body,
          queryParameters: _keyed(idempotencyKey),
        ),
      );

  /// PUT [body] to [path] → the decoded JSON body.
  Future<dynamic> put(String path, {Object? body, String? idempotencyKey}) =>
      _send(
        () => _dio.put<dynamic>(
          path,
          data: body,
          queryParameters: _keyed(idempotencyKey),
        ),
      );

  /// PATCH [body] to [path] → the decoded JSON body.
  Future<dynamic> patch(String path, {Object? body, String? idempotencyKey}) =>
      _send(
        () => _dio.patch<dynamic>(
          path,
          data: body,
          queryParameters: _keyed(idempotencyKey),
        ),
      );

  /// DELETE [path].
  /// ⏱ 2026-09-15: returns the decoded body (it was `Future<void>`), because
  /// `DELETE /v1/account` answers 202 `{ status: 'erasure_pending' }` ([ADR 081])
  /// and that body is the only thing that tells "accepted, finishing" from
  /// "deleted". Every existing caller awaited and ignored the value.
  Future<dynamic> delete(String path) {
    return _send(() => _dio.delete<dynamic>(path));
  }

  /// The status a malformed 2xx is reported with: [ApiException.statusCode]
  /// of an answer that arrived and could not be read.
  ///
  /// 🔴 A SERVER ERROR, NEVER 0 (SV-04). It was `ApiException(0, ...)`, and 0
  /// is this client's transport marker — so every reader that asks the status
  /// ("is this offline?") told the user to check their connection about a
  /// server that had answered. 502 is HTTP's own name for "the upstream sent
  /// an invalid response", and it is a 5xx, so a screen picks its
  /// server-problem sentence without knowing this case exists.
  static const int malformedStatus = 502;

  /// Map a successful response [body] through [parse], converting any
  /// parse/shape failure into an [ApiException] — so a malformed 2xx body
  /// surfaces as a SERVER error ([malformedStatus], `malformed: true`), never
  /// as a raw `TypeError` and never as a transport (offline) error.
  /// Domain clients wrap their `fromJson`/casts in this so callers can rely on a
  /// single `ApiException` failure contract. Transport errors are already mapped
  /// by the request methods above.
  T decode<T>(Object? body, T Function(Object? body) parse) {
    try {
      return parse(body);
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(
        malformedStatus,
        'Malformed response: $e',
        malformed: true,
      );
    }
  }

  Future<dynamic> _send(Future<Response<dynamic>> Function() call) async {
    try {
      final Response<dynamic> res = await call();
      return res.data;
    } catch (e) {
      _fail(e);
    }
  }

  Never _fail(Object e) {
    if (e is DioException) {
      final int code = e.response?.statusCode ?? 0;
      final dynamic data = e.response?.data;
      final String msg = (data is Map && data['error'] != null)
          ? data['error'].toString()
          : e.message ?? 'Network error';
      final Object? detail = data is Map ? data['detail'] : null;
      final int? wait = int.tryParse(
        e.response?.headers.value('retry-after')?.trim() ?? '',
      );
      final Object? sentence = data is Map ? data['message'] : null;
      throw ApiException(
        code,
        msg,
        detail: detail?.toString(),
        retryAfter: wait == null ? null : Duration(seconds: wait),
        serverSentence: sentence is String && sentence.isNotEmpty
            ? sentence
            : null,
      );
    }
    throw ApiException(0, e.toString());
  }
}
