import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// One step of the after-sign-in setup (train ST-T9, EN-18). The WORDS and
/// the control are the app's, already resolved; the chassis owns the frame.
@immutable
class SetupStep {
  const SetupStep({required this.title, required this.body, this.child});

  /// The step's heading — announced as a header.
  final String title;

  /// One or two sentences saying what the step is for and why the default is
  /// what it is.
  final String body;

  /// The step's control (a currency choice, channel switches, a tile grid),
  /// or null for a step that is words alone.
  final Widget? child;
}

/// The after-sign-in setup as a short list of steps — the chassis half of
/// train ST-T9 (EN-18), beside [OnboardingView]'s before-sign-in carousel.
///
/// 🏗️ PIPELINE-FIRST: the MECHANISM is here once — the reading cap, the step
/// position spoken as one node, "Skip" beside the primary on EVERY step, Back
/// from the second step on, and the last step's primary reading as the finish
/// — so every stamped app gets a first-run setup by passing its steps. What a
/// step SAYS and what it CONTROLS, and what finishing writes, stay in the
/// app's adapter. This package carries no copy: every label is passed in.
///
/// Skippable by design: [onSkip] is reachable from every step, and the app
/// marks setup seen either way, so it is shown once per account.
class SetupStepsView extends StatefulWidget {
  const SetupStepsView({
    required this.steps,
    required this.onFinish,
    required this.onSkip,
    required this.nextLabel,
    required this.finishLabel,
    required this.skipLabel,
    required this.backLabel,
    required this.positionLabel,
    this.busy = false,
    super.key,
  });

  static const Key skipButton = Key('setupSkip');
  static const Key advanceButton = Key('setupAdvance');
  static const Key backButton = Key('setupBack');
  static const Key position = Key('setupPosition');

  final List<SetupStep> steps;

  /// The last step's primary. The app writes what the steps chose.
  final VoidCallback onFinish;

  /// "Skip" on any step: nothing chosen is written; setup is still SEEN.
  final VoidCallback onSkip;

  final String nextLabel;
  final String finishLabel;
  final String skipLabel;
  final String backLabel;

  /// "Step 2 of 3", resolved by the app for (index from 1, count).
  final String Function(int step, int count) positionLabel;

  /// A finish in flight: both actions disabled.
  final bool busy;

  @override
  State<SetupStepsView> createState() => _SetupStepsViewState();
}

class _SetupStepsViewState extends State<SetupStepsView> {
  int _i = 0;

  bool get _last => _i == widget.steps.length - 1;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final SetupStep step = widget.steps[_i];
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              maxWidth: AppBreakpoints.medium,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.gutterCompact,
                      AppSpacing.xl,
                      AppSpacing.gutterCompact,
                      AppSpacing.lg,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          widget.positionLabel(_i + 1, widget.steps.length),
                          key: SetupStepsView.position,
                          style: theme.textTheme.labelLarge?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Semantics(
                          header: true,
                          child: Text(
                            step.title,
                            style: theme.textTheme.headlineSmall?.copyWith(
                              color: scheme.onSurface,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        Text(
                          step.body,
                          style: theme.textTheme.bodyLarge?.copyWith(
                            color: scheme.onSurfaceVariant,
                          ),
                        ),
                        if (step.child != null) ...<Widget>[
                          const SizedBox(height: AppSpacing.lg),
                          step.child!,
                        ],
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.gutterCompact,
                    AppSpacing.sm,
                    AppSpacing.gutterCompact,
                    AppSpacing.lg,
                  ),
                  // ⏱ 2026-10-02 · train P39 (SYN-X1 C-12): an OverflowBar, not a
                  // Row with a Spacer. At 200 % text on a 360-wide window the
                  // Tamil labels are 53 px wider than the row, and a Row can
                  // only overflow; this lays out exactly as the Row did while
                  // the three fit, and stacks them, end-aligned and in the same
                  // focus order, when they do not.
                  child: OverflowBar(
                    alignment: MainAxisAlignment.spaceBetween,
                    overflowAlignment: OverflowBarAlignment.end,
                    overflowSpacing: AppSpacing.sm,
                    children: <Widget>[
                      TextButton(
                        key: SetupStepsView.skipButton,
                        onPressed: widget.busy ? null : widget.onSkip,
                        child: Text(widget.skipLabel),
                      ),
                      OverflowBar(
                        spacing: AppSpacing.sm,
                        overflowAlignment: OverflowBarAlignment.end,
                        overflowSpacing: AppSpacing.sm,
                        children: <Widget>[
                          if (_i > 0)
                            TextButton(
                              key: SetupStepsView.backButton,
                              onPressed: widget.busy
                                  ? null
                                  : () => setState(() => _i--),
                              child: Text(widget.backLabel),
                            ),
                          FilledButton(
                            key: SetupStepsView.advanceButton,
                            onPressed: widget.busy
                                ? null
                                : (_last
                                      ? widget.onFinish
                                      : () => setState(() => _i++)),
                            child: Text(
                              _last ? widget.finishLabel : widget.nextLabel,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
