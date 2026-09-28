import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_card.dart';

/// Opens a chassis FORM SHEET — the add / edit surface (train ST-D6).
///
/// The three arguments every form sheet needs, stated once so no app has to
/// rediscover them:
///  * `isScrollControlled: true` removes `showModalBottomSheet`'s default
///    9/16-of-window height cap. [AppFormSheet] caps itself at
///    [AppFormSheet.maxHeightFraction] and scrolls, so height that runs out
///    becomes scroll, never clip.
///  * `useRootNavigator: true` mounts it above every branch navigator, so a
///    sheet opened from a tab or a detail pane covers the navigation too.
///  * a transparent route background, because [AppFormSheet] paints its own
///    rounded surface.
///
/// ⚠️ NO WIDTH CAP IS APPLIED HERE. M3's bottom-sheet defaults cap a modal
/// sheet at 640 on every window class, and no `bottomSheetTheme` override
/// exists in the chassis; a second cap would silently disagree with the
/// framework's the day either number moved.
Future<T?> showAppFormSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useRootNavigator: true,
    backgroundColor: Colors.transparent,
    builder: builder,
  );
}

/// The chassis FORM SHEET surface: a drag handle, a header title, an optional
/// banner (offline, a failed save), the fields and the action row, all in one
/// scroll view (train ST-D6).
///
/// ## What it decides so the app does not
///  * **Its ground.** `surfaceContainerLow` in both schemes — M3's own sheet
///    slot, which in a dark scheme sits ABOVE the scaffold's `surface`, so the
///    sheet lifts off the page it covers. Fields rest on [AppCard.fillOf], so a
///    control on the sheet reads like a card on a page.
///  * **Its height.** At most [maxHeightFraction] of the window, and the whole
///    column — the action row included — scrolls. The action row is NOT
///    pinned outside the scroll view: with the keyboard up on a short window a
///    pinned row is the thing that gets clipped.
///  * **Its keyboard.** Escape is the modal route's own dismiss; this adds
///    Ctrl+Enter (Cmd+Enter on Apple) as submit, from any field, so a desktop
///    or web user never has to leave the keyboard to save.
///  * **Its header.** [title] is announced as a heading, so a screen reader
///    user can tell the sheet opened and what it is for.
///
/// [title] and every label inside are the app's strings, already localised:
/// this package carries no copy.
class AppFormSheet extends StatelessWidget {
  const AppFormSheet({
    super.key,
    required this.title,
    required this.children,
    required this.actions,
    this.banner,
    this.onSubmit,
  });

  /// The sheet's heading — "Add subscription", "Edit subscription".
  final String title;

  /// The body, top to bottom. Spaced by [AppSpacing.md]; a group that needs a
  /// tighter rhythm builds it itself.
  final List<Widget> children;

  /// The action row, normally an [AppFormActions].
  final Widget actions;

  /// A state the whole form is in — offline, or a save that failed — shown
  /// under the title, normally a `DecisionStrip`. Null shows nothing.
  final Widget? banner;

  /// What Ctrl+Enter / Cmd+Enter does. Null disables the shortcut (a save in
  /// flight passes null for the same reason its button is disabled).
  final VoidCallback? onSubmit;

  /// The tallest the sheet grows, as a fraction of the window height.
  static const double maxHeightFraction = 0.86;

  /// The drag handle, per M3's bottom-sheet spec.
  static const Size handleSize = Size(32, 4);

