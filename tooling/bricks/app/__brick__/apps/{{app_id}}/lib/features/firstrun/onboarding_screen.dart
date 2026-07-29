import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../l10n/app_localizations.dart';
import '../../state/providers.dart';

/// First-run onboarding — [pipeline C-13].
///
/// 🔴 THE REFUSAL THIS REPLACES was "the content is app-specific", which is true
/// of the WORDS and false of the MECHANISM. `AppConfig.copy` is a runtime
/// copy-override map that already existed, so the carousel is CHASSIS and the
/// words are per-app config. Every stamped app gets a working first run without
/// writing one, and an app that has something better to say overrides three
/// strings in its config — no code, no release.
///
/// ⚠️ THE SPLASH HALF IS NOT HERE AND IS NOT COMING. A splash screen is native
/// platform configuration (a launch storyboard on iOS, a launch drawable on
/// Android); a Dart one renders AFTER the native splash has already been shown
/// and therefore adds a SECOND flash rather than removing the first. That
/// refusal survived checking and stands.
///
/// 🔴 FALLS BACK TO l10n, NEVER TO THE KEY. `AppConfig.text(key)` returns the
/// KEY ITSELF when there is no override — by design, and exactly wrong here: a
/// freshly stamped app has no overrides, so a purely config-driven carousel
/// would greet its first user with `onboarding.1.title`. The l10n string is the
/// default and the config is the override, which is also what makes the
/// carousel translatable in an app that never touches its config.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final PageController _pages = PageController();
  int _index = 0;

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

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
    final AppLocalizations l10n = AppLocalizations.of(context);
    final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;

    final List<({String title, String body})> pages =
        <({String title, String body})>[
          (
            title: _copy(cfg, 'onboarding.1.title', l10n.onboarding1Title),
            body: _copy(cfg, 'onboarding.1.body', l10n.onboarding1Body),
          ),
          (
            title: _copy(cfg, 'onboarding.2.title', l10n.onboarding2Title),
            body: _copy(cfg, 'onboarding.2.body', l10n.onboarding2Body),
          ),
          (
            title: _copy(cfg, 'onboarding.3.title', l10n.onboarding3Title),
            body: _copy(cfg, 'onboarding.3.body', l10n.onboarding3Body),
          ),
        ];
    final bool isLast = _index == pages.length - 1;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: <Widget>[
            // SKIP is present on every page and equally reachable. An
            // onboarding a user cannot leave is a wall, not an introduction —
            // and both stores treat an unskippable first run as a dark pattern.
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _finish,
                child: Text(l10n.onboardingSkip),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: pages.length,
                onPageChanged: (int i) => setState(() => _index = i),
                itemBuilder: (BuildContext context, int i) => Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: <Widget>[
                      Text(
                        pages[i].title,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        pages[i].body,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ],
                  ),
                ),
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                for (int i = 0; i < pages.length; i++)
                  Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(
                      i == _index ? Icons.circle : Icons.circle_outlined,
                      size: 10,
                      semanticLabel: null,
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: isLast
                      ? _finish
                      : () => _pages.nextPage(
                          duration: const Duration(milliseconds: 250),
                          curve: Curves.easeOut,
                        ),
                  child: Text(
                    isLast ? l10n.onboardingStart : l10n.onboardingNext,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
