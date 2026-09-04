import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// 🔴 THE COPY IS PASSED IN BY EVERY CASE HERE, AND IT USED NOT TO BE — WHICH IS
/// EXACTLY THE DEFECT THIS FILE FAILED TO CATCH.
///
/// Until 2026-09-04 `ForceUpdateGate` defaulted its three sentences to English,
/// and so did this suite: every case below constructed the widget with no copy
/// at all and then asserted on `'Update required'` — the default. So the tests
/// passed, the widget worked, and BOTH production call sites in the portfolio
/// (`apps/subly/lib/app.dart` and the brick's `app.dart`) also passed no copy,
/// which meant the one screen that REPLACES THE WHOLE APP shipped English to
/// every locale. No arb key for it had ever existed, in either tree, in either
/// language.
///
/// A suite that exercises a widget through its defaults cannot see that the
/// defaults are what production is using. The copy is now REQUIRED, so this file
/// has to say what it expects to read — and a caller that forgets is a compile
/// error rather than an English wall on a Tamil user's screen.
const String _title = 'Update required';
const String _message = 'This version is no longer supported.';
const String _action = 'Update now';

void main() {
  testWidgets('shows the child when no update is required', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ForceUpdateGate(
          mustUpdate: false,
          title: _title,
          message: _message,
          buttonLabel: _action,
          child: Text('app content'),
        ),
      ),
    );
    expect(find.text('app content'), findsOneWidget);
    expect(find.text(_title), findsNothing);
  });

  testWidgets('blocks with the update screen when an update is required', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ForceUpdateGate(
          mustUpdate: true,
          title: _title,
          message: _message,
          buttonLabel: _action,
          child: Text('app content'),
        ),
      ),
    );
    expect(find.text('app content'), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });

  testWidgets('fires onUpdate when the button is tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ForceUpdateGate(
          mustUpdate: true,
          onUpdate: () => taps++,
          title: _title,
          message: _message,
          buttonLabel: _action,
          child: const Text('app content'),
        ),
      ),
    );
    expect(find.text(_action), findsOneWidget);
    await tester.tap(find.text(_action));
    expect(taps, 1);
  });

  testWidgets('hides the button when onUpdate is null but still blocks', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: ForceUpdateGate(
          mustUpdate: true,
          title: _title,
          message: _message,
          buttonLabel: _action,
          child: Text('app content'),
        ),
      ),
    );
    expect(find.text(_action), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });

  // 🔴 THE CASE THAT WOULD HAVE CAUGHT THE REAL DEFECT, and it could not have
  // existed while the copy had defaults: it asserts the widget paints WHAT IT
  // WAS GIVEN and carries no English of its own. With defaults in place this
  // was unwritable — passing nothing and passing the default are the same call.
  testWidgets('paints the caller\'s words, and has none of its own', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ForceUpdateGate(
          mustUpdate: true,
          // ⚠️ `onUpdate` IS SUPPLIED, and the first version of this case
          // omitted it and failed looking for the button. That was the widget
          // being right: with no update action the button is hidden on purpose,
          // because a dead control on a screen the user cannot leave is worse
          // than no control. The case needs the button PRESENT to prove its
          // label is the caller's, so it has to give the widget something to do.
          onUpdate: () {},
          title: 'Uppdatering krävs',
          message: 'Den här versionen stöds inte längre.',
          buttonLabel: 'Uppdatera nu',
          child: const Text('app content'),
        ),
      ),
    );
    expect(find.text('Uppdatering krävs'), findsOneWidget);
    expect(find.text('Uppdatera nu'), findsOneWidget);
    // The English the widget used to default to must appear nowhere.
    expect(find.text('Update required'), findsNothing);
    expect(find.text('Update now'), findsNothing);
  });
}
