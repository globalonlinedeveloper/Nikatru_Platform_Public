import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.SessionsTransport] — the client for the platform Worker's
/// session routes (SE-03, `services/platform/src/routes/sessions.ts`):
///
/// - `GET {platformBaseUrl}/v1/sessions` — `{ sessions: SessionView[] }`;
/// - `DELETE {platformBaseUrl}/v1/sessions/:id` — sign ONE other session out
///   (409 `current_session` for the caller's own).
///
/// AUTHENTICATED, like [DioReminderChannelsTransport]: every route is about a
/// PERSON. Both routes share the `sessions:<sub>` rate limit, so this is
/// called from a deliberate tap on Settings, never from a `build`.
class DioSessionsTransport implements core.SessionsTransport {
  DioSessionsTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  static const core.Failure _noSession = core.Failure(
    'no session: devices cannot be listed',
  );

  Options _options(String accessToken) => Options(
    sendTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
    validateStatus: (int? s) => s != null && s >= 200 && s < 300,
    headers: <String, Object?>{'authorization': 'Bearer $accessToken'},
  );

  static bool _signedOut(String? t) => t == null || t.isEmpty;

  @override
  Future<core.Result<List<core.DeviceSession>>> list({
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<List<core.DeviceSession>>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        '$_base/v1/sessions',
        options: _options(accessToken!),
      );
      return _sessions(res.data);
    } catch (e) {
      return core.Result<List<core.DeviceSession>>.err(
        core.Failure('sessions read failed', cause: e),
      );
    }
  }

  /// The `{sessions: [...]}` envelope, each row through
  /// [core.DeviceSession.tryParse]. `assert-analytics-contract` reads the keys
  /// this member subscripts (`sessions-list`).
  static core.Result<List<core.DeviceSession>> _sessions(Object? body) {
    final Object? rows = body is Map ? body['sessions'] : null;
    // A 2xx without the list is not an answer — and must not become an
    // empty one, which says "no other device is signed in".
    if (rows is! List) {
      return const core.Result<List<core.DeviceSession>>.err(
        core.Failure('sessions response was not a list'),
      );
    }
    return core.Result<List<core.DeviceSession>>.ok(<core.DeviceSession>[
      for (final Object? row in rows)
        if (row is Map)
          ?core.DeviceSession.tryParse(row.cast<String, Object?>()),
    ]);
  }

  @override
  Future<core.Result<void>> revoke({
    required String id,
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<void>.err(_noSession);
    }
    int? status;
    try {
      final Response<dynamic> res = await _dio.delete<dynamic>(
        '$_base/v1/sessions/${Uri.encodeComponent(id)}',
        options: _options(accessToken!),
      );
      status = res.statusCode;
    } on DioException catch (e) {
      status = e.response?.statusCode;
    } catch (e) {
      return core.Result<void>.err(
        core.Failure('session revoke failed', cause: e),
      );
    }
    // By STATUS: a 404 is a session that is already gone, which is what the
    // person asked for, so it is not a failure to show them.
    final core.SessionRevokeOutcome outcome =
        core.SessionRevokeOutcome.forStatus(status);
    return outcome.signedOut
        ? const core.Result<void>.ok(null)
        : core.Result<void>.err(
            core.Failure('session revoke refused', cause: outcome),
          );
  }
}
