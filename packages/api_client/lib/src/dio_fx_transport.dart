import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.FxTransport]: `GET {platformBaseUrl}/v1/fx/latest`, the
/// ECB euro reference rates the platform Worker keeps nightly (ST-I3).
///
/// PUBLIC, so no bearer and no app id are sent: the table is the same for
/// everybody. A non-2xx (the route's 503 `fx_unavailable` before the first
/// nightly run, a 429 from its edge ceiling), a network error or a body that
/// is not a JSON object is an [core.Err]; [core.FxRatesLoader] then serves the
/// last good table it kept.
class DioFxTransport implements core.FxTransport {
  DioFxTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  @override
  Future<core.Result<Map<String, Object?>>> fetchLatest() async {
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        '$_base/v1/fx/latest',
        options: Options(
          responseType: ResponseType.json,
          validateStatus: (int? s) => s != null && s >= 200 && s < 300,
          headers: <String, Object?>{'accept': 'application/json'},
        ),
      );
      Object? data = res.data;
      if (data is String && data.isNotEmpty) data = jsonDecode(data);
      if (data is! Map) {
        return const core.Result<Map<String, Object?>>.err(
          core.Failure('fx: unexpected response body'),
        );
      }
      return core.Result<Map<String, Object?>>.ok(<String, Object?>{
        for (final MapEntry<Object?, Object?> e in data.entries)
          '${e.key}': e.value,
      });
    } on DioException catch (e) {
      return core.Result<Map<String, Object?>>.err(
        core.Failure('fx fetch failed', cause: e),
      );
    } catch (e) {
      return core.Result<Map<String, Object?>>.err(
        core.Failure('fx parse failed', cause: e),
      );
    }
  }
}
