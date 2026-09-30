import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_icon_action.dart';
import 'content_pane.dart';

/// One trailing control in an [AppDetailHeader]'s top row.
@immutable
class AppHeaderAction {
  const AppHeaderAction({
    required this.icon,
    required this.label,
    required this.onPressed,
    this.key,
  });

  /// The glyph.
  final IconData icon;

  /// The control's name, already localised.
  final String label;

  /// What activating it does.
  final VoidCallback onPressed;

  /// Handed to the control, so a test or an e2e anchor finds THIS action.
  final Key? key;
}

/// The chassis DETAIL HEADER — the top of a page about ONE record: a way
/// back, the record's mark, its name and one line about it (train ST-D5).
///
/// ```
/// ┌──────────────────────── full-bleed band ────────────────────────┐
/// │        [←]                                         [⋯]          │
/// │        [NF]  Netflix                                            │
/// │              Entertainment · Premium                            │
/// └─────────────────────────────────────────────────────────────────┘
///          └──────── content capped at AppBreakpoints.reading ─────┘
/// ```
///
/// ## Its decisions
///  * **The band is full-bleed, its CONTENT is capped.** The band paints the
///    whole width; a [ContentPane.reading] inside it caps the controls, the
///    mark and the title at the same width a detail body below uses, with the
///    page gutter applied INSIDE the cap — so at any window the title starts
///    at the x the body's first card starts at. A capped band would float in
///    the page as a mis-sized block; an uncapped title would start at the
///    window edge while the body starts 600 px in.
///  * **The band is `surfaceContainer`, in both schemes.** One scheme slot
///    one step off the scaffold, so the header reads as the page's own
///    chrome without a gradient whose ink would have to be chosen per
///    gradient. The app's hand-rolled hero painted three fixed indigos with
///    white literals on them; this is the same structure with every colour
///    derived from the seed.
///  * **The way back is FIRST on the keyboard path**, and every control in
///    the top row is an [AppIconAction]: named, focusable, 48 × 48.
///  * **The title is a HEADING** for a screen reader's heading navigation, and
///    the mark ([leading]) is excluded — it abbreviates the title.
///
/// [paneKey] lands on the inner [ContentPane], so an app's width test can
/// measure the cap without knowing this widget's internals.
class AppDetailHeader extends StatelessWidget {
  const AppDetailHeader({
    super.key,
    required this.title,
    required this.backLabel,
    required this.onBack,
    this.subtitle,
    this.leading,
    this.actions = const <AppHeaderAction>[],
    this.paneKey,
    this.backKey,
  });

  /// The record's name.
  final String title;

  /// One line about the record, e.g. its category and plan.
  final String? subtitle;

  /// The record's mark, usually an `AppMonogram` at `AppMonogram.large`.
  /// Excluded from semantics.
  final Widget? leading;

  /// The back control's name, already localised.
  final String backLabel;

  /// How this page goes away. The caller owns it, because only the caller
  /// knows whether it was pushed, embedded as a pane or deep-linked.
  final VoidCallback onBack;

  /// Trailing controls in the top row, in reading order.
  final List<AppHeaderAction> actions;

  /// Handed to the inner [ContentPane].
  final Key? paneKey;

  /// Handed to the back control.
  final Key? backKey;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final Widget? mark = leading;
    final String? line = subtitle;
    return ColoredBox(
      color: scheme.surfaceContainer,
      child: SafeArea(
        bottom: false,
        child: ContentPane.reading(
          key: paneKey,
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.gutterCompact,
            AppSpacing.sm,
            AppSpacing.gutterCompact,
            AppSpacing.xl,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  AppIconAction(
                    key: backKey,
                    icon: Icons.arrow_back,
                    label: backLabel,
                    onPressed: onBack,
                  ),
                  const Spacer(),
                  for (final AppHeaderAction a in actions) ...<Widget>[
                    const SizedBox(width: AppSpacing.sm),
                    AppIconAction(
                      key: a.key,
                      icon: a.icon,
                      label: a.label,
                      onPressed: a.onPressed,
                    ),
                  ],
                ],
              ),
              const SizedBox(height: AppSpacing.lg),
              Row(
                children: <Widget>[
                  if (mark != null) ...<Widget>[
                    ExcludeSemantics(child: mark),
                    const SizedBox(width: AppSpacing.md),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Semantics(
                          header: true,
                          child: Text(
                            title,
                            style: text.headlineSmall?.copyWith(
                              color: scheme.onSurface,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        if (line != null)
                          Text(
                            line,
                            style: text.bodyMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
