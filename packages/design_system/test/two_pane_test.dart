import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// ⚠️ EVERY WIDGET TEST HERE PINS THE SURFACE. `flutter_test`'s default surface
/// is 800×600, which is BELOW `AppBreakpoints.expanded` — so an unpinned test of
/// this widget is a test of the single-column branch no matter what it claims to
/// be checking, and "the detail pane is absent" would pass for the wrong reason
/// in every single case. Restored with `addTearDown` so a surface left set
/// cannot leak into the next test.
///
/// 🔴 AND EVERY ASSERTION IS MADE ON THE REAL BOXES — the keyed children —
/// never on a `Center`ed descendant. That is the lesson `app_scaffold_test.dart`
/// paid for on 2026-08-21: it measured a `Center(child: Text('BODY'))`, so the
/// text sat in the middle of its column under BOTH the correct layout and the
/// broken one, and the suite stayed green while every app rendered off-centre.
/// A width or a position asserted on a self-centring child is an assertion that
/// cannot fail, which this repo calls worse than none.
void main() {
  const Key kList = Key('two-pane-list');
  const Key kDetail = Key('two-pane-detail');
  const Key kPlaceholder = Key('two-pane-placeholder');

  /// Children that WANT to be infinitely wide, so whatever width they end up
  /// with is the split doing its job. A shrink-wrapping child would measure its
  /// own content and tell us nothing about the layout.
  Widget greedy(Key key) =>
      SizedBox(key: key, width: double.infinity, height: 40);

  Future<void> pumpAt(
    WidgetTester tester,
    Size size, {
    Widget? detail,
    Widget? list,
    Widget? placeholder,
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TwoPane(
            list: list ?? greedy(kList),
            detail: detail,
            placeholder: placeholder ?? greedy(kPlaceholder),
          ),
        ),
      ),
    );
  }

  double widthOf(WidgetTester tester, Key key) =>
      tester.getSize(find.byKey(key)).width;

  double leftOf(WidgetTester tester, Key key) =>
      tester.getTopLeft(find.byKey(key)).dx;

  double rightOf(WidgetTester tester, Key key) =>
      tester.getTopRight(find.byKey(key)).dx;

  // ── SINGLE COLUMN BELOW 840 — the phone must be untouched ──────────────────
  //
  // This is the half that already ships. If any of these go red, a phone user
  // has been handed a desktop layout in a 400 px window, which is a worse
  // regression than the desktop bug this widget exists to fix.
  group('below AppBreakpoints.expanded → single column', () {
    testWidgets('375 renders the list and NOTHING else',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(375, 812), detail: greedy(kDetail));
      expect(find.byKey(kList), findsOneWidget);
      expect(find.byKey(kDetail), findsNothing);
      expect(find.byKey(kPlaceholder), findsNothing,
          reason: 'there is no detail COLUMN here, so there is nothing for a '
              'placeholder to fill');
      expect(find.byType(VerticalDivider), findsNothing);
    });

    testWidgets('the list gets the WHOLE width, not a capped column',
        (WidgetTester tester) async {
      // Measured on the greedy box itself: a cap that silently applied on a
      // phone would show up here as 420 instead of 375.
      await pumpAt(tester, const Size(375, 812));
      expect(widthOf(tester, kList), 375);
      expect(leftOf(tester, kList), 0);
    });

    testWidgets('839 — one pixel below the boundary — is still single column',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(839, 900), detail: greedy(kDetail));
      expect(find.byKey(kDetail), findsNothing);
      expect(widthOf(tester, kList), 839);
    });

    testWidgets('a non-null detail is NOT BUILT below the boundary',
        (WidgetTester tester) async {
      // 🔴 Stronger than `findsNothing`, deliberately. An `Offstage` or
      // `Visibility` wrapper would satisfy `findsNothing` (finders skip offstage
      // subtrees by default) while still running the detail's build, its
      // initState, its fetches and its analytics — off-screen, on a phone, for
      // every item the user never opened. Counting builds is the only assertion
      // that can tell the two apart.
      int detailBuilds = 0;
      await pumpAt(
        tester,
        const Size(600, 900),
        detail: Builder(builder: (BuildContext context) {
          detailBuilds++;
          return greedy(kDetail);
        }),
      );
      expect(detailBuilds, 0);
    });
  });

  // ── THE BOUNDARY, AT 840 EXACTLY ──────────────────────────────────────────
  //
  // 840 is the width where a two-pane layout is tightest and therefore the width
  // where "the list keeps a usable width" is a real claim rather than an obvious
  // one. A test at 1400 could not catch a list squeezed to 200 px at the
  // boundary — off-by-a-column lives at the edge, exactly as off-by-40 did for
  // the 600/640 window class.
  group('at 840 exactly', () {
    testWidgets('both columns exist, with a divider between them',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(840, 900), detail: greedy(kDetail));
      expect(find.byKey(kList), findsOneWidget);
      expect(find.byKey(kDetail), findsOneWidget);
      expect(find.byKey(kPlaceholder), findsNothing);
      expect(find.byType(VerticalDivider), findsOneWidget);
    });

    testWidgets('the list keeps AppBreakpoints.form (420) — a usable column',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(840, 900), detail: greedy(kDetail));
      expect(
        widthOf(tester, kList),
        AppBreakpoints.form,
        reason: 'the floor exists so the tightest two-pane width still leaves '
            'the list the single-column width a large phone gives it',
      );
      expect(AppBreakpoints.form, 420);
    });

    testWidgets('the columns tile the width exactly, left to right',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(840, 900), detail: greedy(kDetail));

      // POSITIONS, on the real boxes. Widths alone would pass if both columns
      // were stacked at x = 0.
      expect(leftOf(tester, kList), 0);
      expect(rightOf(tester, kList), AppBreakpoints.form); // 420

      final Finder divider = find.byType(VerticalDivider);
      expect(tester.getSize(divider).width, TwoPaneSplit.dividerWidth);
      expect(tester.getTopLeft(divider).dx, AppBreakpoints.form);

      expect(leftOf(tester, kDetail), 421);
      expect(widthOf(tester, kDetail), 419);
      expect(rightOf(tester, kDetail), 840,
          reason: 'no dead gutter at the tightest width — every pixel is spent');
    });
  });

  // ── ABOVE THE BOUNDARY ────────────────────────────────────────────────────
  group('at and above 840 → two panes', () {
    testWidgets('1280 (the chassis body cap) → list 480, detail 720',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(1280, 900), detail: greedy(kDetail));
      expect(widthOf(tester, kList), AppBreakpoints.pane); // 480
      expect(widthOf(tester, kDetail), AppBreakpoints.reading); // 720
    });

    testWidgets('the detail NEVER exceeds the reading cap, however wide',
        (WidgetTester tester) async {
      // The whole reason the detail is served first and capped: uncapped it
      // would be ~1580 px of paragraph at this surface, which is the unreadable
      // line length `AppBreakpoints.reading` was defined to prevent.
      await pumpAt(tester, const Size(2000, 900), detail: greedy(kDetail));
      expect(widthOf(tester, kDetail), AppBreakpoints.reading);
    });

    testWidgets('leftover width is SPLIT, not donated to one edge',
        (WidgetTester tester) async {
      // 🔴 This is the assertion `app_scaffold_test.dart` was missing when the
      // capped body sat flush left behind 279 px of dead gutter. At 1400 the
      // pair totals 1201, so 199 px are left over and each edge must get 99.5.
      await pumpAt(tester, const Size(1400, 900), detail: greedy(kDetail));
      const double leftover = 1400 - TwoPaneSplit.maxTotalWidth; // 199
      expect(leftOf(tester, kList), closeTo(leftover / 2, 0.01));
      expect(rightOf(tester, kDetail), closeTo(1400 - leftover / 2, 0.01));
    });
  });

  // ── THE EMPTY STATE ───────────────────────────────────────────────────────
  //
  // Not an afterthought: it is what a user sees on every cold start of a
  // two-pane screen, before they have touched anything.
  group('placeholder when detail is null', () {
    testWidgets('fills the detail column at the same width the detail would',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(1280, 900));
      expect(find.byKey(kPlaceholder), findsOneWidget);
      expect(find.byKey(kDetail), findsNothing);
      // Same column, same geometry — asserted on the placeholder's own box, so
      // a placeholder that shrink-wrapped into a corner could not pass.
      expect(widthOf(tester, kPlaceholder), AppBreakpoints.reading);
      expect(leftOf(tester, kPlaceholder),
          leftOf(tester, kList) + AppBreakpoints.pane + 1);
    });

    testWidgets('a non-null detail REPLACES it', (WidgetTester tester) async {
      await pumpAt(tester, const Size(1280, 900), detail: greedy(kDetail));
      expect(find.byKey(kDetail), findsOneWidget);
      expect(find.byKey(kPlaceholder), findsNothing,
          reason: 'two things in one column is not an empty state');
    });

    testWidgets('TwoPanePlaceholder shows the app’s own copy',
        (WidgetTester tester) async {
      await pumpAt(
        tester,
        const Size(1280, 900),
        placeholder: const TwoPanePlaceholder(message: 'Select a subscription'),
      );
      expect(find.text('Select a subscription'), findsOneWidget);
      // The copy is a parameter because this package has no l10n dependency and
      // must not grow one — the same contract `system_screens.dart` keeps.
      expect(find.byIcon(Icons.chevron_left), findsOneWidget);
    });
  });

  // ── THE PUSH-vs-SELECT DECISION, PUBLISHED ────────────────────────────────
  //
  // The screen has to know whether a tap should push a route or set selection.
  // If it re-derives that from `MediaQuery` it is answering from the WINDOW
  // width while this widget answered from the PANE width, and at the boundary
  // the two disagree — a pushed detail route on top of a rendered detail pane.
  // These tests pin that there is exactly one answer and the subtree can read
  // it.
  group('TwoPane.isTwoPaneOf reports the decision that was made', () {
    late bool seen;

    Widget probe() => Builder(builder: (BuildContext context) {
          seen = TwoPane.isTwoPaneOf(context);
          return greedy(kList);
        });

    testWidgets('false below the boundary', (WidgetTester tester) async {
      await pumpAt(tester, const Size(700, 900), list: probe());
      expect(seen, isFalse);
    });

    testWidgets('true at the boundary', (WidgetTester tester) async {
      await pumpAt(tester, const Size(840, 900), list: probe());
      expect(seen, isTrue);
    });

    testWidgets('flips when the pane is resized across the boundary',
        (WidgetTester tester) async {
      // A screen that cached the first answer would keep pushing routes forever
      // on a desktop window the user just widened. The lookup is a dependency,
      // so the probe must rebuild — this is the test that proves it does.
      await pumpAt(tester, const Size(700, 900), list: probe());
      expect(seen, isFalse);
      await tester.binding.setSurfaceSize(const Size(1000, 900));
      await tester.pump();
      expect(seen, isTrue);
    });

    testWidgets('false with no TwoPane ancestor', (WidgetTester tester) async {
      // Not a silent default: a list rendered outside a TwoPane IS single
      // column, and pushing is the correct behaviour there.
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(MaterialApp(home: Scaffold(body: probe())));
      expect(seen, isFalse);
    });
  });

  // ── THE SPLIT ITSELF, WITHOUT PUMPING ─────────────────────────────────────
  //
  // Pure and public for the same reason `windowClassFor` is: the edges can be
  // enumerated directly instead of pumping a widget once per width, and the
  // arithmetic in the class doc's table gets pinned against the code that
  // produces it.
  group('TwoPaneSplit.forWidth', () {
    test('null below 840, a split at and above it', () {
      expect(TwoPaneSplit.forWidth(0), isNull);
      expect(TwoPaneSplit.forWidth(599), isNull);
      expect(TwoPaneSplit.forWidth(839), isNull);
      expect(TwoPaneSplit.forWidth(840), isNotNull);
      expect(TwoPaneSplit.forWidth(841), isNotNull);
    });

    test('the documented table', () {
      // Every row of the table in the class doc. Prose and code drift; this is
      // the only thing that stops them.
      void row(double width, double list, double detail) {
        final TwoPaneSplit? split = TwoPaneSplit.forWidth(width);
        expect(split, isNotNull, reason: 'width $width should split');
        expect(split!.listWidth, list, reason: 'list at $width');
        expect(split.detailWidth, detail, reason: 'detail at $width');
      }

      row(840, 420, 419);
      row(1141, 420, 720);
      row(1280, 480, 720);
      row(1400, 480, 720);
    });

    test('the list is never below its floor and never above its cap', () {
      for (double w = 840; w <= 2400; w += 7) {
        final TwoPaneSplit split = TwoPaneSplit.forWidth(w)!;
        expect(split.listWidth, greaterThanOrEqualTo(AppBreakpoints.form),
            reason: 'list floor at $w');
        expect(split.listWidth, lessThanOrEqualTo(AppBreakpoints.pane),
            reason: 'list cap at $w');
        expect(split.detailWidth, lessThanOrEqualTo(AppBreakpoints.reading),
            reason: 'detail cap at $w');
        expect(
          split.listWidth + TwoPaneSplit.dividerWidth + split.detailWidth,
          lessThanOrEqualTo(w),
          reason: 'the pair must never overflow the space it was given, at $w',
        );
      }
    });

    test('nothing is left over until the caps are both reached', () {
      // Between 840 and 1201 every pixel is spent; only past `maxTotalWidth`
      // does the centring have anything to split. A test that only checked
      // 1400 would not notice a gutter appearing at 900.
      for (double w = 840; w <= TwoPaneSplit.maxTotalWidth; w += 1) {
        final TwoPaneSplit split = TwoPaneSplit.forWidth(w)!;
        expect(
          split.listWidth + TwoPaneSplit.dividerWidth + split.detailWidth,
          w,
          reason: 'dead gutter at $w',
        );
      }
    });

    test('an unbounded width resolves to both caps rather than throwing', () {
      final TwoPaneSplit split = TwoPaneSplit.forWidth(double.infinity)!;
      expect(split.listWidth, AppBreakpoints.pane);
      expect(split.detailWidth, AppBreakpoints.reading);
    });

    test('maxTotalWidth is the three sourced constants, not a fourth number',
        () {
      expect(
        TwoPaneSplit.maxTotalWidth,
        AppBreakpoints.pane + TwoPaneSplit.dividerWidth + AppBreakpoints.reading,
      );
      expect(TwoPaneSplit.maxTotalWidth, 1201);
    });
  });
}
