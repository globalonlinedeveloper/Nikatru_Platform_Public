import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import '../theme/form_tones.dart';
import 'destructive_confirm_dialog.dart';

/// The outcome of a destructive action, rendered WHERE THE SIGN-OUT REDIRECT
/// CANNOT REACH IT.
///
/// 🔴 THIS EXISTS BECAUSE THE MESSAGE THAT MATTERS MOST IS THE ONE THAT WAS
/// NEVER SEEN. Deleting an account signs the user out; the auth stream fires and
/// the router replaces the page stack with the sign-in screen. A `SnackBar` —
/// or a dialog, which is a PAGELESS ROUTE on the page being removed — goes with
/// it. `apps/subly/lib/state/providers/auth.dart:568-574` records the
/// measurement: the first version of that flow rendered the result in the
/// dialog, and the router-driven test found zero widgets with the result key
/// once the redirect settled, so *502 — your data is gone and your login still
/// works* was the one message the user never read. The brick shipped the same
/// defect in a different spelling, posting the result at
/// `settings_screen.dart:651` to the `ScaffoldMessenger` of the screen being
/// torn down.
///
/// So the outcome outlives the screen in a provider the CALLER owns, and this
/// widget renders it on whatever surface the redirect lands on. It is inline
/// rather than a dialog, deliberately: a dialog here would be another pageless
/// route, which is the exact shape that was carried away.
///
/// ⚠️ IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY, so a host screen can
/// place it unconditionally, and [onDismiss] is what clears the parked outcome —
/// otherwise it resurfaces at some later, unrelated sign-out.
///
/// 🔴 EVERY STRING IS HANDED IN, none is defaulted to English, and no
/// `nikatru_*` type is named — see [DestructiveConfirmDialog] for both
/// measurements. [ADR 027] [ADR 065]
class DestructiveOutcomeNotice extends StatelessWidget {
  const DestructiveOutcomeNotice({
    required this.report,
    required this.dismissLabel,
    required this.onDismiss,
    super.key,
    this.detail,
    this.messageKey,
    this.detailKey,
  });

  /// What happened. NULL RENDERS NOTHING — see the note above.
  final DestructiveActionReport? report;

  final String dismissLabel;

  /// Clears the parked outcome. Without it the notice comes back the next time
  /// anybody signs out, attached to an action they did not take.
  final VoidCallback onDismiss;

  /// 🔴 WHY IT FAILED, FOR A DEVELOPER — never for a user.
  ///
  /// [DestructiveActionReport.message] is the sentence a person reads and it is
  /// deliberately outcome-shaped; this is the status, the error body or the
  /// exception behind it. It is rendered ONLY under [kDebugMode], which is a
  /// `const`, so the tree-shaker removes this whole branch from every release
  /// artifact. The gate is HERE rather than at the call site on purpose: a
  /// caller that forgets it would leak an exception string to a user, and this
  /// widget is inherited by every app the factory stamps.
  ///
  /// It exists because "we cannot tell how much was removed" is a BUCKET, and a
  /// bucket with no label costs a session every time something lands in it —
  /// `packages/core/lib/src/auth/account_deletion.dart` records three sessions
  /// spent chasing an HTTP status that had never existed. `flutter drive` builds
  /// debug, so this is the surface an E2E can name the cause on.
  final String? detail;

  final Key? messageKey;
  final Key? detailKey;

  @override
  Widget build(BuildContext context) {
    final DestructiveActionReport? report = this.report;
    if (report == null) return const SizedBox.shrink();
    final FormTones tones = formTones(context);
    final TextStyle base = DefaultTextStyle.of(context).style;
    final String? title = report.title;
    final String? footnote = report.footnote;
    final String? detail = this.detail;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: tones.surface,
        borderRadius: BorderRadius.circular(16),
        // The FAILED case keeps its danger edge in both brightnesses; only the
        // token it resolves through changes.
        border: Border.all(
          color: report.succeeded ? tones.line : tones.danger,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (title != null)
            Text(
              title,
              style: base.copyWith(
                fontWeight: FontWeight.w800,
                color: tones.ink,
              ),
            ),
          if (title != null) const SizedBox(height: 6),
          Text(
            report.message,
            key: messageKey,
            style: base.copyWith(color: tones.ink),
          ),
          if (footnote != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(footnote, style: base.copyWith(color: tones.muted)),
          ],
          if (kDebugMode && detail != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(
              'debug: $detail',
              key: detailKey,
              style: base.copyWith(fontSize: 11, color: tones.muted),
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              onPressed: onDismiss,
              child: Text(dismissLabel),
            ),
          ),
        ],
      ),
    );
  }
}
