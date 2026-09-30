import 'package:flutter/material.dart';
import '../tokens/app_spacing.dart';
import 'app_card.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// Gates a premium surface behind an upgrade wall. When [locked] the widget
/// shows an upsell screen (with an [onUpgrade] call-to-action) instead of
/// [child]; otherwise it shows [child] unchanged.
///
/// The lock DECISION lives with the caller — e.g.
/// `PaywallGate(locked: cfg.paywall.enabled && !entitlements.isProAt(now), …)` —
/// so `design_system` stays free of a domain dependency (mirrors ForceUpdateGate).
/// 🔴 THE COPY IS REQUIRED, NOT DEFAULTED. An English default here is a
/// user-visible literal living in `packages/`, and
/// `tooling/ci/assert-no-hardcoded-strings.mjs` scans exactly two roots — the
/// brick and `apps/subscriptiontracker/lib` (`:119-131`) — not this one. So a default is a
/// shipped string that has left the domain of the only guard that hunts for
/// one. Requiring it puts the string back in a scanned tree, because the
/// caller lives in `apps/` or in the brick.
///
/// ⚠️ EVERY CALL SITE ALREADY PASSED ITS COPY when this changed on 2026-09-04,
/// so nothing about what a user sees moved. The defaults were a SECOND source
/// of truth beside the arb, waiting for a caller that forgot — which is exactly
/// what had happened to [ForceUpdateGate], whose defaults were the only copy
/// any app ever shipped.
class PaywallGate extends StatelessWidget {
  const PaywallGate({
    super.key,
    required this.locked,
    required this.child,
    required this.title,
    required this.message,
    required this.upgradeLabel,
    this.onUpgrade,
  }) : _card = false,
       badgeLabel = null,
       preview = null;

  /// Gates ONE CARD of a screen rather than the whole of it — ST-D3 D3-6
  /// (ST-P2): a Pro card on Insights, with the free cards around it still
  /// readable. Locked, it draws an [AppCard] carrying [title], a [badgeLabel]
  /// chip ("Pro"), an optional decorative [preview] (excluded from semantics:
  /// a teaser of numbers the user cannot have is not information), [message]
  /// and a tonal [upgradeLabel] button. Unlocked, it is [child] unchanged.
  ///
  /// 🔴 A WHOLE-TAB WALL HID THE FREE CARDS TOO. The app gated its entire
  /// Insights tab with the page arm above, so a locked user saw none of the
  /// figures that were never premium. The lock belongs on the card that is.
  const PaywallGate.card({
    super.key,
    required this.locked,
    required this.child,
    required this.title,
    required this.message,
    required this.upgradeLabel,
    this.onUpgrade,
    this.badgeLabel,
    this.preview,
  }) : _card = true;

  final bool _card;

  /// The plan name on the locked card's chip; no chip when null.
  final String? badgeLabel;

  /// A decorative teaser shown on the locked card; excluded from semantics.
  final Widget? preview;

  /// Whether the premium surface is locked for this user.
  final bool locked;

  /// The premium content, shown when unlocked.
  final Widget child;

  /// Invoked when the user taps upgrade (e.g. open the paywall/checkout). When
  /// null the button is hidden.
  final VoidCallback? onUpgrade;

  final String title;
  final String message;
  final String upgradeLabel;

  @override
  Widget build(BuildContext context) {
    if (!locked) return child;
    final ThemeData theme = Theme.of(context);
    if (_card) return _lockedCard(theme);
    // KEEPS `Center` for the same reason as ForceUpdateGate: this replaces a
    // premium surface wholesale, so it is the only thing in its slot and reads
    // as a card, not a page. Width comes from the chassis; the vertical
    // decision stays local and deliberate.
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Icon(
                Icons.workspace_premium_outlined,
                size: 56,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(height: 20),
              Text(
                title,
                style: theme.textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 10),
              Text(
                message,
                style: theme.textTheme.bodyMedium,
                textAlign: TextAlign.center,
              ),
              if (onUpgrade != null) ...<Widget>[
                const SizedBox(height: 28),
                FilledButton(onPressed: onUpgrade, child: Text(upgradeLabel)),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _lockedCard(ThemeData theme) {
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: text.labelLarge?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
              if (badgeLabel != null)
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: scheme.secondaryContainer,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xs,
                    ),
                    child: Text(
                      badgeLabel!,
                      style: text.labelMedium?.copyWith(
                        color: scheme.onSecondaryContainer,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (preview != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            ExcludeSemantics(child: preview!),
          ],
          const SizedBox(height: AppSpacing.md),
          Text(
            message,
            style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (onUpgrade != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: FilledButton.tonal(
                onPressed: onUpgrade,
                child: Text(upgradeLabel),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
