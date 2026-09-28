import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';

import '../../state/providers.dart';

/// First-run onboarding — the ADAPTER half ([pipeline C-13]).
///
/// 🏗️ THE CAROUSEL IS IN `package:nikatru_chassis_screens` ([ADR 067]
/// decision 2). Two things stayed here:
///
/// ⛔ `onboardingSeenProvider`, which is Riverpod — see the chassis package's
/// pubspec for why it declares none.
///
/// 🔴 FALLS BACK TO l10n, NEVER TO THE KEY, AND THAT READ STAYS HERE.
/// `AppConfig.text(key)` returned the KEY ITSELF when there was no override —
/// exactly wrong here, because a freshly stamped app has no overrides and would
/// greet its first user with `onboarding.1.title`. The l10n string is the
/// default and the config is the override, which is also what makes the carousel
/// translatable in an app that never touches its config. Both
/// `assert-config-registry.mjs` (the `copy[` limb, `:947-990`) and
/// `assert-stamp-properties.mjs:1094` anchor that idiom in THIS file.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  /// The app's override for [key], or the chassis default.
  ///
  /// Empty is treated as absent: a config that ships `""` is a config somebody
  /// half-edited, and showing a blank page is worse than showing the default.
  String _copy(core.AppConfig? cfg, String key, String fallback) {
    final String? override = cfg?.copy[key];
    return (override == null || override.trim().isEmpty) ? fallback : override;
  }

  Future<void> _finish() async {
    // The flag is set BEFORE navigating, and the controller applies it in memory
    // first — so the router's redirect sees `seen` and does not bounce the user
    // straight back here.
    await ref.read(onboardingSeenProvider.notifier).set(true);
    if (!mounted) return;
    // Onboarding navigates itself, unlike the auth screens. The difference is
    // real: the auth redirect and the sign-in screen were both trying to move
    // the user, which is how two routes end up racing. Here the guard only ever
    // sends the user TO onboarding, and this is the one place that leaves.
    //
    // `go`, not `pop`: onboarding is usually the FIRST route, reached by
    // redirect, so there is nothing beneath it to pop back to.
    context.go('/');
  }

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final core.AppConfig? cfg = ref.watch(appConfigProvider).value;

    return OnboardingView(
      onFinish: _finish,
      pages: <OnboardingPage>[
        OnboardingPage(
          title: _copy(cfg, 'onboarding.1.title', l10n.onboarding1Title),
          body: _copy(cfg, 'onboarding.1.body', l10n.onboarding1Body),
        ),
        OnboardingPage(
          title: _copy(cfg, 'onboarding.2.title', l10n.onboarding2Title),
          body: _copy(cfg, 'onboarding.2.body', l10n.onboarding2Body),
        ),
        OnboardingPage(
          title: _copy(cfg, 'onboarding.3.title', l10n.onboarding3Title),
          body: _copy(cfg, 'onboarding.3.body', l10n.onboarding3Body),
        ),
      ],
    );
  }
}
