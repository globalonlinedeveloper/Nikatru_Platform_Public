// Train T20 (st-polish) — one harness for its five suites: a REAL controller
// over the REAL seed client, holding a fixture list, so a bulk delete, an Undo,
// a duplicate or a tag edit goes through the same writes the app makes and the
// test reads the list back from the controller rather than from the screen.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/seed/demo_data.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/subscriptions_controller.dart';

import 'home_fixture.dart';
import 'width_harness.dart';

/// The seed client, holding exactly [rows].
SeedApiClient seededWith(List<Subscription> rows) =>
    SeedApiClient()..restore(subs: rows, budget: DemoData.budget());

/// Keeps every file the export seam is handed.
class KeepingExporter implements core.FileExporter {
  final List<core.ExportFile> files = <core.ExportFile>[];

  @override
  Future<core.ExportOutcome> export(core.ExportFile file) async {
    files.add(file);
    return core.ExportOutcome.exported;
  }
}

/// Pumps [screen] in a `Scaffold` (so a SnackBar has somewhere to land) over
/// [rows], at [size], in [locale] and at [textScale]; returns the container so
/// a test can read the controller's list.
Future<ProviderContainer> pumpPolish(
  WidgetTester tester,
  Widget screen, {
  List<Subscription>? rows,
  Size size = const Size(400, 2400),
  Locale? locale,
  double textScale = 1,
  List<Override> overrides = const <Override>[],
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final List<Override> mine = <Override>[
    subscriptionRepositoryProvider.overrideWithValue(
      SubscriptionRepository(seededWith(rows ?? homeFixture())),
    ),
    nowProvider.overrideWithValue(() => kHomeFixtureNow),
    ...overrides,
  ];
  final Set<Object> replaced = <Object>{
    for (final Override o in mine) o.origin,
  };
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      for (final Override o in defaultWidthOverrides())
        if (!replaced.contains(o.origin)) o,
      ...mine,
    ],
  );
  addTearDown(c.dispose);
  // Kept alive whatever [screen] watches: a sheet opened from a bare button
  // reads the controller without listening, and an unwatched list would be
  // disposed between the write and the test's read of it.
  c.listen<Object?>(subscriptionsControllerProvider, (_, _) {});
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: Scaffold(body: screen),
      ),
    ),
  );
  await settle(tester);
  return c;
}

/// Frames enough for the provider futures and a sheet or snackbar animation,
/// without `pumpAndSettle` (a snackbar's display timer is not a frame).
Future<void> settle(WidgetTester tester) async {
  for (int i = 0; i < 12; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// The controller's list, as the app holds it.
List<Subscription> listOf(ProviderContainer c) =>
    c.read(subscriptionsControllerProvider).requireValue;

/// The localisations the pumped app resolved.
AppLocalizations l10nOf(WidgetTester tester) =>
    AppLocalizations.of(tester.element(find.byType(Scaffold).first));
