import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/async_gate.dart';
import '../shared/failure_copy.dart';

// ⏱ 2026-10-01 · DE-07 — "STOP A CHARGE", THE FLOW THE DESIGN DREW (D7-1..4).
// It replaces `features/cancel/cancel_sheet.dart`, a two-step "remove from
// tracker" sheet that was the only thing behind the detail's "Remove". The
// sheet's one honest rule is kept: NOTHING HERE CLAIMS TO CANCEL ANYTHING AT
// THE PROVIDER, and no money figure appears. What the user can do is:
//
//   · STOP IT — a walkthrough by HOW IT IS PAID (Google Play, App Store, card,
//     UPI Autopay, NACH / e-mandate, or the generic steps), then "Did it
//     work?", then Mark cancelled with the day they did it (`cancelled_on`);
//   · PAUSE IT — the row stays; reminders stop until Resume; Undo offered;
//   · I ALREADY CANCELLED — straight to the dated Mark cancelled;
//   · JUST REMOVE IT — the soft delete, with Undo (DE-10).
//
// Two surfaces host the ONE flow ([StopFlow]): the `/sub/:id/stop` route
// (deep-linkable, resolved case-insensitively like every route) and
// [showStopSheet], which the detail screen opens so its pane case — home's
// two-pane layout, where nothing was pushed — keeps working.

/// What the flow ended with — the caller's cue to leave the detail screen.
enum StopOutcome { stopped, paused, cancelled, removed }

/// The stop flow as a modal sheet over [sub]; completes with what happened,
/// or null when the user closed it having done nothing.
///
/// `useRootNavigator`, `isScrollControlled` and `useSafeArea` for the reasons
/// the retired cancel sheet measured: one scrim over the whole window from
/// either navigator level, and a sheet that asks for the height it needs on a
/// short landscape phone at a large text scale.
Future<StopOutcome?> showStopSheet(BuildContext context, Subscription sub) {
  return showModalBottomSheet<StopOutcome>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.transparent,
    // The scheme's own bottom-sheet slot in BOTH brightnesses, at the
    // foundation's sheet radius — the surface the cancel sheet measured.
    builder: (BuildContext sheet) => DecoratedBox(
      decoration: BoxDecoration(
        color: Theme.of(sheet).colorScheme.surfaceContainerLow,
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(AppRadius.xl),
        ),
      ),
      child: StopFlow(
        sub: sub,
        onFinished: (StopOutcome? outcome) => Navigator.of(sheet).pop(outcome),
      ),
    ),
  );
}

/// `/sub/:id/stop` — the same flow as a page, for a deep link.
///
/// The row is looked up the way the detail screen looks it up, with the same
/// loading / failed / not-found states, and the app bar stays in every one of
/// them: a deep link has no other way back.
class StopScreen extends ConsumerWidget {
  const StopScreen({super.key, required this.id});

  final String id;

  /// Off the page: back where the user came from, or — on a deep link,
  /// whose stack is one entry — to the row's detail; a removed row has no
  /// detail to go back to, so home.
  void _leave(BuildContext context, StopOutcome? outcome) {
    if (outcome == StopOutcome.removed) {
      context.go('/home');
    } else if (context.canPop()) {
      context.pop();
    } else {
      context.go('/sub/$id');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Widget? state = subscriptionsState(
      ref,
      l10n: l10n,
      emptyTitle: l10n.subscriptionNotFound,
    );
    if (state != null) {
      return Scaffold(appBar: AppBar(elevation: 0), body: state);
    }
    final Subscription? sub = ref
        .watch(subscriptionsControllerProvider)
        .requireValue
        .where((Subscription s) => s.id == id)
        .firstOrNull;
    if (sub == null) {
      return Scaffold(
        appBar: AppBar(elevation: 0),
        body: DataStateView.empty(title: l10n.subscriptionNotFound),
      );
    }
    return Scaffold(
      // 🔴 AN EXPLICIT BACK, because a deep link has nothing under it and the
      // automatic one would not be built — a flow with no way out.
      appBar: AppBar(
        elevation: 0,
        leading: BackButton(onPressed: () => _leave(context, null)),
      ),
      body: ContentPane.reading(
        key: const Key('stop-body-pane'),
        child: StopFlow(
          sub: sub,
          onFinished: (StopOutcome? outcome) => _leave(context, outcome),
        ),
      ),
    );
  }
}

enum _Step { choose, walkthrough, didItWork, done }

/// The flow itself: choose → (walkthrough → did it work →) done.
class StopFlow extends ConsumerStatefulWidget {
  const StopFlow({super.key, required this.sub, required this.onFinished});

