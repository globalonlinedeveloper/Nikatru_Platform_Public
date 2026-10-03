// ═══════════════════════════════════════════════════════════════════════════
// "WORTH A LOOK" — train ST-D3, label D3-4 (canvas v2 `Insights`). Signals the
// rows can PROVE, and one question the app cannot answer for itself.
//
// 🔴 THE SAVINGS CARD THIS REPLACES READ `unused` AND `usedPct`, AND NOTHING
// EVER WROTE EITHER. The add sheet never collects them and the API never
// returns them, so for every real user the card could not render — and for the
// demo seed it presented invented usage ("Not opened in 47 days") as fact.
// This file reads neither (`insights_readers_test.dart` holds that line), and
// replaces them with:
//   · SAME CATEGORY — two or more plans in one category, stated as a fact;
//   · ANNUAL SOON   — a yearly plan renewing within 60 days;
//   · STILL USING?  — ASKED, never inferred: the costliest plan the user has
//     not answered for. "Yes" is stored on this device and the row leaves.
//     ⏱ T12 (IN-08): "No" is an answer too, and it LEADS somewhere — it is
//     recorded the same way and opens the plan's stop flow (train T10's
//     `/sub/:id/stop`; train T11 moves both answers to the API so they
//     follow the account).
//
// ⚠️ THE CANVAS'S "went up 25%" (PRICE RISE) IS NOT DRAWN. A row carries one
// price and no history, so a rise cannot be computed; it arrives with the
// price history ST-T3b owns.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/format/category_label.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/subscriptions_controller.dart';
import 'summary_tiles.dart' show chargeWithCycle;

/// How far ahead a yearly renewal is worth flagging.
const int kAnnualSoonDays = 60;

/// One thing worth a look.
sealed class InsightSignal {
  const InsightSignal();
}

/// Two or more plans in [category].
final class SameCategorySignal extends InsightSignal {
  const SameCategorySignal(this.category, this.subs);
  final String category;
  final List<Subscription> subs;
}

/// A yearly plan renewing in [days] days.
final class AnnualSoonSignal extends InsightSignal {
  const AnnualSoonSignal(this.sub, this.days);
  final Subscription sub;
  final int days;
}

/// The question for [sub].
final class StillUsingSignal extends InsightSignal {
  const StillUsingSignal(this.sub);
  final Subscription sub;
}

/// Every signal [subs] support on [now], given the ids already [answered].
///
/// Pure, so the rules are tested without a widget. Order: annual renewals
/// first (they have a date), then same-category groups, then the one question.
List<InsightSignal> signalsFor(
  List<Subscription> subs,
  DateTime now, {
  Set<String> answered = const <String>{},
}) {
  // ⏱ ST truth pass (IN-02): CHARGING rows only. A paused plan is not about
  // to renew, a cancelled one is not a duplicate the user pays for twice, and
  // neither is worth asking "still using?" about.
  final List<Subscription> charging = SubMath.charging(subs);
  final List<AnnualSoonSignal> annual = <AnnualSoonSignal>[
    for (final Subscription s in charging)
      if (s.cycle == BillingCycle.yearly &&
          s.daysUntil(now) >= 0 &&
          s.daysUntil(now) <= kAnnualSoonDays)
        AnnualSoonSignal(s, s.daysUntil(now)),
  ]..sort((AnnualSoonSignal a, AnnualSoonSignal b) => a.days.compareTo(b.days));

  final Map<String, List<Subscription>> byCategory =
      <String, List<Subscription>>{};
  for (final Subscription s in SubMath.byMonthlyDesc(charging)) {
    (byCategory[s.category] ??= <Subscription>[]).add(s);
  }
  final List<SameCategorySignal> same = <SameCategorySignal>[
    for (final MapEntry<String, List<Subscription>> e in byCategory.entries)
      if (e.value.length >= 2) SameCategorySignal(e.key, e.value),
  ];

  Subscription? ask;
  for (final Subscription s in SubMath.byMonthlyDesc(charging)) {
    if (!answered.contains(s.id)) {
      ask = s;
      break;
    }
  }
  return <InsightSignal>[
    ...annual,
    ...same,
    if (ask != null) StillUsingSignal(ask),
  ];
}

