import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

// ─────────────────────────────────────────────────────────────────────────────
// [pipeline 11]E-4a — THE TIME-BASED FLUSH.
//
// 🔴 THE DEFECT THESE TESTS ENCODE, measured in production: three real browsers
// granted analytics consent on subly.nikatru.com and ZERO events were ever
// delivered. Nothing was broken in the sense a test would notice — the recorder
// collected, sanitised, stamped consent ids and persisted, and every one of the
// 231 existing tests passed. It simply had no reason to POST: delivery required
// either 20 queued events or an explicit `flush()`, and a launch emits three.
//
// 🔴 WHY THE OLD SUITE COULD NOT HAVE CAUGHT IT. Every delivery assertion in
// `analytics_test.dart` reaches the wire by calling `flush()` itself, or by
// setting `batchSize` to 1, 2 or 3 so the batch rule fires. Both are legitimate
// tests of what they test — and both supply, from the test, the very trigger the
// app never supplies. The property nobody had written down is the one below:
// *time passing is enough*.
//
// ⚠️ THE RECORDED FAILING CASE. Delete the `else { _armFlushTimer(); }` limb from
// `AnalyticsRecorder.log` (or the `_armFlushTimer` body, or the `_flushTimer =
// Timer(...)` line) and re-run: the first test in `time alone delivers` fails
// with `expected: 1, actual: 0` — one event logged, the whole window elapsed,
// nothing on the wire. That is the production defect reproduced in 40 ms. The
// same mutation leaves EVERY test in `analytics_test.dart`,
// `analytics_lifecycle_test.dart` and `analytics_withdrawal_test.dart` green,
// which is exactly why this file exists rather than another case in that one.
//
// The disabled-timer control at the bottom of this file runs that mutation as a
// LIVE test on every CI run — `flushInterval: Duration.zero` is the pre-E-4a
// recorder, and it is asserted to deliver nothing.
// ─────────────────────────────────────────────────────────────────────────────

/// The window under test. Real milliseconds rather than a fake clock: this
/// package's tests inject a `clock` for the SESSION timeout (which is computed
/// from `DateTime` differences) and have no fake-async harness, and a `Timer`
/// does not consult that clock. Shrinking the interval is the same technique
/// applied to the same problem — the production value lives in
/// [kFlushInterval] and is asserted below.
const Duration kWindow = Duration(milliseconds: 20);

/// Comfortably past [kWindow]. 10x, because the failure mode of a margin that
/// is too tight is a flaky test that gets deleted, and the failure mode of one
/// that is too generous is a suite that runs a fraction of a second slower.
Future<void> pastTheWindow([int windows = 1]) =>
    Future<void>.delayed(Duration(milliseconds: 200 * windows));

/// A transport whose outcome and call log are inspectable.
class _FakeTransport implements EventTransport {
  _FakeTransport({this.ok = true});

  bool ok;
  int calls = 0;

  /// Runs WHILE the send is in flight, so a test can let a timer fire against a
  /// flush that has not returned yet.
  Future<void> Function()? onSend;

  final List<List<Map<String, Object?>>> batches =
      <List<Map<String, Object?>>>[];

  /// Every event name that reached the wire, in order, INCLUDING duplicates —
  /// the point of several of these tests is that there are none.
  List<String> get delivered => batches
      .expand((List<Map<String, Object?>> b) => b)
      .map((Map<String, Object?> e) => e['event']! as String)
      .toList();

  /// The exactly-once key. Duplicate delivery is dedup'd server-side, so a
  /// double-send is invisible in production; it has to be caught here.
  List<String> get deliveredIds => batches
      .expand((List<Map<String, Object?>> b) => b)
      .map((Map<String, Object?> e) => e['event_id']! as String)
      .toList();

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    batches.add(events);
    final Future<void> Function()? hook = onSend;
    if (hook != null) await hook();
    return ok
        ? const Result<void>.ok(null)
        : const Result<void>.err(Failure('offline'));
  }
}

Future<ConsentController> _granted(KeyValueStore store) async {
  final ConsentController c = ConsentController(store: store);
  await c.record(
    ConsentPurpose.analytics,
    granted: true,
    policyVersion: '2026-07-25',
    anonId: 'install-1',
    now: DateTime.utc(2026, 7, 25),
  );
  return c;
}

