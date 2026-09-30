// ⏱ 2026-09-30 · ST-N6 (D11) — PREFERENCES FOLLOW THE ACCOUNT. Re-exported
// from `../providers.dart`.
//
// Currency, theme, language and the reminder choices lived in this device's
// key-value store only: a second device met the defaults, and a change on one
// never reached the other. `core.AccountPreferencesSync` decides when the
// account's copy (GET/PUT /v1/preferences on this app's Worker) is read and
// written; this file only names Subly's preferences and applies them. The
// device store stays the cache first paint reads.
//
// ⚠️ WHY THIS IS APP WIRING AND NOT THE BRICK'S (yet): the store is a row in
// the app's OWN Worker, and a default stamp claims no Worker at all
// (assert-clone-contract). The decision and the transport are shared
// (packages/core, packages/api_client); the brick adopts them the day it has a
// server to hold the row.

import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show RestAccountPreferencesTransport, RestClient;
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/app_config.dart';
import '../settings_controller.dart';
import 'auth.dart';
import 'config.dart';
import 'preferences.dart';
import 'subscriptions.dart' show apiBaseFor;

/// The account's preferences on this app's Worker — null in a build with no
/// API, where there is no account copy to follow.
final Provider<core.AccountPreferencesTransport?>
accountPreferencesTransportProvider =
    Provider<core.AccountPreferencesTransport?>((ref) {
      if (!AppConfig.isApiConfigured) return null;
      final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
      return RestAccountPreferencesTransport(
        RestClient(
          // The SAME host the subscription list is read from.
          baseUrl: apiBaseFor(
            pinned: AppConfig.pinnedBackend,
            configured: cfg?.apiBaseUrl,
            define: AppConfig.apiBaseUrl,
          ),
          tokenProvider: ref.watch(authTokenProvider),
          onUnauthorized: () =>
              signOutOnlyIfSessionIsGone(ref.read(authRepositoryProvider)),
        ),
      );
    });

/// The document this device would write: the settings the store already
/// keeps, plus the theme and the language.
Map<String, Object?> accountPreferencesOf(
  SettingsState settings,
  ThemeMode theme,
  Locale? locale,
) => <String, Object?>{
  ...settings.toJson(),
  // The enum's own name, which is also the device store's spelling.
  'themeMode': theme.name,
  // '' is "follow the device" — a choice, and it follows the account too.
  'locale': locale?.languageCode ?? '',
};

/// Keeps this device's preferences and the signed-in account's in step.
///
/// WATCHED FOR ITS EFFECT from `SublyApp` — the listeners below are the
/// whole of it. Null in a build with no API.
final Provider<core.AccountPreferencesSync?> accountPreferencesSyncProvider =
    Provider<core.AccountPreferencesSync?>((ref) {
      final core.AccountPreferencesTransport? transport = ref.watch(
        accountPreferencesTransportProvider,
      );
      if (transport == null) return null;
      final core.AccountPreferencesSync sync = core.AccountPreferencesSync(
        transport: transport,
        snapshot: () => accountPreferencesOf(
          ref.read(settingsControllerProvider),
          ref.read(themeModeProvider),
          ref.read(localeProvider),
        ),
        apply: (Map<String, Object?> account) async {
          await ref
              .read(settingsControllerProvider.notifier)
              .applyAccount(account);
          final Object? theme = account['themeMode'];
          if (theme is String) {
            await ref
                .read(themeModeProvider.notifier)
                .set(ThemeMode.values.asNameMap()[theme] ?? ThemeMode.system);
          }
          final Object? locale = account['locale'];
          if (locale is String) {
            await ref
                .read(localeProvider.notifier)
                .set(locale.isEmpty ? null : Locale(locale));
          }
        },
        localReady: () async {
          await ref.read(settingsControllerProvider.notifier).hydration;
          await ref.read(themeModeProvider.notifier).hydrated;
          await ref.read(localeProvider.notifier).hydrated;
        },
      );

      // Identity: a settled sign-in reads the account's copy; a sign-out or a
      // switch to another account forgets the last one first.
      ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (prev, next) {
        if (!next.hasValue) return;
        final String? was = prev?.value?.id;
        final String? now = next.value?.id;
        if (was != null && was != now) sync.onSignedOut();
        if (now == null) {
          sync.onSignedOut();
        } else if (was != now || !sync.isSynced) {
          sync.onSignedIn();
        }
      }, fireImmediately: true);

      // Every local change is offered; the sync writes only a real one.
      ref.listen(settingsControllerProvider, (_, _) => sync.onLocalChange());
      ref.listen(themeModeProvider, (_, _) => sync.onLocalChange());
      ref.listen(localeProvider, (_, _) => sync.onLocalChange());
      return sync;
    });
