import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// One choice offered by a [DecisionStrip].
@immutable
class DecisionAction {
  const DecisionAction({
    required this.label,
    required this.onPressed,
    this.primary = false,
    this.key,
  });

  /// The choice, in the app's words, already localised.
  final String label;

  /// What choosing it does.
  final VoidCallback onPressed;

  /// The recommended choice. At most one per strip is drawn filled; the rest
  /// are text buttons, so the strip never offers two equal-weight answers to
  /// one question.
  final bool primary;

  /// Handed to the button, so a test or an e2e anchor can find THIS choice.
  final Key? key;
}

/// The DECISION STRIP — a question the app is asking the user about their own
/// data, with the answers beside it (train ST-D0).
///
/// "Netflix has not been opened in 60 days — Keep · Cancel". "Your trial
/// converts to paid tomorrow — Remind me · Cancel now". A banner INFORMS; this
/// ASKS, and the answer is one tap away rather than a screen away.
///
/// ## What it fixes by construction
///  * **The ground is an OPAQUE status tint** ([StatusTones.tintOf]), not an
///    alpha wash, so the contrast of every word on it is one measured number
///    per scheme — `test/decision_strip_test.dart` reads it.
///  * **The status is carried by words.** The glyph is decorative and
///    excluded; [message] must say what is going on.
///  * **At most one filled answer** ([DecisionAction.primary]), asserted.
///  * **It reflows by the width IT was given**, not the window: beside the
///    message from [AppBreakpoints.pane] (480) up, under it below — so a strip
///    inside a narrow detail pane behaves like a phone's.
///
/// Every string is the app's, already localised.
class DecisionStrip extends StatelessWidget {
  DecisionStrip({
    super.key,
    required this.kind,
    required this.message,
    this.detail,
    this.actions = const <DecisionAction>[],
  }) : assert(
         actions.where((DecisionAction a) => a.primary).length <= 1,
         'a DecisionStrip offers at most one primary answer',
       );

  /// What kind of news this is: it picks the tint and the glyph.
  final StatusKind kind;

  /// The question or the situation, in one sentence.
  final String message;

  /// An optional second line.
  final String? detail;

  /// The answers, in reading order.
  final List<DecisionAction> actions;

  /// The width from which the answers sit beside the message.
  static const double inlineFrom = AppBreakpoints.pane;

  static IconData _glyph(StatusKind kind) => switch (kind) {
    StatusKind.positive => Icons.check_circle_outline,
    StatusKind.warn => Icons.schedule,
    StatusKind.danger => Icons.error_outline,
  };

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final StatusTones tones = StatusTones.of(context);

    final Widget words = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          message,
          style: theme.textTheme.titleSmall?.copyWith(color: scheme.onSurface),
        ),
        if (detail != null) ...<Widget>[
          const SizedBox(height: AppSpacing.xs),
          Text(
            detail!,
            style: theme.textTheme.bodySmall?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
        ],
      ],
    );

    final Widget answers = Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      alignment: WrapAlignment.end,
      children: <Widget>[
        for (final DecisionAction a in actions)
          a.primary
              ? FilledButton(
                  key: a.key,
                  onPressed: a.onPressed,
                  child: Text(a.label),
                )
              : TextButton(
                  key: a.key,
                  onPressed: a.onPressed,
                  child: Text(a.label),
                ),
      ],
    );

    final Widget glyph = ExcludeSemantics(
      child: Icon(_glyph(kind), color: tones.toneOf(kind)),
    );

    return Semantics(
      container: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: tones.tintOf(kind),
          borderRadius: BorderRadius.circular(AppRadius.card),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints c) {
              final bool inline = c.maxWidth >= inlineFrom;
              if (inline) {
                return Row(
                  children: <Widget>[
                    glyph,
                    const SizedBox(width: AppSpacing.md),
                    Expanded(child: words),
                    if (actions.isNotEmpty) ...<Widget>[
                      const SizedBox(width: AppSpacing.md),
                      answers,
                    ],
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      glyph,
                      const SizedBox(width: AppSpacing.md),
                      Expanded(child: words),
                    ],
                  ),
                  if (actions.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.md),
                    answers,
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
