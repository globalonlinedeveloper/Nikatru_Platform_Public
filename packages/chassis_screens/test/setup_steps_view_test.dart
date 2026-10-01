// ST-T9 (EN-18) — the chassis after-sign-in step list. What the chassis owns
// and every stamped app inherits: Skip on EVERY step, Back from the second,
// the last step's primary as the finish, the position spoken, the reading cap.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/setup_steps_view.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/a11y_harness.dart' show kChassisSeed;
import 'support/width_harness.dart';

const List<SetupStep> _steps = <SetupStep>[
  SetupStep(title: 'One', body: 'The first thing'),
  SetupStep(title: 'Two', body: 'The second thing', child: Text('control')),
  SetupStep(title: 'Three', body: 'The third thing'),
];

Widget _view({VoidCallback? onFinish, VoidCallback? onSkip}) => MaterialApp(
  theme: buildAppTheme(seed: kChassisSeed),
  home: SetupStepsView(
    steps: _steps,
    onFinish: onFinish ?? () {},
    onSkip: onSkip ?? () {},
    nextLabel: 'Next',
    finishLabel: 'Done',
    skipLabel: 'Skip',
    backLabel: 'Back',
    positionLabel: (int i, int n) => 'Step $i of $n',
  ),
);

void main() {
  testWidgets('Skip is on every step; Back from the second; Done finishes', (
    WidgetTester tester,
  ) async {
    int finished = 0;
    int skipped = 0;
    await tester.pumpWidget(
      _view(onFinish: () => finished++, onSkip: () => skipped++),
    );
    expect(find.text('Step 1 of 3'), findsOneWidget);
    expect(find.byKey(SetupStepsView.backButton), findsNothing);
    for (int i = 1; i <= 3; i++) {
      expect(find.byKey(SetupStepsView.skipButton), findsOneWidget);
      expect(find.text('Step $i of 3'), findsOneWidget);
      if (i < 3) {
        expect(find.text('Next'), findsOneWidget);
        await tester.tap(find.byKey(SetupStepsView.advanceButton));
        await tester.pumpAndSettle();
      }
    }
    expect(find.text('control'), findsNothing, reason: 'step 2 is behind us');
    expect(find.text('Done'), findsOneWidget);
    await tester.tap(find.byKey(SetupStepsView.backButton));
    await tester.pumpAndSettle();
    expect(find.text('control'), findsOneWidget);
    await tester.tap(find.byKey(SetupStepsView.advanceButton));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(SetupStepsView.advanceButton));
    await tester.pumpAndSettle();
    expect(finished, 1);
    await tester.tap(find.byKey(SetupStepsView.skipButton));
    expect(skipped, 1);
  });

  testWidgets('the title is a header', (WidgetTester tester) async {
    final SemanticsHandle h = tester.ensureSemantics();
    await pumpChassis(tester, kPhone, _bare());
    expect(
      tester.getSemantics(find.text('One')),
      matchesSemantics(label: 'One', isHeader: true),
    );
    h.dispose();
  });

  // The width decision at every window class: the full window on a phone,
  // the reading cap (`AppBreakpoints.medium`) centred above it.
  for (final (Size window, double width) in <(Size, double)>[
    (kPhone, 375),
    (kTablet, AppBreakpoints.medium),
    (kDesktop, AppBreakpoints.medium),
  ]) {
    testWidgets('${window.width.toInt()} — the column is $width wide', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, window, _bare());
      final Finder column = find
          .ancestor(
            of: find.byKey(SetupStepsView.position),
            matching: find.byType(ConstrainedBox),
          )
          .last;
      expect(tester.getSize(column).width, width);
      expect(
        tester.getTopLeft(column).dx,
        (window.width - width) / 2,
        reason: 'centred in the window',
      );
      expect(tester.takeException(), isNull);
    });
  }
}

/// The view alone, for [pumpChassis] to host.
Widget _bare() => SetupStepsView(
  steps: _steps,
  onFinish: () {},
  onSkip: () {},
  nextLabel: 'Next',
  finishLabel: 'Done',
  skipLabel: 'Skip',
  backLabel: 'Back',
  positionLabel: (int i, int n) => 'Step $i of $n',
);
