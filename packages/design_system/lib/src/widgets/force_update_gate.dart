import 'package:flutter/material.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// A blocking gate that replaces the app with an "update required" screen when
/// [mustUpdate] is true, otherwise shows [child]. The force-update DECISION
/// lives in `core` (`mustForceUpdate(current, minSupported)`, the CFG G-14
/// kill-switch); this widget is presentational only, so `design_system` stays
/// free of a domain dependency. Wrap the app's home:
/// `ForceUpdateGate(mustUpdate: core.mustForceUpdate(v, cfg.minSupportedVersion),
/// onUpdate: ..., child: HomeScreen())`.
///
/// 🔴 THE COPY IS REQUIRED, AND UNTIL 2026-09-04 IT WAS DEFAULTED TO ENGLISH —
/// WHICH IS WHAT EVERY APP SHIPPED. Measured on that date: both call sites in
/// the portfolio — `apps/subly/lib/app.dart` and the brick's `app.dart` — passed
/// `mustUpdate`, `onUpdate` and `child` and NOTHING ELSE, so all three sentences
/// came from the defaults that used to sit here. And no key for them had ever
/// existed in any arb, in either tree, in either locale: `grep` for
/// `updateRequired` over all four files answered 0.
///
/// So a Tamil user of a Tamil app, on the one screen that REPLACES THE WHOLE APP
/// and cannot be dismissed, met an English wall with an English button. The
/// three sibling widgets on this shelf — [PaywallGate], `PromoObjectionControl`
/// and `PromoSurface` — were all passed their copy properly at every call site;
/// this one never was, and nothing noticed for as long as the defaults were here
/// to be silently used.
///
/// ⚠️ AND NO CHECK COULD HAVE NOTICED. `tooling/ci/assert-no-hardcoded-strings.mjs`
/// scans exactly two roots — the brick and `apps/subly/lib` (`:119-131`) — and
/// not `packages/`. A user-visible English literal living here is outside the
/// only guard that hunts for one. Making the copy REQUIRED is what puts the
/// string back inside a scanned tree: the caller must supply it, and the caller
/// is in `apps/` or in the brick. A missing translation is now a COMPILE ERROR
/// at the call site rather than English on a user's screen.
class ForceUpdateGate extends StatelessWidget {
  const ForceUpdateGate({
    super.key,
    required this.mustUpdate,
    required this.child,
    required this.title,
    required this.message,
    required this.buttonLabel,
    this.onUpdate,
  });

  /// Whether the running version is below the supported floor.
  final bool mustUpdate;

  /// The normal app content, shown when no update is required.
  final Widget child;

  /// Invoked when the user taps the update button (e.g. open the store listing).
  /// When null the button is hidden (the screen still blocks the app).
  final VoidCallback? onUpdate;

  final String title;
  final String message;
  final String buttonLabel;

  @override
  Widget build(BuildContext context) {
    if (!mustUpdate) return child;
    final ThemeData theme = Theme.of(context);
    return Scaffold(
      body: SafeArea(
        // KEEPS `Center`, and takes only the WIDTH from the chassis. This is
        // one of the three shapes where vertical centring is the design rather
        // than an accident: the screen is otherwise empty and the card is the
        // only thing on it, so it belongs in the middle. A `ContentPane` here
        // would pin an update wall to the top of a blank screen. The literal
        // 420 is gone either way — that was the copy.
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(Icons.system_update_outlined,
                      size: 56, color: theme.colorScheme.primary),
                  const SizedBox(height: 20),
                  Text(title,
                      style: theme.textTheme.headlineSmall,
                      textAlign: TextAlign.center),
                  const SizedBox(height: 10),
                  Text(message,
                      style: theme.textTheme.bodyMedium,
                      textAlign: TextAlign.center),
                  if (onUpdate != null) ...<Widget>[
                    const SizedBox(height: 28),
                    FilledButton(onPressed: onUpdate, child: Text(buttonLabel)),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
