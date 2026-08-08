import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
// ⚠️ NARROWED WITH `show` ON PURPOSE. A bare import of the design system makes
// this file's two `core/theme/*` re-export shims redundant (`AppColors`,
// `AppText` come through both), which is an `unnecessary_import` info on each —
// two NEW analyzer issues for a port that is supposed to contribute zero. The
// shims stay as they were; only the two symbols this port actually adds come
// straight from the package.
import 'package:intl/date_symbols.dart' show DateSymbols;
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing, ContentPane;

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/due.dart';
import '../shared/widgets.dart';

/// The two neutrals this screen paints text with, resolved for the current
/// brightness.
///
/// 🔴 LIGHT IS THE LITERAL TOKEN, ON PURPOSE — the same rule `cardDecoration`
/// and `RowCard` carry (`features/shared/widgets.dart`). `apps/subly` is the
/// frozen legacy rail-prover the owner eyeballs, so the light branch must stay
/// byte-identical to the pre-dark screen. Note that reaching for
/// `Theme.of(context).extension<AppThemeX>()!.muted` would NOT be equivalent:
/// under the seeded chassis theme that slot is `scheme.onSurfaceVariant` in
/// BOTH brightnesses, so it would repaint every muted line in the light build.
///
/// 🔴 DARK IS THE DEFECT THIS FIXES. `AppText.title`/`.fig`/`.body` bake
/// `AppColors.ink` (#141420) and `AppText.muted`/`.label` bake
/// `AppColors.muted` — near-black and mid-grey. Painted on a dark scaffold
/// (`buildAppTheme(brightness: dark)` sets it to `scheme.surface`) the titles
/// are all but invisible. The dark values are the SAME slots `buildAppTheme`
/// itself maps these neutrals to (`ink: scheme.onSurface`) and
/// `AppThemeX.fromScheme` maps `muted` to (`scheme.onSurfaceVariant`), so this
/// derives from the seed rather than inventing a colour.
///
/// ⚠️ Spelled out here rather than shared: `budget_screen.dart` and
/// `insights_screen.dart` carry the identical helper. That triplication is
/// deliberate for this increment — each file-group increment of the P4 campaign
/// must stay independently compilable — and the hoist into `features/shared/`
/// belongs to the campaign's closing cleanup, alongside the deletion of
/// `DueInfo.of`.
({Color ink, Color muted}) _neutrals(BuildContext context) {
  final ThemeData theme = Theme.of(context);
  if (theme.brightness == Brightness.light) {
    return (ink: AppColors.ink, muted: AppColors.muted);
  }
  final ColorScheme scheme = theme.colorScheme;
  return (ink: scheme.onSurface, muted: scheme.onSurfaceVariant);
}

class CalendarScreen extends ConsumerWidget {
  const CalendarScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({Color ink, Color muted}) neutral = _neutrals(context);
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final DateTime now = DateTime.now();
    final int y = now.year, m = now.month;
    final int dim = DateTime(y, m + 1, 0).day;

    // 🔴 THE THREE HARDCODED ENGLISH TABLES ARE GONE — `_months`, `_weekdays`
    // and `_mon`. Every one of them is data `intl` already ships for both
    // locales (and for every locale the portfolio ever adds), so an arb key for
    // "January" would have been a translation of something nobody has to
    // translate. Measured against the live tables, `en` is byte-identical:
    // yMMMM -> "August 2026", NARROWWEEKDAYS -> [S, M, T, W, T, F, S],
    // MMM upper -> "AUG". Nothing moves in the shipped English build.
    final DateFormat monthYearFmt = DateFormat.yMMMM(l10n.localeName);
    final DateSymbols symbols = monthYearFmt.dateSymbols;

    // The day-of-month numerals go through `intl` too, and that is NOT
    // pedantry: `'$day'` renders the Dart default digits, while a locale with
    // its own numeral set (Arabic-Indic, Bengali, Devanagari …) writes the same
    // number with different glyphs. `DateFormat.d` reads that from the same
    // symbol table the month names come from. Measured: `en` and `ta` both
    // render 1, 5, 9, 10, 28, 31 unpadded — byte-identical to the
    // interpolation, so the shipped grid does not move.
    final DateFormat dayFmt = DateFormat.d(l10n.localeName);

