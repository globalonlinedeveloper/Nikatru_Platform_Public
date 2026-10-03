import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/settings/preference_refused_notice.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/refresh_on_return.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11) — preferences follow the account, per key,
/// through the app's REAL controllers and providers (lead ruling on #1080).
///
/// A "device" is a container over its own device store; devices share only
/// one fake `/v1/preferences` that implements the route's rule (a version only
/// it bumps; a change based on an older version than the row's is a conflict).

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

class _Server implements core.AccountPreferencesTransport {
  final Map<String, core.PreferenceValue> rows =
      <String, core.PreferenceValue>{};
  int reads = 0;
  int patches = 0;
  int? failWith;
  Completer<void>? holdRead;

  @override
  Future<Map<String, core.PreferenceValue>> read() async {
    reads++;
    if (failWith != null) throw core.AccountPreferencesFailure(failWith!);
    final Map<String, core.PreferenceValue> snapshot =
        Map<String, core.PreferenceValue>.of(rows);
    final Completer<void>? hold = holdRead;
    holdRead = null;
    if (hold != null) await hold.future;
    return snapshot;
  }

  @override
  Future<core.PreferencesPatchResult> patch(
    Map<String, core.PreferenceChange> changes,
  ) async {
    if (failWith != null) throw core.AccountPreferencesFailure(failWith!);
    patches++;
    final Set<String> conflicts = <String>{};
    changes.forEach((String k, core.PreferenceChange c) {
      final int held = rows[k]?.version ?? 0;
      if (held > c.baseVersion) {
        conflicts.add(k);
      } else {
        rows[k] = core.PreferenceValue(c.value, held + 1);
      }
    });
    return core.PreferencesPatchResult(
      current: <String, core.PreferenceValue>{
        for (final String k in changes.keys) k: rows[k]!,
      },
      conflicts: conflicts,
    );
  }

  void elsewhere(String key, Object? value) =>
      rows[key] = core.PreferenceValue(value, (rows[key]?.version ?? 0) + 1);

  Map<String, Object?> get values => <String, Object?>{
    for (final MapEntry<String, core.PreferenceValue> e in rows.entries)
      e.key: e.value.value,
  };
}

const core.AuthUser _me = core.AuthUser(id: 'me', email: 'me@example.test');

class _Device {
  _Device(this.server, {core.AuthUser? user = _me}) {
    users.add(user);
    c = ProviderContainer(
      overrides: <Override>[
        keyValueStoreProvider.overrideWith((_) async => store),
        deviceRegionProvider.overrideWithValue('US'),
        authUserProvider.overrideWith((_) => users.stream),
        accountPreferencesTransportProvider.overrideWithValue(server),
      ],
    );
    addTearDown(c.dispose);
    addTearDown(users.close);
    // As SublyApp does: watched for its effect.
    c.listen(accountPreferencesSyncProvider, (_, _) {});
  }

  final _Server server;
  final _MemStore store = _MemStore();
  final StreamController<core.AuthUser?> users =
      StreamController<core.AuthUser?>();
  late final ProviderContainer c;

  SettingsController get settings =>
      c.read(settingsControllerProvider.notifier);
  core.AccountPreferencesSync get sync =>
      c.read(accountPreferencesSyncProvider)!;
}

Future<void> _settle() => pumpEventQueue(times: 40);

