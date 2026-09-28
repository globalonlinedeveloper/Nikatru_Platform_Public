// ST-T2 (U5/U7) — the honest states every stamped app gets from the chassis:
// the plan-status row (C42), the paywall's plans-loading gate (C38) and the
// actionable-only settings chevron (D6, D2). RED CONTROLS: make PlanStatus.of
// return inactive while loading, make PlansLoadGate report loading false from
// the start, or draw RowChevron unconditionally — each case below goes red.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_chassis_screens/monetization/paywall_screen.dart';
import 'package:nikatru_chassis_screens/settings/settings_screen.dart';

import 'support/width_harness.dart';

const PlanStatusLabels _labels = PlanStatusLabels(
  active: 'Active',
  inactive: 'No plan',
  checking: 'Checking',
  failed: 'Could not check',
  retry: 'Retry',
);

Future<void> _pump(WidgetTester tester, Widget child) =>
    tester.pumpWidget(MaterialApp(home: Scaffold(body: child)));

void main() {
  group('C42 · PlanStatus / PlanStatusTile', () {
    test('only a loaded read is an answer', () {
      expect(
        PlanStatus.of(loaded: false, failed: false, pro: false),
        PlanStatus.checking,
      );
      expect(
        PlanStatus.of(loaded: false, failed: true, pro: false),
        PlanStatus.failed,
      );
      expect(
        PlanStatus.of(loaded: true, failed: true, pro: true),
        PlanStatus.active,
        reason: 'a failed refresh keeps the last answer',
      );
      expect(
        PlanStatus.of(loaded: true, failed: false, pro: false),
        PlanStatus.inactive,
      );
    });

    testWidgets('checking never says "no plan"', (WidgetTester tester) async {
      await _pump(
        tester,
        PlanStatusTile(
          status: PlanStatus.checking,
          labels: _labels,
          onRetry: () {},
        ),
      );
      await tester.pump();
      expect(find.byKey(PlanStatusTile.checkingKey), findsOneWidget);
      expect(find.text('Checking'), findsOneWidget);
      expect(find.text('No plan'), findsNothing);
    });

    testWidgets('failed says so and its Retry works', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await _pump(
        tester,
        PlanStatusTile(
          status: PlanStatus.failed,
          labels: _labels,
          onRetry: () => taps++,
        ),
      );
      expect(find.byKey(PlanStatusTile.failedKey), findsOneWidget);
      expect(find.text('No plan'), findsNothing);
      await tester.tap(find.text('Retry'));
      expect(taps, 1);
    });

    testWidgets('an answer is the answer', (WidgetTester tester) async {
      await _pump(
        tester,
        PlanStatusTile(
          status: PlanStatus.inactive,
          labels: _labels,
          onRetry: () {},
        ),
      );
      expect(find.byKey(PlanStatusTile.answerKey), findsOneWidget);
      expect(find.text('No plan'), findsOneWidget);
    });
  });

  group('C38 · PlansLoadGate', () {
    testWidgets('loading until the ask completes, then not', (
      WidgetTester tester,
    ) async {
      final Completer<void> answer = Completer<void>();
      int asked = 0;
      await _pump(
        tester,
        PlansLoadGate(
          load: () {
            asked++;
            return answer.future;
          },
          builder: (BuildContext context, bool loading) => loading
              ? const PlansLoading(label: 'Loading plans')
              : const Text('not available'),
        ),
      );
      await tester.pump();
      expect(asked, 1);
      expect(find.byKey(PlansLoading.loadingKey), findsOneWidget);
      expect(find.text('not available'), findsNothing);
      answer.complete();
      await tester.pump();
      await tester.pump();
      expect(find.byKey(PlansLoading.loadingKey), findsNothing);
      expect(find.text('not available'), findsOneWidget);
      expect(asked, 1, reason: 'asked once per open, not per rebuild');
    });

    testWidgets('repaints when the plans change', (WidgetTester tester) async {
      final ValueNotifier<int> plans = ValueNotifier<int>(0);
      addTearDown(plans.dispose);
      await _pump(
        tester,
        PlansLoadGate(
          load: () async {},
          changes: plans,
          builder: (BuildContext context, bool loading) =>
              Text('plans ${plans.value}'),
        ),
      );
      await tester.pump();
      plans.value = 2;
      await tester.pump();
      expect(find.text('plans 2'), findsOneWidget);
    });
  });

  group('D6/D2 · RowChevron', () {
    testWidgets('drawn only where a tap leads', (WidgetTester tester) async {
      await _pump(
        tester,
        const Column(
          children: <Widget>[
            RowChevron(actionable: true),
            RowChevron(actionable: false),
          ],
        ),
      );
      expect(find.byIcon(Icons.chevron_right), findsOneWidget);
    });
  });

  // Width: each state is pumped at all three window classes and must lay out
  // without an exception — it is a row or a centred spinner, and the page that
  // hosts it owns the cap.
  group('width · every window class', () {
    Future<void> each(
      WidgetTester tester,
      Future<void> Function(Size size) pump,
    ) async {
      await pump(kPhone);
      expect(tester.takeException(), isNull);
      await pump(kTablet);
      expect(tester.takeException(), isNull);
      await pump(kDesktop);
      expect(tester.takeException(), isNull);
    }

    testWidgets('PlanStatusTile', (WidgetTester tester) async {
      await each(
        tester,
        (Size size) => pumpChassis(
          tester,
          size,
          Scaffold(
            body: PlanStatusTile(
              status: PlanStatus.failed,
              labels: _labels,
              onRetry: () {},
            ),
          ),
        ),
      );
    });

    testWidgets('PlansLoadGate and PlansLoading', (WidgetTester tester) async {
      await each(
        tester,
        (Size size) => pumpChassis(
          tester,
          size,
          Scaffold(
            body: PlansLoadGate(
              load: () async {},
              builder: (BuildContext context, bool loading) =>
                  const PlansLoading(label: 'Loading plans'),
            ),
          ),
          settle: false,
        ),
      );
    });

    testWidgets('RowChevron', (WidgetTester tester) async {
      await each(
        tester,
        (Size size) => pumpChassis(
          tester,
          size,
          const Scaffold(body: RowChevron(actionable: true)),
        ),
      );
    });
  });
}
