import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_feedback/nikatru_feedback.dart';

const FeedbackAppInfo testApp = FeedbackAppInfo(
  appId: 'demo',
  appVersion: '1.2.3',
  build: '45',
  channel: 'web',
  platform: 'web',
);

/// A transport that is "offline" (no answer) until [online], then stores each
/// idempotency key once and answers a replay with the first id, as the Worker does.
class FakeFeedbackTransport implements FeedbackTransport {
  bool online = true;
  int requests = 0;
  final Map<String, String> stored = <String, String>{};
  final List<FeedbackSubmission> received = <FeedbackSubmission>[];

  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async {
    if (!online)
      return const FeedbackSendResult.retryLater(
        error: 'no_response:connectionError',
      );
    requests++;
    received.add(submission);
    final String id = stored.putIfAbsent(
      submission.idempotencyKey,
      () => 'FB-${stored.length.toString().padLeft(10, '0')}',
    );
    return FeedbackSendResult.sent(id);
  }
}

FeedbackOutbox outboxOver(FeedbackTransport t, [KeyValueStore? store]) =>
    FeedbackOutbox(
      store: Future<KeyValueStore>.value(store ?? InMemoryKeyValueStore()),
      transport: t,
      accessToken: () async => null,
    );

FeedbackHost hostOver(
  FeedbackOutbox outbox, {
  bool signedIn = false,
  List<String> Function()? readLogs,
  List<Uri>? mails,
}) => FeedbackHost(
  app: testApp,
  outbox: outbox,
  owner: () => signedIn ? 'user-1' : kAnonymousOwner,
  signedIn: () => signedIn,
  supportEmail: 'support@example.test',
  openMail: (Uri u) async => mails?.add(u),
  errorCodes: () => <String>['StateError'],
  readLogs: readLogs,
);
