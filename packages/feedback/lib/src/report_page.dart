import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show FeedbackSendKind, FeedbackSendResult, FeedbackSubmission, newOutboxId;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing;

import 'capture.dart';
import 'l10n/feedback_strings.g.dart';
import 'markup_editor.dart';
import 'outbox.dart';
import 'report.dart';

/// Keys a test finds the page's controls by.
abstract final class FeedbackKeys {
  static const Key category = Key('feedback.category');
  static const Key description = Key('feedback.description');
  static const Key steps = Key('feedback.steps');
  static const Key attach = Key('feedback.attach');
  static const Key markup = Key('feedback.markup');
  static const Key logs = Key('feedback.logs');
  static const Key reply = Key('feedback.reply');
  static const Key notify = Key('feedback.notify');
  static const Key email = Key('feedback.email');
  static const Key preview = Key('feedback.preview');
  static const Key send = Key('feedback.send');
  static const Key result = Key('feedback.result');
  static const Key emailSupport = Key('feedback.emailSupport');
}

/// Everything the page needs from the app, read when it opens. The app (and
/// the brick) builds ONE of these over its own providers.
class FeedbackHost {
  const FeedbackHost({
    required this.app,
    required this.outbox,
    required this.owner,
    required this.signedIn,
    required this.supportEmail,
    required this.openMail,
    this.errorCodes,
    this.crashEventId,
    this.readLogs,
    this.boundaryKey,
  });

  final FeedbackAppInfo app;
  final FeedbackOutbox outbox;

  /// The signed-in user's id, or [kAnonymousOwner].
  final String Function() owner;
  final bool Function() signedIn;

  /// The support mail, offered when a report cannot be sent.
  final String supportEmail;
  final Future<void> Function(Uri mail) openMail;

  /// The telemetry ring's recent error CODES (packages/telemetry
  /// `RecentActivity`); null sends none.
  final List<String> Function()? errorCodes;

  /// The last crash's event id; non-null only where crash reporting is on.
  final String? Function()? crashEventId;

  /// The opt-in logs, already scrubbed (`RecentActivity.breadcrumbs`); null
  /// hides the logs box altogether.
  final List<String> Function()? readLogs;

  /// The key of the root boundary the screenshot is taken from, when the app
  /// mounts its own rather than design_system's ScreenCaptureBoundary.
  final Key? boundaryKey;
}

/// The words of the "Report a problem" row, in [context]'s locale.
String reportProblemLabelOf(BuildContext context) =>
    FeedbackStrings.of(Localizations.localeOf(context)).reportProblem;

/// Captures the current screen (redaction rectangles found BEFORE the page
/// opens over it), then opens the report page. [initialDescription] and
/// [category] pre-fill it — the help centre's "Still stuck? Ask us" passes the
/// search text and [FeedbackCategory.question].
Future<void> openReportProblem(
  BuildContext context,
  FeedbackHost host, {
  String initialDescription = '',
  FeedbackCategory category = FeedbackCategory.bug,
  Key? boundaryKey,
}) async {
  final double ratio = MediaQuery.devicePixelRatioOf(
    context,
  ).clamp(1, 2).toDouble();
  final FeedbackShot? shot = await captureScreen(
    boundaryKey: boundaryKey,
    pixelRatio: ratio,
  );
  if (!context.mounted) return;
  await Navigator.of(context).push<void>(
    MaterialPageRoute<void>(
      builder: (_) => ReportProblemPage(
        host: host,
        shot: shot,
        initialDescription: initialDescription,
        initialCategory: category,
      ),
    ),
  );
}

/// The "Report a problem" page (lane feedback-intake, Do 1–4 and 10).
class ReportProblemPage extends StatefulWidget {
  const ReportProblemPage({
    super.key,
    required this.host,
    this.shot,
    this.initialDescription = '',
    this.initialCategory = FeedbackCategory.bug,
  });

  final FeedbackHost host;
  final FeedbackShot? shot;
  final String initialDescription;
  final FeedbackCategory initialCategory;

  @override
  State<ReportProblemPage> createState() => _ReportProblemPageState();
}

