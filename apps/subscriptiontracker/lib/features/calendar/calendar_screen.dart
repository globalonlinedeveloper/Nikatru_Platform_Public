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
        StatusKind,
        TwoPane;

import '../../core/format/home_totals.dart';
import '../../core/format/money_format.dart';
import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../add/add_subscription_sheet.dart';
import '../shared/cadence_label.dart';
import '../shared/due.dart';
import '../shared/async_gate.dart';
import '../shared/widgets.dart';
import '../shell/app_shell.dart';
import 'calendar_feed_actions.dart';

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
/// ⏱ T12 · PLAN THE YEAR (CA-04, CA-05, CA-06).
///  · The month PAGES: back, forward and Today, over PROJECTED charges
///    ([SubMath.chargesBetween]) — a monthly plan is on every month's grid,
///    not only on the one its stored date falls in. A "12 months" view lists
///    the year ahead as an agenda.
///  · An empty month says when the next charge is ("Nothing renews in
///    October — next: Netflix on 3 Nov"), and a large window names the most
///    expensive month ahead.
///  · Trial ends and cancel-by deadlines are on the grid as a second, square
///    mark with a legend, and are SAID ("14, trial ends").
///  · The private feed is here, where a user looks for it — Subscribe,
///    Download .ics, Copy link — through Settings' own calls.
///
/// The page inset is [AppShell.pageInsetOf], shared by both panes: the FAB
/// floats over both columns, and two insets that agree today and drift
/// tomorrow would read as a step in the seam between them.
EdgeInsets _pageInset(BuildContext context) => AppShell.pageInsetOf(context);

/// The week's first column, ISO-numbered (0 = Monday … 6 = Sunday), or null
/// for the locale's own. Train T14's week-start preference overrides THIS
/// provider; until it lands the locale decides.
final Provider<int?> calendarWeekStartProvider = Provider<int?>((ref) => null);

/// How many months the agenda shows, and the most-expensive-month line scans.
const int kCalendarAgendaMonths = 12;

/// How far past an empty month the "next:" pointer looks for a charge.
const int _nextChargeHorizonDays = 730;

/// The month view or the twelve-month agenda.
enum CalendarView { month, agenda }

/// One deadline on the grid: [sub]'s trial ends, or the last day to cancel
/// before the charge [charge].
class _Deadline {
  const _Deadline.trial(this.sub, this.on) : charge = null;
  const _Deadline.cancelBy(this.sub, this.on, DateTime this.charge);
  final Subscription sub;
  final DateTime on;
  final DateTime? charge;
  bool get isTrial => charge == null;
}

