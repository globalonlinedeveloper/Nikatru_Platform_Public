// ─────────────────────────────────────────────────────────────────────────────
// WIDTH · INSIGHTS (`/insights`) — the cap this screen never had, and the
// second column it now grows.
//
// Insights was a bare `ListView(padding: fromLTRB(18, 58, 18, 108))`. It never
// overflowed and never clipped, so no existing assertion could fail — but
// between 1200 and 1599 `AppScaffold` does NOT cap the body (only its
// extra-large class, >=1600, does), and both cards took every pixel the drawer
// left them. A defect with no exception and no red pixel is only visible to a
// MEASUREMENT, which is what this file is.
//
// 🔴 CORRECTED 2026-08-21 — THIS HEADER SAID "a 1550 px savings row" AND THAT
// WIDTH CANNOT OCCUR. `AppScaffold` hands the body `min(W - 361, 1280)` (the
// 360px drawer plus its 1px divider come off first), so 1280 is the ceiling at
// any window width and 1238 is the ceiling inside the LARGE class. The widest
// a savings row has ever been is ~1204 after the page gutters and card
// padding. The defect was real; the number was invented.
//
// 🔴 THE SCREEN NOW HAS TWO SHAPES, SO THIS FILE HAS TWO GROUPS.
// Below `AppBreakpoints.large` (1200) the cards are one column capped at
// `AppBreakpoints.reading` (720) — unchanged, and the first group pins it. At
// 1200 and above the cards go TWO-UP, and the cap moves to the default
// `kMaxBodyWidth` (1280) so that each COLUMN lands at 615 — inside `reading`,
// which is the number that justified 720 in the first place. Capping the
// two-up layout at 720 would give 353px columns, narrower than a phone.
//
// ⚠️ THE 1200 IS A BODY WIDTH, NOT A WINDOW WIDTH, and this harness measures
// the screen WITHOUT `AppScaffold` around it, so here the two coincide. In the
// running app they do not: the chassis takes 361px for the drawer first, so the
// second column appears at a WINDOW width of 1561. `insights_screen.dart`'s
// `_twoUp` carries that arithmetic; this file is deliberately measuring the
// screen's own contract, which is stated in terms of what it was handed.
//
// Everything structural — why the assertion reads `constraints` and not `size`,
// why every case pins the surface — is documented once in
// `support/width_harness.dart`. Read that header rather than restating it here.
//
// 🔴 ITS "1920, NOT 1280" RULE NO LONGER APPLIES TO THIS SCREEN, and the
// reason it existed is worth keeping straight. That rule is about a cap that
// EQUALS the surface being measured: `<= 1280` on a 1280 surface is true with
// the pane deleted. Here 1280 is asserted as an EQUALITY against a screen whose
// other arm produces 720, so deleting the two-column branch turns the 1280 case
// red on its own. The falsifiable-at-every-surface property is stronger than
// before, not weaker — and the column widths below can only be produced by the
// grid, at any surface.
//
// 🔴 WHAT IS PUMPED IS `InsightsScreen`, NOT the router's `_GatedInsights`.
// `router/shell.dart:78` wraps this screen in the chassis `PaywallGate` (unlocked by
// default). Width is a property of the SCREEN; the gate is a property of the
// route, and it is tested where it lives. Pumping the wrapper here would make
// this file go red the day the gate's default flips — a failure that names the
// width cap while meaning something else entirely.
//
// ⚠️ NO OVERRIDES BEYOND THE HARNESS DEFAULTS IN MOST CASES, AND THAT IS
// DELIBERATE. `defaultWidthOverrides()` leaves `subscriptionRepositoryProvider`
// alone, so the unconfigured chain resolves `SeedApiClient`. Seed ids 6/7/10 are
// `unused: true` (`data/seed/demo_data.dart`), which is what makes the savings
// card render its POPULATED branch — the widest content on the page (glyph +
// two-line note + a 48 px gradient button, per row) AND the second card the
// two-column layout needs. The one case that DOES override the repository is
// the last one, and it is there because a repository with nothing unused is
// what every real user has.
// (The button was 36 when this header was written; `insights_screen.dart`
// raised it to 48 against androidTapTargetGuideline and the number here was
// left behind. Corrected 2026-08-21.)
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/data/models/subscription.dart';
import 'package:subly/data/subscriptions/subscription_repository.dart';
import 'package:subly/features/insights/insights_screen.dart';
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart';