  final Subscription sub;

  /// Called once, when the flow is over; null = nothing was changed.
  final void Function(StopOutcome? outcome) onFinished;

  @override
  ConsumerState<StopFlow> createState() => _StopFlowState();
}

class _StopFlowState extends ConsumerState<StopFlow> {
  _Step _step = _Step.choose;
  bool _busy = false;
  String? _failure;
  late DateTime _cancelledOn = DateUtils.dateOnly(ref.read(nowProvider)());

  /// The step heading's focus (ST truth pass, DE-12, carried over from the
  /// retired cancel sheet). A step change REPLACES the control the keyboard
  /// and the reader were on, so focus went nowhere and nothing was said; it
  /// lands on the new step's heading, which is a live region.
  final FocusNode _stepHeading = FocusNode(debugLabel: 'stop-step');

  @override
  void dispose() {
    _stepHeading.dispose();
    super.dispose();
  }

  /// Moves to [next] and puts focus on its heading once it is built.
  void _go(_Step next) {
    setState(() => _step = next);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _stepHeading.requestFocus();
    });
  }

  SubscriptionsController get _ctl =>
      ref.read(subscriptionsControllerProvider.notifier);

  /// Runs [write]; on failure the flow STAYS where it is and says why, inline
  /// — a snackbar on this root-mounted sheet would draw under its own scrim.
  Future<bool> _run(Future<void> Function() write) async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await write();
      if (mounted) setState(() => _busy = false);
      return true;
    } on Object catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _failure = writeFailureMessage(l10n, e);
        });
      }
      return false;
    }
  }

  Future<void> _pause() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final SubscriptionsController ctl = _ctl;
    final Subscription s = widget.sub;
    if (!await _run(() => ctl.pauseSubscription(s.id))) return;
    messenger?.showSnackBar(
      SnackBar(
        content: Text(l10n.subscriptionPaused(s.name)),
        action: SnackBarAction(
          key: E2EKeys.snackUndo,
          label: l10n.undo,
          onPressed: () => ctl.restoreStatus(s),
        ),
      ),
    );
    widget.onFinished(StopOutcome.paused);
  }

  Future<void> _markCancelled() async {
    final Subscription s = widget.sub;
    final SubscriptionsController ctl = _ctl;
    final DateTime on = _cancelledOn;
    if (!await _run(() => ctl.markCancelled(s.id, on: on))) return;
    if (mounted) _go(_Step.done);
  }

  Future<void> _remove() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final SubscriptionsController ctl = _ctl;
    final Subscription s = widget.sub;
    if (!await _run(() => ctl.cancelSubscription(s.id))) return;
    messenger?.showSnackBar(
      SnackBar(
        content: Text(l10n.subscriptionDeleted(s.name)),
        action: ctl.canUndoDelete(s.id)
            ? SnackBarAction(
                key: E2EKeys.snackUndo,
                label: l10n.undo,
                onPressed: () => ctl.undoDelete(s.id),
              )
            : null,
      ),
    );
    widget.onFinished(StopOutcome.removed);
  }

  Future<void> _pickDate() async {
    final DateTime today = DateUtils.dateOnly(ref.read(nowProvider)());
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _cancelledOn,
      firstDate: DateTime(2000),
      lastDate: today,
    );
    if (picked != null && mounted) setState(() => _cancelledOn = picked);
  }

  @override
  Widget build(BuildContext context) {
    final ({List<Widget> copy, List<Widget> actions}) step = switch (_step) {
      _Step.choose => (copy: _choose(context), actions: const <Widget>[]),
      _Step.walkthrough => _walkthrough(context),
      _Step.didItWork => _didItWork(context),
      _Step.done => _done(context),
    };
    final String? failure = _failure;
    // 🔴 THE COPY SCROLLS; THE ACTIONS DO NOT — the retired cancel sheet's
    // measured rule, kept. `MinimumTapTargetGuideline` skips every target
    // under a scrollable, so a button inside the scroll view would leave the
    // a11y suite's 48×48 sweep inspecting nothing; outside it, the button is
    // measured AND stays on screen however long the copy is. The choose
    // step's four answers are rows of copy and control at once, so they
    // scroll with the question (they are measured by rect in the a11y suite).
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Flexible(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.xl,
              AppSpacing.xl,
              AppSpacing.xl,
              AppSpacing.lg,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                ...step.copy,
                if (failure != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.lg),
                  DecisionStrip(
                    key: E2EKeys.stopFailure,
                    kind: StatusKind.danger,
                    message: failure,
                  ),
                ],
              ],
            ),
          ),
        ),
        if (step.actions.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.xl,
              0,
              AppSpacing.xl,
              AppSpacing.xxl,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: step.actions,
            ),
          )
        else
          const SizedBox(height: AppSpacing.lg),
      ],
    );
  }

  Widget _title(BuildContext context, String text) {
    final ThemeData theme = Theme.of(context);
    return Semantics(
      key: const Key('stop.step.heading'),
      header: true,
      // The first step is the sheet opening, which the route announces; every
      // later one is a change the reader must hear (DE-12).
      liveRegion: _step != _Step.choose,
      child: Focus(
        focusNode: _stepHeading,
        child: Text(
          text,
          style: theme.textTheme.headlineSmall?.copyWith(
            color: theme.colorScheme.onSurface,
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, String text) {
    final ThemeData theme = Theme.of(context);
    return Text(
      text,
      style: theme.textTheme.bodyMedium?.copyWith(
        color: theme.colorScheme.onSurfaceVariant,
      ),
    );
  }

  List<Widget> _choose(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Subscription s = widget.sub;
    final bool charging = s.isCharging;
    Widget choice(
      Key key,
      IconData icon,
      String title,
      String detail,
      VoidCallback onTap,
    ) => AppListRow(
      key: key,
      leading: Icon(icon),
      title: title,
      subtitle: detail,
      subtitleMaxLines: 3,
      titleMaxLines: 2,
      onTap: _busy ? null : onTap,
    );
    return <Widget>[
      _title(context, l10n.stopChooseTitle(s.name)),
      const SizedBox(height: AppSpacing.lg),
      AppCard(
        padding: EdgeInsets.zero,
        child: Column(
          children: <Widget>[
            if (s.status != SubscriptionStatus.cancelled) ...<Widget>[
              choice(
                E2EKeys.stopChoiceStop,
                Icons.block,
                l10n.stopChoiceStop,
                l10n.stopChoiceStopDetail,
                () => _go(_Step.walkthrough),
              ),
              const Divider(height: 1),
            ],
            if (charging) ...<Widget>[
              choice(
                E2EKeys.stopChoicePause,
                Icons.pause,
                l10n.stopChoicePause,
                l10n.stopChoicePauseDetail,
                _pause,
              ),
              const Divider(height: 1),
            ],
            if (s.status != SubscriptionStatus.cancelled) ...<Widget>[
              choice(
                E2EKeys.stopChoiceCancelled,
                Icons.event_busy,
                l10n.stopChoiceAlreadyCancelled,
                l10n.stopChoiceAlreadyCancelledDetail,
                () => _go(_Step.didItWork),
              ),
              const Divider(height: 1),
            ],
            choice(
              E2EKeys.stopChoiceRemove,
              Icons.delete_outline,
              l10n.stopChoiceRemove,
              l10n.stopChoiceRemoveDetail,
              _remove,
            ),
          ],
        ),
      ),
    ];
  }

  ({List<Widget> copy, List<Widget> actions}) _walkthrough(
    BuildContext context,
  ) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final Subscription s = widget.sub;
    final List<String> steps = stopSteps(l10n, s);
    return (
      copy: <Widget>[
        _title(context, l10n.stopWalkthroughTitle(s.name)),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          key: Key('stop-walkthrough-${s.rail?.wire ?? 'generic'}'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              for (int i = 0; i < steps.length; i++) ...<Widget>[
                if (i > 0) const SizedBox(height: AppSpacing.md),
                Text('${i + 1}. ${steps[i]}'),
              ],
            ],
          ),
        ),
      ],
      actions: <Widget>[
        FilledButton(
          key: E2EKeys.stopNext,
          style: _buttonShape,
          onPressed: () => _go(_Step.didItWork),
          child: Text(l10n.stopDidItWork),
        ),
      ],
    );
  }

  ({List<Widget> copy, List<Widget> actions}) _didItWork(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return (
      copy: <Widget>[
        _title(context, l10n.stopDidItWork),
        const SizedBox(height: AppSpacing.sm),
        _body(context, l10n.stopDidItWorkBody),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          padding: EdgeInsets.zero,
          child: AppListRow(
            key: E2EKeys.stopCancelledOn,
            title: l10n.detailCancelledOnLabel,
            figure: DateFormat.yMMMd(l10n.localeName).format(_cancelledOn),
            onTap: _busy ? null : _pickDate,
          ),
        ),
      ],
      actions: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: OutlinedButton(
                key: E2EKeys.stopNotYet,
                style: _buttonShape,
                onPressed: _busy ? null : () => widget.onFinished(null),
                child: Text(l10n.stopNotYet),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: FilledButton(
                key: E2EKeys.stopItWorked,
                style: _buttonShape,
                onPressed: _busy ? null : _markCancelled,
                child: Text(l10n.stopItWorked),
              ),
            ),
          ],
        ),
      ],
    );
  }

  ({List<Widget> copy, List<Widget> actions}) _done(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    return (
      copy: <Widget>[
        _title(context, l10n.stopDoneTitle(widget.sub.name)),
        const SizedBox(height: AppSpacing.sm),
        _body(context, l10n.stopDoneBody),
      ],
      actions: <Widget>[
        FilledButton(
          key: E2EKeys.stopDone,
          style: _buttonShape,
          onPressed: () => widget.onFinished(StopOutcome.cancelled),
          child: Text(l10n.done),
        ),
      ],
    );
  }

  /// Every action: a full 48 px row — the tap-target floor, as a height — at
  /// the control radius the foundation gives anything inside a card or sheet
  /// (the cancel sheet's shape, kept).
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

