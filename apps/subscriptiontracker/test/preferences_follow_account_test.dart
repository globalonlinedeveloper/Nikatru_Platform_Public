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
    '🔴 findings 4/7: an explicit sign-out forgets the dirty set and resets the stores',
    () async {
      final _Server server = _Server();
      final _Device a = _Device(server);
      await _settle();
      server.failWith = 0;
      await a.settings.setCurrency('EUR');
      await setThemeModeByUserWith(a.c.read, ThemeMode.dark);
      await _settle();
      final core.DurableOutbox outbox = core.DurableOutbox(
        Future<core.KeyValueStore>.value(a.store),
        key: core.kPreferencesOutboxKey,
      );
      expect(await outbox.pending(owner: 'me'), hasLength(2));

      // Resolved before the sign-out, run after it — as userStateDrops lists it.
      final UserStateDrop drop = forgetAccountPreferencesWith(a.c.read);
      await drop();
      await _settle();
      expect(await outbox.entries(owner: 'me'), isEmpty);
      expect(
        a.store.data.keys.where(
          (String k) => k.startsWith('nikatru.prefs.versions'),
        ),
        isEmpty,
      );
      expect(a.c.read(settingsControllerProvider).currencyCode, 'USD');
      expect(a.c.read(themeModeProvider), ThemeMode.system);
    },
  );

  test(
    '🔴 finding 6: a refused change is dropped and said ONCE, and the account value comes back',
    () async {
      final _Server server = _Server()..elsewhere('reminderLeadDays', 3);
      final _Device a = _Device(server);
      await _settle();
      final List<String?> notices = <String?>[];
      a.c.listen(preferenceRefusedProvider, (_, String? k) => notices.add(k));
      server.failWith = 400;
      await a.settings.setReminderLead(7);
      await _settle();
      server.failWith = null;
      await a.sync.sync();
      await a.sync.sync();
      await _settle();
      expect(notices.whereType<String>(), <String>['reminderLeadDays']);
      expect(a.c.read(settingsControllerProvider).reminderLeadDays, 3);
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
    c.read(preferenceRefusedProvider.notifier).state = 'reminderLeadDays';
    await tester.pump();
    expect(
      find.text("Couldn’t save that setting to your account."),
      findsOneWidget,
    );
  });

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
