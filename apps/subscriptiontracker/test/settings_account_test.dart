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

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/account/account_security.dart';
import 'package:subscriptiontracker/features/settings/reminder_settings.dart'
    show emailRemindersOnProvider;
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/features/shared/chassis_adapters.dart'
    show DevicesSection, EditProfileDialog;
import 'package:subscriptiontracker/features/shared/widgets.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

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

  /// Held open by a test to keep a save, or a sign-out, in flight.
  Completer<void>? gate;

  final StreamController<core.AuthUser?> _changes =
      StreamController<core.AuthUser?>.broadcast();

  @override
  core.AuthUser? get currentUser => signedIn
      ? core.AuthUser(
          id: 'u1',
          email: 'ada@test.dev',
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
    if (password != rightPassword) throw core.AuthFailure('Invalid login');
    return currentUser!;
  }

  @override
  Future<core.AuthUser> updateEmail({required String newEmail}) async {
    emailChanges.add(newEmail);
    return currentUser!;
  }

  @override
  Future<core.AuthUser> updatePassword({required String newPassword}) async {
    passwordChanges.add(newPassword);
    return currentUser!;
  }

  @override
  Stream<core.AuthUser?> authStateChanges() => _changes.stream;

  @override
  Future<String?> currentAccessToken() async => 'tok';

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
    await gate?.future;
    signedIn = false;
    _changes.add(null);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Sessions implements core.SessionsTransport {
  final List<String> revoked = <String>[];

  @override
  Future<core.Result<List<core.DeviceSession>>> list({
    required String? accessToken,
  }) async =>
      core.Result<List<core.DeviceSession>>.ok(const <core.DeviceSession>[
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
    revoked.add('$id:$accessToken');
    return const core.Result<void>.ok(null);
  }
}

class _Channels implements core.ReminderChannelsTransport {
  _Channels({required this.emailOptIn});

  final bool emailOptIn;

  @override
  Future<core.Result<core.ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  }) async => core.Result<core.ReminderPrefs>.ok(
    core.ReminderPrefs(emailOptIn: emailOptIn, leadDays: 2),
  );

  @override
  Future<core.Result<core.ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  }) async => core.Result<core.ReminderPrefs>.ok(
    core.ReminderPrefs(emailOptIn: emailOptIn, leadDays: leadDays ?? 2),
  );

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
  _Sessions? sessions,
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
        _Channels(emailOptIn: emailOn),
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
        home: const Scaffold(body: SettingsScreen()),
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
      await tester.tap(find.byKey(SettingsScreen.settingsLogOutAllButton));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Log out everywhere'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Logging out everywhere…'), findsOneWidget);
      expect(auth.signOutCalls, 1);
      await tester.tap(
        find.byKey(SettingsScreen.settingsLogOutAllButton),
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
      expect(find.byKey(DevicesSection.signOutButton('here')), findsNothing);
      await tester.tap(find.byKey(DevicesSection.signOutButton('phone')));
      await tester.pumpAndSettle();
      expect(sessions.revoked, <String>['phone:tok']);
      expect(auth.signOutCalls, 0, reason: 'this device was signed out');
      expect(auth.currentUser, isNotNull);
      expect(find.byKey(DevicesSection.row('here')), findsOneWidget);
      expect(find.byKey(DevicesSection.row('phone')), findsNothing);
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
      await openChange(tester, SettingsScreen.changeEmailRow);
      await fill(tester, newValue: 'new@test.dev', current: 'wrong');
      expect(auth.reauths, <String>['ada@test.dev']);
      expect(auth.emailChanges, isEmpty, reason: 'changed without the owner');
      expect(
        message(tester),
        'That password is not right. Nothing was changed.',
      );

      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      await openChange(tester, SettingsScreen.changePasswordRow);
      await fill(tester, newValue: 'a-new-long-one', current: 'wrong');
      expect(auth.passwordChanges, isEmpty);
    });

    testWidgets('🔴 an e-mail change says CHECK BOTH INBOXES, moves nothing', (
      WidgetTester tester,
    ) async {
      final _Auth auth = _Auth();
      await _pump(tester, auth);
      await openChange(tester, SettingsScreen.changeEmailRow);
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
      await openChange(tester, SettingsScreen.changeEmailRow);
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
      await openChange(tester, SettingsScreen.changePasswordRow);
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
        expect(find.byKey(SettingsScreen.changePasswordRow), findsNothing);
        await openChange(tester, SettingsScreen.changeEmailRow);
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
  });
}
