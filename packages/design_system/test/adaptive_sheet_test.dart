// showAdaptiveSheet — train ST-D3, label D3-2. A bottom sheet on a compact
// window, a dialog no wider than 600 from medium up, and on both the platform's
// own dismissals (Esc) with focus handed back to the opener.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const Key _opener = Key('opener');
const Key _content = Key('content');

Future<void> _open(
  WidgetTester tester,
  Size size, {
  bool byKeyboard = false,
}) async {
  // The VIEW, not `setSurfaceSize`: the window class is read off
  // `MediaQuery.sizeOf`, which follows the view.
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (BuildContext context) => Center(
            child: TextButton(
              key: _opener,
              onPressed: () => showAdaptiveSheet<void>(
                context: context,
                builder: (_) => const SizedBox(
                  key: _content,
                  height: 200,
                  width: double.infinity,
                ),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    ),
  );
  if (byKeyboard) {
    // Focus the opener the way a keyboard user does, then activate it: focus
    // can only be RETURNED to a control that held it.
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
  } else {
    await tester.tap(find.byKey(_opener));
  }
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a compact window gets a bottom sheet, not a dialog', (
    WidgetTester tester,
  ) async {
    await _open(tester, const Size(390, 844));
    expect(find.byType(BottomSheet), findsOneWidget);
    expect(find.byType(Dialog), findsNothing);
    expect(tester.getSize(find.byKey(_content)).width, 390);
  });

  for (final double width in <double>[600, 1024, 1440]) {
    testWidgets('at $width the editor is a dialog no wider than 600', (
      WidgetTester tester,
    ) async {
      await _open(tester, Size(width, 900));
      expect(find.byType(Dialog), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        tester.getSize(find.byKey(_content)).width,
        lessThanOrEqualTo(AppBreakpoints.medium),
        reason: 'a form stretched across a desktop is a banner, not a dialog',
      );
    });
  }

  testWidgets('Esc closes the dialog and focus returns to the opener', (
    WidgetTester tester,
  ) async {
    await _open(tester, const Size(1024, 900), byKeyboard: true);
    expect(find.byKey(_content), findsOneWidget);
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(_content), findsNothing);
    final FocusNode? focused = FocusManager.instance.primaryFocus;
    expect(
      focused?.context?.findAncestorWidgetOfExactType<TextButton>()?.key,
      _opener,
      reason: 'a dismissed dialog must hand focus back to what opened it',
    );
  });

  testWidgets('Esc closes the compact sheet too', (WidgetTester tester) async {
    await _open(tester, const Size(390, 844));
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    await tester.pumpAndSettle();
    expect(find.byKey(_content), findsNothing);
  });
}
