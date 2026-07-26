import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:url_launcher/url_launcher.dart';

import 'core/app_config.dart';
import 'core/router.dart';
import 'l10n/app_localizations.dart';
import 'state/providers.dart';

/// Root widget for {{display_name}}.
class {{app_id.pascalCase()}}App extends ConsumerWidget {
  const {{app_id.pascalCase()}}App({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    // CFG-1 force-update kill-switch: blocks the app when the running version is
    // below the resolved min_supported_version. Watching this resolves the config
    // at launch too; it fails open while config/version load (never blocks the UI).
    final bool mustUpdate = ref.watch(mustForceUpdateProvider);
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: buildAppTheme(seed: const Color(0xFF{{{seed_hex}}})),
      darkTheme: buildAppTheme(
        seed: const Color(0xFF{{{seed_hex}}}),
        brightness: Brightness.dark,
      ),
      // [pipeline C-16] The persisted user override. Without this MaterialApp
      // silently defaults to ThemeMode.system, which follows the OS but gives the
      // user no say — and `test/chassis_properties_test.dart` asserts all THREE
      // of theme/darkTheme/themeMode are supplied, so deleting this line fails
      // the build of every stamped app, not just this one.
      themeMode: ref.watch(themeModeProvider),
      routerConfig: router,
      builder: (BuildContext context, Widget? child) => ForceUpdateGate(
        mustUpdate: mustUpdate,
        onUpdate: _openUpdate,
        child: child ?? const SizedBox.shrink(),
      ),
    );
  }

  Future<void> _openUpdate() async {
    final Uri uri = Uri.parse(AppConfig.updateUrl);
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — never crash the update screen.
    }
  }
}
