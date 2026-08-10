// ─────────────────────────────────────────────────────────────────────────────
// THE ONE SURFACE EVERY USER IS FORCED TO ANSWER, MEASURED AT SIZES DEVICES
// ACTUALLY HAVE — and the file exists because no guard could have demanded it.
//
// 🔴 WHY THIS IS A SEPARATE FILE AND NOT A `width_*_test.dart`.
// `tooling/ci/assert-responsive-coverage.mjs` states its domain in its header:
// (1) widgets a `builder:` in `lib/core/router.dart` returns, and (2) `show*Sheet`
// functions under `lib/features/**`. The consent scrim is NEITHER. It lives in
// `lib/app.dart` and is mounted through `MaterialApp.router`'s own `builder`,
// ABOVE the Navigator — which is the same fact that forced it to be an inline
// scrim instead of a `showDialog` in the first place. So the first thing a user
// meets, and the only surface they cannot skip, sat outside the one guard whose
// doctrine is "an unmeasured pane is an unpoliced one": `apps/subly/test/` has
// width files for home, detail, login, paywall, scan, budget, calendar, insights,
// notifications, onboarding, the add sheet and the cancel sheet — and had none
// for consent.
//
// Naming this file `width_consent_test.dart` would have been WORSE than nothing:
// that guard's second direction fails any `width_*` file whose subject is not a
// routed screen, so the coverage would have arrived as a red build. The
// structural half of the gap is closed in `assert-consent-withdrawal-surface.mjs`
// limb 4 instead — it fails the build, for every root including the brick, if the
// prompt's scroll view is ever removed. This file is the behavioural half.
//
// WHAT IT PINS, ALL OF IT MEASURED ON THE REAL `SublyApp` WITH THE REAL GATE:
//   1. ANSWERABLE AT THE LARGEST TEXT THE CHASSIS PERMITS. `app.dart` clamps to
//      `maxScaleFactor: 2.0`, so 2.0 is in range BY DESIGN. Before the scroll
//      view landed, 360×640 @2.0 overflowed by 644 px in English and 1180 px in
//      Tamil, and "Allow" was laid out at y 1140→1220 on a 640-tall screen: both
//      answers below the fold, no scroll, and `ColoredBox` hit-test-opaque over
//      everything. A first-run modal nobody can answer bricks the app — and
//      because the recorder is fail-closed, the resulting silence is
//      indistinguishable from a user who said no.
//   2. NOT MODAL FOR A FINGER ONLY. With the prompt up, the app behind it must be
//      gone from the semantics tree. It was not: 15 labelled nodes, the whole
//      onboarding carousel exposed, `Skip` and `Next` still carrying tap actions.
//      Semantic taps do NOT hit-test, so the scrim stopped a finger and stopped
//      nothing for TalkBack or VoiceOver.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subly/app.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/providers.dart';

import 'support/width_harness.dart' show MemStore;

Future<AppLocalizations> _load(String code) =>
    AppLocalizations.delegate.load(Locale(code));

/// Mounts the real app root with the consent question OPEN.
///
/// The three overrides are the same minimum `l10n_screens_test.dart` uses: a
/// memory store (an empty one is what "never answered" means), the compile-time
/// analytics switch forced on, and a transport that cannot reach a network.
Future<void> _pumpAsking(
  WidgetTester tester,
  Locale locale, {
  required Size surface,
  double textScale = 1.0,
}) async {
  await tester.binding.setSurfaceSize(surface);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      analyticsEnabledProvider.overrideWithValue(true),
      consentTransportProvider.overrideWithValue(
        const core.DiscardingConsentTransport(),
      ),
    ],
  );
  addTearDown(c.dispose);
  await c.read(localeProvider.notifier).set(locale);

  await tester.pumpWidget(
    UncontrolledProviderScope(container: c, child: const SublyApp()),
  );
  // Bounded, and the exit condition is the prompt itself — see the same note in
  // `l10n_screens_test.dart`: a fixed frame count is a number nobody owns.
  final AppLocalizations l10n = await _load(locale.languageCode);
  for (int i = 0; i < 60; i++) {
    if (find.text(l10n.consentPrivacy).evaluate().isNotEmpty) break;
    await tester.pump();
  }
}

