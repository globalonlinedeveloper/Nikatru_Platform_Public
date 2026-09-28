import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/widgets.dart';

// ST-U3 (B32 interim) — THIS SHEET REMOVES A ROW FROM THE TRACKER, AND SAYS
// ONLY THAT. It used to read "Cancel {name}?", "You'll save {monthly}/mo ·
// {yearly}/yr. Access continues until {date}." and "You're now saving … Nicely
// done." — while its only effect was deleting the row from this app's list. A
// user could believe the provider had stopped charging them; the savings were
// invented; "access continues until" is a provider policy this app cannot
// know. It was also the ONLY delete path, so removing a mistyped entry
// congratulated the user on savings. Until ST-E3 splits "Mark as cancelled"
// from "Delete", the copy names the one thing that happens and points at the
// provider for the thing that does not. No money figure appears on this sheet.
//
// ⏱ 2026-09-29 · train ST-D7 ("Stop a charge") rebuilt the sheet on the ST-D0
// foundation and kept this rule: its draft still carried the savings
// sentences and a price figure, both dropped when it was fitted to this base.

/// Opens the remove sheet and completes with WHETHER THE ROW WAS REMOVED.
///
/// ✅ ST-U8 (B15): it completed with `void`, so the detail screen dismissed
/// itself after EVERY close — "Keep it", a swipe, a tap on the scrim — and a
/// user who decided to keep the plan was thrown off the screen they were on.
/// The answer is recorded by the sheet the moment the delete succeeds, not
/// read from the pop result, so a swipe-away AFTER a successful removal still
/// reports true.
Future<bool> showCancelSheet(BuildContext context, Subscription sub) async {
  bool removed = false;
  await showModalBottomSheet<void>(
    context: context,
    // 🔴 THE SHEET HAS TWO CALLERS ON DIFFERENT NAVIGATOR LEVELS, and without
    // this they mount on different navigators. `insights_screen.dart` calls
    // from inside a shell BRANCH navigator, so the modal scrim covered only the
    // branch — and under the chassis rail/drawer the same call would dim only
    // the body pane beside the rail. `subscription_detail_screen.dart` calls
    // from the ROOT and scrims the whole window. One destructive confirmation
    // that dims different amounts of the app depending on where it was opened
    // from is not a style difference: the scrim is what says "answer this
    // first", and a nav bar left live above it is a way out of the question.
    //
    // ⚠️ RETRACTED 2026-08-11: this said the branch scrim was drawn over by
    // "AppShell's floating pill … a later `Stack` child". That WAS true and is
    // not — the pill is handed to `AppScaffold` through the
    // `compactNavigationBar` seam (`app_shell.dart:206`) and lands in its
    // `bottomNavigationBar` slot, so it is no longer a sibling in the body
    // `Stack`. The REASON to pin the root is unchanged and never depended on
    // the pill: a branch navigator scrims only its own branch.
    //
    // Pinning it to the root unifies both. The dismiss paths are unaffected —
    // `Navigator.of(context)` inside the sheet resolves from the SHEET's own
    // route context, which is now the root route, so 'Keep it' and 'Done' still
    // pop exactly the sheet. That is asserted, not argued: see the two
    // mount-level cases in `test/width_cancel_sheet_test.dart`.
    useRootNavigator: true,
    // 🔴 THE SHEET CLIPPED ITS OWN BUTTONS ON A SHORT VIEWPORT — AND THE BUTTON
    // ROW IS NOT THE CAUSE. Measured 2026-08-21 at textScaler 1.3 on a 740×360
    // landscape phone: the step-0 `Column` overflowed by 137 px on the BOTTOM,
    // and the button row laid out at y 416.5–466.5 — wholly below a 360 px
    // screen, so 'Keep it' and 'Confirm cancel' were unreachable. The row is two
    // `Expanded`s and cannot overflow horizontally at any scale; what ran out
    // was HEIGHT. With the default `isScrollControlled: false`,
    // `showModalBottomSheet` caps the sheet at 9/16 of the window — 202.5 px
    // there, against ~340 px of content.
    //
    // This lets the sheet ask for the height it needs. It is not enough on its
    // own — measured with this line alone and no scroll view, a 375×667 phone at
    // scale 2.0 still overflowed by 80 px and 740×360 at 2.0 by 152 px, because
    // the content is then taller than the WHOLE window rather than taller than
    // 9/16 of it. That is what the `Flexible` + `SingleChildScrollView` around
    // the COPY in `build` is for; read the comment there for why the buttons are
    // deliberately outside it. Both halves are mutation-tested in
    // `sheet_failure_surface_test.dart` — each has a case the other's does not
    // catch.
    //
    // Nothing moves at ordinary sizes: `SingleChildScrollView` sizes itself to
    // its child within the incoming constraints, so the sheet still shrink-wraps
    // — 375×812 at 1.3 threw nothing before this change and is 339 px tall
    // either way.
    isScrollControlled: true,
    // With the 9/16 cap gone, a sheet tall enough to fill the window would run
    // under the status bar. This insets it by the real `MediaQuery` padding —
    // no number of ours.
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _CancelSheet(sub: sub, onRemoved: () => removed = true),
  );
  return removed;
}

