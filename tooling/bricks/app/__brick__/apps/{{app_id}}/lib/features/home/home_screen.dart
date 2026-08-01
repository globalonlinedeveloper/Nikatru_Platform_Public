import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../core/app_config.dart';
import '../../l10n/app_localizations.dart';

/// Home shell for {{{display_name}}}, built on the design-system [AppScaffold]
/// (adaptive NavigationBar -> Rail -> Drawer) and brand tokens.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;

  // NOT static const: labels are localised, so they need a BuildContext.
  // [pipeline C-12] A const list cannot read l10n, and an unlocalised nav bar is
  // the most visible untranslated surface in the app.
  List<AppDestination> _destinations(AppLocalizations l10n) => <AppDestination>[
    AppDestination(
      icon: Icons.home_outlined,
      selectedIcon: Icons.home,
      label: l10n.navHome,
    ),
    AppDestination(
      icon: Icons.explore_outlined,
      selectedIcon: Icons.explore,
      label: l10n.navExplore,
    ),
    AppDestination(
      icon: Icons.settings_outlined,
      selectedIcon: Icons.settings,
      label: l10n.navSettings,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final AppThemeX tokens = Theme.of(context).extension<AppThemeX>()!;
    final AppLocalizations l10n = AppLocalizations.of(context);
    return AppScaffold(
      title: const Text(AppConfig.appName),
      destinations: _destinations(l10n),
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
            Text(l10n.welcomeTo(AppConfig.appName), style: AppText.title),
            const SizedBox(height: AppSpacing.xs),
            Text(l10n.homeTagline, style: AppText.muted),
          ],
        ),
      ),
    );
  }
}
