// IMPORT — the first-run `/scan` screen on the ST-D0 foundation (train ST-D7).
//
// One case per state — loading, empty, failed, offline, populated — with the
// NEGATIVE assertion beside each positive one (`DataStateView`'s keys exist for
// exactly that: an empty list must never render as a failure, nor a failure as
// an empty list), plus one golden per window class × theme of the populated
// screen.
//
// ⚠️ THE TIMER IS DRIVEN BY HAND. `ScanScreen` holds a 560 ms minimum dwell
// for five steps; `pumpAndSettle` against a periodic timer is a lie about what
// is being waited for. See `width_scan_test.dart`.
//
// Regenerate the goldens, after a DELIBERATE visual change only, from the app:
//   flutter test --update-goldens test/import_screen_test.dart
// Linux only — see `packages/design_system/test/foundation_golden_test.dart`.
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/api/seed_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/seed/demo_data.dart';
import 'package:subscriptiontracker/features/scan/scan_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` builds both themes from.
const Color kSublySeed = Color(0xFF6459F5);

/// The first [n] demo subscriptions, or a thrown [error].
class _Api extends SeedApiClient {
  _Api({this.n = 3, this.error});
  final int n;
  final Object? error;
  @override
  Future<List<Subscription>> getSubscriptions() async {
    if (error != null) throw error!;
    return DemoData.subscriptions().take(n).toList();
  }
}

Widget _host(_Api api, {Brightness brightness = Brightness.light}) =>
    ProviderScope(
      // As the app's root ProviderScope: no automatic retry (Riverpod 3).
      retry: noProviderRetry,
      overrides: <Override>[
        ...defaultWidthOverrides(),
        apiClientProvider.overrideWithValue(api),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
        home: const ScanScreen(),
      ),
    );

/// Past every 560 ms step of the dwell, and the flip.
Future<void> _dwell(WidgetTester tester) async {
  for (int i = 0; i < 7; i++) {
    await tester.pump(const Duration(milliseconds: 560));
  }
}

void main() {
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  group('import · states', () {
    testWidgets('LOADING: progress, its step, and the list skeleton', (
      WidgetTester tester,
    ) async {
      await setSurface(tester, kPhone);
      await tester.pumpWidget(_host(_Api()));
      await tester.pump();

      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      expect(find.byKey(SkeletonList.skeletonKey), findsOneWidget);
      expect(find.text(en.scanBusyTitle), findsOneWidget);
      final FilledButton cta = tester.widget<FilledButton>(
        find.byKey(E2EKeys.scanPrimary),
      );
      expect(cta.enabled, isFalse, reason: 'nothing to go to yet');
      expect(find.byKey(DataStateView.failedKey), findsNothing);
      expect(find.byKey(DataStateView.emptyKey), findsNothing);
      expect(find.byType(AppListRow), findsNothing);
      await _dwell(tester);
    });

    testWidgets('POPULATED: a summary card over one card of rows', (
      WidgetTester tester,
    ) async {
      await setSurface(tester, kPhone);
      await tester.pumpWidget(_host(_Api(n: 3)));
      await _dwell(tester);

      expect(find.text(en.scanDoneTitle), findsOneWidget);
      expect(find.text(en.subscriptionCount(3)), findsOneWidget);
      expect(find.byType(AppListRow), findsNWidgets(3));
      expect(find.byKey(SkeletonList.skeletonKey), findsNothing);
      expect(find.byKey(DataStateView.emptyKey), findsNothing);
      expect(find.byKey(DataStateView.failedKey), findsNothing);
      final FilledButton cta = tester.widget<FilledButton>(
        find.byKey(E2EKeys.scanPrimary),
      );
      expect(cta.enabled, isTrue);
      expect(find.text(en.goToDashboard), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('EMPTY: a success with nothing in it — no summary, no retry', (
      WidgetTester tester,
    ) async {
      await setSurface(tester, kPhone);
      await tester.pumpWidget(_host(_Api(n: 0)));
      await _dwell(tester);

      expect(find.byKey(DataStateView.emptyKey), findsOneWidget);
      expect(find.text(en.dataEmptyTitle), findsOneWidget);
      expect(find.byKey(DataStateView.failedKey), findsNothing);
      expect(find.byKey(DataStateView.retryKey), findsNothing);
      // ST-U6 (B3): the first step is ON the empty state.
      expect(find.text(en.addSubscriptionTitle), findsOneWidget);
      // The pre-ST-D7 screen congratulated the user on "0 subscriptions".
      expect(find.text(en.subscriptionCount(0)), findsNothing);
      expect(find.text(en.scanResultsHeading), findsNothing);
      expect(
        tester.widget<FilledButton>(find.byKey(E2EKeys.scanPrimary)).enabled,
        isTrue,
        reason: 'the dashboard is where the first one is added',
      );
    });

    testWidgets('FAILED: said in sentences, with its own retry', (
      WidgetTester tester,
    ) async {
      await setSurface(tester, kPhone);
      final StateError boom = StateError('secret stack detail');
      await tester.pumpWidget(_host(_Api(error: boom)));
      await _dwell(tester);

      expect(find.byKey(DataStateView.failedKey), findsOneWidget);
      expect(find.text(en.dataFailedTitle), findsOneWidget);
      expect(find.byKey(DataStateView.retryKey), findsOneWidget);
      expect(find.byKey(DataStateView.emptyKey), findsNothing);
      // Not an offline failure, so no "check your connection".
      expect(find.text(en.dataFailedBody), findsNothing);
      // The raw exception is never printed at a user any more.
      expect(find.textContaining('secret stack detail'), findsNothing);
      // One way out: the primary slot steps aside for the state's retry.
      expect(find.byKey(E2EKeys.scanPrimary), findsNothing);
      expect(find.text(en.scanBusySubtitle), findsNothing);
      expect(find.text(en.scanDoneTitle), findsNothing);
    });

    testWidgets('OFFLINE: a transport failure says what to do about it', (
      WidgetTester tester,
    ) async {
      await setSurface(tester, kPhone);
      await tester.pumpWidget(
        _host(_Api(error: ApiException(0, 'Failed host lookup'))),
      );
      await _dwell(tester);

      expect(find.byKey(DataStateView.failedKey), findsOneWidget);
      expect(find.text(en.dataFailedTitle), findsOneWidget);
      expect(find.text(en.dataFailedBody), findsOneWidget);
      expect(find.textContaining('Failed host lookup'), findsNothing);
      expect(find.byKey(DataStateView.emptyKey), findsNothing);
    });
  });

  group('import · goldens (populated)', () {
    const Map<String, Size> classes = <String, Size>{
      'compact': Size(390, 844),
      'medium': Size(700, 1000),
      'expanded': Size(1024, 900),
      'large': Size(1440, 900),
    };

    test('each photographed size is the class it is named for', () {
      for (final MapEntry<String, Size> c in classes.entries) {
        expect(windowClassFor(c.value.width).name, c.key);
      }
    });

    for (final MapEntry<String, Size> c in classes.entries) {
      for (final Brightness b in Brightness.values) {
        testWidgets('import · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(_host(_Api(n: 4), brightness: b));
          await _dwell(tester);
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/import_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });
}
