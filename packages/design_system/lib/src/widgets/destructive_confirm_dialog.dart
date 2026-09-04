import 'package:flutter/material.dart';

import '../theme/form_tones.dart';

/// WHAT A DESTRUCTIVE ACTION TURNED OUT TO HAVE DONE, in words the person who
/// asked for it can act on.
///
/// 🔴 IT CARRIES A SENTENCE AND A VERDICT, NOT AN ERROR. The defect this whole
/// file exists for is a dialog that answered every failure with one sentence —
/// so "the server refused before touching anything" and "your data is gone and
/// your login still works" read identically. A boolean `succeeded` alone repeats
/// that mistake one level up, which is why [succeeded] only ever means THE
/// THING IS GONE and every other state has to say what it is in [message].
///
/// ⚠️ EVERY FIELD IS COPY THE CALLER HANDS IN, AND NONE OF IT HAS AN ENGLISH
/// DEFAULT — see the note on [DestructiveConfirmDialog] for the measurement that
/// makes that a coverage decision rather than an API preference.
@immutable
class DestructiveActionReport {
  const DestructiveActionReport({
    required this.message,
    required this.succeeded,
    this.title,
    this.footnote,
  });

  /// The sentence the person reads. Written from THEIR side of the request —
  /// what happened to their account — never from the server's.
  final String message;

  /// Whether the destructive thing actually happened. Only a real success may
  /// answer true: a UI that treats "no exception" as success is the failure this
  /// type replaces.
  final bool succeeded;

  /// An optional heading. NULLABLE ON PURPOSE and never defaulted to English:
  /// a caller whose string catalogue has no key for it renders the sentence
  /// alone, which is honest, rather than a hard-coded heading that would ship
  /// untranslated in every app the factory stamps.
  final String? title;

  /// An optional second line — a route to take when the action did not happen
  /// (a support address, say). Same nullability rule as [title].
  final String? footnote;
}

/// A confirmation dialog for an action that CANNOT BE UNDONE: it takes a
/// secret, disables itself until one is typed, refuses to be dismissed while the
/// request is in flight, and — the part that is not decoration — SHOWS WHAT
/// HAPPENED in a second phase of itself.
///
/// 🔴 WHY THE RESULT IS A SECOND PHASE AND NOT A SNACKBAR. Measured in
/// `tooling/bricks/app/__brick__/apps/{{app_id}}/lib/features/settings/
/// settings_screen.dart` on 2026-09-04, before this widget existed: the
/// deletion outcome was posted at `:651` to the `ScaffoldMessenger` of the very
/// screen the sign-out redirect was tearing down, so the message could be
/// destroyed before it was read. `apps/subly` hit the same thing from the other
/// side and recorded the measurement in
/// `apps/subly/lib/state/providers/auth.dart:568-574`: its first version
/// rendered the result in the dialog, and the router-driven test found ZERO
/// widgets with the result key once the redirect settled — so *the message that
/// mattered most (502: your data is gone and your login still works) was the one
/// message the user never saw*.
///
/// ⚠️ SO THIS WIDGET IS HALF OF THE ANSWER, AND IT IS THE HALF THAT COVERS THE
/// SESSION-SURVIVING OUTCOMES. When the action fails BEFORE the session is torn
/// down — a refused re-authentication, a transport failure on the way to the
/// re-auth — nothing navigates, this dialog is still mounted, and the second
/// phase is what the user reads. When the action DOES tear the session down, the
/// route goes and this dialog goes with it; the caller must also park the
/// outcome somewhere above the screen and render it on whatever surface the
/// redirect lands on. Neither half replaces the other.
///
/// 🔴 EVERY USER-VISIBLE STRING IS A REQUIRED PARAMETER WITH NO ENGLISH
/// DEFAULT, AND THAT IS A COVERAGE DECISION.
/// `tooling/ci/assert-no-hardcoded-strings.mjs` scans exactly two roots — the
/// brick and `apps/subly/lib` (`:119-131`) — and does NOT scan `packages/`. A
/// default sentence living here would be a user-visible literal that left the
/// guard's domain by moving house: it would still ship, and the check that
/// exists to catch it would go quiet rather than red. Every string this widget
/// paints is handed in by a caller inside a scanned root, so the move costs no
/// enforcement at all.
///
/// ⚠️ AND NOTHING HERE NAMES A DOMAIN TYPE. `packages/design_system` may not
/// depend on anything called `nikatru_*` (its own limb B in
/// `tooling/ci/assert-package-boundaries.mjs:154-158`), so the outcome enum, the
/// auth seam and the localisations stay on the caller's side of the boundary and
/// this widget takes plain values and callbacks. [ADR 065]
class DestructiveConfirmDialog extends StatefulWidget {
  const DestructiveConfirmDialog({
    required this.title,
    required this.body,
    required this.secretHint,
    required this.secretLabel,
    required this.secret,
    required this.cancelLabel,
    required this.confirmLabel,
    required this.acknowledgeLabel,
    required this.onConfirm,
    super.key,
    this.secretFieldKey,
    this.confirmKey,
    this.resultKey,
    this.resultTitleKey,
  });

  /// The question, e.g. "Delete account?".
  final String title;

  /// What the action does and that it cannot be undone.
  final String body;

  /// Why a secret is being asked for at all.
  final String secretHint;

  /// The field's own label.
  final String secretLabel;

