// C48 (round-2 review, ST-N3 keyboard half; ST-D0 D0-6) — THE SHELL HAD NO
// KEYBOARD. N, /, Esc and the digits are bound in AppScaffold, so every
// stamped app gets them; typing in a field is never taken for a shortcut.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

class Rig {
  int primary = 0;
  final List<int> selected = <int>[];
  final FocusNode search = FocusNode(debugLabel: 'search');
}

Future<Rig> pumpShell(WidgetTester tester, Size size) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final Rig rig = Rig();
  addTearDown(rig.search.dispose);
  await tester.pumpWidget(
    MaterialApp(
      home: AppScaffold(
        destinations: const <AppDestination>[
          AppDestination(icon: Icons.home, label: 'Home'),
          AppDestination(icon: Icons.calendar_month, label: 'Calendar'),
          AppDestination(icon: Icons.insights, label: 'Insights'),
          AppDestination(icon: Icons.settings, label: 'Settings'),
        ],
        selectedIndex: 0,
        onDestinationSelected: rig.selected.add,
        onPrimaryAction: () => rig.primary++,
        onSearch: rig.search.requestFocus,
        body: Center(child: TextField(focusNode: rig.search)),
      ),
    ),
  );
  await tester.pump();
  return rig;
}

void main() {
  for (final Size size in const <Size>[Size(390, 844), Size(1280, 800)]) {
    group('at ${size.width.toInt()} px', () {
      testWidgets('N runs the primary action; 1-4 switch tabs', (
        WidgetTester tester,
      ) async {
        final Rig rig = await pumpShell(tester, size);
        await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
        expect(rig.primary, 1);
        for (final LogicalKeyboardKey k in <LogicalKeyboardKey>[
          LogicalKeyboardKey.digit1,
          LogicalKeyboardKey.digit2,
          LogicalKeyboardKey.digit3,
          LogicalKeyboardKey.digit4,
        ]) {
          await tester.sendKeyEvent(k);
        }
        expect(rig.selected, <int>[0, 1, 2, 3]);
        // Four destinations bind four digits, no more.
        await tester.sendKeyEvent(LogicalKeyboardKey.digit5);
        expect(rig.selected, <int>[0, 1, 2, 3]);
      });

      testWidgets('/ focuses search; typing there is not a shortcut; Esc '
          'leaves the field', (WidgetTester tester) async {
        final Rig rig = await pumpShell(tester, size);
        await tester.sendKeyEvent(LogicalKeyboardKey.slash, character: '/');
        await tester.pump();
        expect(rig.search.hasPrimaryFocus, isTrue);

        await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
        await tester.sendKeyEvent(LogicalKeyboardKey.digit2);
        expect(rig.primary, 0);
        expect(rig.selected, isEmpty);

        await tester.sendKeyEvent(LogicalKeyboardKey.escape);
        await tester.pump();
        expect(rig.search.hasFocus, isFalse);
        // And the shortcuts are live again.
        await tester.sendKeyEvent(LogicalKeyboardKey.keyN);
        expect(rig.primary, 1);
      });
    });
  }

  testWidgets('Esc outside a field is not taken: it reaches the routes above',
      (WidgetTester tester) async {
    await pumpShell(tester, const Size(1280, 800));
    final bool handled = await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    expect(handled, isFalse);
  });

  testWidgets('N and / are unbound when the app passes no callback', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: AppScaffold(
          destinations: const <AppDestination>[
            AppDestination(icon: Icons.home, label: 'Home'),
            AppDestination(icon: Icons.settings, label: 'Settings'),
          ],
          selectedIndex: 0,
          onDestinationSelected: (_) {},
          body: const SizedBox(),
        ),
      ),
    );
    await tester.pump();
    expect(await tester.sendKeyEvent(LogicalKeyboardKey.keyN), isFalse);
  });
}