  /// The sheet's ground in [theme].
  static Color fillOf(ThemeData theme) => theme.colorScheme.surfaceContainerLow;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final MediaQueryData mq = MediaQuery.of(context);
    final VoidCallback? submit = onSubmit;
    return Padding(
      padding: EdgeInsets.only(bottom: mq.viewInsets.bottom),
      child: Container(
        constraints: BoxConstraints(
          maxHeight: mq.size.height * maxHeightFraction,
        ),
        decoration: BoxDecoration(
          color: fillOf(theme),
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(AppRadius.xl),
          ),
        ),
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.md,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        child: CallbackShortcuts(
          bindings: <ShortcutActivator, VoidCallback>{
            if (submit != null) ...<ShortcutActivator, VoidCallback>{
              const SingleActivator(LogicalKeyboardKey.enter, control: true):
                  submit,
              const SingleActivator(LogicalKeyboardKey.enter, meta: true):
                  submit,
            },
          },
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Center(
                  child: ExcludeSemantics(
                    child: Container(
                      width: handleSize.width,
                      height: handleSize.height,
                      decoration: BoxDecoration(
                        color: scheme.outline,
                        borderRadius: BorderRadius.circular(AppRadius.pill),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: theme.textTheme.titleLarge?.copyWith(
                      color: scheme.onSurface,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (banner != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.md),
                  banner!,
                ],
                for (final Widget child in children) ...<Widget>[
                  const SizedBox(height: AppSpacing.md),
                  child,
                ],
                const SizedBox(height: AppSpacing.xl),
                actions,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A labelled field on an [AppFormSheet]: the label above, the control under
/// it (train ST-D6).
///
/// The label is `labelLarge` in `onSurfaceVariant` — the ramp's 14 px role,
/// above the 12 px floor at every text scale — and it is the field's visible
/// name. The control keeps its own hint, which is an example, never the name.
class AppFormField extends StatelessWidget {
  const AppFormField({super.key, required this.label, required this.child});

  /// The field's name, already localised.
  final String label;

  /// The control — a `TextField` wearing [AppFieldDecoration.of], an
  /// [AppSegmentedChoice], a dropdown.
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          label,
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        child,
      ],
    );
  }
}

/// The ONE field skin on a form sheet (train ST-D6).
///
/// Every input on an [AppFormSheet] — a text field, a date button drawn as an
/// `InputDecorator`, a dropdown — wears [of], so no two of them can drift.
///
/// 🔴 THE RESTING BORDER IS `outline`, NOT `outlineVariant`. A field's edge is
/// the only thing that says "this is a control", so it is a non-text UI
/// component under WCAG 1.4.11 and needs 3:1 against the sheet;
/// `outlineVariant` is the divider slot and is not built to reach it.
/// `test/form_sheet_test.dart` measures the pair in both schemes.
///
/// An error is painted in [StatusTones.danger] — the measured status tone
/// (train ST-D0) — and carried by the WORDS of [InputDecoration.errorText]
/// first, so it is never colour-only.
abstract final class AppFieldDecoration {
  /// The border width at rest; a focused or erroring field doubles it, so
  /// focus is shown by weight as well as by hue.
  static const double borderWidth = 1;

  /// The skin, with an optional [hint] (an example value) and [errorText].
  static InputDecoration of(
    BuildContext context, {
    String? hint,
    String? errorText,
  }) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final Color danger = StatusTones.of(context).danger;
    OutlineInputBorder edge(Color color, double width) => OutlineInputBorder(
      borderRadius: BorderRadius.circular(AppRadius.control),
      borderSide: BorderSide(color: color, width: width),
    );
    return InputDecoration(
      hintText: hint,
      hintStyle: theme.textTheme.bodyLarge?.copyWith(
        color: scheme.onSurfaceVariant,
      ),
      errorText: errorText,
      errorStyle: theme.textTheme.bodySmall?.copyWith(color: danger),
      errorMaxLines: 2,
      filled: true,
      fillColor: AppCard.fillOf(theme),
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      enabledBorder: edge(scheme.outline, borderWidth),
      disabledBorder: edge(scheme.outlineVariant, borderWidth),
      focusedBorder: edge(scheme.primary, borderWidth * 2),
      errorBorder: edge(danger, borderWidth),
      focusedErrorBorder: edge(danger, borderWidth * 2),
    );
  }

  /// The style a field's VALUE is painted in: `bodyLarge`, `onSurface`.
  static TextStyle? valueStyle(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    return theme.textTheme.bodyLarge?.copyWith(
      color: theme.colorScheme.onSurface,
    );
  }
}

/// One arm of an [AppSegmentedChoice].
@immutable
class AppChoice<T> {
  const AppChoice({required this.value, required this.label, this.key});

  /// What choosing this arm selects.
  final T value;

  /// The arm's visible and announced name, already localised.
  final String label;

  /// An optional key for the arm's tappable surface (an e2e anchor).
  final Key? key;
}

/// A small closed choice — Monthly / Yearly — as a row of equal segments
/// (train ST-D6).
///
/// 🔴 SELECTION IS NEVER COLOUR-ONLY. The current arm is filled
/// (`secondaryContainer`), carries a check glyph, AND reports
/// `selected: true` to assistive technology; the others report
/// `selected: false`, so a reader hears a two-way choice rather than two
/// unrelated buttons that happen to sit together.
///
/// Every arm is at least [minHeight] tall and focusable; Enter or Space
/// chooses the focused arm (the `InkWell` it is drawn with).
class AppSegmentedChoice<T> extends StatelessWidget {
  const AppSegmentedChoice({
    super.key,
    required this.choices,
    required this.selected,
    required this.onChanged,
  }) : assert(choices.length >= 2, 'a choice needs at least two arms');

  /// The arms, in reading order.
  final List<AppChoice<T>> choices;

  /// The current value.
  final T selected;

  /// Called with the chosen value. Null disables every arm.
  final ValueChanged<T>? onChanged;

  /// Every arm's minimum height: the 48 px tap target.
  static const double minHeight = 48;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final ValueChanged<T>? change = onChanged;
    return Row(
      children: <Widget>[
        for (int i = 0; i < choices.length; i++) ...<Widget>[
          if (i > 0) const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: _segment(
              theme,
              scheme,
              choices[i],
              choices[i].value == selected,
              change,
            ),
          ),
        ],
      ],
    );
  }

  Widget _segment(
    ThemeData theme,
    ColorScheme scheme,
    AppChoice<T> choice,
    bool isSelected,
    ValueChanged<T>? change,
  ) {
    final Color ink = isSelected
        ? scheme.onSecondaryContainer
        : scheme.onSurface;
    return MergeSemantics(
      child: Semantics(
        button: true,
        selected: isSelected,
        inMutuallyExclusiveGroup: true,
        child: Material(
          key: choice.key,
          color: isSelected ? scheme.secondaryContainer : AppCard.fillOf(theme),
          clipBehavior: Clip.antiAlias,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadius.control),
            side: BorderSide(
              color: isSelected ? scheme.secondaryContainer : scheme.outline,
            ),
          ),
          child: InkWell(
            onTap: change == null ? null : () => change(choice.value),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: minHeight),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: AppSpacing.sm),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    if (isSelected) ...<Widget>[
                      ExcludeSemantics(
                        child: Icon(
                          Icons.check,
                          size: theme.textTheme.labelLarge?.fontSize,
                          color: ink,
                        ),
                      ),
                      const SizedBox(width: AppSpacing.xs),
                    ],
                    Flexible(
                      child: Text(
                        choice.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.labelLarge?.copyWith(color: ink),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The action row of an [AppFormSheet]: a secondary Cancel and the one
/// primary action, which fills the rest of the row (train ST-D6).
///
/// [busy] is the LOADING state: the primary action is disabled and reads
/// [busyLabel], so a double tap cannot submit twice and the user is told the
/// save is in flight. Cancel stays live — dismissing never has to wait for
/// the network.
class AppFormActions extends StatelessWidget {
  const AppFormActions({
    super.key,
    required this.cancelLabel,
    required this.onCancel,
    required this.submitLabel,
    required this.onSubmit,
    this.busy = false,
    this.busyLabel,
    this.submitKey,
    this.cancelKey,
  });

  /// The secondary action's label — "Cancel".
  final String cancelLabel;

  /// What Cancel does, normally a pop.
  final VoidCallback onCancel;

  /// The primary action's label — "Add subscription", "Save changes".
  final String submitLabel;

  /// What the primary action does.
  final VoidCallback onSubmit;

  /// Whether the primary action is in flight.
  final bool busy;

  /// The primary action's label while [busy]; [submitLabel] when null.
  final String? busyLabel;

  /// Key for the primary button (an e2e anchor).
  final Key? submitKey;

  /// Key for the Cancel button.
  final Key? cancelKey;

  /// Both buttons' height: the 48 px tap target, at every density.
  static const double height = 48;

  @override
  Widget build(BuildContext context) {
    const Size minimum = Size(0, height);
    final OutlinedBorder shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(AppRadius.control),
    );
    return Row(
      children: <Widget>[
        OutlinedButton(
          key: cancelKey,
          onPressed: onCancel,
          style: OutlinedButton.styleFrom(minimumSize: minimum, shape: shape),
          child: Text(cancelLabel),
        ),
        const SizedBox(width: AppSpacing.md),
        Expanded(
          child: FilledButton(
            key: submitKey,
            onPressed: busy ? null : onSubmit,
            style: FilledButton.styleFrom(minimumSize: minimum, shape: shape),
            child: Text(
              busy ? (busyLabel ?? submitLabel) : submitLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ],
    );
  }
}
