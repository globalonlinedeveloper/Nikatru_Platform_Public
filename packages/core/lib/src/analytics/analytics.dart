import '../result.dart';
import 'ids.dart';

/// One analytics event, client-side. The envelope fields that are identical for
/// every event in a batch (`app_id`, `anon_id`, `platform`, `app_version`) are
/// carried by the batch, not repeated per row.
///
/// Envelope + taxonomy LOCKED — `Private/requirements/` [REQ]analytics-events.
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

/// The platform Worker's stable error code for a row whose `app_version` is
/// not an official release stamp. PRODUCTION ONLY, answered with 422
/// (services/platform/src/lib/build-stamp.ts).
const String kUnreleasedBuildError = 'unreleased_build';

/// The server refused this BUILD, not this batch. A build's `app_version` is
/// compiled in, so every later send from this process would be refused the
/// same way: [AnalyticsRecorder] stops sending on it instead of retrying. Only
/// a copy built without the release lane's APP_VERSION define (`dev`) sees it.
class UnreleasedBuildFailure extends Failure {
  const UnreleasedBuildFailure({Object? cause})
      : super('the server accepts no rows from this build', cause: cause);
}

/// The platform Worker's stable error code, answered with 409, for a batch from
/// an install whose analytics consent artifact the SERVER has no record of
/// (services/platform/src/routes/events.ts, `consentVerdicts`).
const String kConsentNotRecordedError = 'consent_not_recorded';

/// The platform Worker's stable error code, answered with 403, for a batch from
/// an install whose LATEST analytics artifact on the server is a withdrawal.
const String kConsentWithdrawnError = 'consent_withdrawn';

/// The server has no analytics artifact for this install. RETRYABLE, and the
/// remedy is the client's: [AnalyticsRecorder] keeps the queue, posts the
/// artifact in force, and sends the batch again once that post is acknowledged.
class ConsentNotRecordedFailure extends Failure {
  const ConsentNotRecordedFailure({Object? cause})
      : super('the server holds no consent artifact for this install',
            cause: cause);
}

/// The server kept answering [ConsentNotRecordedFailure] after
/// [kMaxConsentRepairs] consent repairs that LANDED. Not retried under the
/// artifact [consentId] names: [AnalyticsRecorder] keeps its queue, sends
/// nothing more until a new decision replaces that artifact, and reports this
/// through [AnalyticsRecorder.consentRepairFailure].
class ConsentRepairExhaustedFailure extends Failure {
  ConsentRepairExhaustedFailure({
    required this.consentId,
    required this.attempts,
  }) : super('the server still holds no consent artifact for this install '
            'after $attempts repairs that landed; delivery is stopped and the '
            'queued events are kept');

  final String consentId;
  final int attempts;
}

/// The server's latest artifact for this install is a WITHDRAWAL. Not
/// retryable: nothing collected under the grant this client still holds may
/// land, so [AnalyticsRecorder] drops its queue rather than re-sending it.
class ConsentWithdrawnFailure extends Failure {
  const ConsentWithdrawnFailure({Object? cause})
      : super('the server records analytics consent as withdrawn',
            cause: cause);
}

/// Seam for shipping a batch. The implementation lives in the app layer (dio on
/// the existing `RestClient`) so `core` stays pure Dart — the same shape as
/// `ConfigTransport` (ADR 005).
abstract interface class EventTransport {
  /// POST a batch. [Ok] means the server accepted it and the client may drop
  /// those events; [Err] means keep them queued and retry — EXCEPT an [Err]
  /// carrying [UnreleasedBuildFailure], which means stop sending for good,
  /// [ConsentNotRecordedFailure], which means post consent before retrying, and
  /// [ConsentWithdrawnFailure], which means drop the queue.
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  });
}
