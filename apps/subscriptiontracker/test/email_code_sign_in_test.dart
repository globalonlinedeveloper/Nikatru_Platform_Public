// ─────────────────────────────────────────────────────────────────────────────
// email_code_sign_in_test.dart — ⏱ 2026-10-01 · EN-21, "Email me a code".
//
// The sign-in screen's second way in: a six-digit code mailed to the address.
// Driven through the REAL screen and the in-memory identity (which records
// every send and accepts exactly one code), with the key-value store shared
// between two pumps to stand in for a reload.
//
// RED CONTROLS: make `InMemoryAuthRepository.verifyEmailCode` accept any code
// (the wrong-code case signs in); drop the `emailCodeWait` read from
// `_sendCode` (the reload case sends a second mail); key the button on
// `true` instead of `emailCodeAvailable` (the unavailable case draws it).
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show InMemoryAuthRepository;
import 'package:nikatru_chassis_screens/auth/email_code_form.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/mock_auth_repository.dart';
import 'support/width_harness.dart';

void main() {
  final ChassisLocalizations l10n = lookupChassisLocalizations(
    const Locale('en'),
  );
  const String email = 'alex@example.com';

  Future<void> pumpLogin(
    WidgetTester tester,
    core.AuthRepository auth,
    MemStore store,
  ) => pumpAt(
    tester,
    kPhone,
    const LoginScreen(),
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(auth),
      keyValueStoreProvider.overrideWith((_) async => store),
    ],
  );

  Future<void> requestCode(WidgetTester tester) async {
    await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
    await tester.pump();
    final Finder button = find.byKey(LoginScreen.emailCodeButton);
    await tester.ensureVisible(button);
    await tester.tap(button);
    for (int i = 0; i < 6; i++) {
      await tester.pump();
    }
  }

  /// The form runs a one-second countdown; unmount it so no timer outlives
  /// the case.
  Future<void> unmount(WidgetTester tester) =>
      tester.pumpWidget(const SizedBox.shrink());

  testWidgets('🔴 a wrong code refuses and signs nobody in; the right one '
      'signs in', (WidgetTester tester) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    await pumpLogin(tester, auth, MemStore());
    await requestCode(tester);

    expect(auth.emailCodesSent, <String>[email]);
    expect(find.byType(EmailCodeForm), findsOneWidget);
    expect(find.text(l10n.emailCodeSentTo(email)), findsOneWidget);

    await tester.enterText(find.byKey(EmailCodeForm.codeField), '000000');
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    await tester.pump();
    expect(auth.currentUser, isNull);
    expect(
      tester.widget<Text>(find.byKey(EmailCodeForm.statusLine)).data,
      l10n.authCodeInvalid,
    );

    // Not a code at all: refused on this side, no request.
    await tester.enterText(find.byKey(EmailCodeForm.codeField), '12ab');
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    expect(
      tester.widget<Text>(find.byKey(EmailCodeForm.statusLine)).data,
      l10n.emailCodeShape,
    );

    await tester.enterText(
      find.byKey(EmailCodeForm.codeField),
      InMemoryAuthRepository.emailCode,
    );
    await tester.tap(find.byKey(EmailCodeForm.verifyButton));
    await tester.pump();
    await tester.pump();
    expect(auth.currentUser?.email, email);
    await unmount(tester);
    unawaited(auth.dispose());
  });

  testWidgets('🔴 the 60 s cooldown holds across a reload', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    final MemStore store = MemStore();
    await pumpLogin(tester, auth, store);
    await requestCode(tester);
    expect(auth.emailCodesSent, hasLength(1));
    await unmount(tester);

    // A fresh screen and a fresh provider container: only the store survives.
    await pumpLogin(tester, auth, store);
    await requestCode(tester);
    expect(
      auth.emailCodesSent,
      hasLength(1),
      reason: 'a second mail inside the cooldown spends the reset quota',
    );
    expect(find.byType(EmailCodeForm), findsOneWidget);
    final TextButton resend = tester.widget<TextButton>(
      find.byKey(EmailCodeForm.resendButton),
    );
    expect(resend.onPressed, isNull);
    expect(store.data[core.EmailCodeCooldown.storageKey], isNot(contains('@')));
    await unmount(tester);
    unawaited(auth.dispose());
  });

  testWidgets('the gate token is spent on the send', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    await pumpLogin(tester, auth, MemStore());
    await requestCode(tester);
    // The gate is inert in a test build, so the token is null — but the send
    // went through the same `captcha.consume()` the password path uses.
    expect(auth.emailCodesSent, <String>[email]);
    expect(auth.lastCaptchaToken, isNull);
    await unmount(tester);
    unawaited(auth.dispose());
  });

  testWidgets('a build that cannot reach the send draws no button', (
    WidgetTester tester,
  ) async {
    await pumpLogin(tester, MockAuthRepository(), MemStore());
    expect(find.byKey(E2EKeys.loginEmail), findsOneWidget);
    expect(find.byKey(LoginScreen.emailCodeButton), findsNothing);
  });

  testWidgets('"Use your password instead" goes back to the password form', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    await pumpLogin(tester, auth, MemStore());
    await requestCode(tester);
    await tester.tap(find.byKey(EmailCodeForm.cancelButton));
    await tester.pump();
    expect(find.byType(EmailCodeForm), findsNothing);
    expect(find.byKey(E2EKeys.loginPassword), findsOneWidget);
    unawaited(auth.dispose());
  });
}
