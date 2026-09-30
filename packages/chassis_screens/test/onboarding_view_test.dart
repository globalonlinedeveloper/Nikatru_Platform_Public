import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/a11y_harness.dart' show kChassisSeed;
import 'support/width_harness.dart';

/// `OnboardingView` — the first-run carousel.
///
/// 🏗️ The widget half of `property: onboarding-shown-once`. That the flag is
/// WRITTEN, that the router sends a fresh install here, and that an app-config
/// override replaces the chassis default are all wiring halves and stay in the
/// brick suite — the override read is anchored in the brick adapter by
/// `assert-config-registry.mjs` and `assert-stamp-properties.mjs:1094`.
void main() {
  // Long enough that the paragraph WANTS more than 720 px. A short string would
  // measure its own width at every window and pass with the cap deleted, which
  // is the shape this case exists to refuse.
  const String longBody =
      'A body long enough to want the whole window, so the reading cap is what '
      'decides the line length rather than the string running out first, which '
      'is the defect this measurement exists to catch on a wide display.';

  const List<OnboardingPage> pages = <OnboardingPage>[
    OnboardingPage(title: 'One', body: longBody),
    OnboardingPage(title: 'Two', body: 'The second thing'),
    OnboardingPage(title: 'Three', body: 'The third thing'),
  ];

  Widget view({VoidCallback? onFinish}) =>
      OnboardingView(pages: pages, onFinish: onFinish ?? () {});

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // 🔴 THE ONE SCREEN WHERE THE DAMAGE IS TYPOGRAPHIC. Unconstrained, the body
  // ran 1216 px lines on a 1280 px window — roughly 200 characters, three times
  // the 45–75 the eye can track. `.reading` (720) is the constant that says
  // "this is continuous prose", and it is asserted at two windows above it so a
  // deleted cap cannot pass by the window happening to be narrow.
  group('property: onboarding-reads-at-every-window-class', () {
    // The PARAGRAPH, not the pane box: `ContentPane` hands its child LOOSENED
    // constraints, so the `ConstrainedBox` itself reports the child's intrinsic
    // width. What the cap actually decides is how long a line gets, and that is
    // what is measured — minus the 32 px of padding on each side, which sits
    // INSIDE the cap exactly as the `Padding` it replaced did.
    const double gutters = 64;
    Future<double> lineWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.text(longBody).first).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await lineWidthAt(tester, kPhone), kPhone.width - gutters);
    });

    testWidgets('kTablet — the reading cap holds', (WidgetTester tester) async {
      expect(
        await lineWidthAt(tester, kTablet),
        AppBreakpoints.reading - gutters,
      );
    });

    testWidgets('kDesktop — the reading cap still holds', (
      WidgetTester tester,
    ) async {
      expect(
        await lineWidthAt(tester, kDesktop),
        AppBreakpoints.reading - gutters,
      );
    });
  });

  // ── (2) IT CAN ALWAYS BE LEFT ─────────────────────────────────────────────
  group('property: onboarding-is-never-a-wall', () {
    testWidgets('SKIP is on the FIRST page and finishes immediately — an '
        'onboarding a user cannot leave is a wall, and both stores treat an '
        'unskippable first run as a dark pattern', (WidgetTester tester) async {
      bool finished = false;
      await pumpChassis(tester, kPhone, view(onFinish: () => finished = true));
      expect(find.text('One'), findsOneWidget);
      await tester.tap(find.byKey(OnboardingView.skipButton));
      expect(finished, isTrue);
    });

    testWidgets('the primary control ADVANCES until the last page, and only '
        'then finishes', (WidgetTester tester) async {
      int finished = 0;
      await pumpChassis(tester, kPhone, view(onFinish: () => finished++));

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      await tester.pumpAndSettle();
      expect(find.text('Two'), findsOneWidget);
      expect(finished, 0);

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      await tester.pumpAndSettle();
      expect(find.text('Three'), findsOneWidget);
      expect(finished, 0);

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      expect(finished, 1);
    });

    testWidgets('the dots track the page — one long pill, the rest rounds', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      // The PAINTED box, not the dot's slot: the slot carries the gap to the
      // next dot as margin.
      double widthOf(int i) => tester
          .getSize(
            find.descendant(
              of: find.byKey(OnboardingView.dot(i)),
              matching: find.byType(DecoratedBox),
            ),
          )
          .width;
      expect(widthOf(0), OnboardingView.dotActive);
      expect(widthOf(1), OnboardingView.dotIdle);
      expect(widthOf(2), OnboardingView.dotIdle);

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      await tester.pumpAndSettle();
      expect(widthOf(0), OnboardingView.dotIdle);
      expect(widthOf(1), OnboardingView.dotActive);
    });
  });

  // ── (3) THE POSITION IS SPOKEN — train ST-D8 ──────────────────────────────
  group('property: onboarding-says-where-you-are', () {
    testWidgets('one node says "Page 1 of 3", and it follows the page', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpChassis(tester, kPhone, view());
        expect(
          tester.getSemantics(find.byKey(OnboardingView.pageIndicator)).label,
          'Page 1 of 3',
        );
        await tester.tap(find.byKey(OnboardingView.advanceButton));
        await tester.pumpAndSettle();
        expect(
          tester.getSemantics(find.byKey(OnboardingView.pageIndicator)).label,
          'Page 2 of 3',
        );
      } finally {
        handle.dispose();
      }
    });

    testWidgets('[ta] the position is Tamil, not an English fallback', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpChassis(tester, kPhone, view(), locale: const Locale('ta'));
        expect(
          tester.getSemantics(find.byKey(OnboardingView.pageIndicator)).label,
          'பக்கம் 1 / 3',
        );
      } finally {
        handle.dispose();
      }
    });
  });

  // ── (4) THE CONTROLS SHARE THE CAP — train ST-D8 ──────────────────────────
  //
  // 🔴 The cap used to be per PAGE, so on a 1280 px window the body read at
  // 720 while the primary button ran 1232 px wide and SKIP sat alone in the far
  // corner. Measured at the two windows above the cap.
  group('property: onboarding-controls-are-capped', () {
    Future<void> expectCapped(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      final Rect advance = tester.getRect(
        find.byKey(OnboardingView.advanceButton),
      );
      final Rect skip = tester.getRect(find.byKey(OnboardingView.skipButton));
      expect(
        advance.right - skip.left,
        lessThanOrEqualTo(AppBreakpoints.reading),
      );
      // Centred with the words, not pinned to an edge of the window.
      expect(
        (skip.left + advance.right) / 2,
        moreOrLessEquals(size.width / 2, epsilon: 1),
      );
    }

    testWidgets('kTablet', (WidgetTester tester) async {
      await expectCapped(tester, kTablet);
    });

    testWidgets('kDesktop', (WidgetTester tester) async {
      await expectCapped(tester, kDesktop);
    });
  });

  // ── (5) ART, FOOTER AND TEXT SCALE — train ST-D8 ──────────────────────────
  group('property: onboarding-slots-and-scale', () {
    testWidgets('a page draws its art above the title; the footer is drawn', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        OnboardingView(
          pages: const <OnboardingPage>[
            OnboardingPage(
              title: 'One',
              body: 'The first thing',
              art: SizedBox(key: Key('art'), width: 40, height: 40),
            ),
          ],
          onFinish: () {},
          footer: const Text('footer'),
        ),
      );
      expect(
        tester.getRect(find.byKey(const Key('art'))).bottom,
        lessThan(tester.getRect(find.text('One')).top),
      );
      expect(find.text('footer'), findsOneWidget);
    });

    testWidgets('text scale 2.0 on a short phone scrolls, never overflows', (
      WidgetTester tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(320, 568));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: ChassisLocalizations.localizationsDelegates,
          supportedLocales: ChassisLocalizations.supportedLocales,
          builder: (BuildContext c, Widget? child) => MediaQuery(
            data: MediaQuery.of(
              c,
            ).copyWith(textScaler: const TextScaler.linear(2)),
            child: child!,
          ),
          home: view(),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(OnboardingView.skipButton), findsOneWidget);
    });
  });

  // ── (6) PIXEL FOR PIXEL, PER WINDOW CLASS AND THEME — train ST-D8 ─────────
  //
  // Regenerate after a DELIBERATE visual change only:
  //   flutter test --update-goldens packages/chassis_screens/test/onboarding_view_test.dart
  // ⚠️ LINUX ONLY, for the renderer reason foundation_golden_test.dart records.
  group('golden: onboarding', () {
    const Map<String, Size> classes = <String, Size>{
      'compact': Size(390, 844),
      'medium': Size(700, 1000),
      'expanded': Size(1024, 900),
      'large': Size(1440, 900),
    };

    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('onboarding · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(
            MaterialApp(
              debugShowCheckedModeBanner: false,
              localizationsDelegates:
                  ChassisLocalizations.localizationsDelegates,
              supportedLocales: ChassisLocalizations.supportedLocales,
              theme: buildAppTheme(seed: kChassisSeed, brightness: b),
              home: OnboardingView(
                pages: const <OnboardingPage>[
                  OnboardingPage(
                    title: 'One',
                    body: longBody,
                    art: Icon(Icons.auto_awesome_outlined),
                  ),
                  OnboardingPage(title: 'Two', body: 'The second thing'),
                ],
                onFinish: () {},
                footer: const Text('footer'),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/onboarding_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });
}
