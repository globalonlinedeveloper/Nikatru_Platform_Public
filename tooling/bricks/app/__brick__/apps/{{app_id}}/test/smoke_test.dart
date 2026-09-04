import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:{{app_id.snakeCase()}}/l10n/app_localizations.dart';
import 'package:{{app_id.snakeCase()}}/features/home/home_screen.dart';

void main() {
  testWidgets('home renders on the design-system AppScaffold', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          // [pipeline C-12] HomeScreen reads its copy from l10n now, so a bare
          // MaterialApp has no Localizations for it to find. Supplying the
          // delegates here is what a real app does anyway.
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          // [pipeline C-11] The stamped seed, not a default. `buildAppTheme`
          // requires it now: the old default was Subly's colour, so a bare
          // call silently rendered another product's brand.
          theme: buildAppTheme(seed: const Color(0xFF{{{seed_hex}}})),
          // 🔴 THE CHROME IS THE SHELL'S, NOT THE SCREEN'S, AND THAT IS THE
          // CHANGE THIS LINE RECORDS. `HomeScreen` used to build the
          // `AppScaffold` itself, which is exactly why every stamped app's
          // Settings and Manage-plan were dead ends: the nav bar lived inside
          // the home route, so navigating away destroyed it. It now lives in
          // `AppShell`, mounted once by the `ShellRoute` above every route, and
          // this test pumps the same pairing by hand — shell wrapping screen —
          // so it still asserts that a stamped app's home surface arrives with
          // the design-system chrome around it rather than none.
          home: const AppShell(location: '/', child: HomeScreen()),
        ),
      ),
    );
    expect(find.byType(AppScaffold), findsOneWidget);
    expect(find.textContaining('Welcome to'), findsOneWidget);
  });
}