class _ReportProblemPageState extends State<ReportProblemPage> {
  late final TextEditingController _description = TextEditingController(
    text: widget.initialDescription,
  );
  final TextEditingController _steps = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final Stopwatch _open = Stopwatch()..start();
  final String _key = newOutboxId();
  late FeedbackCategory _category = widget.initialCategory;
  bool _attach = false;
  bool _logs = false;
  bool _reply = false;
  bool _notify = false;
  bool _sending = false;
  List<MarkupOp> _ops = <MarkupOp>[];
  FeedbackSendResult? _result;

  @override
  void initState() {
    super.initState();
    _description.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _description.dispose();
    _steps.dispose();
    _email.dispose();
    super.dispose();
  }

  FeedbackDiagnostics _diagnostics(BuildContext context) =>
      FeedbackDiagnostics.of(
        context,
        app: widget.host.app,
        errorCodes: widget.host.errorCodes?.call() ?? const <String>[],
        crashEventId: widget.host.crashEventId?.call(),
        logs: _logs ? widget.host.readLogs?.call() : null,
      );

  Map<String, Object?> _report(BuildContext context) => buildReport(
    idempotencyKey: _key,
    category: _category,
    description: _description.text,
    steps: _steps.text,
    diagnostics: _diagnostics(context),
    reply: _reply,
    notifyFixed: _notify,
    contactEmail: widget.host.signedIn() ? '' : _email.text,
    elapsedMs: _open.elapsedMilliseconds,
  );

  Future<void> _send() async {
    setState(() => _sending = true);
    final MarkupColors colors = MarkupColors.of(Theme.of(context));
    final Map<String, Object?> report = _report(context);
    Uint8List? png;
    final FeedbackShot? shot = widget.shot;
    if (_attach && shot != null) {
      final ui.Image out = await renderShot(shot, _ops, colors);
      png = await pngBytes(out);
    }
    final FeedbackSendResult r = await widget.host.outbox.submit(
      FeedbackSubmission(report: report, screenshot: png),
      owner: widget.host.owner(),
    );
    if (!mounted) return;
    setState(() {
      _sending = false;
      _result = r;
    });
  }

  String _categoryLabel(FeedbackStrings s, FeedbackCategory c) => switch (c) {
    FeedbackCategory.bug => s.categoryBug,
    FeedbackCategory.crash => s.categoryCrash,
    FeedbackCategory.billing => s.categoryBilling,
    FeedbackCategory.accessibility => s.categoryAccessibility,
    FeedbackCategory.translation => s.categoryTranslation,
    FeedbackCategory.question => s.categoryQuestion,
    FeedbackCategory.other => s.categoryOther,
  };

