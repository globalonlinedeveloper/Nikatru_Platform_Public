import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The copy is passed in by every case, and it used not to be. Until 2026-09-04
/// this widget defaulted its three sentences to English and this suite relied on
/// those defaults — so a caller that supplied none looked identical to a caller
/// that supplied the right words. Every production call site DOES pass its copy;
/// the sibling `ForceUpdateGate` did not, and shipped English to every locale
/// for exactly that reason. Requiring the copy makes the two cases different.
const String _title = 'Unlock the full experience';
const String _message = 'Upgrade to unlock this feature.';
const String _upgrade = 'Upgrade';

void main() {
  testWidgets('shows the child when unlocked', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: PaywallGate(
          locked: false,
          title: _title,
          message: _message,
          upgradeLabel: _upgrade,
          child: Text('premium content')),
      ),
    ));
    expect(find.text('premium content'), findsOneWidget);
    expect(find.text(_title), findsNothing);
  });

  testWidgets('shows the upsell when locked', (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: PaywallGate(
          locked: true,
          title: _title,
          message: _message,
          upgradeLabel: _upgrade,
          child: Text('premium content')),
      ),
    ));
    expect(find.text('premium content'), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });

  testWidgets('fires onUpgrade when the button is tapped',
      (WidgetTester tester) async {
    int taps = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: PaywallGate(
          locked: true,
          title: _title,
          message: _message,
          upgradeLabel: _upgrade,
          onUpgrade: () => taps++,
          child: const Text('premium content'),
        ),
      ),
    ));
    expect(find.text(_upgrade), findsOneWidget);
    await tester.tap(find.text(_upgrade));
    expect(taps, 1);
  });

  testWidgets('hides the button when onUpgrade is null but stays locked',
      (WidgetTester tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: PaywallGate(
          locked: true,
          title: _title,
          message: _message,
          upgradeLabel: _upgrade,
          child: Text('premium content')),
      ),
    ));
    expect(find.text(_upgrade), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });
}
