import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemNavigator;
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// ⏱ 2026-10-01 · THE MODIFIED-COPY SCREEN (row O-APPS-GOV-IN-VAPT-CHECKLIST).
///
/// Shown INSTEAD OF the app when the runtime signature check finds a signer
/// that is not one of the channel's complete pins
/// (`core.DeviceIntegrity.blocksDataAccess`). It is the whole app, not a route
/// inside it: [TamperedBuildApp] is what `runApp` gets, so no provider, no
/// identity initialisation and no store is ever built — there is no data access
/// to leak, because nothing that could reach the data exists.
///
/// NON-DISMISSABLE: no back (a [PopScope] that never pops), no close, no
/// "continue anyway". The one action is leaving the app.
class TamperedBuildScreen extends StatelessWidget {
  const TamperedBuildScreen({this.onExit = SystemNavigator.pop, super.key});

  /// Leaves the app. A parameter so a test can see it called.
  final Future<void> Function() onExit;

  /// The exit button, for tests.
  static const Key exitButton = ValueKey<String>('tampered-build-exit');

  @override
  Widget build(BuildContext context) {
    final ChassisLocalizations l10n = context.chassisL10n;
    final ThemeData theme = Theme.of(context);
    return PopScope(
      canPop: false,
      child: Scaffold(
        body: SafeArea(
          child: ContentPane.form(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Icon(
                  Icons.gpp_bad_outlined,
                  size: 48,
                  color: theme.colorScheme.error,
                ),
                const SizedBox(height: 16),
                Semantics(
                  header: true,
                  child: Text(
                    l10n.tamperedBuildTitle,
                    style: theme.textTheme.titleLarge,
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  l10n.tamperedBuildMessage,
                  style: theme.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  key: exitButton,
                  onPressed: onExit,
                  child: Text(l10n.tamperedBuildExit),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The app a re-signed copy runs: [TamperedBuildScreen], themed and localised,
/// and nothing else.
///
/// The seed is a NEUTRAL grey on purpose: a copy someone else re-signed is not
/// a surface any product's brand belongs on.
class TamperedBuildApp extends StatelessWidget {
  const TamperedBuildApp({super.key});

  static const Color _neutralSeed = Color(0xFF5F6368);

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildAppTheme(seed: _neutralSeed),
    darkTheme: buildAppTheme(seed: _neutralSeed, brightness: Brightness.dark),
    localizationsDelegates: ChassisLocalizations.localizationsDelegates,
    supportedLocales: ChassisLocalizations.supportedLocales,
    home: const TamperedBuildScreen(),
  );
}