/// Why a stop did not happen — the two failure states this sheet tells apart.
///
/// OFFLINE is "the request never got an answer" ([ApiException.isOffline]);
/// FAILED is everything else. They are different states because they have
/// different remedies: offline, the user fixes their connection; failed, the
/// user can only try again later. Neither is ever shown as success.
enum _Failure { failed, offline }

/// "STOP A CHARGE" — the destructive confirmation for one subscription, and
/// its outcome (train ST-D7, on the ST-D0 foundation).
///
/// ## Its states
///  * **populated** — the question: which entry ([AppListRow] in an
///    [AppCard], the same name and glyph the user tapped to get here), what
///    removing it does and does not do, and the two answers.
///  * **loading** — the confirm reads "Cancelling…" and is disabled; the way
///    out ('Keep it') stays live.
///  * **failed / offline** — an inline [DecisionStrip] above the answers says
///    the charge was NOT stopped, in the danger or warn tone; the confirm is the
///    retry. It used to be a snack bar, which on this root-mounted sheet drew
///    UNDER the scrim — the one failure a user must read, painted behind the
///    question it failed to answer.
///  * **done** — the entry is gone, a reminder that the provider still bills
///    until it is cancelled there, and one way out.
///
/// There is no EMPTY state: the sheet is opened on one subscription, and a
/// sheet with nothing to stop is not reachable.
///
/// Every colour is a scheme slot or a [StatusTones] half; every size is an
/// [AppSpacing] / [AppRadius] step or a theme type role. The pre-dark
/// light-palette fork (`_SheetPalette`, `AppColors.bg` in light) is gone: the
/// foundation's scheme slots are one design in both brightnesses.
class _CancelSheet extends ConsumerStatefulWidget {
  const _CancelSheet({required this.sub, required this.onRemoved});
  final Subscription sub;

  /// Called once, when the delete has succeeded — see [showCancelSheet].
  final VoidCallback onRemoved;

  @override
  ConsumerState<_CancelSheet> createState() => _CancelSheetState();
}

class _CancelSheetState extends ConsumerState<_CancelSheet> {
  int _step = 0;
  bool _busy = false;
  _Failure? _failure;

