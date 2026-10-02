// The app shell carries the e-mail-change sign-out (ADR 059 decision 2,
// clause 3) — review 3 of #1129, finding 3.
//
// 🔴 RED CONTROL: drop `EmailChangeSignOut(` from `AppShell.build` and both
// cases fail. Until this file, the only test wrapped the settings screen in
// the widget ITSELF, so a merge that kept main's side of `app_shell.dart` could
// silently remove the clause with every test green.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/router.dart';
import 'package:subscriptiontracker/features/account/email_change_sign_out.dart';
import 'package:subscriptiontracker/features/shell/app_shell.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/analytics_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/user_state_fakes.dart';
import 'support/width_harness.dart' show MemStore;

class _Auth extends core.AuthRepository {
  String email = 'ada@test.dev';
  bool signedIn = true;
  final List<core.SignOutScope> scopes = <core.SignOutScope>[];
  final StreamController<core.AuthUser?> changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => signedIn
      ? core.AuthUser(id: 'u1', email: email, emailVerified: true)
      : null;

  @override
  Stream<core.AuthUser?> authStateChanges() => changes.stream;

  @override
  Future<String?> currentAccessToken() async => null;

  @override
  Future<void> signOut({
    core.SignOutScope scope = core.SignOutScope.local,
  }) async {
    scopes.add(scope);
    signedIn = false;
    changes.add(null);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _OnboardingSeen extends OnboardingSeenController {
  @override
  bool? build() => true;
}

Future<ProviderContainer> _pumpApp(WidgetTester tester, _Auth auth) async {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      onboardingSeenProvider.overrideWith(_OnboardingSeen.new),
      legalReacceptanceNeededProvider.overrideWithValue(false),
      authRepositoryProvider.overrideWithValue(auth),
      keyValueStoreProvider.overrideWith((ref) async => MemStore()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      secureStoreProvider.overrideWithValue(MemSecureStore()),
      notificationServiceProvider.overrideWithValue(FakeNotifications()),
      renewalRemindersProvider.overrideWithValue(RecordingSublyNotifications()),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        theme: buildAppTheme(seed: const Color(0xFF6459F5)),
        routerConfig: c.read(routerProvider),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return c;
}

void main() {
  testWidgets('🔴 the shell carries EmailChangeSignOut', (
    WidgetTester tester,
  ) async {
    await _pumpApp(tester, _Auth());
    expect(find.byType(AppShell), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(AppShell),
        matching: find.byType(EmailChangeSignOut),
      ),
      findsOneWidget,
      reason: 'ADR 059 decision 2 clause 3 is not wired into the app',
    );
  });

  testWidgets(
    '🔴 in the REAL shell, the same account under a new address signs out '
    'everywhere',
    (WidgetTester tester) async {
      final _Auth auth = _Auth();
      final ProviderContainer c = await _pumpApp(tester, auth);
      auth.email = 'new@test.dev';
      auth.changes.add(auth.currentUser);
      await tester.pumpAndSettle();
      expect(auth.scopes, <core.SignOutScope>[core.SignOutScope.global]);
      expect(
        c.read(emailChangeSignedOutProvider),
        EmailChangeSignOutNotice.everywhere,
      );
    },
  );
}
