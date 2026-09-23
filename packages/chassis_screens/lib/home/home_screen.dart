import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The chassis's one content surface: the brand mark and the two lines a fresh
/// stamp greets its first user with.
///
/// 🏗️ THE BODY OF THE BRICK'S `WelcomePanel`, MOVED HERE BY [ADR 067]
/// decision 2 / [ADR 071]. The brick keeps an adapter of that name, and the
/// adapter keeps the two reads a package that knows no app cannot make: the
/// app's name (`AppConfig.appName`) and the brand token
/// (`Theme.of(context).extension<AppThemeX>()`).
///
/// ⚠️ THE TOKEN READ STAYS IN THE BRICK ON PURPOSE. `assert-stamp-properties`
/// counts `.extension<AppThemeX>()` readers across `apps/*/lib` and
/// `packages/*/lib` as the brand token "shipped"; moving the read into this
/// file would flip that owner-gated print without any app starting to paint
/// with it. This view therefore takes a plain [Gradient].
class WelcomeView extends StatelessWidget {
  const WelcomeView({
    required this.appName,
    required this.brandGradient,
    super.key,
  });

  /// The product name the greeting names — the stamped app's, never a literal.
  final String appName;

  /// The brand mark's paint, read by the adapter from the app's theme.
  final Gradient brandGradient;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    // 🔴 SCROLLS ONLY WHEN SQUEEZED. This body sits in `Expanded` under the
    // catch-up banner and the promo card; on a build that can sell, the card
    // carries its buy button, and on a short window the fixed Column below
    // overflowed (measured: 46 px on the default test surface). Centred when
    // there is room, scrollable when there is not.
    return Center(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                gradient: brandGradient,
                borderRadius: BorderRadius.circular(AppRadius.lg),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(l10n.welcomeTo(appName), style: AppText.title),
            const SizedBox(height: AppSpacing.xs),
            Text(l10n.homeTagline, style: AppText.muted),
          ],
        ),
      ),
    );
  }
}

/// The in-app catch-up nudge's VIEW — [pipeline T-8].
///
/// 🏗️ THE RENDER HALF OF THE BRICK'S `CatchUpNudgeBanner`, MOVED HERE BY
/// [ADR 067] decision 2 / [ADR 071]. Everything that DECIDES stays in the
/// brick adapter: the platform capability read, `core.CatchUpNudge().decide`,
/// the reminders opt-out and the last-shown provider. This widget is built only
/// once that decision said "show", so it has no "hidden" state of its own.
///
/// [onDismiss] is how the adapter records the impression
/// (`catchUpNudgeProvider.notifier.markShown`) — a package that declares no
/// Riverpod cannot.
class CatchUpBannerView extends StatelessWidget {
  const CatchUpBannerView({required this.onDismiss, super.key});

  static const Key dismissButton = Key('catchUpBannerDismiss');

  /// Called when the user dismisses the nudge.
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    return MaterialBanner(
      backgroundColor: theme.colorScheme.surfaceContainerHighest,
      leading: const Icon(Icons.notifications_active_outlined),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(l10n.catchUpTitle, style: theme.textTheme.titleSmall),
          Text(l10n.catchUpBody, style: theme.textTheme.bodySmall),
        ],
      ),
      actions: <Widget>[
        TextButton(
          key: dismissButton,
          onPressed: onDismiss,
          child: Text(l10n.catchUpDismiss),
        ),
      ],
    );
  }
}
