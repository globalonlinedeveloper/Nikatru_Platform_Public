import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'core/app_config.dart';
import 'core/router.dart';
import 'core/theme/app_theme.dart';
import 'features/consent/consent_prompt.dart';
import 'state/analytics_funnel.dart';
import 'state/analytics_providers.dart';
import 'state/notification_tap_observer.dart';
import 'state/providers.dart';

class SublyApp extends ConsumerStatefulWidget {
  const SublyApp({super.key});

  @override
  ConsumerState<SublyApp> createState() => _SublyAppState();
}

class _SublyAppState extends ConsumerState<SublyApp> {
  bool _launchLogged = false;

  /// [13]T-9 — the tap→`notification_opened` subscription, held so it can be
  /// cancelled. Null until consent is granted and the funnel has resolved.
  NotificationTapObserver? _taps;

  @override
  void dispose() {
    _taps?.stop();
    super.dispose();
  }

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
    //
    // 🔴 GATED ON GRANTED CONSENT, and that is a correctness fix, not caution.
    // `onLaunch()` writes a "first launch already done" flag to storage after
    // logging. Firing it before the user has answered meant `first_launch` was
    // discarded by the fail-closed recorder AND the flag was burned — so the
    // event could never fire again on that install, even after consent was
    // granted. The single most important denominator in the funnel was being
    // permanently destroyed on every install. Only observe once permitted.
    if (!_launchLogged &&
        ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted) {
      final AnalyticsFunnel? funnel = ref
          .watch(analyticsFunnelProvider)
          .valueOrNull;
      if (funnel != null) {
        _launchLogged = true;
        funnel.onLaunch();

        // [13]T-9. Same consent gate, same reason: `notification_opened` is an
        // observation about a person and must not be recorded before they have
        // said yes. Started here rather than in `main()` because the funnel is
        // what a tap has to reach, and the funnel resolves asynchronously —
        // subscribing earlier would mean holding taps for an object that does
        // not exist yet.
        //
        // `start()` is idempotent and this branch is one-shot on `_launchLogged`,
        // so a rebuild cannot stack subscriptions and double-log a tap.
        (_taps ??= NotificationTapObserver(
          service: ref.read(notificationTapSourceProvider),
          funnel: funnel,
        )).start();
      }
    }

    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: router,
      // NOTE: the builder's widget is inserted ABOVE the router's Navigator
      // (the Navigator lives inside `child`), so the gate itself cannot host
      // a dialog — its prompt borrows the root Navigator's context via
      // `rootNavigatorKey` (see consent_prompt.dart). This comment used to
      // claim the opposite, and that wrong belief shipped a consent prompt
      // that could never appear.
      builder: (BuildContext context, Widget? child) =>
          ConsentGate(child: child ?? const SizedBox.shrink()),
    );
  }
}
