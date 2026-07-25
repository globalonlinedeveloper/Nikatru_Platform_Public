import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/app_config.dart';

/// Home shell for {{display_name}}, built on the design-system [AppScaffold]
/// (adaptive NavigationBar -> Rail -> Drawer) and brand tokens.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  static const List<AppDestination> _destinations = <AppDestination>[
    AppDestination(
      icon: Icons.home_outlined,
      selectedIcon: Icons.home,
      label: 'Home',
    ),
    AppDestination(
      icon: Icons.explore_outlined,
      selectedIcon: Icons.explore,
      label: 'Explore',
    ),
    AppDestination(
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: 'Settings',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final AppThemeX tokens = Theme.of(context).extension<AppThemeX>()!;
    return AppScaffold(
      title: const Text(AppConfig.appName),
      destinations: _destinations,
      selectedIndex: _index,
      onDestinationSelected: (int i) => setState(() => _index = i),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                gradient: tokens.brandGradient,
                borderRadius: BorderRadius.circular(AppRadius.lg),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text('Welcome to ${AppConfig.appName}', style: AppText.title),
            const SizedBox(height: AppSpacing.xs),
            const Text(
              'Stamped from the NIKATRU app brick.',
              style: AppText.muted,
            ),
          ],
        ),
      ),
    );
  }
}
