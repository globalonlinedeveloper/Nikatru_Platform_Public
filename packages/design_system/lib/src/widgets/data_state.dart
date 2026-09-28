import 'package:flutter/material.dart';

import '../tokens/app_spacing.dart';
import 'app_scaffold.dart' show AppBreakpoints;

/// Which of the three things that can be true of a data-backed surface is
/// true right now. Private because the CONSTRUCTOR is the vocabulary — a
/// caller says `DataStateView.failed(...)`, never `DataStateView(state: ...)`,
/// so there is no way to build a "failed" view and forget the retry control.
enum _DataState { loading, empty, failed }

/// The three states a data-backed surface can be in, drawn so that **no two of
/// them look alike.**
///
/// ═══════════════════════════════════════════════════════════════════════════
/// 🔴 WHY THIS EXISTS — A FAILED LOAD WAS RENDERING AS "YOU HAVE NOTHING"
/// ═══════════════════════════════════════════════════════════════════════════
/// Five surfaces in `apps/subscriptiontracker` read their list as
/// `ref.watch(subscriptionsControllerProvider).valueOrNull ?? const []`
/// (budget:131, calendar:116, detail:108, insights:234, notifications:47).
/// `valueOrNull` is null while a fetch is IN FLIGHT and null when it has
/// FAILED, and `?? const []` collapses both of those into the third thing
/// entirely — an empty list, which is the honest rendering of neither.
///
/// So a user whose network died was told, in a calm empty-state voice, that
/// they have no subscriptions. That is not a missing spinner; it is the app
/// asserting something false about the user's own data, and it is worse than
/// an error because an error invites a retry and this invited acceptance.
/// Nothing raised, nothing clipped, no assertion failed — the defect was only
/// ever visible to a measurement, which is why it survived ten PRs of
/// foundation work.
///
/// ── THE RULE THIS WIDGET ENFORCES BY CONSTRUCTION ──────────────────────────
/// EMPTY AND FAILED MUST NEVER RENDER IDENTICALLY. They differ here in three
/// independent ways, so no single regression can quietly merge them:
///   · a different GLYPH (an inbox outline vs `Icons.cloud_off`),
///   · a different TONE (`onSurfaceVariant` vs `error`),
///   · and failed carries a RETRY CONTROL that empty structurally cannot have
///     — [DataStateView.empty] has no `onRetry` parameter to pass.
/// The third is the load-bearing one: the first two are colours and could be
/// made equal by a theme edit, but a constructor that does not accept a
/// callback cannot grow a button by accident.
///
/// ── WHY IT LIVES IN THE DESIGN SYSTEM AND NOT IN THE APP ───────────────────
/// `OfflineNotice` records the opposite mistake and this widget is shaped by
/// it: that widget shipped on 2026-07-28 into `system_screens.dart` with ZERO
/// consumers anywhere in the repository and stayed that way until 2026-08-06 —
/// nine days of a treatment that existed and protected nobody. A shared
/// loading treatment has the same failure mode and a wider blast radius, so
/// this one lands WIRED: the change that introduces it also consumes it on all
/// five screens named above. A design-system widget with no call site is not a
/// head start, it is dead weight that reads as done.
///
/// It is in `packages/design_system` rather than in
/// `apps/subscriptiontracker/lib/features/shared/` because the brick template
/// stamps every future app from a tree that has no `features/shared/`, and the
/// defect being fixed here is one every stamped app inherits the moment it
/// reads a provider. `assert-a11y-coverage.mjs` and
/// `assert-responsive-coverage.mjs` both make every PUBLIC widget class in this
/// package part of their domain by construction, so putting it here also puts
/// it under both guards on arrival.
///
/// ── 🔴 EVERY STRING IS HANDED IN, NONE IS DEFAULTED TO ENGLISH ─────────────
/// The same rule [DestructiveConfirmDialog] and [DestructiveOutcomeNotice]
/// carry, and for the same measured reason: a `?? 'Retry'` fallback renders an
/// English word on a Tamil screen and no test can see it, because the fallback
/// is only reached when the caller forgot — which is exactly when nobody is
/// looking. [OfflineNotice] still has one (`retryLabel ?? 'Retry'`) and it is
/// NOT copied here. This widget names no `nikatru_*` l10n type either; the host
/// app owns its own [AppLocalizations] and hands the sentences down.
///
/// ── ⚠️ THE LOADING BRANCH NEVER SETTLES ────────────────────────────────────
/// An indeterminate [CircularProgressIndicator] animates forever, so a test
/// that pumps this state must use `tester.pump()` and NOT `pumpAndSettle()`,
/// which will time out rather than fail with anything that names the cause.
/// `data_state_test.dart` says so at each call site too.
///
/// ── ⚠️ THE RAW EXCEPTION IS NOT A PARAMETER, AND THAT IS DELIBERATE ────────
/// `home_screen.dart:479` records the live defect: `l10n.couldNotLoad('$e')`
/// interpolates the raw exception into a sentence a user reads, and the arb key
/// preserves it verbatim. There is no slot on [DataStateView.failed] to pass an
/// exception into, so a caller migrating to this widget cannot carry the leak
/// across. [body] is a SENTENCE, not a stack-adjacent string, and the call
/// sites pass a localised one.
///
/// ── ✅ EMPTY MAY OFFER A WAY FORWARD — AND IT IS NOT A RETRY ───────────────
/// ST-U6 (the Subscription Tracker audit's B3/B42/C3, and its §8 finding that
/// no stamped app could offer "Add your first X"): an empty screen with nothing
/// to tap is a dead end on a first run. [DataStateView.empty] therefore takes
/// an optional [actionLabel] + [onAction] — both or neither — drawn as a
/// FILLED button under its own [emptyActionKey]. It is the opposite of a retry:
/// it says "this is the start, here is the first step", never "this failed".
/// [failed] cannot carry it, and [empty] still cannot carry a retry.
class DataStateView extends StatelessWidget {
  /// A fetch is in flight and there is nothing truthful to draw yet.
  ///
  /// [label] is announced rather than decorative — a spinner with no accessible
  /// name is a screen that says nothing at all to a reader who cannot see it
  /// spin, and "nothing at all" is indistinguishable from a finished empty
  /// screen. It is a required parameter for that reason.
  const DataStateView.loading({required this.label, super.key})
    : _state = _DataState.loading,
      title = null,
      body = null,
      icon = null,
      retryLabel = null,
      onRetry = null,
      actionLabel = null,
      onAction = null;

