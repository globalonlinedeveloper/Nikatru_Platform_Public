import 'package:nikatru_core/nikatru_core.dart' as core;

import 'rest_client.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11). The account's preferences, per key and
/// versioned, over an app's own authenticated [RestClient]:
///
///   GET   /preferences → `{preferences: {<key>: {value, version, …}}}`
///   PATCH /preferences   `{changes: {<key>: {value, base_version}}}`
///                      → `{preferences: {…the keys sent…}, conflicts: […]}`
///
/// Every failure is a [core.AccountPreferencesFailure] CARRYING THE STATUS
/// (review #1080 finding 6): the sync treats a 400/413 as final, a 401 as the
/// session's, a 404 (a Worker older than the route) as "later", and no answer
/// (status 0) as offline — and it can only do that if the status survives.
class RestAccountPreferencesTransport
    implements core.AccountPreferencesTransport {
  RestAccountPreferencesTransport(this._rest);

  final RestClient _rest;

  @override
  Future<Map<String, core.PreferenceValue>> read() async {
    try {
      final Object? body = await _rest.get('/preferences');
      return _rest.decode<Map<String, core.PreferenceValue>>(
        body,
        (Object? b) => _document((b! as Map<String, Object?>)['preferences']),
      );
    } catch (e) {
      throw _failure(e);
    }
  }

  @override
  Future<core.PreferencesPatchResult> patch(
    Map<String, core.PreferenceChange> changes,
  ) async {
    final Map<String, Object?> body = <String, Object?>{
      'changes': <String, Object?>{
        for (final MapEntry<String, core.PreferenceChange> e in changes.entries)
          e.key: <String, Object?>{
            'value': e.value.value,
            'base_version': e.value.baseVersion,
          },
      },
    };
    try {
      final Object? answer = await _rest.patch('/preferences', body: body);
      return _rest.decode<core.PreferencesPatchResult>(answer, (Object? b) {
        final Map<String, Object?> m = b! as Map<String, Object?>;
        final Object? conflicts = m['conflicts'];
        return core.PreferencesPatchResult(
          current: _document(m['preferences']),
          conflicts: <String>{
            if (conflicts is List)
              for (final Object? k in conflicts)
                if (k is String) k,
          },
        );
      });
    } catch (e) {
      throw _failure(e);
    }
  }

  static Map<String, core.PreferenceValue> _document(Object? doc) {
    final Map<String, core.PreferenceValue> out =
        <String, core.PreferenceValue>{};
    if (doc is! Map) return out;
    doc.forEach((Object? key, Object? row) {
      if (key is String && row is Map && row['version'] is int) {
        out[key] = core.PreferenceValue(row['value'], row['version'] as int);
      }
    });
    return out;
  }

  /// A malformed answer DID come back, so it is not "offline" (status 0,
  /// which costs no attempt and would retry forever): it is a server fault.
  static core.AccountPreferencesFailure _failure(Object e) {
    if (e is core.AccountPreferencesFailure) return e;
    if (e is! ApiException) return core.AccountPreferencesFailure(0, '$e');
    final bool malformed =
        e.statusCode == 0 && e.message.startsWith('Malformed response');
    return core.AccountPreferencesFailure(
      malformed ? 502 : e.statusCode,
      e.message,
    );
  }
}
