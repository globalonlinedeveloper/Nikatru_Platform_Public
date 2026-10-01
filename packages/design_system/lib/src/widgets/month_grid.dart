import 'package:flutter/material.dart';
import 'package:intl/date_symbols.dart' show DateSymbols;
import 'package:intl/intl.dart';

import '../tokens/app_spacing.dart';

/// The chassis MONTH GRID — one month, seven semantic columns, a mark on the
/// days that carry something, and an optional selection (train ST-D2).
///
/// Hoisted out of `apps/subscriptiontracker`'s calendar screen, where it was
/// ~300 lines of hand-rolled grid with its own colour and size literals. A
/// month of marked days is not a subscription idea: a habit app, a bill app
/// and a booking app draw the same grid, so it lives here and an app hands it
/// the DOMAIN — which days are marked — and nothing else.
///
/// ## What it fixes by construction
///  * **The week starts where the locale says.** The header, the first-day
///    offset and the numerals all come from `intl`'s symbol table for
///    [locale]: `FIRSTDAYOFWEEK` (ISO, 0 = Monday) rotates the header, and
///    `DateFormat.d` writes the day in the locale's own digits.
///  * **The header is readable aloud.** Each column paints the NARROW weekday
///    (`S M T W T F S` — two T's, two S's) and is ANNOUNCED by its full name,
///    one semantics node per column.
///  * **The cell's height never follows the width.** [cellExtent] is a fixed
///    main-axis extent; without it a seven-column delegate is square and a
///    desktop month is a kilometre of tinted boxes. The column count stays 7
///    because it is semantic, not responsive.
///  * **The cell cannot clip at any text scale.** The numeral is ONE line,
///    scaled down to fit the cell's width if it has to, and the grid clamps
///    text scale at [maxTextScale] — Material's own `CalendarDatePicker` does
///    the same (at 1.5 in landscape). At the ceiling the column is
///    `labelLarge` line 20 × 1.5 + [AppSpacing.xs] / 2 + dot 4 = 36, inside
///    [cellExtent]. The information is not lost to the clamp: a screen that
///    uses this grid repeats every marked day in a list that scales freely.
///  * **Every fill is opaque and from the scheme.** Today is `primary` with
///    `onPrimary` on it; a marked day is `primaryContainer` with
///    `onPrimaryContainer`; the selection is a 2 px `onSurface` ring painted
///    OVER the cell (`foregroundDecoration`), so it moves no layout and keeps
///    both fills visible underneath. No alpha wash, so every pair is one
///    measured number per scheme (`test/month_grid_test.dart`).
///  * **Only a marked day is a control, and only when [onDayTap] is given.**
///    A tappable cell is announced as a button with its selected state, and
///    is [cellExtent] (48) tall, the platform's minimum tap target.
///  * **A deadline is a second, different mark with its own words.** A day in
///    [deadlines] carries a SQUARE in `tertiary` beside (or instead of) the
///    round `primary` dot, and its cell is announced with the app's phrase
///    ("14, trial ends") — shape and words, never the colour alone. The
///    legend a screen draws uses [markDot] and [deadlineMarker], so the key
///    and the grid cannot disagree.
///
/// Every string is derived from [locale]; the grid carries no copy.
class MonthGrid extends StatelessWidget {
  const MonthGrid({
    super.key,
    required this.month,
    required this.locale,
    this.today,
    this.marks = const <int, int>{},
    this.selectedDay,
    this.onDayTap,
    this.firstDayOfWeek,
    this.deadlines = const <int, String>{},
  });

  /// Any moment inside the month to draw; only its year and month are read.
  final DateTime month;

  /// The `intl` locale name the header, the offset and the numerals come from,
  /// e.g. an app's `AppLocalizations.localeName`. Its date symbols must be
  /// loaded — `GlobalMaterialLocalizations.delegate` does that for every
  /// supported locale; a bare test calls `initializeDateFormatting`.
  final String locale;

  /// Drawn as today when it falls inside [month]; otherwise ignored.
  final DateTime? today;

  /// Day-of-month → how many things fall on it. A day with a positive count
  /// carries the mark (and is the only kind of day [onDayTap] can reach).
  final Map<int, int> marks;

  /// The selected day of [month], drawn with a ring. Ignored unless it is
  /// marked — a selection that points at nothing reads as no selection.
  final int? selectedDay;