void main() {
  // ───────────────────────────────────────────────────────────────────────────
  group('the consent question is answerable at every size the chassis allows', () {
    // A small phone and a very small phone, at scale 1.0 and at the clamp
    // ceiling. The @2.0 rows are the regression cases: each of them threw
    // "A RenderFlex overflowed by …" before app.dart grew its scroll view.
    const List<(String, Size, double)> geometries = <(String, Size, double)>[
      ('360x640 @1.0', Size(360, 640), 1.0),
      ('360x640 @2.0', Size(360, 640), 2.0),
      ('320x568 @2.0', Size(320, 568), 2.0),
      ('800x600 default @1.0', Size(800, 600), 1.0),
    ];

    for (final String code in <String>['en', 'ta']) {
      for (final (String label, Size size, double scale) in geometries) {
        testWidgets('[$code] $label — no overflow, and both answers reachable', (
          WidgetTester tester,
        ) async {
          final AppLocalizations l10n = await _load(code);
          await _pumpAsking(
            tester,
            Locale(code),
            surface: size,
            textScale: scale,
          );

          // ⚠️ FIRST, because an overflow is reported as an EXCEPTION and a
          // later `expect` would swallow the diagnosis: flutter_test rethrows a
          // pending exception at the end of the case, so the failure would
          // arrive attached to whichever assertion happened to run last.
          expect(
            tester.takeException(),
            isNull,
            reason:
                '[$code] $label laid the prompt out badly. A RenderFlex '
                'overflow here is not cosmetic: the buttons go below the fold '
                'of a modal that is hit-test-opaque, so the app cannot be used '
                'at all until the question is answered — and it cannot be',
          );

          expect(find.text(l10n.consentPrivacy), findsOneWidget);

          // 🔴 REACHABLE, NOT MERELY PRESENT — AND "REACHABLE" MEANS *AFTER
          // SCROLLING*, WHICH IS THE WHOLE DIFFERENCE THE FIX MAKES. A finder
          // reads the widget tree and matches a button laid out a thousand
          // pixels below the screen exactly as happily as one under the user's
          // thumb; `tap()` on that button derives an offset outside the view and
          // silently hits nothing.
          //
          // So `ensureVisible` FIRST, then measure. On the tall cases the raw
          // rect is off-screen either way — the difference is that a scrollable
          // card can be brought to the user and an overflowing Column cannot:
          // `ensureVisible` finds no `Scrollable` ancestor and throws. This
          // assertion therefore fails, loudly, on exactly the tree this file was
          // written for.
          for (final (String which, Finder f) in <(String, Finder)>[
            ('Allow', find.widgetWithText(FilledButton, l10n.consentAllow)),
            (
              'No thanks',
              find.widgetWithText(OutlinedButton, l10n.consentDecline),
            ),
          ]) {
            await tester.ensureVisible(f);
            await tester.pump();
            final Rect r = tester.getRect(f);
            expect(
              r.top >= 0 && r.bottom <= size.height,
              isTrue,
              reason:
                  '[$code] $label — "$which" is at ${r.top}→${r.bottom} on a '
                  '${size.height}-tall screen even after scrolling to it. '
                  'Measured before the fix: 360×640 @2.0 put Allow at 1140→1220 '
                  'with no scrollable ancestor at all',
            );
            expect(
              r.left >= 0 && r.right <= size.width,
              isTrue,
              reason: '[$code] $label — "$which" is off the side of the screen',
            );
          }

          // AND THE TAP LANDS. The rectangle test above is geometry; this is the
          // property the geometry exists for — the question can actually be
          // answered — and it is the one that would have caught the defect
          // without anybody thinking to measure a rect.
          //
          // DECLINE rather than allow, for a mechanical reason worth recording:
          // a granted decision starts the recorder, which arms core's
          // `kFlushInterval` timer, and flutter_test then fails every one of
          // these eight cases with "A Timer is still pending even after the
          // widget tree was disposed" — a teardown complaint that says nothing
          // about layout. A refusal exercises the identical tap→dismiss path and
          // leaves no timer behind. What ALLOW records is
          // `consent_prompt_real_surface_test.dart`'s subject, not this file's.
          await tester.tap(
            find.widgetWithText(OutlinedButton, l10n.consentDecline),
          );
          for (int i = 0; i < 8; i++) {
            await tester.pump();
          }
          expect(
            find.text(l10n.consentPrivacy),
            findsNothing,
            reason:
                '[$code] $label — the prompt did not close on a real tap, so the '
                'first-run question is unanswerable at this size',
          );
        });
      }
    }

    testWidgets('the scroll view is what makes the tall case work', (
      WidgetTester tester,
    ) async {
      // NOT a tautology with the cases above, and the difference is worth the
      // extra case: those pass if the card happens to FIT. This one proves the
      // mechanism — at 360×640 @2.0 the content is genuinely taller than the
      // viewport, so the card is scrollable rather than merely small.
      await _pumpAsking(
        tester,
        const Locale('ta'),
        surface: const Size(360, 640),
        textScale: 2.0,
      );
      final Finder scroller = find.descendant(
        of: find.byType(Material),
        matching: find.byType(SingleChildScrollView),
      );
      expect(scroller, findsWidgets);
      final ScrollableState scrollable = tester.state<ScrollableState>(
        find
            .descendant(of: scroller.first, matching: find.byType(Scrollable))
            .first,
      );
      expect(
        scrollable.position.maxScrollExtent,
        greaterThan(0),
        reason:
            'the Tamil prompt at 360×640 @2.0 is taller than the viewport — if '
            'this is 0 the case has stopped measuring an overflowing card and '
            'would pass with the scroll view deleted',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  group('the scrim is modal for a screen reader, not only for a finger', () {
    testWidgets('the app behind the prompt is gone from the semantics tree', (
      WidgetTester tester,
    ) async {
      // ⚠️ DISPOSED IN THE BODY, NOT VIA `addTearDown`. flutter_test verifies
      // that every SemanticsHandle is gone BEFORE tear-downs run, so the tidy
      // form fails the case with "A SemanticsHandle was active at the end of the
      // test" and says nothing about semantics.
      final SemanticsHandle handle = tester.ensureSemantics();
      final AppLocalizations l10n = await _load('en');
      await _pumpAsking(
        tester,
        const Locale('en'),
        surface: const Size(600, 1200),
      );

      // `simulatedAccessibilityTraversal()` rather than a hand-rolled walk of
      // the semantics tree: it is what a screen reader would actually move
      // through, in order, which is the claim being made. (It also keeps this
      // file off `PipelineOwner.semanticsOwner`, deprecated since 3.10.)
      final List<String> labels = tester.semantics
          .simulatedAccessibilityTraversal()
          .map((SemanticsNode n) => n.label.trim())
          .where((String s) => s.isNotEmpty)
          .toList();

      // The two answers are the point of the surface and must be announced.
      expect(labels, contains(l10n.consentAllow));
      expect(labels, contains(l10n.consentDecline));

      // 🔴 AND THE CAROUSEL UNDERNEATH MUST NOT BE. These four were all present
      // and reachable before `ExcludeSemantics`: a TalkBack user could swipe
      // past a modal decision into a screen they were not supposed to be able to
      // touch, and activate it — semantic taps dispatch to the widget without
      // hit-testing, so the opaque scrim never came into it.
      for (final String behind in <String>[
        l10n.sublyOnboarding1Title,
        l10n.onboardingSkip,
        l10n.onboardingNext,
      ]) {
        expect(
          labels,
          isNot(contains(behind)),
          reason:
              '"$behind" is behind a modal consent question and is still exposed '
              'to a screen reader',
        );
      }
      handle.dispose();
    });

    testWidgets('the prompt declares itself a route scope', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final AppLocalizations l10n = await _load('en');
      await _pumpAsking(
        tester,
        const Locale('en'),
        surface: const Size(600, 1200),
      );

      // `ModalRoute` sets this on every pushed route and the inline scrim is not
      // a route, so without the explicit `Semantics` node there is nothing to
      // tell a screen reader that a decision is being asked for at all.
      //
      // Collected by WALKING for the flag rather than by
      // `find.bySemanticsLabel(title)`: the title string is on the scope node
      // AND on the `Text` inside it, so a label finder matches two elements and
      // `getSemantics` throws "Finder returned more than one element" — a
      // failure that looks like a broken assertion rather than a missing flag.
      // The walk starts at the app root's own node (`tester.semantics.find`),
      // not at `PipelineOwner.semanticsOwner`, which has been deprecated since
      // 3.10.
      final List<String> scopes = <String>[];
      void walk(SemanticsNode n) {
        final SemanticsData d = n.getSemanticsData();
        if (d.flagsCollection.scopesRoute) scopes.add(d.label.trim());
        n.visitChildren((SemanticsNode c) {
          walk(c);
          return true;
        });
      }

      walk(tester.semantics.find(find.byType(SublyApp)));
      expect(
        scopes,
        contains(l10n.consentTitle(AppConfig.appName)),
        reason:
            'no semantics node carries scopesRoute with the consent title, so '
            'the scrim no longer announces itself as a dialog. Found: $scopes',
      );
      handle.dispose();
    });
  });
}
