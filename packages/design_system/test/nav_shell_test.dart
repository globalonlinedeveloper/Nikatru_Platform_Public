import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
// Through the BARREL, deliberately — a `src/` path import would keep passing if
// the export line were ever dropped, and the brick's `home_screen.dart` reaches
// `NavShell`/`NavTab` through the barrel and nothing else. So this import is
// also the assertion that the export exists.
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  AppDestination dest(String label) =>
      AppDestination(icon: Icons.circle_outlined, label: label);

  NavTab tab(
    String label,
    String location, {
    List<String> alsoOwns = const <String>[],
    VoidCallback? onSelected,
  }) =>
      NavTab(
        destination: dest(label),
        location: location,
        alsoOwns: alsoOwns,
        onSelected: onSelected ?? () {},
      );

  // The chassis's own shape: three tabs, with the cancellation screen hanging
  // off Settings.
  List<NavTab> chassisTabs({List<String> tapped = const <String>[]}) =>
      <NavTab>[
        tab('Home', '/', onSelected: () => tapped.add('/')),
        tab('Explore', '/explore', onSelected: () => tapped.add('/explore')),
        tab(
          'Settings',
          '/settings',
          alsoOwns: const <String>['/manage-plan'],
          onSelected: () => tapped.add('/settings'),
        ),
      ];

  group('navIndexForLocation', () {
    test('an exact location selects its own tab', () {
      expect(navIndexForLocation('/', chassisTabs()), 0);
      expect(navIndexForLocation('/explore', chassisTabs()), 1);
      expect(navIndexForLocation('/settings', chassisTabs()), 2);
    });

    test('a sub-location is owned by its parent tab', () {
      expect(navIndexForLocation('/settings/notifications', chassisTabs()), 2);
    });

    test('ownership stops at a path boundary, not at a prefix', () {
      // `/settings-export` is a different route. A bare startsWith hands it to
      // Settings and the bug is invisible: the right tab looks selected.
      expect(navIndexForLocation('/settings-export', chassisTabs()), isNull);
    });

    test('"/" owns only itself, not every location under it', () {
      // Every location starts with '/', so a prefix rule would give the home
      // tab the whole app — including `/sign-in`, which lives ABOVE the shell
      // and belongs to no tab at all. That is the case worth pinning: the two
      // below are also owned by a LONGER prefix, so a broken '/' rule still
      // resolves them correctly and says nothing.
      expect(navIndexForLocation('/sign-in', chassisTabs()), isNot(0));
      expect(navIndexForLocation('/explore', chassisTabs()), 1);
      expect(navIndexForLocation('/settings', chassisTabs()), 2);
    });

    test('alsoOwns selects the owning tab for a screen that is not a tab', () {
      expect(navIndexForLocation('/manage-plan', chassisTabs()), 2);
    });

    test('the LONGEST owned prefix wins, in either declaration order', () {
      final List<NavTab> parentFirst = <NavTab>[
        tab('Settings', '/settings'),
        tab('Billing', '/settings/billing'),
      ];
      final List<NavTab> childFirst = <NavTab>[
        tab('Billing', '/settings/billing'),
        tab('Settings', '/settings'),
      ];
      expect(navIndexForLocation('/settings/billing', parentFirst), 1);
      expect(navIndexForLocation('/settings/billing', childFirst), 0);
    });

    test('a location no tab owns resolves to null', () {
      expect(navIndexForLocation('/sign-in', chassisTabs()), isNull);
    });
  });

  group('NavShell', () {
    Widget harness(String location, {List<String>? tapped}) => MaterialApp(
          home: NavShell(
            tabs: chassisTabs(tapped: tapped ?? <String>[]),
            currentLocation: location,
            child: const Center(child: Text('BRANCH')),
          ),
        );

    Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
      await tester.binding.setSurfaceSize(size);
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(w);
    }

    testWidgets('the routed child renders inside the shell chrome', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(400, 800), harness('/'));
      expect(find.text('BRANCH'), findsOneWidget);
      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('the selected destination follows the LOCATION', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(400, 800), harness('/settings'));
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        2,
      );
    });

    testWidgets('a location owned via alsoOwns keeps its tab selected', (
      WidgetTester tester,
    ) async {
      // The cancellation screen. Reaching it must not leave the bar looking
      // like the user is on Home — and it must not take the bar away either.
      await pumpAt(tester, const Size(400, 800), harness('/manage-plan'));
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        2,
      );
    });

    testWidgets('the same rule drives the RAIL, not just the bar', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(800, 800), harness('/manage-plan'));
      expect(
        tester
            .widget<NavigationRail>(find.byType(NavigationRail))
            .selectedIndex,
        2,
      );
    });

    testWidgets('tapping a destination calls THAT tab and navigates nothing', (
      WidgetTester tester,
    ) async {
      final List<String> tapped = <String>[];
      await pumpAt(tester, const Size(400, 800), harness('/', tapped: tapped));
      await tester.tap(find.text('Settings'));
      await tester.pump();
      expect(tapped, <String>['/settings']);
      // The shell did not move itself: selection is still derived from the
      // location it was given, which is what makes the router the one source of
      // truth about where the app is.
      expect(
        tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
        0,
      );
    });

    testWidgets('a location no tab owns renders BARE — no chrome at all', (
      WidgetTester tester,
    ) async {
      // 🔴 THIS IS THE AUTH-GATE INVARIANT, AND IT IS THE REASON THIS BRANCH
      // EXISTS. In the chassis every route lives inside ONE always-mounted
      // shell — measured: mounting the gates above the shell instead makes the
      // shell leave and re-enter the page stack, and go_router's one
      // `GlobalObjectKey` per ShellRoute then throws `Duplicate GlobalKey` on
      // the ordinary sign-in journey. So the shell BUILDS on `/sign-in`, and
      // this line is the only thing standing between a user at a gate and a
      // navigation bar that walks around it.
      await pumpAt(tester, const Size(400, 800), harness('/sign-in'));
      expect(find.text('BRANCH'), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(find.byType(AppScaffold), findsNothing);
    });

    testWidgets('bare at rail and drawer widths too, not just on a phone', (
      WidgetTester tester,
    ) async {
      // A width-dependent invariant is not an invariant. The rail is the arm a
      // 800px window gets, and a sign-in form with a rail beside it offers the
      // same way around the gate that a bottom bar does.
      await pumpAt(tester, const Size(800, 800), harness('/sign-in'));
      expect(find.byType(NavigationRail), findsNothing);
      await pumpAt(tester, const Size(1400, 900), harness('/sign-in'));
      expect(find.byType(NavigationDrawer), findsNothing);
    });
  });
}
