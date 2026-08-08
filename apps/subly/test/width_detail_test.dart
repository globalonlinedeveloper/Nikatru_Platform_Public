// ─────────────────────────────────────────────────────────────────────────────
// SUBSCRIPTION DETAIL — the TWO-PANE width property.
//
// This screen is the only Phase-3 port with a SPLIT: the hero `Container` must
// keep painting edge to edge while the header CONTENT inside it is capped at
// the same `kMaxBodyWidth` as the body `ListView` below. That is two assertions
// pulling in opposite directions, and each one is the other's regression:
//
//  * cap the content but not the gradient  → the shipped, intended shape;
//  * cap NEITHER                           → the defect the port fixes: on a
//    1920 px window the back button sits at one edge and nothing lines up;
//  * cap BOTH                              → the defect a well-meaning later
//    edit introduces — a 1280 px gradient block floating on the page
//    background, which reads as a mis-sized image rather than a header.
//
// So the 1920 case below measures THREE things: the body pane, the header pane,
// and the gradient. Only the first two can go red by deleting a pane; the
// gradient assertion exists for the third bullet and is falsified by ADDING a
// cap, which is why no pane-stripping mutation reddens it.
//
// ⚠️ TWO PANES MEANS `find.byType(ContentPane)` IS AMBIGUOUS. `inPane` would
// return whichever pane the element tree happened to be visited first — right
// by accident today, wrong the day the panes are reordered. The screen keys
// both panes and every measurement here goes through `inPaneOf`.
//
// Everything else — why the assertion is on `constraints` and not `size`, why
// every case pins the surface, and why the desktop case that can actually fail
// is 1920 and not 1280 — is in `support/width_harness.dart`'s header.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';

import 'support/width_harness.dart';

void main() {
  /// Netflix — `data/seed/demo_data.dart:10`. The harness deliberately leaves
  /// `subscriptionRepositoryProvider` alone, so the unconfigured chain resolves
  /// `SeedApiClient` and this id is present; the screen therefore renders its
  /// POPULATED branch rather than the not-found `Center`, which is the only
  /// branch that has a width worth measuring.
  const Widget screen = SubscriptionDetailScreen(id: '1');

  Finder headerPane() => find.byKey(const Key('detail-header-pane'));
  Finder bodyPane() => find.byKey(const Key('detail-body-pane'));

  group('detail body is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed — the 18/18 gutters stay INSIDE the ListView',
      );
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the two Expanded mini-cards share 375 less the 18/18 gutters — '
            'the tightest surface on this screen',
      );
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, screen);
      expect(offeredWidth(tester, inPaneOf(bodyPane(), ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — 1280 is the cap itself, so it is
    // true with or without the pane. See the harness header.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the body pane the price/next-charge pair, the usage meter '
            'and every payment row stretch the whole display',
      );
    });
  });

  group('detail header content is capped while the gradient stays full-bleed', () {
    testWidgets('at 1920 the header pane caps its content at kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, screen);

      // The pane's own padded box — the widget that receives the cap directly,
      // exactly as the body `ListView` does. This is the header's counterpart
      // to the body assertion above.
      expect(
        offeredWidth(tester, inPaneOf(headerPane(), Padding)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the back button, the glyph tile and the title must stop at the '
            'same 1280 the body below stops at, or the header spans a display '
            'the body does not',
      );

      // ⚠️ AND THE `Column` INSIDE IT IS THE CAP LESS THE 18/18 INSET, not the
      // cap. `ContentPane` applies `padding` INSIDE `maxWidth` (see its class
      // doc), so the header's content box is 1280 - 36 — which is precisely
      // what makes the title's left edge land on the mini-cards' left edge,
      // because the body `ListView` takes its identical 18/18 out of the same
      // 1280. Asserting `== kMaxBodyWidth` here would be asserting the padding
      // had been hoisted OUTSIDE the cap, i.e. the misalignment this port
      // exists to prevent.
      expect(
        offeredWidth(tester, inPaneOf(headerPane(), Column)),
        AppBreakpoints.kMaxBodyWidth - 36,
        reason:
            'the header inset comes out of the cap, not out of the surface — '
            'the same 18/18 the body ListView applies within the same 1280',
      );
    });

    // 🔴 THE INVERSE REGRESSION. No pane edit can redden this one; it is
    // falsified by somebody CAPPING the gradient — wrapping the Container in a
    // ContentPane, or moving it inside one of the two panes above.
    testWidgets('at 1920 the gradient itself still spans the whole surface', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, screen);
      expect(
        tester.getSize(find.byKey(const Key('detail-hero-gradient'))).width,
        1920,
        reason:
            'the hero paints the full window; capped at 1280 it becomes a '
            'floating block on the page background, which reads as a broken '
            'image rather than a header',
      );
      expect(
        AppBreakpoints.kMaxBodyWidth,
        lessThan(1920),
        reason:
            'if this ever stopped holding the assertion above would pass for '
            'the wrong reason — the surface would no longer be wider than the '
            'cap it is being distinguished from',
      );
    });
  });
}
