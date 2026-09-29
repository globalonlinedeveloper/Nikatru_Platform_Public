// THE FOUNDATION, PIXEL FOR PIXEL — train ST-D0.
//
// One gallery screen built ONLY from the foundation (the adaptive scaffold
// with a neutral badge, the FAB, a decision strip, a card of list rows with a
// status row, the skeleton, and the empty and failed states), photographed at
// one window per class — compact, medium, expanded, large — in light and in
// dark. Eight goldens under `test/goldens/`.
//
// Regenerate, after a DELIBERATE visual change only, from the repo root:
//   flutter test --update-goldens packages/design_system/test/foundation_golden_test.dart
// and review every PNG in the diff before committing it: a golden that is
// regenerated to make a red test green asserts nothing.
//
// ⚠️ LINUX ONLY, and that is a statement about the renderer, not a skip for
// convenience. The goldens are drawn with the test font on the CI runners'
// platform (ubuntu); glyph anti-aliasing differs on macOS and Windows by a few
// pixels, which would fail every comparison on a laptop for no defect at all.
// CI — the only gate — is Linux, so the comparison runs where it is enforced.

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

class _Gallery extends StatelessWidget {
  const _Gallery();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: <Widget>[
        DecisionStrip(
          kind: StatusKind.warn,
          message: 'Trial converts tomorrow',
          detail: '649 a month from 1 Oct',
          actions: <DecisionAction>[
            DecisionAction(label: 'Keep', onPressed: () {}),
            DecisionAction(label: 'Cancel', onPressed: () {}, primary: true),
          ],
        ),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              AppListRow(
                leading: const CircleAvatar(child: Text('N')),
                title: 'Netflix',
                subtitle: 'Renews in 2 days',
                status: StatusKind.warn,
                figure: '649',
                caption: 'per month',
                onTap: () {},
              ),
              const Divider(height: 1),
              AppListRow(
                leading: const CircleAvatar(child: Text('S')),
                title: 'Spotify',
                subtitle: 'Used this week',
                status: StatusKind.positive,
                figure: '119',
                caption: 'per month',
                onTap: () {},
              ),
              const Divider(height: 1),
              AppListRow(
                leading: const CircleAvatar(child: Text('G')),
                title: 'Gym',
                subtitle: 'Unused for 60 days',
                status: StatusKind.danger,
                figure: '1500',
                caption: 'per month',
                onTap: () {},
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        const AppCard(
          padding: EdgeInsets.zero,
          child: SkeletonList(label: 'Loading', rows: 2),
        ),
        const SizedBox(height: AppSpacing.lg),
        const AppCard(
          child: DataStateView.empty(
            title: 'Nothing here yet',
            body: 'Add one to start tracking',
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          child: DataStateView.failed(
            title: 'Could not load',
            retryLabel: 'Retry',
            onRetry: () {},
          ),
        ),
      ],
    );
  }
}

Future<void> _pumpGallery(
  WidgetTester tester,
  Size size,
  Brightness brightness,
) async {
  // Photographed at HALF density: the layout is decided in logical pixels,
  // so every window class lays out exactly as it does at 1x, and the eight
  // PNGs are a quarter of the pixels. They are layout goldens, not type
  // specimens — the text is the test font either way.
  tester.view.physicalSize = size * 0.5;
  tester.view.devicePixelRatio = 0.5;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(
        seed: const Color(0xFF6459F5),
        brightness: brightness,
      ),
      home: AppScaffold(
        destinations: const <AppDestination>[
          AppDestination(icon: Icons.home_outlined, label: 'Home'),
          AppDestination(
            icon: Icons.event_outlined,
            label: 'Calendar',
            badgeCount: 3,
          ),
          AppDestination(icon: Icons.insights_outlined, label: 'Insights'),
          AppDestination(icon: Icons.settings_outlined, label: 'Settings'),
        ],
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        floatingActionButton: AppFab(
          icon: Icons.add,
          label: 'Add',
          onPressed: () {},
        ),
        body: const _Gallery(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  const Map<String, Size> classes = <String, Size>{
    'compact': Size(390, 844),
    'medium': Size(700, 1000),
    'expanded': Size(1024, 900),
    'large': Size(1440, 900),
  };

  test('each photographed size is the class it is named for', () {
    expect(windowClassFor(classes['compact']!.width), WindowClass.compact);
    expect(windowClassFor(classes['medium']!.width), WindowClass.medium);
    expect(windowClassFor(classes['expanded']!.width), WindowClass.expanded);
    expect(windowClassFor(classes['large']!.width), WindowClass.large);
  });

  for (final MapEntry<String, Size> c in classes.entries) {
    for (final Brightness b in Brightness.values) {
      testWidgets('foundation · ${c.key} · ${b.name}', (
        WidgetTester tester,
      ) async {
        await _pumpGallery(tester, c.value, b);
        await expectLater(
          find.byType(MaterialApp),
          matchesGoldenFile('goldens/foundation_${c.key}_${b.name}.png'),
        );
      }, skip: !Platform.isLinux);
    }
  }
}
