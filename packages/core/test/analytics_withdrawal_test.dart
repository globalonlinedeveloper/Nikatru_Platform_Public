import 'dart:async';

import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// WITHDRAWAL, NOT JUST REFUSAL (DPDP §6(3)).
///
/// `analytics_test.dart` proves the gate stays SHUT before consent. Every one of
/// those tests passed while this defect was live, because they only ever asked
/// whether NEW events are collected. They are not — but the recorder is an
/// OUTBOX, and at the moment a user withdraws it is still holding everything
/// gathered under the old grant, in memory and on disk. Nothing dropped it, so
/// the next successful flush shipped the lot, minutes or days after the user
/// said stop. "We stopped enqueueing" is not withdrawal.
///
/// These tests assert the drop itself, on all three paths it has to survive:
/// the live object, a restart/rebuild, and a request already on the wire.
class _CountingTransport implements EventTransport {
  int calls = 0;
  final List<Map<String, Object?>> delivered = <Map<String, Object?>>[];

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    delivered.addAll(events);
    return const Result<void>.ok(null);
  }
}

/// Holds the send open until the test releases it, so a withdrawal can land
/// while a batch is genuinely in flight.
class _BlockingTransport implements EventTransport {
  final Completer<void> gate = Completer<void>();
  final Completer<void> started = Completer<void>();
  int calls = 0;

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    if (!started.isCompleted) started.complete();
    await gate.future;
    return const Result<void>.ok(null);
  }
}

const String _queueKey = 'nikatru.analytics.queue';

Future<ConsentController> _decided(
  KeyValueStore store, {
  required bool granted,
}) async {
  final ConsentController c = ConsentController(store: store);
  await c.record(
    ConsentPurpose.analytics,
    granted: granted,
    policyVersion: '2026-08-01',
    anonId: 'install-1',
    now: DateTime.utc(2026, 8, 1),
  );
  return c;
}

AnalyticsRecorder _recorder({
  required ConsentController consent,
  required EventTransport transport,
  required KeyValueStore store,
  int batchSize = 99,
}) =>
    AnalyticsRecorder(
      appId: 'subly',
      anonId: 'install-1',
      transport: transport,
      consent: consent,
      queueStore: store,
      batchSize: batchSize,
    );

void main() {
  group('withdrawal drops the queued payload', () {
    test('a queued event is never transmitted after withdrawal', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController consent = await _decided(store, granted: true);
      final _CountingTransport transport = _CountingTransport();
      final AnalyticsRecorder r = _recorder(
        consent: consent,
        transport: transport,
        store: store,
      );

      await r.log('paywall_viewed');
      await r.log('checkout_started');
      expect(r.queuedCount, 2, reason: 'precondition: the outbox is not empty');
      expect(await store.containsKey(_queueKey), isTrue);

      // The withdrawal, exactly as the app performs it: a new append-only
      // artifact, then the drop.
      await consent.record(
        ConsentPurpose.analytics,
        granted: false,
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 2),
      );
      await r.purge();

      expect(r.queuedCount, 0);
      expect(
        await store.containsKey(_queueKey),
        isFalse,
        reason: 'an emptied outbox file is still an outbox file',
      );

      // The whole point: no later flush can resurrect them.
      await r.flush();
      expect(transport.calls, 0);
      expect(transport.delivered, isEmpty);
    });

    test('a REBUILT recorder does not resurrect a withdrawn queue', () async {
      // This is the path that makes an in-memory-only purge worthless: the app
      // invalidates its consent provider so the new decision becomes visible,
      // which builds a fresh recorder that immediately hydrates from disk.
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController consent = await _decided(store, granted: true);
      final AnalyticsRecorder first = _recorder(
        consent: consent,
        transport: _CountingTransport(),
        store: store,
      );
      await first.log('app_open');
      expect(await store.containsKey(_queueKey), isTrue);

      await consent.record(
        ConsentPurpose.analytics,
        granted: false,
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 2),
      );

      final _CountingTransport transport = _CountingTransport();
      final AnalyticsRecorder reborn = _recorder(
        consent: consent,
        transport: transport,
        store: store,
      );
      await reborn.hydrate();
      expect(reborn.queuedCount, 0);
      await reborn.flush();
      expect(transport.calls, 0);

      // DELETED, not merely skipped. If hydrate only declined to read it, a
      // later re-grant would ship events collected under a consent the user had
      // already withdrawn.
      expect(await store.containsKey(_queueKey), isFalse);
      final ConsentController regranted = await _decided(store, granted: true);
      final AnalyticsRecorder third = _recorder(
        consent: regranted,
        transport: transport,
        store: store,
      );
      await third.hydrate();
      expect(third.queuedCount, 0);
    });

    test('UNKNOWN consent restores nothing but destroys nothing', () async {
      // `denied` and `unknown` are not the same and must not be collapsed.
      // Unknown is "we could not tell" — typically an unreadable consent store —
      // and deleting a legitimate outbox because a read failed is data loss, not
      // fail-closed behaviour. Nothing is loaded either way, so nothing can be
      // sent while we cannot tell.
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController granted = await _decided(store, granted: true);
      final AnalyticsRecorder first = _recorder(
        consent: granted,
        transport: _CountingTransport(),
        store: store,
      );
      await first.log('app_open');
      await first.log('first_launch');

      final AnalyticsRecorder unknown = _recorder(
        consent: ConsentController(store: InMemoryKeyValueStore()),
        transport: _CountingTransport(),
        store: store,
      );
      await unknown.hydrate();
      expect(unknown.queuedCount, 0,
          reason: 'unknown never permits collection');
      expect(await store.containsKey(_queueKey), isTrue);

      // The same store under a real grant still has both events.
      final AnalyticsRecorder resumed = _recorder(
        consent: await _decided(store, granted: true),
        transport: _CountingTransport(),
        store: store,
      );
      await resumed.hydrate();
      expect(resumed.queuedCount, 2);
    });

    test('an in-flight flush does not re-persist a purged queue', () async {
      // The batch already on the wire cannot be recalled — but when its response
      // finally lands it must not write the outbox back to the key the
      // withdrawal just deleted.
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ConsentController consent = await _decided(store, granted: true);
      final _BlockingTransport transport = _BlockingTransport();
      final AnalyticsRecorder r = _recorder(
        consent: consent,
        transport: transport,
        store: store,
      );
      await r.log('app_open');

      final Future<void> inFlight = r.flush();
      await transport.started.future;

      await consent.record(
        ConsentPurpose.analytics,
        granted: false,
        policyVersion: '2026-08-01',
        anonId: 'install-1',
        now: DateTime.utc(2026, 8, 2),
      );
      await r.purge();
      expect(await store.containsKey(_queueKey), isFalse);

      transport.gate.complete();
      await inFlight;

      expect(r.queuedCount, 0);
      expect(
        await store.containsKey(_queueKey),
        isFalse,
        reason: 'the finishing flush put the outbox file back',
      );
    });

    test('purge is on the facade, so the no-op honours it too', () async {
      // `Analytics` is what app code programs against. If purge lived only on
      // the recorder every app would need a type test to withdraw, and the one
      // that forgot would be the one shipping the compliance bug.
      const Analytics a = NoOpAnalytics();
      await expectLater(a.purge(), completes);
    });
  });
}
