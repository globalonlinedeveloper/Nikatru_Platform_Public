import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.PrivacyDataTransport] — the client for the platform
/// Worker's DPDP routes (lane dpdp-rights, Do 3 and Do 4;
/// `services/platform/src/routes/account-export.ts, account-nominee.ts`):
///
/// - `GET {platformBaseUrl}/v1/account/export` — everything held server-side
///   about the signed-in account, one JSON file;
/// - `GET|PUT|DELETE {platformBaseUrl}/v1/account/nominee` — the one nominee.
///
/// AUTHENTICATED, like [DioReminderChannelsTransport]: a signed-out call is
/// refused here, before it spends a request. Called from the "Your privacy
/// rights" screen on a deliberate tap, never from a `build`.
class DioPrivacyDataTransport implements core.PrivacyDataTransport {
  DioPrivacyDataTransport({required String platformBaseUrl, Dio? httpClient})
    : _base = platformBaseUrl,
      _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  static const core.Failure _noSession = core.Failure(
    'no session: privacy data cannot be reached',
  );

  static bool _signedOut(String? t) => t == null || t.isEmpty;

  Options _options(String accessToken, {ResponseType? type}) => Options(
    sendTimeout: const Duration(seconds: 15),
    receiveTimeout: const Duration(seconds: 30),
    responseType: type,
    validateStatus: (int? s) => s != null && s >= 200 && s < 300,
    headers: <String, Object?>{'authorization': 'Bearer $accessToken'},
  );

  @override
  Future<core.Result<String>> exportData({
    required String? accessToken,
    String? anonId,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<String>.err(_noSession);
    }
    try {
      final Response<String> res = await _dio.get<String>(
        '$_base/v1/account/export',
        queryParameters: <String, Object?>{'anon_id': ?anonId},
        options: _options(accessToken!, type: ResponseType.plain),
      );
      final String body = res.data ?? '';
      // 🔴 A body that is not the export is refused, never saved: a file that
      // reads like "everything we hold" must be the server's answer.
      final Object? j = jsonDecode(body);
      if (j is! Map || j['schema'] != 'nikatru.data-export/1') {
        return const core.Result<String>.err(
          core.Failure('privacy export: the answer is not an export'),
        );
      }
      return core.Result<String>.ok(body);
    } catch (e) {
      return core.Result<String>.err(
        core.Failure('privacy export failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<core.PrivacyNominee?>> readNominee({
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.PrivacyNominee?>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        '$_base/v1/account/nominee',
        options: _options(accessToken!),
      );
      final Object? data = res.data;
      if (data is! Map || !data.containsKey('nominee')) {
        return const core.Result<core.PrivacyNominee?>.err(
          core.Failure('nominee read: the answer is not one'),
        );
      }
      return core.Result<core.PrivacyNominee?>.ok(
        core.PrivacyNominee.tryParse(data['nominee']),
      );
    } catch (e) {
      return core.Result<core.PrivacyNominee?>.err(
        core.Failure('nominee read failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<core.PrivacyNominee>> writeNominee({
    required String? accessToken,
    required core.PrivacyNominee nominee,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.PrivacyNominee>.err(_noSession);
    }
    if (!core.PrivacyNominee.isValid(nominee.name, nominee.email)) {
      return const core.Result<core.PrivacyNominee>.err(
        core.Failure('nominee: a name and a valid e-mail address are needed'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.put<dynamic>(
        '$_base/v1/account/nominee',
        data: nominee.toJson(),
        options: _options(accessToken!),
      );
      final Object? data = res.data;
      final core.PrivacyNominee? saved = data is Map
          ? core.PrivacyNominee.tryParse(data['nominee'])
          : null;
      return saved == null
          ? const core.Result<core.PrivacyNominee>.err(
              core.Failure('nominee write: the answer is not one'),
            )
          : core.Result<core.PrivacyNominee>.ok(saved);
    } catch (e) {
      return core.Result<core.PrivacyNominee>.err(
        core.Failure('nominee write failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<void>> removeNominee({
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<void>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _dio.delete<dynamic>(
        '$_base/v1/account/nominee',
        options: _options(
          accessToken!,
        ).copyWith(validateStatus: (int? s) => s != null),
      );
      return core.PrivacyNominee.removedForStatus(res.statusCode ?? 0)
          ? const core.Result<void>.ok(null)
          : core.Result<void>.err(
              core.Failure('nominee remove refused: ${res.statusCode}'),
            );
    } catch (e) {
      return core.Result<void>.err(
        core.Failure('nominee remove failed', cause: e),
      );
    }
  }
}
