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
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PaywallGate(
            locked: false,
            title: _title,
            message: _message,
            upgradeLabel: _upgrade,
            child: Text('premium content'),
          ),
        ),
      ),
    );
    expect(find.text('premium content'), findsOneWidget);
    expect(find.text(_title), findsNothing);
  });

  testWidgets('shows the upsell when locked', (WidgetTester tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PaywallGate(
            locked: true,
            title: _title,
            message: _message,
            upgradeLabel: _upgrade,
            child: Text('premium content'),
          ),
        ),
      ),
    );
    expect(find.text('premium content'), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });

  testWidgets('fires onUpgrade when the button is tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await tester.pumpWidget(
      MaterialApp(
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
      ),
    );
    expect(find.text(_upgrade), findsOneWidget);
    await tester.tap(find.text(_upgrade));
    expect(taps, 1);
  });

  testWidgets('hides the button when onUpgrade is null but stays locked', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: PaywallGate(
            locked: true,
            title: _title,
            message: _message,
            upgradeLabel: _upgrade,
            child: Text('premium content'),
          ),
        ),
      ),
    );
    expect(find.text(_upgrade), findsNothing);
    expect(find.text(_title), findsOneWidget);
  });

  // ── PaywallGate.card — ST-D3 D3-6 (ST-P2): the lock on ONE card ──────────
  Widget cardGate({required bool locked, VoidCallback? onUpgrade}) =>
      MaterialApp(
        home: Scaffold(
          body: ListView(
            children: <Widget>[
              const Text('a free card'),
              PaywallGate.card(
                locked: locked,
                title: 'Next 12 months',
                badgeLabel: 'Pro',
                message: 'See what the next 12 months will cost.',
                upgradeLabel: 'See Pro',
                onUpgrade: onUpgrade,
                preview: const SizedBox(
                  key: Key('teaser'),
                  height: 40,
                  child: Text('teaser numbers'),
                ),
                child: const Text('the forecast'),
              ),
            ],
          ),
        ),
      );

  testWidgets('card: unlocked is the child, unchanged', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(cardGate(locked: false));
    expect(find.text('the forecast'), findsOneWidget);
    expect(find.text('See Pro'), findsNothing);
    expect(find.byType(AppCard), findsNothing);
  });

  testWidgets('card: locked is ONE card — the rest of the screen stays', (
    WidgetTester tester,
  ) async {
    bool upgraded = false;
    await tester.pumpWidget(
      cardGate(locked: true, onUpgrade: () => upgraded = true),
    );
    expect(
      find.text('a free card'),
      findsOneWidget,
      reason: 'a per-card gate must not wall off its neighbours',
    );
    expect(find.text('the forecast'), findsNothing);
    expect(find.byType(AppCard), findsOneWidget);
    expect(find.text('Next 12 months'), findsOneWidget);
    expect(find.text('Pro'), findsOneWidget);
    expect(find.text('See what the next 12 months will cost.'), findsOneWidget);
    await tester.tap(find.text('See Pro'));
    expect(upgraded, isTrue);
  });

  testWidgets('card: the teaser is decoration, never announced', (
    WidgetTester tester,
  ) async {
    final SemanticsHandle h = tester.ensureSemantics();
    await tester.pumpWidget(cardGate(locked: true, onUpgrade: () {}));
    expect(find.byKey(const Key('teaser')), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp('teaser')), findsNothing);
    expect(find.bySemanticsLabel(RegExp('Next 12 months')), findsWidgets);
    h.dispose();
  });
}
