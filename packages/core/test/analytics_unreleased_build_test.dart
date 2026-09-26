import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-09-26 · PRODUCTION REFUSES A BUILD WITH NO OFFICIAL STAMP.
//
// The platform Worker now answers 422 `unreleased_build` to a row whose
// app_version is not a release lane's stamp (services/platform/src/lib/
// build-stamp.ts). Every other Err keeps the batch and the next log() re-sends
// it, which against THIS refusal is a POST per logged event for the life of
// the process: the stamp is compiled in, so the answer can never change.
//
// ⚠️ THE RECORDED FAILING CASE. Delete the `else if (r case Err<void>(failure:
// UnreleasedBuildFailure()))` limb from `AnalyticsRecorder.flush` and the first
// test fails (measured 2026-09-26): nothing latches, the queue is kept, and
// every log() past the batch size re-POSTs it.
// ─────────────────────────────────────────────────────────────────────────────

class _Transport implements EventTransport {
  _Transport(this.answer);

  Result<void> answer;
  int calls = 0;

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    calls++;
    return answer;
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

AnalyticsRecorder _recorder(
  ConsentController consent,
  EventTransport transport,
  KeyValueStore store,
) => AnalyticsRecorder(
  appId: 'subscriptiontracker',
  anonId: 'install-1',
  transport: transport,
  consent: consent,
  queueStore: store,
  batchSize: 2,
  // Timer off: every send in these tests is one the test can count.
  flushInterval: Duration.zero,
);

const String _queueKey = 'nikatru.analytics.queue';

void main() {
  test(
    'an unreleased-build refusal stops sending, drops the queue, and latches',
    () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final _Transport t = _Transport(
        const Result<void>.err(UnreleasedBuildFailure()),
      );
      final AnalyticsRecorder r = _recorder(await _granted(store), t, store);

      await r.log('first_launch');
      await r.log('app_open'); // batch size reached: the one POST
      expect(t.calls, 1);
      expect(r.refused, isTrue);
      expect(r.queuedCount, 0);
      expect(
        await store.read(_queueKey),
        isNull,
        reason: 'the persisted outbox goes too, or hydrate() re-sends it',
      );

      for (int i = 0; i < 30; i++) {
        await r.log('screen_view');
      }
      await r.flush();
      expect(t.calls, 1, reason: 'no retry loop on 422 unreleased_build');
      expect(r.queuedCount, 0);
      expect(r.hasPendingFlush, isFalse);
    },
  );

  test(
    'CONTROL: any other Err keeps the batch and the next log re-sends it',
    () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final _Transport t = _Transport(
        const Result<void>.err(Failure('offline')),
      );
      final AnalyticsRecorder r = _recorder(await _granted(store), t, store);

      await r.log('first_launch');
      await r.log('app_open');
      expect(t.calls, 1);
      expect(r.refused, isFalse);
      expect(r.queuedCount, 2);

      t.answer = const Result<void>.ok(null);
      await r.log('screen_view');
      expect(t.calls, 2, reason: 'a transient failure is still retried');
      expect(r.queuedCount, 1, reason: 'the two-event batch was delivered');
    },
  );
}
