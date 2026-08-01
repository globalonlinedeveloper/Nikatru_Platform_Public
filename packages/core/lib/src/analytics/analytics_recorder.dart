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
/// they are sent. Withdrawal is the mirror image and is [purge]'s job: the
/// symmetry only holds if what is already queued dies with the grant.
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

  /// Bumped by [purge]. A flush that was already awaiting its request when the
  /// user withdrew must not write the queue back to a key the withdrawal just
  /// deleted — see [flush].
  int _epoch = 0;

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

    // 🔴 A QUEUE MAY ONLY BE RESTORED UNDER A LIVE GRANT.
    //
    // [purge] empties the outbox on withdrawal, but the recorder is normally
    // REBUILT immediately afterwards — the app invalidates the consent provider
    // so the new decision becomes visible — and a rebuild that re-read the file
    // unconditionally would resurrect exactly the events the user just withdrew
    // consent for. That is the same in-memory-only mistake in a different
    // costume, and it survives a restart.
    //
    // The two non-granted states are NOT the same and must not be collapsed:
    //   denied  — the user answered no. There is no lawful basis to keep the
    //             payload, so the persisted copy is deleted here too.
    //   unknown — we could not tell (never asked, or an unreadable consent
    //             store). Nothing is loaded, because unknown never permits
    //             collection, but nothing is DELETED either: destroying a
    //             legitimate queue because a read failed is not fail-closed,
    //             it is data loss.
    final ConsentStatus status = _consent.statusOf(ConsentPurpose.analytics);
    if (status == ConsentStatus.denied) {
      await _clearStore();
      return;
    }
    if (status != ConsentStatus.granted) return;

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
    final int epoch = _epoch;
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
        // A withdrawal landed while this request was on the wire. The queue is
        // already gone and so is the stored key; re-persisting here would put
        // the outbox file back moments after the user asked for it to go.
        if (epoch != _epoch) return;
        _removeSent(batch);
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

  /// Drop every queued event, in memory AND on disk, and deliver none of them.
  ///
  /// 🔴 THIS IS THE WITHDRAWAL PATH, and it is not the same thing as refusing new
  /// events. [log] shuts the moment consent stops being `granted`, which stops
  /// COLLECTION — but at that instant the outbox still holds everything gathered
  /// under the old grant, in memory and persisted, and every one of those events
  /// would still have been transmitted by the next [flush] or restored by the
  /// next [hydrate]. A withdrawal that leaves the payload sitting there means the
  /// user's data is sent AFTER they said stop, which is precisely what DPDP
  /// §6(3) forbids; "we stopped enqueueing" is not withdrawal.
  ///
  /// Deliberately NOT gated on the current consent status: the caller purges
  /// because a decision was just recorded, and re-deriving that decision here
  /// would make the drop depend on whichever object happened to observe the
  /// write first.
  @override
  Future<void> purge() async {
    _epoch++;
    _queue.clear();
    await _clearStore();
  }

  /// Drop exactly the events that were DELIVERED, wherever they now sit.
  ///
  /// This was `_queue.removeRange(0, batch.length)` — "drop the first N", which
  /// assumes the head of the queue is still the batch that was sent. It is not,
  /// because the queue moves DURING the in-flight request: [log] may run while
  /// `_transport.send` is awaited (nothing blocks it; only re-entrant `flush` is
  /// guarded), and each `log` calls [_trim], which drops from the HEAD once the
  /// queue is over [maxQueued]. After one trim the first N are no longer the sent
  /// N, so `removeRange` deleted events that were never delivered — silently, on
  /// exactly the devices that queue the most: a long offline stretch followed by
  /// a reconnect, which is when the queue is full and busiest. It could also
  /// throw a RangeError once the queue was shorter than the batch.
  ///
  /// Identity, not equality: two events can carry equal field values, and only
  /// the instances actually handed to the transport were delivered.
  void _removeSent(List<AnalyticsEvent> batch) {
    final Set<AnalyticsEvent> sent = Set<AnalyticsEvent>.identity()
      ..addAll(batch);
    _queue.removeWhere(sent.contains);
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

  /// Remove the persisted outbox entirely, rather than overwriting it with an
  /// empty list — a withdrawal should leave no trace of a queue, not an emptied
  /// one.
  Future<void> _clearStore() async {
    final KeyValueStore? store = _queueStore;
    if (store == null) return;
    try {
      await store.remove(_queueKey);
    } catch (_) {
      // Best-effort. The in-memory queue is gone regardless, so nothing can be
      // transmitted from this session; and [hydrate] refuses to restore under a
      // denied decision, so the leftover cannot come back either.
    }
  }
}
