// ─────────────────────────────────────────────────────────────────────────────
// HOME · WIDTH — the assertion `home_screen.dart` asked for BY NAME.
//
// That file's `ContentPane` carried the comment `⬜ NOT YET POLICED`: "until it
// lands, this wrapper can be deleted with every test still green". This file is
// what landed, and that comment now reads `✅ POLICED` and points here. The
// block below is the one pre-drafted in
// `Private/plans/prefab-artifacts/p26b-home/width-behaviour.md` §4, with its
// imports adapted to `support/width_harness.dart` (the harness was extracted
// from `responsive_width_test.dart` after that draft was written, so the draft's
// "append to responsive_width_test.dart" is now "a file of its own, on the
// shared rig").
//
// Everything structural — why the assertion is on incoming `BoxConstraints`
// rather than on `getSize`, why every case pins the surface — lives in the
// harness header. Read it before adding a case here.
//
// 🔴 REWRITTEN 2026-08-21: HOME IS NO LONGER ONE COLUMN, SO "THE WIDTH OF HOME"
// IS NO LONGER ONE NUMBER.
//
// The screen now has up to THREE columns, and which of them exist is itself the
// property under test:
//
//   · the LIST column (`Key('home-list-pane')`) — the master, and the whole
//     screen below `AppBreakpoints.expanded` (840);
//   · the DETAIL column — `TwoPane`'s second pane at 840 and above, holding
//     either `SubscriptionDetailScreen` or, with nothing selected, a
//     `TwoPanePlaceholder`;
//   · the ASIDE column (`Key('home-aside')`) — the hero card, lifted out of the
//     list's scroller once the body is wide enough to hold it beside everything
//     else.
//
// ⚠️ SO `inPane(ListView)` IS GONE FROM THIS FILE AND `inPaneOf` REPLACES IT.
// `inPane` resolves `.first`, which on a three-`ListView` screen is "whichever
// the element tree happened to visit first" — right by accident today and wrong
// the day the columns are reordered. The harness added `inPaneOf` for exactly
// this shape; the screen carries the keys it needs.
//
// ── THE ARITHMETIC EVERY CASE BELOW IS CHECKING, IN ONE PLACE ────────────────
// Nothing here is a fresh number. `TwoPaneSplit` (design system) serves the
// detail first up to `reading` (720), floors the list at `form` (420), then caps
// the list at `pane` (480); home takes `form` (420) plus one divider off the top
// for the aside before TwoPane sees anything at all.
//
// | body | aside |  panes | list | detail | what this width proves            |
// |------|-------|--------|------|--------|-----------------------------------|
// |  375 |    —  |    375 |  375 |    —   | the phone is byte-identical       |
// |  768 |    —  |    768 |  720 |    —   | the reading cap binds, alone      |
// |  839 |    —  |    839 |  720 |    —   | the last single-column width      |
// |  840 |    —  |    840 |  420 |   419  | the first split                   |
// | 1260 |    —  |   1260 |  480 |   720  | the aside is WITHHELD (see below) |
// | 1280 |   420 |    859 |  420 |   438  | three columns                     |
// | 1500 |   420 |   1079 |  420 |   658  | three columns, nothing above us   |
// | 1920 |   420 |   1499 |  480 |   720  | three columns, both caps binding  |
//
// 🔴 1260 IS THE CASE THAT COST THE MOST TO GET RIGHT, AND IT IS THE ONE A
// "TIDY-UP" WILL DELETE. The screen's aside opens at `AppBreakpoints.large`
// (1200) **and** only while the remainder can still split — `form + 1 + expanded
// = 1261`. Without that second clause a body of 1200 leaves the panes 779, below
// 840, so a user at 1199 with a subscription open who drags their window ONE
// PIXEL WIDER watches the detail pane disappear and the hero take its place.
// Removing the clause turns this case red with the aside present and the detail
// column gone; nothing else in the suite can see it.
//
// 🔴 THE CAP AT `AppBreakpoints.reading` (720) STILL EXISTS AND ITS FALSIFIABLE
// BAND MOVED. It used to be policed at 768 · 1280 · 1920 · 1500. It is now
// policed at 768 and 839 ALONE, because from 840 up the list column is 420 or
// 480 wide and a 720 cap does not bind there at all — widening it back to
// `kMaxBodyWidth` is INVISIBLE to every case above 839. The wide cases still
// falsify the PANE (they resolve the `ListView` through it, so deleting it fails
// them on `inPaneOf`'s named guard) and they falsify the SPLIT; they no longer
// falsify the cap, and pretending otherwise is the "assertion that cannot fail"
// this repo treats as worse than none.
//
// ── THE DATED RECORD BELOW IS LEFT UNRENUMBERED ─────────────────────────────
// (⚠️ measured 2026-08-09 and 2026-08-11, when home was one column capped at
// 1280 and then at 720. The mutations and their reds are what happened; editing
// the widths to match today's three-column screen would falsify a record rather
// than repair it. Read it as history — the case list it names is the OLD one.)
// §4 says the 1920 case "alone would pass with the pane deleted", because
// `AppScaffold` applies its own 1280 cap in the extra-large class. That was true
// of the STAMPED home, which owned an `AppScaffold`. Variant B ([ADR 037],
// P2.6a) moved scaffold ownership to `AppShell`: `HomeScreen` is branch 0's BODY
// and carries no scaffold at all, so pumped on this harness there is no shell
// cap behind the pane and BOTH the 1920 and the 1500 case are falsifiable.
// Measured against the real tree, 2026-08-09, two mutations, `flutter analyze`
// clean (29 issues, the baseline) under each so neither red is a compile error
// wearing a caught mutation's clothes:
//
//   · cap widened (`ContentPane(maxWidth: double.infinity)`, pane still present)
//     → 1920 fails `Expected <1280.0> Actual <1920.0>`, 1500 fails
//       `<1500.0> is not <= <1280.0>`, and 375 stays GREEN — which is correct,
//       375 is the no-op case and is not supposed to be able to fail;
//   · pane deleted outright → all FIVE fail on the harness's `inPane` guard
//     with its named reason ("this screen has no ContentPane at all…"), which
//     is the whole-pane regression, not the mis-set-cap one.
//
// The 1500 case is kept and still named as THE durable one, for the reason it
// always was: at 1500 nothing above this screen ever caps anything, at any point
// in any tree it may be mounted in. What it pins is now the three-column split
// rather than the reading cap.
//
// ⚠️ `pumpAt` PINS LAYOUT CONSTRAINTS, NOT `MediaQuery` — see its doc. Every
// assertion in this file is constraint-derived (`offeredWidth`) and
// `home_screen.dart` reads `MediaQuery` nowhere — it takes its own second-column
// decision from `LayoutBuilder`, and `TwoPane` takes the split from another, for
// exactly this reason. Anything added below that asserts on a
// `MediaQuery`-derived number must pin `tester.view.physicalSize` and
// `devicePixelRatio` as well, with their own teardown — otherwise it measures
// the untouched 800×600 test view at every surface above.
//
// ⚠️ THERE IS NOW EXACTLY ONE TAP CASE, AND THE PARAGRAPH THAT FORBADE THEM IS
// CORRECTED RATHER THAN DELETED, BECAUSE ITS REASON IS STILL TRUE.
// It read: "NO TAP CASES IN THIS FILE … `pumpAt` builds a bare `MaterialApp`
// with no router, and this screen's callbacks call `context.go('/settings')`,
// `context.push('/notifications')`, `context.push('/sub/<id>')` and
// `context.go('/insights')`. Building is safe — go_router is only touched on
// tap — but a tap here would throw 'no GoRouter found in context', which reads
// like a layout failure and is not one."
//
// All of that still holds for every control on the screen EXCEPT a subscription
// row at or above 840, and that one exception is the entire point of the
// increment: in two-pane mode the row's `onTap` calls `setState` and touches no
// router at all. So the tap case below is not an exemption from the rule — it is
// the rule's own falsifier. If the screen ever regresses to pushing at that
// width, the test does not fail on a layout assertion, it fails with "no
// GoRouter found in context", which is the correct and specific red. Navigation
// on a PHONE still belongs in the smoke/router legs, which have a real router.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/features/shared/widgets.dart';

