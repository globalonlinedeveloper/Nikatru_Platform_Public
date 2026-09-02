import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
// ⚠️ NARROWED WITH `show` ON PURPOSE. A bare import of the design system makes
// this file's two `core/theme/*` re-export shims redundant (`AppColors`,
// `AppText` come through both), which is an `unnecessary_import` info on each —
// two NEW analyzer issues for a port that is supposed to contribute zero. The
// shims stay as they were; only the symbols this file actually uses come
// straight from the package.
import 'package:intl/date_symbols.dart' show DateSymbols;
import 'package:intl/intl.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show AppSpacing, ContentPane, TwoPane;

import '../../core/format/currency.dart';
import '../../core/theme/app_colors.dart';
import '../../core/theme/app_theme.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';
import '../../state/settings_controller.dart';
import '../../state/subscriptions_controller.dart';
import '../shared/due.dart';
import '../shared/neutrals.dart';
import '../shared/widgets.dart';

/// 📌 THE PRIVATE `_neutrals(BuildContext)` THAT STOOD HERE IS HOISTED
/// (2026-08-25) into `features/shared/neutrals.dart` as `neutrals(context)`,
/// together with the whole doc that recorded why light is the literal token and
/// why dark derives from the seed. The triplication was deliberate for exactly
/// one increment and its own doc said so; this is the closing cleanup it named,
/// landed with the deletion of `DueInfo.of`. Read the argument there.
///
/// ⚠️ THE SHARED HELPER RETURNS THREE FIELDS AND THIS FILE USES TWO. The copy
/// that stood here was `({Color ink, Color muted})` — this screen paints no
/// hairline of its own — while `budget_screen.dart` and `insights_screen.dart`
/// carried `({Color ink, Color muted, Color line})`. The merge unified on the
/// WIDER record rather than adding a narrower second entry point: two spellings
/// of one rule is exactly what the triplication already was, and the copy nobody
/// re-measures is the one that drifts. The two call sites below bind `line` and
/// never read it.

/// The page inset, now shared by BOTH panes.
///
/// PADDING RE-BASED FOR THE CHASSIS SHELL (the landed home precedent,
/// `home_screen.dart` MERGE CHANGE 3). Live was `fromLTRB(18, 58, 18, 108)`;
/// both odd numbers paid for the old shell — 58 cleared a status bar under an
/// app-bar-less `Scaffold`, 108 cleared the floating pill bar plus the FAB.
/// `AppScaffold._compact()` wraps the body in a `SafeArea` and puts navigation
/// in `bottomNavigationBar`, so both insets are now paid twice. 18 is
/// `AppSpacing.gutterCompact`, the chassis's own page gutter.
///
/// ⚠️ A CONST RATHER THAN TWO LITERALS since the two-pane split: the detail
/// column is a second scroll view one divider away from the first, and two page
/// insets that agree today and drift tomorrow would read as a step in the seam
/// between them.
const EdgeInsets _pageInset = EdgeInsets.fromLTRB(
  AppSpacing.gutterCompact,
  AppSpacing.gutterCompact,
  AppSpacing.gutterCompact,
  AppSpacing.xl,
);

/// 🔴 STATEFUL SINCE THE `TwoPane` ADOPTION, AND THE STATE IS EXACTLY ONE INT.
/// The detail column needs a selected day and nothing else: the month, the
/// renewals and the totals are all still derived per build from `DateTime.now()`
/// and the subscriptions provider, unchanged. See
/// [_CalendarScreenState._selectedDay] for why a day-of-month is the whole
/// selection.
class CalendarScreen extends ConsumerStatefulWidget {
  const CalendarScreen({this.clock, super.key});

