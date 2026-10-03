import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_core/nikatru_core.dart'
    show ExternalLinkLauncherUrl, LinkOutcome;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/e2e_keys.dart';
import '../../core/format/category_label.dart';
import '../../core/format/rail_label.dart';
import '../../core/format/money_format.dart';
import '../../data/models/payment_record.dart';
import '../../data/models/price_change.dart';
import '../../data/models/subscription.dart';
import '../../l10n/chassis_bridge.g.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/async_gate.dart';
import '../shared/cadence_label.dart';
import '../shared/due.dart';
import '../shared/failure_copy.dart';
import '../shell/app_shell.dart';
import '../stop/stop_flow.dart';
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
///   · "STOP OR REMOVE" is [AppButtonStyles.destructive]: the measured opaque
///     danger tint with the danger tone as ink, not a solid danger fill whose
///     ink was white in both schemes.
///
/// ⏱ 2026-10-01 · train ST-detail-stop — EVERY FACT IN ONE PLACE, AND A WAY
/// TO STOP THE CHARGE. Added below the figures: the DETAILS list (DE-11), the
/// India rail panel for a mandate rail (DE-08), "Mark as paid" over a
/// TIMELINE that merges payments with price changes (DE-04/05), and "How to
/// cancel {name}" (DE-06). "Remove" became "Stop or remove", which opens the
/// stop-a-charge flow (DE-07, `features/stop/`); Pause and Mark cancelled ask
/// once and offer Undo (DE-09).
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
    // ⏱ ST truth pass (DE-02): a paused or cancelled row has NO next charge,
    // and the tile used to roll its date forward and say "Due today" over a
    // plan that will never charge again. It says what stopped it instead, in
    // the row's status tone.
    final LifeStatus? life = LifeStatus.of(l10n, s);
    final DateTime? cancelledOn = s.cancelledOn;
    final String? stoppedCaption = switch (s.status) {
      SubscriptionStatus.paused => l10n.detailPausedNoCharge,
      SubscriptionStatus.cancelled =>
        cancelledOn == null
            ? l10n.statusCancelled
            : l10n.detailCancelledOn(
                DateFormat.yMMMd(l10n.localeName).format(cancelledOn),
              ),
      _ => null,
    };

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
                        child: stoppedCaption != null
                            ? AppFigureTile(
                                key: const Key('detail.nextCharge.stopped'),
                                label: l10n.nextChargeLabel,
                                figure: l10n.nextChargeNone,
                                caption: stoppedCaption,
                                status: life?.kind,
                              )
                            : AppFigureTile(
                                label: l10n.nextChargeLabel,
                                // `MMMd`, never a month table: Tamil does not
                                // put the month first, and a table bakes the
                                // ORDER. The ROLLED next charge (ST-M3), the
                                // date `due.label` beside it is measured to.
                                figure: DateFormat.MMMd(
                                  l10n.localeName,
                                ).format(s.nextCharge(now)),
                                caption: due.label,
                                status: dueKind,
                              ),
                      ),
                    ],
                  ),
                  // ST-AD12: the row's tags, as chips, only when it has any —
                  // a row without labels draws nothing here.
                  if (s.tags.isNotEmpty) ...<Widget>[
                    const SizedBox(height: AppSpacing.md),
                    Semantics(
                      label: l10n.fieldLabelTags,
                      container: true,
                      child: Wrap(
                        key: const Key('detail-tags'),
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: <Widget>[
                          for (final String t in s.tags) Chip(label: Text(t)),
                        ],
                      ),
                    ),
                  ],
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
                  // DE-11: the two actions sit under the figures, above the
                  // details, so they stay above the fold now the page holds
                  // every fact (and a lazy list still builds them).
                  const SizedBox(height: AppSpacing.lg),
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
                            // ST-U8 (B15): dismiss ONLY when the row was
                            // removed. Closing the flow, pausing or marking
                            // it cancelled keeps the user here. The flow
                            // shows its own snackbar, with the Undo (DE-10).
                            final StopOutcome? outcome = await showStopSheet(
                              context,
                              s,
                            );
                            if (outcome != StopOutcome.removed) return;
                            // `context.mounted` answers "is this element
                            // still in the tree", NEVER "can the router
                            // pop" — the two came apart in the pane case,
                            // where the element is alive and the stack is
                            // one deep. Both checks are needed, in this
                            // order: the guard inside [_dismiss] cannot run
                            // at all on a context torn down across the await.
                            if (context.mounted) _dismiss(context);
                          },
                          // DE-07: "Stop or remove" — the flow it opens SHOWS
                          // how to stop the charge at the provider and can
                          // remove the row from this tracker; it cancels
                          // nothing itself (ST-U3, B32).
                          child: Text(l10n.stopOrRemove),
                        ),
                      ),
                    ],
                  ),
                  _SectionHeading(text: l10n.detailsHeading),
                  DetailsList(sub: s),
                  if (s.rail?.isMandate ?? false) ...<Widget>[
                    const SizedBox(height: AppSpacing.md),
                    RailPanel(sub: s),
                  ],
                  _SectionHeading(
                    text: l10n.paymentHistory,
                    // DE-04: offered only where the client can record one —
                    // never a button that cannot work.
                    action:
                        ref
                            .watch(subscriptionRepositoryProvider)
                            .canRecordPayments
                        ? TextButton(
                            key: E2EKeys.detailMarkPaid,
                            onPressed: () => showMarkAsPaid(context, ref, s),
                            child: Text(l10n.markAsPaid),
                          )
                        : null,
                  ),
                  _PaymentHistory(subId: s.id, money: money),
                  if (s.status != SubscriptionStatus.cancelled) ...<Widget>[
                    _SectionHeading(text: l10n.howToCancelTitle(s.name)),
                    HowToCancel(sub: s),
                  ],
                  // ST-R3 / ST-R8: when this one reminds, and its notice.
                  // Last, so nothing above it moves.
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

