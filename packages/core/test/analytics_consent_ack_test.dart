import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

// ─────────────────────────────────────────────────────────────────────────────
// ⏱ 2026-10-01 · THE SERVER HOLDS THE ARTIFACT BEFORE IT HOLDS AN EVENT.
//
// The platform Worker now refuses a batch from an install whose analytics
// artifact it has no record of (409 `consent_not_recorded`) or whose latest
// artifact is a withdrawal (403 `consent_withdrawn`) —
// services/platform/src/routes/events.ts. The consent upload is best-effort and
// was never retried, so without the ordering below an install whose one consent
// POST was lost had its honest events refused for good.
//
// ⚠️ THE RECORDED FAILING CASES. Delete the `_ensureConsentAcknowledged()` call
// at the top of `AnalyticsRecorder.flush`'s try and the first test fails: the
// batch goes out before the artifact did. Delete the `ConsentWithdrawnFailure`
// limb and the 403 test fails: the queue is kept and re-sent.
// ─────────────────────────────────────────────────────────────────────────────

/// Records every batch; answers whatever [answer] currently is.
class _Events implements EventTransport {
  _Events(this.answer);

  Result<void> answer;
  final List<List<Map<String, Object?>>> sent = <List<Map<String, Object?>>>[];

  /// What [_Consent] had acknowledged at the moment each batch was sent.
  final List<int> consentCallsAtSend = <int>[];
  _Consent? consent;

  @override
  Future<Result<void>> send({
    required String appId,
    required String anonId,
    required Map<String, Object?> envelope,
    required List<Map<String, Object?>> events,
  }) async {
    sent.add(events);
    consentCallsAtSend.add(consent?.okCalls ?? -1);
    return answer;
  }
}

/// A consent transport whose answer the test controls.
class _Consent implements ConsentTransport {
  _Consent(this.answer);

  Result<void> answer;
  final List<ConsentArtifact> sent = <ConsentArtifact>[];
  int okCalls = 0;

  @override
  Future<Result<void>> send({
    required String appId,
    required ConsentArtifact artifact,
  }) async {
    sent.add(artifact);
    if (answer.isOk) okCalls++;
    return answer;
  }
}

Future<ConsentController> _granted(KeyValueStore store) async {
  final ConsentController c = ConsentController(store: store);
  await c.record(
    ConsentPurpose.analytics,
    granted: true,
    policyVersion: '2026-09-26',
    anonId: 'install-1',
    now: DateTime.utc(2026, 9, 26),
  );
  return c;
}

AnalyticsRecorder _recorder(
  ConsentController consent,
  EventTransport events,
  ConsentTransport consentTransport,
  KeyValueStore store,
) => AnalyticsRecorder(
  appId: 'subscriptiontracker',
  anonId: 'install-1',
  transport: events,
  consent: consent,
  consentTransport: consentTransport,
  queueStore: store,
  batchSize: 2,
  // Timer off: every send in these tests is one the test can count.
  flushInterval: Duration.zero,
);

const String _queueKey = 'nikatru.analytics.queue';
const Result<void> _ok = Result<void>.ok(null);