    // 🔴 AND THE WEEK NO LONGER STARTS ON SUNDAY BECAUSE THE CODE SAYS SO.
    // The live screen read `DateTime(y, m, 1).weekday % 7` under a `// Sun=0`
    // comment and drew a fixed Sunday-first header — correct in en-US, wrong in
    // most of Europe, and unfixable without editing Dart. `FIRSTDAYOFWEEK` is
    // ISO-style (0 = Monday), so Sunday is 6; both `en` and `ta` report 6, which
    // is why this screen renders identically today and correctly tomorrow.
    //
    // `DateTime.weekday` is Mon=1..Sun=7, so `weekday - 1` is the same 0=Monday
    // scale. Dart's `%` returns a non-negative result for a positive divisor, so
    // the subtraction needs no manual wrap.
    final int firstDayOfWeek = symbols.FIRSTDAYOFWEEK;
    final int firstOffset =
        (DateTime(y, m, 1).weekday - 1 - firstDayOfWeek) % 7;

    // NARROWWEEKDAYS is ALWAYS Sunday-first whatever the locale's week starts
    // on, so the header is a ROTATION of it rather than the list itself.
    // Sunday-first index of the locale's first column = (FIRSTDAYOFWEEK + 1) % 7
    // — 0 (Sunday) when FIRSTDAYOFWEEK is 6, 1 (Monday) when it is 0.
    final int firstColumn = (firstDayOfWeek + 1) % 7;
    final List<String> weekdayHeads = <String>[
      for (int i = 0; i < 7; i++) symbols.NARROWWEEKDAYS[(firstColumn + i) % 7],
    ];

