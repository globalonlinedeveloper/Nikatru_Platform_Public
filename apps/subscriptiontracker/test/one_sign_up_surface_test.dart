// ─────────────────────────────────────────────────────────────────────────────
// ST-T1b (audit A-5) — ONE sign-up surface.
//
// `/sign-up` was a second, divergent registration form beside the sign-in
// door's own sign-up toggle — plain fields, no address check, no Apple or
// Google, and linked from nowhere. It now opens the SAME `LoginScreen`, on its
// sign-up arm, so there is one form, one clickwrap and one age gate, and the
// path the stamp declares still resolves.
//
// MUTATION PROOF: point `/sign-up` at any other screen and the first case goes
// red; drop `startInSignUp: true` from the route and it goes red on the heading.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations;
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/auth/legal_consent_fields.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart' show MemStore;

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

final AppLocalizations _en = lookupAppLocalizations(const Locale('en'));

String _heading(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(E2EKeys.loginHeading)).data!;

Future<ProviderContainer> _openSignUp(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      authRepositoryProvider.overrideWithValue(MockAuthRepository()),
      keyValueStoreProvider.overrideWith((ref) async => MemStore()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      ageSignalSourceProvider.overrideWithValue(
        core.ageSignalSourceFor(core.AgeSignalHost.other),
      ),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  c.read(routerProvider).go('/sign-up');
  await tester.pumpAndSettle();
  return c;
}

void main() {
  testWidgets('/sign-up opens the sign-in door, on its sign-up arm', (
    WidgetTester tester,
  ) async {
    await _openSignUp(tester);

    expect(
      find.byType(LoginScreen),
      findsOneWidget,
      reason:
          '/sign-up renders a second registration form beside the door the '
          'router sends every signed-out visitor to (audit A-5)',
    );
    expect(_heading(tester), _en.signUpTitle);
    // The arm's own parts: the clickwrap, and the way back to signing in.
    expect(find.byKey(LegalConsentFields.termsCheckbox), findsOneWidget);
    expect(find.text(_en.haveAccountPrompt), findsOneWidget);
  });

  testWidgets('it is the same form: its toggle turns it into sign-in', (
    WidgetTester tester,
  ) async {
    await _openSignUp(tester);

    await tester.ensureVisible(find.text(_en.haveAccountPrompt));
    await tester.tap(find.text(_en.haveAccountPrompt));
    await tester.pumpAndSettle();

    expect(_heading(tester), _en.welcomeFirstVisit);
    // Not the clickwrap: the sign-in arm shows it too, above the provider
    // buttons, while this device owes the terms.
    expect(find.text(_en.signIn), findsOneWidget);
    expect(find.text(_en.forgotPasswordShort), findsOneWidget);
  });
}
