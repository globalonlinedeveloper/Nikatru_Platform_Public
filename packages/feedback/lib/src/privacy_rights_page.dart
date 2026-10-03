import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show
        ExportFile,
        ExportOutcome,
        FeedbackSendKind,
        FeedbackSendResult,
        FeedbackSubmission,
        FileExporter,
        Ok,
        PrivacyDataTransport,
        PrivacyNominee,
        Result,
        newOutboxId;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing;

import 'l10n/feedback_strings.g.dart';
import 'report_page.dart' show FeedbackHost;

// ─────────────────────────────────────────────────────────────────────────────
// "Your privacy rights" (lane dpdp-rights, Do 1–4): the one screen every app and
// the brick open from Settings › Privacy and data, next to the account deletion.
//
// It RIDES THE PRIVATE INTAKE: a request is a `kind: "privacy-request"` body on
// the same outbox and the same POST /v1/feedback a problem report uses, so it is
// kept offline and sent once. What can be done AT ONCE is done at once instead of
// filed: a signed-in person downloads their data (GET /v1/account/export), names
// a nominee (PUT /v1/account/nominee) and deletes their account (the app's own
// deletion). Signed out, every type is a request that names an address, which the
// server proves with an e-mailed link before anyone acts on it.
// ─────────────────────────────────────────────────────────────────────────────

/// The rights a person can exercise — the server's `REQUEST_TYPES`
/// (services/platform/src/feedback/privacy.ts), in the order the screen lists them.
enum PrivacyRight {
  access('access'),
  correction('correction'),
  erasure('erasure'),
  nomination('nomination'),
  grievance('grievance'),
  withdrawConsent('withdraw-consent');

  const PrivacyRight(this.wire);

  /// The `requestType` the server reads.
  final String wire;

  /// A correction or a grievance must say what is wrong; the server refuses
  /// one without (422 `required`).
  bool get needsDetails =>
      this == PrivacyRight.correction || this == PrivacyRight.grievance;
}

/// The screen's keys, so a test finds a CONTROL and not a string.
abstract final class PrivacyRightsKeys {
  static Key tile(PrivacyRight r) => Key('privacyRights.tile.${r.wire}');
  static const Key details = Key('privacyRights.details');
  static const Key email = Key('privacyRights.email');
  static const Key send = Key('privacyRights.send');
  static const Key result = Key('privacyRights.result');
  static const Key download = Key('privacyRights.download');
  static const Key nomineeName = Key('privacyRights.nomineeName');
  static const Key nomineeEmail = Key('privacyRights.nomineeEmail');
  static const Key nomineeSave = Key('privacyRights.nomineeSave');
  static const Key nomineeRemove = Key('privacyRights.nomineeRemove');
  static const Key deleteAccount = Key('privacyRights.deleteAccount');
  static const Key board = Key('privacyRights.board');
}

/// Everything the screen needs from the app, built ONCE over its providers.
class PrivacyRightsHost {
  const PrivacyRightsHost({
    required this.feedback,
    required this.data,
    required this.accessToken,
    required this.exporter,
    required this.openDeleteAccount,
  });

  /// The "Report a problem" host: its outbox, app identity and session.
  final FeedbackHost feedback;

  /// The export and the nominee (core's seam; the dio client in the app).
  final PrivacyDataTransport data;
  final Future<String?> Function() accessToken;

  /// Where the export file goes: the same seam the app's CSV export uses.
  final FileExporter exporter;

  /// The app's own "Delete account" flow.
  final Future<void> Function() openDeleteAccount;
}

/// The words of the Settings row, in [context]'s locale.
String privacyRightsLabelOf(BuildContext context) =>
    FeedbackStrings.of(Localizations.localeOf(context)).privacyRights;

/// Opens "Your privacy rights".
Future<void> openPrivacyRights(BuildContext context, PrivacyRightsHost host) =>
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(builder: (_) => PrivacyRightsPage(host: host)),
    );

/// The value of an [Ok], or null.
T? _ok<T>(Result<T> r) => r is Ok<T> ? r.value : null;

String _rightLabel(FeedbackStrings s, PrivacyRight r) => switch (r) {
  PrivacyRight.access => s.rightAccess,
  PrivacyRight.correction => s.rightCorrection,
  PrivacyRight.erasure => s.rightErasure,
  PrivacyRight.nomination => s.rightNomination,
  PrivacyRight.grievance => s.rightGrievance,
  PrivacyRight.withdrawConsent => s.rightWithdraw,
};

/// The list of rights; each opens its own page.
class PrivacyRightsPage extends StatelessWidget {
  const PrivacyRightsPage({super.key, required this.host});

  final PrivacyRightsHost host;

