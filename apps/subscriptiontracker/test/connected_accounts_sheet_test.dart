// ─────────────────────────────────────────────────────────────────────────────
// connected_accounts_sheet_test.dart — ⏱ 2026-10-01 · SE-04, the ADAPTER half
// of Settings' "Connected accounts" (the view is asserted in
// packages/chassis_screens/test/connected_accounts_view_test.dart).
//
// What THIS file owns: the methods offered are the ones the platform AND the
// server allow, and Remove reaches the seam's `unlinkIdentity`.
//
// RED CONTROLS: offer Google without `providers.google` (the server-off case
// draws a Connect button); wire `onUnlink` to a no-op (the account keeps
// Apple).
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthProviders, InMemoryAuthRepository;
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/auth/connected_accounts_sheet.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

void main() {
  Future<InMemoryAuthRepository> pump(
    WidgetTester tester, {
    required AuthProviders providers,
  }) async {
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    await auth.signInWithApple();
    await pumpAt(
      tester,
      kPhone,
      const Scaffold(body: ConnectedAccountsSheet()),
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(auth),
        authProvidersProvider.overrideWithValue(providers),
      ],
    );
    return auth;
  }

  testWidgets('only what the server accepts is offered', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await pump(
      tester,
      providers: const AuthProviders(apple: true, google: false),
    );
    expect(
      find.byKey(ConnectedAccountsView.row(core.SignInMethod.google)),
      findsNothing,
    );
    expect(
      find.byKey(ConnectedAccountsView.row(core.SignInMethod.apple)),
      findsOneWidget,
    );
    unawaited(auth.dispose());
  });

  testWidgets('Remove reaches the seam and the account loses the method', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await pump(
      tester,
      providers: const AuthProviders(apple: true, google: true),
    );
    expect(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.google)),
      findsOneWidget,
    );
    await tester.tap(
      find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
    );
    await tester.pump();
    await tester.pump();
    expect(auth.currentUser?.oauthProviders, isEmpty);
    expect(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.apple)),
      findsOneWidget,
    );
    unawaited(auth.dispose());
  });
}