import 'support/width_harness.dart';

/// The list column's `ContentPane`. Keyed on the screen so a second (or third)
/// pane on the same surface cannot silently become the thing being measured.
final Finder kListPane = find.byKey(const Key('home-list-pane'));

/// The hero's own column, present only once the body can hold three.
final Finder kAside = find.byKey(const Key('home-aside'));

/// What is standing in the detail column with nothing selected. Its incoming
/// constraints ARE the detail column's width, so it doubles as the measurement
/// point for the second pane.
final Finder kPlaceholder = find.byType(TwoPanePlaceholder);

void main() {
  // ── HOME · ONE COLUMN, below AppBreakpoints.expanded (840) ─────────────────
  //
  // Home was NOT in `responsive_width_test.dart`'s original three because before
  // the P2.6b merge it was the chassis placeholder — a centred Column that
  // shrink-wraps, i.e. exactly the case the harness header says `getSize` cannot
  // measure. After the merge it is the widest content in the app: a hero card
  // and a list of `RowCard`s, each of which fills whatever it is offered.
  group('below the split home is exactly the screen it always was', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const HomeScreen());
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed. The 18px gutters are the ListView\'s OWN padding, '
            'inside the pane, so they do not come off this number',
      );
      // 🔴 THE HALF OF THE PHONE CASE THAT IS NEW, AND THE ONE THE TASK ASKED
      // FOR BY NAME. A phone must not merely be the right WIDTH, it must be the
      // right SHAPE: one column, the hero inside the scroller, and no second
      // pane built at all. `TwoPane` does not build its `detail` below 840, so
      // a selected id costs nothing here — and there is nothing to select from,
      // because the row's tap still pushes `/sub/:id`.
      expect(
        kAside,
        findsNothing,
        reason:
            'the hero belongs INSIDE the list\'s scroller on a phone; a second '
            'column at 375 would be 420px of layout in a 375px box',
      );
      expect(
        kPlaceholder,
        findsNothing,
        reason: 'there is no detail column to be empty in a single column',
      );
      expect(
        find.byType(SubscriptionDetailScreen),
        findsNothing,
        reason:
            'TwoPane must not BUILD the detail below the split even when an id '
            'is held — building it off-screen runs its initState and its '
            'fetches for a pane nobody can see',
      );
      // The hero card's two `_statBox`es are a `Row` of `Expanded`s, the pills
      // are a `Wrap`, and every `RowCard` puts a glyph, two lines of copy and a
      // price on one line. 375 is where any of them would first complain.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the hero card, the stat row and every RowCard must lay out clean '
            'on the narrowest phone',
      );
    });

    // 🔴 WAS 'at 768 the cap is still a no-op', asserting 768. FALSIFIABLE
    // SINCE THE CAP CAME DOWN TO 720: a tablet is the FIRST surface where this
    // screen stops being a phone column that just gets wider, and 48 px is a
    // small enough margin that an off-by-one cap (say `pane`, 480, or a
    // re-widened `kMaxBodyWidth`) is caught here rather than only at 1920.
    testWidgets('at 768 the cap engages — this is the first width it binds at', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const HomeScreen());
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.reading,
        reason:
            '768 is 48px above the reading cap, so a tablet is where the pane '
            'first does anything at all. Restoring the kMaxBodyWidth default '
            'renders 768 here and turns this red',
      );
      expect(kPlaceholder, findsNothing);
      expect(kAside, findsNothing);
    });

    // 🔴 THE LAST SINGLE-COLUMN WIDTH, AND ONE OF THE TWO CASES THAT CAN STILL
    // FALSIFY THE READING CAP. It is one pixel from a completely different
    // screen, which is where an off-by-one in a master-detail layout lives.
    testWidgets('at 839 there is still exactly one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(839, 1200), const HomeScreen());
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.reading,
        reason:
            '839 is above the 720 cap and below the 840 split, so the list is '
            'still a capped single column — the widest this screen ever gets '
            'before it grows a second pane',
      );
      expect(
        kPlaceholder,
        findsNothing,
        reason:
            'one pixel below AppBreakpoints.expanded there is no second pane; '
            'a split here would mean TwoPane measured the window instead of '
            'the box it was given',
      );
    });
  });

  // ── HOME · TWO COLUMNS, from AppBreakpoints.expanded (840) ─────────────────
  group('at the split the list keeps its place and the detail arrives', () {
    testWidgets('at 840 the panes tile exactly: 420 + 1 + 419', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(840, 1200), const HomeScreen());
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.form,
        reason:
            'the list is floored at form (420) and the detail takes the rest, '
            'so the very first split hands the list its floor exactly',
      );
      expect(
        offeredWidth(tester, kPlaceholder),
        419,
        reason:
            '840 − 420 (list floor) − 1 (divider) = 419. A hard number, not a '
            'lessThanOrEqualTo: the boundary is the one width where the '
            'detail is NOT at its reading cap, so an arithmetic slip here is '
            'invisible everywhere else',
      );
      expect(
        kAside,
        findsNothing,
        reason:
            'the hero stays in the list\'s scroller until AppBreakpoints.large '
            'AND enough width to keep the split — neither holds at 840',
      );
    });

    // 🔴 THE FEASIBILITY CASE. See the file header: this is the width band where
    // the two requirements conflict, and the detail pane wins it.
    testWidgets('at 1260 the aside is withheld so the detail survives', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(1260, 1000), const HomeScreen());
      expect(
        kAside,
        findsNothing,
        reason:
            '1260 is past AppBreakpoints.large, so the screen WANTS an aside — '
            'and taking one would leave the panes 1260 − 420 − 1 = 839, one '
            'pixel under the split. Opening it here deletes the detail pane, '
            'i.e. a wider window with LESS on it',
      );
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.pane,
        reason:
            'with no aside taking width, the list is at its own cap (480) and '
            'the detail is at reading (720)',
      );
      expect(offeredWidth(tester, kPlaceholder), AppBreakpoints.reading);
    });
  });

  // ── HOME · THREE COLUMNS, from form + divider + expanded (1261) ────────────
  group('the hero moves beside the list once all three fit', () {
    testWidgets('at 1280 the hero has its own column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const HomeScreen());
      expect(
        offeredWidth(tester, kAside),
        AppBreakpoints.form,
        reason:
            'the aside is one card wide — AppBreakpoints.form (420), the same '
            'floor TwoPane gives its own list column, so a three-column home '
            'repeats one width instead of inventing a second',
      );
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.form,
        reason:
            '1280 − 420 − 1 = 859 for the panes; the detail takes 859 − 421 = '
            '438 and the list is left at its 420 floor',
      );
      expect(offeredWidth(tester, kPlaceholder), 438);
      // The hero is in ONE column, not both. Two hero cards quoting the same
      // monthly total is the regression a naive `if (aside) …` in the wrong
      // place produces, and it is invisible to a width assertion.
      expect(
        find.descendant(of: kListPane, matching: find.byType(Pill)),
        findsNothing,
        reason:
            'the hero\'s two Pills are the cheapest proof it is NOT in the '
            'list column any more — nothing else on this screen renders one',
      );
      expect(
        find.descendant(of: kAside, matching: find.byType(Pill)),
        findsWidgets,
        reason: 'and they are in the aside instead, not simply gone',
      );
    });

    // 🔴 AND THE ONE THE OTHER `kMaxBodyWidth` SCREENS DO NOT NEED. `AppScaffold`
    // caps the body only in its EXTRA-LARGE class (>= 1600); in LARGE (1200–1599)
    // it caps nothing. So on an ordinary maximised 1440p window this screen's own
    // layout is the ONLY thing standing between a RowCard and the full width —
    // and it stays the only thing however this screen is re-parented, which is
    // what makes this case the durable assertion and 1920 the one that depends
    // on who is above it.
    testWidgets('at 1500 the shell caps nothing, so the screen must', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(1500, 1000), const HomeScreen());
      expect(
        offeredWidth(tester, kAside),
        AppBreakpoints.form,
        reason:
            '1500 sits in AppScaffold\'s LARGE class, which applies no body cap '
            'at all — so a green here is this screen\'s doing and nobody '
            'else\'s',
      );
      expect(offeredWidth(tester, inPaneOf(kListPane, ListView)), 420);
      expect(
        offeredWidth(tester, kPlaceholder),
        658,
        reason:
            '1500 − 421 = 1079 for the panes, and 1079 − 421 = 658 for the '
            'detail — still under the reading cap, so this width is where the '
            'detail is growing and the list is not',
      );
    });

    testWidgets('at 1920 every cap is the binding one', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const HomeScreen());
      expect(offeredWidth(tester, kAside), AppBreakpoints.form);
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.pane,
        reason:
            'an ultra-wide window is where an uncapped dashboard is at its '
            'worst: one hero card 1920px across, and RowCards with the glyph '
            'at one edge and the price at the other. Here the list is at '
            'pane (480), the detail at reading (720), and the 779px of '
            'leftover is split between the outer edges rather than donated to '
            'one of them',
      );
      expect(offeredWidth(tester, kPlaceholder), AppBreakpoints.reading);

      // Every number this file asserts is one of these, and they are pinned
      // together so a future edit that quietly re-points a column at a
      // different constant fails naming the constant rather than the pixel.
      expect(AppBreakpoints.form, 420);
      expect(AppBreakpoints.pane, 480);
      expect(AppBreakpoints.reading, 720);
      expect(AppBreakpoints.expanded, 840);
      expect(AppBreakpoints.large, 1200);
      expect(AppBreakpoints.kMaxBodyWidth, 1280);
      expect(TwoPaneSplit.dividerWidth, 1);
    });
  });

  // ── THE BEHAVIOUR THE WIDTHS EXIST FOR ────────────────────────────────────
  group('a row selects instead of navigating once the detail is beside it', () {
    testWidgets('at 840 tapping a row fills the second pane and keeps the list', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(840, 1200), const HomeScreen());
      expect(
        kPlaceholder,
        findsOneWidget,
        reason: 'nothing is selected on a cold start, at any width',
      );

      // A `GlyphTile` is the leading mark of a subscription row and of nothing
      // else on this screen — the unused-plans card leads with a bare '!'
      // Container — so this cannot accidentally tap the one control here whose
      // callback DOES need a router (`context.go('/insights')`).
      await tester.tap(
        find.descendant(of: kListPane, matching: find.byType(GlyphTile)).first,
      );
      await tester.pump();

      expect(
        tester.takeException(),
        isNull,
        reason:
            'THE POINT OF THIS CASE. `pumpAt` builds no router, so a regression '
            'to `context.push(\'/sub/<id>\')` at this width fails right here '
            'with "no GoRouter found in context" — a red that names the cause '
            'instead of a layout number that happens to differ',
      );
      expect(
        find.byType(SubscriptionDetailScreen),
        findsOneWidget,
        reason: 'the detail is now rendered IN the second pane',
      );
      expect(
        kPlaceholder,
        findsNothing,
        reason: 'and it replaced the placeholder rather than stacking under it',
      );
      expect(
        kListPane,
        findsOneWidget,
        reason:
            'the list is STILL THERE — not covered, not thrown away. That is '
            'the whole loss TwoPane exists to stop: a full-screen push takes '
            'the user\'s place, their scroll position and the comparison they '
            'were making',
      );
      expect(
        offeredWidth(tester, inPaneOf(kListPane, ListView)),
        AppBreakpoints.form,
        reason: 'and it did not move or resize when the detail arrived',
      );
    });

    testWidgets('below the split the same row still pushes a route', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const HomeScreen());
      await tester.tap(
        find.descendant(of: kListPane, matching: find.byType(GlyphTile)).first,
      );
      await tester.pump();

      // 🔴 THE EXCEPTION IS THE ASSERTION, and it is the only shape available
      // here: `pumpAt` deliberately builds no router (see the harness), so
      // "this tap reached go_router" and "this tap threw" are the same event.
      // A screen that had quietly started selecting instead of pushing at 375
      // would throw NOTHING and this case would go red on the isNotNull.
      expect(
        tester.takeException(),
        isNotNull,
        reason:
            'on a phone the tap must still call context.push(\'/sub/<id>\'), '
            'which on this routerless harness throws — the same behaviour the '
            'screen shipped with, proven by the same means',
      );
      expect(
        find.byType(SubscriptionDetailScreen),
        findsNothing,
        reason:
            'and nothing was rendered inline: there is no second pane at 375 '
            'to render it into',
      );
    });
  });
}
