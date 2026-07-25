import 'dart:async';
import 'dart:convert';

import '../result.dart';
import '../storage/key_value_store.dart';
import 'analytics.dart';
import 'consent.dart';
import 'ids.dart';

/// A session ends after this much inactivity. Matches the locked envelope spec.
const Duration kSessionIdleTimeout = Duration(minutes: 30);

/// Ship once this many events are queued.
const int kFlushBatchSize = 20;

/// Hard cap on the offline queue. Beyond this the OLDEST events are dropped:
/// an unbounded queue on a device that is offline for a week is a storage leak,
/// and recent behaviour is worth more than stale behaviour.
const int kMaxQueuedEvents = 500;

/// The real [Analytics]: consent-gated, offline-queued, batched.
///
/// ## Consent
/// Nothing is collected until [ConsentPurpose.analytics] is `granted`. Before
/// that, [log] discards — it does NOT buffer for later replay, because events
/// collected before consent are events collected without consent no matter when
/// they are sent.
///
/// ## Connectivity
/// There is deliberately **no connectivity check**. `connectivity_plus` reports
/// *interface state*, not reachability: it says "connected" behind a captive
/// portal, on a Wi-Fi network with no upstream, and during DNS failure. Gating a
/// flush on it produces both false positives (send into a black hole and treat
/// it as delivered) and false negatives (sit on a queue that would have sent).
/// Attempting the request IS the connectivity check; failure just means keep the
/// batch. That is one behaviour on all six platforms, with no plugin.
class AnalyticsRecorder implements Analytics {
  AnalyticsRecorder({
    required this.appId,
    required this.anonId,
    required EventTransport transport,
    required ConsentController consent,
    KeyValueStore? queueStore,
    Map<String, Object?> envelope = const <String, Object?>{},
    DateTime Function()? clock,
    String queueKey = 'nikatru.analytics.queue',
    this.batchSize = kFlushBatchSize,
    this.maxQueued = kMaxQueuedEvents,
  })  : _transport = transport,
        _consent = consent,
        _queueStore = queueStore,
        _envelope = envelope,
        _now = clock ?? DateTime.now,
        _queueKey = queueKey;

  final String appId;

  /// The pseudonymous per-install id. MUST be the SAME value the app buckets
  /// feature flags with (the brick's `installIdProvider`) — two independently
  /// minted ids make the rollout bucket and the analytics cohort unjoinable,
  /// which silently renders every experiment unmeasurable. Passed in rather
  /// than generated here precisely so it cannot be minted twice.
  final String anonId;

  final EventTransport _transport;
  final ConsentController _consent;
  final KeyValueStore? _queueStore;
  final Map<String, Object?> _envelope;
  final DateTime Function() _now;
  final String _queueKey;
  final int batchSize;
  final int maxQueued;

  final List<AnalyticsEvent> _queue = <AnalyticsEvent>[];
  String? _sessionId;
  DateTime? _lastActivity;
  bool _flushing = false;

  /// Events waiting to be delivered (test/diagnostic view).
  int get queuedCount => _queue.length;

  /// The current session id, rotating after [kSessionIdleTimeout] of inactivity.
  String get sessionId {
    final DateTime now = _now();
    final DateTime? last = _lastActivity;
    if (_sessionId == null ||
        last == null ||
        now.difference(last) >= kSessionIdleTimeout) {
      _sessionId = uuidV4();
    }
    _lastActivity = now;
    return _sessionId!;
  }

  /// Restore a queue persisted by a previous run. Safe to call once at startup;
  /// a corrupt payload is discarded rather than throwing.
  Future<void> hydrate() async {
    final KeyValueStore? store = _queueStore;
    if (store == null) return;
    try {
      final String? raw = await store.read(_queueKey);
      if (raw == null || raw.isEmpty) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return;
      for (final Object? e in decoded) {
        if (e is Map) {
          final AnalyticsEvent? ev =
              AnalyticsEvent.tryFromJson(e.cast<String, Object?>());
          if (ev != null) _queue.add(ev);
        }
      }
      _trim();
    } catch (_) {
      // Corrupt queue ⇒ start clean. Losing analytics beats crashing an app.
    }
  }

  @override
  Future<void> log(String event, {Map<String, Object?>? params}) async {
    if (_consent.statusOf(ConsentPurpose.analytics) != ConsentStatus.granted) {
      return; // discard, never buffer-for-later
    }
    _queue.add(AnalyticsEvent(
      event: event,
      ts: _now(),
      sessionId: sessionId,
      params: params,
      consentId: _consent.artifactOf(ConsentPurpose.analytics)?.consentId,
    ));
    _trim();
    await _persist();
    if (_queue.length >= batchSize) {
      await flush();
    }
  }

  @override
  Future<void> flush() async {
    if (_flushing || _queue.isEmpty) return;
    if (_consent.statusOf(ConsentPurpose.analytics) != ConsentStatus.granted) {
      return;
    }
    _flushing = true;
    try {
      // Snapshot: events logged during the in-flight request stay queued for
      // the next flush rather than being dropped by a wholesale clear.
      final List<AnalyticsEvent> batch =
          _queue.take(batchSize).toList(growable: false);
      final Result<void> r = await _transport.send(
        appId: appId,
        anonId: anonId,
        envelope: _envelope,
        events:
            batch.map((AnalyticsEvent e) => e.toJson()).toList(growable: false),
      );
      if (r.isOk) {
        _queue.removeRange(0, batch.length);
        await _persist();
      }
      // On Err: keep everything. The next log() or flush() retries, and the
      // server dedups on event_id, so a retry after a lost response is safe.
    } catch (_) {
      // Analytics must never surface an error into a user-facing flow.
    } finally {
      _flushing = false;
    }
  }

  /// Drop the OLDEST events beyond the cap.
  void _trim() {
    final int over = _queue.length - maxQueued;
    if (over > 0) _queue.removeRange(0, over);
  }

  Future<void> _persist() async {
    final KeyValueStore? store = _queueStore;
    if (store == null) return;
    try {
      await store.write(
        _queueKey,
        jsonEncode(_queue
            .map((AnalyticsEvent e) => e.toJson())
            .toList(growable: false)),
      );
    } catch (_) {
      // Best-effort durability; the in-memory queue is still authoritative.
    }
  }
}