  /// Injectable ONLY so this screen is reachable from a test at a KNOWN date: a
  /// test process cannot choose what `DateTime.now()` reports, and this screen
  /// renders "the month `DateTime.now()` falls in" against seed data with fixed
  /// dates. That combination rots — `a11y_semantics_test` passed on 2026-08-31
  /// and failed on 2026-09-02 with NO code change, because the demo renewals had
  /// aged out of the rendered month and the contrast sweep lost its subjects
  /// ("Expected: contains 'Notion'"; "Expected: <7> Actual: <2>").
  ///
  /// Same reasoning, and the same shape, as [CatchUpNudgeBanner.clock] and
  /// [UpgradePromoCard.clock] in `home_screen.dart`.
  ///
  /// ⚠️ Production passes nothing and gets `DateTime.now`, so the screen still
  /// "renders identically today and correctly tomorrow" as the note above says.
  /// The alternative fix — making the seed dates relative to now — was rejected:
  /// `demo_data.dart` also feeds `store-screenshots.yml`, so it would silently
  /// change published store assets.
  final DateTime Function()? clock;

  @override
  ConsumerState<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends ConsumerState<CalendarScreen> {
  /// The selected day of THIS month, or null for "the whole month".
  ///
  /// A bare int and not a `DateTime`, because the screen renders exactly one
  /// month — the one `DateTime.now()` falls in — and there is no month
  /// navigation to select out of. Storing a full date would let the two
  /// disagree; a day-of-month cannot.
  ///
  /// 🔴 IT IS NOT TRUSTED ON READ. The month rolls over at midnight and the
  /// subscription list can change under a selection, so `build` re-validates it
  /// against `byDay` every frame rather than trying to keep it correct at write
  /// time. An invalid selection reads as null — the whole month — which is the
  /// state the screen was in before anything was tapped.
  int? _selectedDay;

  @override
  Widget build(BuildContext context) {
    final AppLocalizations l10n = AppLocalizations.of(context);
    final ({Color ink, Color muted, Color line}) neutral = neutrals(context);
    final Currency currency = ref.watch(currencyProvider);
    final List<Subscription> subs =
        ref.watch(subscriptionsControllerProvider).valueOrNull ??
        const <Subscription>[];
    final DateTime Function() clockFn = widget.clock ?? ref.watch(nowProvider);
    final DateTime now = clockFn();
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

    // The selection, re-validated — see [_selectedDay]. `byDay` is the same map
    // the grid paints its dots from, so "is selectable" and "has a dot" are ONE
    // condition read in two places rather than two conditions that agree today.
    final int? selectedDay = byDay.containsKey(_selectedDay)
        ? _selectedDay
        : null;

    // P3 PORT — THE WIDTH DECISION THIS SCREEN NEVER HAD.
    //
    // 🔴 CORRECTED 2026-08-21 — THE DEFAULT CAP NEVER BOUND, SO IT WAS NOT A
    // DECISION. The paragraph that stood here chose the default `ContentPane`
    // (`kMaxBodyWidth`, 1280) and argued the rows "are the same shape as home's,
    // which cap at 1280". Measured against the live shell, that reasoning had no
    // effect: `AppScaffold` hands the body `min(W - 361, 1280)` because a 360 px
    // drawer plus its 1 px divider take the width first, so at a 1440 px window
    // the body is 1079 and at 1920 it is 1280 only on the very widest desktop
    // anybody runs. For every real desktop width between 839 and 1280 the cap
    // was a no-op and this screen was a phone column that had simply been made
    // wider — the defect the pane was added to fix, still shipping.
    //
    // `.reading` (720), and it is the design system's OWN answer for this shape
    // rather than a number picked here. Two measurements decide it:
    //   · THE MONTH GRID. `crossAxisCount: 7` is semantic, so extra width goes
    //     into cell WIDTH while `mainAxisExtent: 44` holds the height fixed. At
    //     720 a cell is (720 - 36 gutter - 32 card padding - 18 spacing) / 7 ≈
    //     91 × 44 — already a 2:1 letterbox around a 12 pt numeral. At 960 it is
    //     ≈ 125 × 44 and at the old 1280 ≈ 171 × 44. The grid does not merely
    //     "gain nothing" from width; every pixel of it makes the card worse.
    //   · THE RENEWAL ROWS. 44 px date column + 3 px rule + name/due + price.
    //     At 720 the price still sits within an eye movement of the name; the
    //     840–960 that suits a denser row list buys this row nothing, because it
    //     carries four fields, not eight.
    //
    // ⚠️ CORRECTED AGAIN BY THE `TwoPane` ADOPTION — ONE SENTENCE OF THE ABOVE
    // HAD BECOME FALSE AND IS REWRITTEN RATHER THAN DELETED. It used to end:
    // "The old note's objection — that two caps on one scroll column would leave
    // the grid card narrower than the rows beneath it — is answered by taking
    // ONE cap for the page, the narrower of the two candidates. One page, one
    // cap, and it is now a cap that binds." That holds for the SINGLE-COLUMN
    // path and only there. At/above `AppBreakpoints.expanded` the rows are no
    // longer BENEATH the grid, so there is no longer one scroll column to hold
    // one cap: the grid and the day's renewals are two columns, and the grid
    // card being narrower than the rows beside it is now the intended shape
    // rather than the defect that sentence was guarding against.
    //
    // 🔴 AND THIS IS WHY `TwoPane` IS THE OUTERMOST WIDGET AND THE PANE IS NOT.
    // `TwoPane` measures the box IT was given, and it splits at
    // `AppBreakpoints.expanded` (840). A `ContentPane.reading` wrapped AROUND it
    // would hand it 720 at every surface — 720 < 840 — so the split could never
    // happen at any window width whatsoever, and the whole two-pane layout would
    // be dead code that compiles, renders and tests green as a single column.
    // The cap therefore moved INSIDE, onto each pane.
    return TwoPane(
      // THE MASTER IS THE WHOLE SCREEN BELOW 840, unchanged. `TwoPane` returns
      // `list` UNWRAPPED in single-column mode, so a phone renders the tree it
      // rendered before this widget existed — which is why the by-date section
      // is dropped from this column ONLY when the split actually happened.
      list: Builder(
        builder: (BuildContext context) {
          // 🔴 `TwoPane.isTwoPaneOf`, NOT `MediaQuery`. This is the decision
          // `TwoPane` published from the width IT was handed; re-deriving it
          // from the window would be a second decision, and at the boundary the
          // two disagree — `AppScaffold` gives the body `min(W - 361, 1280)`, so
          // a 1200 px window is 839 px of body. Deriving from the window would
          // drop the renewals out of this column while the detail column was not
          // being built at all, i.e. lose them from the screen entirely.
          final bool split = TwoPane.isTwoPaneOf(context);
          return ContentPane.reading(
            // ⚠️ KEYED because there are now TWO panes on this screen and
            // `find.byType(ContentPane)` cannot tell them apart — the idiom
            // `test/support/width_harness.dart`'s `inPaneOf` records, and the
            // one `subscription_detail_screen.dart` already follows.
            key: const Key('calendar-grid-pane'),
            child: ListView(
              // 🔴 NO `padding:` ON THE PANE — the same rule the stamped
              // settings screen records. `test/width_calendar_test.dart` asserts
              // the ListView is OFFERED exactly 375 at phone width and exactly
              // `AppBreakpoints.reading` at 768; a pane inset would subtract
              // from both. The gutters stay where they always were: inside the
              // ListView.
              //
              // ⚠️ That sentence used to read "…and exactly
              // `AppBreakpoints.reading` from 768 UPWARD", which the split made
              // false. From 840 up this column is offered `TwoPaneSplit`'s list
              // width — 420 at the boundary, 480 from 1201 on — and the 720 cap
              // never binds again. The test now measures both regimes.
              padding: _pageInset,
              children: <Widget>[
                Text(
                  l10n.calendarTitle,
                  style: AppText.title.copyWith(
                    fontSize: 26,
                    color: neutral.ink,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  // ONE key with two placeholders, not a sentence built from
                  // fragments: `{month}` carries the month AND the year together
                  // because a locale is free to order them the other way round,
                  // and the word "renewing" cannot be translated in isolation
                  // from what it follows.
                  //
                  // It stays on the MASTER and stays a MONTH total even when a
                  // day is selected: it is the caption of the month grid, and
                  // the month grid is what this column is.
                  l10n.calendarSubtitle(
                    monthYearFmt.format(now),
                    currency.fmt(monthTotal),
                  ),
                  style: AppText.muted.copyWith(
                    fontSize: 12,
                    color: neutral.muted,
                  ),
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: cardDecoration(context),
                  child: Column(
                    children: <Widget>[
                      // Indexed rather than `.map`, because each column now
                      // needs BOTH of its forms — the letter it paints and the
                      // name it says.
                      Row(
                        children: <Widget>[
                          for (int i = 0; i < weekdayHeads.length; i++)
                            Expanded(
                              // `excludeSemantics` so the narrow letter does not
                              // ride along behind the name ("Tuesday T").
                              // Semantics wraps the `Center`, which lays out
                              // exactly as it did — the annotation is a proxy
                              // and takes no space.
                              //
                              // `container: true` because seven label-only
                              // annotations with nothing to conflict over are
                              // ABSORBED into one node — measured: the header
                              // row became a single stop reading "Sunday Monday
                              // Tuesday Wednesday Thursday Friday Saturday".
                              // That is one thing to hear instead of seven
                              // things to land on, and it makes the column under
                              // the finger unidentifiable, which is the defect
                              // this whole change is about.
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
                      // 🔴 THE 44 px CELL *DID* CLIP AT LARGE TEXT — BUT NOT
                      // WHERE THE AUDIT SAID, AND NOT FOR THE REASON IT GAVE.
                      // The flag read "`mainAxisExtent: 44` may clip at large
                      // text scale … it will overflow at 1.3". Measured on a 375
                      // phone, the numeral's line box is 12.0 px at 1.0 and 16.0
                      // at 1.3, so the column needs 22 of its 44 and there is 22
                      // px of HEADROOM at 1.3 — the stated threshold is clean,
                      // and a purely vertical argument stays clean until the
                      // numeral box passes 38 px, i.e. past 3.1×.
                      //
                      // The real failure is HORIZONTAL and it starts at ≈1.8×.
                      // A cell on a 375 phone is 41.3 px wide. A TWO-DIGIT day
                      // (10–31, i.e. 22 of the month's cells) at a scaled 12 pt
                      // outgrows that width, WRAPS to two lines, and two lines
                      // plus the 2 px gap and the 4 px dot is 54 px in a 44 px
                      // box. Measured, per scale, at 375: 1.0/1.3/1.5 clean ·
                      // 2.0 → 22 cells overflow by 10.0 px · 3.5 → 31 cells (the
                      // single-digit ones join in). So the flag was right that
                      // the number bites and wrong about both the mechanism and
                      // the threshold — which is the whole reason it was
                      // measured instead of patched.
                      //
                      // ✅ THE FIX IS A CLAMP ON THE CELL'S TEXT SCALE, NOT A
                      // BIGGER BOX, and the clamp is what makes 44 PROVABLE
                      // rather than lucky. At 1.5× the numeral is 18 px, so even
                      // the worst case — a narrow 320 px phone where two digits
                      // still wrap — is 2×18 + 2 + 4 = 42 ≤ 44. There is no
                      // scale factor and no phone width at which this cell can
                      // now overflow, which a larger fixed extent could not have
                      // promised.
                      //
                      // ⚠️ AND IT COSTS THE USER NOTHING, which is the only
                      // reason to clamp anything. This grid is a GLANCEABLE
                      // SUMMARY — a numeral and a 4 px dot — and every fact in
                      // it is repeated in full, unclamped, scaling text in the
                      // by-date list (directly below on a phone, in the column
                      // beside it from 840 up): day, month, name, due phrase,
                      // price. A reader at 200% text loses no information; they
                      // read the list, which is the shape that scales. Clamping
                      // the LIST would be the unacceptable version of this
                      // change.
                      //
                      // 📌 AND THE PRECEDENT IS THE SAME WIDGET IN THE
                      // FRAMEWORK. Material's own `CalendarDatePicker` wraps its
                      // day-picker `GridView` in exactly this call
                      // (`calendar_date_picker.dart:1171`), for exactly this
                      // reason, with `_kDayPickerGridPortraitMaxScaleFactor =
                      // 2.0` and `…LandscapeMaxScaleFactor = 1.5`. 1.5 here is
                      // the framework's tighter number, and deliberately so: its
                      // day cells get a full 48 px box, ours get 44.
                      MediaQuery.withClampedTextScaling(
                        maxScaleFactor: 1.5,
                        child: GridView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          // 🔴 THE SQ-GRID DEFECT, FIXED. Without a
                          // `mainAxisExtent` this delegate inherits
                          // `childAspectRatio: 1.0` — every day cell is a
                          // SQUARE, so its height scales linearly with viewport
                          // width. Measured: ≈41 px per cell at 375 (the
                          // designed look), ≈97 at 768, ≈170 at the 1280 the
                          // pane used to allow — a month card of ~1035 px of
                          // mostly-empty tinted squares around 12 pt numerals
                          // that do not scale. Nothing overflows and nothing
                          // throws; it is visible only to a measurement, which
                          // is what `test/width_calendar_test.dart` now is.
                          //
                          // 44 ≈ the cell's intrinsic content (12 pt numeral + 2
                          // gap + 4 px dot + breathing room) and is within 3 px
                          // of today's phone rendering, so 375 is visually
                          // unchanged while any wider surface collapses the card
                          // to ≈279 px (6×44 + 5×3). `mainAxisExtent` takes
                          // precedence over `childAspectRatio`, so no other
                          // delegate field needs touching.
                          //
                          // `crossAxisCount: 7` STAYS. A week has seven days:
                          // this is the one grid in the app where a
                          // `MaxCrossAxisExtent` delegate would be wrong,
                          // because the column count is semantic rather than
                          // responsive.
                          //
                          // ✅ AND THE CELL'S *WIDTH* IS CAPPED NOW TOO, WITHOUT
                          // A NUMBER BEING INVENTED FOR IT. The height was
                          // untied from the viewport above; the width never was,
                          // and a 900 px-wide grid of 44 px cells is exactly the
                          // letterbox the pane note describes. `TwoPane` caps
                          // the master column at `AppBreakpoints.pane` (480), so
                          // a cell measures (480 − 36 gutter − 32 card padding −
                          // 18 spacing) / 7 ≈ 56.3 × 44 in two-pane mode —
                          // NARROWER than the ≈90.6 the 720 single column gives
                          // it, and within 15 px of the ≈41.3 the design was
                          // drawn at. Widening the window past 1201 moves
                          // neither number: `TwoPane` stops growing there and
                          // splits the leftover between the outer edges.
                          gridDelegate:
                              const SliverGridDelegateWithFixedCrossAxisCount(
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
                            // 🔴 SELECTION EXISTS ONLY IN TWO-PANE MODE. Below
                            // 840 there is no detail column for a selection to
                            // point at, so a selected cell would be a highlight
                            // that changed nothing — and a window shrunk back to
                            // a phone would carry a mark the user could no
                            // longer clear. `split` gates the MARKER as well as
                            // the tap, which is what keeps the single-column
                            // grid identical to the shipped one.
                            final bool selected = split && day == selectedDay;
                            final Widget content = Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: <Widget>[
                                Text(
                                  dayFmt.format(DateTime(y, m, day)),
                                  style: AppText.fig.copyWith(
                                    fontSize: 12,
                                    // ✅ `Colors.white` STAYS on the today
                                    // branch. It is painted on
                                    // `AppColors.brandGradient`, not on the
                                    // card, so it is an ON-GRADIENT colour: it
                                    // must not follow the scheme, because the
                                    // surface underneath it does not either.
                                    // Only the off-gradient branch is a neutral,
                                    // and that is the branch that was invisible
                                    // in dark.
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
                                      color: today
                                          ? Colors.white
                                          : AppColors.accent,
                                    ),
                                  )
                                else
                                  const SizedBox(height: 4),
                              ],
                            );
                            return Container(
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(11),
                                gradient: today
                                    ? AppColors.brandGradient
                                    : null,
                                // The has-renewal wash is the brand accent at
                                // 10%, and it is deliberately NOT a neutral: it
                                // reads against both the white card and the dark
                                // surfaceContainerHighest one, because it is a
                                // tint of the brand rather than a shade of the
                                // surface.
                                color: today
                                    ? null
                                    : (has
                                          ? const Color.fromRGBO(
                                              100,
                                              89,
                                              245,
                                              0.1,
                                            )
                                          : Colors.transparent),
                              ),
                              // 🔴 `foregroundDecoration`, NOT a `border:` ON
                              // THE DECORATION ABOVE, AND THE DIFFERENCE IS THE
                              // 44 px PROOF. `Container` applies its
                              // decoration's padding around its child, so a 1 px
                              // border would inset the numeral by 1 on every
                              // side and leave the clamp's worst case at
                              // 2×18 + 2 + 4 = 42 in a 42 px box — exactly zero
                              // headroom, on the one cell nobody would think to
                              // re-measure. A foreground decoration paints OVER
                              // the child and changes no layout at all, so every
                              // number in the clamp note above still holds for
                              // the selected cell.
                              //
                              // The marker is a rule in the brand accent at
                              // `Border.all`'s default 1 px — the same weight as
                              // the divider `TwoPane` draws between the two
                              // columns — rather than a new fill: the two fills
                              // this cell can already carry (today's gradient,
                              // the 10% has-renewal wash) both stay visible
                              // underneath it, so "today", "has renewals" and
                              // "selected" stay three readable facts instead of
                              // three colours competing for one background.
                              foregroundDecoration: selected
                                  ? BoxDecoration(
                                      borderRadius: BorderRadius.circular(11),
                                      border: Border.all(
                                        color: AppColors.accent,
                                      ),
                                    )
                                  : null,
                              // 🔴 ONLY DAYS THAT HAVE RENEWALS ARE TAPPABLE,
                              // and that is what keeps `l10n.calendarEmpty` ("No
                              // renewals this month.") true in every state this
                              // screen can reach. An empty day is selectable in
                              // principle, but its detail column would then need
                              // a "nothing renews on this day" sentence and
                              // there is no arb key for one — inventing the
                              // English here would ship an untranslated string
                              // into the `ta` build. The dot already tells the
                              // user which days are worth a tap, so the
                              // affordance and the existing visual agree.
                              child: (split && has)
                                  ? MergeSemantics(
                                      // Same pair as `_dateRow` below and for
                                      // the same reason: without them the
                                      // numeral is a bare text stop that is not
                                      // announced as a control. `selected:` is
                                      // what makes the 1 px marker reach a
                                      // screen reader at all.
                                      child: Semantics(
                                        button: true,
                                        selected: selected,
                                        child: Material(
                                          color: Colors.transparent,
                                          child: InkWell(
                                            borderRadius: BorderRadius.circular(
                                              11,
                                            ),
                                            // Tapping the selected day again
                                            // clears it, and that is the only
                                            // way back to the whole month: a
                                            // dedicated "show all" control would
                                            // need copy this screen has no key
                                            // for, and the toggle is the gesture
                                            // a user tries first anyway.
                                            onTap: () => setState(() {
                                              _selectedDay = selected
                                                  ? null
                                                  : day;
                                            }),
                                            child: content,
                                          ),
                                        ),
                                      ),
                                    )
                                  : content,
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                // BELOW 840 THE RENEWALS SIT UNDER THE GRID, exactly as they
                // shipped. Above it they ARE the detail column, so including
                // them here as well would render every row twice.
                if (!split)
                  ..._renewals(
                    context,
                    l10n,
                    currency,
                    neutral,
                    now,
                    l10n.calendarByDate,
                    inMonth,
                  ),
              ],
            ),
          );
        },
      ),
      // THE DETAIL IS NEVER NULL, and that is a decision rather than an
      // accident: with nothing selected it is the WHOLE month — the same list,
      // under the same `calendarByDate` heading, that sat under the grid before
      // the split. So the two-pane screen has no cold-start empty column to
      // explain, and selecting a day NARROWS the detail instead of filling it.
      detail: ContentPane.reading(
        key: const Key('calendar-day-pane'),
        child: ListView(
          padding: _pageInset,
          children: _renewals(
            context,
            l10n,
            currency,
            neutral,
            now,
            selectedDay == null
                ? l10n.calendarByDate
                // The heading for one day is that day, formatted from the same
                // symbol table the month caption and the grid numerals come
                // from. No arb key: a date is not copy — the argument this file
                // already made when it deleted three English tables.
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
      // 🔴 UNREACHABLE BY CONSTRUCTION, and named as such rather than dressed up
      // as an empty state. `TwoPane` requires a placeholder because a detail
      // column with nothing selected is a state most screens WILL show; this one
      // cannot, because `detail` above is never null. A `TwoPanePlaceholder`
      // here would need a sentence ("Select a day…") that has no arb key, so it
      // would either ship English into the `ta` build or reuse a string that
      // says something else. If a later change makes `detail` nullable, this
      // must become a real placeholder AND the key must be added first.
      placeholder: const SizedBox.shrink(),
    );
  }

  /// The "By date" section — heading, rows, and the empty line.
  ///
  /// ONE builder for both panes: below 840 it is the tail of the master column,
  /// above 840 it is the whole detail column. Two copies would be two chances
  /// for the phone's list and the desktop's list to drift into different rows.
  List<Widget> _renewals(
    BuildContext context,
    AppLocalizations l10n,
    Currency currency,
    ({Color ink, Color muted, Color line}) neutral,
    DateTime now,
    String heading,
    List<Subscription> rows,
  ) => <Widget>[
    // ⚠️ `SectionHeader` paints with `AppText.title`, whose baked
    // `AppColors.ink` this file cannot reach — it lives in
    // `features/shared/widgets.dart`, which L1 owns. Named in this increment's
    // report: the heading is still ink-on-dark until the shared widget takes
    // the same branch these call sites now do.
    SectionHeader(heading),
    ...rows.map(
      (Subscription s) => Padding(
        padding: const EdgeInsets.only(bottom: 9),
        child: _dateRow(context, l10n, currency, s, now),
      ),
    ),
    // Reachable only with `heading == l10n.calendarByDate`: a day is selectable
    // only when it HAS renewals, so a per-day list is never empty and this
    // month-scoped sentence can never appear under a day heading. See the
    // itemBuilder's note on why empty days are not tappable.
    if (rows.isEmpty)
      Padding(
        padding: const EdgeInsets.only(top: 8),
        child: Text(
          l10n.calendarEmpty,
          style: AppText.muted.copyWith(color: neutral.muted),
        ),
      ),
  ];

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
    // `brightness:` is what ACTIVATES the light arm of the urgent-branch fork
    // in due.dart. Without it the call takes the dark-safe default and paints
    // AppColors.warn #F59E0B as small bold text on the white card — 2.15:1,
    // against a 4.5 bar. The fork landed before these three call sites did, so
    // a11y_semantics_test.dart carried a named exemption citing this exact line;
    // passing brightness is what expires it.
    final DueInfo due = DueInfo.localized(l10n, s, now,
        brightness: Theme.of(context).brightness);
    final ({Color ink, Color muted, Color line}) neutral = neutrals(context);
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
    // (CORRECTION 2026-08-25: that helper's half of the cleanup LANDED — it is
    // `features/shared/neutrals.dart` now. The RowCard/row convergence named in
    // the sentence above did not, and is still owed.)
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
