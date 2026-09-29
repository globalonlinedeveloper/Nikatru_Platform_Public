import 'package:flutter/material.dart';
import '../tokens/app_spacing.dart';
import '../tokens/status_tones.dart';
import 'app_scaffold.dart' show AppBreakpoints, WindowClass, windowClassFor;

/// PERMISSION PRIMING — explain, THEN ask the OS (train ST-D8).
///
/// 🔴 THE OS PROMPT CAN BE SHOWN ONCE ON MOST PLATFORMS. A user who declines it
/// has effectively declined permanently, and the only route back is the system
/// settings app — so the cost of asking at a bad moment is not a dismissed
/// dialog, it is the feature, forever. Priming first means the one prompt is
/// spent on someone who has already said yes in principle, and "Not now" here
/// deliberately spends NOTHING.
///
/// 🏗️ PIPELINE-FIRST. The brick's settings adapter used to build its own
/// `AlertDialog` for this and every app that wanted a priming step had to write
/// a second one. The body lives here so the shape — why, what you get, a
/// primary that proceeds and a secondary that costs nothing — is one decision
/// every stamped app inherits. The WORDS stay per app: they arrive resolved,
/// because only the caller knows which permission it is asking for.
///
/// ⚠️ HERE, NOT IN `packages/chassis_screens`, AND THE FIRST DRAFT PUT IT
/// THERE. It is a MODAL with no domain — the same kind of thing as
/// `DestructiveConfirmDialog` beside it — and it is opened from INSIDE
/// screens rather than being one. In chassis_screens it made Subly's own
/// settings screen and add sheet import one chassis path each, and
/// `assert-a11y-coverage` then read both as screens DELEGATED to the chassis
/// ("SettingsScreen → permission_priming.dart — SWEPT there"), which neither
/// is. Every app and the brick already import this package.
///
/// Paints ONLY theme roles and foundation tokens: the icon disc is the
/// scheme's `primaryContainer`, the type is the ramp's roles, the gaps are
/// [AppSpacing] rungs and the corner is [AppRadius.card].
class PermissionPrimingView extends StatelessWidget {
  const PermissionPrimingView({
    required this.title,
    required this.body,
    required this.allowLabel,
    required this.notNowLabel,
    required this.onAllow,
    required this.onNotNow,
    this.reasons = const <String>[],
    this.icon = Icons.notifications_active_outlined,
    super.key,
  });

  /// Proceeds to the OS prompt.
  static const Key allowButton = Key('permissionPrimingAllow');

  /// Declines WITHOUT spending the OS prompt.
  static const Key notNowButton = Key('permissionPrimingNotNow');

  /// The side of the icon disc. A multiple of the 4-pt grid: [AppSpacing.xxxl].
  static const double iconDisc = AppSpacing.xxxl;

  final String title;
  final String body;

  /// What the permission buys, one short line each. Optional: an app with
  /// nothing more specific to say than [body] passes none, and no empty list
  /// is drawn.
  final List<String> reasons;

  final String allowLabel;
  final String notNowLabel;
  final VoidCallback onAllow;
  final VoidCallback onNotNow;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return Padding(
      padding: const EdgeInsets.all(AppSpacing.xl),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          // Decorative: the title below says the same thing in words.
          ExcludeSemantics(
            child: Container(
              width: iconDisc,
              height: iconDisc,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: scheme.primaryContainer,
                borderRadius: BorderRadius.circular(AppRadius.card),
              ),
              child: Icon(icon, color: scheme.onPrimaryContainer),
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          Semantics(
            header: true,
            child: Text(
              title,
              style: text.titleLarge?.copyWith(color: scheme.onSurface),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            body,
            style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (reasons.isNotEmpty) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            for (final String reason in reasons)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    ExcludeSemantics(
                      child: Icon(
                        Icons.check_circle_outline,
                        size: AppSpacing.xl,
                        color: StatusTones.of(context).positive,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Text(
                        reason,
                        style: text.bodyMedium?.copyWith(
                          color: scheme.onSurface,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
          const SizedBox(height: AppSpacing.xl),
          // A WRAP, NOT A ROW: at text scale 2.0 in a 320 px sheet the two
          // labels cannot share a line, and a Row would overflow rather than
          // let the secondary drop beneath the primary.
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: Wrap(
              alignment: WrapAlignment.end,
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                TextButton(
                  key: notNowButton,
                  onPressed: onNotNow,
                  child: Text(notNowLabel),
                ),
                FilledButton(
                  key: allowButton,
                  onPressed: onAllow,
                  child: Text(allowLabel),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Shows [PermissionPrimingView] and answers whether the user chose to proceed.
///
/// A bottom SHEET on a compact window, where the thumb already is, and a
/// DIALOG capped at [AppBreakpoints.pane] on anything wider, where a sheet
/// would run the whole width of a desktop window. The class is read from the
/// WINDOW (`MediaQuery`), never from the caller's constraints — the reason
/// `app_spacing.dart` records for not re-deriving it inside a pane.
///
/// A dismissal of any kind — the scrim, the back gesture, Escape — answers
/// `false`, exactly like "Not now": only the primary spends the OS prompt.
Future<bool> showPermissionPriming(
  BuildContext context, {
  required String title,
  required String body,
  required String allowLabel,
  required String notNowLabel,
  List<String> reasons = const <String>[],
  IconData icon = Icons.notifications_active_outlined,
}) async {
  Widget view(BuildContext c) => PermissionPrimingView(
    title: title,
    body: body,
    reasons: reasons,
    allowLabel: allowLabel,
    notNowLabel: notNowLabel,
    icon: icon,
    onAllow: () => Navigator.of(c).pop(true),
    onNotNow: () => Navigator.of(c).pop(false),
  );

  final bool compact =
      windowClassFor(MediaQuery.sizeOf(context).width) == WindowClass.compact;
  final bool? answer = compact
      ? await showModalBottomSheet<bool>(
          context: context,
          useSafeArea: true,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (BuildContext c) => SingleChildScrollView(child: view(c)),
        )
      : await showDialog<bool>(
          context: context,
          builder: (BuildContext c) => Dialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadius.card),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: AppBreakpoints.pane),
              child: SingleChildScrollView(child: view(c)),
            ),
          ),
        );
  return answer ?? false;
}
