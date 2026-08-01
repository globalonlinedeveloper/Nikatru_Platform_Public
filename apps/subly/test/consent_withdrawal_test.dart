import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/state/analytics_providers.dart';

/// WITHDRAWAL HAS TO REACH THE OUTBOX (DPDP §6(3)).
///
/// `consent_open_path_test.dart` proves the rail can be opened and shut. Shutting
/// it stops NEW collection — and that is where the app stopped. At the moment the
/// user flips "Usage statistics" off, the recorder is still holding every event
/// gathered under the old grant, in memory and persisted, and all of them would
/// have shipped on the next successful flush. Nothing went red, because refusing
/// new events is exactly what those tests assert.
///
/// The drop itself lives in the chassis (`AnalyticsRecorder.purge`, proven in
/// `packages/core/test/analytics_withdrawal_test.dart`). What is under test HERE
/// is the app half: that Subly's own decision path actually hands the live
/// recorder to it, through the real `WidgetRef` route the Settings toggle uses.
class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _CountingEventTransport implements core.EventTransport {
  int calls = 0;
  @override
  Future<core.Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    return const core.Result<void>.ok(null);
  }
}

class _DiscardingConsentTransport implements core.ConsentTransport {
  @override
  Future<core.Result<void>> send({
    required String appId,
    required core.ConsentArtifact artifact,
  }) async => const core.Result<void>.ok(null);
}

const String _queueKey = 'nikatru.analytics.queue';

/// The Settings row, reduced to its two taps. `recordAnalyticsConsent` takes a
/// [WidgetRef], so the only honest way to exercise it is from a widget — and
/// that route is what the defect lived on.
class _ConsentHarness extends ConsumerWidget {
  const _ConsentHarness();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Watched so the recorder is actually built; the real app watches it via
    // the funnel from the first screen.
    ref.watch(analyticsProvider);
    return MaterialApp(
      home: Scaffold(
        body: Column(
          children: <Widget>[
            TextButton(
              onPressed: () => recordAnalyticsConsent(ref, granted: true),
              child: const Text('grant'),
            ),
            TextButton(
              onPressed: () => recordAnalyticsConsent(ref, granted: false),
              child: const Text('withdraw'),
            ),
          ],
        ),
      ),
    );
  }
}

void main() {
  testWidgets('the Settings withdrawal drops the queued events', (
    WidgetTester tester,
  ) async {
    final _MemStore store = _MemStore();
    final _CountingEventTransport events = _CountingEventTransport();
    core.AnalyticsRecorder? live;

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((Ref ref) async => store),
          // A REAL recorder over a real store — the point is that something with
          // an actual outbox is handed to the decision path.
          analyticsProvider.overrideWith((Ref ref) async {
            final core.ConsentController consent = await ref.watch(
              consentControllerProvider.future,
            );
            final core.AnalyticsRecorder r = core.AnalyticsRecorder(
              appId: 'subly',
              anonId: 'install-1',
              transport: events,
              consent: consent,
              queueStore: store,
              batchSize: 99,
            );
            await r.hydrate();
            live = r;
            return r;
          }),
        ],
        child: const _ConsentHarness(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('grant'));
    await tester.pumpAndSettle();

    // Collect something under the grant — this is the payload the user is about
    // to withdraw consent for.
    final core.AnalyticsRecorder collected = live!;
    await collected.log('paywall_viewed');
    await collected.log('checkout_started');
    expect(collected.queuedCount, 2, reason: 'precondition: a full outbox');
    expect(await store.containsKey(_queueKey), isTrue);

    await tester.tap(find.text('withdraw'));
    await tester.pumpAndSettle();

    // The live recorder's own queue is gone — not merely closed to new events.
    expect(
      collected.queuedCount,
      0,
      reason: 'the app never handed the live recorder to the decision path',
    );
    expect(await store.containsKey(_queueKey), isFalse);

    // And nothing was ever shipped.
    await collected.flush();
    expect(events.calls, 0);
  });

  test('the decision path itself purges on withdrawal, and only then', () async {
    // The Riverpod-free half, driven directly — same reason `applyConsentDecision`
    // exists at all.
    final _MemStore store = _MemStore();
    final core.ConsentController controller = core.ConsentController(
      store: store,
    );
    final _CountingEventTransport events = _CountingEventTransport();
    final core.AnalyticsRecorder recorder = core.AnalyticsRecorder(
      appId: 'subly',
      anonId: 'install-1',
      transport: events,
      consent: controller,
      queueStore: store,
      batchSize: 99,
    );

    await applyConsentDecision(
      controller: controller,
      transport: _DiscardingConsentTransport(),
      appId: 'subly',
      anonId: 'install-1',
      granted: true,
      analytics: recorder,
      platform: 'web',
      now: DateTime.utc(2026, 8, 1),
    );
    await recorder.log('app_open');
    expect(
      recorder.queuedCount,
      1,
      reason: 'granting must NOT purge — that would delete lawful collection',
    );

    await applyConsentDecision(
      controller: controller,
      transport: _DiscardingConsentTransport(),
      appId: 'subly',
      anonId: 'install-1',
      granted: false,
      analytics: recorder,
      platform: 'web',
      now: DateTime.utc(2026, 8, 2),
    );
    expect(recorder.queuedCount, 0);
    expect(await store.containsKey(_queueKey), isFalse);
  });
}
