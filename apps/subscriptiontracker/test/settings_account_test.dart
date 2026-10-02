// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS — the account and its controls: calm dialogs (SE-05), one
// Reminders section (SE-09), "Your devices" (SE-03) and the e-mail and
// password changes (SE-02), each pumped on the REAL `SettingsScreen`.
//
// ⏱ 2026-10-01 · train ST-SETTINGS. Every test here is a red control for one
// patch of that train: it fails on the tree before the patch.
//   · SE-05 — a double tap on Save calls `updateProfile` ONCE; an empty name
//     cannot be saved; "Log out" is painted neutral, not like Delete; "Log out
//     of all devices" says it is working; the delete password field carries
//     `AutofillHints.password`.
//   · SE-09 — exactly ONE row titled "Remind me", with local alerts AND e-mail
//     reminders on.
//   · SE-03 — signing ONE other device out leaves this session alive.
//   · SE-02 — a WRONG current password changes nothing; an e-mail change
//     says "check both inboxes" and moves nothing yet.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/account/account_rows.dart';
import 'package:subscriptiontracker/features/account/account_security.dart';
import 'package:subscriptiontracker/features/account/email_change_sign_out.dart';
import 'package:subscriptiontracker/features/settings/reminder_settings.dart'
    show emailRemindersOnProvider;
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/features/shared/chassis_adapters.dart'
    show DevicesSection, EditProfileDialog;
import 'package:subscriptiontracker/features/shared/widgets.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart'
    show SettingsState;

import 'support/user_state_fakes.dart';
import 'support/width_harness.dart' show MemStore;

class _Auth extends core.AuthRepository {
  String? displayName = 'Ada';
  bool signedIn = true;
  int updateCalls = 0;
  int signOutCalls = 0;

  /// SE-02: the re-authentication and the two changes it guards.
  static const String rightPassword = 'correct-horse';
  bool hasPassword = true;
  DateTime? lastSignInAt;
  final List<String> reauths = <String>[];
  final List<String> emailChanges = <String>[];
  final List<String> passwordChanges = <String>[];

  /// Review of #1129: what the change sent and what the server says back.
  final List<String?> currentPasswordsSent = <String?>[];
  String email = 'ada@test.dev';
  String sessionId = 's-old';
  String? reauthRefusalCode;
  String? changeRefusalCode;
  bool providerFails = false;
  core.SignOutScope? lastScope;

  /// Held open by a test to keep a save, or a sign-out, in flight.
  Completer<void>? gate;

  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => signedIn
      ? core.AuthUser(
          id: 'u1',
          email: email,
          emailVerified: true,
          displayName: displayName,
          hasPasswordIdentity: hasPassword,
          oauthProviders: hasPassword
              ? const <String>[]
              : const <String>['apple'],
          lastSignInAt: lastSignInAt,
        )
      : null;

  @override
  Future<core.AuthUser> signInWithEmail({
    required String email,
    required String password,
    String? captchaToken,
  }) async {
    reauths.add(email);
    final String? refused = reauthRefusalCode;
    if (refused != null) throw core.AuthFailure('refused', code: refused);
    if (password != rightPassword) throw core.AuthFailure('Invalid login');
    // A password sign-in MINTS A NEW SESSION, as GoTrue's does.
    sessionId = 's-new';
    return currentUser!;
  }

  @override
  Future<void> signInWithApple() async {
    if (providerFails) throw core.AuthFailure('The sheet was dismissed.');
    sessionId = 's-apple';
    lastSignInAt = DateTime.now().toUtc();
    _changes.add(currentUser);
  }

  @override
  Future<core.AuthUser> updateEmail({required String newEmail}) async {
    emailChanges.add(newEmail);
    return currentUser!;
  }

  @override
  Future<core.AuthUser> updatePassword({
    required String newPassword,
    String? currentPassword,
  }) async {
    final String? refused = changeRefusalCode;
    if (refused != null) throw core.AuthFailure('refused', code: refused);
    passwordChanges.add(newPassword);
    currentPasswordsSent.add(currentPassword);
    return currentUser!;
  }

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  @override
  Future<String?> currentAccessToken() async => _jwt(sessionId);

  @override
  Future<core.AuthUser> updateProfile({required String displayName}) async {
    updateCalls++;
    await gate?.future;
    this.displayName = displayName;
    _changes.add(currentUser);
    return currentUser!;
  }

