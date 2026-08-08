import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
// ⚠️ NARROWED WITH `show` ON PURPOSE. A bare import of the design system makes
// this file's two `core/theme/*` re-export shims redundant (`AppColors`,
// `AppText` come through both), which is an `unnecessary_import` info on each —
// two NEW analyzer issues for a port that is supposed to contribute zero. The
// shims stay as they were; only the two symbols this port actually adds come
// straight from the package.
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing, ContentPane;

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

class CalendarScreen extends ConsumerWidget {
  const CalendarScreen({super.key});

  static const List<String> _months = <String>[
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  static const List<String> _weekdays = <String>[
    'S',
    'M',
    'T',
    'W',
    'T',
    'F',
    'S',
  ];
  static const List<String> _mon = <String>[
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final DateTime now = DateTime.now();
    final int y = now.year, m = now.month;
    final int firstOffset = DateTime(y, m, 1).weekday % 7; // Sun=0
    final int dim = DateTime(y, m + 1, 0).day;

    final Map<int, int> byDay = <int, int>{};
    for (final Subscription s in subs) {
      if (s.nextRenewal.year == y && s.nextRenewal.month == m) {
        byDay[s.nextRenewal.day] = (byDay[s.nextRenewal.day] ?? 0) + 1;
      }
    }
    final List<Subscription> inMonth =
        subs
            .where(
              (Subscription s) =>
                  s.nextRenewal.year == y && s.nextRenewal.month == m,
            )
            .toList()
          ..sort(
            (Subscription a, Subscription b) =>
                a.nextRenewal.day.compareTo(b.nextRenewal.day),
          );
    final double monthTotal = inMonth.fold(
      0.0,
      (double a, Subscription s) => a + s.monthlyPrice,
    );

    // P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
    //
    // Default `ContentPane` (`kMaxBodyWidth`, 1280), the same cap settings and
    // manage-plan carry. This is a page of MIXED content — a month-grid card
    // above a list of renewal rows — and those rows are the same shape as
    // home's, which cap at 1280. `.reading` (720) was considered because a
    // seven-column month grid gains nothing from 1246 px, but two caps on one
    // scroll column would leave the grid card narrower than the rows beneath
    // it. One page, one cap; the grid's own height problem is fixed by the
    // delegate below, not by the pane.
    //
    // 🔴 NO `padding:` ON THE PANE — the same rule the stamped settings screen
    // records. `test/width_calendar_test.dart` asserts the ListView is OFFERED
    // exactly 375 at phone width and exactly `AppBreakpoints.kMaxBodyWidth` at
    // 1920; a pane inset would subtract from both. The gutters stay where they
    // always were: inside the ListView.
    return ContentPane(
      child: ListView(
        // PADDING RE-BASED FOR THE CHASSIS SHELL (the landed home precedent,
        // `home_screen.dart` MERGE CHANGE 3). Live was
        // `fromLTRB(18, 58, 18, 108)`; both odd numbers paid for the old shell
        // — 58 cleared a status bar under an app-bar-less `Scaffold`, 108
        // cleared the floating pill bar plus the FAB. `AppScaffold._compact()`
        // wraps the body in a `SafeArea` and puts navigation in
        // `bottomNavigationBar`, so both insets are now paid twice. 18 is
        // `AppSpacing.gutterCompact`, the chassis's own page gutter.
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.gutterCompact,
          AppSpacing.xl,
        ),
        children: <Widget>[
          Text('Renewal calendar', style: AppText.title.copyWith(fontSize: 26)),
          const SizedBox(height: 4),
          Text(
            '${_months[m - 1]} $y · ${currency.fmt(monthTotal)} renewing',
            style: AppText.muted.copyWith(fontSize: 12),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: cardDecoration(context),
            child: Column(
              children: <Widget>[
                Row(
                  children: _weekdays
                      .map(
                        (String w) => Expanded(
                          child: Center(
                            child: Text(
                              w,
                              style: AppText.label.copyWith(fontSize: 10),
                            ),
                          ),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: 6),
                GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  // 🔴 THE SQ-GRID DEFECT, FIXED. Without a `mainAxisExtent` this
                  // delegate inherits `childAspectRatio: 1.0` — every day cell is
                  // a SQUARE, so its height scales linearly with viewport width.
                  // Measured: ≈41 px per cell at 375 (the designed look), ≈97 at
                  // 768, ≈170 once the pane caps at 1280 — a month card of ~1035
                  // px of mostly-empty tinted squares around 12 pt numerals that
                  // do not scale. Nothing overflows and nothing throws; it is
                  // visible only to a measurement, which is what
                  // `test/width_calendar_test.dart` now is.
                  //
                  // 44 ≈ the cell's intrinsic content (12 pt numeral + 2 gap +
                  // 4 px dot + breathing room) and is within 3 px of today's
                  // phone rendering, so 375 is visually unchanged while 1280
                  // collapses the card to ≈279 px (6×44 + 5×3). `mainAxisExtent`
                  // takes precedence over `childAspectRatio`, so no other
                  // delegate field needs touching.
                  //
                  // `crossAxisCount: 7` STAYS. A week has seven days: this is the
                  // one grid in the app where a `MaxCrossAxisExtent` delegate
                  // would be wrong, because the column count is semantic rather
                  // than responsive.
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 7,
                    mainAxisSpacing: 3,
                    crossAxisSpacing: 3,
                    mainAxisExtent: 44,
                  ),
                  itemCount: firstOffset + dim,
                  itemBuilder: (BuildContext context, int i) {
                    if (i < firstOffset) return const SizedBox.shrink();
                    final int day = i - firstOffset + 1;
                    final bool today = day == now.day;
                    final bool has = byDay.containsKey(day);
                    return Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(11),
                        gradient: today ? AppColors.brandGradient : null,
                        color: today
                            ? null
                            : (has
                                  ? const Color.fromRGBO(100, 89, 245, 0.1)
                                  : Colors.transparent),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Text(
                            '$day',
                            style: AppText.fig.copyWith(
                              fontSize: 12,
                              color: today ? Colors.white : AppColors.ink,
                            ),
                          ),
                          const SizedBox(height: 2),
                          if (has)
                            Container(
                              width: 4,
                              height: 4,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: today ? Colors.white : AppColors.accent,
                              ),
                            )
                          else
                            const SizedBox(height: 4),
                        ],
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          SectionHeader('By date'),
          ...inMonth.map(
            (Subscription s) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: _dateRow(context, currency, s, now),
            ),
          ),
          if (inMonth.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('No renewals this month.', style: AppText.muted),
            ),
        ],
      ),
    );
  }

  Widget _dateRow(
    BuildContext context,
    Currency currency,
    Subscription s,
    DateTime now,
  ) {
    final DueInfo due = DueInfo.of(s, now);
    return Container(
      decoration: cardDecoration(context, radius: 18),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => context.push('/sub/${s.id}'),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Row(
              children: <Widget>[
                SizedBox(
                  width: 44,
                  child: Column(
                    children: <Widget>[
                      Text(
                        '${s.nextRenewal.day}',
                        style: AppText.fig.copyWith(fontSize: 19),
                      ),
                      Text(
                        _mon[s.nextRenewal.month - 1],
                        style: AppText.label.copyWith(fontSize: 9),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 3,
                  height: 38,
                  margin: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    gradient: AppColors.brandGradient,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        s.name,
                        style: AppText.body.copyWith(
                          fontWeight: FontWeight.w700,
                          fontSize: 15,
                        ),
                      ),
                      Text(
                        due.label,
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontWeight: FontWeight.w700,
                          fontSize: 11,
                          color: due.color,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  currency.fmt(s.monthlyPrice),
                  style: AppText.fig.copyWith(fontSize: 16),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
