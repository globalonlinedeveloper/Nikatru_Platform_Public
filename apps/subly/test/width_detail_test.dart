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
//
// 🔴 THE NUMBER CHANGED ON 2026-08-21: BOTH PANES ARE `AppBreakpoints.reading`
// (720), NOT `kMaxBodyWidth` (1280). The old cases below asserted 1280 and were
// UPDATED rather than deleted, because what they were pinning was wrong, not
// pointless. `AppScaffold` hands its body `min(W - 361, 1280)` — a 360 px
// drawer and a 1 px divider take the width first — so at a 1440 px window the
// body is 1079 and a 1280 cap never fires on any real desktop. The screen was
// capped by a number that could not bind; the assertion passed at 1920 only
// because `kWide` is wider than any window the app is used in. The screen's own
// comment carries why 720 and not an 840–960 row-list number.
//
// ⚠️ AND `at 768 the cap is still a no-op` IS NOW A CAP CASE. 720 < 768, so the
// small tablet is the FIRST width at which this screen's cap does something —
// which is the point of moving it, and is why that case is renamed rather than
// left with a title that contradicts its own expectation.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/features/detail/subscription_detail_screen.dart';
import 'package:subly/l10n/app_localizations.dart';

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

    // 🔴 THE SMALLEST WIDTH AT WHICH THE CAP DOES ANYTHING. It read
    // `expect(…, 768)` under the old 1280 cap. 768 is the first surface in the
    // harness's ladder that exceeds 720, so this is now the cheapest case that
    // goes red if the pane is dropped back to the default — cheaper than 1920,
    // and it fails on a window class people actually use.
    testWidgets('at 768 the cap binds', (WidgetTester tester) async {
      await pumpAt(tester, kTablet, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        AppBreakpoints.reading,
        reason:
            'a small tablet already exceeds the card-stack width, so this is '
            'where a reverted cap first shows',
      );
    });

    // ⚠️ `AppScaffold` hands its body `min(W - 361, 1280)`, so the widest body
    // a 1280 px window ever produces is 919 — which is why the OLD version of
    // this case (`lessThanOrEqualTo(kMaxBodyWidth)`) could not fail: 1280 on a
    // 1280 surface is true with the pane deleted. It is an equality now.
    testWidgets('at 1280 the list is at the cap', (WidgetTester tester) async {
      await pumpAt(tester, kDesktop, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        AppBreakpoints.reading,
      );
    });

    testWidgets('at 1920 the list stops at AppBreakpoints.reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, screen);
      expect(
        offeredWidth(tester, inPaneOf(bodyPane(), ListView)),
        AppBreakpoints.reading,
        reason:
            'without the body pane the price/next-charge pair, the usage meter '
            'and every payment row stretch the whole display',
      );
    });
  });

  group('detail header content is capped while the gradient stays full-bleed', () {
    testWidgets('at 1920 the header pane caps its content at reading', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, kWide, screen);

      // The pane's own padded box — the widget that receives the cap directly,
      // exactly as the body `ListView` does. This is the header's counterpart
      // to the body assertion above.
      expect(
        offeredWidth(tester, inPaneOf(headerPane(), Padding)),
        AppBreakpoints.reading,
        reason:
            'the back button, the glyph tile and the title must stop at the '
            'same 720 the body below stops at, or the header spans a display '
            'the body does not',
      );

      // ⚠️ AND THE `Column` INSIDE IT IS THE CAP LESS THE 18/18 INSET, not the
      // cap. `ContentPane` applies `padding` INSIDE `maxWidth` (see its class
      // doc), so the header's content box is 720 - 36 — which is precisely
      // what makes the title's left edge land on the mini-cards' left edge,
      // because the body `ListView` takes its identical 18/18 out of the same
      // 720. Asserting `== reading` here would be asserting the padding had
      // been hoisted OUTSIDE the cap, i.e. the misalignment this port exists to
      // prevent.
      expect(
        offeredWidth(tester, inPaneOf(headerPane(), Column)),
        AppBreakpoints.reading - 36,
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
        AppBreakpoints.reading,
        lessThan(1920),
        reason:
            'if this ever stopped holding the assertion above would pass for '
            'the wrong reason — the surface would no longer be wider than the '
            'cap it is being distinguished from',
      );
    });
  });

  // ═══ PAYMENT HISTORY · textScaler 1.3 ══════════════════════════════════════
  // 🔴 AUDITED BECAUSE IT WAS ONLY SUSPECTED, AND KEPT BECAUSE THE SUSPICION IS
  // CHEAP TO RE-RAISE. The history row is a `spaceBetween` `Row` of a localized
  // date and a formatted amount with no flex on either child — the exact shape
  // that answers a too-long string with a yellow-and-black overflow stripe,
  // and the same shape the usage-meter Row above it already had to fix with a
  // `Flexible` when Tamil arrived.
  //
  // ⚠️ THE HARNESS'S `pumpAt` CANNOT EXPRESS THIS. `setSurfaceSize` moves the
  // incoming constraints and nothing else; the text scale lives in
  // `MediaQuery`, which `pumpAt` never touches. So this group builds its own
  // host — same overrides, same 12 pumps, plus a `builder:` that re-wraps the
  // subtree's `MediaQuery`. Wrapping the SCREEN instead of using `builder:`
  // would leave the `MaterialApp`'s own MediaQuery upstream and the scale would
  // not reach anything the app inserts above `home:`.
  //
  // Both locales, because the date is `DateFormat.yMMMd(localeName)` and Tamil
  // is the longer of the two renderings — an English-only case would pass on a
  // string the shipping app does not always show.
  group('payment history survives a large text scale', () {
    Future<void> pumpScaled(
      WidgetTester tester,
      Size size,
      double scale,
      Locale locale,
    ) async {
      await setSurface(tester, size);
      final ProviderContainer c = ProviderContainer(
        overrides: defaultWidthOverrides(),
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            builder: (BuildContext context, Widget? child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(scale)),
              child: child!,
            ),
            home: screen,
          ),
        ),
      );
      for (int i = 0; i < 12; i++) {
        await tester.pump();
      }
    }

    for (final Locale locale in const <Locale>[Locale('en'), Locale('ta')]) {
      testWidgets(
        '[${locale.languageCode}] at 375 and textScaler 1.3 nothing overflows',
        (WidgetTester tester) async {
          // 375 — the narrowest surface the app ships on, so the history row
          // gets 375 - 36 (ListView gutters) - 28 (row padding) = 311 px for a
          // date and an amount that are both ~30% wider than designed.
          await pumpScaled(tester, kPhone, 1.3, locale);
          expect(
            tester.takeException(),
            isNull,
            reason:
                'a RenderFlex overflow in the history Row is reported as a '
                'FlutterError, not as a red pixel a test would otherwise miss',
          );
        },
      );
    }
  });
}