/// 🔴 STATEFUL SINCE THE `TwoPane` ADOPTION. The state is the PAGE (a month
/// offset from today's), the VIEW, and a selected day of the paged month —
/// everything else is derived per build from the clock and the subscriptions.
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

  static const Key prevKey = Key('calendar.prev');
  static const Key nextKey = Key('calendar.next');
  static const Key todayKey = Key('calendar.today');
  static const Key viewKey = Key('calendar.view');
  static const Key monthLabelKey = Key('calendar.month');
  static const Key emptyKey = Key('calendar.empty');
  static const Key mostExpensiveKey = Key('calendar.mostExpensive');
  static const Key legendKey = Key('calendar.legend');
  static const Key agendaKey = Key('calendar.agenda');
  static Key agendaMonthKey(int i) => Key('calendar.agenda.month.$i');

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  /// Months from the current one: 0 is this month, 1 the next, -1 the last.
  int _offset = 0;

  CalendarView _view = CalendarView.month;

  /// The selected day of the PAGED month, or null for "the whole month".
  ///
  /// 🔴 IT IS NOT TRUSTED ON READ. The month rolls over at midnight and the
  /// subscription list can change under a selection, so `build` re-validates it
  /// against `byDay` every frame. An invalid selection reads as null — the
  /// whole month — and paging clears it.
  int? _selectedDay;

  void _page(int to) => setState(() {
    _offset = to;
    _selectedDay = null;
  });

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final MoneyFormatter money = MoneyFormatter(
      l10n.localeName,
      emptyCurrencyCode: ref.watch(currencyCodeProvider),
    );
    // ⚠️ THE WHOLE-SCREEN EMPTY STATE IS ABOUT THE ACCOUNT — no subscriptions
    // at all — and only it may replace the grid. A month with nothing in it
    // keeps its grid and says so (`calendarNothingRenews`).
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
    final DateTime month = DateTime(now.year, now.month + _offset);
    final int y = month.year, m = month.month;

    // ⏱ ST truth pass (CA-01, CA-02) and T12 (CA-04): EVERY charge in the
    // month, CHARGING rows only, projected by the date engine — one list
    // feeds the dots, the rows, the day labels and the total.
    final List<ProjectedCharge> charges = SubMath.chargesInMonth(subs, y, m);
    final Map<int, int> byDay = <int, int>{};
    final Map<int, List<Money>> spentByDay = <int, List<Money>>{};
    for (final ProjectedCharge c in charges) {
      byDay[c.on.day] = (byDay[c.on.day] ?? 0) + 1;
      (spentByDay[c.on.day] ??= <Money>[]).add(c.sub.price);
    }
    final List<_Deadline> deadlines = _deadlinesIn(subs, y, m);
    // What LEAVES THE ACCOUNT this month: each projected charge's whole price.
    // The same list the rows are, so the total and the rows agree.
    final MoneyBag monthTotal = MoneyBag.sum(
      charges.map((ProjectedCharge c) => c.sub.price),
    );

    // The selection, re-validated — see [_selectedDay]. `byDay` is the same map
    // the grid marks its days from, so "is selectable" and "is marked" are ONE
    // condition read in two places.
    final int? selectedDay = byDay.containsKey(_selectedDay)
        ? _selectedDay
        : null;

    if (_view == CalendarView.agenda) {
      // The agenda is a single reading column at every width: twelve months
      // of rows read top to bottom, so a detail column would have nothing of
      // its own to show.
      return ContentPane.reading(
        key: const Key('calendar-grid-pane'),
        child: ListView(
          padding: _pageInset(context),
          children: <Widget>[
            ..._head(context, l10n, money, month, monthTotal, now),
            ..._agenda(context, l10n, money, subs, month, now),
            const CalendarFeedBar(),
          ],
        ),
      );
    }

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
          // published from the width it was handed.
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
                ..._head(context, l10n, money, month, monthTotal, now),
                AppCard(
                  child: MonthGrid(
                    month: month,
                    locale: l10n.localeName,
                    today: now,
                    marks: byDay,
                    firstDayOfWeek: ref.watch(calendarWeekStartProvider),
                    deadlines: <int, String>{
                      for (final int day in <int>{
                        for (final _Deadline d in deadlines) d.on.day,
                      })
                        day: <String>{
                          for (final _Deadline d in deadlines)
                            if (d.on.day == day)
                              d.isTrial
                                  ? l10n.calendarTrialEnds
                                  : l10n.calendarCancelBy,
                        }.join(', '),
                    },
                    // ST truth pass (CA-03): a cell NAMES its renewals — the
                    // dot is decorative, so without this no reader heard which
                    // days charge or what.
                    dayLabel: (int day, {required bool isToday}) => <String>[
                      DateFormat.MMMMEEEEd(
                        l10n.localeName,
                      ).format(DateTime(y, m, day)),
                      if (isToday) l10n.calendarDayToday,
                      if ((byDay[day] ?? 0) > 0) ...<String>[
                        l10n.calendarDayRenewals(byDay[day]!),
                        money.formatBag(MoneyBag.sum(spentByDay[day]!)),
                      ],
                    ].join(', '),
                    // 🔴 SELECTION EXISTS ONLY IN TWO-PANE MODE. Below 840
                    // there is no detail column for a selection to point at.
                    selectedDay: split ? selectedDay : null,
                    // Tapping the selected day again clears it — the only way
                    // back to the whole month. Only MARKED days are controls.
                    onDayTap: split
                        ? (int day) => setState(() {
                            _selectedDay = day == selectedDay ? null : day;
                          })
                        : null,
                  ),
                ),
                _legend(context, l10n, deadlines.isNotEmpty),
                // A large window has room to plan the year: the costliest
                // month of the twelve ahead.
                if (split) ?_mostExpensive(context, l10n, money, subs, now),
                // BELOW 840 THE RENEWALS SIT UNDER THE GRID. Above it they ARE
                // the detail column; including them here too would render every
                // row twice.
                if (!split) ...<Widget>[
                  ..._renewals(
                    context,
                    l10n,
                    money,
                    subs,
                    month,
                    now,
                    l10n.calendarByDate,
                    charges,
                  ),
                  ..._deadlineRows(context, l10n, money, deadlines),
                ],
                const CalendarFeedBar(),
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
          children: <Widget>[
            ..._renewals(
              context,
              l10n,
              money,
              subs,
              month,
              now,
              selectedDay == null
                  ? l10n.calendarByDate
                  // A day's heading is that date from the locale's symbol
                  // table. No arb key: a date is not copy.
                  : DateFormat.yMMMMd(
                      l10n.localeName,
                    ).format(DateTime(y, m, selectedDay)),
              selectedDay == null
                  ? charges
                  : charges
                        .where((ProjectedCharge c) => c.on.day == selectedDay)
                        .toList(),
            ),
            if (selectedDay == null)
              ..._deadlineRows(context, l10n, money, deadlines),
          ],
        ),
      ),
      // 🔴 UNREACHABLE BY CONSTRUCTION: `detail` above is never null.
      placeholder: const SizedBox.shrink(),
    );
  }

  /// Title, the pager (back · month · forward · Today), the view switch and
  /// the month's total.
  List<Widget> _head(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    DateTime month,
    MoneyBag monthTotal,
    DateTime now,
  ) {
    final ThemeData theme = Theme.of(context);
    final String monthName = DateFormat.yMMMM(l10n.localeName).format(month);
    return <Widget>[
      Text(
        l10n.calendarTitle,
        style: theme.textTheme.headlineSmall?.copyWith(
          color: theme.colorScheme.onSurface,
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      // ONE row for the pager — back, the month, forward — so Tab reads it
      // left to right; the view switch and Today on the next.
      Row(
        children: <Widget>[
          IconButton(
            key: CalendarScreen.prevKey,
            tooltip: l10n.calendarPrevMonth,
            onPressed: () => _page(_offset - 1),
            icon: Icon(
              Icons.chevron_left,
              semanticLabel: l10n.calendarPrevMonth,
            ),
          ),
          // The page's caption IS the pager's label: the month (and year — a
          // locale may order them either way) and what leaves the account in
          // it. One string, so the month is printed once. It stays a MONTH
          // total even with a day selected.
          Expanded(
            child: Semantics(
              liveRegion: true,
              child: Text(
                key: CalendarScreen.monthLabelKey,
                l10n.calendarSubtitle(monthName, money.formatBag(monthTotal)),
                textAlign: TextAlign.center,
                style: theme.textTheme.titleSmall?.copyWith(
                  color: theme.colorScheme.onSurface,
                ),
              ),
            ),
          ),
          IconButton(
            key: CalendarScreen.nextKey,
            tooltip: l10n.calendarNextMonth,
            onPressed: () => _page(_offset + 1),
            icon: Icon(
              Icons.chevron_right,
              semanticLabel: l10n.calendarNextMonth,
            ),
          ),
        ],
      ),
      const SizedBox(height: AppSpacing.xs),
      Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: <Widget>[
          Semantics(
            label: l10n.calendarViewLabel,
            container: true,
            child: SegmentedButton<CalendarView>(
              key: CalendarScreen.viewKey,
              showSelectedIcon: false,
              segments: <ButtonSegment<CalendarView>>[
                ButtonSegment<CalendarView>(
                  value: CalendarView.month,
                  label: Text(l10n.calendarViewMonth),
                ),
                ButtonSegment<CalendarView>(
                  value: CalendarView.agenda,
                  label: Text(l10n.calendarViewAgenda),
                ),
              ],
              selected: <CalendarView>{_view},
              onSelectionChanged: (Set<CalendarView> v) =>
                  setState(() => _view = v.single),
            ),
          ),
          if (_offset != 0)
            TextButton(
              key: CalendarScreen.todayKey,
              onPressed: () => _page(0),
              child: Text(l10n.calendarToday),
            ),
        ],
      ),
      const SizedBox(height: AppSpacing.lg),
    ];
  }

  /// The key to the grid's two marks — the deadline half only when the month
  /// has a deadline to explain.
  Widget _legend(BuildContext context, AppLocalizations l10n, bool deadlines) {
    final ThemeData theme = Theme.of(context);
    final TextStyle? style = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );
    Widget item(Widget mark, String label) => Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        ExcludeSemantics(child: mark),
        const SizedBox(width: AppSpacing.xs),
        Text(label, style: style),
      ],
    );
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Wrap(
        key: CalendarScreen.legendKey,
        spacing: AppSpacing.lg,
        runSpacing: AppSpacing.xs,
        children: <Widget>[
          item(MonthGrid.markDot(context), l10n.calendarLegendRenews),
          if (deadlines)
            item(
              MonthGrid.deadlineMarker(context),
              l10n.calendarLegendDeadline,
            ),
        ],
      ),
    );
  }

  /// Trial ends and cancel-by days that fall in [month] of [year]: a trial's
  /// end date, and for a plan with a notice period, its next charge's date
  /// less the notice — for every projected charge whose cancel-by lands here.
  static List<_Deadline> _deadlinesIn(
    List<Subscription> subs,
    int year,
    int month,
  ) {
    final DateTime first = DateTime(year, month);
    final DateTime last = DateTime(year, month + 1, 0);
    bool inMonth(DateTime d) => d.year == year && d.month == month;
    final List<_Deadline> out = <_Deadline>[
      for (final Subscription s in SubMath.charging(subs))
        if (s.trialEndsOn != null && inMonth(s.trialEndsOn!))
          _Deadline.trial(
            s,
            DateTime(
              s.trialEndsOn!.year,
              s.trialEndsOn!.month,
              s.trialEndsOn!.day,
            ),
          ),
    ];
    for (final Subscription s in SubMath.charging(subs)) {
      final int? notice = s.noticeDays;
      if (notice == null) continue;
      for (final ProjectedCharge c in SubMath.chargesBetween(
        <Subscription>[s],
        first,
        last.add(Duration(days: notice)),
      )) {
        final DateTime by = DateTime(c.on.year, c.on.month, c.on.day - notice);
        if (inMonth(by)) out.add(_Deadline.cancelBy(s, by, c.on));
      }
    }
    out.sort((_Deadline a, _Deadline b) => a.on.compareTo(b.on));
    return out;
  }

  /// The "Deadlines" section under the renewals, when the month has any.
  List<Widget> _deadlineRows(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<_Deadline> deadlines,
  ) {
    if (deadlines.isEmpty) return const <Widget>[];
    return <Widget>[
      SectionHeader(l10n.calendarDeadlines),
      AppCard(
        padding: EdgeInsets.zero,
        child: Column(
          children: <Widget>[
            for (int i = 0; i < deadlines.length; i++) ...<Widget>[
              if (i > 0) const Divider(height: 1),
              AppListRow(
                key: Key(
                  'calendar.deadline.${deadlines[i].sub.id}.'
                  '${deadlines[i].isTrial ? 'trial' : 'cancelBy'}',
                ),
                leading: DateBadge(
                  date: deadlines[i].on,
                  locale: l10n.localeName,
                ),
                title: deadlines[i].sub.name,
                subtitle: deadlines[i].isTrial
                    ? l10n.calendarTrialEndsRow(
                        '${money.format(deadlines[i].sub.price)}'
                        '${cadenceCaption(l10n, deadlines[i].sub.cycle)}',
                      )
                    : l10n.calendarCancelByRow(
                        DateFormat.MMMEd(
                          l10n.localeName,
                        ).format(deadlines[i].charge!),
                      ),
                status: StatusKind.warn,
                onTap: () => context.push('/sub/${deadlines[i].sub.id}'),
              ),
            ],
          ],
        ),
      ),
    ];
  }

  /// Twelve months from the paged one, each a heading with its total and its
  /// rows — or the empty-month sentence.
  List<Widget> _agenda(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime from,
    DateTime now,
  ) {
    return <Widget>[
      for (int i = 0; i < kCalendarAgendaMonths; i++)
        KeyedSubtree(
          key: CalendarScreen.agendaMonthKey(i),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: _renewals(
              context,
              l10n,
              money,
              subs,
              DateTime(from.year, from.month + i),
              now,
              null,
              SubMath.chargesInMonth(subs, from.year, from.month + i),
            ),
          ),
        ),
    ];
  }

  /// "Most expensive month ahead: March 2027 · ₹5,397" — the costliest of the
  /// next twelve months, ranked in the home currency; null when nothing
  /// charges in any of them.
  Widget? _mostExpensive(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime now,
  ) {
    final HomeTotals totals = homeTotalsOf(ref);
    final List<({DateTime month, MoneyBag bag})> months =
        <({DateTime month, MoneyBag bag})>[
          for (int i = 0; i < kCalendarAgendaMonths; i++)
            (
              month: DateTime(now.year, now.month + i),
              bag: MoneyBag.sum(
                SubMath.chargesInMonth(
                  subs,
                  now.year,
                  now.month + i,
                ).map((ProjectedCharge c) => c.sub.price),
              ),
            ),
        ];
    // Ranked in the home currency (converted where a rate table has been
    // read); with no table and no plan in the home currency, in the currency
    // the plans are in — a ranking is never across unconverted currencies.
    String rankIn = totals.home;
    if (!months.any(
      (({DateTime month, MoneyBag bag}) m) =>
          totals.of(m.bag).byCurrency.containsKey(totals.home),
    )) {
      final List<String> seen = <String>[
        for (final ({DateTime month, MoneyBag bag}) m in months)
          ...m.bag.byCurrency.keys,
      ];
      if (seen.isEmpty) return null;
      rankIn = seen.first;
    }
    DateTime? best;
    MoneyBag? bestBag;
    double bestWeight = 0;
    for (final ({DateTime month, MoneyBag bag}) m in months) {
      final double w = SubMath.chartWeight(totals.of(m.bag), rankIn);
      if (w > bestWeight) {
        best = m.month;
        bestBag = m.bag;
        bestWeight = w;
      }
    }
    if (best == null) return null;
    final ThemeData theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Text(
        key: CalendarScreen.mostExpensiveKey,
        l10n.calendarMostExpensive(
          DateFormat.yMMMM(l10n.localeName).format(best),
          money.formatBag(bestBag!),
        ),
        style: theme.textTheme.bodyMedium?.copyWith(
          color: theme.colorScheme.onSurface,
        ),
      ),
    );
  }

  /// The "By date" section — heading, one card of rows, or the empty-month
  /// sentence with the next charge after it.
  ///
  /// ONE builder for every place a month's charges are listed: the tail of the
  /// phone column, the whole detail column, and each agenda month (whose
  /// heading — [heading] null — is the month itself).
  List<Widget> _renewals(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    List<Subscription> subs,
    DateTime month,
    DateTime now,
    String? heading,
    List<ProjectedCharge> rows,
  ) {
    final ThemeData theme = Theme.of(context);
    final String monthName = DateFormat.yMMMM(l10n.localeName).format(month);
    return <Widget>[
      SectionHeader(
        heading ??
            (rows.isEmpty
                ? monthName
                : l10n.calendarSubtitle(
                    monthName,
                    money.formatBag(
                      MoneyBag.sum(
                        rows.map((ProjectedCharge c) => c.sub.price),
                      ),
                    ),
                  )),
      ),
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
        // Reachable only for a whole month: a day is selectable only when it
        // HAS charges, so a per-day list is never empty.
        Text(
          key: heading == null ? null : CalendarScreen.emptyKey,
          _emptyMonth(l10n, subs, month),
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
    ];
  }

  /// "Nothing renews in October 2026 — next: Netflix on 3 Nov 2026", or the
  /// first half alone when nothing charges in the next two years.
  static String _emptyMonth(
    AppLocalizations l10n,
    List<Subscription> subs,
    DateTime month,
  ) {
    final String monthName = DateFormat.yMMMM(l10n.localeName).format(month);
    final DateTime after = DateTime(month.year, month.month + 1);
    final List<ProjectedCharge> next = SubMath.chargesBetween(
      subs,
      after,
      after.add(const Duration(days: _nextChargeHorizonDays)),
    );
    if (next.isEmpty) return l10n.calendarNothingRenews(monthName);
    return l10n.calendarNothingRenewsNext(
      monthName,
      next.first.sub.name,
      DateFormat.yMMMd(l10n.localeName).format(next.first.on),
    );
  }

  /// One charge: its date, its name, when it is due (in words, toned by
  /// urgency), and the price with its cycle. The row is one merged node,
  /// announced as a button, because `AppListRow` makes it so.
  ///
  /// ⏱ ST truth pass (CA-02): the badge and the words are THIS charge's date,
  /// not the stored one — a weekly plan's third charge says "In 15 days", and
  /// a charge earlier this month says it was charged. The urgent tone is the
  /// same today-or-tomorrow threshold [DueInfo] keeps; a trial says so.
  Widget _row(
    BuildContext context,
    AppLocalizations l10n,
    MoneyFormatter money,
    ProjectedCharge c,
    DateTime now,
  ) {
    final Subscription s = c.sub;
    final int d = DateTime.utc(
      c.on.year,
      c.on.month,
      c.on.day,
    ).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
    // A row with NO cadence is never rolled, so a past date on it is OVERDUE
    // (DueInfo's rule), not a charge the app can say happened.
    final bool overdue = d < 0 && s.cycle == null;
    final String when = overdue
        ? l10n.dueOverdue
        : (d < 0
              ? l10n.calendarCharged
              : (d == 0
                    ? l10n.dueToday
                    : (d == 1 ? l10n.renewsTomorrow : l10n.dueInDays(d))));
    final LifeStatus? life = LifeStatus.of(l10n, s);
    return AppListRow(
      leading: DateBadge(date: c.on, locale: l10n.localeName),
      title: s.name,
      subtitle: life == null ? when : '$when · ${life.label}',
      status:
          life?.kind ??
          (overdue || (d >= 0 && d <= 1) ? StatusKind.warn : null),
      figure: money.format(s.price),
      caption: cadenceCaption(l10n, s.cycle),
      onTap: () => context.push('/sub/${s.id}'),
    );
  }
}