  /// Called with a marked day when it is tapped. Null makes no cell a
  /// control, which is what a screen with nowhere to show a selection wants.
  final ValueChanged<int>? onDayTap;

  /// The first column, ISO-numbered like `intl`'s `FIRSTDAYOFWEEK`
  /// (0 = Monday … 6 = Sunday), when the user chose one. Null — the default —
  /// is the locale's own week start.
  final int? firstDayOfWeek;

  /// Day-of-month → the spoken phrase for what ENDS on it ("trial ends",
  /// "cancel by"), already localised by the app. A listed day carries the
  /// deadline marker and its cell announces the phrase after the date.
  final Map<int, String> deadlines;

  /// Each cell's fixed height: the platform's minimum tap target, because a
  /// marked cell becomes a control when [onDayTap] is given.
  static const double cellExtent = kMinInteractiveDimension;

  /// The gap between cells, on both axes.
  static const double cellSpacing = AppSpacing.xs;

  /// The text-scale ceiling inside the grid. See the class doc.
  static const double maxTextScale = 1.5;

  /// The marker dot's side.
  static const double dotSize = 4;

  /// The selection ring's width.
  static const double ringWidth = 2;

  /// The cell for [day] — stable, so a test or an e2e anchor taps a DAY and
  /// never a numeral that a price elsewhere on screen might also contain.
  static Key dayKey(int day) => ValueKey<String>('month-grid-day-$day');

  bool _isMarked(int day) => (marks[day] ?? 0) > 0;

  /// The round mark a day with something on it carries — for a legend.
  static Widget markDot(BuildContext context) => _Marker(
    color: Theme.of(context).colorScheme.primary,
    shape: BoxShape.circle,
  );

  /// The square mark a day with a deadline carries — for a legend.
  static Widget deadlineMarker(BuildContext context) => _Marker(
    color: Theme.of(context).colorScheme.tertiary,
    shape: BoxShape.rectangle,
  );

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;

    final int y = month.year, m = month.month;
    final int daysInMonth = DateTime(y, m + 1, 0).day;
    final DateSymbols symbols = DateFormat.yMMMM(locale).dateSymbols;
    final DateFormat dayFmt = DateFormat.d(locale);

    // `FIRSTDAYOFWEEK` is ISO (0 = Monday) and `DateTime.weekday` is
    // Mon=1..Sun=7, so `weekday - 1` is the same scale. Dart's `%` is
    // non-negative for a positive divisor.
    final int firstDayOfWeek = (this.firstDayOfWeek ?? symbols.FIRSTDAYOFWEEK)
        .clamp(0, 6);
    final int firstOffset =
        (DateTime(y, m, 1).weekday - 1 - firstDayOfWeek) % 7;
    // NARROWWEEKDAYS and WEEKDAYS are Sunday-first in every locale, so both
    // take the SAME rotation: the index of the locale's first column.
    final int firstColumn = (firstDayOfWeek + 1) % 7;

    final int? todayDay =
        (today != null && today!.year == y && today!.month == m)
        ? today!.day
        : null;
    final int? selected = (selectedDay != null && _isMarked(selectedDay!))
        ? selectedDay
        : null;

