import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.EventTransport] for G-12 first-party analytics ([ADR 011]).
/// `POST {platformBaseUrl}/v1/events` → the shared platform Worker → D1.
///
/// Lives in the app layer, not `core`, for the same reason `DioConfigTransport`
/// does: `core` stays pure Dart so it can be tested without Flutter and reused
/// by every stamped app (ADR 005).
///
/// UNAUTHENTICATED on purpose — the events are pseudonymous and the most
/// valuable ones (`first_launch`, `paywall_viewed`) happen before any login
/// exists. It carries no bearer token and must never be given one, because a
/// token would attach an identity to rows that are deliberately unidentified.
class DioEventTransport implements core.EventTransport {
  DioEventTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    try {
      await _dio.post<dynamic>(
        '$_base/v1/events',
        data: <String, Object?>{
          'app_id': appId,
          ...envelope,
          // anon_id is repeated per event so the server can attribute a batch
          // even if a future client ever mixes installs in one request.
          'events': events
              .map(
                (Map<String, Object?> e) => <String, Object?>{
                  'anon_id': anonId,
                  ...envelope,
                  ...e,
                },
              )
              .toList(growable: false),
        },
        options: Options(
          // A short timeout on purpose: analytics must never be the reason a
          // request queue backs up. A slow send just means retry next flush.
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{'content-type': 'application/json'},
        ),
      );
      return const core.Result<void>.ok(null);
    } catch (e) {
      // Includes 429 (breaker shed it) and 503 (D1 hiccup) — both mean KEEP the
      // batch. The server dedups on event_id, so retrying is always safe.
      return core.Result<void>.err(
        core.Failure('analytics send failed', cause: e),
      );
    }
  }
}
