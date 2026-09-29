// DETAIL AND NOTIFICATIONS, PIXEL FOR PIXEL — train ST-D5.
//
// Each screen, populated from the demo seed at a PINNED day, photographed at
// one window per class — compact, medium, expanded, large — in light and in
// dark. Sixteen goldens under `test/goldens/`.
//
// Regenerate, after a DELIBERATE visual change only, from this app's
// directory:
//   flutter test --update-goldens test/detail_notifications_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ THE DAY IS PINNED through `nowProvider` (2026-07-21). Both screens print
// "renews tomorrow"-shaped copy computed from today; photographed against the
// wall clock they would change every day and the goldens would assert the
// calendar, not the design.
//
// ⚠️ LINUX ONLY, and that is a statement about the renderer, not a skip for
// convenience: the goldens are drawn with the test font on the CI runners'
// platform, and glyph anti-aliasing differs on macOS and Windows by a few
// pixels. `packages/design_system/test/foundation_golden_test.dart` records
// the same rule for the foundation these screens are built from.
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/features/detail/subscription_detail_screen.dart';
import 'package:subscriptiontracker/features/notifications/notifications_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` passes to both themes.
const Color kSublySeed = Color(0xFF6459F5);

Future<void> _pumpScreen(
  WidgetTester tester,
  Widget screen,
  Size size,
  Brightness brightness,
) async {
  // Photographed at HALF density, as the foundation goldens are: the layout
  // is decided in logical pixels, so every window class lays out exactly as
  // at 1x, and each PNG is a quarter of the pixels.
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    // As the app's root ProviderScope: no automatic retry (Riverpod 3).
    retry: noProviderRetry,
    overrides: <Override>[
      ...defaultWidthOverrides(),
      apiClientProvider.overrideWithValue(SeedApiClient()),
      nowProvider.overrideWithValue(() => DateTime(2026, 7, 21, 9)),
    ],
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
        theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
        home: screen,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };
  const Map<String, Widget> screens = <String, Widget>{
    'detail': SubscriptionDetailScreen(id: '1'),
    'notifications': NotificationsScreen(),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, Widget> s in screens.entries) {
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${s.key} · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await _pumpScreen(tester, s.value, c.value, b);
          expect(tester.takeException(), isNull);
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/${s.key}_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }
}
