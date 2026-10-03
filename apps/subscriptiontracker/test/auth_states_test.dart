// AUTH, STATE BY STATE — train ST-D10.
//
// The screen matrix (design-st/screen-matrix.md §2.26–2.29) names five states
// per auth surface: loading, empty, error, offline, populated. This file drives
// each one on the restyled screens and reads what the user is SHOWN — the
// inline answer (`AuthMessage`, a live region) that replaced the SnackBar, the
// busy button, the sign-up checklist and the check-inbox resend rest.
//
// It asserts presentation only. Every handler, guard and key these screens
// had is exercised unchanged by the suites that own them
// (login_chassis_parity_test, auth_submit_waits_for_captcha_test,
// auth_screens_map_errors_test, check_inbox_test, …).

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/core/e2e_keys.dart';
import 'package:subscriptiontracker/features/auth/check_inbox_actions.dart';
import 'package:subscriptiontracker/features/auth/check_inbox_screen.dart';
import 'package:subscriptiontracker/features/auth/login_screen.dart';
import 'package:subscriptiontracker/features/shared/widgets.dart'
    show GradientButton;
import 'package:subscriptiontracker/l10n/chassis_bridge.g.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

/// A repository whose sign-in answers what the case says, when it says.
class _Auth extends core.AuthRepository {
  _Auth({this.refusal, this.hold, this.resendRefusal});

  final Object? refusal;
  final Completer<void>? hold;
  final Object? resendRefusal;
  int signIns = 0;
  int resends = 0;

