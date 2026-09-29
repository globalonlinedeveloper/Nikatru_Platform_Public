import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
// ⚠️ NARROWED WITH `show` ON PURPOSE: a bare import of the design system would
// make the `core/theme/*` re-export shims other files in this feature use
// redundant, which is an `unnecessary_import` info per shim.
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show
        AppCard,
        AppListRow,
        AppSpacing,
        ContentPane,
        DateBadge,
        MonthGrid,
        TwoPane;

import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/due.dart';
import '../shared/async_gate.dart';
import '../shared/widgets.dart';
import '../shell/app_shell.dart';

/// ⏱ 2026-09-28 · train ST-D2 — THE CALENDAR IS BUILT FROM THE FOUNDATION.
///
/// The screen that stood here was ~900 lines, ~300 of them a hand-rolled month
/// grid and a hand-rolled twin of `RowCard`, with a colour literal (the 10%
/// brand wash), eight font-size literals and three of them under the 12 px
/// floor (the weekday letters at 10, the month abbreviation at 9, the cycle
/// caption at 10). It now composes the ST-D0 components and ONE new chassis
/// component, and holds only what is Subscription-Tracker specific: which days
/// renew, what a renewal row says, and where tapping it goes.
///
///  · The grid is `MonthGrid` (design system) — locale week start, full-name
///    weekday semantics, the fixed cell, the text-scale clamp and the opaque
///    today / marked / selected fills all live there now, with their tests.
///  · The grid's card and the renewals' card are `AppCard`; a renewal is an
///    `AppListRow` led by a `DateBadge`, so the row is one merged, button-
///    announced node by construction instead of by a note asking for it.
///  · Every size and colour is a theme role, a scheme slot or an `AppSpacing`
///    step. The due phrase keeps its urgency as a MEANING
///    ([DueInfo.statusOf]) and the row resolves the scheme-forked tone.
///
/// The page inset is [AppShell.pageInsetOf], shared by both panes: the FAB
/// floats over both columns, and two insets that agree today and drift
/// tomorrow would read as a step in the seam between them.
EdgeInsets _pageInset(BuildContext context) => AppShell.pageInsetOf(context);

