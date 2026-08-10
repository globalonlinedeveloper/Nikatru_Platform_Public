// P2.6b RETARGET — a retarget, not a weakening, stated with the line numbers:
// the stamped smoke_test pumped `const HomeScreen()` alone and asserted
// `find.byType(AppScaffold)` on it, because in the STAMPED shape HomeScreen
// owned the adaptive scaffold. Variant B (P2.6a docking, session notes
// 2026-08-08) moved scaffold ownership to `AppShell` via the
// `compactNavigationBar` seam — HomeScreen is branch 0's BODY now. The
// property under test is UNCHANGED: home is rendered INSIDE the design-system
// scaffold, not on a hand-rolled one. It is simply true of a different widget,
// so the second test below pumps the real router (the shell route) instead of
// the bare screen. The 'Welcome to' copy assertion keeps its original target:
// the dashboard header's signed-out fallback renders `l10n.welcomeTo(...)`.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subly/core/router.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/analytics_providers.dart';
import 'package:subly/state/providers.dart';

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Signed in and stable — this smoke test asserts layout ownership, not auth
/// behaviour, so the auth surface is the smallest thing that keeps the
/// router's signed-out redirect from bouncing us off /home.
class _SignedInAuth extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(
    id: 'smoke',
    email: 'smoke@test.dev',
    emailVerified: true,
  );

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  // Anything else being called means this stopped being a smoke test.
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The union router's onboarding gate declines to decide while the seen-flag
/// hydrates (null) — a pump that never answers stalls pre-frame (red-team
/// prediction, observed in P2.6a). Same override the three router tests use.
class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

void main() {
  testWidgets('home body renders the product with the welcome fallback', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          theme: buildAppTheme(seed: const Color(0xFF6459F5)),
          home: const Scaffold(body: HomeScreen()),
        ),
      ),
    );
    // Seed data resolves asynchronously; two frames is enough for the header.
    await tester.pump(const Duration(milliseconds: 50));
    expect(find.textContaining('Welcome to'), findsOneWidget);
  });

  testWidgets(
    'home renders INSIDE the design-system AppScaffold — via the shell',
    (WidgetTester tester) async {
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
          // This user has accepted the current terms. Stated, not defaulted: a
          // signed-in user with no acceptance on record is sent to /reaccept-terms
          // by the router, which is correct and is what every pre-clickwrap install
          // sees once. The gate itself is driven in legal_gates_test.dart.
          legalReacceptanceNeededProvider.overrideWithValue(false),
          authRepositoryProvider.overrideWithValue(_SignedInAuth()),
          keyValueStoreProvider.overrideWith((ref) async => _MemStore()),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp.router(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            theme: buildAppTheme(seed: const Color(0xFF6459F5)),
            routerConfig: container.read(routerProvider),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Exactly one: the shell's. A second AppScaffold anywhere would mean a
      // screen re-grew its own shell — the two-navigation-surfaces defect the
      // Variant B decision exists to prevent.
      expect(find.byType(AppScaffold), findsOneWidget);
      expect(find.byType(HomeScreen), findsOneWidget);
    },
  );
}
