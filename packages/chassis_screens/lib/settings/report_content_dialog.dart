import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The in-app report for AI-generated content — O-PLAY-AI-CONTENT-REPORTING.
///
/// Google Play, AI-Generated Content (answer/13985936): an app that generates
/// content with AI "must contain in-app user reporting or flagging features that
/// allow users to report or flag offensive content to developers without needing
/// to exit the app". This dialog is the "without needing to exit the app" half;
/// `POST /v1/report` on the platform Worker is the "to developers" half.
///
/// Two ways in, one dialog:
///   · from a generated item — the app passes [contentRef] (and may prefill
///     [initialExcerpt]); the excerpt is then optional;
///   · from Settings, with nothing attached — the person describes or pastes
///     what was generated, and the send button stays inert until they have,
///     because the host refuses a report that names nothing.
///
/// Like `DestructiveConfirmDialog`, the outcome is a SECOND PHASE of the dialog
/// rather than a SnackBar: "sent" and "not sent" are different facts, and the
/// person should read which one happened where they asked.
///
/// The network call is [onSubmit], a callback: this package declares no
/// Riverpod and no HTTP client (see its pubspec), so the transport stays in the
/// brick adapter.
class ReportContentDialog extends StatefulWidget {
  const ReportContentDialog({
    required this.onSubmit,
    this.contentRef,
    this.initialExcerpt,
    super.key,
  });

  static const Key excerptField = Key('reportContentExcerpt');
  static const Key noteField = Key('reportContentNote');
  static const Key submitButton = Key('reportContentSubmit');
  static const Key resultText = Key('reportContentResult');

  /// The key on the radio row for [reason] — so a test can pick one.
  static Key reasonKey(ContentReportReason reason) =>
      Key('reportContentReason.${reason.wire}');

  /// Sends the report. It must not throw: report every failure as an `Err`,
  /// which the dialog shows as "not sent".
  final Future<Result<ContentReportReceipt>> Function(ContentReport report)
      onSubmit;

  /// The app's own id for the generated item, when the report starts from one.
  final String? contentRef;

  /// The generated text, prefilled when the report starts from an item.
  final String? initialExcerpt;

  @override
  State<ReportContentDialog> createState() => _ReportContentDialogState();
}

class _ReportContentDialogState extends State<ReportContentDialog> {
  late final TextEditingController _excerpt = TextEditingController(
    text: widget.initialExcerpt ?? '',
  );
  final TextEditingController _note = TextEditingController();
  ContentReportReason? _reason;
  bool _busy = false;
  bool? _sent;

  bool get _hasRef => widget.contentRef?.trim().isNotEmpty ?? false;

  @override
  void dispose() {
    _excerpt.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _submit(ContentReportReason reason) async {
    setState(() => _busy = true);
    final Result<ContentReportReceipt> result = await widget.onSubmit(
      ContentReport(
        reason: reason,
        contentRef: widget.contentRef,
        contentExcerpt: _excerpt.text,
        note: _note.text,
      ),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _sent = result.isOk;
    });
  }

  static String _label(ChassisLocalizations l10n, ContentReportReason r) =>
      switch (r) {
        ContentReportReason.offensive => l10n.reportReasonOffensive,
        ContentReportReason.sexual => l10n.reportReasonSexual,
        ContentReportReason.violence => l10n.reportReasonViolence,
        ContentReportReason.hate => l10n.reportReasonHate,
        ContentReportReason.selfHarm => l10n.reportReasonSelfHarm,
        ContentReportReason.dangerous => l10n.reportReasonDangerous,
        ContentReportReason.misinformation => l10n.reportReasonMisinformation,
        ContentReportReason.other => l10n.reportReasonOther,
      };

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final bool? sent = _sent;
    if (sent != null) {
      return AlertDialog(
        title: Text(l10n.reportContent),
        content: Text(
          sent ? l10n.reportSent : l10n.reportFailed,
          key: ReportContentDialog.resultText,
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.reportDone),
          ),
        ],
      );
    }
    // Nothing may dismiss the dialog mid-send: a back gesture would read as a
    // cancelled report while the request carries on.
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(l10n.reportContent),
        scrollable: true,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(l10n.reportContentBody),
            const SizedBox(height: 12),
            Text(
              l10n.reportReasonLabel,
              style: Theme.of(context).textTheme.labelLarge,
            ),
            RadioGroup<ContentReportReason>(
              groupValue: _reason,
              onChanged: (ContentReportReason? r) {
                if (_busy) return;
                setState(() => _reason = r);
              },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  for (final ContentReportReason r
                      in ContentReportReason.values)
                    RadioListTile<ContentReportReason>(
                      key: ReportContentDialog.reasonKey(r),
                      value: r,
                      contentPadding: EdgeInsets.zero,
                      title: Text(_label(l10n, r)),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              key: ReportContentDialog.excerptField,
              controller: _excerpt,
              enabled: !_busy,
              minLines: 1,
              maxLines: 4,
              maxLength: 2000,
              decoration: InputDecoration(labelText: l10n.reportExcerptLabel),
            ),
            TextField(
              key: ReportContentDialog.noteField,
              controller: _note,
              enabled: !_busy,
              minLines: 1,
              maxLines: 3,
              maxLength: 1000,
              decoration: InputDecoration(labelText: l10n.reportNoteLabel),
            ),
          ],
        ),
        actions: <Widget>[
          TextButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            child: Text(l10n.cancel),
          ),
          // Inert until there is a reason AND something to act on — an attached
          // item or a described one. `ValueListenableBuilder` so a paste or an
          // autofill enables it too.
          ValueListenableBuilder<TextEditingValue>(
            valueListenable: _excerpt,
            builder: (BuildContext context, TextEditingValue value, Widget? _) {
              final ContentReportReason? reason = _reason;
              final bool ready = !_busy &&
                  reason != null &&
                  (_hasRef || value.text.trim().isNotEmpty);
              return FilledButton(
                key: ReportContentDialog.submitButton,
                onPressed: ready ? () => _submit(reason) : null,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (_busy) ...<Widget>[
                      const SizedBox(
                        height: 14,
                        width: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                      const SizedBox(width: 8),
                    ],
                    Text(l10n.reportSubmit),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
