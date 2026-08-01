import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// A transport whose outcome and call log are inspectable.
class _FakeTransport implements EventTransport {
  _FakeTransport({this.ok = true});
  bool ok;
  int calls = 0;
  final List<List<Map<String, Object?>>> batches =
      <List<Map<String, Object?>>>[];
  Map<String, Object?> lastEnvelope = <String, Object?>{};
  String? lastAnonId;

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    lastAnonId = anonId;
    lastEnvelope = envelope;
    batches.add(events);
    return ok
        ? const Result<void>.ok(null)
        : const Result<void>.err(Failure('offline'));
  }
}

/// A store whose writes always throw — proves persistence is best-effort.
class _FailingStore implements KeyValueStore {
  @override
  Future<bool> containsKey(String key) async => false;
  @override
  Future<String?> read(String key) async => throw StateError('nope');
  @override
  Future<void> remove(String key) async {}
  @override
  Future<void> write(String key, String value) async =>
      throw StateError('nope');
}

Future<ConsentController> _granted(
  KeyValueStore store, {
  String anonId = 'install-1',
}) async {
  final ConsentController c = ConsentController(store: store);
  await c.record(
    ConsentPurpose.analytics,
    granted: true,
    policyVersion: '2026-07-25',
    anonId: anonId,
    now: DateTime.utc(2026, 7, 25),
  );
  return c;
}

AnalyticsRecorder _recorder({
  required ConsentController consent,
  required EventTransport transport,
  KeyValueStore? store,
  DateTime Function()? clock,
  int batchSize = 20,
  int maxQueued = 500,
  String anonId = 'install-1',
}) =>
    AnalyticsRecorder(
      appId: 'subly',
      anonId: anonId,
      transport: transport,
      consent: consent,
      queueStore: store,
      clock: clock,
      batchSize: batchSize,
      maxQueued: maxQueued,
    );