    // 🔴 THE NARROW FORM IS UNREADABLE ALOUD, AND IN ENGLISH IT IS AMBIGUOUS ON
    // FOUR OF SEVEN COLUMNS. `NARROWWEEKDAYS` in `en` is [S, M, T, W, T, F, S] —
    // two T's and two S's — so a screen reader announces this header row as
    // "S M T W T F S" and a user cannot tell Tuesday from Thursday or Saturday
    // from Sunday. The letters exist because the column is ~44 px wide; that is
    // a LAYOUT constraint and it has no business reaching the audio channel.
    //
    // `WEEKDAYS` is the same symbol table's full-name list, so this needs NO arb
    // key — exactly the argument this file already makes for the month names it
    // deleted three tables to reach. It is Sunday-first like NARROWWEEKDAYS, so
    // it takes the IDENTICAL rotation; deriving it from `firstColumn` rather
    // than re-deriving the offset is what keeps the two lists from drifting
    // apart the day the week-start rule changes.
    final List<String> weekdayNames = <String>[
      for (int i = 0; i < 7; i++) symbols.WEEKDAYS[(firstColumn + i) % 7],
    ];

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
          Text(
            l10n.calendarTitle,
            style: AppText.title.copyWith(fontSize: 26, color: neutral.ink),
          ),
          const SizedBox(height: 4),
          Text(
            // ONE key with two placeholders, not a sentence built from
            // fragments: `{month}` carries the month AND the year together
            // because a locale is free to order them the other way round, and
            // the word "renewing" cannot be translated in isolation from what
            // it follows.
            l10n.calendarSubtitle(
              monthYearFmt.format(now),
              currency.fmt(monthTotal),
            ),
            style: AppText.muted.copyWith(fontSize: 12, color: neutral.muted),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: cardDecoration(context),
            child: Column(
              children: <Widget>[
                // Indexed rather than `.map`, because each column now needs BOTH
                // of its forms — the letter it paints and the name it says.
                Row(
                  children: <Widget>[
                    for (int i = 0; i < weekdayHeads.length; i++)
                      Expanded(
                        // `excludeSemantics` so the narrow letter does not ride
                        // along behind the name ("Tuesday T"). Semantics wraps
                        // the `Center`, which lays out exactly as it did — the
                        // annotation is a proxy and takes no space.
                        //
                        // `container: true` because seven label-only
                        // annotations with nothing to conflict over are ABSORBED
                        // into one node — measured: the header row became a
                        // single stop reading "Sunday Monday Tuesday Wednesday
                        // Thursday Friday Saturday". That is one thing to hear
                        // instead of seven things to land on, and it makes the
                        // column under the finger unidentifiable, which is the
                        // defect this whole change is about.
                        child: Semantics(
                          container: true,
                          label: weekdayNames[i],
                          excludeSemantics: true,
                          child: Center(
                            child: Text(
                              weekdayHeads[i],
                              style: AppText.label.copyWith(
                                fontSize: 10,
                                color: neutral.muted,
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
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
                        // The has-renewal wash is the brand accent at 10%, and
                        // it is deliberately NOT a neutral: it reads against
                        // both the white card and the dark
                        // surfaceContainerHighest one, because it is a tint of
                        // the brand rather than a shade of the surface.
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
                            dayFmt.format(DateTime(y, m, day)),
                            style: AppText.fig.copyWith(
                              fontSize: 12,
                              // ✅ `Colors.white` STAYS on the today branch. It
                              // is painted on `AppColors.brandGradient`, not on
                              // the card, so it is an ON-GRADIENT colour: it
                              // must not follow the scheme, because the surface
                              // underneath it does not either. Only the
                              // off-gradient branch is a neutral, and that is
                              // the branch that was invisible in dark.
                              color: today ? Colors.white : neutral.ink,
                            ),
                          ),
                          const SizedBox(height: 2),
                          if (has)
                            Container(
                              width: 4,
                              height: 4,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                // Same on-gradient rule for the dot; the
                                // off-gradient branch is the brand accent,
                                // which is legible on either card.
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
          // ⚠️ `SectionHeader` paints with `AppText.title`, whose baked
          // `AppColors.ink` this file cannot reach — it lives in
          // `features/shared/widgets.dart`, which L1 owns. Named in this
          // increment's report: the heading is still ink-on-dark until the
          // shared widget takes the same branch these call sites now do.
          SectionHeader(l10n.calendarByDate),
          ...inMonth.map(
            (Subscription s) => Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: _dateRow(context, l10n, currency, s, now),
            ),
          ),
          if (inMonth.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l10n.calendarEmpty,
                style: AppText.muted.copyWith(color: neutral.muted),
              ),
            ),
        ],
      ),
    );
  }

  Widget _dateRow(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    Subscription s,
    DateTime now,
  ) {
    // 🔴 `DueInfo.localized`, NOT `DueInfo.of` — the L1 factory. Same
    // thresholds and the same urgency colours (pinned across d = -3..40 in
    // `test/shared_primitives_test.dart`); the label now comes from the arb,
    // which also fixes a SHIPPED English bug: both live branches of `of` read
    // `In $d days`, so a one-day horizon rendered "In 1 days".
    final DueInfo due = DueInfo.localized(l10n, s, now);
    final ({Color ink, Color muted}) neutral = _neutrals(context);
    // ⚠️ THIS ROW IS RowCard's TWIN AND HAS TO BE FIXED SEPARATELY, which is
    // annoying and is the point of saying so. It hand-rolls the same
    // Container/Material/InkWell that `features/shared/widgets.dart`'s [RowCard]
    // is, because it carries a date column and a gradient rule that RowCard has
    // no slot for — so it did NOT inherit the `button:` + `MergeSemantics` fix
    // that landed there, and every renewal row on this screen stayed a bare
    // InkWell: five text fragments (day, month, name, due phrase, price) read as
    // five separate stops, none of them announced as a control.
    //
    // Same two annotations, same reasons — read RowCard's doc for the argument.
    // The convergence of the two shapes belongs to the same closing cleanup that
    // owns the triplicated `_neutrals` helper above.
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: Container(
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
                            // Same reason as the grid numerals — the digits come
                            // from the locale's own symbol table, not from Dart's
                            // default interpolation.
                            DateFormat.d(l10n.localeName).format(s.nextRenewal),
                            style: AppText.fig.copyWith(
                              fontSize: 19,
                              color: neutral.ink,
                            ),
                          ),
                          Text(
                            // ⚠️ `toUpperCase()` reproduces the live table's ALL
                            // CAPS ("AUG"), and it is Unicode-default rather than
                            // locale-aware — Tamil has no case so `ஆக.` is
                            // unchanged, but a Turkish build would upper-case the
                            // dotless i wrongly. Recorded here rather than fixed,
                            // matching the note the workorder keeps on
                            // `settings_screen.dart:684`.
                            DateFormat.MMM(
                              l10n.localeName,
                            ).format(s.nextRenewal).toUpperCase(),
                            style: AppText.label.copyWith(
                              fontSize: 9,
                              color: neutral.muted,
                            ),
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
                              color: neutral.ink,
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
                      style: AppText.fig.copyWith(
                        fontSize: 16,
                        color: neutral.ink,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