/// The payment-history card: three outcomes told apart, then the TIMELINE.
///
/// 🔴 LOADING, FAILED AND EMPTY ARE THREE BRANCHES. The `FutureBuilder` this
/// replaced read `snap.data ?? const []`, so all three printed "No payments
/// yet". FAILED is the one that matters most: history is not cached, so it is
/// what an offline visit gets while the rest of the page renders from the
/// cached list — and it keeps its retry, scoped to this card.
///
/// ⏱ 2026-10-01 · DE-05: THE ROWS ARE A TIMELINE. Payments and price edits
/// (`price_history`, which no client read) merge newest first, so "Price rose
/// from ₹499 to ₹649 on 3 Sep" sits between the charges it explains. The
/// price edits are a SECOND read that may fail on its own; a failure there
/// shows the payments alone rather than hiding them.
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
    final List<PriceChange> prices =
        ref.watch(priceHistoryProvider(subId)).value ?? const <PriceChange>[];
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
    } else if (history.requireValue.isEmpty && prices.isEmpty) {
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
      final DateFormat shortDate = DateFormat.MMMd(l10n.localeName);
      final List<({DateTime at, Widget row})> rows =
          <({DateTime at, Widget row})>[
            for (final PaymentRecord p in history.requireValue)
              (
                at: p.date,
                row: AppListRow(
                  title: rowDate.format(p.date),
                  titleMaxLines: 2,
                  figure: money.format(p.amount),
                ),
              ),
            for (final PriceChange c in prices)
              (
                at: c.changedOn,
                row: AppListRow(
                  key: const Key('timeline-price-change'),
                  title: timelinePriceLine(l10n, money, c, shortDate),
                  titleMaxLines: 3,
                  leading: Icon(
                    c.isRise ? Icons.trending_up : Icons.swap_vert,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
          ]..sort((a, b) => b.at.compareTo(a.at));
      body = Column(
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: 1),
            rows[i].row,
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

/// One price edit as a sentence: "Price rose from ₹499 to ₹649 on 3 Sep".
@visibleForTesting
String timelinePriceLine(
  AppLocalizations l10n,
  MoneyFormatter money,
  PriceChange c,
  DateFormat date,
) {
  final String from = money.format(c.from);
  final String to = money.format(c.to);
  final String on = date.format(c.changedOn);
  if (c.from.currencyCode != c.to.currencyCode) {
    return l10n.timelinePriceChanged(from, to, on);
  }
  return c.isRise
      ? l10n.timelinePriceRose(from, to, on)
      : l10n.timelinePriceFell(from, to, on);
}

/// A section heading on the detail body, with an optional trailing action.
class _SectionHeading extends StatelessWidget {
  const _SectionHeading({required this.text, this.action});

  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final Widget? trailing = action;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.xs,
        AppSpacing.xl,
        AppSpacing.xs,
        AppSpacing.sm,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: Text(
                text,
                style: theme.textTheme.titleMedium?.copyWith(
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          // Flexible: at a large text scale the heading and its action share
          // the row instead of overflowing it — the action's label wraps.
          if (trailing != null) Flexible(child: trailing),
        ],
      ),
    );
  }
}

/// EVERY FACT IN ONE PLACE (DE-11): next reminder, paid with, category,
/// website, notes, first charge and cancelled-on — each row present ONLY when
/// it has a value. An empty field is not shown as "—": a list of dashes is
/// noise that reads as missing data.
class DetailsList extends ConsumerWidget {
  const DetailsList({super.key, required this.sub});

  final Subscription sub;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final DateFormat date = DateFormat.yMMMd(l10n.localeName);
    final Subscription s = sub;
    final SettingsState settings = ref.watch(settingsControllerProvider);
    // From the ARMED schedule: the reminder the device will actually post,
    // or nothing — off in settings, a platform that cannot schedule, a row
    // that is not charging.
    final DateTime? nextReminder =
        ReminderPlan.from(settings.prefs).syncRenewals
        ? ref
              .watch(renewalRemindersProvider)
              .nextReminderAt(
                s,
                copy: reminderCopyFor(ref.watch(localeProvider)),
                rules: settings.reminderRules,
              )
        : null;
    final String? rail = railLabel(l10n, s.rail);
    final String paidWith = <String>[
      ?rail,
      if (s.railHolder?.trim().isNotEmpty ?? false) s.railHolder!.trim(),
    ].join(' · ');
    final String? website = s.cancelUrl?.trim();
    final List<({Key key, String label, String value})>
    rows = <({Key key, String label, String value})>[
      if (nextReminder != null)
        (
          key: const Key('details-next-reminder'),
          label: l10n.detailNextReminder,
          value: date.format(nextReminder),
        ),
      if (paidWith.isNotEmpty)
        (
          key: const Key('details-paid-with'),
          label: l10n.detailPaidWith,
          value: paidWith,
        ),
      if (s.category.trim().isNotEmpty)
        (
          key: const Key('details-category'),
          label: l10n.detailCategory,
          value: s.category.trim(),
        ),
      if (website != null && website.isNotEmpty)
        (
          // ST truth pass (DE-01): the website to cancel at OPENS, through
          // the app's ExternalLinkLauncher seam ([websiteLinkLauncherProvider]).
          key: const Key('detail.details.website'),
          label: l10n.detailWebsite,
          value: website,
        ),
      if (s.notes.trim().isNotEmpty)
        (
          key: const Key('details-notes'),
          label: l10n.detailNotes,
          value: s.notes.trim(),
        ),
      if (s.firstChargeOn != null)
        (
          key: const Key('details-first-charge'),
          label: l10n.detailFirstCharge,
          value: date.format(s.firstChargeOn!),
        ),
      if (s.cancelledOn != null)
        (
          key: const Key('details-cancelled-on'),
          label: l10n.detailCancelledOnLabel,
          value: date.format(s.cancelledOn!),
        ),
    ];
    if (rows.isEmpty) return const SizedBox.shrink();
    return AppCard(
      key: const Key('detail-details-card'),
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < rows.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: 1),
            AppListRow(
              key: rows[i].key,
              title: rows[i].label,
              subtitle: rows[i].value,
              // Free text the user wrote may wrap, as a sentence does.
              subtitleMaxLines: rows[i].key == const Key('details-notes')
                  ? 8
                  : 4,
              showChevron: false,
              onTap: rows[i].key == const Key('detail.details.website')
                  ? () => _openWebsite(context, ref, l10n, rows[i].value)
                  : null,
            ),
          ],
        ],
      ),
    );
  }
}

