import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// [ScreenCaptureBoundary] and [Sensitive] change nothing a person or a screen
/// reader meets (lane feedback-intake): the subtree they wrap keeps its hit
/// areas, its names and its contrast, which flutter_test's own guidelines read.
void main() {
  testWidgets(
    'ScreenCaptureBoundary over a Sensitive amount meets the tap-target, label and contrast guidelines',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await tester.pumpWidget(
          MaterialApp(
            home: ScreenCaptureBoundary(
              boundaryKey: GlobalKey(),
              child: Scaffold(
                body: Column(
                  children: <Widget>[
                    const Sensitive(child: Text('₹ 499.00')),
                    TextButton(onPressed: () {}, child: const Text('Renew')),
                  ],
                ),
              ),
            ),
          ),
        );
        expect(find.text('₹ 499.00'), findsOneWidget);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    },
  );
}
