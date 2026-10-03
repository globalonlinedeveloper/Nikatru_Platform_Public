import 'dart:convert';

import 'package:nikatru_core/nikatru_core.dart';

/// The store key the feedback queue lives under — its own queue, so a report
/// never waits behind (or blocks) the app's data writes.
const String kFeedbackOutboxKey = 'nikatru.feedback.outbox.v1';

/// The outbox entry kind of a report.
const String kFeedbackOutboxKind = 'feedback';

/// 🔴 OFFLINE-SAFE (lane feedback-intake, Do 4): every report goes through
/// core's [DurableOutbox] — persisted, user-scoped, replayed in order — and is
/// keyed by its idempotency key, which the Worker de-duplicates on. A report
/// made offline is kept and sent once when the device is back; a send whose
/// answer was lost is answered by the Worker with the first id, never stored
/// twice.
///
/// [owner] is the signed-in user's id, or `anonymous`: a signed-out report is
/// replayed only while signed out, and a signed-in one only for its owner,
/// with that owner's token.
class FeedbackOutbox {
  FeedbackOutbox({
    required Future<KeyValueStore> store,
    required FeedbackTransport transport,
    required Future<String?> Function() accessToken,
    DurableOutbox? outbox,
  }) : _transport = transport,
       _accessToken = accessToken,
       _outbox = outbox ?? DurableOutbox(store, key: kFeedbackOutboxKey);

  final FeedbackTransport _transport;
  final Future<String?> Function() _accessToken;
  final DurableOutbox _outbox;

  /// Queues [submission] for [owner] and tries to send everything [owner] has
  /// waiting. Returns what became of THIS report: sent (with its id), refused,
  /// or retry-later (it stays queued and goes with the next [flush]).
  Future<FeedbackSendResult> submit(
    FeedbackSubmission submission, {
    required String owner,
  }) async {
    await _outbox.enqueue(
      owner: owner,
      recordId: submission.idempotencyKey,
      op: OutboxOp.create,
      kind: kFeedbackOutboxKind,
      id: submission.idempotencyKey,
      body: <String, dynamic>{
        'report': submission.report,
        if (submission.screenshot != null)
          'screenshot': base64Encode(submission.screenshot!),
      },
    );
    final Map<String, FeedbackSendResult> results = await flush(owner: owner);
    return results[submission.idempotencyKey] ??
        const FeedbackSendResult.retryLater(error: 'queued');
  }

  /// Sends [owner]'s waiting reports, oldest first. Returns each attempted
  /// report's result by idempotency key. Call it when the device comes back
  /// online and at launch; concurrent calls share one run.
  Future<Map<String, FeedbackSendResult>> flush({required String owner}) async {
    final Map<String, FeedbackSendResult> results =
        <String, FeedbackSendResult>{};
    await _outbox.replay(
      owner: owner,
      currentOwner: () => owner,
      accepts: (OutboxEntry e) => e.kind == kFeedbackOutboxKind,
      send: (OutboxEntry e) async {
        final Object? shot = e.body['screenshot'];
        final FeedbackSendResult r = await _transport.submit(
          submission: FeedbackSubmission(
            report: Map<String, Object?>.from(e.body['report'] as Map),
            screenshot: shot is String ? base64Decode(shot) : null,
          ),
          accessToken: owner == kAnonymousOwner ? null : await _accessToken(),
        );
        results[e.id] = r;
        switch (r.kind) {
          case FeedbackSendKind.sent:
            return null;
          case FeedbackSendKind.retryLater:
            throw _NotSent(r);
          case FeedbackSendKind.refused:
            throw _NotSent(r);
        }
      },
      classify: (Object error) {
        if (error is! _NotSent) return OutboxFailure.transient;
        final FeedbackSendResult r = error.result;
        if (r.kind == FeedbackSendKind.refused) return OutboxFailure.refused;
        // No answer at all is "offline": it costs no attempt and stops the run.
        if ((r.error ?? '').startsWith('no_response'))
          return OutboxFailure.offline;
        return OutboxFailure.transient;
      },
      retryAfter: (Object error) =>
          error is _NotSent ? error.result.retryAfter : null,
    );
    return results;
  }

  /// [owner]'s reports still waiting (not yet sent and not dead).
  Future<int> waiting({required String owner}) async => (await _outbox.pending(
    owner: owner,
  )).where((OutboxEntry e) => e.kind == kFeedbackOutboxKind).length;
}

/// The owner a signed-out report is queued under.
const String kAnonymousOwner = 'anonymous';

class _NotSent implements Exception {
  const _NotSent(this.result);
  final FeedbackSendResult result;
}
