// HOME IN HINDI AT 200 % TEXT, PIXEL FOR PIXEL — train T20 (XP-06).
//
// The fixture board (`support/home_fixture.dart`) in the third locale, at the
// largest text a person may set, on the narrowest phone class: the frame where
// a Devanagari label one word longer than its English is most likely to clip.
// `st_polish_hindi_test.dart` asserts the same frame throws no overflow on any
// platform; this pins what it LOOKS like, on the one renderer CI trusts.
//
// Regenerate, after a DELIBERATE visual change only, through
// `.github/workflows/update-goldens.yml` with this file as its test path — the
// pinned Flutter on the CI image, never by hand on Windows or macOS.
//
// ⚠️ LINUX ONLY, for the reason `home_golden_test.dart` gives.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/home/home_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/home_fixture.dart';
import 'support/st_polish_harness.dart';
import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets('home · hi · compact · 200 % · ${b.name}', (
      WidgetTester tester,
    ) async {
      const Size size = Size(360, 800);
      tester.view.physicalSize = size * 0.5;
      tester.view.devicePixelRatio = 0.5;
      addTearDown(tester.view.reset);
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          ...defaultWidthOverrides(),
          subscriptionRepositoryProvider.overrideWithValue(
            SubscriptionRepository(seededWith(homeFixture())),
          ),
          nowProvider.overrideWithValue(() => kHomeFixtureNow),
        ],
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            locale: const Locale('hi'),
            localizationsDelegates: <LocalizationsDelegate<dynamic>>[
              ...AppLocalizations.localizationsDelegates,
              ChassisLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            theme: buildAppTheme(seed: kSublySeed, brightness: b),
            builder: (BuildContext context, Widget? child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: const Scaffold(body: HomeScreen()),
          ),
        ),
      );
      for (int i = 0; i < 12; i++) {
        await tester.pump();
      }
      expect(find.byKey(HomeScreen.summaryKey), findsOneWidget);
      expect(tester.takeException(), isNull);
      await expectLater(
        find.byType(MaterialApp),
        matchesGoldenFile('goldens/home_hi_compact_200_${b.name}.png'),
      );
    }, skip: !Platform.isLinux);
  }
}
