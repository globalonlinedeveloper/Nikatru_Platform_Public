import 'package:dio/dio.dart';

/// Raised when an API call fails — carries the HTTP [statusCode] (0 for a
/// transport-level error) and a human-readable [message].
class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
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

  /// GET [path] → the decoded JSON body.
  Future<dynamic> get(String path) => _send(() => _dio.get<dynamic>(path));

  /// POST [body] to [path] → the decoded JSON body.
  Future<dynamic> post(String path, {Object? body}) =>
      _send(() => _dio.post<dynamic>(path, data: body));

  /// PUT [body] to [path] → the decoded JSON body.
  Future<dynamic> put(String path, {Object? body}) =>
      _send(() => _dio.put<dynamic>(path, data: body));

  /// PATCH [body] to [path] → the decoded JSON body.
  Future<dynamic> patch(String path, {Object? body}) =>
      _send(() => _dio.patch<dynamic>(path, data: body));

  /// DELETE [path].
  /// ⏱ 2026-09-15: returns the decoded body (it was `Future<void>`), because
  /// `DELETE /v1/account` answers 202 `{ status: 'erasure_pending' }` ([ADR 081])
  /// and that body is the only thing that tells "accepted, finishing" from
  /// "deleted". Every existing caller awaited and ignored the value.
  Future<dynamic> delete(String path) {
    return _send(() => _dio.delete<dynamic>(path));
  }

  /// Map a successful response [body] through [parse], converting any
  /// parse/shape failure into an [ApiException] — so a malformed 2xx body
  /// surfaces the same way as a transport error, not as a raw `TypeError`.
  /// Domain clients wrap their `fromJson`/casts in this so callers can rely on a
  /// single `ApiException` failure contract. Transport errors are already mapped
  /// by the request methods above.
  T decode<T>(Object? body, T Function(Object? body) parse) {
    try {
      return parse(body);
    } on ApiException {
      rethrow;
    } catch (e) {
      throw ApiException(0, 'Malformed response: $e');
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
      throw ApiException(code, msg);
    }
    throw ApiException(0, e.toString());
  }
}