/// The two columns of the wide layout, by the keys `insights_screen.dart` puts
/// on them. Named here so a failure says WHICH column was short.
final Finder _leftColumn = find.byKey(const Key('insights.cards.left'));
final Finder _rightColumn = find.byKey(const Key('insights.cards.right'));

/// Just under `AppBreakpoints.large`, so the boundary is `>=` and not `>`.
///
/// One pixel below the breakpoint is the only surface that can tell those two
/// apart, and a screen that went two-up at 1201 instead of 1200 would otherwise
/// look correct everywhere this file measures.
const Size kJustBelowLarge = Size(1199, 900);

/// A repository whose subscriptions are ALL in use.
///
/// 🔴 THIS IS THE SHAPE EVERY REAL USER HAS, not an edge case. `unused` is a
/// field nothing in this app ever writes — the add sheet constructs every draft
/// without it and the API never sends it back — so the savings card's
/// `unused.isNotEmpty` gate is closed in production and insights is a ONE-card
/// page. The seed data used by every other case here is the exception.
class _NothingUnusedRepository implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[
    Subscription(
      id: '1',
      name: 'Netflix',
      category: 'Streaming',
      price: 15.49,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 9, 1),
      glyph: 'NFX',
      usedPct: 78,
    ),
    Subscription(
      id: '2',
      name: 'Spotify',
      category: 'Music',
      price: 11.99,
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 9, 4),
      glyph: 'SPT',
      usedPct: 92,
    ),
  ];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

