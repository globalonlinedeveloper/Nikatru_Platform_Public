// ─────────────────────────────────────────────────────────────────────────────
// a11y_app_scaffold_test.dart — the accessibility sweep for `AppScaffold`'s
// LARGE- and EXTRA-LARGE-class navigation rail ([ADR 083]).
//
// ⏱ 2026-09-15 · WHY THIS FILE EXISTS. The owner decided the large window class
// (1200–1599 px) navigates by a slim `NavigationRail` instead of the 360 px
// `NavigationDrawer` ("Rail instead of drawer"). The ADR asks for the a11y sweep
// to cover the rail's destinations — labels, focus order, tap targets — at the
// widths the change actually reaches. The name is load-bearing:
// `assert-a11y-coverage.mjs` counts EXACTLY `a11y_*_test.dart`, so a sweep
// written inside `app_scaffold_test.dart` would run green and stay invisible
// (the same lesson `a11y_data_state_test.dart`'s header records).
//
// ⚠️ EACH WIDTH IS ITS OWN CASE, declared individually rather than generated in
// a loop: 1200 is the first large width, 1440 the laptop the complaint was
// about, 1599 the last large width before the drawer returns.
//
// ⏱ 2026-09-16 · [ADR 083] §4 ("Rail for all wide windows"): the drawer does
// not return. Extra-large takes the same slim rail, and §4 asks for every
// destination to be announced there too. 1600 is the first extra-large width,
// 1621 the last width of the band that lost Home's side panel under the drawer,
// and 1920 a wide desktop.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

const List<AppDestination> _destinations = <AppDestination>[
  AppDestination(
    icon: Icons.home_outlined,
    selectedIcon: Icons.home,
    label: 'Home',
  ),
  AppDestination(
    icon: Icons.pie_chart_outline,
    selectedIcon: Icons.pie_chart,
    label: 'Budget',
  ),
  AppDestination(
    icon: Icons.settings_outlined,
    selectedIcon: Icons.settings,
    label: 'Settings',
  ),
];

const List<String> _labels = <String>['Home', 'Budget', 'Settings'];

Future<void> _pumpAt(WidgetTester tester, Size size, Widget scaffold) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(MaterialApp(home: scaffold));
  await tester.pump();
}

/// Every semantics node under the rail that carries one of [_labels].
List<SemanticsData> _destinationNodes(WidgetTester tester) {
  final List<SemanticsData> out = <SemanticsData>[];
  void visit(SemanticsNode n) {
    final SemanticsData d = n.getSemanticsData();
    if (_labels.any((String l) => d.label.contains(l))) out.add(d);
    n.visitChildren((SemanticsNode c) {
      visit(c);
      return true;
    });
  }

  visit(tester.getSemantics(find.byType(NavigationRail)));
  return out;
}

/// The label of whatever holds primary focus, read through its semantics.
String? _focusedLabel(WidgetTester tester) {
  final BuildContext? ctx = FocusManager.instance.primaryFocus?.context;
  if (ctx == null) return null;
  for (final String l in _labels) {
    final Finder f = find.descendant(
      of: find.byWidget(ctx.widget),
      matching: find.text(l),
    );
    if (f.evaluate().isNotEmpty) return l;
  }
  return null;
}

/// Tab from a cold start until focus has visited every destination once, and
/// return the order it visited them in.
Future<List<String>> _tabOrder(WidgetTester tester) async {
  final List<String> seen = <String>[];
  for (int i = 0; i < 12 && seen.length < _labels.length; i++) {
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    final String? l = _focusedLabel(tester);
    if (l != null && !seen.contains(l)) seen.add(l);
  }
  return seen;
}

/// The label half of the sweep: the rail is what renders, every destination
/// is announced by name, and exactly one says it is the current one.
void _expectRailAnnounced(WidgetTester tester, Size size) {
  expect(find.byType(NavigationRail), findsOneWidget);
  expect(find.byType(NavigationDrawer), findsNothing);
  final List<SemanticsData> nodes = _destinationNodes(tester);
  for (final String l in _labels) {
    expect(
      nodes.where((SemanticsData d) => d.label.contains(l)),
      isNotEmpty,
      reason: 'the rail destination "$l" must be announced by name at $size',
    );
  }
  expect(
    nodes
        .where((SemanticsData d) =>
            d.flagsCollection.isSelected == Tristate.isTrue)
        .length,
    1,
    reason: 'exactly one rail destination reports itself selected at $size',
  );
}

// ⚠️ EACH CASE CONSTRUCTS `AppScaffold(` AND CALLS `meetsGuideline` IN ITS OWN
// BODY. assert-a11y-coverage attributes a sweep to a surface per `testWidgets`
// block — a shared helper that did both would run green and count for nothing.
void main() {
  group('AppScaffold large-class rail is accessible (ADR 083)', () {
    testWidgets('1200 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1200, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });

    testWidgets('1440 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1440, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });

    testWidgets('1599 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1599, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });
  });

  group('AppScaffold extra-large-class rail is accessible (ADR 083 §4)', () {
    testWidgets('1600 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1600, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });

    testWidgets('1621 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1621, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });

    testWidgets('1920 — labels, one selected, tap targets, focus order', (
      WidgetTester tester,
    ) async {
      const Size size = Size(1920, 900);
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pumpAt(
        tester,
        size,
        AppScaffold(
          destinations: _destinations,
          selectedIndex: 1,
          onDestinationSelected: (_) {},
          body: const Center(child: Text('BODY')),
        ),
      );
      _expectRailAnnounced(tester, size);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      expect(await _tabOrder(tester), _labels,
          reason: 'Tab reaches the destinations in the order they are drawn');
      handle.dispose();
    });
  });
}
