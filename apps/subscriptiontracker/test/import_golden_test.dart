// IMPORT HUB GOLDENS — `import_hub_*`, `import_csv_map_*`, `import_review_*`
// (IM-01, IM-02). The `import_*` goldens of the retired `/scan` timer screen
// went with it (ADR 077 §2.2).
//
// Linux only, like every golden here. Regenerate through
// `.github/workflows/update-goldens.yml` after a deliberate visual change —
// never by hand on another OS:
//   flutter test --update-goldens test/import_golden_test.dart
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/import/import_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart'
    show currencyCodeProvider;

import 'support/width_harness.dart';

const Color kSublySeed = Color(0xFF6459F5);

/// One row already in the list, so the review shows a duplicate beside the
/// two new rows and the bad one.
class _OneRow extends SubscriptionRepository {
  _OneRow() : super(SeedApiClient());

  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[
    Subscription(
      id: 'a',
      name: 'Hotstar',
      category: 'Streaming',
      price: const Money(29900, 'INR'),
      cycle: BillingCycle.monthly,
      nextRenewal: DateTime(2026, 11, 12),
    ),
  ];
}

const String _csv =
    'name,price,currency,cycle,next_renewal\n'
    'Netflix,649,INR,monthly,2026-11-05\n'
    'Spotify,119,INR,monthly,2026-11-10\n'
    'Hotstar,299,INR,monthly,2026-11-12\n'
    'Broken,abc,INR,monthly,2026-11-15\n';

enum _Shot { hub, csvMap, review }

Future<void> _pump(
  WidgetTester tester,
  Size size,
  Brightness brightness,
  _Shot shot,
) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        ...defaultWidthOverrides(),
        subscriptionRepositoryProvider.overrideWithValue(_OneRow()),
        currencyCodeProvider.overrideWithValue('INR'),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
        home: const ImportScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  if (shot == _Shot.hub) return;
  await tester.enterText(find.byKey(E2EKeys.importPaste), _csv);
  await tester.pump();
  await tester.tap(find.byKey(E2EKeys.importRead));
  await tester.pumpAndSettle();
  if (shot == _Shot.csvMap) return;
  await tester.ensureVisible(find.byKey(E2EKeys.importContinue));
  await tester.tap(find.byKey(E2EKeys.importContinue));
  await tester.pumpAndSettle();
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };
  const Map<_Shot, String> names = <_Shot, String>{
    _Shot.hub: 'import_hub',
    _Shot.csvMap: 'import_csv_map',
    _Shot.review: 'import_review',
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<_Shot, String> shot in names.entries) {
    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('${shot.value} · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          await _pump(tester, c.value, b, shot.key);
          expect(tester.takeException(), isNull);
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/${shot.value}_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  }
}
