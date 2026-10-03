import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

import 'support.dart';

FeedbackSubmission _report(String key) => FeedbackSubmission(
  report: <String, Object?>{'idempotencyKey': key, 'description': 'broken'},
);

void main() {
  test(
    '🔴 [Do 4] an offline submit followed by reconnect sends exactly ONE request, under its idempotency key',
    () async {
      final FakeFeedbackTransport t = FakeFeedbackTransport()..online = false;
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final FeedbackOutbox outbox = outboxOver(t, store);

      final FeedbackSendResult first = await outbox.submit(
        _report('key-offline-1'),
        owner: kAnonymousOwner,
      );
      expect(first.kind, FeedbackSendKind.retryLater);
      expect(t.requests, 0, reason: 'nothing reached the server while offline');
      expect(await outbox.waiting(owner: kAnonymousOwner), 1);

      // A restart: a NEW outbox over the same store still has the report.
      final FeedbackOutbox afterRestart = outboxOver(t, store);
      t.online = true;
      final Map<String, FeedbackSendResult> flushed = await afterRestart.flush(
        owner: kAnonymousOwner,
      );
      expect(flushed['key-offline-1']?.kind, FeedbackSendKind.sent);
      await afterRestart.flush(owner: kAnonymousOwner);
      await afterRestart.flush(owner: kAnonymousOwner);
      expect(t.requests, 1);
      expect(t.received.single.idempotencyKey, 'key-offline-1');
      expect(await afterRestart.waiting(owner: kAnonymousOwner), 0);
    },
  );

  test(
    'a signed-in owner never replays an anonymous report, and the other way round',
    () async {
      final FakeFeedbackTransport t = FakeFeedbackTransport()..online = false;
      final FeedbackOutbox outbox = outboxOver(t);
      await outbox.submit(_report('key-anon'), owner: kAnonymousOwner);
      t.online = true;
      await outbox.flush(owner: 'user-1');
      expect(t.requests, 0);
      await outbox.flush(owner: kAnonymousOwner);
      expect(t.requests, 1);
    },
  );

  test('a refused report is not retried', () async {
    final _Refusing t = _Refusing();
    final FeedbackOutbox outbox = outboxOver(t);
    final FeedbackSendResult r = await outbox.submit(
      _report('key-refused'),
      owner: kAnonymousOwner,
    );
    expect(r.kind, FeedbackSendKind.refused);
    await outbox.flush(owner: kAnonymousOwner);
    expect(t.calls, 1);
  });
}

class _Refusing implements FeedbackTransport {
  int calls = 0;
  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async {
    calls++;
    return const FeedbackSendResult.refused('required');
  }
}