void main() {
  // ── ONE COLUMN, BELOW `AppBreakpoints.large` ───────────────────────────────
  group('below large, insights is one column capped at reading', () {
    // 375 is the TIGHTEST FIT on this screen, and the exception check is the
    // half that matters. The donut is a fixed 126×126 (`insights_screen.dart`'s
    // `SizedBox`), so the category row's legend gets whatever is left of the
    // card's content box — 375 less the 18/18 page gutters less the card's
    // 20/20 padding, less 126 for the donut and 18 for the gap: about 155 px,
    // shared by a 10 px swatch, a category name and a right-aligned figure.
    // It lays out clean today; `takeException()` is what proves it stays that
    // way when somebody adds a category or lengthens a name.
    testWidgets('at 375 the cap is a no-op and the donut row still fits', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const InsightsScreen());

      // 🔴 FIRST, PROVE THE MEASUREMENT IS NOT VACUOUS. The seed chain resolves
      // asynchronously; if it had not landed within `pumpAt`'s pumps, the screen
      // would fall back to `valueOrNull ?? const []` and render an EMPTY savings
      // card and a segment-less donut — no rows to stretch, and a
      // `takeException()` check with nothing left on the page to overflow.
      // Measured: 3 Cancel buttons (seed ids 6/7/10) and no empty state.
      expect(
        find.text('Cancel'),
        findsWidgets,
        reason:
            'the savings card must be in its POPULATED branch — that is the '
            'widest content on this page and the only reason 375 is a tight fit',
      );
      expect(
        find.text('Nothing flagged — nice.'),
        findsNothing,
        reason:
            'the empty state is the shape whose width nobody cares about; if it '
            'is on screen the two assertions below are measuring nothing',
      );

      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it was '
            'handed, so a phone must render exactly as it did before the pane '
            'existed — the page gutters are inside the ListView, not the pane',
      );
      expect(
        _leftColumn,
        findsNothing,
        reason:
            'a phone is one column, and two columns of 170px would be a bug',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the donut row and the populated savings rows must lay out clean on '
            'the narrowest phone — this is the tight fit the pane must not break',
      );
    });

    // 🔴 NOT A NO-OP. 768 is the first surface in this file where the pane
    // actually takes width away: under the old `kMaxBodyWidth` default this
    // case asserted 768 and was true with the wrapper deleted.
    testWidgets('at 768 the cap binds and there is still one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kTablet, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'a small tablet is already past `reading`, so the pane must hold '
            'the column at 720 rather than hand the surface through',
      );
      expect(_leftColumn, findsNothing);
    });

    // 🔴 THE BOUNDARY. This is the only case that can tell `>= large` from
    // `> large`, and it is also what stops the two-column layout drifting down
    // into the expanded window class, where 1199 less gutters and gap would
    // leave 574 px columns.
    testWidgets('at 1199 — one pixel below large — it is still one column', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kJustBelowLarge, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason: 'the two-column branch must not start until 1200',
      );
      expect(_leftColumn, findsNothing);
      expect(_rightColumn, findsNothing);
      // Pinned so a change to the design system's own number is a red test here
      // rather than a silent re-layout of this screen.
      expect(AppBreakpoints.large, 1200);
      expect(AppBreakpoints.reading, 720);
    });
  });

  // ── TWO COLUMNS, AT `AppBreakpoints.large` AND ABOVE ───────────────────────
  group('at large and above, insights lays its cards out two-up', () {
    // 1280 - 18 - 18 page gutters = 1244 for the Row; less the 14px column gap
    // leaves 1230, split evenly. Written as the arithmetic rather than as a
    // bare 615 so that a change to the gutter or the gap shows up here as a
    // wrong SUM rather than as a mystery constant.
    const double columnAt1280 =
        (AppBreakpoints.kMaxBodyWidth - 18 - 18 - 14) / 2;

    testWidgets('at 1280 the cards are side by side, in reading order', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kDesktop, const InsightsScreen());

      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the two-up arm caps at kMaxBodyWidth, not at reading — this case '
            'goes red if the two-column branch is deleted and 720 comes back',
      );
      expect(
        offeredWidth(tester, _leftColumn),
        columnAt1280,
        reason:
            'each column must land inside `reading`; 615 is the number the '
            'grid produces and nothing else on this screen does',
      );
      expect(offeredWidth(tester, _rightColumn), columnAt1280);

      // 🔴 THE DEAL ORDER IS PART OF THE CONTRACT, not an implementation
      // detail. Cards are dealt alternately so the widget tree is in reading
      // order: the category card is card 0 and goes LEFT, the savings card is
      // card 1 and goes RIGHT. A screen reader walks the tree, so getting this
      // backwards would announce the two cards in an order no sighted user
      // sees — and no width measurement would notice.
      expect(
        find.descendant(of: _rightColumn, matching: find.text('Cancel')),
        findsWidgets,
        reason: 'the savings card is card 1, so it belongs in the RIGHT column',
      );
      expect(
        find.descendant(of: _leftColumn, matching: find.text('Cancel')),
        findsNothing,
        reason: 'the category card is card 0 and has no Cancel buttons in it',
      );
    });

    testWidgets('at 1920 the body is still capped at exactly kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const InsightsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'unconstrained, the savings rows ran the full 1920 px — a glyph at '
            'one edge and a Cancel button at the other, with a third of a '
            'screen of nothing between them',
      );
      expect(offeredWidth(tester, _leftColumn), columnAt1280);
      expect(offeredWidth(tester, _rightColumn), columnAt1280);
      expect(AppBreakpoints.kMaxBodyWidth, 1280);
    });

    // 🔴 THE CASE THAT DESCRIBES PRODUCTION. With nothing flagged there is ONE
    // card, and one card in a two-column grid is a card beside a hole — so the
    // screen stays single-column at any width. Without this case the
    // `cardCount >= 2` half of `_twoUp` could be deleted and every other test
    // in this file would stay green, because the seed data always has three
    // unused rows.
    testWidgets('at 1920 with nothing unused it stays one column at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(
        tester,
        kWide,
        const InsightsScreen(),
        overrides: <Override>[
          subscriptionRepositoryProvider.overrideWithValue(
            _NothingUnusedRepository(),
          ),
        ],
      );

      // Not vacuous: the savings card must be ABSENT for the right reason —
      // the gate being closed — and not because the repository never resolved.
      // The category card is the one that proves the data landed.
      expect(
        find.text('By category'),
        findsOneWidget,
        reason:
            'the category card must have rendered, or this is measuring an '
            'unresolved screen rather than a one-card one',
      );
      expect(find.text('Cancel'), findsNothing);

      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.reading,
        reason:
            'one card is not a card stack, so the wide layout must not widen '
            'the pane to 1280 to hold a single 615px column and a hole',
      );
      expect(_leftColumn, findsNothing);
      expect(_rightColumn, findsNothing);
    });
  });
}
