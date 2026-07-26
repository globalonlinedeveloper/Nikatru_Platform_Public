import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.ConsentTransport]. `POST {platformBaseUrl}/v1/consent` → the
/// shared platform Worker → the append-only `consent_artifacts` table.
///
/// Lives in the app layer for the same reason [DioEventTransport] does: `core`
/// stays pure Dart so it can be tested without Flutter (ADR 005).
///
/// UNAUTHENTICATED on purpose, exactly like the events route: consent is given
/// before any account exists in most apps, and attaching a bearer token would
/// bind an identity to a record whose whole point is that it does not carry one.
class DioConsentTransport implements core.ConsentTransport {
  DioConsentTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async {
    try {
      await _dio.post<dynamic>(
        '$_base/v1/consent',
        // The route requires app_id, which the artifact does not carry — the
        // artifact is per-install, the row is per-install-per-app.
        data: <String, Object?>{'app_id': appId, ...artifact.toJson()},
        options: Options(
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{'content-type': 'application/json'},
        ),
      );
      return const core.Result<void>.ok(null);
    } catch (e) {
      // Deliberately swallowed by the caller. The user's decision already took
      // effect on-device; a failed upload must never make the choice feel
      // rejected. The server dedups on consent_id, so a later retry is safe.
      return core.Result<void>.err(
        core.Failure('consent send failed', cause: e),
      );
    }
  }
}