  @override
  Future<void> signOut({
    core.SignOutScope scope = core.SignOutScope.local,
  }) async {
    signOutCalls++;
    lastScope = scope;
    await gate?.future;
    if (scope == core.SignOutScope.global && globalFailures > 0) {
      globalFailures--;
      // gotrue drops THIS device's session before the global revoke goes
      // out; a revoke that fails after that leaves this device signed out.
      if (failAfterLocalSignOut) {
        signedIn = false;
        _changes.add(null);
      }
      throw core.AuthFailure('Signing out of every device did not finish.');
    }
    signedIn = false;
    _changes.add(null);
  }

  /// Review 3 of #1129: how many global sign-outs fail, and whether this
  /// device's session was already gone when they did.
  int globalFailures = 0;
  bool failAfterLocalSignOut = false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// An access token shaped like GoTrue's, naming its session.
String _jwt(String sessionId) {
  String part(Object o) =>
      base64Url.encode(utf8.encode(jsonEncode(o))).replaceAll('=', '');
  return '${part(<String, String>{'alg': 'ES256'})}.'
      '${part(<String, String>{'session_id': sessionId})}.sig';
}

class _Sessions implements core.SessionsTransport {
  _Sessions({this.unavailable = false});

  /// What DioSessionsTransport returns for the host's `503
  /// sessions_unavailable` — a failure, never an empty list.
  final bool unavailable;
  final List<String> revoked = <String>[];

  @override
  Future<core.Result<List<core.DeviceSession>>> list({
    required String? accessToken,
  }) async => unavailable
      ? const core.Result<List<core.DeviceSession>>.err(
          core.Failure('sessions read failed'),
        )
      : core.Result<List<core.DeviceSession>>.ok(const <core.DeviceSession>[
          core.DeviceSession(
            id: 'here',
            current: true,
            device: 'Chrome on Linux',
          ),
          core.DeviceSession(id: 'phone', current: false, device: 'Android'),
        ]);

  @override
  Future<core.Result<void>> revoke({
    required String id,
    required String? accessToken,
  }) async {
    revoked.add('$id:${core.sessionIdOfAccessToken(accessToken)}');
    return const core.Result<void>.ok(null);
  }
}

class _Channels implements core.ReminderChannelsTransport {
  _Channels({required this.emailOptIn, this.serverLead = 2});

  final bool emailOptIn;

  /// The lead the platform holds before this screen writes one.
  final int serverLead;
  final List<int?> leadsWritten = <int?>[];

  @override
  Future<core.Result<core.ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  }) async => core.Result<core.ReminderPrefs>.ok(
    core.ReminderPrefs(emailOptIn: emailOptIn, leadDays: serverLead),
  );

  @override
  Future<core.Result<core.ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  }) async {
    leadsWritten.add(leadDays);
    return core.Result<core.ReminderPrefs>.ok(
      core.ReminderPrefs(
        emailOptIn: emailOptIn,
        leadDays: leadDays ?? serverLead,
      ),
    );
  }

  @override
  Future<core.Result<core.CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async => const core.Result<core.CalendarFeed>.err(core.Failure('n/a'));
}

Future<ProviderContainer> _pump(
  WidgetTester tester,
  _Auth auth, {
  bool emailOn = false,
  _Channels? channels,
  _Sessions? sessions,
  Widget Function(Widget screen)? wrap,
}) async {
  tester.view.physicalSize = const Size(1200, 5000);
  tester.view.devicePixelRatio = 1.0;
  addTearDown(tester.view.reset);
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      authRepositoryProvider.overrideWithValue(auth),
      keyValueStoreProvider.overrideWith((ref) async => MemStore()),
      analyticsConsentProvider.overrideWithValue(core.ConsentStatus.denied),
      secureStoreProvider.overrideWithValue(MemSecureStore()),
      notificationServiceProvider.overrideWithValue(FakeNotifications()),
      renewalRemindersProvider.overrideWithValue(RecordingSublyNotifications()),
      reminderChannelsAvailableProvider.overrideWithValue(emailOn),
      reminderChannelsTransportProvider.overrideWithValue(
        channels ?? _Channels(emailOptIn: emailOn),
      ),
      sessionsAvailableProvider.overrideWithValue(sessions != null),
      if (sessions != null)
        sessionsTransportProvider.overrideWithValue(sessions),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: (wrap ?? (Widget s) => s)(const SettingsScreen())),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return c;
}

