import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

void main() {
  const List<AppDestination> destinations = <AppDestination>[
    AppDestination(
        icon: Icons.home_outlined, selectedIcon: Icons.home, label: 'Home'),
    AppDestination(
        icon: Icons.pie_chart_outline,
        selectedIcon: Icons.pie_chart,
        label: 'Budget'),
    AppDestination(
        icon: Icons.settings_outlined,
        selectedIcon: Icons.settings,
        label: 'Settings'),
  ];

  Widget harness({int index = 0, ValueChanged<int>? onSelected}) {
    return MaterialApp(
      home: AppScaffold(
        destinations: destinations,
        selectedIndex: index,
        onDestinationSelected: onSelected ?? (_) {},
        body: const Center(child: Text('BODY')),
      ),
    );
  }

  Future<void> pumpAt(WidgetTester tester, Size size, Widget w) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(w);
  }

  testWidgets('compact width → NavigationBar only',
      (WidgetTester tester) async {
    await pumpAt(tester, const Size(400, 800), harness());
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);
    expect(find.byType(NavigationDrawer), findsNothing);
    expect(find.text('BODY'), findsOneWidget);
  });

  testWidgets('medium width → NavigationRail only',
      (WidgetTester tester) async {
    await pumpAt(tester, const Size(800, 800), harness(index: 1));
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byType(NavigationDrawer), findsNothing);
  });

  testWidgets('expanded width → extended NavigationRail',
      (WidgetTester tester) async {
    await pumpAt(tester, const Size(1000, 900), harness(index: 2));
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(tester.widget<NavigationRail>(find.byType(NavigationRail)).extended,
        isTrue);
    expect(find.byType(NavigationDrawer), findsNothing);
  });

  testWidgets('large width → NavigationDrawer only',
      (WidgetTester tester) async {
    await pumpAt(tester, const Size(1300, 900), harness(index: 2));
    expect(find.byType(NavigationDrawer), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.byType(NavigationRail), findsNothing);
  });

  // ── [pipeline C-14] The five Material window classes, AT THEIR EDGES ───────
  // `medium` was 640, which is not a Material breakpoint. Every window from 600
  // to 639 logical pixels got the PHONE layout — a bottom bar on a device wide
  // enough for a rail. A test at 400 / 800 / 1300 could never have caught that,
  // because none of those widths is near the boundary that was wrong. Edges are
  // where off-by-40 lives.
  group('window classes at Material 600/840/1200/1600', () {
    test('every boundary resolves on the correct side', () {
      expect(windowClassFor(599), WindowClass.compact);
      expect(windowClassFor(600), WindowClass.medium); // ← the 640 bug
      expect(windowClassFor(639), WindowClass.medium); // ← was compact before
      expect(windowClassFor(839), WindowClass.medium);
      expect(windowClassFor(840), WindowClass.expanded);
      expect(windowClassFor(1199), WindowClass.expanded);
      expect(windowClassFor(1200), WindowClass.large);
      expect(windowClassFor(1599), WindowClass.large);
      expect(windowClassFor(1600), WindowClass.extraLarge);
    });

    test('all five classes are reachable', () {
      // A class no width maps to is a number in a document, not a layout.
      expect(
        <double>[320, 700, 900, 1400, 2000].map(windowClassFor).toSet(),
        hasLength(5),
      );
    });

    testWidgets('600px gets a rail, not a phone bar',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(600, 800), harness());
      expect(
        find.byType(NavigationRail),
        findsOneWidget,
        reason: 'this is the exact width the 640 breakpoint got wrong',
      );
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets('extra-large caps the body width', (WidgetTester tester) async {
      await pumpAt(tester, const Size(2000, 900), harness());
      expect(find.byType(NavigationDrawer), findsOneWidget);
      // The distinction from `large` must be REAL, or the fifth class is
      // decorative: past 1600 the body stops growing, because a paragraph
      // 1400px wide is genuinely hard to read.
      expect(tester.getSize(find.text('BODY')).width,
          lessThanOrEqualTo(AppBreakpoints.kMaxBodyWidth));
    });
  });

  // ── The compact-only branding seam ────────────────────────────────────────
  //
  // ⚠️ THE SURFACE IS PINNED IN EVERY ONE OF THESE. `flutter_test`'s default
  // 800×600 resolves to `medium` — a RAIL — so a test that forgot to pin would
  // be asserting about the wrong window class entirely, and "the custom bar is
  // absent" would pass without the seam being scoped at all.
  group('compactNavigationBar replaces the bar in COMPACT only', () {
    const Key brandBar = Key('brand-bar');

    Widget branded({int index = 0}) => MaterialApp(
          home: AppScaffold(
            destinations: destinations,
            selectedIndex: index,
            onDestinationSelected: (_) {},
            body: const Center(child: Text('BODY')),
            compactNavigationBar: const SizedBox(
              key: brandBar,
              height: 64,
              child: Center(child: Text('BRAND')),
            ),
          ),
        );

    testWidgets('375 (compact) shows the app’s bar and NOT the stock one',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(375, 812), branded());
      expect(find.byKey(brandBar), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing,
          reason: 'it REPLACES the stock bar; two bottom bars is not a seam');
      expect(find.text('BODY'), findsOneWidget);
    });

    testWidgets('768 (medium) shows the rail and NOT the app’s bar',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(768, 1024), branded());
      expect(
        find.byKey(brandBar),
        findsNothing,
        reason: 'rail and drawer stay chassis-owned — an app that could put a '
            'bottom bar at 768 (or 1600) would be re-introducing the exact '
            'layout the five window classes exist to prevent',
      );
      expect(find.byType(NavigationRail), findsOneWidget);
    });

    testWidgets('1600 (extra-large) shows the drawer and NOT the app’s bar',
        (WidgetTester tester) async {
      await pumpAt(tester, const Size(1600, 900), branded());
      expect(find.byKey(brandBar), findsNothing);
      expect(find.byType(NavigationDrawer), findsOneWidget);
    });

    testWidgets('omitting it keeps the stock NavigationBar',
        (WidgetTester tester) async {
      // The default must cost nothing to ignore, or every existing caller is a
      // silent behaviour change.
      await pumpAt(tester, const Size(375, 812), harness());
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byKey(brandBar), findsNothing);
    });
  });

  testWidgets('tapping a destination reports its index',
      (WidgetTester tester) async {
    int? tapped;
    await pumpAt(tester, const Size(400, 800),
        harness(onSelected: (int i) => tapped = i));
    await tester.tap(find.text('Settings'));
    await tester.pump();
    expect(tapped, 2);
  });

  testWidgets('renders an app bar title when provided',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      MaterialApp(
        home: AppScaffold(
          destinations: destinations,
          selectedIndex: 0,
          onDestinationSelected: (_) {},
          title: const Text('Subly'),
          body: const SizedBox.shrink(),
        ),
      ),
    );
    expect(find.widgetWithText(AppBar, 'Subly'), findsOneWidget);
  });
}