/// 🔴 STATEFUL SINCE THE `TwoPane` ADOPTION, AND THE STATE IS EXACTLY ONE INT.
/// The detail column needs a selected day and nothing else: the month, the
/// renewals and the totals are all still derived per build from the clock and
/// the subscriptions provider. See [_CalendarScreenState._selectedDay] for why
/// a day-of-month is the whole selection.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({this.clock, super.key});

  /// Injectable ONLY so this screen is reachable from a test at a KNOWN date: a
  /// test process cannot choose what `DateTime.now()` reports, and this screen
  /// renders "the month `DateTime.now()` falls in" against seed data with fixed
  /// dates. That combination rots — `a11y_semantics_test` passed on 2026-08-31
  /// and failed on 2026-09-02 with NO code change, because the demo renewals had
  /// aged out of the rendered month.
  ///
  /// ⚠️ Production passes nothing and reads `nowProvider`. Making the seed
  /// dates relative to now was rejected: `demo_data.dart` also feeds
  /// `store-screenshots.yml`, so it would silently change published store
  /// assets.
  final DateTime Function()? clock;

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  /// The selected day of THIS month, or null for "the whole month".
  ///
  /// A bare int and not a `DateTime`, because the screen renders exactly one
  /// month and there is no month navigation to select out of.
  ///
  /// 🔴 IT IS NOT TRUSTED ON READ. The month rolls over at midnight and the
  /// subscription list can change under a selection, so `build` re-validates it
  /// against `byDay` every frame. An invalid selection reads as null — the
  /// whole month — which is the state the screen was in before anything was
  /// tapped.
  int? _selectedDay;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ThemeData theme = Theme.of(context);
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: ref.watch(currencyCodeProvider),
    );
    // ⚠️ THE WHOLE-SCREEN EMPTY STATE IS **NOT** `l10n.calendarEmpty`. That one
    // ("No renewals this month") is a statement about a MONTH and is still
    // printed by the by-date section; a user with five subscriptions and none
    // due this month keeps a real month grid. The state below is about the
    // ACCOUNT — no subscriptions at all — and only it may replace the grid.
    //
    // Returning early is safe here: this is a shell TAB, so `AppScaffold` owns
    // the navigation and it survives every state.
    final Widget? state = subscriptionsState(
      ref,
      l10n: l10n,
      emptyTitle: l10n.dataEmptyTitle,
      emptyBody: l10n.dataEmptyBody,
      // ST-U6 (B42): the first step, not a dead end.
      emptyActionLabel: l10n.addSubscriptionTitle,
      onEmptyAction: () => showAddSubscriptionSheet(context),
    );
    if (state != null) return state;
    final List<Subscription> subs = ref
        .watch(subscriptionsControllerProvider)
        .requireValue;
    final DateTime Function() clockFn = widget.clock ?? ref.watch(nowProvider);
    final DateTime now = clockFn();
    final int y = now.year, m = now.month;

    final Map<int, int> byDay = <int, int>{};
    for (final Subscription s in subs) {
      if (s.renewsIn(y, m)) {
        byDay[s.nextRenewal.day] = (byDay[s.nextRenewal.day] ?? 0) + 1;
      }
    }
    final List<Subscription> inMonth =
        subs.where((Subscription s) => s.renewsIn(y, m)).toList()..sort(
          (Subscription a, Subscription b) =>
              a.nextRenewal.day.compareTo(b.nextRenewal.day),
        );
    // What LEAVES THE ACCOUNT this month: each renewal's whole charge. The
    // same `renewsIn` test as `inMonth`, so the total and the list agree.
    final MoneyBag monthTotal = SubMath.chargedInMonth(subs, y, m);

    // The selection, re-validated — see [_selectedDay]. `byDay` is the same map
    // the grid marks its days from, so "is selectable" and "is marked" are ONE
    // condition read in two places.
    final int? selectedDay = byDay.containsKey(_selectedDay)
        ? _selectedDay
        : null;

    // THE WIDTH DECISION (unchanged by ST-D2; `test/width_calendar_test.dart`
    // measures it). Below `AppBreakpoints.expanded` (840) the screen is ONE
    // column capped at `.reading` (720): grid, then renewals. From 840 up it is
    // a `TwoPane` — the grid is the master (capped at `.pane`, 480, which is
    // what keeps a day cell from becoming a letterbox) and the renewals are the
    // detail.
    //
    // 🔴 `TwoPane` IS THE OUTERMOST WIDGET AND THE PANES ARE INSIDE IT. It
    // splits on the width IT was given; a `ContentPane.reading` around it would
    // hand it 720 < 840 at every window and the split could never happen.
    return TwoPane(
      // Below 840 `TwoPane` returns `list` UNWRAPPED — the phone's tree.
      list: Builder(
        builder: (BuildContext context) {
          // 🔴 `TwoPane.isTwoPaneOf`, NOT `MediaQuery`: the decision `TwoPane`
          // published from the width it was handed. Window and body differ (the
          // rail takes its width first), and re-deriving from the window would
          // drop the renewals from this column while the detail column was not
          // being built at all.
          final bool split = TwoPane.isTwoPaneOf(context);
          return ContentPane.reading(
            // KEYED because there are TWO panes and `find.byType(ContentPane)`
            // cannot tell them apart (`test/support/width_harness.dart`).
            key: const Key('calendar-grid-pane'),
            child: ListView(
              // 🔴 NO `padding:` ON THE PANE: `width_calendar_test.dart`
              // asserts the ListView is OFFERED exactly the pane's width. The
              // gutters stay inside the ListView.
              padding: _pageInset(context),
              children: <Widget>[
                Text(
                  l10n.calendarTitle,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    color: theme.colorScheme.onSurface,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                Text(
                  // ONE key with two placeholders: `{month}` carries month AND
                  // year because a locale may order them either way. It stays a
                  // MONTH total even with a day selected — it captions the grid.
                  l10n.calendarSubtitle(
                    DateFormat.yMMMM(l10n.localeName).format(now),
                    money.formatBag(monthTotal),
                  ),
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                AppCard(
                  child: MonthGrid(
                    month: now,
                    locale: l10n.localeName,
                    today: now,
                    marks: byDay,
                    // 🔴 SELECTION EXISTS ONLY IN TWO-PANE MODE. Below 840
                    // there is no detail column for a selection to point at, so
                    // a selected cell would be a highlight that changed nothing
                    // — and a window shrunk back to a phone would carry a mark
                    // the user could no longer clear. `split` gates the ring AND
                    // the tap.
                    selectedDay: split ? selectedDay : null,
                    // Tapping the selected day again clears it — the only way
                    // back to the whole month; a "show all" control would need
                    // copy this screen has no key for. Only MARKED days are
                    // controls (MonthGrid's rule), which is what keeps a day's
                    // detail list non-empty and `calendarEmpty` true.
                    onDayTap: split
                        ? (int day) => setState(() {
                            _selectedDay = day == selectedDay ? null : day;
                          })
                        : null,
                  ),
                ),
                // BELOW 840 THE RENEWALS SIT UNDER THE GRID. Above it they ARE
                // the detail column; including them here too would render every
                // row twice.
                if (!split)
                  ..._renewals(
                    context,
                    l10n,
                    money,
                    now,
                    l10n.calendarByDate,
                    inMonth,
                  ),
              ],
            ),
          );
        },
      ),
      // THE DETAIL IS NEVER NULL: with nothing selected it is the WHOLE month —
      // the same list, under the same heading, that sits under the grid on a
      // phone. Selecting a day NARROWS it instead of filling it.
      detail: ContentPane.reading(
        key: const Key('calendar-day-pane'),
        child: ListView(
          padding: _pageInset(context),
          children: _renewals(
            context,
            l10n,
            money,
            now,
            selectedDay == null
                ? l10n.calendarByDate
                // A day's heading is that date from the locale's symbol table.
                // No arb key: a date is not copy.
                : DateFormat.yMMMMd(
                    l10n.localeName,
                  ).format(DateTime(y, m, selectedDay)),
            selectedDay == null
                ? inMonth
                : inMonth
                      .where(
                        (Subscription s) => s.nextRenewal.day == selectedDay,
                      )
                      .toList(),
          ),
        ),
      ),
      // 🔴 UNREACHABLE BY CONSTRUCTION: `detail` above is never null. A real
      // placeholder would need a sentence ("Select a day…") with no arb key. If
      // `detail` ever becomes nullable, this must become a real placeholder AND
      // the key must be added first.
      placeholder: const SizedBox.shrink(),
    );
  }

  /// The "By date" section — heading, one card of rows, or the empty line.
  ///
  /// ONE builder for both panes: below 840 it is the tail of the master column,
  /// above 840 it is the whole detail column.
  List<Widget> _renewals(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    DateTime now,
    String heading,
    List<Subscription> rows,
  ) {
    final ThemeData theme = Theme.of(context);
    return <Widget>[
      SectionHeader(heading),
      if (rows.isNotEmpty)
        AppCard(
          // The rows carry their own inset; the card is their edge.
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < rows.length; i++) ...<Widget>[
                if (i > 0) const Divider(height: 1),
                _row(context, l10n, money, rows[i], now),
              ],
            ],
          ),
        )
      else
        // Reachable only under `calendarByDate`: a day is selectable only when
        // it HAS renewals, so a per-day list is never empty and this
        // month-scoped sentence never appears under a day heading.
        Text(
          l10n.calendarEmpty,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
    ];
  }

  /// One renewal: its date, its name, when it is due (in words, toned by
  /// urgency), and the charge with its cycle. The row is one merged node,
  /// announced as a button, because `AppListRow` makes it so.
  Widget _row(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    Subscription s,
    DateTime now,
  ) {
    // `DueInfo.localized` for the WORDS (arb-backed, plural-correct);
    // `DueInfo.statusOf` for the tone, with the same threshold. The row paints
    // the tone for the ambient scheme, so no brightness is threaded here.
    final DueInfo due = DueInfo.localized(l10n, s, now);
    return AppListRow(
      leading: DateBadge(date: s.nextRenewal, locale: l10n.localeName),
      title: s.name,
      subtitle: due.label,
      status: DueInfo.statusOf(s, now),
      figure: money.format(s.price),
      caption: s.cycle == BillingCycle.yearly ? l10n.perYear : l10n.perMonth,
      onTap: () => context.push('/sub/${s.id}'),
    );
  }
}