void main() {
  group('SE-05 · calm dialogs', () {
    testWidgets('🔴 a DOUBLE TAP on Save calls updateProfile ONCE', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth()..gate = Completer<void>();
      await _pump(tester, auth);
      await tester.tap(find.text('Ada'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, 'Ada Lovelace');
      await tester.pump();

      final Finder save = find.byKey(EditProfileDialog.saveButton);
      // Two taps inside one frame — both reach the closure that was built
      // before the first one landed.
      await tester.tap(save);
      await tester.tap(save, warnIfMissed: false);
      await tester.pump();
      expect(auth.updateCalls, 1, reason: 'the second tap sent a second save');
      expect(
        tester.widget<FilledButton>(save).onPressed,
        isNull,
        reason: 'Save must stay disabled while the first save is in flight',
      );

      auth.gate!.complete();
      await tester.pumpAndSettle();
      expect(auth.updateCalls, 1);
      expect(find.text('Ada Lovelace'), findsOneWidget);
    });

    testWidgets('an EMPTY name cannot be saved', (WidgetTester tester) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await tester.tap(find.text('Ada'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField).first, '   ');
      await tester.pump();
      final Finder save = find.byKey(EditProfileDialog.saveButton);
      expect(tester.widget<FilledButton>(save).onPressed, isNull);
      await tester.tap(save, warnIfMissed: false);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(auth.updateCalls, 0, reason: 'a blank name erased the profile');
    });

    testWidgets('"Log out" is NEUTRAL — only Delete is painted danger', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _Auth());
      final SoftButton logOut = tester.widget<SoftButton>(
        find.widgetWithText(SoftButton, 'Log out'),
      );
      expect(logOut.color, isNull, reason: 'Log out was painted like Delete');
      final SoftButton delete = tester.widget<SoftButton>(
        find.widgetWithText(SoftButton, 'Delete account'),
      );
      expect(delete.color, AppColors.danger);
    });

    testWidgets('"Log out of all devices" SAYS it is working, and runs once', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth()..gate = Completer<void>();
      await _pump(tester, auth);
      await tester.tap(find.byKey(LogOutEverywhereButton.button));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Log out everywhere'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Logging out everywhere…'), findsOneWidget);
      expect(auth.signOutCalls, 1);
      await tester.tap(
        find.byKey(LogOutEverywhereButton.button),
        warnIfMissed: false,
      );
      await tester.pump();
      expect(auth.signOutCalls, 1, reason: 'a second tap started a second run');
      auth.gate!.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('the delete password field offers password autofill', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _Auth());
      await tester.tap(find.text('Delete account'));
      await tester.pumpAndSettle();
      final TextField field = tester.widget<TextField>(
        find.byKey(const Key('deleteAccountPassword')),
      );
      expect(field.autofillHints, contains(AutofillHints.password));
    });
  });

  group('SE-09 · one Reminders section', () {
    testWidgets('🔴 EXACTLY ONE "Remind me" row, with alerts AND e-mail on', (
      WidgetTester tester,
    ) async {
      await _pump(tester, _Auth(), emailOn: true);
      expect(find.byKey(const Key('settings.reminder.email')), findsOneWidget);
      expect(find.text('Remind me'), findsOneWidget);
      // ...and it sits in the one Reminders card with e-mail and the feed.
      final Finder section = find.byKey(SettingsScreen.remindersSection);
      for (final String key in <String>[
        'settings.reminder.lead',
        'settings.reminder.email',
        'settings.reminder.calendar',
      ]) {
        expect(
          find.descendant(of: section, matching: find.byKey(Key(key))),
          findsOneWidget,
          reason: '$key is not in the Reminders section',
        );
      }
    });

    // Review of #1129, finding 6: an account whose platform lead predates
    // the one row (5 days) is brought to the row's (2), not left on another
    // schedule.
    testWidgets('🔴 the platform lead CONVERGES on the one row', (
      WidgetTester tester,
    ) async {
      final _Channels channels = _Channels(emailOptIn: true, serverLead: 5);
      await _pump(tester, _Auth(), emailOn: true, channels: channels);
      expect(channels.leadsWritten, <int?>[
        SettingsState.defaultLeadDays,
      ], reason: 'e-mail stayed on a different schedule from the row');
    });

    testWidgets("🔴 signing out forgets the account's e-mail answer", (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      final ProviderContainer c = await _pump(tester, auth, emailOn: true);
      expect(c.read(emailRemindersOnProvider), isTrue);
      await auth.signOut();
      await tester.pumpAndSettle();
      expect(
        c.read(emailRemindersOnProvider),
        isFalse,
        reason: 'the signed-out app still believes e-mail reminders are on',
      );
    });
  });

  group('SE-03 · your devices', () {
    testWidgets('🔴 signing ONE other device out leaves this session alive', (
      WidgetTester tester,
    ) async {
      final _Sessions sessions = _Sessions();
      final _Auth auth = _Auth();
      await _pump(tester, auth, sessions: sessions);
      expect(find.text('Your devices'), findsOneWidget);
      // Read on demand (review of #1129, finding 4).
      await tester.ensureVisible(find.byKey(DevicesSection.show));
      await tester.tap(find.byKey(DevicesSection.show));
      await tester.pumpAndSettle();
      expect(find.byKey(DevicesSection.signOutButton('here')), findsNothing);
      await tester.tap(find.byKey(DevicesSection.signOutButton('phone')));
      await tester.pumpAndSettle();
      expect(sessions.revoked, <String>['phone:s-old']);
      expect(auth.signOutCalls, 0, reason: 'this device was signed out');
      expect(auth.currentUser, isNotNull);
      expect(find.byKey(DevicesSection.row('here')), findsOneWidget);
      expect(find.byKey(DevicesSection.row('phone')), findsNothing);
    });

    // Review 3 of #1129, finding 5: the live host (Box C) has no sessions RPCs
    // yet (#1080), so GET /v1/sessions answers 503 sessions_unavailable. The
    // section SAYS it could not load the list — never "no devices", never an
    // error page.
    testWidgets('a 503 from the host says unavailable, never an empty list', (
      WidgetTester tester,
    ) async {
      final _Sessions sessions = _Sessions(unavailable: true);
      await _pump(tester, _Auth(), sessions: sessions);
      await tester.ensureVisible(find.byKey(DevicesSection.show));
      await tester.tap(find.byKey(DevicesSection.show));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byKey(DevicesSection.unavailable), findsOneWidget);
      expect(find.text('Your devices could not be loaded.'), findsOneWidget);
      expect(find.byKey(DevicesSection.row('here')), findsNothing);
      expect(find.byKey(DevicesSection.signOutButton('phone')), findsNothing);
    });

    testWidgets('no section off a live backend', (WidgetTester tester) async {
      await _pump(tester, _Auth());
      expect(find.text('Your devices'), findsNothing);
    });
  });

  group('SE-02 · change e-mail and password', () {
    Future<void> openChange(WidgetTester tester, Key row) async {
      await tester.ensureVisible(find.byKey(row));
      await tester.tap(find.byKey(row));
      await tester.pumpAndSettle();
    }

    Future<void> fill(
      WidgetTester tester, {
      required String newValue,
      String? current,
    }) async {
      await tester.enterText(
        find.byKey(AccountChangeDialog.newValueField),
        newValue,
      );
      if (current != null) {
        await tester.enterText(
          find.byKey(AccountChangeDialog.currentPasswordField),
          current,
        );
      }
      await tester.pump();
      await tester.tap(find.byKey(AccountChangeDialog.submitButton));
      await tester.pumpAndSettle();
    }

    String message(WidgetTester tester) =>
        tester.widget<Text>(find.byKey(AccountChangeDialog.message)).data!;

    testWidgets('🔴 a WRONG current password changes NOTHING', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changeEmail);
      await fill(tester, newValue: 'new@test.dev', current: 'wrong');
      expect(auth.reauths, <String>['ada@test.dev']);
      expect(auth.emailChanges, isEmpty, reason: 'changed without the owner');
      expect(
        message(tester),
        'That password is not right. Nothing was changed.',
      );

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await openChange(tester, AccountSecurityRows.changePassword);
      await fill(tester, newValue: 'a-new-long-one', current: 'wrong');
      expect(auth.passwordChanges, isEmpty);
    });

    testWidgets('🔴 an e-mail change says CHECK BOTH INBOXES, moves nothing', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changeEmail);
      await fill(
        tester,
        newValue: ' new@test.dev ',
        current: _Auth.rightPassword,
      );
      expect(auth.emailChanges, <String>['new@test.dev']);
      expect(message(tester), contains('Check both inboxes'));
      expect(message(tester), contains('ada@test.dev'));
      expect(message(tester), contains('new@test.dev'));
      expect(auth.currentUser!.email, 'ada@test.dev');
    });

    testWidgets('the same address, or not an address, cannot be sent', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changeEmail);
      for (final String bad in <String>['ada@test.dev', 'not-an-address']) {
        await tester.enterText(
          find.byKey(AccountChangeDialog.newValueField),
          bad,
        );
        await tester.enterText(
          find.byKey(AccountChangeDialog.currentPasswordField),
          _Auth.rightPassword,
        );
        await tester.pump();
        expect(
          tester
              .widget<FilledButton>(
                find.byKey(AccountChangeDialog.submitButton),
              )
              .onPressed,
          isNull,
          reason: '"$bad" could be submitted',
        );
      }
      expect(auth.reauths, isEmpty);
    });

    testWidgets('a password change re-authenticates, then saves the new one', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changePassword);
      expect(find.byType(AuthPasswordChecklist), findsOneWidget);
      await fill(
        tester,
        newValue: 'a-new-long-one',
        current: _Auth.rightPassword,
      );
      expect(auth.reauths, <String>['ada@test.dev']);
      expect(auth.passwordChanges, <String>['a-new-long-one']);
      expect(message(tester), 'Your password was changed.');
    });

    testWidgets(
      'an Apple account: no password to type, no password to change',
      (WidgetTester tester) async {
        final _Auth auth = _Auth()
          ..hasPassword = false
          // Just signed in with Apple: inside the freshness window, so the
          // provider sheet is not shown again.
          ..lastSignInAt = DateTime.now().toUtc();
        await _pump(tester, auth);
        expect(find.byKey(AccountSecurityRows.changePassword), findsNothing);
        await openChange(tester, AccountSecurityRows.changeEmail);
        expect(
          find.byKey(AccountChangeDialog.currentPasswordField),
          findsNothing,
        );
        await fill(tester, newValue: 'new@test.dev');
        expect(
          auth.reauths,
          isEmpty,
          reason: 'a password sign-in was attempted',
        );
        expect(auth.emailChanges, <String>['new@test.dev']);
      },
    );

    // ── review of #1129 ─────────────────────────────────────────────────
    // Finding 1, measured on the live GoTrue (Box C, v2.189.0): a signed-in
    // password change without `current_password` is `400
    // current_password_required`, a wrong one `current_password_invalid`.
    testWidgets('🔴 a password change SENDS the current password', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changePassword);
      await fill(
        tester,
        newValue: 'a-new-long-one',
        current: _Auth.rightPassword,
      );
      expect(auth.currentPasswordsSent, <String?>[_Auth.rightPassword]);
    });

    testWidgets('🔴 the server refusing the current password says so', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth()
        ..changeRefusalCode = core.AuthFailure.currentPasswordInvalid;
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changePassword);
      await fill(
        tester,
        newValue: 'a-new-long-one',
        current: _Auth.rightPassword,
      );
      expect(
        message(tester),
        'That password is not right. Nothing was changed.',
        reason: 'a refused current password was shown as a generic failure',
      );
    });

    // Finding 7: only a refused PASSWORD is a wrong password.
    testWidgets('a captcha refusal is NOT told as a wrong password', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth()
        ..reauthRefusalCode = core.AuthFailure.captchaFailed;
      await _pump(tester, auth);
      await openChange(tester, AccountSecurityRows.changeEmail);
      await fill(
        tester,
        newValue: 'new@test.dev',
        current: _Auth.rightPassword,
      );
      expect(auth.emailChanges, isEmpty);
      expect(
        message(tester),
        'That did not work, and nothing was changed. Try again.',
      );
    });

    // Finding 3: the provider path's own red control.
    testWidgets(
      '🔴 an Apple account whose Apple sign-in fails changes NOTHING',
      (WidgetTester tester) async {
        final _Auth auth = _Auth()
          ..hasPassword = false
          // Outside the freshness window: the provider sheet MUST be shown.
          ..lastSignInAt = DateTime.now().toUtc().subtract(
            const Duration(hours: 1),
          )
          ..providerFails = true;
        await _pump(tester, auth);
        await openChange(tester, AccountSecurityRows.changeEmail);
        await fill(tester, newValue: 'new@test.dev');
        expect(
          auth.emailChanges,
          isEmpty,
          reason: 'changed without the provider confirming it is the owner',
        );
        expect(
          message(tester),
          'That did not work, and nothing was changed. Try again.',
        );
      },
    );

    // Finding 5: the session the re-authentication replaced is ended.
    testWidgets('🔴 the session the re-auth REPLACED is signed out', (
      WidgetTester tester,
    ) async {
      final _Sessions sessions = _Sessions();
      final _Auth auth = _Auth();
      await _pump(tester, auth, sessions: sessions);
      await openChange(tester, AccountSecurityRows.changeEmail);
      await fill(
        tester,
        newValue: 'new@test.dev',
        current: _Auth.rightPassword,
      );
      expect(auth.emailChanges, <String>['new@test.dev']);
      expect(
        sessions.revoked,
        <String>['s-old:s-new'],
        reason: 'the replaced session must be ended, with the NEW one\'s token',
      );
    });
  });

  // ── ADR 059 decision 2 · review of #1129, finding 2 ──────────────────────
  group('a confirmed e-mail change signs out everywhere', () {
    testWidgets('🔴 the same account under a NEW address ends every session', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      final ProviderContainer c = await _pump(
        tester,
        auth,
        wrap: (Widget s) => EmailChangeSignOut(child: s),
      );
      // A profile edit re-emits the SAME address: not a change.
      auth._changes.add(auth.currentUser);
      await tester.pumpAndSettle();
      expect(auth.signOutCalls, 0);

      auth.email = 'new@test.dev';
      auth._changes.add(auth.currentUser);
      await tester.pumpAndSettle();
      expect(auth.signOutCalls, 1, reason: 'the old sessions stayed signed in');
      expect(auth.lastScope, core.SignOutScope.global);
      expect(
        c.read(emailChangeSignedOutProvider),
        EmailChangeSignOutNotice.everywhere,
      );
    });

    // ── review 3 of #1129, finding 1: the sign-out tells the truth ──────
    testWidgets(
      '🔴 a revoke that cannot get out is RETRIED, and a final failure says so',
      (WidgetTester tester) async {
        final _Auth auth = _Auth()..globalFailures = 99;
        final ProviderContainer c = await _pump(
          tester,
          auth,
          wrap: (Widget s) => EmailChangeSignOut(child: s),
        );
        auth.email = 'new@test.dev';
        auth._changes.add(auth.currentUser);
        await tester.pump();
        // The backoff, run out.
        for (final Duration d in EmailChangeSignOut.retryBackoff) {
          await tester.pump(d);
        }
        await tester.pump(const Duration(seconds: 1));
        expect(auth.signOutCalls, 3, reason: 'not retried with backoff');
        expect(auth.currentUser, isNotNull);
        expect(
          c.read(emailChangeSignedOutProvider),
          isNull,
          reason: 'it would say every device was signed out — none was',
        );
        expect(find.byKey(EmailChangeSignOut.failedKey), findsOneWidget);
        expect(find.textContaining('could not be signed out'), findsOneWidget);

        // ...and offered again: this time it goes through.
        auth.globalFailures = 0;
        await tester.tap(find.text('Retry'));
        await tester.pump();
        await tester.pump(const Duration(seconds: 1));
        expect(auth.signOutCalls, 4);
        expect(
          c.read(emailChangeSignedOutProvider),
          EmailChangeSignOutNotice.everywhere,
        );
        await tester.pumpAndSettle();
      },
    );

    testWidgets(
      '🔴 a revoke that failed AFTER this device signed out says the others were NOT',
      (WidgetTester tester) async {
        final _Auth auth = _Auth()
          ..globalFailures = 1
          ..failAfterLocalSignOut = true;
        final ProviderContainer c = await _pump(
          tester,
          auth,
          wrap: (Widget s) => EmailChangeSignOut(child: s),
        );
        auth.email = 'new@test.dev';
        auth._changes.add(auth.currentUser);
        await tester.pumpAndSettle();
        expect(
          auth.signOutCalls,
          1,
          reason: 'no session is left here to retry with',
        );
        expect(
          c.read(emailChangeSignedOutProvider),
          EmailChangeSignOutNotice.othersStillSignedIn,
          reason: 'the sign-in screen would claim every device was signed out',
        );
      },
    );

    // ── review 3, finding 6: the notice does not outlive the next sign-in ──
    testWidgets('🔴 the next sign-in clears the e-mail-changed notice', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      final ProviderContainer c = await _pump(tester, auth);
      c.read(emailChangeSignedOutProvider.notifier).state =
          EmailChangeSignOutNotice.everywhere;
      // Signed in again: the shell — and with it this widget — mounts.
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            localizationsDelegates: <LocalizationsDelegate<dynamic>>[
              ...AppLocalizations.localizationsDelegates,
              ChassisLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(body: EmailChangeSignOut(child: SizedBox())),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        c.read(emailChangeSignedOutProvider),
        isNull,
        reason: 'the next ordinary sign-out would say it again',
      );
    });
  });
}
