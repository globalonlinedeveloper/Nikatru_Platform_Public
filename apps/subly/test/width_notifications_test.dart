// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATIONS · WIDTH — the measurement the `ContentPane` in
// `notifications_screen.dart` exists to satisfy.
//
// Everything structural lives in `support/width_harness.dart`: why the assertion
// is on incoming `BoxConstraints` rather than on `getSize` (a shrink-wrapping
// child makes a size assertion un-failable), why every case pins the surface,
// and why 1920 — not 1280 — is the desktop case for a `kMaxBodyWidth` screen.
// Read that header before adding a case here.
//
// 🔴 WHAT THIS SCREEN ADDS OVER ITS SIBLINGS: IT IS A PUSHED FULL-SCREEN ROUTE,
// so it never had a width decision from ANY direction. The list screens at least
// sat inside `AppScaffold`, which caps the body in its extra-large class (>=1600);
// this one is pushed OVER the shell on its own `Scaffold`, so at every width
// above the phone it was the raw window: the title at one edge and the close
// button ~1850 px away at the other, and every card a full-width band with a
// 40 px glyph at the left and two short lines of text stranded beside it.
//
// ⚠️ AND WHY THE LIST IS ALWAYS THERE TO MEASURE. The screen has an empty state
// (`notifNothingDue`), and an empty state has no `ListView` — `inPane(ListView)`
// would then fail on the harness's `findsWidgets` guard with a reason that names
// the wrong cause. It cannot happen with the seed data the harness deliberately
// leaves un-faked: three of the twelve demo subscriptions carry `unused: true`,
// and the flagged-unused row is built from `flaggedUnused.isNotEmpty` alone —
// no date arithmetic. So the second `_Notif` exists on every wall clock, which
// is what keeps these four cases date-independent. (The FIRST notification —
// the due-soon rows — genuinely does depend on today's date. Nothing here
// asserts on it.)
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/notifications/notifications_screen.dart';

import 'support/width_harness.dart';

void main() {
  // ── NOTIFICATIONS · ContentPane (kMaxBodyWidth, 1280) ───────────────────────
  group('notifications is capped at the body width', () {
    testWidgets('at 375 the cap is a no-op and nothing overflows', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kPhone, const NotificationsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        375,
        reason:
            'below the cap a ConstrainedBox may only tighten within what it '
            'was handed, so a phone must render exactly as it did before the '
            'pane existed',
      );
      // The header row is a `spaceBetween` Row holding a 22pt title and a fixed
      // 48px button, and each card is a Row with a fixed 40px glyph beside an
      // Expanded column of two wrapping sentences. The narrowest phone is where
      // either would first complain — and the Tamil strings are longer than the
      // English ones this renders, so the margin is real rather than notional.
      expect(
        tester.takeException(),
        isNull,
        reason:
            'the header row and the notification cards must lay out clean on '
            'the narrowest phone',
      );
    });

    testWidgets('at 768 the cap is still a no-op', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, const NotificationsScreen());
      expect(offeredWidth(tester, inPane(ListView)), 768);
    });

    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, const NotificationsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth),
      );
    });

    // 🔴 THE CASE THAT CAN ACTUALLY GO RED — see the harness header. At 1280 the
    // assertion above holds with the pane deleted; this one does not.
    testWidgets('at 1920 the list stops at AppBreakpoints.kMaxBodyWidth', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const NotificationsScreen());
      expect(
        offeredWidth(tester, inPane(ListView)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'without the pane every notification card stretches the full '
            'display: a 40px icon at one edge and a sentence that stops a '
            'third of the way across, with 1600px of nothing after it',
      );
    });

    // The pane wraps the WHOLE column, not just the list — so the header is
    // capped too. Capping only the scroller would centre the cards under a
    // title and a close button still pinned to the window edges, which reads as
    // a bug rather than as a layout.
    testWidgets('at 1920 the HEADER is capped with the list, not left behind', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, const NotificationsScreen());
      expect(
        offeredWidth(tester, inPane(Column)),
        AppBreakpoints.kMaxBodyWidth,
        reason:
            'the pane must contain the header row and the divider as well as '
            'the list; moving it inside the Expanded would pass every '
            'assertion above and still strand the title at the window edge',
      );
    });
  });
}
