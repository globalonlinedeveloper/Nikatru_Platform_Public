import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../core/format/money_format.dart';
import '../../data/models/payment_record.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../cancel/cancel_sheet.dart';
import '../shared/async_gate.dart';
import '../shared/cadence_label.dart';
import '../shared/due.dart';
import '../shell/app_shell.dart';
import 'reminder_rows.dart';

/// The page about ONE subscription: what it costs, when it next charges, what
/// it has charged, and the two things a user can do about it.
///
/// ⏱ 2026-09-28 · train ST-D5 — REBUILT ON THE DESIGN FOUNDATION, AND THE
/// BRIGHTNESS RULE THAT STOOD HERE IS RETIRED WITH THE LOOK IT PROTECTED. This
/// file used to keep every LIGHT colour as a literal (`AppColors.ink`,
/// `.muted`, `.surface`, `.line`) and derive only the dark arm, because the
/// light build was frozen for eyeballing. The design train is the change that
/// unfreezes it, so every colour, size and face below now comes from the
/// scheme, the type ramp, [AppSpacing]/[AppRadius] or [StatusTones] — in BOTH
/// brightnesses, with no `isLight` fork left in the file. What each piece is:
///
///   · THE HEADER is the chassis [AppDetailHeader]: a full-bleed
///     `surfaceContainer` band whose content is capped at
///     `AppBreakpoints.reading`, the same cap as the body below, so the title
///     and the first card start at one x at every width. It replaces a hero
///     of three fixed indigos with white literals on it — the one surface in
///     the app that did not follow the seed.
///   · THE FIGURES are two [AppFigureTile]s. The hand-rolled mini-cards
///     painted their label and caption at 10 px, under the 12 px floor.
///   · STATUS COLOURS NOW FORK BY SCHEME. They were one literal each in both
///     brightnesses — `AppColors.warn` on a white card is 2.15:1 — and are
///     the [StatusTones] half for the ambient scheme, still independent of
///     the seed, which was the half of the old rule that was right.
///   · THE PAYMENT HISTORY is a card of [AppListRow]s over
///     [paymentHistoryProvider], with its own loading, failed and empty
///     branches: it used to render "No payments yet" while loading AND when
///     the fetch failed, which offline — history is not cached — was every
///     visit.
///   · "CANCEL PLAN" is [AppButtonStyles.destructive]: the measured opaque
///     danger tint with the danger tone as ink, not a solid danger fill whose
///     ink was white in both schemes.
///
/// The golden per window class × theme is `test/detail_notifications_golden_test.dart`,
/// and one test per state is `test/detail_notifications_states_test.dart`.
class SubscriptionDetailScreen extends ConsumerWidget {
  const SubscriptionDetailScreen({super.key, required this.id, this.onClose});
  final String id;

  /// How this screen goes away — supplied by whoever put it on screen.
  ///
  /// 🔴 THIS SCREEN IS MOUNTED TWO WAYS AND ONLY ONE OF THEM COULD BE POPPED.
  /// GlitchTip SUBLY-9 / SUBLY-A (FATAL, 4+1 events, 2026-08-21 14:11–14:12Z,
  /// release `subly@1.0.220+350bd7f`): `GoError: There is nothing to pop`,
  /// thrown while handling a gesture, with the browser hash reading `#/home`
  /// and a 1920-wide landscape window.
  ///
  ///   · AS A ROUTE — `/sub/:id`, `context.push`ed from home (single-column
  ///     arm) and from calendar. There is something under it, so `pop` works.
  ///   · AS A PANE — `home_screen.dart` hands this widget straight to
  ///     `TwoPane.detail` once the body can split. NOTHING WAS PUSHED. The
  ///     location is still `/home`, whose stack is one match deep, and every
  ///     dismiss control on this screen called `context.pop()` unconditionally
  ///     — so on any window wide enough to show the two-pane layout, the back
  ///     arrow and "Edit plan" threw instead of doing anything. Four events in
  ///     39 seconds is one user pressing back and trying again.
  ///
  /// Null means the route case, which [_dismiss] still guards — see there.
  final VoidCallback? onClose;