/// The ids answered "still using" on THIS device — a CACHE of the row's own
/// `still_using` (0010), read from and written to the local store (cleared
/// with everything else on sign-out and deletion).
///
/// ⏱ 2026-10-01 · train T11 (IN-08). This set used to be the WHOLE answer, so
/// a "Yes" on the phone was asked again on the laptop. The answer is written
/// to the row by PATCH now and every device reads it after a sync
/// ([answeredIds]); the set only hides the question at once, before the write
/// lands, and keeps it hidden on a device that cannot reach the server.
class StillUsingController extends AsyncNotifier<Set<String>> {
  @override
  Future<Set<String>> build() =>
      ref.watch(localSubscriptionStoreProvider).readStillUsing();

  /// Records "yes" for [id]. See [answer].
  Future<void> answerYes(String id) => answer(id, StillUsing.yes);

  /// Records "no" for [id]: the question is answered and leaves, and the
  /// CALLER opens the stop flow — "no" is a decision to act on, not a note.
  /// See [answer].
  Future<void> answerNo(String id) => answer(id, StillUsing.no);

  /// Records [value] for [id]: the row leaves at once (the cache), then the
  /// answer goes to the server with the row (`PATCH {still_using}`), so the
  /// question leaves every other device on its next sync.
  ///
  /// A failed CACHE write is not swallowed — the answer is rolled back so the
  /// question comes back, as before. A failed SERVER write keeps the cached
  /// answer: this device stays answered (exactly what it was before T11), the
  /// row is untouched on the server, and the next answer on any device writes
  /// it again.
  Future<void> answer(String id, StillUsing value) async {
    final Set<String> before = state.value ?? <String>{};
    final Set<String> next = <String>{...before, id};
    state = AsyncData<Set<String>>(next);
    try {
      await ref.read(localSubscriptionStoreProvider).writeStillUsing(next);
    } catch (_) {
      if (ref.mounted) state = AsyncData<Set<String>>(before);
      return;
    }
    if (!ref.mounted) return;
    try {
      await ref
          .read(subscriptionsControllerProvider.notifier)
          .updateSubscription(id, <String, dynamic>{'still_using': value.name});
    } catch (_) {
      // Deliberately kept local: see the doc comment.
    }
  }
}

/// Every id whose "Still using?" is answered: the row's own answer, synced
/// from the server (0010), plus this device's cache of answers not yet
/// written back.
Set<String> answeredIds(Iterable<Subscription> subs, Set<String> cached) =>
    <String>{
      ...cached,
      for (final Subscription s in subs)
        if (s.stillUsing != null) s.id,
    };

final AsyncNotifierProvider<StillUsingController, Set<String>>
stillUsingProvider = AsyncNotifierProvider<StillUsingController, Set<String>>(
  StillUsingController.new,
);

/// The "Worth a look" heading and its rows on one card.
class SignalsSection extends ConsumerWidget {
  const SignalsSection({super.key, required this.subs, required this.money});

  final List<Subscription> subs;
  final MoneyFormatter money;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    final Set<String> answered = answeredIds(
      subs,
      ref.watch(stillUsingProvider).value ?? <String>{},
    );
    // `nowProvider`, never `DateTime.now()` (ST truth pass, IN-02): the day
    // counts are a function of today, and a test must be able to pin it.
    final DateTime now = ref.watch(nowProvider)();
    final List<InsightSignal> signals = signalsFor(
      subs,
      now,
      answered: answered,
    );

    final List<Widget> rows = <Widget>[
      for (final InsightSignal s in signals) _row(context, ref, l10n, s, now),
    ];
    return Column(
      key: const Key('insights.signals'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text(
            l10n.insightsWorthALook,
            style: text.labelLarge?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        AppCard(
          padding: rows.isEmpty
              ? const EdgeInsets.all(AppSpacing.lg)
              : EdgeInsets.zero,
          child: rows.isEmpty
              ? Text(
                  l10n.insightsNoSignals,
                  style: text.bodyMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                )
              : Column(
                  children: <Widget>[
                    for (int i = 0; i < rows.length; i++) ...<Widget>[
                      if (i > 0) const Divider(height: 1),
                      rows[i],
                    ],
                  ],
                ),
        ),
      ],
    );
  }

