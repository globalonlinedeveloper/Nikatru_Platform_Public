// ─────────────────────────────────────────────────────────────────────────────
// a11y_two_pane_test.dart — the accessibility sweep for `TwoPane` and
// `TwoPanePlaceholder` (SYN-X1 C-11, train P39), both schemes.
//
// Its own file, apart from a11y_mounted_surfaces_test.dart, because its
// subject IS width-dependent: the placeholder column exists only from
// [AppBreakpoints.expanded] (840) up, so the case pins a 1280 window and
// asserts the second column is there before sweeping it. A file that pins a
// size is credited by `assert-responsive-coverage.mjs` as measuring the width
// of what it constructs; that is true here and was not true of the other
// fourteen sweeps.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  for (final Brightness b in Brightness.values) {
    testWidgets(
      'TwoPane and TwoPanePlaceholder, two columns at 1280, ${b.name}',
      (WidgetTester tester) async {
        final SemanticsHandle handle = tester.ensureSemantics();
        await tester.binding.setSurfaceSize(const Size(1280, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));
        await tester.pumpWidget(
          MaterialApp(
            theme: buildAppTheme(seed: const Color(0xFF6459F5), brightness: b),
            home: Scaffold(
              body: TwoPane(
                list: ListView(
                  children: <Widget>[
                    ListTile(title: const Text('Netflix'), onTap: () {}),
                    ListTile(title: const Text('Spotify'), onTap: () {}),
                  ],
                ),
                detail: null,
                placeholder: const TwoPanePlaceholder(
                  message: 'Pick a subscription to see it here.',
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.byType(TwoPanePlaceholder), findsOneWidget);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      },
    );
  }
}
