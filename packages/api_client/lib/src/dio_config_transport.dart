import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.ConfigTransport] for CFG-1. Fetches
/// `GET {configBaseUrl}/config/<app>?channel=<releaseChannel>` and returns the
/// decoded JSON map.
///
/// Any non-2xx (e.g. a 404 `unknown_app`, a 400 `unknown_channel`), network
/// error, or unparseable body becomes an [core.Err]; the [core.ConfigLoader]
/// then falls back to the last-good cache or the compiled-in bundled default,
/// keeping the app offline-safe.
class DioConfigTransport implements core.ConfigTransport {
  DioConfigTransport({
    required String configBaseUrl,
    required String? releaseChannel,
    Dio? httpClient,
  })  : _base = configBaseUrl,
        _channel = releaseChannel,
        _dio = httpClient ?? Dio();

  final String _base;

  /// The `tooling/channel-register.json` id this binary was built for, sent as
  /// `?channel=` so the config service answers the floor and the update exit
  /// of THAT channel (O-UPDATE-FLOOR-HAS-NO-CHANNEL). The service keeps
  /// per-channel maps and answers scalars, so the body [core.AppConfig.fromJson]
  /// parses is the same shape either way.
  ///
  /// 🔴 NULL OR EMPTY SENDS NO PARAMETER, and the service answers its
  /// `default`. REQUIRED, not optional, so a caller has to say which: one that
  /// forgot would silently get `default` for every channel, the behaviour this
  /// parameter exists to end. The service refuses an id it does not register
  /// with a 400, so the CALLER passes only a declared id — an app passes
  /// `ChassisBilling.channelNamed(AppConfig.releaseChannel)?.registerId`, which
  /// is null for the undeclared `'dev'` default.
  final String? _channel;
  final Dio _dio;

  @override
  Future<core.Result<Map<String, Object?>>> fetch(String appId) async {
    final String url = '$_base/config/$appId';
    final String? channel = _channel;
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        url,
        queryParameters: channel == null || channel.isEmpty
            ? null
            : <String, Object?>{'channel': channel},
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
