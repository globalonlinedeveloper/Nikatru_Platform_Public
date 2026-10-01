// The ST-T4a client (audit C20/D3 follow-through): Settings talks to the
// platform Worker's reminder routes — the reminders that reach EVERY target,
// web included.
//
//  · "Email me before renewals" PUTs /v1/reminders/prefs;
//  · "Add to calendar" mints the feed and opens its webcal: URL (a browser tab
//    cannot subscribe, so web downloads the https file instead);
//  · "Reset calendar link" ROTATES it (a second mint kills the old URL).
// The transport and the launcher are fakes; the Dio transport's wire shape is
// proven in packages/api_client/test.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/settings/reminder_settings.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/user_state_fakes.dart' show RecordingSublyNotifications;
import 'support/width_harness.dart' show MemStore;

class _SignedIn extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'u1', email: 'u1@test.dev', emailVerified: true);

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  Future<String?> currentAccessToken() async => 'tok';

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _Transport implements core.ReminderChannelsTransport {
  final List<String> calls = <String>[];
  core.ReminderPrefs prefs = const core.ReminderPrefs(
    emailOptIn: false,
    leadDays: 3,
  );
  bool failWrites = false;

  @override
  Future<core.Result<core.ReminderPrefs>> readPrefs({
    required String appId,
    required String? accessToken,
  }) async {
    calls.add('read:$appId:$accessToken');
    return core.Result<core.ReminderPrefs>.ok(prefs);
  }

  @override
  Future<core.Result<core.ReminderPrefs>> writePrefs({
    required String appId,
    required String? accessToken,
    required bool emailOptIn,
    int? leadDays,
  }) async {
    calls.add('put:$appId:$accessToken:$emailOptIn:$leadDays');
    if (failWrites) {
      return const core.Result<core.ReminderPrefs>.err(core.Failure('down'));
    }
    prefs = core.ReminderPrefs(
      emailOptIn: emailOptIn,
      leadDays: leadDays ?? prefs.leadDays,
    );
    return core.Result<core.ReminderPrefs>.ok(prefs);
  }

  @override
  Future<core.Result<core.CalendarFeed>> mintCalendarFeed({
    required String appId,
    required String? accessToken,
  }) async {
    calls.add('mint:$appId:$accessToken');
    return core.Result<core.CalendarFeed>.ok(
      core.CalendarFeed(
        httpsUrl: Uri.parse('https://api.test/v1/calendar/abc.ics'),
        webcalUrl: Uri.parse('webcal://api.test/v1/calendar/abc.ics'),
      ),
    );
  }
}

class _Launcher implements core.ExternalLinkLauncher {
  final List<Uri> opened = <Uri>[];

  @override
  Future<core.LinkOutcome> open(Uri uri) async {
    opened.add(uri);
    return core.LinkOutcome.opened;
  }
}

Future<({_Transport t, _Launcher l})> _pump(
  WidgetTester tester, {
  bool available = true,
  bool withRuleRows = false,
}) async {
  final _Transport t = _Transport();
  final _Launcher l = _Launcher();
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => MemStore()),
      authRepositoryProvider.overrideWithValue(_SignedIn()),
      reminderChannelsAvailableProvider.overrideWithValue(available),
      reminderChannelsTransportProvider.overrideWithValue(t),
      calendarLinkLauncherProvider.overrideWithValue(l),
      if (withRuleRows)
        renewalRemindersProvider.overrideWithValue(
          RecordingSublyNotifications(),
        ),
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
        home: Scaffold(
          body: withRuleRows
              // SE-09: the ONE "Remind me" row lives in ReminderRuleRows.
              ? const Column(
                  children: <Widget>[
                    ReminderRuleRows(),
                    ReminderChannelsCard(),
                  ],
                )
              : const ReminderChannelsCard(),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (t: t, l: l);
}

void main() {
  testWidgets('off a live backend the card is not there', (
    WidgetTester tester,
  ) async {
    final w = await _pump(tester, available: false);
    expect(find.byKey(const Key('settings.reminder.email')), findsNothing);
    expect(w.t.calls, isEmpty);
  });

  testWidgets('🔴 the email toggle PUTs the prefs, with the session token', (
    WidgetTester tester,
  ) async {
    final w = await _pump(tester, withRuleRows: true);
    expect(w.t.calls, <String>['read:subscriptiontracker:tok']);
    await tester.tap(find.byKey(const Key('settings.reminder.email')));
    await tester.pumpAndSettle();
    // ⏱ 2026-10-01 · SE-09: switching e-mail ON sends the ACCOUNT's lead (the
    // one "Remind me" row's, 2 by default) — was `null`, which kept the
    // server's own and let the two channels disagree.
    expect(w.t.calls.last, 'put:subscriptiontracker:tok:true:2');
    // There is no second "Remind me" row on the card any more...
    expect(find.byKey(const Key('settings.reminder.email.lead')), findsNothing);
    // ...and choosing 7 on THE row PUTs it to the platform too.
    await tester.tap(find.byKey(const Key('settings.reminder.lead')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('settings.reminder.lead.7')));
    await tester.pumpAndSettle();
    expect(w.t.calls.last, 'put:subscriptiontracker:tok:true:7');
    expect(find.textContaining('7 days before'), findsWidgets);
  });

  testWidgets('🔴 Add to calendar opens the returned webcal: URL', (
    WidgetTester tester,
  ) async {
    final w = await _pump(tester);
    await tester.tap(find.byKey(const Key('settings.reminder.calendar')));
    await tester.pumpAndSettle();
    expect(w.t.calls.last, 'mint:subscriptiontracker:tok');
    expect(w.l.opened, <Uri>[
      Uri.parse('webcal://api.test/v1/calendar/abc.ics'),
    ]);
  });

  testWidgets('Reset calendar link rotates the feed, opens nothing, says so', (
    WidgetTester tester,
  ) async {
    final w = await _pump(tester);
    await tester.tap(find.byKey(const Key('settings.reminder.calendar.reset')));
    await tester.pumpAndSettle();
    expect(w.t.calls.last, 'mint:subscriptiontracker:tok');
    expect(w.l.opened, isEmpty);
    expect(find.textContaining('no longer works'), findsOneWidget);
  });

  testWidgets('a failed call is SAID, and the switch does not move', (
    WidgetTester tester,
  ) async {
    final w = await _pump(tester);
    w.t.failWrites = true;
    await tester.tap(find.byKey(const Key('settings.reminder.email')));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Could not reach the reminder service'),
      findsOneWidget,
    );
    final SwitchListTile tile = tester.widget(
      find.byKey(const Key('settings.reminder.email')),
    );
    expect(tile.value, isFalse);
  });

  test('the calendar launcher admits the feed host and nothing new else', () {
    final core.LinkPolicy p = appLinkPolicy.withCalendarFeedUrl(
      'https://platform.example',
    );
    expect(
      p.check(Uri.parse('webcal://platform.example/v1/calendar/x.ics')).allowed,
      isTrue,
    );
    expect(
      p.check(Uri.parse('webcal://elsewhere.example/x.ics')).allowed,
      isFalse,
    );
  });
}