void main() {
  group('no batch leaves before the artifact is acknowledged', () {
    test(
      '🔴 a flush before the consent ack sends NOTHING, and keeps the queue',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(_ok);
        final _Consent consent = _Consent(
          const Result<void>.err(Failure('offline')),
        );
        final AnalyticsRecorder r = _recorder(
          await _granted(store),
          events,
          consent,
          store,
        );

        await r.log('first_launch');
        await r.log('app_open'); // batch size reached
        await r.flush();
        expect(
          events.sent,
          isEmpty,
          reason: 'the server holds no artifact, so it would refuse the batch',
        );
        expect(
          consent.sent,
          hasLength(2),
          reason: 'each flush posts the artifact itself until it lands',
        );
        expect(r.queuedCount, 2);
        expect(
          await store.read(_queueKey),
          isNotNull,
          reason: 'kept, not dropped: these events were collected with consent',
        );
      },
    );

    test(
      'once the artifact lands, the SAME batch follows it — artifact first',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(_ok);
        final _Consent consent = _Consent(
          const Result<void>.err(Failure('offline')),
        );
        events.consent = consent;
        final ConsentController controller = await _granted(store);
        final AnalyticsRecorder r = _recorder(
          controller,
          events,
          consent,
          store,
        );

        await r.log('first_launch');
        await r.log('app_open');
        expect(events.sent, isEmpty);

        consent.answer = _ok;
        await r.flush();
        expect(events.sent, hasLength(1));
        expect(
          events.consentCallsAtSend.single,
          1,
          reason: 'the artifact was acknowledged BEFORE the batch was sent',
        );
        expect(
          consent.sent.last.consentId,
          controller.artifactOf(ConsentPurpose.analytics)!.consentId,
          reason: 'the artifact AS RECORDED is posted, never a fresh one',
        );
        expect(r.queuedCount, 0);
        expect(controller.isAcknowledged(ConsentPurpose.analytics), isTrue);
      },
    );

    test('an acknowledged artifact is not posted again', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final _Events events = _Events(_ok);
      final _Consent consent = _Consent(_ok);
      final ConsentController controller = await _granted(store);
      await controller.acknowledge(
        controller.artifactOf(ConsentPurpose.analytics)!,
      );
      final AnalyticsRecorder r = _recorder(controller, events, consent, store);

      await r.log('first_launch');
      await r.log('app_open');
      expect(events.sent, hasLength(1));
      expect(consent.sent, isEmpty);
    });

    test(
      'the acknowledgement survives a restart, and a NEW decision clears it',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final ConsentController first = await _granted(store);
        final ConsentArtifact a = first.artifactOf(ConsentPurpose.analytics)!;
        expect(first.isAcknowledged(ConsentPurpose.analytics), isFalse);
        await first.acknowledge(a);

        final ConsentController second = ConsentController(store: store);
        await second.hydrate(ConsentPurpose.analytics);
        expect(second.isAcknowledged(ConsentPurpose.analytics), isTrue);

        // A re-decision is a new artifact the server has not seen yet.
        await second.record(
          ConsentPurpose.analytics,
          granted: true,
          policyVersion: '2026-09-26',
          anonId: 'install-1',
          now: DateTime.utc(2026, 9, 27),
        );
        expect(second.isAcknowledged(ConsentPurpose.analytics), isFalse);
      },
    );

    test(
      'a decision recorded while the POST was in flight stays unacknowledged',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final ConsentController c = await _granted(store);
        final ConsentArtifact sentOne = c.artifactOf(ConsentPurpose.analytics)!;
        await c.record(
          ConsentPurpose.analytics,
          granted: false,
          policyVersion: '2026-09-26',
          anonId: 'install-1',
          now: DateTime.utc(2026, 9, 27),
        );
        await c.acknowledge(sentOne);
        expect(c.isAcknowledged(ConsentPurpose.analytics), isFalse);
      },
    );

    test(
      'a recorder never posts a WITHDRAWAL or a missing artifact on anyone\'s behalf',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final ConsentController c = ConsentController(store: store);
        final _Consent consent = _Consent(_ok);
        final _Events events = _Events(_ok);
        final AnalyticsRecorder r = _recorder(c, events, consent, store);
        await r.log('first_launch'); // unknown: discarded
        await r.flush();
        expect(consent.sent, isEmpty);
        expect(events.sent, isEmpty);
      },
    );
  });

  group('the server\'s two consent refusals', () {
    test(
      '🔴 403 consent_withdrawn EMPTIES the queue, in memory and on disk',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(
          const Result<void>.err(ConsentWithdrawnFailure()),
        );
        final _Consent consent = _Consent(_ok);
        final AnalyticsRecorder r = _recorder(
          await _granted(store),
          events,
          consent,
          store,
        );

        await r.log('first_launch');
        await r.log('app_open');
        expect(events.sent, hasLength(1));
        expect(r.queuedCount, 0);
        expect(
          await store.read(_queueKey),
          isNull,
          reason: 'or hydrate() restores the batch and re-sends it',
        );
        expect(
          r.refused,
          isFalse,
          reason: 'not latched: a later grant is a new artifact',
        );

        // Nothing kept means nothing re-sent.
        await r.flush();
        expect(events.sent, hasLength(1));
      },
    );

    test(
      '409 consent_not_recorded KEEPS the queue and re-posts the artifact first',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(
          const Result<void>.err(ConsentNotRecordedFailure()),
        );
        final _Consent consent = _Consent(_ok);
        final ConsentController controller = await _granted(store);
        final AnalyticsRecorder r = _recorder(
          controller,
          events,
          consent,
          store,
        );

        await r.log('first_launch');
        await r.log('app_open'); // ack (POST 1), send → 409, re-ack (POST 2)
        expect(events.sent, hasLength(1));
        expect(
          consent.sent,
          hasLength(2),
          reason: 'the 409 forgot the acknowledgement and posted again',
        );
        expect(r.queuedCount, 2, reason: 'a 409 never costs consented events');
        expect(controller.isAcknowledged(ConsentPurpose.analytics), isTrue);

        events.answer = _ok;
        await r.flush();
        expect(events.sent, hasLength(2));
        expect(events.sent.last, hasLength(2), reason: 'the SAME two events');
        expect(r.queuedCount, 0);
      },
    );

    test(
      'a 409 FOREVER after repairs that land: bounded, backed off, and said',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(
          const Result<void>.err(ConsentNotRecordedFailure()),
        );
        final _Consent consent = _Consent(_ok);
        final ConsentController controller = await _granted(store);
        // The timer ON, short: the unbounded loop was the timer's re-arm.
        final AnalyticsRecorder r = AnalyticsRecorder(
          appId: 'subscriptiontracker',
          anonId: 'install-1',
          transport: events,
          consent: controller,
          consentTransport: consent,
          queueStore: store,
          batchSize: 2,
          flushInterval: const Duration(milliseconds: 5),
        );
        addTearDown(r.dispose);

        await r.log('first_launch');
        await r.log('app_open');
        // 5 + 10 + 20 ms of backoff, then far longer than an unbounded loop
        // would need to post dozens of times.
        await Future<void>.delayed(const Duration(milliseconds: 400));

        // One send, then one per landed repair; the repair after the last
        // send is the one the bound refuses.
        expect(events.sent, hasLength(1 + kMaxConsentRepairs));
        expect(consent.sent, hasLength(1 + kMaxConsentRepairs));
        expect(r.hasPendingFlush, isFalse, reason: 'nothing is re-armed');
        expect(r.queuedCount, 2, reason: 'a 409 never costs consented events');
        final ConsentRepairExhaustedFailure? f = r.consentRepairFailure;
        expect(f, isNotNull, reason: 'the stop is reported, not silent');
        expect(f!.attempts, kMaxConsentRepairs);
        expect(
          f.consentId,
          controller.artifactOf(ConsentPurpose.analytics)!.consentId,
        );

        // A later log() under the same artifact sends nothing more.
        await r.log('settings_open');
        await r.flush();
        await Future<void>.delayed(const Duration(milliseconds: 50));
        expect(events.sent, hasLength(1 + kMaxConsentRepairs));

        // A NEW decision is a new artifact: the bound starts over.
        await controller.record(
          ConsentPurpose.analytics,
          granted: true,
          policyVersion: '2026-10-02',
          anonId: 'install-1',
          now: DateTime.utc(2026, 10, 2),
        );
        expect(r.consentRepairFailure, isNull);
        events.answer = _ok;
        await r.flush();
        expect(events.sent, hasLength(2 + kMaxConsentRepairs));
        expect(r.queuedCount, 1, reason: 'one batch of two went');
      },
    );

    test(
      'CONTROL: any other Err keeps the batch and does not touch the ack',
      () async {
        final InMemoryKeyValueStore store = InMemoryKeyValueStore();
        final _Events events = _Events(const Result<void>.err(Failure('503')));
        final _Consent consent = _Consent(_ok);
        final ConsentController controller = await _granted(store);
        final AnalyticsRecorder r = _recorder(
          controller,
          events,
          consent,
          store,
        );

        await r.log('first_launch');
        await r.log('app_open');
        expect(r.queuedCount, 2);
        expect(consent.sent, hasLength(1));
        expect(controller.isAcknowledged(ConsentPurpose.analytics), isTrue);
      },
    );
  });
}