  Widget _resultView(FeedbackStrings s, FeedbackSendResult r) {
    final String text = switch (r.kind) {
      FeedbackSendKind.sent => s.sentBody(r.id ?? ''),
      FeedbackSendKind.retryLater => s.queuedBody,
      FeedbackSendKind.refused => s.refusedBody,
    };
    return Column(
      key: FeedbackKeys.result,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(liveRegion: true, child: Text(text)),
        const SizedBox(height: AppSpacing.lg),
        if (r.kind != FeedbackSendKind.sent)
          OutlinedButton(
            key: FeedbackKeys.emailSupport,
            onPressed: () => widget.host.openMail(
              Uri(
                scheme: 'mailto',
                path: widget.host.supportEmail,
                queryParameters: <String, String>{'subject': s.reportProblem},
              ),
            ),
            child: Text(s.emailSupport),
          ),
        const SizedBox(height: AppSpacing.sm),
        FilledButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: Text(s.close),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final FeedbackStrings s = FeedbackStrings.of(
      Localizations.localeOf(context),
    );
    final FeedbackShot? shot = widget.shot;
    final FeedbackSendResult? result = _result;
    final bool canSend = canSubmitReport(_description.text) && !_sending;
    return Scaffold(
      appBar: AppBar(title: Text(s.reportProblem)),
      body: SafeArea(
        // A scroll view over ONE column, not a lazy ListView: every control is
        // built, so a screen reader and a test reach the Send button at the end.
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: result != null
                ? <Widget>[_resultView(s, result)]
                : <Widget>[
                    DropdownButtonFormField<FeedbackCategory>(
                      key: FeedbackKeys.category,
                      initialValue: _category,
                      decoration: InputDecoration(labelText: s.categoryLabel),
                      items: <DropdownMenuItem<FeedbackCategory>>[
                        for (final FeedbackCategory c
                            in FeedbackCategory.values)
                          DropdownMenuItem<FeedbackCategory>(
                            value: c,
                            child: Text(_categoryLabel(s, c)),
                          ),
                      ],
                      onChanged: (FeedbackCategory? c) =>
                          setState(() => _category = c ?? _category),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    TextField(
                      key: FeedbackKeys.description,
                      controller: _description,
                      minLines: 3,
                      maxLines: 8,
                      maxLength: 4000,
                      decoration: InputDecoration(
                        labelText: s.descriptionLabel,
                        helperText: canSubmitReport(_description.text)
                            ? null
                            : s.descriptionRequired,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.sm),
                    TextField(
                      key: FeedbackKeys.steps,
                      controller: _steps,
                      minLines: 2,
                      maxLines: 6,
                      maxLength: 4000,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(labelText: s.stepsLabel),
                    ),
                    if (shot != null) ...<Widget>[
                      SwitchListTile(
                        key: FeedbackKeys.attach,
                        contentPadding: EdgeInsets.zero,
                        value: _attach,
                        title: Text(s.attachScreenshot),
                        subtitle: Text(s.screenshotBlurNote),
                        onChanged: (bool v) => setState(() => _attach = v),
                      ),
                      if (_attach) ...<Widget>[
                        Center(
                          child: ShotPreview(
                            shot: shot,
                            ops: _ops,
                            height: 200,
                          ),
                        ),
                        TextButton(
                          key: FeedbackKeys.markup,
                          onPressed: () async {
                            final List<MarkupOp>? ops =
                                await Navigator.of(
                                  context,
                                ).push<List<MarkupOp>>(
                                  MaterialPageRoute<List<MarkupOp>>(
                                    builder: (_) => MarkupEditorPage(
                                      shot: shot,
                                      initial: _ops,
                                    ),
                                  ),
                                );
                            if (ops != null && mounted)
                              setState(() => _ops = ops);
                          },
                          child: Text(s.markupScreenshot),
                        ),
                      ],
                    ],
                    if (widget.host.readLogs != null)
                      CheckboxListTile(
                        key: FeedbackKeys.logs,
                        contentPadding: EdgeInsets.zero,
                        value: _logs,
                        title: Text(s.includeLogs),
                        onChanged: (bool? v) =>
                            setState(() => _logs = v ?? false),
                      ),
                    CheckboxListTile(
                      key: FeedbackKeys.reply,
                      contentPadding: EdgeInsets.zero,
                      value: _reply,
                      title: Text(s.replyConsent),
                      onChanged: (bool? v) =>
                          setState(() => _reply = v ?? false),
                    ),
                    if (_reply && !widget.host.signedIn())
                      TextField(
                        key: FeedbackKeys.email,
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const <String>[AutofillHints.email],
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: s.contactEmailLabel,
                        ),
                      ),
                    CheckboxListTile(
                      key: FeedbackKeys.notify,
                      contentPadding: EdgeInsets.zero,
                      value: _notify,
                      title: Text(s.notifyConsent),
                      onChanged: (bool? v) =>
                          setState(() => _notify = v ?? false),
                    ),
                    ExpansionTile(
                      key: FeedbackKeys.preview,
                      tilePadding: EdgeInsets.zero,
                      title: Text(s.previewTitle),
                      children: <Widget>[
                        SelectableText(
                          const JsonEncoder.withIndent(
                            '  ',
                          ).convert(_report(context)),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      key: FeedbackKeys.send,
                      onPressed: canSend ? _send : null,
                      child: Text(_sending ? s.sending : s.send),
                    ),
                  ],
          ),
        ),
      ),
    );
  }
}
