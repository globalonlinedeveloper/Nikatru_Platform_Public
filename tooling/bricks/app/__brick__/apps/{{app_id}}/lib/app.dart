import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
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
        child: AnalyticsGate(child: child ?? const SizedBox.shrink()),
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

/// 🔑 THE ON-SWITCH FOR THE ENTIRE ANALYTICS RAIL ([pipeline C-6] / stage 11).
///
/// The recorder, the transport, the platform Worker and the D1 table are all
/// fail-closed: with no consent artifact they discard, and discarding is the
/// CORRECT behaviour, so nothing goes red. That is how the rail sat dead in
/// apps/subly for months while every test passed. This widget is the one place
/// that turns it on, and `tooling/ci/assert-seams-wired.mjs` asserts a non-test
/// caller of `recordAnalyticsConsent` exists precisely so deleting it fails the
/// build instead of quietly silencing every stamped app.
///
/// It does three things and each is load-bearing:
///  1. asks the consent question, once, when it has never been answered;
///  2. logs `app_open` — but ONLY once consent is granted, so the funnel's own
///     denominator is never the event that gets collected without permission;
///  3. flushes on background. The recorder batches at 20 events, so an app that
///     logs a handful per session would otherwise ship NOTHING until the
///     twentieth event — a rail that looks wired and delivers nothing.
class AnalyticsGate extends ConsumerStatefulWidget {
  const AnalyticsGate({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<AnalyticsGate> createState() => _AnalyticsGateState();
}

class _AnalyticsGateState extends ConsumerState<AnalyticsGate>
    with WidgetsBindingObserver {
  bool _launchLogged = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached ||
        state == AppLifecycleState.hidden) {
      // Fire-and-forget: the framework will not wait, and a failed send just
      // leaves the batch queued for next launch.
      ref.read(analyticsProvider).valueOrNull?.flush();
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool enabled = ref.watch(analyticsEnabledProvider);
    final bool decided = ref.watch(consentDecidedProvider);

    if (enabled &&
        !_launchLogged &&
        ref.watch(analyticsConsentProvider) == core.ConsentStatus.granted) {
      _launchLogged = true;
      logEvent(ref, 'app_open');
    }

    // Rendered INLINE rather than via showDialog: this gate sits in
    // MaterialApp's `builder`, which is ABOVE the router's Navigator, so
    // `showDialog` here has no Navigator to push onto. An inline scrim also
    // disappears reactively the moment the decision is recorded, with no
    // post-frame callback and no "did I already ask?" bookkeeping to get wrong.
    return Stack(
      children: <Widget>[
        widget.child,
        if (enabled && !decided) const _ConsentPrompt(),
      ],
    );
  }
}

/// The consent question. Deliberately plain Material so a stamped app owes the
/// design system nothing for it — restyle freely, but keep BOTH answers equally
/// prominent (see below).
class _ConsentPrompt extends ConsumerWidget {
  const _ConsentPrompt();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ThemeData theme = Theme.of(context);
    return Positioned.fill(
      child: ColoredBox(
        color: Colors.black54,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Material(
                color: theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(20),
                child: Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Help improve ${AppConfig.appName}?',
                        style: theme.textTheme.titleLarge,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'We can record which features you use, so we can see '
                        'what works and fix what does not.',
                        style: theme.textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'No name, no email, no advertising ID and no IP '
                        'address — just a random code for this installation.',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 16),
                      // Both answers get the same size and weight ON PURPOSE. A
                      // prominent "Allow" beside a faint "No thanks" is the dark
                      // pattern consent rules exist to stop, and it also poisons
                      // the data with pressured yeses.
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () => _answer(ref, granted: false),
                              child: const Text('No thanks'),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: () => _answer(ref, granted: true),
                              child: const Text('Allow'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _answer(WidgetRef ref, {required bool granted}) {
    // Not awaited: the decision applies in memory immediately and the upload is
    // best-effort, so blocking the button on a network round trip would only
    // make a declined choice feel like a broken one.
    recordAnalyticsConsent(ref, granted: granted);
  }
}
