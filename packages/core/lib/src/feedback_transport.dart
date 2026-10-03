import 'dart:typed_data';

/// One "Report a problem" report, as the feedback Worker's
/// `POST /v1/feedback` takes it (services/platform/src/feedback/report.ts). Lane
/// feedback-intake.
///
/// [report] is the JSON the person saw in the preview, key for key: the
/// Worker refuses any key it does not know, so nothing can ride along that the
/// preview did not show. [screenshot] is the one PNG the person attached, with
/// the default blur already painted in (packages/feedback), or null.
class FeedbackSubmission {
  const FeedbackSubmission({required this.report, this.screenshot});

  final Map<String, Object?> report;
  final Uint8List? screenshot;

  /// The client-minted key the Worker de-duplicates on; also the outbox
  /// entry's id, so a replay after a lost answer is stored once.
  String get idempotencyKey => report['idempotencyKey']! as String;
}

/// What became of one send.
enum FeedbackSendKind {
  /// Stored (201) or already stored under this key (200 duplicate).
  sent,

  /// Not stored, and worth sending again later: no answer at all, a 5xx, a
  /// 503 while the intake is closed, or a 429.
  retryLater,

  /// Refused for what it is (any other 4xx). Sending it again changes nothing.
  refused,
}

/// The Worker's answer, reduced to what the sheet and the outbox act on.
class FeedbackSendResult {
  const FeedbackSendResult._(this.kind, {this.id, this.error, this.retryAfter});

  const FeedbackSendResult.sent(String id)
    : this._(FeedbackSendKind.sent, id: id);
  const FeedbackSendResult.retryLater({String? error, Duration? retryAfter})
    : this._(FeedbackSendKind.retryLater, error: error, retryAfter: retryAfter);
  const FeedbackSendResult.refused(String error)
    : this._(FeedbackSendKind.refused, error: error);

  final FeedbackSendKind kind;

  /// The report id the person is told (`FB-…`), when [kind] is sent.
  final String? id;

  /// The Worker's error word (`rate_limited`, `required`, …), never a body.
  final String? error;
  final Duration? retryAfter;
}

/// How a report reaches the private intake. A seam in `core` beside
/// [ContentReportTransport] for the same reason: core states the contract,
/// the HTTP client lives in the adapter layer (packages/api_client
/// `DioFeedbackTransport`), and the sheet is testable without a network.
///
/// [accessToken] is the signed-in session's bearer, or null: a signed-out
/// report is sent anonymously and the Worker holds it to a stricter limit.
abstract interface class FeedbackTransport {
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  });
}

/// The default for demo builds and tests: it cannot send, and says so as
/// "later" — the report waits in the outbox and the support mail is offered.
class UnavailableFeedbackTransport implements FeedbackTransport {
  const UnavailableFeedbackTransport();

  @override
  Future<FeedbackSendResult> submit({
    required FeedbackSubmission submission,
    required String? accessToken,
  }) async => const FeedbackSendResult.retryLater(error: 'unavailable');
}
