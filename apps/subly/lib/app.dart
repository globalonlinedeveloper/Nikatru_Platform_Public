import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/config/app_config.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';
import 'state/analytics_funnel.dart';
import 'state/providers.dart';

class SublyApp extends ConsumerStatefulWidget {
  const SublyApp({super.key});

  @override
  ConsumerState<SublyApp> createState() => _SublyAppState();
}

class _SublyAppState extends ConsumerState<SublyApp> {
  bool _launchLogged = false;

  @override
  Widget build(BuildContext context) {
    // Start the CFG-1 runtime-config load at launch. Offline-safe (falls back
    // to compiled-in defaults) and hermetic in demo/test builds, so first
    // paint never blocks on the network.
    ref.watch(appConfigProvider);

    // G-12 launch funnel: first_launch / app_open / return_visit. Fired ONCE
    // per process, off the build phase, and never awaited — the funnel resolves
    // asynchronously and first paint must not wait on storage. In demo/test
    // builds analytics is a no-op, so this costs nothing there.
    if (!_launchLogged) {
      final AnalyticsFunnel? funnel = ref
          .watch(analyticsFunnelProvider)
          .valueOrNull;
      if (funnel != null) {
        _launchLogged = true;
        funnel.onLaunch();
      }
    }

    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
    );
  }
}
