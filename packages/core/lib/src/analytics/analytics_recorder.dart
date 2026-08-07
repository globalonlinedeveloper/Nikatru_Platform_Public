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

/// 🔴 THE DEADLINE A PARTIAL BATCH SHIPS ON ANYWAY — [pipeline 11]E-4a.
///
/// Without this the ONLY delivery paths were "20 events queued" and an explicit
/// [flush]. A launch emits THREE events (`first_launch`, `app_open`,
/// `return_visit`) and an ordinary session adds a handful more — nothing reaches
/// 20 — so the queue was persisted on every [log] and POSTed never. Measured on
/// subly.nikatru.com: three real browsers granted analytics consent and ZERO
/// events were ever delivered. `apps/subly`'s app root carries no lifecycle
/// observer at all, so it had no second path even in principle; the brick's does,
/// and a page unload still beats a fire-and-forget POST launched from it.
///
/// A rail that collects, persists and never transmits is not "partly
/// instrumented" — it is a privacy cost with no analytical benefit, the same
/// trade `assert-analytics-contract.mjs` fails the build over when the client
/// sends a key no column stores.
///
/// WHY TEN SECONDS — not zero, not a minute:
///   · **0 (ship every event)** throws batching away. The launch trio is emitted
///     inside one frame, so it would become three POSTs on every cold start of
///     every app in the portfolio. A 10 s window coalesces them into one.
///   · **The cost of the delay is bounded by the session-length distribution.**
///     A session shorter than the window is one the unload race would have lost
///     regardless — a timer cannot beat a tab close it never got to observe.
///     That case belongs to the lifecycle [flush], and both exist.
///   · **60 s+** would strand a whole short session on desktop, where
///     `paused`/`detached` are never entered at all (dart:ui: paused "is only
///     entered on iOS and Android") and closing the window ends the process.
///
/// ONE-SHOT, NEVER PERIODIC, and never restarted by a later event: the deadline
/// belongs to the OLDEST queued event. A debounce that restarted on every [log]
/// would let a steady trickle push delivery back forever — which is the defect
/// above with extra steps.
const Duration kFlushInterval = Duration(seconds: 10);

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
    this.flushInterval = kFlushInterval,
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

  /// How long a partial batch may wait. Injected so a test can shrink the window
  /// instead of sleeping for the real one — the same reason [clock] is injected
  /// for the session timeout. `Duration.zero` (or negative) disables the timer
  /// entirely, which is how a caller that wants the pre-E-4a batch-only
  /// behaviour asks for it explicitly rather than by omission.
  final Duration flushInterval;

  final List<AnalyticsEvent> _queue = <AnalyticsEvent>[];
  String? _sessionId;
  DateTime? _lastActivity;
  bool _flushing = false;

  /// The armed deadline, if any. One-shot; see [kFlushInterval].
  Timer? _flushTimer;

  /// Set by [dispose]. Latched rather than checked-and-forgotten so a callback
  /// already queued on the event loop cannot re-arm a disposed recorder.
  bool _disposed = false;

  /// Bumped by [purge]. A flush that was already awaiting its request when the
  /// user withdrew must not write the queue back to a key the withdrawal just
  /// deleted — see [flush].
  int _epoch = 0;

  /// Events waiting to be delivered (test/diagnostic view).
  int get queuedCount => _queue.length;

  /// Whether a time-based flush is currently armed (test/diagnostic view).
  ///
  /// Exposed because "the timer was cancelled" is otherwise only observable by
  /// waiting for the window to pass and asserting that nothing happened — an
  /// assertion that also passes when the timer fired and the flush silently did
  /// nothing. The tests assert both halves.
  bool get hasPendingFlush => _flushTimer != null;

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
      // A restored queue is, by definition, events a previous run could not
      // deliver. Arming here is what stops a launch that logs nothing new from
      // sitting on the same backlog a second time.
      _armFlushTimer();
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
    } else {
      // The batch rule is UNCHANGED — this is the else limb, reached only when
      // the queue is still short of [batchSize]. Arming here (rather than
      // restarting a timer on every log) is what anchors the deadline to the
      // oldest queued event: [_armFlushTimer] is a no-op while one is running.
      _armFlushTimer();
    }
  }

  /// Start the deadline for whatever is queued, if one is not already running.
  ///
  /// No-op when: a timer is already armed (the running one belongs to the OLDEST
  /// event and must not be pushed back), the queue is empty (nothing to ship),
  /// the recorder is disposed, or [flushInterval] is not positive (the timer is
  /// switched off by construction).
  void _armFlushTimer() {
    if (_disposed || _flushTimer != null || _queue.isEmpty) return;
    if (flushInterval <= Duration.zero) return;
    _flushTimer = Timer(flushInterval, () {
      // Cleared BEFORE the flush so `hasPendingFlush` never reports an armed
      // deadline for a timer that has already fired, and so the flush's own
      // re-arm in `finally` is not swallowed by a stale non-null handle.
      _flushTimer = null;
      // Unawaited by construction: nothing owns this call's future. `flush`
      // swallows every error, so there is no unhandled rejection to leak.
      unawaited(flush());
    });
  }

  /// Disarm. ⚠️ THE TWO LINES ARE ONE IDEA AND LIVE TOGETHER ON PURPOSE.
  ///
  /// They were written inline at all three call sites until a mutation run
  /// proved the pair is separable in exactly the way that reports clean:
  /// deleting the `cancel()` and keeping the `= null` passed all 246 tests. The
  /// handle is dropped, so `hasPendingFlush` reads false and every "the deadline
  /// was cancelled" assertion holds — while the OS timer is still live. When it
  /// fires it finds an empty queue and no-ops, so nothing is observable HERE;
  /// what it costs is a leaked timer, and a leaked timer is what fails a
  /// `testWidgets` body ("A Timer is still pending even after the widget tree was
  /// disposed") over in the brick's chassis lane, attributed to the stamp rather
  /// than to this file. One call, so the deletion that hides is no longer
  /// available: removing `_cancelFlushTimer()` turns `hasPendingFlush` red.
  void _cancelFlushTimer() {
    _flushTimer?.cancel();
    _flushTimer = null;
  }

  @override
  Future<void> flush() async {
    // ANY flush supersedes the pending deadline — the batch-size one from [log],
    // the lifecycle one from the app root, and the timer's own. Cancelling first
    // is what makes "no double-send" structural rather than timing-dependent: a
    // deadline that outlived the flush it was superseded by would fire on a queue
    // that has already gone out.
    _cancelFlushTimer();

    // The re-entrancy guard is UNCHANGED. A timer that fires mid-flight lands
    // here and returns without sending; the in-flight flush's `finally` re-arms
    // if anything is still queued, so the no-op does not strand the remainder.
    if (_flushing || _queue.isEmpty) return;
    if (_consent.statusOf(ConsentPurpose.analytics) != ConsentStatus.granted) {
      return;
    }
    _flushing = true;
    final int epoch = _epoch;

    // Did this attempt actually hand events over? Only a delivery re-arms —
    // see the `finally` below.
    bool delivered = false;
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
        delivered = true;
        await _persist();
      }
      // On Err: keep everything. The next log() or flush() retries, and the
      // server dedups on event_id, so a retry after a lost response is safe.
    } catch (_) {
      // Analytics must never surface an error into a user-facing flow.
    } finally {
      _flushing = false;
      // ⚠️ ONLY ON A DELIVERY, and this asymmetry is deliberate. Re-arming after
      // a FAILED send would turn the timer into a fixed-interval retry loop:
      // a device offline for an hour would attempt a POST every 10 s for the
      // whole hour, which is a battery and data cost paid for nothing. On a
      // failure the recorder keeps the pre-E-4a behaviour exactly — the next
      // log() (which finds no timer armed and arms one) or the next explicit
      // flush retries. On a SUCCESS with events still queued there is a further
      // batch ready to go now, so it is armed to drain rather than left waiting
      // on a log that may never come.
      if (delivered) _armFlushTimer();
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
    // A withdrawal must leave no armed delivery behind. The timer would find an
    // empty queue and no-op, but "it happens to be harmless" is not the property
    // this method is supposed to establish.
    _cancelFlushTimer();
    _queue.clear();
    await _clearStore();
  }

  /// Release the timer. Call this when the recorder is discarded — the app's
  /// `analyticsProvider` does it from `ref.onDispose`.
  ///
  /// 🔴 AN UNCANCELLED TIMER IS A TEST FAILURE, NOT A LEAK NOBODY NOTICES.
  /// `flutter_test` fails a `testWidgets` body outright with "A Timer is still
  /// pending even after the widget tree was disposed", and under `dart test` a
  /// pending timer keeps the isolate's event loop alive past the assertion it
  /// belongs to. The chassis property tests drive a real recorder through the
  /// real widget tree, so this is the difference between a green lane and a lane
  /// that fails on a stamped app for reasons unrelated to the stamp.
  ///
  /// Deliberately does NOT flush. Its callers — provider teardown and widget
  /// disposal — are synchronous, so a POST launched here would outlive the
  /// object that owns the queue, and there is nothing left to await it or to
  /// write the result back. Nothing is lost: [log] persists after every event,
  /// so the next [hydrate] picks the queue up and re-arms it.
  void dispose() {
    _disposed = true;
    _cancelFlushTimer();
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