  /// 🔴 OWNED BY THE CALLER, AND DISPOSED BY THE CALLER. This widget adds no
  /// listener to it and never disposes it.
  ///
  /// The ownership is not a preference. `tooling/ci/assert-stamp-properties.mjs
  /// :1042` pins the confirm wiring as the literal zero-argument closure
  /// `onConfirm: () => _deleteAccount(` in the stamped settings screen, so the
  /// typed secret has to be readable from OUTSIDE this widget for that closure
  /// to have anything to pass. A controller created in here could not be. The
  /// caller therefore creates it, hands it over, and disposes it in its own
  /// `State.dispose` — which runs after this one, because the framework unmounts
  /// children before their parents.
  final TextEditingController secret;

  final String cancelLabel;

  /// The destructive button's label. Kept in place while the request is in
  /// flight — a spinner appears BESIDE it rather than replacing it, so the
  /// button never becomes a control with no accessible name, and no second
  /// "…ing" string has to exist in every app's catalogue.
  final String confirmLabel;

  /// The result phase's only button: it acknowledges what happened and closes.
  final String acknowledgeLabel;

  /// Runs the real thing and reports what it did.
  ///
  /// ZERO-ARGUMENT for the reason recorded on [secret]. It must not throw: an
  /// error escaping here leaves the dialog stuck in its busy state, which
  /// `apps/subly/lib/features/settings/settings_screen.dart:1218-1223` records
  /// as a live E2E flake — `PopScope` then refuses to close a dialog that will
  /// never finish. Report the failure as a [DestructiveActionReport] instead.
  final Future<DestructiveActionReport> Function() onConfirm;

  /// Goes on the inner `TextField`, not on this widget — the same distinction
  /// [AuthField] documents, and for the same reason: an E2E driver does
  /// `tester.widget<TextField>(find.byKey(key))` and putting the key on the
  /// wrapper turns that into a type error rather than a readable failure.
  final Key? secretFieldKey;

  final Key? confirmKey;
  final Key? resultKey;
  final Key? resultTitleKey;

  @override
  State<DestructiveConfirmDialog> createState() =>
      _DestructiveConfirmDialogState();
}

class _DestructiveConfirmDialogState extends State<DestructiveConfirmDialog> {
  bool _busy = false;
  DestructiveActionReport? _report;

  Future<void> _run() async {
    setState(() => _busy = true);
    final DestructiveActionReport report = await widget.onConfirm();
    // The action may have signed the user out, in which case the router has
    // already taken this route away and there is nobody left to tell.
    if (!mounted) return;
    setState(() {
      _busy = false;
      _report = report;
    });
  }

  @override
  Widget build(BuildContext context) {
    final DestructiveActionReport? report = _report;
    if (report != null) {
      // The work is over: leaving is allowed again.
      return PopScope(canPop: true, child: _result(context, report));
    }
    // 🔴 NOTHING MAY DISMISS THIS WHILE THE REQUEST IS IN FLIGHT. A stray
    // Escape, a back gesture or a swipe would look exactly like a cancelled
    // deletion to the person doing it, while the request carries on. The
    // barrier is handled at the `showDialog` call site
    // (`barrierDismissible: false`); this covers the routes a barrier flag
    // cannot reach.
    return PopScope(canPop: !_busy, child: _form(context));
  }

  Widget _form(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(widget.body),
          const SizedBox(height: 16),
          Text(widget.secretHint),
          const SizedBox(height: 8),
          TextField(
            key: widget.secretFieldKey,
            controller: widget.secret,
            obscureText: true,
            enabled: !_busy,
            decoration: InputDecoration(labelText: widget.secretLabel),
          ),
        ],
      ),
      actions: <Widget>[
        TextButton(
          // Cancelling mid-flight would leave the user believing they stopped
          // something that is already running.
          onPressed: _busy ? null : () => Navigator.pop(context),
          child: Text(widget.cancelLabel),
        ),
        // 🔴 THE DESTRUCTIVE BUTTON IS INERT ON AN EMPTY FORM. Measured in the
        // brick at `settings_screen.dart:776` on 2026-09-04: it was live with
        // nothing typed, so one stray tap sent an empty password at the
        // re-authentication — a call that can only fail, on the one screen where
        // a misfire destroys an account.
        //
        // ⚠️ A `ValueListenableBuilder` RATHER THAN AN `onChanged` CALLBACK.
        // `TextEditingController` IS a `ValueListenable`, so this rebuilds on
        // every edit including ones no keystroke caused (a paste, a programmatic
        // clear, an autofill) — and it adds no listener of its own to a
        // controller this widget does not own, so there is no subscription to
        // outlive the caller's `dispose`.
        ValueListenableBuilder<TextEditingValue>(
          valueListenable: widget.secret,
          builder: (BuildContext context, TextEditingValue value, Widget? _) {
            final bool ready = !_busy && value.text.isNotEmpty;
            return FilledButton(
              key: widget.confirmKey,
              onPressed: ready ? _run : null,
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
                  // The label never leaves, busy or not — see [confirmLabel].
                  Text(widget.confirmLabel),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  /// WHAT ACTUALLY HAPPENED, in the report's own words.
  Widget _result(BuildContext context, DestructiveActionReport report) {
    final FormTones tones = formTones(context);
    final String? title = report.title;
    final String? footnote = report.footnote;
    return AlertDialog(
      // Null renders no heading rather than an English one — see
      // [DestructiveActionReport.title].
      title: title == null ? null : Text(title, key: widget.resultTitleKey),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(report.message, key: widget.resultKey),
          if (footnote != null) ...<Widget>[
            const SizedBox(height: 12),
            Text(
              footnote,
              style: DefaultTextStyle.of(context)
                  .style
                  .copyWith(color: tones.muted),
            ),
          ],
        ],
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(widget.acknowledgeLabel),
        ),
      ],
    );
  }
}