/// The walkthrough for [s], by how it is paid. Every line is in the arb and
/// none of them claims the app cancels anything (rule R3; the forbidden-copy
/// guard `tooling/ci/assert-stop-copy.mjs` reads them).
@visibleForTesting
List<String> stopSteps(AppLocalizations l10n, Subscription s) =>
    switch (s.rail) {
      PaymentRail.play => <String>[
        l10n.stopPlayStep1,
        l10n.stopPlayStep2,
        l10n.stopPlayStep3(s.name),
      ],
      PaymentRail.appStore => <String>[
        l10n.stopAppStoreStep1,
        l10n.stopAppStoreStep2,
        l10n.stopAppStoreStep3(s.name),
      ],
      PaymentRail.cardEmandate => <String>[
        l10n.stopProviderFirst(s.name),
        l10n.stopCardStep2(s.name),
        l10n.stopKeepConfirmation,
      ],
      PaymentRail.upiAutopay => <String>[
        l10n.stopProviderFirst(s.name),
        l10n.stopUpiStep2(s.name),
        l10n.stopKeepConfirmation,
      ],
      PaymentRail.nach => <String>[
        l10n.stopProviderFirst(s.name),
        l10n.stopNachStep2(s.name),
        l10n.stopKeepConfirmation,
      ],
      _ => <String>[
        l10n.howToCancelStep1,
        l10n.howToCancelStep2,
        l10n.howToCancelStep3,
      ],
    };
