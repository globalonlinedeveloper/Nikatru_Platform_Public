// HOME, PIXEL FOR PIXEL — train ST-D1.
//
// Home populated from the one fixture board (`support/home_fixture.dart`, a
// pinned clock and six subscriptions), inside a real `AppScaffold` with the
// app's own theme, photographed at one window per class — compact, medium,
// expanded, large — in light and in dark. Eight goldens under
// `test/goldens/`. At large the summary has its own column and the list/detail
// split is open, so the three-column layout is photographed too.
//
// Regenerate, after a DELIBERATE visual change only, from the repo root:
//   flutter test --update-goldens apps/subscriptiontracker/test/home_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ LINUX ONLY, for the reason `packages/design_system/test/
// foundation_golden_test.dart` gives: glyph anti-aliasing differs by a few
// pixels on macOS and Windows, and CI — the only gate — is Linux.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/home_fixture.dart';
import 'support/width_harness.dart';

/// The seed `lib/app.dart` builds both themes from.
const Color kSublySeed = Color(0xFF6459F5);

class _Fixed implements SubscriptionRepository {
  @override
  Future<List<Subscription>> fetchAll() async => homeFixture();

  @override
  dynamic noSuchMethod(Invocation i) =>
      throw UnimplementedError('${i.memberName} is not under test');
}

Future<void> _pumpHome(
  WidgetTester tester,
  Size size,
  Brightness brightness,
) async {
  // HALF density, as the foundation goldens: the layout is decided in logical
  // pixels, so every class lays out as it does at 1x, at a quarter of the
  // pixels. Layout goldens, not type specimens.
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      subscriptionRepositoryProvider.overrideWithValue(_Fixed()),
      nowProvider.overrideWithValue(() => kHomeFixtureNow),
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
        home: AppScaffold(
          destinations: const <AppDestination>[
            AppDestination(icon: Icons.home_outlined, label: 'Home'),
            AppDestination(
              icon: Icons.event_outlined,
              label: 'Calendar',
              badgeCount: 2,
            ),
            AppDestination(icon: Icons.insights_outlined, label: 'Insights'),
            AppDestination(icon: Icons.more_horiz, label: 'More'),
          ],
          selectedIndex: 0,
          onDestinationSelected: (_) {},
          floatingActionButton: AppFab(
            icon: Icons.add,
            label: 'Add subscription',
            onPressed: () {},
          ),
          body: const HomeScreen(),
        ),
      ),
    ),
  );
  // Not `pumpAndSettle`: a fixed number of frames resolves every provider
  // future, the same way the width harness waits.
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

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, Size> c in classes.entries) {
    for (final Brightness b in Brightness.values) {
      testWidgets('home · ${c.key} · ${b.name}', (WidgetTester tester) async {
        await _pumpHome(tester, c.value, b);
        // The frame is POPULATED, not a loading outline photographed by
        // accident: a golden of the wrong state would pin the wrong screen.
        expect(find.byKey(HomeScreen.summaryKey), findsOneWidget);
        expect(tester.takeException(), isNull);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/home_${c.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);
    }
  }
}
