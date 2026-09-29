// STOP A CHARGE — the cancel sheet on the ST-D0 foundation (train ST-D7).
//
// One case per state the sheet has — populated (the question), loading (the
// confirm in flight), failed, offline, done — plus the measured contrast of the
// destructive pair and one golden per window class × theme.
//
// There is no EMPTY case, and that is the sheet's shape rather than a gap: it is
// opened on one subscription, so "nothing to stop" is not a state it can be in.
//
// Regenerate the goldens, after a DELIBERATE visual change only, from the app:
//   flutter test --update-goldens test/stop_a_charge_test.dart
// and review every PNG before committing it. Linux only — see
// `packages/design_system/test/foundation_golden_test.dart` for why.
import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show ApiException;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/data/subscriptions/subscription_repository.dart';
import 'package:subscriptiontracker/features/cancel/cancel_sheet.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// The seed `app.dart` builds both themes from — restated, as every themed
/// test in this suite restates it.
const Color kSublySeed = Color(0xFF6459F5);

Subscription _sub() => Subscription(
  // '1' is the seed's own Netflix: the removal PATCHes the row (ST-T3b ST-E3,
  // a soft delete), and a row the backing store does not hold is a 404.
  id: '1',
  name: 'Netflix',
  category: 'Streaming',
  glyph: 'N',
  price: const Money(1500, 'USD'),
  cycle: BillingCycle.monthly,
  nextRenewal: DateTime.utc(2026, 9, 12),
);

/// A repository whose removal does whatever [onCancel] says.
///
/// ⏱ ST-T3b (ST-E3): the removal is a SOFT delete — a PATCH of `deleted_at`
/// through [update] — with the hard DELETE ([cancel]) only as the fallback
/// for a server that refuses it. Both go through [onCancel].
class _CancelRepository implements SubscriptionRepository {
  _CancelRepository(this.onCancel);
  final Future<void> Function() onCancel;

  @override
  Future<List<Subscription>> fetchAll() async => <Subscription>[_sub()];

  @override
  Future<Subscription> update(String id, Map<String, dynamic> changes) async {
    await onCancel();
    return _sub().patched(changes);
  }

  @override
  Future<void> cancel(String id) => onCancel();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName} is not under test');
}

Widget _host({
  Brightness brightness = Brightness.light,
  SubscriptionRepository? repository,
}) => ProviderScope(
  // As the app's root ProviderScope: no automatic retry (Riverpod 3).
  retry: noProviderRetry,
  overrides: <Override>[
    ...defaultWidthOverrides(),
    if (repository != null)
      subscriptionRepositoryProvider.overrideWithValue(repository),
  ],
  child: MaterialApp(
    debugShowCheckedModeBanner: false,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: buildAppTheme(seed: kSublySeed, brightness: brightness),
    home: Scaffold(
      body: Builder(
        builder: (BuildContext context) => Center(
          child: TextButton(
            onPressed: () => showCancelSheet(context, _sub()),
            child: const Text('open'),
          ),
        ),
      ),
    ),
  ),
);