  @override
  core.AuthUser? get currentUser => null;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    signIns++;
    if (hold != null) await hold!.future;
    throw refusal ?? core.AuthFailure('invalid_credentials');
  }

  @override
  Future<void> sendPasswordReset(String email, {String? captchaToken}) async {}

  @override
  Future<void> resendSignUpConfirmation(
    String email, {
    String? captchaToken,
  }) async {
    resends++;
    if (resendRefusal != null) throw resendRefusal!;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<AppLocalizations> _en() =>
    AppLocalizations.delegate.load(const Locale('en'));

Future<void> _login(
  WidgetTester tester,
  core.AuthRepository auth, {
  bool signUp = false,
}) => pumpAt(
  tester,
  kPhone,
  LoginScreen(startInSignUp: signUp),
  overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
);

Future<void> _fill(WidgetTester tester, String email, String password) async {
  await tester.enterText(find.byKey(E2EKeys.loginEmail), email);
  await tester.enterText(find.byKey(E2EKeys.loginPassword), password);
  await tester.pump();
}

Future<void> _submit(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(E2EKeys.loginSubmit));
  await tester.tap(find.byKey(E2EKeys.loginSubmit));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

/// The one inline answer on screen, and its words.
String? _said(WidgetTester tester) {
  final Finder m = find.byType(AuthMessage);
  if (m.evaluate().isEmpty) return null;
  return tester.widget<AuthMessage>(m).message;
}

void main() {
  late AppLocalizations en;
  setUpAll(() async => en = await _en());

  group('sign in · the five states', () {
    testWidgets('populated: the door, its reveal, and nothing said yet', (
      WidgetTester tester,
    ) async {
      await _login(tester, _Auth());
      expect(find.byKey(E2EKeys.loginHeading), findsOneWidget);
      expect(find.byKey(E2EKeys.loginEmail), findsOneWidget);
      expect(find.byKey(E2EKeys.loginPassword), findsOneWidget);
      expect(find.byKey(AuthField.revealKey), findsOneWidget);
      expect(find.byType(AuthMessage), findsNothing);
      expect(find.byType(AuthPasswordChecklist), findsNothing);
    });

    testWidgets('empty: a blank submit is answered inline, not snacked', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _login(tester, auth);
      await _submit(tester);
      expect(_said(tester), en.authEnterBoth);
      expect(find.byType(SnackBar), findsNothing);
      expect(auth.signIns, 0);
    });

    testWidgets('loading: the button waits visibly and takes no second tap', (
      WidgetTester tester,
    ) async {
      final Completer<void> hold = Completer<void>();
      final _Auth auth = _Auth(hold: hold);
      await _login(tester, auth);
      await _fill(tester, 'a@b.test', 'correct-horse');
      await _submit(tester);
      final GradientButton busy = tester.widget<GradientButton>(
        find.byKey(E2EKeys.loginSubmit),
      );
      expect(busy.label, en.pleaseWait);
      expect(busy.onPressed, isNull);
      hold.complete();
      await tester.pump();
      await tester.pump();
      expect(auth.signIns, 1);
    });

    testWidgets('error: a refusal is an inline live region, danger-toned', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _login(tester, _Auth());
      await _fill(tester, 'a@b.test', 'wrong-password');
      await _submit(tester);
      expect(_said(tester), en.authIncorrect);
      expect(
        tester.widget<AuthMessage>(find.byType(AuthMessage)).kind,
        StatusKind.danger,
      );
      expect(
        tester.getSemantics(find.byType(AuthMessage)),
        matchesSemantics(label: en.authIncorrect, isLiveRegion: true),
      );
      expect(find.byType(SnackBar), findsNothing);
      handle.dispose();
    });

    testWidgets('offline: a network failure says so, in place', (
      WidgetTester tester,
    ) async {
      await _login(tester, _Auth(refusal: Exception('network error')));
      await _fill(tester, 'a@b.test', 'correct-horse');
      await _submit(tester);
      expect(_said(tester), en.authNetworkError);
    });

    testWidgets('a new attempt clears the last answer before it is made', (
      WidgetTester tester,
    ) async {
      await _login(tester, _Auth());
      await _submit(tester);
      expect(_said(tester), en.authEnterBoth);
      await _fill(tester, 'a@b.test', 'wrong-password');
      await _submit(tester);
      expect(_said(tester), en.authIncorrect);
      expect(find.byType(AuthMessage), findsOneWidget);
    });

    testWidgets('a reset link sent is a POSITIVE answer, not a refusal', (
      WidgetTester tester,
    ) async {
      await _login(tester, _Auth());
      await tester.enterText(find.byKey(E2EKeys.loginEmail), 'a@b.test');
      await tester.tap(find.text(en.forgotPasswordShort));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));
      expect(_said(tester), en.resetSent);
      expect(
        tester.widget<AuthMessage>(find.byType(AuthMessage)).kind,
        StatusKind.positive,
      );
    });
  });

  group('sign up · the requirement checklist', () {
    List<AuthRuleState> states(WidgetTester tester) => tester
        .widget<AuthPasswordChecklist>(find.byType(AuthPasswordChecklist))
        .rules
        .map((AuthRule r) => r.state)
        .toList();

    testWidgets('reads the length as it is typed; the breach rule waits', (
      WidgetTester tester,
    ) async {
      await _login(tester, _Auth(), signUp: true);
      expect(states(tester), <AuthRuleState>[
        AuthRuleState.pending,
        AuthRuleState.pending,
      ]);
      await tester.enterText(find.byKey(E2EKeys.loginPassword), 'short');
      await tester.pump();
      expect(states(tester).first, AuthRuleState.pending);
      await tester.enterText(
        find.byKey(E2EKeys.loginPassword),
        'x' * core.kMinPasswordLength,
      );
      await tester.pump();
      expect(states(tester), <AuthRuleState>[
        AuthRuleState.met,
        AuthRuleState.pending,
      ]);
    });

    testWidgets('the checklist is sign-up only', (WidgetTester tester) async {
      await _login(tester, _Auth());
      expect(find.byType(AuthPasswordChecklist), findsNothing);
    });
  });

  group('check inbox · resend rests after a mail was sent', () {
    Future<_Auth> pumpInbox(WidgetTester tester, {Object? refusal}) async {
      final _Auth auth = _Auth(resendRefusal: refusal);
      await pumpAt(
        tester,
        kPhone,
        const CheckInboxScreen(email: 'asha@example.test'),
        overrides: <Override>[authRepositoryProvider.overrideWithValue(auth)],
      );
      return auth;
    }

    OutlinedButton resend(WidgetTester tester) => tester.widget<OutlinedButton>(
      find.byKey(CheckInboxActions.resendButton),
    );

    Future<void> tapResend(WidgetTester tester) async {
      await tester.ensureVisible(find.byKey(CheckInboxActions.resendButton));
      await tester.tap(find.byKey(CheckInboxActions.resendButton));
      await tester.pump();
      await tester.pump();
    }

    testWidgets('sent: the notice is inline, and the resend counts down', (
      WidgetTester tester,
    ) async {
      final _Auth auth = await pumpInbox(tester);
      expect(resend(tester).onPressed, isNotNull);
      await tapResend(tester);
      expect(auth.resends, 1);
      expect(_said(tester), en.verifyEmailResent);
      expect(resend(tester).onPressed, isNull);
      expect(find.text(en.checkInboxResendIn('0:30')), findsOneWidget);
      await tester.pump(const Duration(seconds: 6));
      expect(find.text(en.checkInboxResendIn('0:24')), findsOneWidget);
      await tester.pump(CheckInboxActions.cooldown);
      expect(resend(tester).onPressed, isNotNull);
      expect(find.text(en.verifyEmailResend), findsOneWidget);
    });

    testWidgets('failed: the sentence shows and the resend does NOT rest', (
      WidgetTester tester,
    ) async {
      await pumpInbox(tester, refusal: Exception('network error'));
      await tapResend(tester);
      expect(_said(tester), en.authNetworkError);
      expect(resend(tester).onPressed, isNotNull);
    });

    testWidgets('populated: the address is named, under a heading', (
      WidgetTester tester,
    ) async {
      await pumpInbox(tester);
      expect(find.text(en.checkInboxBody('asha@example.test')), findsOneWidget);
      expect(find.text(en.checkInboxTitle), findsOneWidget);
      expect(find.byType(AuthMessage), findsNothing);
    });
  });
}
