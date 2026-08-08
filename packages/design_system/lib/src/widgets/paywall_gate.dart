import 'package:flutter/material.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// Gates a premium surface behind an upgrade wall. When [locked] the widget
/// shows an upsell screen (with an [onUpgrade] call-to-action) instead of
/// [child]; otherwise it shows [child] unchanged.
///
/// The lock DECISION lives with the caller — e.g.
/// `PaywallGate(locked: cfg.paywall.enabled && !entitlements.isProAt(now), …)` —
/// so `design_system` stays free of a domain dependency (mirrors ForceUpdateGate).
class PaywallGate extends StatelessWidget {
  const PaywallGate({
    super.key,
    required this.locked,
    required this.child,
    this.onUpgrade,
    this.title = 'Unlock the full experience',
    this.message = 'Upgrade to unlock this feature.',
    this.upgradeLabel = 'Upgrade',
  });

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
              Icon(Icons.workspace_premium_outlined,
                  size: 56, color: theme.colorScheme.primary),
              const SizedBox(height: 20),
              Text(title,
                  style: theme.textTheme.headlineSmall,
                  textAlign: TextAlign.center),
              const SizedBox(height: 10),
              Text(message,
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center),
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
}
