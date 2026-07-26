import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.ConfigTransport] for CFG-1. Fetches
/// `GET {configBaseUrl}/config/<app>` and returns the decoded JSON map.
///
/// Any non-2xx (e.g. a 404 `unknown_app`), network error, or unparseable body
/// becomes an [core.Err]; the [core.ConfigLoader] then falls back to the
/// last-good cache or the compiled-in bundled default, keeping the app
/// offline-safe.
class DioConfigTransport implements core.ConfigTransport {
  DioConfigTransport({required String configBaseUrl, Dio? httpClient})
      : _base = configBaseUrl,
        _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<Map<String, Object?>>> fetch(String appId) async {
    final String url = '$_base/config/$appId';
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        url,
        options: Options(
          responseType: ResponseType.json,
          // Non-2xx (incl. 404 unknown_app) resolves as an error result below.
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{'accept': 'application/json'},
        ),
      );
      final Map<String, Object?>? map = _asJsonMap(res.data);
      if (map == null) {
        return core.Result<Map<String, Object?>>.err(
            const core.Failure('config: unexpected response body'));
      }
      return core.Result<Map<String, Object?>>.ok(map);
    } on DioException catch (e) {
      return core.Result<Map<String, Object?>>.err(
          core.Failure('config fetch failed for "$appId"', cause: e));
    } catch (e) {
      return core.Result<Map<String, Object?>>.err(
          core.Failure('config parse failed for "$appId"', cause: e));
    }
  }

  Map<String, Object?>? _asJsonMap(Object? data) {
    if (data is Map) {
      return data.map(
          (Object? k, Object? v) => MapEntry<String, Object?>('$k', v));
    }
    if (data is String && data.isNotEmpty) {
      final Object? decoded = jsonDecode(data);
      if (decoded is Map) {
        return decoded.map(
            (Object? k, Object? v) => MapEntry<String, Object?>('$k', v));
      }
    }
    return null;
  }
}
