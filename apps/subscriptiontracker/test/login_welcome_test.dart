// ─────────────────────────────────────────────────────────────────────────────
// ST-T1b (audit A-7) — "Welcome" on a first visit, "Welcome back" after.
//
// Login is mandatory, so the sign-in door is the first screen a new visitor
// sees — and it greeted every one of them "Welcome back". The door now reads
// `signedInBeforeProvider`: a per-DEVICE flag that a keeper (kept alive by
// `routerProvider`) sets the moment a session is seen; sign-out never clears it.
//
// The heading is found by `E2EKeys.loginHeading` everywhere else (the nightly
// E2E, the store capture, the unit suites). This file is the one place that
// reads the WORDS, because the words are its subject.
//
// MUTATION PROOF: render `welcomeBack` unconditionally and the first case goes
// red; drop `ref.watch(signedInBeforeKeeperProvider)` from
// lib/core/router/router_provider.dart and the third does.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/app.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/user_state_fakes.dart';
import 'support/width_harness.dart';

const String _flag = 'nikatru.signed_in_before';

/// The heading, by its key AND its words — the key says it is the door's
/// heading, the words are what this file is about.
Finder _heading(String words) => find.byWidgetPredicate(
  (Widget w) => w is Text && w.key == E2EKeys.loginHeading && w.data == words,
);

void main() {
  testWidgets('a device nobody has signed in on is greeted "Welcome"', (
    WidgetTester tester,
  ) async {
    await pumpAt(tester, kPhone, const LoginScreen());

    expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
    expect(_heading('Welcome'), findsOneWidget);
    expect(
      find.text('Welcome back'),
      findsNothing,
      reason: 'a first-time visitor is not "back" (audit A-7)',
    );
  });

  testWidgets('a device where a session was seen is greeted "Welcome back"', (
    WidgetTester tester,
  ) async {
    final MemStore store = MemStore()..data[_flag] = 'true';
    await pumpAt(
      tester,
      kPhone,
      const LoginScreen(),
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => store),
      ],
    );

    expect(_heading('Welcome back'), findsOneWidget);
  });

  testWidgets(
    'the running app marks the device when a session is seen, and sign-out '
    'keeps the mark',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(1200, 4000);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.reset);

      final MemStore store = MemStore()
        ..data['nikatru.onboarding_seen'] = 'true';
      final MockAuthRepository auth = MockAuthRepository();
      await auth.signInWithEmail(email: 'a@b.test', password: 'pw');
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          authRepositoryProvider.overrideWithValue(auth),
          legalReacceptanceNeededProvider.overrideWithValue(false),
          analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
          secureStoreProvider.overrideWithValue(MemSecureStore()),
          notificationServiceProvider.overrideWithValue(FakeNotifications()),
          subscriptiontrackerNotificationServiceProvider.overrideWithValue(
            RecordingSublyNotifications(),
          ),
        ],
      );
      addTearDown(c.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(container: c, child: const SublyApp()),
      );
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(
        store.data[_flag],
        'true',
        reason: 'nothing in the running app marked the device for a session',
      );

      await auth.signOut();
      await tester.pumpAndSettle(const Duration(milliseconds: 400));

      expect(find.byType(LoginScreen), findsOneWidget);
      expect(_heading('Welcome back'), findsOneWidget);
      expect(store.data[_flag], 'true', reason: 'sign-out cleared the mark');
    },
  );
}