/// Opens the row's website to cancel at (ST truth pass, DE-01): the policy,
/// then the plugin; a refusal says so rather than failing silently.
Future<void> _openWebsite(
  BuildContext context,
  WidgetRef ref,
  AppLocalizations l10n,
  String url,
) async {
  final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(context);
  final LinkOutcome outcome = await ref
      .read(websiteLinkLauncherProvider)(url)
      .openUrl(url);
  if (outcome != LinkOutcome.opened) {
    messenger?.showSnackBar(
      SnackBar(content: Text(l10n.detailWebsiteNotOpened)),
    );
  }
}

/// THE INDIA RAIL PANEL (DE-08, design rule R3), for a UPI Autopay, card
/// e-mandate or NACH row: what the mandate is, that cancelling with the
/// provider is NOT revoking it, and where the user revokes it — in their own
/// UPI app, bank or card portal. Allowed-copy lines only: no debit time, and
/// nothing that says this app can cancel or revoke anything
/// (`tooling/ci/assert-stop-copy.mjs` refuses both in the arb).
class RailPanel extends StatelessWidget {
  const RailPanel({super.key, required this.sub});

  final Subscription sub;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final String name = sub.name;
    final (String title, String what, String where)? copy = switch (sub.rail) {
      PaymentRail.upiAutopay => (
        l10n.railPanelUpiTitle,
        l10n.railPanelUpiWhat(name),
        l10n.railPanelUpiWhere,
      ),
      PaymentRail.cardEmandate => (
        l10n.railPanelCardTitle,
        l10n.railPanelCardWhat(name),
        l10n.railPanelCardWhere,
      ),
      PaymentRail.nach => (
        l10n.railPanelNachTitle,
        l10n.railPanelNachWhat(name),
        l10n.railPanelNachWhere,
      ),
      _ => null,
    };
    if (copy == null) return const SizedBox.shrink();
    final TextStyle? body = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    return AppCard(
      key: Key('rail-panel-${sub.rail!.wire}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Semantics(
            header: true,
            child: Text(
              copy.$1,
              style: theme.textTheme.titleSmall?.copyWith(
                color: theme.colorScheme.onSurface,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(copy.$2, style: body),
          const SizedBox(height: AppSpacing.sm),
          Text(l10n.railPanelNotTheSame(name), style: body),
          const SizedBox(height: AppSpacing.sm),
          Text(copy.$3, style: body),
        ],
      ),
    );
  }
}

