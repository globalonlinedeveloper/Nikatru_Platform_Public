import 'result.dart';

/// Why a person is flagging something the app generated — the closed set
/// `POST /v1/report` accepts (`REPORT_REASONS` in
/// services/platform/src/routes/report.ts). O-PLAY-AI-CONTENT-REPORTING.
///
/// The wire names are the server's, spelled out once here, so a Dart rename of
/// a case cannot change what is sent.
enum ContentReportReason {
  offensive('offensive'),
  sexual('sexual'),
  violence('violence'),
  hate('hate'),
  selfHarm('self_harm'),
  dangerous('dangerous'),
  misinformation('misinformation'),
  other('other');

  const ContentReportReason(this.wire);

  /// The value `reason` carries on the wire.
  final String wire;
}

/// What the person is reporting. At least one of [contentRef] and
/// [contentExcerpt] must be non-empty: the host refuses a report that names
/// nothing (`nothing_reported`), because it cannot be acted on.
class ContentReport {
  const ContentReport({
    required this.reason,
    this.contentRef,
    this.contentExcerpt,
    this.note,
  });

  final ContentReportReason reason;

  /// The app's own id for the generated item, when it has one.
  final String? contentRef;

  /// The generated text itself, or the person's description of it.
  final String? contentExcerpt;

  /// Anything else the person wants to say.
  final String? note;

  /// Whether the host could act on this report at all.
  bool get namesSomething =>
      (contentRef?.trim().isNotEmpty ?? false) ||
      (contentExcerpt?.trim().isNotEmpty ?? false);
}

/// The host's answer: the report was RECEIVED (202), not yet reviewed.
class ContentReportReceipt {
  const ContentReportReceipt({required this.id});

  /// The row id support reads the report by.
  final String id;

  /// Null when the body is not a receipt: `ok` must be true and `id` a
  /// non-empty string. A half-understood answer must not read as "sent".
  static ContentReportReceipt? fromJson(Map<String, Object?> j) {
    final Object? id = j['id'];
    if (j['ok'] != true || id is! String || id.isEmpty) return null;
    return ContentReportReceipt(id: id);
  }
}

/// How the app tells US about AI-generated content from inside the app —
/// Google Play's AI-Generated Content policy asks for exactly this, "without
/// needing to exit the app", so a mailto: link or a web form does not satisfy it.
///
/// A seam in `core` beside [CancellationTransport] for the same reason: `core`
/// states the contract, the HTTP client lives in the adapter layer, and the
/// dialog is testable without a network.
abstract interface class ContentReportTransport {
  Future<Result<ContentReportReceipt>> submit({
    required String appId,
    required String? accessToken,
    required ContentReport report,
  });
}

/// The default for demo builds and tests: it cannot send, and says so. The
/// dialog shows that as "not sent", never as a report that went.
class UnavailableContentReportTransport implements ContentReportTransport {
  const UnavailableContentReportTransport();

  @override
  Future<Result<ContentReportReceipt>> submit({
    required String appId,
    required String? accessToken,
    required ContentReport report,
  }) async =>
      const Result<ContentReportReceipt>.err(
        Failure('content report transport unavailable in this build'),
      );
}