  Future<void> _confirm() async {
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .cancelSubscription(widget.sub.id);
      widget.onRemoved();
      if (!mounted) return;
      setState(() {
        _busy = false;
        _step = 1;
      });
    } catch (e) {
      // 🔴 THIS FAILURE PATH DID NOT EXIST, and the stakes here are higher than
      // in the add sheet: the awaited call reaches the network, so offline it
      // threw out of an unawaited future and the button stayed disabled on
      // 'Cancelling…' forever. Advancing to step 1 regardless would have been
      // worse still — that screen says the entry is gone when it is not.
      if (!mounted) return;
      setState(() {
        _busy = false;
        _failure = ApiException.isOfflineError(e)
            ? _Failure.offline
            : _Failure.failed;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    return DecoratedBox(
      // The sheet is the scheme's own bottom-sheet slot in BOTH brightnesses
      // (Material 3's default for a modal sheet), so the [AppCard] inside it
      // lifts off it the way a card lifts off a scaffold.
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadius.xl),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.xl,
          AppSpacing.xl,
          AppSpacing.xl,
          AppSpacing.xxl,
        ),
        child: _step == 0 ? _question(context) : _outcome(context),
      ),
    );
  }

  Widget _question(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final StatusTones tones = StatusTones.of(context);
    final Subscription s = widget.sub;
    final _Failure? failure = _failure;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // 🔴 THE COPY SCROLLS; THE ACTION ROW DOES NOT MOVE. Wrapping the
        // WHOLE sheet in one scroll view fixed the clip and cost something
        // that is not worth it: `MinimumTapTargetGuideline` skips any target
        // under an ancestor with `hasImplicitScrolling`
        // (`_accessibility_evaluations.dart:132`), so with the buttons inside
        // the viewport `a11y_semantics_test.dart`'s 48×48 sweep of this sheet
        // went from 2 inspected nodes to 0 — a guard that passes because it
        // looked at nothing, which is the failure mode this repo has been
        // bitten by most. Measured both ways on 2026-08-21.
        //
        // Scrolling only the copy keeps the two buttons out of the viewport,
        // so they stay inspectable AND stay on screen: a destructive
        // confirmation whose 'Keep it' can be scrolled out of reach is worse
        // than one whose reason can.
        //
        // `Flexible` (loose fit) is what makes it shrink ONLY when it has to.
        // With room to spare the scroll view still sizes to its child, so the
        // sheet's height and every rect in it are unchanged.
        Flexible(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  l10n.cancelSubscriptionTitle(s.name),
                  style: text.headlineSmall?.copyWith(color: scheme.onSurface),
                ),
                const SizedBox(height: AppSpacing.lg),
                // THE ENTRY, as the row the user tapped to get here: the same
                // name and glyph, so the question cannot be misread as being
                // about a different plan. Not tappable — it is the subject of
                // the sheet, not a way off it. No figure: see ST-U3 above.
                AppCard(
                  padding: EdgeInsets.zero,
                  child: AppListRow(
                    leading: GlyphTile(
                      glyph: s.glyph,
                      size: AppListRow.leadingSize,
                      fontSize: AppTypeRamp.minimumSize,
                    ),
                    title: s.name,
                    subtitle: s.category,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  l10n.removeStep1Body,
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
                if (failure != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.lg),
                  // The charge was NOT stopped, said where the user is looking.
                  // No answers on the strip: the confirm below IS the retry,
                  // and a second "try again" beside it would be two controls
                  // for one act.
                  DecisionStrip(
                    key: E2EKeys.cancelFailure,
                    kind: failure == _Failure.offline
                        ? StatusKind.warn
                        : StatusKind.danger,
                    message: failure == _Failure.offline
                        ? l10n.offlineMessage
                        : l10n.cancelSubscriptionFailed,
                    detail: failure == _Failure.offline
                        ? l10n.cancelSubscriptionFailed
                        : null,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton(
                key: E2EKeys.cancelKeep,
                style: _buttonShape,
                onPressed: () => Navigator.of(context).pop(),
                child: Text(l10n.keepPlan),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: FilledButton(
                key: E2EKeys.cancelConfirm,
                onPressed: _busy ? null : _confirm,
                style: _buttonShape.merge(
                  FilledButton.styleFrom(
                    backgroundColor: tones.danger,
                    // 🔴 THE LABEL IS THE DANGER TINT, NOT WHITE. The fill is
                    // the scheme-forked danger TONE, which is a deep red in
                    // light and a light rose in dark — white on the dark
                    // rose is ~2:1. Its own opaque tint is the pair's other
                    // half and reads on it in both schemes; measured in
                    // `test/stop_a_charge_test.dart`.
                    foregroundColor: tones.dangerTint,
                  ),
                ),
                child: Text(
                  _busy ? l10n.cancellingEllipsis : l10n.confirmCancel,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _outcome(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final StatusTones tones = StatusTones.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Same shape as step 0, and for the same two reasons: 'Done' is the
        // only way out of this step, and it is the only tap target on it.
        Flexible(
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // Decorative: the heading beside it says what happened.
                ExcludeSemantics(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: tones.positiveTint,
                      shape: BoxShape.circle,
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      child: Icon(Icons.check_rounded, color: tones.positive),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Text(
                  l10n.cancelledHeading,
                  textAlign: TextAlign.center,
                  style: text.headlineSmall?.copyWith(color: scheme.onSurface),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  l10n.removeStep2Body,
                  textAlign: TextAlign.center,
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.xl),
        FilledButton(
          key: E2EKeys.cancelDone,
          style: _buttonShape,
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.done),
        ),
      ],
    );
  }

  /// Both answers and 'Done': a full 48 px row — the tap-target floor, as a
  /// height — at the control radius the foundation gives anything inside a
  /// card or a sheet.
  static final ButtonStyle _buttonShape = ButtonStyle(
    minimumSize: const WidgetStatePropertyAll<Size>(
      Size.fromHeight(AppSpacing.xxxl),
    ),
    shape: WidgetStatePropertyAll<OutlinedBorder>(
      RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.control),
      ),
    ),
  );
}