  /// The fetch SUCCEEDED and the answer is genuinely nothing.
  ///
  /// 🔴 THERE IS NO `onRetry` PARAMETER AND THERE MUST NEVER BE ONE. Offering
  /// a retry here tells the user their empty account is a malfunction, and it
  /// is the single edit that would make this state look like [failed].
  ///
  /// [actionLabel] and [onAction] are the FIRST STEP out of an empty state
  /// ("Add subscription"), both or neither — a label with nowhere to go is the
  /// dead control this parameter exists to remove, and a callback with no
  /// label is a button nobody can name.
  const DataStateView.empty({
    required String this.title,
    this.body,
    this.icon,
    this.actionLabel,
    this.onAction,
    super.key,
  }) : assert(
         (actionLabel == null) == (onAction == null),
         'DataStateView.empty takes actionLabel and onAction together, or neither',
       ),
       _state = _DataState.empty,
       label = null,
       retryLabel = null,
       onRetry = null;

  /// The fetch FAILED. The user is told so, and handed a way out.
  ///
  /// [onRetry] and [retryLabel] are both required: a failure the user can read
  /// but not act on is a dead end, and the dead end is what this whole widget
  /// exists to remove.
  const DataStateView.failed({
    required String this.title,
    required String this.retryLabel,
    required VoidCallback this.onRetry,
    this.body,
    super.key,
  }) : _state = _DataState.failed,
       label = null,
       icon = null,
       actionLabel = null,
       onAction = null;

  final _DataState _state;

  /// Announced while loading. Null in every other state.
  final String? label;

  /// The headline for [empty] and [failed]. Null while loading.
  final String? title;

  /// An optional second line. A SENTENCE — never an exception string; see the
  /// class doc.
  final String? body;

  /// [empty] only. Defaults to an inbox outline, which reads as "this container
  /// is empty" rather than as "something went wrong".
  final IconData? icon;

  final String? retryLabel;
  final VoidCallback? onRetry;

  /// [empty] only: the label of the first step out of the empty state.
  final String? actionLabel;

  /// [empty] only: what [actionLabel] does.
  final VoidCallback? onAction;

