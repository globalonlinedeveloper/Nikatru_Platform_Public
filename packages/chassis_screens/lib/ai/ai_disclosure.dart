import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The AI disclosure and the AI output label — train-st-ai-customer-pays (T17),
/// EU AI Act Art. 50(1), (2) and (5).
///
/// One body for every target and every app the factory stamps, and for BOTH
/// paths: OUR key behind the metered host, and the user's own key
/// (bring-your-own-key). We are the provider of the system whoever pays for the
/// model, so the disclosure and the label are the same on either path.
///
///   · [AiDisclosureDialog] — shown BEFORE the first AI call. It names the
///     processor (Apple 5.1.2(i)), says plainly that the feature uses AI, that
///     its results are AI-generated and can be wrong, and that nothing is saved
///     without the user's review. It is a live region, so a screen reader
///     announces it when it opens; the decision is two labelled buttons, never a
///     colour. The caller records the opt-in (POST /v1/ai/consent) only on
///     `true`, and makes no call before it.
///   · [AiOutputLabel] — on EVERY AI output: "Suggested by AI: check before
///     saving" on a candidate row, "AI suggestion" on an advisory one; an icon
///     AND text, never colour-only, with the report action (Play's AI-generated
///     content policy) beside it.
///
/// Plain values and callbacks, like every widget in this package: the brick's
/// adapter owns the transport.
class AiDisclosureDialog extends StatelessWidget {
  const AiDisclosureDialog({
    required this.processor,
    required this.onOpenPrivacy,
    super.key,
  });

  static const Key acceptButton = Key('aiDisclosureAccept');
  static const Key declineButton = Key('aiDisclosureDecline');
  static const Key privacyLink = Key('aiDisclosurePrivacy');

  /// The processor's name, as the store listing and the privacy notice name it.
  final String processor;

  /// Opens the privacy notice.
  final VoidCallback onOpenPrivacy;

  /// Shows the disclosure; `true` only when the user acknowledged it.
  static Future<bool> show(
    BuildContext context, {
    required String processor,
    required VoidCallback onOpenPrivacy,
  }) async {
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext _) =>
          AiDisclosureDialog(processor: processor, onOpenPrivacy: onOpenPrivacy),
    );
    return ok ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    return Semantics(
      liveRegion: true,
      container: true,
      explicitChildNodes: true,
      child: AlertDialog(
        icon: const Icon(Icons.auto_awesome_outlined),
        title: Text(l10n.aiDisclosureTitle),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(l10n.aiDisclosureBody(processor)),
              TextButton(
                key: privacyLink,
                onPressed: onOpenPrivacy,
                child: Text(l10n.aiDisclosurePrivacy),
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            key: declineButton,
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.aiDisclosureDecline),
          ),
          FilledButton(
            key: acceptButton,
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.aiDisclosureAccept),
          ),
        ],
      ),
    );
  }
}

/// What an AI output is: a row the user may save, or advice.
enum AiOutputKind { candidate, suggestion }

/// The label every AI output carries, with its report action.
class AiOutputLabel extends StatelessWidget {
  const AiOutputLabel({
    required this.kind,
    required this.onReport,
    super.key,
  });

  static const Key reportButton = Key('aiOutputReport');

  final AiOutputKind kind;

  /// Opens the in-app report for this output (`ReportContentDialog`).
  final VoidCallback onReport;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final String label = switch (kind) {
      AiOutputKind.candidate => l10n.aiCandidateLabel,
      AiOutputKind.suggestion => l10n.aiSuggestionLabel,
    };
    final TextStyle? style = Theme.of(context).textTheme.labelMedium;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        ExcludeSemantics(
          child: Icon(Icons.auto_awesome_outlined, size: style?.fontSize),
        ),
        const SizedBox(width: AppSpacing.xs),
        Flexible(child: Text(label, style: style)),
        IconButton(
          key: reportButton,
          tooltip: l10n.aiReportAction,
          onPressed: onReport,
          icon: const Icon(Icons.flag_outlined),
        ),
      ],
    );
  }
}