/// "HOW TO CANCEL {name}" (DE-06). Matched by `service_id` in the service
/// catalogue: the provider's own cancel page, and the Google Play or App
/// Store manage page where the row is paid through that store — each opened
/// through the [core.ExternalLinkLauncher] seam ([cancelLinkLauncherProvider]).
/// A row with no match gets the generic steps.
class HowToCancel extends ConsumerWidget {
  const HowToCancel({super.key, required this.sub});

  final Subscription sub;

  Future<void> _open(BuildContext context, WidgetRef ref, Uri uri) async {
    final ScaffoldMessengerState? messenger = ScaffoldMessenger.maybeOf(
      context,
    );
    final String failed = AppLocalizations.of(context).linkNotOpened;
    final core.LinkOutcome outcome = await ref
        .read(cancelLinkLauncherProvider)
        .open(uri);
    if (outcome != core.LinkOutcome.opened) {
      messenger?.showSnackBar(SnackBar(content: Text(failed)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? id = sub.serviceId;
    final core.ServiceEntry? entry = id == null
        ? null
        // The URLs are not localised, so the English reading serves (and is
        // the one the cancel launcher's policy reads too).
        : ref.watch(serviceCatalogueProvider('en')).value?.byId(id);
    final List<Widget> links = <Widget>[
      if (entry != null)
        AppListRow(
          key: const Key('how-to-cancel-provider'),
          leading: const Icon(Icons.open_in_new),
          title: l10n.howToCancelProviderPage(sub.name),
          titleMaxLines: 2,
          onTap: () => _open(context, ref, entry.cancelUrl),
        ),
      if (entry != null && sub.rail == PaymentRail.play)
        AppListRow(
          key: const Key('how-to-cancel-play'),
          leading: const Icon(Icons.shop),
          title: l10n.howToCancelPlay,
          titleMaxLines: 2,
          onTap: () => _open(context, ref, entry.playManageUrl),
        ),
      if (entry != null && sub.rail == PaymentRail.appStore)
        AppListRow(
          key: const Key('how-to-cancel-appstore'),
          leading: const Icon(Icons.phone_iphone),
          title: l10n.howToCancelAppStore,
          titleMaxLines: 2,
          onTap: () => _open(context, ref, entry.appStoreManageUrl),
        ),
    ];
    if (links.isEmpty) {
      final List<String> steps = <String>[
        l10n.howToCancelStep1,
        l10n.howToCancelStep2,
        l10n.howToCancelStep3,
      ];
      return AppCard(
        key: const Key('how-to-cancel-generic'),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int i = 0; i < steps.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(height: AppSpacing.sm),
              Text('${i + 1}. ${steps[i]}'),
            ],
          ],
        ),
      );
    }
    return AppCard(
      key: const Key('how-to-cancel-card'),
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < links.length; i++) ...<Widget>[
            if (i > 0) const Divider(height: 1),
            links[i],
          ],
        ],
      ),
    );
  }
}