  Widget _row(
    BuildContext context,
    WidgetRef ref,
    AppLocalizations l10n,
    InsightSignal signal,
    DateTime now,
  ) {
    switch (signal) {
      case SameCategorySignal(
        :final String category,
        :final List<Subscription> subs,
      ):
        return AppListRow(
          key: Key('insights.signal.category.$category'),
          leading: const _SignalIcon(Icons.layers_outlined),
          title: l10n.signalDuplicateTitle(
            subs.length,
            categoryLabel(l10n, category),
          ),
          subtitle: l10n.signalDuplicateBody(
            subs.map((Subscription s) => s.name).join(', '),
            money.formatBagRounded(SubMath.totalMonthly(subs)),
          ),
        );
      case AnnualSoonSignal(:final Subscription sub, :final int days):
        return AppListRow(
          key: Key('insights.signal.annual.${sub.id}'),
          leading: const _SignalIcon(Icons.event_repeat_outlined),
          title: l10n.signalAnnualTitle(days),
          subtitle: l10n.signalAnnualBody(
            sub.name,
            money.format(sub.price),
            // The ROLLED date — the one `days` is measured to. The stored
            // date can be a year stale and printed a day already gone.
            DateFormat.MMMEd(l10n.localeName).format(sub.nextCharge(now)),
          ),
          onTap: () => context.push('/sub/${sub.id}'),
        );
      case StillUsingSignal(:final Subscription sub):
        void no() {
          ref.read(stillUsingProvider.notifier).answerNo(sub.id);
          context.push(stopRouteFor(sub.id));
        }
        void yes() => ref.read(stillUsingProvider.notifier).answerYes(sub.id);
        final Widget answers = Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          children: <Widget>[
            Semantics(
              label: l10n.signalStillUsingNoA11y(sub.name),
              button: true,
              excludeSemantics: true,
              onTap: no,
              child: OutlinedButton(
                key: Key('insights.signal.stillUsing.no.${sub.id}'),
                onPressed: no,
                child: Text(l10n.signalStillUsingNo),
              ),
            ),
            Semantics(
              label: l10n.signalStillUsingYesA11y(sub.name),
              button: true,
              excludeSemantics: true,
              onTap: yes,
              child: FilledButton.tonal(
                key: Key('insights.signal.stillUsing.yes.${sub.id}'),
                onPressed: yes,
                child: Text(l10n.signalStillUsingYes),
              ),
            ),
          ],
        );
        final Widget question = AppListRow(
          leading: const _SignalIcon(Icons.help_outline),
          title: l10n.signalStillUsingTitle(sub.name),
          subtitle: l10n.signalStillUsingBody(
            chargeWithCycle(l10n, money, sub),
          ),
          onTap: () => context.push('/sub/${sub.id}'),
          showChevron: false,
        );
        // Beside the question while the text is at its ordinary size; on a
        // line of their own once enlarged text would squeeze the question
        // into an unreadable sliver (Insights at 200 %).
        final bool stacked = MediaQuery.textScalerOf(context).scale(1) > 1;
        return stacked
            ? Column(
                key: Key('insights.signal.stillUsing.${sub.id}'),
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  question,
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.md,
                      0,
                      AppSpacing.md,
                      AppSpacing.sm,
                    ),
                    child: Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: answers,
                    ),
                  ),
                ],
              )
            : Row(
                key: Key('insights.signal.stillUsing.${sub.id}'),
                children: <Widget>[
                  Expanded(child: question),
                  Padding(
                    padding: const EdgeInsetsDirectional.only(
                      end: AppSpacing.md,
                    ),
                    child: answers,
                  ),
                ],
              );
    }
  }
}

/// Where "No, not using it" goes: the plan's stop-a-charge flow (train T10's
/// `/sub/:id/stop`, DE-07), where stopping, pausing and removing are. ONE
/// function, so the destination is a one-line move.
String stopRouteFor(String id) => '/sub/$id/stop';

/// The 40 px tinted tile a signal row leads with: the scheme's secondary
/// container pair, so it reads in both schemes without a literal.
class _SignalIcon extends StatelessWidget {
  const _SignalIcon(this.icon);
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final ColorScheme scheme = Theme.of(context).colorScheme;
    return ExcludeSemantics(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: scheme.secondaryContainer,
          borderRadius: BorderRadius.circular(AppRadius.control),
        ),
        child: Icon(icon, color: scheme.onSecondaryContainer),
      ),
    );
  }
}