    final Widget header = Row(
      children: <Widget>[
        for (int i = 0; i < 7; i++)
          Expanded(
            // `container: true`, or seven label-only annotations merge into
            // one node that reads the whole week as one stop.
            child: Semantics(
              container: true,
              label: symbols.WEEKDAYS[(firstColumn + i) % 7],
              excludeSemantics: true,
              child: Center(
                child: Text(
                  symbols.NARROWWEEKDAYS[(firstColumn + i) % 7],
                  style: text.labelMedium?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          ),
      ],
    );

    Widget cell(int day) {
      final bool isToday = day == todayDay;
      final bool marked = _isMarked(day);
      final bool isSelected = day == selected;
      final Color? fill = isToday
          ? scheme.primary
          : (marked ? scheme.primaryContainer : null);
      final Color ink = isToday
          ? scheme.onPrimary
          : (marked ? scheme.onPrimaryContainer : scheme.onSurface);
      final Color dot = isToday ? scheme.onPrimary : scheme.primary;
      final BorderRadius radius = BorderRadius.circular(AppRadius.control);
      final String? deadline = deadlines[day];
      final String numeral = dayFmt.format(DateTime(y, m, day));

      final Widget column = Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          // ONE line, scaled down to the cell's width if a scaled two-digit
          // numeral would outgrow it — a wrap is what used to overflow the
          // fixed cell at 2× text.
          FittedBox(
            fit: BoxFit.scaleDown,
            child: Text(
              numeral,
              maxLines: 1,
              softWrap: false,
              style: text.labelLarge?.copyWith(
                color: ink,
                fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.xs / 2),
          if (marked || deadline != null)
            ExcludeSemantics(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  if (marked) _Marker(color: dot, shape: BoxShape.circle),
                  if (marked && deadline != null)
                    const SizedBox(width: AppSpacing.xs / 2),
                  if (deadline != null)
                    _Marker(
                      color: isToday ? scheme.onPrimary : scheme.tertiary,
                      shape: BoxShape.rectangle,
                    ),
                ],
              ),
            )
          else
            const SizedBox(height: dotSize),
        ],
      );
      // The deadline is SAID, after the date: "14, trial ends".
      final Widget content = deadline == null
          ? column
          : Semantics(
              label: '$numeral, $deadline',
              excludeSemantics: true,
              child: column,
            );

      final bool control = onDayTap != null && marked;
      return Container(
        key: dayKey(day),
        decoration: BoxDecoration(color: fill, borderRadius: radius),
        // Painted OVER the child, so the ring changes no layout and the cell
        // is the same box selected or not.
        foregroundDecoration: isSelected
            ? BoxDecoration(
                borderRadius: radius,
                border: Border.all(color: scheme.onSurface, width: ringWidth),
              )
            : null,
        child: control
            ? MergeSemantics(
                child: Semantics(
                  button: true,
                  selected: isSelected,
                  child: Material(
                    type: MaterialType.transparency,
                    child: InkWell(
                      borderRadius: radius,
                      onTap: () => onDayTap!(day),
                      child: content,
                    ),
                  ),
                ),
              )
            : content,
      );
    }

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        header,
        const SizedBox(height: AppSpacing.sm),
        MediaQuery.withClampedTextScaling(
          maxScaleFactor: maxTextScale,
          child: GridView.builder(
            shrinkWrap: true,
            padding: EdgeInsets.zero,
            physics: const NeverScrollableScrollPhysics(),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 7,
              mainAxisSpacing: cellSpacing,
              crossAxisSpacing: cellSpacing,
              mainAxisExtent: cellExtent,
            ),
            itemCount: firstOffset + daysInMonth,
            itemBuilder: (BuildContext context, int i) => i < firstOffset
                ? const SizedBox.shrink()
                : cell(i - firstOffset + 1),
          ),
        ),
      ],
    );
  }
}

/// The chassis DATE BADGE — a day numeral over its short month, sized for
/// [AppListRow.leading] (train ST-D2).
///
/// A dated row ("renews 15 Oct", "due 3 Nov") leads with its date rather than
/// an avatar. Both parts come from `intl` for [locale], so the digits and the
/// month abbreviation are the locale's own; the month is NOT upper-cased,
/// because `toUpperCase()` is locale-blind and a Turkish build would get the
/// dotless i wrong.
///
/// It scales down to its slot rather than overflowing it: the row's title,
/// subtitle and figure beside it carry the text-scale growth, and the badge's
/// date is ALSO the row's semantics (it is merged into the row's one node).
class DateBadge extends StatelessWidget {
  const DateBadge({super.key, required this.date, required this.locale});

  /// The date to show; only its day and month are drawn.
  final DateTime date;

  /// The `intl` locale name, e.g. an app's `AppLocalizations.localeName`.
  final String locale;

  @override
  Widget build(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final ColorScheme scheme = theme.colorScheme;
    final TextTheme text = theme.textTheme;
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            DateFormat.d(locale).format(date),
            style: text.titleMedium?.copyWith(
              color: scheme.onSurface,
              fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
            ),
          ),
          Text(
            DateFormat.MMM(locale).format(date),
            style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

/// One [MonthGrid.dotSize] mark: the round renewal dot or the square deadline.
class _Marker extends StatelessWidget {
  const _Marker({required this.color, required this.shape});

  final Color color;
  final BoxShape shape;

  @override
  Widget build(BuildContext context) => Container(
    width: MonthGrid.dotSize,
    height: MonthGrid.dotSize,
    decoration: BoxDecoration(color: color, shape: shape),
  );
}