void main() {
  test('written on device A, they hydrate on device B after sign-in', () async {
    final _Server server = _Server();
    final _Device a = _Device(server);
    await _settle();
    await a.settings.setCurrency('EUR');
    await a.settings.setReminderLead(7);
    await _settle();

    final _Device b = _Device(server);
    await _settle();
    expect(b.c.read(settingsControllerProvider).currencyCode, 'EUR');
    expect(b.c.read(settingsControllerProvider).reminderLeadDays, 7);
  });

  // ⏱ 2026-10-03 · club-nits-b (#1161 nit 5). RED before: the sync sent
  // languageCode, so a region-tagged choice reached the account as `pt` and
  // came back to device B as a bare Locale('pt').
  test('a region-tagged language follows the account whole', () async {
    const Locale ptBr = Locale.fromSubtags(
      languageCode: 'pt',
      countryCode: 'BR',
    );
    final _Server server = _Server();
    final _Device a = _Device(server);
    await _settle();
    await setLocaleByUserWith(a.c.read, ptBr);
    await _settle();
    expect(server.values['locale'], 'pt-BR');

    final _Device b = _Device(server);
    await _settle();
    expect(b.c.read(localeProvider), ptBr);
  });

  test("🔴 finding 4: device B's untouched defaults are NEVER sent", () async {
    final _Server server = _Server()
      ..elsewhere('currencyCode', 'INR')
      ..elsewhere('switch.weekly', true);
    final _Device b = _Device(server);
    await _settle();
    expect(server.patches, 0);
    expect(server.values, <String, Object?>{
      'currencyCode': 'INR',
      'switch.weekly': true,
    });
    expect(b.c.read(settingsControllerProvider).currencyCode, 'INR');
    expect(b.c.read(settingsControllerProvider).prefs['weekly'], isTrue);
  });

  test(
    '🔴 finding 2c: an offline change survives the Retry (config invalidated) and is sent',
    () async {
      final _Server server = _Server()..elsewhere('currencyCode', 'USD');
      final _Device a = _Device(server);
      await _settle();
      server.failWith = 0;
      await a.settings.setCurrency('EUR');
      await _settle();
      a.c.invalidate(appConfigProvider); // the offline banner's Retry
      await _settle();
      server.failWith = null;
      await a.sync.sync();
      await _settle();
      expect(a.c.read(settingsControllerProvider).currencyCode, 'EUR');
      expect(server.values['currencyCode'], 'EUR');
    },
  );

  test(
    '🔴 finding 3: a switch toggled during the focus re-read keeps its new value',
    () async {
      final _Server server = _Server()..elsewhere('switch.unused', true);
      final _Device a = _Device(server);
      await _settle();
      expect(a.c.read(settingsControllerProvider).prefs['unused'], isTrue);
      final Completer<void> gate = Completer<void>();
      server.holdRead = gate;
      final Future<void> reread = a.sync.sync(); // the window was focused
      await _settle();
      await a.settings.toggle('unused'); // → false, while the read is out
      await _settle();
      gate.complete(); // the read answers the value from before the toggle
      await reread;
      await _settle();
      expect(a.c.read(settingsControllerProvider).prefs['unused'], isFalse);
      expect(server.values['switch.unused'], false);
    },
  );

  test(
    "🔴 finding 5: user A's in-flight read never writes into user B",
    () async {
      final _Server server = _Server()..elsewhere('currencyCode', 'INR');
      final Completer<void> gate = Completer<void>();
      server.holdRead = gate; // A's sign-in read is slow
      final _Device d = _Device(server);
      await _settle();
      expect(server.reads, 1, reason: "A's read is out");
      server.rows.clear(); // B's account holds nothing
      d.users.add(const core.AuthUser(id: 'b', email: 'b@example.test'));
      await _settle();
      gate.complete(); // A's read answers INR now
      await _settle();
      expect(d.c.read(settingsControllerProvider).currencyCode, 'USD');
    },
  );

  test(
    '🔴 delta finding 1: sign-out resets ONLY what the account holds, and signing in restores it',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      await _settle();
      await a.settings.setCurrency('EUR'); // sent: the account holds it
      await setThemeModeByUserWith(a.c.read, ThemeMode.dark); // held too
      await _settle();
      expect(server.values['currencyCode'], 'EUR');

      // Resolved before the sign-out, run after it — as userStateDrops lists it.
      final UserStateDrop drop = forgetAccountPreferencesWith(a.c.read);
      a.users.add(null);
      await drop();
      await _settle();
      final core.DurableOutbox outbox = core.preferencesOutbox(
        Future<core.KeyValueStore>.value(a.store),
      );
      expect(await outbox.entries(owner: 'me'), isEmpty);
      expect(
        a.store.data.keys.where(
          (String k) => k.startsWith('nikatru.prefs.versions'),
        ),
        isEmpty,
      );
      expect(a.c.read(settingsControllerProvider).currencyCode, 'USD');
      expect(a.c.read(themeModeProvider), ThemeMode.system);

      a.users.add(_me); // the same account signs back in
      await _settle();
      expect(a.c.read(settingsControllerProvider).currencyCode, 'EUR');
      expect(a.c.read(themeModeProvider), ThemeMode.dark);
    },
  );

  test(
    '🔴 delta finding 1: currency and reminders chosen while signed out survive a sign-in and a sign-out',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server, user: null);
      await _settle();
      await a.settings.setCurrency('EUR');
      await a.settings.setReminderLead(7);
      await a.settings.setReminderTime(7, 0);
      await _settle();

      a.users.add(_me);
      await _settle();
      expect(server.patches, 0, reason: 'a signed-out choice is never sent');

      final UserStateDrop drop = forgetAccountPreferencesWith(a.c.read);
      a.users.add(null);
      await drop();
      await _settle();
      final SettingsState s = a.c.read(settingsControllerProvider);
      expect(s.currencyCode, 'EUR');
      expect(s.reminderLeadDays, 7);
      expect(s.reminderMinuteOfDay, 7 * 60);
    },
  );

  test(
    '🔴 finding 6: a refused change is dropped and said ONCE, and the account value comes back',
    () async {
      final _Server server = _Server()..elsewhere('reminderLeadDays', 3);
      final _Device a = _Device(server);
      await _settle();
      server.failWith = 400;
      await a.settings.setReminderLead(7);
      await _settle();
      server.failWith = null;
      await a.sync.sync();
      await a.sync.sync();
      await _settle();
      expect(
        <String>[
          for (final PreferenceNotice n in a.c.read(preferenceNoticesProvider))
            '${n.kind.name}:${n.key}',
        ],
        <String>['refused:reminderLeadDays'],
      );
      expect(a.c.read(settingsControllerProvider).reminderLeadDays, 3);
    },
  );

  test(
    '🔴 review 3 finding 1: A signs out before the sync — B sees the default and never sends it; A signs back in and gets it',
    () async {
      final _Server server = _Server();
      final _Device d = _Device(server);
      await _settle();
      server.failWith = 0; // A is offline
      await setLocaleByUserWith(d.c.read, const Locale('ta'));
      await _settle();
      expect(d.c.read(localeProvider), const Locale('ta'));

      final UserStateDrop drop = forgetAccountPreferencesWith(d.c.read);
      d.users.add(null);
      await drop();
      await _settle();
      server.failWith = null; // online again before B arrives
      d.users.add(const core.AuthUser(id: 'b', email: 'b@example.test'));
      await _settle();
      await d.sync.sync();
      await _settle();
      expect(
        d.c.read(localeProvider),
        isNull,
        reason: "B is not shown A's language",
      );
      expect(
        server.patches,
        0,
        reason: "A's queued change is never sent under B",
      );
      expect(server.values.containsKey('locale'), isFalse);

      final UserStateDrop dropB = forgetAccountPreferencesWith(d.c.read);
      d.users.add(null);
      await dropB();
      d.users.add(_me); // A signs back in
      await _settle();
      await d.sync.sync();
      await _settle();
      expect(
        server.values['locale'],
        'ta',
        reason: "A's change is delivered to A",
      );
      expect(d.c.read(localeProvider), const Locale('ta'));
    },
  );

  test(
    '🔴 review 3 finding 2: held and unheld keys together — only the held and pending ones reset',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server, user: null);
      await _settle();
      // Device choices, made while signed out: never the account's.
      await a.settings.setCurrency('EUR');
      await a.settings.setReminderLead(7);
      await a.settings.setReminderTime(7, 0);
      await a.settings.toggle('priceHike'); // true -> false
      await _settle();

      a.users.add(_me);
      await _settle();
      await setThemeModeByUserWith(a.c.read, ThemeMode.dark); // held
      await a.settings.toggle('unused'); // true -> false, held
      await _settle();
      expect(server.values['themeMode'], 'dark');
      expect(server.values['switch.unused'], false);

      final UserStateDrop drop = forgetAccountPreferencesWith(a.c.read);
      a.users.add(null);
      await drop();
      await _settle();
      final SettingsState s = a.c.read(settingsControllerProvider);
      expect(
        a.c.read(themeModeProvider),
        ThemeMode.system,
        reason: 'held: reset',
      );
      expect(
        s.prefs['unused'],
        isTrue,
        reason: 'held switch: back to its default',
      );
      expect(s.currencyCode, 'EUR', reason: 'never the account: kept');
      expect(s.reminderLeadDays, 7);
      expect(s.reminderMinuteOfDay, 7 * 60);
      expect(s.prefs['priceHike'], isFalse, reason: 'unheld switch: kept');
    },
  );

  testWidgets(
    '🔴 delta finding 3: a conflict the server won is one line naming the setting',
    (WidgetTester tester) async {
      final ProviderContainer c = ProviderContainer();
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PreferenceRefusedNotice(child: Scaffold(body: SizedBox())),
          ),
        ),
      );
      c
          .read(preferenceNoticesProvider.notifier)
          .raise(PreferenceNoticeKind.conflict, 'currencyCode');
      await tester.pump();
      expect(
        find.text('Currency was changed on another device.'),
        findsOneWidget,
      );
    },
  );

  test(
    '🔴 delta finding 3: through the real providers, a lost change raises the notice',
    () async {
      final _Server server = _Server()..elsewhere('currencyCode', 'INR');
      final _Device a = _Device(server);
      server.failWith = 0;
      await _settle(); // the sign-in read fails: this device never saw INR
      await a.settings.setCurrency('EUR'); // based on nothing
      await _settle();
      server.failWith = null;
      await a.sync.sync();
      await _settle();
      expect(a.c.read(settingsControllerProvider).currencyCode, 'INR');
      expect(
        <String>[
          for (final PreferenceNotice n in a.c.read(preferenceNoticesProvider))
            '${n.kind.name}:${n.key}',
        ],
        <String>['conflict:currencyCode'],
      );
    },
  );

  testWidgets('the refusal is one line on screen', (WidgetTester tester) async {
    final ProviderContainer c = ProviderContainer();
    addTearDown(c.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: c,
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: PreferenceRefusedNotice(child: Scaffold(body: SizedBox())),
        ),
      ),
    );
    c
        .read(preferenceNoticesProvider.notifier)
        .raise(PreferenceNoticeKind.refused, 'reminderLeadDays');
    await tester.pump();
    expect(
      find.text("Couldn’t save that setting to your account."),
      findsOneWidget,
    );
  });

  testWidgets(
    '🔴 review 3 nit: a notice raised before any screen shows when one attaches, and a second for the same setting is not hidden',
    (WidgetTester tester) async {
      final ProviderContainer c = ProviderContainer();
      addTearDown(c.dispose);
      // Raised at sign-in, before the shell exists — twice for one setting.
      c
          .read(preferenceNoticesProvider.notifier)
          .raise(PreferenceNoticeKind.conflict, 'currencyCode');
      c
          .read(preferenceNoticesProvider.notifier)
          .raise(PreferenceNoticeKind.conflict, 'currencyCode');
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: const MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: PreferenceRefusedNotice(child: Scaffold(body: SizedBox())),
          ),
        ),
      );
      await tester.pump();
      const String line = 'Currency was changed on another device.';
      expect(find.text(line), findsOneWidget, reason: 'the first, buffered');
      tester
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
          .hideCurrentSnackBar();
      await tester.pumpAndSettle();
      expect(find.text(line), findsOneWidget, reason: 'the second, not hidden');
      tester
          .state<ScaffoldMessengerState>(find.byType(ScaffoldMessenger))
          .hideCurrentSnackBar();
      await tester.pumpAndSettle();
      expect(find.text(line), findsNothing);
      expect(c.read(preferenceNoticesProvider), isEmpty);
    },
  );

  test(
    'review 3 nit: each setting has its own sentence — "Notifications were changed"',
    () {
      final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
      String line(String key) =>
          PreferenceRefusedNotice.changedElsewhereOf(en, key);
      expect(
        line(kPrefCurrencyCode),
        'Currency was changed on another device.',
      );
      expect(line(kPrefThemeMode), 'Appearance was changed on another device.');
      expect(line(kPrefLocale), 'Language was changed on another device.');
      expect(
        line(kPrefReminderLeadDays),
        'Reminder settings were changed on another device.',
      );
      expect(
        line(kPrefReminderMinuteOfDay),
        'Reminder settings were changed on another device.',
      );
      expect(
        line('switch.priceHike'),
        'Notifications were changed on another device.',
      );
    },
  );

  test(
    '🔴 review 4 of #1080: a notice queued for one user is never shown to the next',
    () async {
      final _Server server = _Server();
      final _Device d = _Device(server);
      await _settle();
      final PreferenceNotices notices = d.c.read(
        preferenceNoticesProvider.notifier,
      );
      notices.raise(PreferenceNoticeKind.conflict, 'currencyCode');
      expect(d.c.read(preferenceNoticesProvider), hasLength(1));
      // Signed out with no screen to show it — a forced 401 runs no drop.
      d.users.add(null);
      await _settle();
      expect(d.c.read(preferenceNoticesProvider), isEmpty);

      // And a switch straight to another account.
      d.users.add(_me);
      await _settle();
      notices.raise(PreferenceNoticeKind.refused, 'locale');
      d.users.add(const core.AuthUser(id: 'b', email: 'b@example.test'));
      await _settle();
      expect(d.c.read(preferenceNoticesProvider), isEmpty);

      // A notice raised for the user who is signed in stays for them.
      notices.raise(PreferenceNoticeKind.conflict, 'themeMode');
      await _settle();
      expect(d.c.read(preferenceNoticesProvider), hasLength(1));
    },
  );

  testWidgets(
    '🔴 finding 10a/b: a return to the app reads the account — another device’s change arrives',
    (WidgetTester tester) async {
      // Everything here is microtasks (no real I/O), so pumping is settling.
      Future<void> pumps() async {
        for (int i = 0; i < 40; i++) {
          await tester.pump();
        }
      }

      final _Server server = _Server();
      final _Device b = _Device(server);
      late WidgetRef captured;
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: b.c,
          child: Consumer(
            builder: (BuildContext context, WidgetRef ref, _) {
              captured = ref;
              return const SizedBox();
            },
          ),
        ),
      );
      await pumps();
      server.elsewhere('switch.weekly', true); // device A, meanwhile
      final int readsBefore = server.reads;
      final Future<void> returned = refreshOnReturn(captured);
      await pumps();
      await returned;
      expect(server.reads, readsBefore + 1);
      expect(b.c.read(settingsControllerProvider).prefs['weekly'], isTrue);
    },
  );
}