  /// Stable handles for the three states, so a test can assert WHICH ONE is on
  /// screen rather than inferring it from copy that translation will change.
  ///
  /// 🔴 THE POINT OF THESE IS THE NEGATIVE ASSERTION. `findsOneWidget` on the
  /// error key proves the error rendered; `findsNothing` on the EMPTY key in
  /// the same test is what proves the two did not collapse back together. A
  /// test that only checks the positive passes on the exact defect this widget
  /// was written to fix.
  static const Key loadingKey = Key('data-state-loading');
  static const Key emptyKey = Key('data-state-empty');
  static const Key failedKey = Key('data-state-failed');
  static const Key retryKey = Key('data-state-retry');
  static const Key emptyActionKey = Key('data-state-empty-action');

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;

    // 🔴 SCHEME SLOTS, NOT `AppColors` CONSTS, AND THIS WIDGET IS ALLOWED TO
    // DO THAT WHERE `AppCard` IS NOT. The pin on the card surface exists
    // because that decoration predates dark mode and the owner eyeballs the
    // light build against it — repainting it would move every card on every
    // screen at once. This widget has no pre-dark rendering to preserve: it is
    // new, so `onSurfaceVariant` and `error` are simply correct in both
    // brightnesses and there is no byte-identical light branch to keep.
    final Color muted = scheme.onSurfaceVariant;

    final Widget content = switch (_state) {
      _DataState.loading => _loading(theme, muted),
      _DataState.empty => _message(
        theme,
        key: emptyKey,
        glyph: icon ?? Icons.inbox_outlined,
        tone: muted,
        titleColor: scheme.onSurface,
        trailing: onAction == null
            ? null
            : FilledButton(
                key: emptyActionKey,
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
      ),
      _DataState.failed => _message(
        theme,
        key: failedKey,
        glyph: Icons.cloud_off,
        tone: scheme.error,
        titleColor: scheme.onSurface,
        trailing: FilledButton.tonal(
          key: retryKey,
          onPressed: onRetry,
          child: Text(retryLabel!),
        ),
      ),
    };

    // Centred and capped at `AppBreakpoints.form` (420), which is the design
    // system's own "how wide may this CONTENT get?" number for a short block of
    // centred prose — NOT one of the navigation breakpoints, which is the
    // conflation `AppBreakpoints`' own doc exists to prevent. Below 420 the cap
    // cannot bind (a `ConstrainedBox` may only tighten), so every phone renders
    // identically and only a tablet or desktop sees it work. Without it a
    // one-line message on a 1920 px window is a single sentence stretched edge
    // to edge with nothing beside it.
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: AppBreakpoints.form),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.xl,
            vertical: AppSpacing.xxxl,
          ),
          child: content,
        ),
      ),
    );
  }

  Widget _loading(ThemeData theme, Color muted) => Semantics(
    key: loadingKey,
    // `liveRegion` so a reader is TOLD the wait started. Without it the
    // announcement only happens if focus happens to land here, and on a fresh
    // route it does not.
    liveRegion: true,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // The label rides on the indicator rather than on a separate `Text`,
        // so there is exactly ONE node announcing the wait. A visible caption
        // plus a `semanticsLabel` announces it twice.
        CircularProgressIndicator(semanticsLabel: label),
        const SizedBox(height: AppSpacing.lg),
        Text(
          label!,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(color: muted),
        ),
      ],
    ),
  );

  Widget _message(
    ThemeData theme, {
    required Key key,
    required IconData glyph,
    required Color tone,
    required Color titleColor,
    Widget? trailing,
  }) => Column(
    key: key,
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      // 🔴 THE GLYPH IS DECORATIVE AND IS EXCLUDED, the same call `GlyphTile`
      // makes and for the same reason: it sits directly above the title as
      // text, so announcing it reads a meaningless token immediately before
      // the real one. The state is carried by the words and by the presence of
      // the retry button, both of which a reader gets.
      ExcludeSemantics(child: Icon(glyph, size: 40, color: tone)),
      const SizedBox(height: AppSpacing.lg),
      Text(
        title!,
        textAlign: TextAlign.center,
        style: theme.textTheme.titleMedium?.copyWith(color: titleColor),
      ),
      if (body != null) ...<Widget>[
        const SizedBox(height: AppSpacing.sm),
        Text(
          body!,
          textAlign: TextAlign.center,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
      if (trailing != null) ...<Widget>[
        const SizedBox(height: AppSpacing.xl),
        trailing,
      ],
    ],
  );
}