  @override
  Widget build(BuildContext context) {
    final FeedbackStrings s = FeedbackStrings.of(
      Localizations.localeOf(context),
    );
    return Scaffold(
      appBar: AppBar(title: Text(s.privacyRights)),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(s.privacyRightsIntro),
              const SizedBox(height: AppSpacing.lg),
              for (final PrivacyRight r in PrivacyRight.values)
                ListTile(
                  key: PrivacyRightsKeys.tile(r),
                  contentPadding: EdgeInsets.zero,
                  title: Text(_rightLabel(s, r)),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push<void>(
                    MaterialPageRoute<void>(
                      builder: (_) => PrivacyRightPage(host: host, right: r),
                    ),
                  ),
                ),
              const SizedBox(height: AppSpacing.lg),
              Text(s.complainBoard, key: PrivacyRightsKeys.board),
            ],
          ),
        ),
      ),
    );
  }
}

/// One right: what can be done at once, then the request form.
class PrivacyRightPage extends StatefulWidget {
  const PrivacyRightPage({super.key, required this.host, required this.right});

  final PrivacyRightsHost host;
  final PrivacyRight right;

  @override
  State<PrivacyRightPage> createState() => _PrivacyRightPageState();
}

class _PrivacyRightPageState extends State<PrivacyRightPage> {
  final TextEditingController _details = TextEditingController();
  final TextEditingController _email = TextEditingController();
  final TextEditingController _nomineeName = TextEditingController();
  final TextEditingController _nomineeEmail = TextEditingController();
  final Stopwatch _open = Stopwatch()..start();
  final String _key = newOutboxId();
  bool _busy = false;
  String? _status;
  FeedbackSendResult? _result;

  bool get _signedIn => widget.host.feedback.signedIn();

  @override
  void initState() {
    super.initState();
    if (widget.right == PrivacyRight.nomination && _signedIn) _loadNominee();
  }

  @override
  void dispose() {
    _details.dispose();
    _email.dispose();
    _nomineeName.dispose();
    _nomineeEmail.dispose();
    super.dispose();
  }

  Future<void> _loadNominee() async {
    final Result<PrivacyNominee?> r = await widget.host.data.readNominee(
      accessToken: await widget.host.accessToken(),
    );
    if (!mounted) return;
    final PrivacyNominee? n = _ok<PrivacyNominee?>(r);
    if (n != null) {
      setState(() {
        _nomineeName.text = n.name;
        _nomineeEmail.text = n.email;
      });
    }
  }

  /// The request body the server's `parsePrivacyRequest` reads, and nothing else.
  Map<String, Object?> _request() => <String, Object?>{
    'kind': 'privacy-request',
    'idempotencyKey': _key,
    'appId': widget.host.feedback.app.appId,
    'surface': 'app',
    'requestType': widget.right.wire,
    if (_details.text.trim().isNotEmpty) 'details': _details.text.trim(),
    if (!_signedIn) 'contactEmail': _email.text.trim(),
    'locale': Localizations.localeOf(context).toLanguageTag(),
    'elapsedMs': _open.elapsedMilliseconds,
  };

  bool get _canSend =>
      !_busy &&
      (!widget.right.needsDetails || _details.text.trim().isNotEmpty) &&
      (_signedIn || _email.text.contains('@'));