void main() {
  group('uuidV4', () {
    test('is well-formed, version 4, variant 10xx, and unique', () {
      final Set<String> seen = <String>{};
      for (int i = 0; i < 200; i++) {
        final String u = uuidV4();
        expect(
            RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-'
                    r'[0-9a-f]{12}$')
                .hasMatch(u),
            isTrue,
            reason: u);
        seen.add(u);
      }
      expect(seen.length, 200);
    });
  });

  group('consent gate (DPDP — collection is OPT-IN)', () {
    test('unknown consent collects NOTHING and never buffers for later',
        () async {
      // The critical property: pre-consent events are not held back for replay.
      // Events collected before consent are collected WITHOUT consent, whenever
      // they are eventually sent.
      final _FakeTransport t = _FakeTransport();
      final ConsentController c =
          ConsentController(store: InMemoryKeyValueStore());
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.unknown);
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      await r.log('paywall_viewed');
      await r.flush();
      expect(r.queuedCount, 0);
      expect(t.calls, 0);
    });

    test('denied consent collects nothing', () async {
      final _FakeTransport t = _FakeTransport();
      final ConsentController c =
          ConsentController(store: InMemoryKeyValueStore());
      await c.record(ConsentPurpose.analytics,
          granted: false,
          policyVersion: 'v1',
          anonId: 'i',
          now: DateTime.utc(2026));
      final AnalyticsRecorder r = _recorder(consent: c, transport: t);
      await r.log('app_open');
      expect(r.queuedCount, 0);
    });

    test('granted consent collects, and stamps the artifact id on the event',
        () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = await _granted(store);
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 99);
      await r.log('first_launch');
      expect(r.queuedCount, 1);
      await r.flush();
      final Map<String, Object?> sent = t.batches.single.single;
      expect(sent['event'], 'first_launch');
      expect(sent['consent_id'],
          c.artifactOf(ConsentPurpose.analytics)!.consentId);
    });

    test('a withdrawal is a NEW artifact, not a mutation of the old one',
        () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = await _granted(store);
      final String first = c.artifactOf(ConsentPurpose.analytics)!.consentId;
      final ConsentArtifact w = await c.record(ConsentPurpose.analytics,
          granted: false,
          policyVersion: 'v1',
          anonId: 'i',
          now: DateTime.utc(2026));
      expect(w.consentId, isNot(first));
      expect(w.granted, isFalse);
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.denied);
    });

    test('consent is PER PURPOSE — analytics does not imply sync backup',
        () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      expect(c.statusOf(ConsentPurpose.analytics), ConsentStatus.granted);
      expect(c.statusOf(ConsentPurpose.syncBackup), ConsentStatus.unknown);
    });

    test('a corrupt or unreadable store hydrates to UNKNOWN (fail-closed)',
        () async {
      final ConsentController corrupt = ConsentController(
          store: InMemoryKeyValueStore(
              <String, String>{'nikatru.consent.analytics': 'not json'}));
      expect(await corrupt.hydrate(ConsentPurpose.analytics),
          ConsentStatus.unknown);
      final ConsentController broken =
          ConsentController(store: _FailingStore());
      expect(await broken.hydrate(ConsentPurpose.analytics),
          ConsentStatus.unknown);
    });

    test('a granted decision survives a restart via the store', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      await _granted(store);
      final ConsentController next = ConsentController(store: store);
      expect(next.statusOf(ConsentPurpose.analytics), ConsentStatus.unknown);
      expect(
          await next.hydrate(ConsentPurpose.analytics), ConsentStatus.granted);
    });
  });

  group('params are enumerable values only (no free text)', () {
    test('keeps scalars, drops long strings, maps and lists', () {
      final Map<String, Object?> p = sanitizeParams(<String, Object?>{
        'sku': 'pro_monthly',
        'count': 3,
        'ok': true,
        'note': 'x' * (kMaxParamValueLength + 1),
        'nested': <String, Object?>{'a': 1},
        'list': <int>[1, 2],
      });
      expect(p.keys.toSet(), <String>{'sku', 'count', 'ok'});
    });

    test('a long value is DROPPED, never truncated', () {
      // Truncated free text is still free text.
      final Map<String, Object?> p = sanitizeParams(
          <String, Object?>{'note': 'y' * (kMaxParamValueLength + 10)});
      expect(p.containsKey('note'), isFalse);
    });

    test('caps the param count', () {
      final Map<String, Object?> many = <String, Object?>{
        for (int i = 0; i < kMaxParamCount + 5; i++) 'k$i': i,
      };
      expect(sanitizeParams(many).length, kMaxParamCount);
    });
  });

  group('delivery', () {
    test('anon_id is passed through verbatim — never minted here', () async {
      // Two ids would make rollout bucket and analytics cohort unjoinable.
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(
          consent: c, transport: t, batchSize: 1, anonId: 'the-install-id');
      await r.log('app_open');
      expect(t.lastAnonId, 'the-install-id');
    });

    test('auto-flushes at the batch size', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 3);
      await r.log('a');
      await r.log('b');
      expect(t.calls, 0);
      await r.log('c');
      expect(t.calls, 1);
      expect(r.queuedCount, 0);
    });

    test('a failed send KEEPS the batch and retries — no connectivity check',
        () async {
      // There is deliberately no reachability probe: attempting the request IS
      // the check. connectivity_plus reports interface state and says
      // "connected" behind a captive portal.
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport(ok: false);
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 2);
      await r.log('a');
      await r.log('b');
      expect(t.calls, 1, reason: 'it must still ATTEMPT while offline');
      expect(r.queuedCount, 2, reason: 'nothing is dropped on failure');

      t.ok = true;
      await r.flush();
      expect(r.queuedCount, 0);
    });

    test('a transport that throws never propagates into the caller', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: _ThrowingTransport(), batchSize: 1);
      await expectLater(r.log('a'), completes);
    });

    test('the queue is bounded and drops the OLDEST events', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport(ok: false);
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 999, maxQueued: 3);
      for (final String e in <String>['e1', 'e2', 'e3', 'e4', 'e5']) {
        await r.log(e);
      }
      expect(r.queuedCount, 3);
      t.ok = true;
      await r.flush();
      final List<String> names = t.batches.single
          .map((Map<String, Object?> m) => m['event']! as String)
          .toList();
      expect(names, <String>['e3', 'e4', 'e5']);
    });

    // ── #9: the flush must not assume the queue HEAD is still the batch ──────
    // `_queue.removeRange(0, batch.length)` deleted "the first N" after a
    // successful send. Nothing holds the queue still during the await: `log()`
    // runs freely while `_transport.send` is in flight (only re-entrant `flush`
    // is guarded), and every `log` calls `_trim()`, which drops from the HEAD
    // once the queue is over `maxQueued`. One trim and the first N are no longer
    // the sent N — so `removeRange` silently discarded events that were never
    // delivered, on exactly the devices that queue the most.
    test('a concurrent enqueue+trim does not cost UNSENT events', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _ReentrantTransport t = _ReentrantTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 2, maxQueued: 3);

      // e1,e2 queue and trigger the auto-flush. WHILE that send is in flight,
      // three more events arrive — pushing the queue to 5 over a cap of 3, so
      // _trim drops from the head and e1/e2 are no longer at position 0..1.
      t.onSend = () async {
        await r.log('e3');
        await r.log('e4');
        await r.log('e5');
      };
      await r.log('e1');
      await r.log('e2');
      expect(t.calls, 1);
      expect(t.batches.single.map((Map<String, Object?> m) => m['event']),
          <String>['e1', 'e2']);

      // e1 was trimmed away (it WAS delivered, so that is fine) and e2 was
      // delivered; e3..e5 were not. The old removeRange(0, 2) deleted e3 and e4
      // here — two events the server never saw — and left only e5.
      t.onSend = null;
      await r.flush();
      final List<Object?> second =
          t.batches[1].map((Map<String, Object?> m) => m['event']).toList();
      expect(second, <String>['e3', 'e4'],
          reason: 'only DELIVERED events may be removed from the queue');
      expect(r.queuedCount, 1, reason: 'e5 is still waiting');
    });

    test('when the sent batch has been trimmed away ENTIRELY, nothing else is',
        () async {
      // The extreme of the same race: by the time the send returns, not one
      // member of the batch is still in the queue — everything there is NEW.
      // "Remove the first N" then removes N events that were never sent, which
      // is total loss for a small queue.
      //
      // The first draft of this test asserted that removeRange throws a
      // RangeError once the queue is shorter than the batch. It cannot: _trim
      // caps the queue at maxQueued and never takes it below the batch size, so
      // that assertion could not fail and proved nothing. Re-pointed at the
      // outcome that IS reachable — silently dropping unsent events.
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _ReentrantTransport t = _ReentrantTransport();
      final AnalyticsRecorder r =
          _recorder(consent: c, transport: t, batchSize: 1, maxQueued: 1);

      t.onSend = () async {
        await r.log('b'); // pushes 'a' out of the queue entirely
        await r.log('c'); // and 'b' out after it
      };
      await r.log('a');
      expect(t.batches.single.single['event'], 'a');

      t.onSend = null;
      await r.flush();
      expect(t.batches[1].single['event'], 'c',
          reason: 'the surviving unsent event must still be delivered');
      expect(r.queuedCount, 0);
    });

    test('a persisted queue survives a restart', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController c = await _granted(store);
      final _FakeTransport offline = _FakeTransport(ok: false);
      final AnalyticsRecorder first = _recorder(
          consent: c, transport: offline, store: store, batchSize: 999);
      await first.log('purchase_success');

      final _FakeTransport online = _FakeTransport();
      final AnalyticsRecorder next = _recorder(
          consent: c, transport: online, store: store, batchSize: 999);
      await next.hydrate();
      expect(next.queuedCount, 1);
      await next.flush();
      expect(online.batches.single.single['event'], 'purchase_success');
    });

    test('a failing queue store degrades to in-memory, never throws', () async {
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final _FakeTransport t = _FakeTransport();
      final AnalyticsRecorder r = _recorder(
          consent: c, transport: t, store: _FailingStore(), batchSize: 999);
      await expectLater(r.log('a'), completes);
      expect(r.queuedCount, 1);
      await expectLater(r.hydrate(), completes);
    });
  });

  group('sessions', () {
    test('rotate after the idle timeout, and only then', () async {
      DateTime now = DateTime.utc(2026, 7, 25, 10);
      final ConsentController c = await _granted(InMemoryKeyValueStore());
      final AnalyticsRecorder r = _recorder(
          consent: c,
          transport: _FakeTransport(),
          batchSize: 999,
          clock: () => now);

      final String s1 = r.sessionId;
      now = now.add(const Duration(minutes: 29));
      expect(r.sessionId, s1, reason: 'still inside the window');
      now = now.add(kSessionIdleTimeout);
      expect(r.sessionId, isNot(s1), reason: 'idled out');
    });
  });

  group('NoOpAnalytics', () {
    test('is the safe default and does nothing', () async {
      const Analytics a = NoOpAnalytics();
      await expectLater(
          a.log('x', params: <String, Object?>{'y': 1}), completes);
      await expectLater(a.flush(), completes);
    });
  });
}

/// A transport that lets the test run code WHILE the send is in flight — which
/// is the only way to reproduce the real race: `log()` is not blocked during a
/// flush, so the queue genuinely moves under `send`.
class _ReentrantTransport implements EventTransport {
  int calls = 0;
  Future<void> Function()? onSend;
  final List<List<Map<String, Object?>>> batches =
      <List<Map<String, Object?>>>[];

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
    return const Result<void>.ok(null);
  }
}

class _ThrowingTransport implements EventTransport {
  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async =>
      throw StateError('boom');
}