AnalyticsRecorder _recorder({
  required ConsentController consent,
  required EventTransport transport,
  KeyValueStore? store,
  int batchSize = 20,
  int maxQueued = 500,
  Duration flushInterval = kWindow,
}) =>
    AnalyticsRecorder(
      appId: 'subly',
      anonId: 'install-1',
      transport: transport,
      consent: consent,
      queueStore: store,
      batchSize: batchSize,
      maxQueued: maxQueued,
      flushInterval: flushInterval,
    );

void main() {
  group('the production value', () {
    test('kFlushInterval is a positive, one-shot-sized window', () {
      // Pinned so "the timer is on" cannot be quietly undone by setting the
      // default to zero — which is a one-character change that turns every
      // assertion in this file into a test of a disabled feature, and turns the
      // shipped recorder back into the one that delivered nothing.
      expect(kFlushInterval, greaterThan(Duration.zero));
      expect(kFlushInterval, const Duration(seconds: 10));
      expect(kFlushBatchSize, 20, reason: 'the batch rule is unchanged');
    });
  });

  group('time alone delivers', () {
    // 🔴 THE HEADLINE. One event, far below the batch size, no explicit flush.
    // This is the exact shape of the production failure: the launch trio is
    // three events and the batch size is twenty.
    test('a SINGLE event ships once the window passes — no batch, no flush()',
        () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('first_launch');
      expect(t.calls, 0, reason: 'nothing may go out synchronously');
      expect(r.hasPendingFlush, isTrue, reason: 'the deadline must be armed');

      await pastTheWindow();

      expect(t.calls, 1);
      expect(t.delivered, <String>['first_launch']);
      expect(r.queuedCount, 0);
      expect(r.hasPendingFlush, isFalse, reason: 'nothing left to ship');
    });

    test('the whole launch trio ships as ONE batch, not three', () async {
      // The reason the window is 10 s rather than 0: the trio is emitted inside
      // one frame, so a flush-per-event would triple the request count of every
      // cold start in the portfolio for no extra information.
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('first_launch');
      await r.log('app_open');
      await r.log('return_visit');
      await pastTheWindow();

      expect(t.calls, 1, reason: 'one request, not three');
      expect(t.delivered, <String>['first_launch', 'app_open', 'return_visit']);
    });

    // 🔴 THE DEADLINE BELONGS TO THE OLDEST EVENT. A debounce that restarted on
    // every log would let a steady trickle push delivery back indefinitely —
    // the original defect with extra steps, and it would pass the two tests
    // above unchanged.
    test('a later event does NOT push the deadline back', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      // Wide margins on purpose: anchored-to-oldest fires 400 ms after `a`
      // (i.e. 100 ms before this test looks), while restart-on-log would fire
      // 400 ms after `b` — 400 ms after this test looks. 300 ms of slack in
      // both directions is what keeps the discriminator from being a race.
      final AnalyticsRecorder r = _recorder(
        consent: c,
        transport: t,
        flushInterval: const Duration(milliseconds: 400),
      );
      addTearDown(r.dispose);

      await r.log('a');
      await Future<void>.delayed(const Duration(milliseconds: 300));
      await r.log('b'); // a restart-on-log timer would re-anchor HERE
      await Future<void>.delayed(const Duration(milliseconds: 200));

      expect(t.calls, 1,
          reason: 'the deadline is anchored to `a`, which is 500 ms old');
      expect(t.delivered, <String>['a', 'b']);
    });
  });

  group('a flush cancels the deadline — no double-send', () {
    test('an EXPLICIT flush cancels it', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('app_open');
      expect(r.hasPendingFlush, isTrue);

      await r.flush(); // the lifecycle path — paused/detached/hidden/inactive
      expect(t.calls, 1);
      expect(r.hasPendingFlush, isFalse);

      await pastTheWindow();
      expect(t.calls, 1, reason: 'a superseded deadline must not fire');
      expect(t.deliveredIds.toSet().length, t.deliveredIds.length,
          reason: 'no event may be sent twice');
    });

    test('the BATCH-SIZE flush cancels it', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 3);
      addTearDown(r.dispose);

      await r.log('a');
      expect(r.hasPendingFlush, isTrue);
      await r.log('b');
      await r.log('c'); // trips the batch rule
      expect(t.calls, 1);
      expect(r.hasPendingFlush, isFalse);
      expect(r.queuedCount, 0);

      await pastTheWindow();
      expect(t.calls, 1);
      expect(t.delivered, <String>['a', 'b', 'c']);
    });

    // The re-entrancy case: the deadline expires while a send is still on the
    // wire. `flush` is guarded by `_flushing`, so the timer's call must no-op —
    // and the in-flight flush's `finally` must then re-arm, or the events that
    // arrived during the request are stranded.
    test(
        'a deadline that fires DURING an in-flight flush neither double-sends '
        'nor strands the remainder', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      // The batch size is deliberately far out of reach: this test is about the
      // TIMER path, and the first draft used `batchSize: 2`, where the event
      // logged mid-flight pushed the queue (which still holds the in-flight
      // batch — it is not removed until the send returns) over the threshold and
      // took the batch branch instead. The property under test never ran.
      final AnalyticsRecorder r = _recorder(
        consent: c,
        transport: t,
        batchSize: 99,
        flushInterval: const Duration(milliseconds: 30),
      );
      addTearDown(r.dispose);

      // ⚠️ OBSERVATIONS ARE RECORDED HERE, NEVER ASSERTED. This hook runs inside
      // `_transport.send`, and `flush` swallows every throw by design ("analytics
      // must never surface an error into a user-facing flow") — so a failing
      // `expect` in here is CAUGHT, the send is treated as having thrown, and the
      // test fails three assertions later with a number that describes the
      // swallowed exception rather than the property. Measured: it presented as
      // `queuedCount` 3 instead of 1.
      bool? armedAfterMidFlightLog;
      bool? armedAfterDeadlineExpired;
      t.onSend = () async {
        t.onSend = null;
        // Below the batch size, so this arms a fresh deadline…
        await r.log('c');
        armedAfterMidFlightLog = r.hasPendingFlush;
        // …and the request is held open long enough for it to expire.
        await Future<void>.delayed(const Duration(milliseconds: 150));
        armedAfterDeadlineExpired = r.hasPendingFlush;
      };

      await r.log('a'); // arms the deadline that starts the whole sequence
      await Future<void>.delayed(const Duration(milliseconds: 400));

      expect(armedAfterMidFlightLog, isTrue,
          reason: 'an event arriving mid-flight arms its own deadline');
      expect(armedAfterDeadlineExpired, isFalse,
          reason: 'that deadline fired, found _flushing == true, and no-opped');

      expect(t.calls, 2, reason: 'two sends: [a] then [c] — never three');
      expect(t.delivered, <String>['a', 'c']);
      expect(t.deliveredIds.toSet().length, 2,
          reason: 'exactly-once — the re-entrant call must not re-send `a`');
      // 🔴 `c` reached the wire with NO further log() and NO explicit flush, so
      // the flush that delivered `a` must have re-armed for the remainder. Drop
      // the `if (delivered) _armFlushTimer();` from flush()'s finally and this
      // is the assertion that goes red.
      expect(r.queuedCount, 0);
      expect(r.hasPendingFlush, isFalse);
    });
  });

  group('the deadline drains, but never becomes a retry loop', () {
    // A successful send that leaves events behind means there is another full
    // batch ready NOW. Waiting for a log that may never come is how a hydrated
    // backlog of 60 events would take three more launches to clear.
    test('a delivery with events still queued re-arms to drain', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = await _granted(store);

      // Park five events on disk via an offline recorder.
      final _FakeTransport offline = _FakeTransport(ok: false);
      final AnalyticsRecorder first = _recorder(
          consent: c,
          transport: offline,
          store: store,
          batchSize: 99,
          flushInterval: Duration.zero);
      for (final String e in <String>['e1', 'e2', 'e3', 'e4', 'e5']) {
        await first.log(e);
      }
      first.dispose();

      final _FakeTransport online = _FakeTransport();
      final AnalyticsRecorder next =
          _recorder(consent: c, transport: online, store: store, batchSize: 2);
      addTearDown(next.dispose);

      await next.hydrate();
      expect(next.queuedCount, 5);
      // 🔴 HYDRATE ARMS. A restored queue is by definition undelivered events;
      // without this a launch that logs nothing new sits on the same backlog a
      // second time.
      expect(next.hasPendingFlush, isTrue);

      await pastTheWindow(2);

      expect(online.calls, 3, reason: '5 events over a batch size of 2');
      expect(online.delivered, <String>['e1', 'e2', 'e3', 'e4', 'e5']);
      expect(next.queuedCount, 0);
      expect(next.hasPendingFlush, isFalse, reason: 'drained, so disarmed');
    });

    // ⚠️ THE ASYMMETRY THAT MATTERS FOR BATTERY. Re-arming after a FAILED send
    // would make this a fixed-interval retry loop: a device offline for an hour
    // would attempt a POST every 10 s for the whole hour and deliver nothing.
    test('a FAILED send does not re-arm', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport(ok: false);
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('a');
      await pastTheWindow();

      expect(t.calls, 1, reason: 'it must still ATTEMPT once');
      expect(r.queuedCount, 1, reason: 'nothing is dropped on failure');
      expect(r.hasPendingFlush, isFalse);

      await pastTheWindow();
      expect(t.calls, 1, reason: 'no unattended retry loop');

      // …and the next event re-arms, so the backlog is not stranded either.
      t.ok = true;
      await r.log('b');
      expect(r.hasPendingFlush, isTrue);
      await pastTheWindow();
      expect(t.calls, 2);
      expect(t.delivered, <String>['a', 'a', 'b'],
          reason: 'the retry re-sends `a`; the sink dedups on event_id');
    });
  });

  group('lifecycle — the timer must not outlive the recorder', () {
    // 🔴 An uncancelled Timer is a TEST FAILURE, not a leak nobody notices:
    // `flutter_test` fails a testWidgets body outright with "A Timer is still
    // pending even after the widget tree was disposed", and the brick's chassis
    // property tests drive a real recorder through the real widget tree.
    test('dispose cancels the deadline and delivers nothing after it',
        () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);

      await r.log('app_open');
      expect(r.hasPendingFlush, isTrue);

      r.dispose();
      expect(r.hasPendingFlush, isFalse);

      await pastTheWindow();
      expect(t.calls, 0, reason: 'a disposed recorder must not transmit');
      expect(r.queuedCount, 1,
          reason: 'dispose is not a purge — the queue is persisted and the '
              'next hydrate picks it up');
    });

    test('a disposed recorder cannot be re-armed by a later log', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);

      r.dispose();
      await r.log('app_open');

      expect(r.hasPendingFlush, isFalse);
      await pastTheWindow();
      expect(t.calls, 0);
    });

    test('dispose is idempotent', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: _FakeTransport());
      await r.log('a');
      r.dispose();
      expect(r.dispose, returnsNormally);
    });

    // The withdrawal path. The timer would find an empty queue and no-op, but
    // "it happens to be harmless" is not the property purge establishes.
    test('purge cancels the deadline', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('paywall_viewed');
      expect(r.hasPendingFlush, isTrue);

      await r.purge();
      expect(r.hasPendingFlush, isFalse);
      expect(r.queuedCount, 0);

      await pastTheWindow();
      expect(t.calls, 0, reason: 'a withdrawal must leave nothing armed');
    });
  });

  group('consent still gates the timer', () {
    test('an ungranted recorder arms nothing — there is nothing to arm',
        () async {
      final _FakeTransport t = _FakeTransport();
      final ConsentController c =
          ConsentController(store: InMemoryKeyValueStore());
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      addTearDown(r.dispose);

      await r.log('paywall_viewed');
      expect(r.queuedCount, 0, reason: 'pre-consent events are DISCARDED');
      expect(r.hasPendingFlush, isFalse);

      await pastTheWindow();
      expect(t.calls, 0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 🔴 THE NEGATIVE CONTROL, RUN LIVE ON EVERY CI PASS.
  //
  // `flushInterval: Duration.zero` IS the pre-E-4a recorder — batch-size and
  // explicit flush, nothing else. Asserting that this configuration delivers
  // NOTHING is what proves the tests above are measuring the timer and not some
  // other path that would have shipped the event anyway. Without it, a change
  // that made `log()` flush unconditionally would turn every test above green
  // for the wrong reason.
  // ───────────────────────────────────────────────────────────────────────────
  group('NEGATIVE CONTROL — with the timer off, time delivers nothing', () {
    test('a single event + the whole window = ZERO events on the wire',
        () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, flushInterval: Duration.zero);
      addTearDown(r.dispose);

      await r.log('first_launch');
      await r.log('app_open');
      await r.log('return_visit');
      expect(r.hasPendingFlush, isFalse, reason: 'the timer is switched off');

      await pastTheWindow(3);

      expect(t.calls, 0,
          reason: 'THIS IS THE PRODUCTION DEFECT — three consented events, the '
              'window elapsed, nothing delivered');
      expect(r.queuedCount, 3);

      // …and the only thing that saved it was the explicit flush the app root
      // may never reach.
      await r.flush();
      expect(t.calls, 1);
    });
  });
}