  /// The one way off this screen, for all three controls.
  ///
  /// 🔴 IT IS A METHOD AND NOT THREE CALL SITES ON PURPOSE. The defect above
  /// was three independent `context.pop()`s that each looked correct in
  /// isolation; the property "this screen knows how it was mounted" has to live
  /// in one place or the next control added here reintroduces it.
  ///
  /// The `canPop` arm is NOT dead code for the route case, and that is the
  /// second, quieter half of the same bug. Web is on the HASH strategy (see
  /// `reset_password_screen.dart`), so `…/#/sub/abc` is a real, bookmarkable,
  /// reloadable URL — and a reload restores that location with a ONE-ENTRY
  /// stack. The back arrow of a freshly-loaded detail page therefore has
  /// nothing under it either. `/home` is where `/` redirects, so it is the
  /// same destination the browser's own back button would have reached.
  void _dismiss(BuildContext context) {
    final VoidCallback? close = onClose;
    if (close != null) {
      close();
      return;
    }
    if (context.canPop()) {
      context.pop();
      return;
    }
    context.go('/home');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final MoneyFormatter money = MoneyFormatter(l10n.localeName);
    // 🔴 THE APP BAR STAYS IN EVERY REPLACEMENT STATE. This route is reachable
    // by a bookmarked or reloaded URL (web is on the hash strategy — see
    // `_dismiss`), so on a cold load there is no in-app chrome anywhere else on
    // screen. A bare `DataStateView` with no `Scaffold` around it would be a
    // failure message with no way back, which is the dead end `_dismiss` and
    // `home_screen.dart` both exist to prevent.
    //
    // ⚠️ `subscriptionNotFound` IS PASSED AS THE **EMPTY** TITLE, so a user
    // holding zero subscriptions who opens a detail URL is told the record is
    // missing rather than that their account is. It is the same sentence the
    // branch below prints for an id that is absent from a NON-empty list, and
    // deliberately so: from the reader's side the two are one fact.
    final Widget? state = subscriptionsState(
      ref,
      l10n: l10n,
      emptyTitle: l10n.subscriptionNotFound,
    );
    if (state != null) {
      return Scaffold(appBar: AppBar(elevation: 0), body: state);
    }
    final List<Subscription> subs = ref
        .watch(subscriptionsControllerProvider)
        .requireValue;
    Subscription? sub;
    for (final Subscription s in subs) {
      if (s.id == id) {
        sub = s;
        break;
      }
    }
    if (sub == null) {
      // 🔴 REACHED ONLY ON A SUCCESSFUL FETCH, which is what makes the
      // sentence true. `subscriptionNotFound`, deliberately NOT the chassis
      // `notFoundTitle`, which is the router's "page not found"; told apart
      // from the failure state above by its KEY (`DataStateView.emptyKey` vs
      // `.failedKey`) rather than by copy a translator is free to change.
      return Scaffold(
        appBar: AppBar(elevation: 0),
        body: DataStateView.empty(title: l10n.subscriptionNotFound),
      );
    }
    final Subscription s = sub;
    // The wall clock through `nowProvider`, not `DateTime.now()`: the due
    // caption is a function of today, and a golden or a state test that reads
    // the real clock rots the day the demo renewal dates pass.
    final DateTime now = ref.watch(nowProvider)();
    final DueInfo due = DueInfo.localized(
      l10n,
      s,
      now,
      brightness: theme.brightness,
    );
    // Due today or tomorrow is the one caption worth a status: it is the last
    // moment a cancellation still saves this cycle. Further out the words
    // alone say it, in the neutral caption ink.
    final StatusKind? dueKind = s.daysUntil(now) <= 1 ? StatusKind.warn : null;

    return Scaffold(
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          // 🔴 THE SPLIT: the band stays FULL-BLEED, its CONTENT is capped at
          // the same `AppBreakpoints.reading` as the body pane below. The two
          // panes must agree — an edit that re-caps one and not the other
          // misaligns the title against the first card — and
          // `test/width_detail_test.dart` pins both numbers for that reason.
          AppDetailHeader(
            key: const Key('detail-header-band'),
            paneKey: const Key('detail-header-pane'),
            backKey: E2EKeys.detailBack,
            title: s.name,
            // ⏱ ST-T3b (ST-E1): no dangling " · " for a row with no plan, and a
            // row that is not charging says so here.
            subtitle: detailSubtitle(l10n, s),
            // ⚠️ DECORATIVE: `s.glyph` abbreviates `s.name`, the title beside
            // it, so the header excludes it rather than open every detail
            // screen with "SP, Spotify".
            leading: AppMonogram(text: s.glyph, size: AppMonogram.large),
            backLabel: l10n.back,
            onBack: () => _dismiss(context),
            // ST-U5 (B14) removed the `more_horiz` "More options" STUB —
            // focusable, announced as a button, opening nothing. ST-T3b (ST-E3)
            // put it back with a real menu behind it: Pause / Resume, Mark as
            // cancelled and Delete from tracker. It is the header's one action.
            actions: <AppHeaderAction>[
              AppHeaderAction(
                key: E2EKeys.detailMoreOptions,
                icon: Icons.more_horiz,
                label: l10n.moreOptions,
                onPressed: () => _showMoreOptions(context, ref, s, _dismiss),
              ),
            ],
          ),
          // 🔴 `AppBreakpoints.reading` (720): the body is a CARD STACK (two
          // figure tiles, a meter card, a card of payment rows), which is the
          // shape `reading` names. The default `kMaxBodyWidth` (1280) never
          // bound on a real desktop, and `.pane` (480) would make a full route
          // narrower than the screen that pushed it.
          //
          // The `ListView` keeps its OWN padding rather than handing it to the
          // pane: a scroll view's padding scrolls with the content and supplies
          // the bottom run-off.
          //
          // The bottom adds the shell's FAB band ONLY where there is one: this
          // screen is also home's detail pane at wide widths, embedded UNDER
          // `AppShell`, whose floating "+" is laid out over this list's last
          // row. Pushed at `/sub/:id` it is above the shell and the band is 0.
          Expanded(
            child: ContentPane.reading(
              key: const Key('detail-body-pane'),
              child: ListView(
                padding: EdgeInsets.fromLTRB(
                  AppSpacing.gutterCompact,
                  AppSpacing.lg,
                  AppSpacing.gutterCompact,
                  AppSpacing.xl + AppShell.fabClearanceOf(context),
                ),
                children: <Widget>[
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Expanded(
                        child: AppFigureTile(
                          label: l10n.fieldLabelPrice,
                          figure: money.format(s.price),
                          caption: cadenceCaption(l10n, s.cycle),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: AppFigureTile(
                          label: l10n.nextChargeLabel,
                          // `MMMd`, never a month table: Tamil does not put
                          // the month first, and a table bakes the ORDER.
                          // The ROLLED next charge (ST-M3), the date
                          // `due.label` beside it is measured to.
                          figure: DateFormat.MMMd(
                            l10n.localeName,
                          ).format(s.nextCharge(now)),
                          caption: due.label,
                          status: dueKind,
                        ),
                      ),
                    ],
                  ),
                  // 🔴 THE USAGE CARD IS GATED ON USAGE DATA EXISTING.
                  // `unused` and `usedPct` are never collected: the add sheet
                  // builds every draft without them and the API never writes
                  // them back. Ungated, this card told every real user their
                  // subscription was "Active" over a 0% meter — an assertion
                  // about behaviour the app has never observed. Gated, not
                  // deleted: the moment anything writes usage it is correct.
                  if (s.unused || s.usedPct > 0) ...<Widget>[
                    const SizedBox(height: AppSpacing.md),
                    _UsageCard(sub: s),
                  ],
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.xs,
                      AppSpacing.xl,
                      AppSpacing.xs,
                      AppSpacing.sm,
                    ),
                    child: Semantics(
                      header: true,
                      child: Text(
                        l10n.paymentHistory,
                        style: text.titleMedium?.copyWith(
                          color: scheme.onSurface,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  _PaymentHistory(subId: s.id, money: money),
                  const SizedBox(height: AppSpacing.xl),
                  Row(
                    children: <Widget>[
                      Expanded(
                        // ⏱ ST-T3b (ST-E1): "Edit plan" closed the screen and
                        // edited nothing. It opens the sheet, prefilled; the
                        // detail stays up underneath and repaints from the
                        // list the save replaces the row in.
                        child: OutlinedButton(
                          key: E2EKeys.detailEdit,
                          onPressed: () =>
                              showAddSubscriptionSheet(context, initial: s),
                          child: Text(l10n.editPlan),
                        ),
                      ),
                      const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: FilledButton(
                          key: E2EKeys.detailCancelPlan,
                          style: AppButtonStyles.destructive(context),
                          onPressed: () async {
                            // Resolved BEFORE the await: the snackbar
                            // outlives this screen.
                            final ScaffoldMessengerState messenger =
                                ScaffoldMessenger.of(context);
                            final SubscriptionsController ctl = ref.read(
                              subscriptionsControllerProvider.notifier,
                            );
                            // ST-U8 (B15): dismiss ONLY when the row was
                            // removed. "Keep it" keeps the user here.
                            final bool removed = await showCancelSheet(
                              context,
                              s,
                            );
                            if (!removed) return;
                            // ST-T3b (ST-E3): the removal is a SOFT delete,
                            // so it can be undone — the same Undo as the
                            // overflow's "Delete from tracker".
                            messenger.showSnackBar(
                              SnackBar(
                                content: Text(l10n.subscriptionDeleted(s.name)),
                                action: ctl.canUndoDelete(s.id)
                                    ? SnackBarAction(
                                        label: l10n.undo,
                                        onPressed: () => ctl.undoDelete(s.id),
                                      )
                                    : null,
                              ),
                            );
                            // `context.mounted` answers "is this element
                            // still in the tree", NEVER "can the router
                            // pop" — the two came apart in the pane case,
                            // where the element is alive and the stack is
                            // one deep. Both checks are needed, in this
                            // order: the guard inside [_dismiss] cannot run
                            // at all on a context torn down across the await.
                            if (context.mounted) _dismiss(context);
                          },
                          // `cancelPlanButton`, NOT the chassis `cancelPlan`
                          // ("Cancel subscription"). ST-U3 (B32): its value is
                          // "Remove" — the sheet it opens deletes the row from
                          // this tracker and cancels nothing at the provider.
                          child: Text(l10n.cancelPlanButton),
                        ),
                      ),
                    ],
                  ),
                  // ST-R3 / ST-R8: when this one reminds, and its notice.
                  // Last, below the actions, so nothing above it moves.
                  SubscriptionReminderRows(sub: s),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // `_months` and `_shortMon` — two hardcoded English month tables — were
  // DELETED (work order §3). They are `DateFormat.yMMMd` and `DateFormat.MMMd`.
  // A table like these is not a translation gap an .arb can close: it bakes the
  // ORDER of the parts as well as their names.
}

/// The usage meter, shown only when usage data exists (see the gate above).
///
/// The status word and the meter share one [StatusTones] tone — warn for a
/// plan flagged unused, positive otherwise — and the word is what carries it:
/// the meter is the same fact drawn, not a second one.
class _UsageCard extends StatelessWidget {
  const _UsageCard({required this.sub});

  final Subscription sub;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final StatusTones tones = StatusTones.of(context);
    final Color tone = sub.unused ? tones.warn : tones.positive;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              // 🔴 `Flexible` on the LEADING child only: two translated labels
              // in one `spaceBetween` Row is the classic l10n overflow shape
              // (Tamil "இந்த மாதப் பயன்பாடு" + "அரிதாகப் பயன்படுத்தப்படுகிறது").
              // Loose fit keeps the English layout at its intrinsic width.
              Flexible(
                child: Text(
                  l10n.usageThisMonth,
                  style: text.titleSmall?.copyWith(
                    color: scheme.onSurface,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                sub.unused ? l10n.usageRarelyUsed : l10n.usageActive,
                style: text.labelMedium?.copyWith(
                  color: tone,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadius.sm),
            child: LinearProgressIndicator(
              value: sub.usedPct / 100,
              minHeight: AppSpacing.sm,
              backgroundColor: scheme.surfaceContainerHighest,
              color: tone,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          Text(
            sub.usageNote,
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// The payment-history card: three outcomes told apart, then the rows.
///
/// 🔴 LOADING, FAILED AND EMPTY ARE THREE BRANCHES. The `FutureBuilder` this
/// replaces read `snap.data ?? const []`, so all three printed "No payments
/// yet". FAILED is the one that matters most: history is not cached, so it is
/// what an offline visit gets while the rest of the page renders from the
/// cached list — and it keeps its retry, scoped to this card.
///
/// ⚠️ THE DATE MAY WRAP, IT IS NEVER ELLIPSISED. `DateFormat.yMMMd('ta')`
/// writes the month out; an ellipsis would hide the YEAR, the one part of a
/// payment date a reader scans for. Hence `titleMaxLines: 2`.
class _PaymentHistory extends ConsumerWidget {
  const _PaymentHistory({required this.subId, required this.money});

  final String subId;
  final MoneyFormatter money;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final AsyncValue<List<PaymentRecord>> history = ref.watch(
      paymentHistoryProvider(subId),
    );
    final Widget body;
    if (!history.hasValue) {
      body = history.hasError
          ? DataStateView.failed(
              key: const Key('payment-history-failed'),
              title: l10n.dataFailedTitle,
              body: l10n.paymentHistoryFailed,
              retryLabel: l10n.retry,
              onRetry: () => ref.invalidate(paymentHistoryProvider(subId)),
            )
          : SkeletonList(
              key: const Key('payment-history-loading'),
              label: l10n.paymentHistoryLoading,
              rows: 2,
            );
    } else if (history.requireValue.isEmpty) {
      body = Padding(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Text(
          l10n.noPaymentsYet,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      );
    } else {
      final DateFormat rowDate = DateFormat.yMMMd(l10n.localeName);
      final List<PaymentRecord> rows = history.requireValue;
      body = Column(
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: 1),
            AppListRow(
              title: rowDate.format(rows[i].date),
              titleMaxLines: 2,
              figure: money.format(rows[i].amount),
            ),
          ],
        ],
      );
    }
    return AppCard(
      key: const Key('detail-history-card'),
      padding: EdgeInsets.zero,
      child: body,
    );
  }
}

/// The detail header's second line: category, plan and — when the row is not
/// simply active — its status, joined by " · " with no empty part (ST-E1).
@visibleForTesting
String detailSubtitle(AppLocalizations l10n, Subscription s) => <String>[
  s.category,
  if (s.plan.trim().isNotEmpty) s.plan.trim(),
  if (s.status == SubscriptionStatus.paused) l10n.statusPaused,
  if (s.status == SubscriptionStatus.cancelled) l10n.statusCancelled,
  if (s.status == SubscriptionStatus.trialing && s.trialEndsOn != null)
    l10n.statusTrialing(
      DateFormat.yMMMd(l10n.localeName).format(s.trialEndsOn!),
    ),
].join(' · ');

/// "More options" (ST-E3): the row's lifecycle, as stock Material list tiles
/// in a modal sheet, so the design programme restyles them by token.
///
/// Mark as cancelled and Pause KEEP the row and its history; Delete is a soft
/// delete with an Undo, and the UI never calls DELETE.
Future<void> _showMoreOptions(
  BuildContext context,
  WidgetRef ref,
  Subscription s,
  void Function(BuildContext) dismiss,
) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  final SubscriptionsController ctl = ref.read(
    subscriptionsControllerProvider.notifier,
  );
  final bool stopped =
      s.status == SubscriptionStatus.paused ||
      s.status == SubscriptionStatus.cancelled;
  final Future<void> Function()?
  action = await showModalBottomSheet<Future<void> Function()>(
    context: context,
    useRootNavigator: true,
    builder: (BuildContext sheet) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (stopped)
            ListTile(
              leading: const Icon(Icons.play_arrow),
              title: Text(l10n.actionResume),
              onTap: () =>
                  Navigator.of(sheet).pop(() => ctl.resumeSubscription(s.id)),
            )
          else
            ListTile(
              leading: const Icon(Icons.pause),
              title: Text(l10n.actionPause),
              onTap: () =>
                  Navigator.of(sheet).pop(() => ctl.pauseSubscription(s.id)),
            ),
          if (s.status != SubscriptionStatus.cancelled)
            ListTile(
              leading: const Icon(Icons.cancel_outlined),
              title: Text(l10n.actionMarkCancelled),
              onTap: () =>
                  Navigator.of(sheet).pop(() => ctl.markCancelled(s.id)),
            ),
          ListTile(
            leading: const Icon(Icons.delete_outline),
            title: Text(l10n.actionDeleteFromTracker),
            onTap: () => Navigator.of(sheet).pop(() async {
              await ctl.cancelSubscription(s.id);
              messenger.showSnackBar(
                SnackBar(
                  content: Text(l10n.subscriptionDeleted(s.name)),
                  action: ctl.canUndoDelete(s.id)
                      ? SnackBarAction(
                          label: l10n.undo,
                          onPressed: () => ctl.undoDelete(s.id),
                        )
                      : null,
                ),
              );
              if (context.mounted) dismiss(context);
            }),
          ),
        ],
      ),
    ),
  );
  if (action == null) return;
  try {
    await action();
  } on Object {
    messenger.showSnackBar(
      SnackBar(content: Text(l10n.updateSubscriptionFailed)),
    );
  }
}