/// "MARK AS PAID" (DE-04): the amount prefilled from the plan and editable,
/// the date today; Save posts ONE payment with ONE Idempotency-Key, minted
/// when the dialog opens and reused by every retry from it, so a double tap
/// or a replay after a lost answer records nothing twice.
Future<void> showMarkAsPaid(
  BuildContext context,
  WidgetRef ref,
  Subscription s,
) async {
  final AppLocalizations l10n = AppLocalizations.of(context);
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  final bool? saved = await showDialog<bool>(
    context: context,
    useRootNavigator: true,
    builder: (_) => _MarkAsPaidDialog(
      sub: s,
      today: DateUtils.dateOnly(ref.read(nowProvider)()),
      controller: ref.read(subscriptionsControllerProvider.notifier),
    ),
  );
  if (saved ?? false) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.paymentRecorded)));
  }
}

/// The dialog behind [showMarkAsPaid]. A State, so the amount field's
/// controller lives exactly as long as the dialog does — exit animation
/// included.
class _MarkAsPaidDialog extends StatefulWidget {
  const _MarkAsPaidDialog({
    required this.sub,
    required this.today,
    required this.controller,
  });

  final Subscription sub;
  final DateTime today;
  final SubscriptionsController controller;

  @override
  State<_MarkAsPaidDialog> createState() => _MarkAsPaidDialogState();
}

class _MarkAsPaidDialogState extends State<_MarkAsPaidDialog> {
  /// ONE key for every attempt from this dialog (DE-04).
  final String _key = core.newOutboxId();
  late final TextEditingController _amount = TextEditingController(
    text: widget.sub.price.toMajorUnits().toStringAsFixed(
      widget.sub.price.minorUnitDigits,
    ),
  );
  late DateTime _paidOn = widget.today;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _paidOn,
      firstDate: DateTime(2000),
      lastDate: widget.today,
    );
    if (picked != null && mounted) setState(() => _paidOn = picked);
  }

  Future<void> _save() async {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final num? major = num.tryParse(_amount.text.trim());
    if (major == null || major < 0) {
      setState(() => _error = l10n.markAsPaidAmountInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.controller.recordPayment(
        widget.sub.id,
        amount: Money.fromMajorUnits(major, widget.sub.currencyCode),
        paidOn: _paidOn,
        idempotencyKey: _key,
      );
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = writeFailureMessage(l10n, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final String? error = _error;
    return AlertDialog(
      title: Text(l10n.markAsPaidTitle(widget.sub.name)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(l10n.markAsPaidBody),
            const SizedBox(height: AppSpacing.lg),
            TextField(
              key: E2EKeys.markPaidAmount,
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(
                labelText: l10n.markAsPaidAmount,
                prefixText: '${widget.sub.currencyCode} ',
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            // An InputDecorator, not an [AppListRow]: an AlertDialog sizes its
            // content by intrinsic width, which the row cannot report.
            InkWell(
              key: const Key('mark-paid-date'),
              onTap: _busy ? null : _pickDate,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: l10n.markAsPaidDate,
                  suffixIcon: const Icon(Icons.calendar_today),
                ),
                child: Text(DateFormat.yMMMd(l10n.localeName).format(_paidOn)),
              ),
            ),
            // 🔴 TEXT IN THE DANGER TONE, NOT A [DecisionStrip]: the strip
            // lays out through a `LayoutBuilder`, and an AlertDialog sizes its
            // content by intrinsic width, which a LayoutBuilder cannot report —
            // the failure state threw instead of saying why (measured by
            // test/detail_stop_test.dart's retry case).
            if (error != null) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              Text(
                error,
                key: const Key('mark-paid-failure'),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: StatusTones.of(context).danger,
                ),
              ),
            ],
          ],
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: E2EKeys.markPaidSave,
          onPressed: _busy ? null : _save,
          child: Text(l10n.markAsPaidSave),
        ),
      ],
    );
  }
}

/// The detail header's second line: category, plan and — when the row is not
/// simply active — its status, joined by " · " with no empty part (ST-E1).
@visibleForTesting
String detailSubtitle(AppLocalizations l10n, Subscription s) => <String>[
  categoryLabel(l10n, s.category),
  if (s.plan.trim().isNotEmpty) s.plan.trim(),
  if (s.status == SubscriptionStatus.paused) l10n.statusPaused,
  if (s.status == SubscriptionStatus.cancelled) l10n.statusCancelled,
  if (s.status == SubscriptionStatus.trialing && s.trialEndsOn != null)
    // ST-T9 (AD-08): with the price after the trial known, the line says
    // what the trial turns into — the moment a user most needs the number.
    s.priceAfterTrial == null
        ? l10n.statusTrialing(
            DateFormat.yMMMd(l10n.localeName).format(s.trialEndsOn!),
          )
        : l10n.statusTrialingThen(
            DateFormat.yMMMd(l10n.localeName).format(s.trialEndsOn!),
            MoneyFormatter(l10n.localeName).format(s.priceAfterTrial!),
          ),
].join(' · ');