  Future<void> _send() async {
    setState(() => _busy = true);
    final FeedbackSendResult r = await widget.host.feedback.outbox.submit(
      FeedbackSubmission(report: _request()),
      owner: widget.host.feedback.owner(),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _result = r;
    });
  }

  Future<void> _download(FeedbackStrings s) async {
    setState(() => _busy = true);
    final Result<String> r = await widget.host.data.exportData(
      accessToken: await widget.host.accessToken(),
    );
    ExportOutcome outcome = ExportOutcome.failed;
    final String? json = _ok(r);
    if (json != null) {
      outcome = await widget.host.exporter.export(
        ExportFile(
          bytes: utf8.encode(json),
          fileName: 'nikatru-data-export.json',
          mimeType: 'application/json',
        ),
      );
    }
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = switch (outcome) {
        ExportOutcome.exported => s.exportSaved,
        ExportOutcome.dismissed => null,
        ExportOutcome.failed => s.exportFailed,
      };
    });
  }

  Future<void> _saveNominee(FeedbackStrings s) async {
    setState(() => _busy = true);
    final Result<PrivacyNominee> r = await widget.host.data.writeNominee(
      accessToken: await widget.host.accessToken(),
      nominee: PrivacyNominee(
        name: _nomineeName.text.trim(),
        email: _nomineeEmail.text.trim(),
      ),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _status = r.isOk ? s.nomineeSaved : s.refusedBody;
    });
  }

  Future<void> _removeNominee(FeedbackStrings s) async {
    setState(() => _busy = true);
    final Result<void> r = await widget.host.data.removeNominee(
      accessToken: await widget.host.accessToken(),
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (r.isOk) {
        _nomineeName.clear();
        _nomineeEmail.clear();
      }
      _status = r.isOk ? s.nomineeRemoved : s.refusedBody;
    });
  }

  /// What a signed-in person can do at once, above the request form.
  List<Widget> _atOnce(FeedbackStrings s) {
    if (!_signedIn) return const <Widget>[];
    switch (widget.right) {
      case PrivacyRight.access:
        return <Widget>[
          Text(s.rightAccessNow),
          const SizedBox(height: AppSpacing.sm),
          FilledButton(
            key: PrivacyRightsKeys.download,
            onPressed: _busy ? null : () => _download(s),
            child: Text(s.exportDownload),
          ),
        ];
      case PrivacyRight.erasure:
        return <Widget>[
          Text(s.erasureNow),
          const SizedBox(height: AppSpacing.sm),
          OutlinedButton(
            key: PrivacyRightsKeys.deleteAccount,
            onPressed: widget.host.openDeleteAccount,
            child: Text(s.erasureOpen),
          ),
        ];
      case PrivacyRight.nomination:
        return <Widget>[
          Text(s.nomineeExplain),
          TextField(
            key: PrivacyRightsKeys.nomineeName,
            controller: _nomineeName,
            maxLength: PrivacyNominee.maxNameLength,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: s.nomineeName),
          ),
          TextField(
            key: PrivacyRightsKeys.nomineeEmail,
            controller: _nomineeEmail,
            keyboardType: TextInputType.emailAddress,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(labelText: s.nomineeEmail),
          ),
          const SizedBox(height: AppSpacing.sm),
          FilledButton(
            key: PrivacyRightsKeys.nomineeSave,
            onPressed:
                !_busy &&
                    PrivacyNominee.isValid(
                      _nomineeName.text,
                      _nomineeEmail.text,
                    )
                ? () => _saveNominee(s)
                : null,
            child: Text(s.nomineeSave),
          ),
          TextButton(
            key: PrivacyRightsKeys.nomineeRemove,
            onPressed: _busy ? null : () => _removeNominee(s),
            child: Text(s.nomineeRemove),
          ),
        ];
      case PrivacyRight.withdrawConsent:
        return <Widget>[Text(s.withdrawNow)];
      case PrivacyRight.correction:
      case PrivacyRight.grievance:
        return const <Widget>[];
    }
  }

  @override
  Widget build(BuildContext context) {
    final FeedbackStrings s = FeedbackStrings.of(
      Localizations.localeOf(context),
    );
    final FeedbackSendResult? result = _result;
    final String? status = _status;
    return Scaffold(
      appBar: AppBar(title: Text(_rightLabel(s, widget.right))),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: result != null
                ? <Widget>[
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        key: PrivacyRightsKeys.result,
                        switch (result.kind) {
                          FeedbackSendKind.sent =>
                            _signedIn
                                ? s.requestSent(result.id ?? '')
                                : s.requestConfirmEmail,
                          FeedbackSendKind.retryLater => s.queuedBody,
                          FeedbackSendKind.refused => s.refusedBody,
                        },
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      child: Text(s.close),
                    ),
                  ]
                : <Widget>[
                    ..._atOnce(s),
                    if (status != null)
                      Semantics(liveRegion: true, child: Text(status)),
                    if (_signedIn &&
                        widget.right != PrivacyRight.correction &&
                        widget.right != PrivacyRight.grievance)
                      const SizedBox(height: AppSpacing.xl),
                    Text(s.requestFormIntro),
                    TextField(
                      key: PrivacyRightsKeys.details,
                      controller: _details,
                      minLines: 3,
                      maxLines: 8,
                      maxLength: 4000,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        labelText: s.requestDetailsLabel,
                        helperText:
                            widget.right.needsDetails &&
                                _details.text.trim().isEmpty
                            ? s.requestDetailsRequired
                            : null,
                      ),
                    ),
                    if (!_signedIn)
                      TextField(
                        key: PrivacyRightsKeys.email,
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const <String>[AutofillHints.email],
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          labelText: s.requestEmailLabel,
                        ),
                      ),
                    const SizedBox(height: AppSpacing.lg),
                    FilledButton(
                      key: PrivacyRightsKeys.send,
                      onPressed: _canSend ? _send : null,
                      child: Text(_busy ? s.sending : s.requestSend),
                    ),
                  ],
          ),
        ),
      ),
    );
  }
}
