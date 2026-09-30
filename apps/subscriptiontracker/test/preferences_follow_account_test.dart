import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

/// ⏱ 2026-09-30 · ST-N6 (D11) — preferences follow the account.
///
/// Two "devices" are two containers with two separate device stores, joined
/// only by one fake `/v1/preferences`. On the base the preferences never left
/// the device, so device B signs in to the defaults.

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

/// One account's row on the Worker.
class _Account implements core.AccountPreferencesTransport {
  Map<String, Object?>? stored;
  int writes = 0;

  @override
  Future<core.Result<Map<String, Object?>?>> read() async =>
      core.Result<Map<String, Object?>?>.ok(stored);

  @override
  Future<core.Result<void>> write(Map<String, Object?> preferences) async {
    writes++;
    stored = Map<String, Object?>.of(preferences);
    return const core.Result<void>.ok(null);
  }
}

const core.AuthUser _me = core.AuthUser(id: 'me', email: 'me@example.test');

ProviderContainer _device(_Account account, {core.AuthUser? user = _me}) {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWith((_) async => _MemStore()),
      deviceRegionProvider.overrideWithValue('US'),
      authUserProvider.overrideWith((_) => Stream<core.AuthUser?>.value(user)),
      accountPreferencesTransportProvider.overrideWithValue(account),
    ],
  );
  addTearDown(c.dispose);
  // As SublyApp does: watched for its effect.
  c.listen(accountPreferencesSyncProvider, (_, _) {});
  return c;
}

void main() {
  test('written on device A, they hydrate on device B after sign-in', () async {
    final _Account account = _Account();

    final ProviderContainer a = _device(account);
    await pumpEventQueue();
    await a.read(settingsControllerProvider.notifier).setCurrency('EUR');
    await a.read(themeModeProvider.notifier).set(ThemeMode.dark);
    await a.read(localeProvider.notifier).set(const Locale('ta'));
    await a.read(settingsControllerProvider.notifier).setReminderLead(3);
    await pumpEventQueue();

    final ProviderContainer b = _device(account);
    await pumpEventQueue();

    expect(b.read(settingsControllerProvider).currencyCode, 'EUR');
    expect(b.read(themeModeProvider), ThemeMode.dark);
    expect(b.read(localeProvider), const Locale('ta'));
    expect(b.read(settingsControllerProvider).reminderLeadDays, 3);
  });

  test("device B's untouched defaults do not overwrite the account", () async {
    final _Account account = _Account()
      ..stored = <String, Object?>{'currencyCode': 'INR', 'themeMode': 'dark'};
    final ProviderContainer b = _device(account);
    await pumpEventQueue();
    expect(account.stored?['currencyCode'], 'INR');
    expect(b.read(settingsControllerProvider).currencyCode, 'INR');
    expect(account.writes, 0, reason: 'applying the account wrote it back');
  });

  test('signed out, nothing is read or written', () async {
    final _Account account = _Account()
      ..stored = <String, Object?>{'currencyCode': 'INR'};
    final ProviderContainer c = _device(account, user: null);
    await pumpEventQueue();
    await c.read(settingsControllerProvider.notifier).setCurrency('EUR');
    await pumpEventQueue();
    expect(c.read(settingsControllerProvider).currencyCode, 'EUR');
    expect(account.stored, <String, Object?>{'currencyCode': 'INR'});
  });
}