Future<void> _open(WidgetTester tester, Widget host, {Size? size}) async {
  await setSurface(tester, size ?? kPhone);
  await tester.pumpWidget(host);
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

double _contrast(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  late AppLocalizations en;
  setUpAll(() async {
    en = await AppLocalizations.delegate.load(const Locale('en'));
  });

  group('stop a charge · states', () {
    testWidgets('POPULATED: the question names the charge, as its row', (
      WidgetTester tester,
    ) async {
      await _open(tester, _host());

      expect(find.text(en.cancelSubscriptionTitle('Netflix')), findsOneWidget);
      // The charge is the foundation row inside a card, not free text.
      final Finder row = find.byType(AppListRow);
      expect(row, findsOneWidget);
      expect(
        find.ancestor(of: row, matching: find.byType(AppCard)),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.text('Netflix')),
        findsOneWidget,
      );
      // ST-U3 (B32): "No money figure appears on this sheet" — the row names
      // the entry and carries no price or cycle.
      expect(
        find.descendant(of: row, matching: find.text(en.perMonth)),
        findsNothing,
      );
      expect(find.byKey(E2EKeys.cancelKeep), findsOneWidget);
      expect(find.byKey(E2EKeys.cancelConfirm), findsOneWidget);
      expect(find.byKey(E2EKeys.cancelFailure), findsNothing);
      // The confirm WEARS the measured danger pair — the token case below
      // measures the pair; this pins that the button is painted with it, on
      // every platform rather than only where the goldens run.
      final ButtonStyle confirm = tester
          .widget<FilledButton>(find.byKey(E2EKeys.cancelConfirm))
          .style!;
      final StatusTones light = StatusTones.forBrightness(Brightness.light);
      expect(confirm.backgroundColor!.resolve(<WidgetState>{}), light.danger);
      expect(
        confirm.foregroundColor!.resolve(<WidgetState>{}),
        light.dangerTint,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('LOADING: the confirm is busy and dead; the way out is live', (
      WidgetTester tester,
    ) async {
      final Completer<void> pending = Completer<void>();
      await _open(
        tester,
        _host(repository: _CancelRepository(() => pending.future)),
      );

      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pump();

      expect(find.text(en.cancellingEllipsis), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byKey(E2EKeys.cancelConfirm)).enabled,
        isFalse,
      );
      expect(
        tester.widget<OutlinedButton>(find.byKey(E2EKeys.cancelKeep)).enabled,
        isTrue,
        reason: "'Keep it' must stay reachable while the request is in flight",
      );
      expect(find.text(en.cancelledHeading), findsNothing);

      pending.complete();
      await tester.pumpAndSettle();
      expect(find.text(en.cancelledHeading), findsOneWidget);
    });

    testWidgets('FAILED: said on the sheet in the danger tone; never success', (
      WidgetTester tester,
    ) async {
      await _open(
        tester,
        _host(
          repository: _CancelRepository(
            () async => throw ApiException(500, 'server'),
          ),
        ),
      );
      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pumpAndSettle();

      final DecisionStrip strip = tester.widget<DecisionStrip>(
        find.byKey(E2EKeys.cancelFailure),
      );
      expect(strip.kind, StatusKind.danger);
      expect(strip.message, en.cancelSubscriptionFailed);
      expect(strip.actions, isEmpty, reason: 'the confirm IS the retry');
      expect(find.text(en.cancelledHeading), findsNothing);
      expect(find.text(en.confirmCancel), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('OFFLINE: a transport failure is its own state, in warn', (
      WidgetTester tester,
    ) async {
      await _open(
        tester,
        _host(
          repository: _CancelRepository(
            () async => throw ApiException(0, 'Failed host lookup'),
          ),
        ),
      );
      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pumpAndSettle();

      final DecisionStrip strip = tester.widget<DecisionStrip>(
        find.byKey(E2EKeys.cancelFailure),
      );
      expect(strip.kind, StatusKind.warn);
      expect(strip.message, en.offlineMessage);
      expect(strip.detail, en.cancelSubscriptionFailed);
      expect(find.text(en.cancelledHeading), findsNothing);

      // …and the confirm is the retry: a second attempt that works clears the
      // strip and reaches the outcome.
      expect(find.text(en.confirmCancel), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a retry after a failure clears the strip and succeeds', (
      WidgetTester tester,
    ) async {
      int calls = 0;
      await _open(
        tester,
        _host(
          repository: _CancelRepository(() async {
            calls += 1;
            if (calls == 1) throw ApiException(0, 'offline');
          }),
        ),
      );
      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.cancelFailure), findsOneWidget);

      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pumpAndSettle();
      expect(find.byKey(E2EKeys.cancelFailure), findsNothing);
      expect(find.text(en.cancelledHeading), findsOneWidget);
      expect(calls, 2);
    });

    testWidgets('DONE: the saving, and one keyed way out', (
      WidgetTester tester,
    ) async {
      await _open(tester, _host());
      await tester.tap(find.byKey(E2EKeys.cancelConfirm));
      await tester.pumpAndSettle();

      expect(find.text(en.cancelledHeading), findsOneWidget);
      expect(find.byKey(E2EKeys.cancelDone), findsOneWidget);
      await tester.tap(find.byKey(E2EKeys.cancelDone));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
    });
  });

  group('stop a charge · the status words are measured', () {
    for (final Brightness b in Brightness.values) {
      test('[${b.name}] the confirm and the body copy clear AA', () {
        final ThemeData theme = buildAppTheme(seed: kSublySeed, brightness: b);
        final StatusTones tones = StatusTones.forBrightness(b);
        final Color sheet = theme.colorScheme.surfaceContainerLow;
        expect(
          _contrast(tones.dangerTint, tones.danger),
          greaterThanOrEqualTo(4.5),
          reason: 'the confirm label on its fill',
        );
        expect(
          _contrast(theme.colorScheme.onSurfaceVariant, sheet),
          greaterThanOrEqualTo(4.5),
          reason: 'the body copy on the sheet',
        );
      });
    }
  });

  group('stop a charge · goldens', () {
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
        testWidgets('stop a charge · ${c.key} · ${b.name}', (
          WidgetTester tester,
        ) async {
          // Half density, as the foundation's goldens: layout is decided in
          // logical pixels, so every class lays out as at 1x.
          tester.view.physicalSize = c.value * 0.5;
          tester.view.devicePixelRatio = 0.5;
          addTearDown(tester.view.reset);
          await tester.pumpWidget(_host(brightness: b));
          await tester.tap(find.text('open'));
          await tester.pumpAndSettle();
          await expectLater(
            find.byType(MaterialApp),
            matchesGoldenFile('goldens/stop_a_charge_${c.key}_${b.name}.png'),
          );
        }, skip: !Platform.isLinux);
      }
    }
  });
}
