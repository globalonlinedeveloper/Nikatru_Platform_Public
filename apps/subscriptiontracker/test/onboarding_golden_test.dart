// SUBLY'S FIRST RUN, PIXEL FOR PIXEL — train ST-D8.
//
// `/onboarding` now ADOPTS the chassis `OnboardingView`; what stays Subly's is
// the copy, the tile art on the first page and the wordmark footer. One golden
// per window class (compact, medium, expanded, large) in each theme — the stage
// used to be forced dark in both, so the light half is the new surface.
//
// Regenerate, after a DELIBERATE visual change only, from the repo root:
//   flutter test --update-goldens apps/subscriptiontracker/test/onboarding_golden_test.dart
// and review every PNG in the diff before committing it.
//
// ⚠️ LINUX ONLY, for the renderer reason
// `packages/design_system/test/foundation_golden_test.dart` records.
//
// The screen has no data states: it reads nothing but the arb and the config
// override, so loading / empty / error / offline have no branch here to
// photograph. The one input that can be absent — the remote config — is
// pinned by the last case: absent config renders the designed copy, never a
// key.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/onboarding/onboarding_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// Subly's seed, as `lib/app.dart` passes it.
const Color _kSeed = Color(0xFF6459F5);

Future<void> _pump(WidgetTester tester, Size size, Brightness b) async {
  // Half density: layout goldens, not type specimens.
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: _kSeed, brightness: b),
        home: const OnboardingScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, Size> c in classes.entries) {
    for (final Brightness b in Brightness.values) {
      testWidgets('onboarding · ${c.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        await _pump(tester, c.value, b);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/onboarding_${c.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);
    }
  }

  testWidgets('the route renders the CHASSIS carousel, with Subly\'s words', (
    WidgetTester tester,
  ) async {
    await _pump(tester, classes['compact']!, Brightness.light);
    final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
    expect(find.byType(OnboardingView), findsOneWidget);
    // Absent config (the width overrides leave it unresolved): the designed
    // copy, never the key `onboarding.1.title`.
    expect(find.text(en.subscriptiontrackerOnboarding1Title), findsOneWidget);
    expect(find.text('onboarding.1.title'), findsNothing);
    // The e2e and the store capture find the carousel by this word.
    expect(find.text('Skip'), findsOneWidget);
  });

  testWidgets('the tile art is decoration: none of it is announced', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    try {
      await _pump(tester, classes['compact']!, Brightness.dark);
      expect(find.text('NFX'), findsOneWidget);
      expect(find.bySemanticsLabel('NFX'), findsNothing);
    } finally {
      handle.dispose();
    }
  });
}
