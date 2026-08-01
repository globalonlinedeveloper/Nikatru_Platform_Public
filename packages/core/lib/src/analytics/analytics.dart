import '../result.dart';
import 'ids.dart';

/// One analytics event, client-side. The envelope fields that are identical for
/// every event in a batch (`app_id`, `anon_id`, `platform`, `app_version`) are
/// carried by the batch, not repeated per row.
///
/// Envelope + taxonomy are LOCKED — `company/requirements/analytics-events.md`.
class AnalyticsEvent {
  AnalyticsEvent({
    required this.event,
    required this.ts,
    required this.sessionId,
    Map<String, Object?>? params,
    String? eventId,
    this.consentId,
  })  : eventId = eventId ?? uuidV4(),
        params = sanitizeParams(params);

  /// UUIDv4 — THE exactly-once key. Queued batches retry, so delivery is
  /// inherently at-least-once and the sink dedups on this.
  final String eventId;
  final String event;

  /// Client clock. UNTRUSTED by the server, which stamps its own receipt time —
  /// this is skewed, offline-queued and user-settable.
  final DateTime ts;
  final String sessionId;
  final Map<String, Object?> params;

  /// The consent artifact in force when this event was collected.
  final String? consentId;

  Map<String, Object?> toJson() => <String, Object?>{
        'event_id': eventId,
        'event': event,
        'ts': ts.toUtc().toIso8601String(),
        'session_id': sessionId,
        if (params.isNotEmpty) 'params': params,
        if (consentId != null) 'consent_id': consentId,
      };

  static AnalyticsEvent? tryFromJson(Map<String, Object?> j) {
    final Object? id = j['event_id'];
    final Object? name = j['event'];
    final Object? ts = j['ts'];
    final Object? session = j['session_id'];
    if (id is! String || name is! String || ts is! String) return null;
    final DateTime? parsed = DateTime.tryParse(ts);
    if (parsed == null) return null;
    return AnalyticsEvent(
      eventId: id,
      event: name,
      ts: parsed,
      sessionId: session is String ? session : '',
      params: j['params'] is Map
          ? (j['params']! as Map).cast<String, Object?>()
          : null,
      consentId: j['consent_id'] is String ? j['consent_id'] as String : null,
    );
  }
}

/// Longest string a param VALUE may be. Not an arbitrary limit: `params` are
/// specified as ENUMERABLE VALUES ONLY — no free text, no user content. A value
/// set you cannot write down is not a param, it belongs in a bug report. The cap
/// makes the rule mechanically enforced instead of merely documented, and free
/// text in D1 is a posture that cannot be retracted once it is in every backup.
const int kMaxParamValueLength = 64;

/// Most params one event may carry.
const int kMaxParamCount = 12;

/// Keep only enumerable scalars, bounded in size and count. Anything else —
/// nested maps, lists, long strings — is DROPPED rather than truncated, because
/// a truncated free-text value is still free text.
Map<String, Object?> sanitizeParams(Map<String, Object?>? raw) {
  if (raw == null || raw.isEmpty) return const <String, Object?>{};
  final Map<String, Object?> out = <String, Object?>{};
  for (final MapEntry<String, Object?> e in raw.entries) {
    if (out.length >= kMaxParamCount) break;
    final Object? v = e.value;
    if (v is bool || v is num) {
      out[e.key] = v;
    } else if (v is String && v.length <= kMaxParamValueLength) {
      out[e.key] = v;
    }
  }
  return out;
}

/// The analytics facade. App and brick code programs against THIS ONLY — the
/// sink (our first-party Worker today) stays swappable, which is the whole point
/// of [ADR 011] choosing first-party without locking us to it.
abstract interface class Analytics {
  /// Record [event]. Never throws and never blocks the caller on I/O: analytics
  /// must not be able to break a user-facing flow.
  Future<void> log(String event, {Map<String, Object?>? params});

  /// Best-effort delivery of anything queued.
  Future<void> flush();

  /// Drop everything collected but NOT yet delivered, and do not deliver it.
  ///
  /// This is the withdrawal half of consent, and it is on the facade rather than
  /// on one implementation because it is not optional: DPDP §6(3) withdrawal has
  /// to stop the transmission of what was already collected, not merely stop
  /// collecting more. An implementation that buffers anything therefore owes the
  /// user a way to drop that buffer; one that buffers nothing implements this as
  /// the no-op it already is.
  Future<void> purge();
}

/// The default. Discards everything.
///
/// This is what runs before consent is granted, in tests, and on any build with
/// no sink configured — collection is OPT-IN, so the no-op must be the fallback
/// that costs nothing to leave in place.
class NoOpAnalytics implements Analytics {
  const NoOpAnalytics();

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async {}

  @override
  Future<void> flush() async {}

  /// Nothing was ever kept, so there is nothing to drop.
  @override
  Future<void> purge() async {}
}

/// Seam for shipping a batch. The implementation lives in the app layer (dio on
/// the existing `RestClient`) so `core` stays pure Dart — the same shape as
/// `ConfigTransport` (ADR 005).
abstract interface class EventTransport {
  /// POST a batch. [Ok] means the server accepted it and the client may drop
  /// those events; [Err] means keep them queued and retry.
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  });
}
