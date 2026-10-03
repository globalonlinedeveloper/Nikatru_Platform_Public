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
//
// ⏱ 2026-10-02 · review of #1155, finding 3: link and unlink need a FRESH
// sign-in. RED CONTROLS: a stale session that cancels the re-authentication,
// and a server that answers `reauth_required`, each leave the account as it
// was (drop `core.guardSignInMethodChange` and both go red).
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show ApiException, RestClient;
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart'
    show AuthProviders, InMemoryAuthRepository;
import 'package:nikatru_chassis_screens/settings/connected_accounts_view.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/auth/connected_accounts_sheet.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

void main() {
  late int reauthAsked;
  late int serverChecks;

  Future<InMemoryAuthRepository> pump(
    WidgetTester tester, {
    required AuthProviders providers,
    bool reauthPasses = true,
    Object? serverRefuses,
  }) async {
    reauthAsked = 0;
    serverChecks = 0;
    final InMemoryAuthRepository auth = InMemoryAuthRepository();
    await auth.signInWithApple();
    await pumpAt(
      tester,
      kPhone,
      const Scaffold(body: ConnectedAccountsSheet()),
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(auth),
        authProvidersProvider.overrideWithValue(providers),
        signInMethodReauthProvider.overrideWithValue((_) async {
          reauthAsked++;
          return reauthPasses;
        }),
        signInMethodServerCheckProvider.overrideWithValue(() async {
          serverChecks++;
          final Object? refusal = serverRefuses;
          if (refusal != null) throw refusal;
        }),
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

  testWidgets(
    'RED CONTROL: a stale session that does not re-authenticate cannot '
    'unlink, and the server is never asked',
    (WidgetTester tester) async {
      final InMemoryAuthRepository auth = await pump(
        tester,
        providers: const AuthProviders(apple: true, google: true),
        reauthPasses: false,
      );
      await tester.tap(
        find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
      );
      await tester.pumpAndSettle();
      expect(reauthAsked, 1);
      expect(serverChecks, 0);
      expect(auth.currentUser?.oauthProviders, <String>['apple']);
      expect(
        find.text(
          'For your security, sign in again to change how you sign in.',
        ),
        findsOneWidget,
      );
      unawaited(auth.dispose());
    },
  );

  testWidgets(
    'RED CONTROL: the server refusing a stale token stops an unlink',
    (WidgetTester tester) async {
      final InMemoryAuthRepository auth = await pump(
        tester,
        providers: const AuthProviders(apple: true, google: true),
        serverRefuses: core.AuthFailure(
          'stale',
          code: core.AuthFailure.reauthRequired,
        ),
      );
      await tester.tap(
        find.byKey(ConnectedAccountsView.unlinkButton(core.SignInMethod.apple)),
      );
      await tester.pumpAndSettle();
      expect(serverChecks, 1);
      expect(auth.currentUser?.oauthProviders, <String>['apple']);
      unawaited(auth.dispose());
    },
  );

  testWidgets('a stale session cannot link either', (
    WidgetTester tester,
  ) async {
    final InMemoryAuthRepository auth = await pump(
      tester,
      providers: const AuthProviders(apple: true, google: true),
      reauthPasses: false,
    );
    await tester.tap(
      find.byKey(ConnectedAccountsView.linkButton(core.SignInMethod.google)),
    );
    await tester.pumpAndSettle();
    expect(reauthAsked, 1);
    expect(serverChecks, 0);
    expect(
      find.text('For your security, sign in again to change how you sign in.'),
      findsOneWidget,
    );
    unawaited(auth.dispose());
  });

  test('the server\'s 403 is the auth layer\'s reauth_required', () async {
    await expectLater(
      confirmSignInMethodChangeAtServer(_Refusing(403)),
      throwsA(
        isA<core.AuthFailure>().having(
          (core.AuthFailure f) => f.code,
          'code',
          core.AuthFailure.reauthRequired,
        ),
      ),
    );
    await expectLater(
      confirmSignInMethodChangeAtServer(_Refusing(500)),
      throwsA(isA<ApiException>()),
    );
  });

  // The status set assert-analytics-contract pins (`account-identity-change`):
  // 403 is reauth_required, no answer is the network, and anything else is
  // rethrown as the ApiException it is.
  test('the identity-change status mapping', () {
    expect(
      signInMethodChangeFailureForStatus(403, offline: false)?.code,
      core.AuthFailure.reauthRequired,
    );
    expect(
      signInMethodChangeFailureForStatus(0, offline: true)?.code,
      core.AuthFailure.network,
    );
    expect(signInMethodChangeFailureForStatus(500, offline: false), isNull);
  });
}

/// A platform client whose every POST is answered with [status].
class _Refusing extends RestClient {
  _Refusing(this.status)
    : super(
        baseUrl: 'https://platform.test/v1',
        tokenProvider: () async => 't',
      );

  final int status;

  @override
  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) =>
      Future<dynamic>.error(ApiException(status, 'refused'));
}
