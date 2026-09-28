import 'package:dio/dio.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

/// dio-backed [core.ReminderChannelsTransport] — the client for the platform
/// Worker's reminder routes (ST-R1, ST-R2):
///
/// - `GET|PUT {platformBaseUrl}/v1/reminders/prefs` — the email preference
///   (`services/platform/src/routes/reminders.ts`);
/// - `POST|DELETE {platformBaseUrl}/v1/calendar/feed` — mint (or rotate) and
///   revoke the private calendar feed (`routes/calendar.ts`).
///
/// AUTHENTICATED, like [DioEntitlementTransport]: every route is about a
/// PERSON, and the host scopes each row by `(user_id, app_id)`.
///
/// ⚠️ CALLED FROM A SETTINGS SCREEN, NEVER FROM A `build`. The portfolio
/// shares one free Worker-requests/day ceiling; these are one request per
/// deliberate tap.
class DioReminderChannelsTransport implements core.ReminderChannelsTransport {
  DioReminderChannelsTransport({
    required String platformBaseUrl,
    Dio? httpClient,
  }) : _base = platformBaseUrl,
       _dio = httpClient ?? Dio();

  final String _base;
  final Dio _dio;

  static const core.Failure _noSession = core.Failure(
    'no session: reminder channels cannot be reached',
  );

  Options _options(String accessToken) => Options(
    sendTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
    validateStatus: (int? s) => s != null && s >= 200 && s < 300,
    headers: <String, Object?>{'authorization': 'Bearer $accessToken'},
  );

  // 🔴 A signed-out call is REFUSED HERE, NOT AT THE SERVER: it is a known
  // state, and sending it would spend a request from a shared daily ceiling
  // to be told something this process already knows.
  static bool _signedOut(String? t) => t == null || t.isEmpty;

  @override
  Future<core.Result<core.ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.ReminderPrefs>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _dio.get<dynamic>(
        '$_base/v1/reminders/prefs',
        queryParameters: <String, Object?>{'app_id': appId},
        options: _options(accessToken!),
      );
      return _prefs(res.data);
    } catch (e) {
      return core.Result<core.ReminderPrefs>.err(
        core.Failure('reminder prefs read failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<core.ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.ReminderPrefs>.err(_noSession);
    }
    // The host answers 400 to a lead outside its range; refusing it here
    // saves the request and names the fault on this side.
    if (leadDays != null && !core.ReminderPrefs.isValidLead(leadDays)) {
      return core.Result<core.ReminderPrefs>.err(
        core.Failure('lead_days out of range: $leadDays'),
      );
    }
    try {
      final Response<dynamic> res = await _dio.put<dynamic>(
        '$_base/v1/reminders/prefs',
        // An ABSENT lead_days keeps the stored lead (reminders.ts), so a
        // switch-only write never resets a lead the person chose.
        data: <String, Object?>{
          'app_id': appId,
          'email_opt_in': emailOptIn,
          'lead_days': ?leadDays,
        },
        options: _options(accessToken!),
      );
      return _prefs(res.data);
    } catch (e) {
      return core.Result<core.ReminderPrefs>.err(
        core.Failure('reminder prefs write failed', cause: e),
      );
    }
  }

  static core.Result<core.ReminderPrefs> _prefs(Object? body) {
    // A 2xx that is not an object, or is one we cannot read, is not an
    // answer — and must not become `ReminderPrefs.defaults`, which is a
    // definite "not opted in".
    final core.ReminderPrefs? p = body is Map
        ? core.ReminderPrefs.tryParse(body.cast<String, Object?>())
        : null;
    if (p == null) {
      return const core.Result<core.ReminderPrefs>.err(
        core.Failure('reminder prefs response was not a preference'),
      );
    }
    return core.Result<core.ReminderPrefs>.ok(p);
  }

  @override
  Future<core.Result<core.CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<core.CalendarFeed>.err(_noSession);
    }
    try {
      final Response<dynamic> res = await _dio.post<dynamic>(
        '$_base/v1/calendar/feed',
        data: <String, Object?>{'app_id': appId},
        options: _options(accessToken!),
      );
      final Object? body = res.data;
      // CalendarFeed.tryParse refuses any scheme but https / webcal: the
      // caller opens these URLs, and an `http:` one would leak the token.
      final core.CalendarFeed? feed = body is Map
          ? core.CalendarFeed.tryParse(body.cast<String, Object?>())
          : null;
      if (feed == null) {
        return const core.Result<core.CalendarFeed>.err(
          core.Failure('calendar feed response was not an https/webcal feed'),
        );
      }
      return core.Result<core.CalendarFeed>.ok(feed);
    } catch (e) {
      return core.Result<core.CalendarFeed>.err(
        core.Failure('calendar feed mint failed', cause: e),
      );
    }
  }

  @override
  Future<core.Result<void>> revokeCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async {
    if (_signedOut(accessToken)) {
      return const core.Result<void>.err(_noSession);
    }
    try {
      await _dio.delete<dynamic>(
        '$_base/v1/calendar/feed',
        queryParameters: <String, Object?>{'app_id': appId},
        options: _options(accessToken!),
      );
      return const core.Result<void>.ok(null);
    } on DioException catch (e) {
      // 404 `no_feed` means there is no live feed — already revoked, or
      // never minted. That is the state a revoke asks for, so it is ok. Any
      // OTHER 404 (`unknown_app`) is a real fault and stays a failure.
      final Response<dynamic>? r = e.response;
      final Object? body = r?.data;
      if (r?.statusCode == 404 && body is Map && body['error'] == 'no_feed') {
        return const core.Result<void>.ok(null);
      }
      return core.Result<void>.err(
        core.Failure('calendar feed revoke failed', cause: e),
      );
    } catch (e) {
      return core.Result<void>.err(
        core.Failure('calendar feed revoke failed', cause: e),
      );
    }
  }
}
