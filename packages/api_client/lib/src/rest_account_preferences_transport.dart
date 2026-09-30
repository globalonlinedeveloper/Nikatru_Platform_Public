import 'package:nikatru_core/nikatru_core.dart' as core;

import 'rest_client.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11). The account's preferences document over an
/// app's own authenticated [RestClient]: `GET /preferences` answers
/// `{preferences: {…} | null}`, `PUT /preferences` replaces it whole.
///
/// Every failure is a [core.Result.err] — a 404 from a Worker that predates
/// the route, a timeout, a malformed body — because the caller
/// (`core.AccountPreferencesSync`) keeps the device's own copy on any of them,
/// and a throw would reach a listener nobody awaits.
class RestAccountPreferencesTransport
    implements core.AccountPreferencesTransport {
  RestAccountPreferencesTransport(this._rest);

  final RestClient _rest;

  @override
  Future<core.Result<Map<String, Object?>?>> read() async {
    try {
      final Object? body = await _rest.get('/preferences');
      final Map<String, Object?>? doc = _rest.decode(body, (Object? b) {
        final Object? p = (b! as Map<String, Object?>)['preferences'];
        return p == null ? null : Map<String, Object?>.from(p as Map);
      });
      return core.Result<Map<String, Object?>?>.ok(doc);
    } catch (e) {
      return core.Result<Map<String, Object?>?>.err(
        core.Failure('preferences not read', cause: e),
      );
    }
  }

  @override
  Future<core.Result<void>> write(Map<String, Object?> preferences) async {
    try {
      final Map<String, Object?> body = <String, Object?>{
        'preferences': preferences,
      };
      await _rest.put('/preferences', body: body);
      return const core.Result<void>.ok(null);
    } catch (e) {
      return core.Result<void>.err(
        core.Failure('preferences not written', cause: e),
      );
    }
  }
}