/// "More options" (ST-E3): the row's lifecycle, as stock Material list tiles
/// in a modal sheet, so the design programme restyles them by token.
///
/// Mark as cancelled and Pause KEEP the row and its history; Delete is a soft
/// delete with an Undo (DE-10: by either server path).
///
/// ⏱ 2026-10-01 · DE-09: PAUSE AND MARK CANCELLED ASK ONCE AND OFFER UNDO.
/// Both applied on the tap, with no question and no way back; a mis-tap
/// stopped a row's reminders in silence. And every failure said "check your
/// connection" (B08) — now [writeFailureMessage] picks the words by cause.
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
  SnackBar undoable(String message, Future<void> Function() undo) => SnackBar(
    content: Text(message),
    action: SnackBarAction(
      key: E2EKeys.snackUndo,
      label: l10n.undo,
      onPressed: () async {
        try {
          await undo();
        } on Object catch (e) {
          messenger.showSnackBar(
            SnackBar(content: Text(writeFailureMessage(l10n, e))),
          );
        }
      },
    ),
  );
  final Future<void> Function()? action =
      await showModalBottomSheet<Future<void> Function()>(
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
                  onTap: () => Navigator.of(
                    sheet,
                  ).pop(() => ctl.resumeSubscription(s.id)),
                )
              else
                ListTile(
                  leading: const Icon(Icons.pause),
                  title: Text(l10n.actionPause),
                  onTap: () => Navigator.of(sheet).pop(() async {
                    if (!await _confirm(
                      context,
                      l10n.pauseConfirmTitle(s.name),
                      l10n.pauseConfirmBody,
                      l10n.actionPause,
                    )) {
                      return;
                    }
                    await ctl.pauseSubscription(s.id);
                    messenger.showSnackBar(
                      undoable(
                        l10n.subscriptionPaused(s.name),
                        () => ctl.restoreStatus(s),
                      ),
                    );
                  }),
                ),
              if (s.status != SubscriptionStatus.cancelled)
                ListTile(
                  leading: const Icon(Icons.cancel_outlined),
                  title: Text(l10n.actionMarkCancelled),
                  onTap: () => Navigator.of(sheet).pop(() async {
                    if (!await _confirm(
                      context,
                      l10n.markCancelledConfirmTitle(s.name),
                      l10n.markCancelledConfirmBody,
                      l10n.actionMarkCancelled,
                    )) {
                      return;
                    }
                    await ctl.markCancelled(s.id);
                    messenger.showSnackBar(
                      undoable(
                        l10n.subscriptionMarkedCancelled(s.name),
                        () => ctl.restoreStatus(s),
                      ),
                    );
                  }),
                ),
              // AD-10 (train T20): a NEW row prefilled from this one, named
              // `<name> (2)`. The sheet opens after this menu closes; this
              // row is not written.
              ListTile(
                key: const Key('detail-duplicate'),
                leading: const Icon(Icons.copy_outlined),
                title: Text(l10n.actionDuplicate),
                onTap: () => Navigator.of(sheet).pop(() async {
                  if (context.mounted) {
                    await showAddSubscriptionSheet(context, duplicateOf: s);
                  }
                }),
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
                              key: E2EKeys.snackUndo,
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
  } on Object catch (e) {
    messenger.showSnackBar(
      SnackBar(content: Text(writeFailureMessage(l10n, e))),
    );
  }
}

/// The ONE question before a lifecycle change (DE-09). True only on "yes".
Future<bool> _confirm(
  BuildContext context,
  String title,
  String body,
  String yes,
) async {
  if (!context.mounted) return false;
  final AppLocalizations l10n = AppLocalizations.of(context);
  final bool? ok = await showDialog<bool>(
    context: context,
    useRootNavigator: true,
    builder: (BuildContext dialog) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(dialog).pop(false),
          child: Text(l10n.cancel),
        ),
        FilledButton(
          key: E2EKeys.confirmYes,
          onPressed: () => Navigator.of(dialog).pop(true),
          child: Text(yes),
        ),
      ],
    ),
  );
  return ok ?? false;
}
