// ⏱ 2026-09-30 · ST-N6 (D11) — PREFERENCES FOLLOW THE ACCOUNT, PER KEY.
// Re-exported from `../providers.dart`.
//
// `core.AccountPreferencesSync` decides when a change is sent and when the
// account's values are applied (read its header for the model). This file
// only NAMES Subly's preferences, reports the user's own changes to it, and
// applies the account's values to the three stores that hold them:
// SettingsController (currency and the reminder choices), the theme and the
// language. The device stores stay the cache first paint reads.
//
// 🔴 A KEY IS SENT ONLY BECAUSE THE USER SET IT HERE. The report is made at the
// user's own gestures — the settings mutations and [setThemeModeByUser] /
// [setLocaleByUser] — never from a state listener, so a disk hydration, a
// default, or a value the account itself just applied is never sent back.
//
// ⚠️ WHY THIS IS APP WIRING AND NOT THE BRICK'S (yet): the rows live in the
// app's OWN Worker, and a default stamp claims no Worker at all
// (assert-clone-contract). The decision and the queue are shared
// (packages/core AccountPreferencesSync over DurableOutbox, packages/api_client
// RestAccountPreferencesTransport); the brick adopts them the day it has a
// server to hold the rows.

import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show ProviderListenable;
import 'package:nikatru_api_client/nikatru_api_client.dart'
    show RestAccountPreferencesTransport, RestClient;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show localeOfTag;

import '../../core/app_config.dart';
import '../settings_controller.dart';
import 'auth.dart';
import 'config.dart';
import '../analytics_providers.dart' show keyValueStoreProvider;
import 'preferences.dart';
import 'subscriptions.dart' show apiBaseFor;

/// The preference keys this app sends — the contract
/// `services/subscriptiontracker-api/test/fixtures/preferences-contract.json`
/// pins against the Worker's validator.
const String kPrefCurrencyCode = 'currencyCode';
const String kPrefThemeMode = 'themeMode';
const String kPrefLocale = 'locale';
const String kPrefReminderLeadDays = 'reminderLeadDays';
const String kPrefReminderMinuteOfDay = 'reminderMinuteOfDay';

/// The key of one on/off switch in [SettingsState.prefs].
String switchPreferenceKey(String name) => 'switch.$name';

/// Every key and value this device would report for [settings], [theme] and
/// [locale] — what the contract test compares with the fixture.
Map<String, Object?> accountPreferenceValuesOf(
  SettingsState settings,
  ThemeMode theme,
  Locale? locale,
) => <String, Object?>{
  kPrefCurrencyCode: settings.currencyCode,
  // The enum's own name, which is also the device store's spelling.
  kPrefThemeMode: theme.name,
  // '' is "follow the device" — a choice, and it follows the account too.
  kPrefLocale: locale?.toLanguageTag() ?? '',
  kPrefReminderLeadDays: settings.reminderLeadDays,
  kPrefReminderMinuteOfDay: settings.reminderMinuteOfDay,
  for (final MapEntry<String, bool> e in settings.prefs.entries)
    switchPreferenceKey(e.key): e.value,
};

/// The account's preferences on this app's Worker — null in a build with no
/// API, where there is no account copy to follow. Rebuilt when the config
/// resolves; the sync reads it at CALL time, so a rebuild costs nothing.
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

/// Why a preference notice is shown.
enum PreferenceNoticeKind {
  /// The account REFUSED the change (review #1080 finding 6): it is dropped
  /// and the account's value comes back.
  refused,

  /// Another device had already changed it (delta finding 3): the account's
  /// value won and was applied here — a flip back is never silent.
  conflict,
}

/// One notice for one preference [key]. Each is its own object, so a second
/// notice for the same key is a second notice, never a repeat of the first.
class PreferenceNotice {
  const PreferenceNotice(this.kind, this.key);

  final PreferenceNoticeKind kind;
  final String key;
}

/// The notices raised and not yet shown, oldest first (review 3 of #1080).
///
/// 🔴 A QUEUE, NOT "THE LAST KEY". The last-key providers it replaces lost a
/// notice raised while no screen was listening (the send runs at sign-in,
/// before the shell is mounted) and hid a second notice for the same setting
/// (setting a provider to the value it holds notifies nobody). A notice waits
/// here until a screen takes it.
class PreferenceNotices extends Notifier<List<PreferenceNotice>> {
  @override
  List<PreferenceNotice> build() {
    // 🔴 A NOTICE BELONGS TO THE USER IT WAS RAISED FOR (review 4 of #1080).
    // Any change of signed-in user — every sign-out path, the forced 401 that
    // runs no drops included, and an account switch — empties the queue, so
    // the next person never sees the last one's "changed on another device".
    ref.listen<String?>(
      authUserProvider.select((AsyncValue<core.AuthUser?> u) => u.value?.id),
      (String? before, String? now) {
        if (before != now) state = const <PreferenceNotice>[];
      },
    );
    return const <PreferenceNotice>[];
  }

  void raise(PreferenceNoticeKind kind, String key) =>
      state = <PreferenceNotice>[...state, PreferenceNotice(kind, key)];

  /// Every waiting notice, oldest first; the queue is left empty.
  List<PreferenceNotice> takeAll() {
    final List<PreferenceNotice> taken = state;
    if (taken.isNotEmpty) state = const <PreferenceNotice>[];
    return taken;
  }
}

final NotifierProvider<PreferenceNotices, List<PreferenceNotice>>
preferenceNoticesProvider =
    NotifierProvider<PreferenceNotices, List<PreferenceNotice>>(
      PreferenceNotices.new,
    );

/// Keeps this device's preferences and the signed-in account's in step.
///
/// 🔴 IT WATCHES NOTHING (review #1080 finding 2c). It used to watch the
/// transport, which watches the config, so the offline banner's Retry rebuilt
/// it and dropped a change made offline. Everything is read at call time, and
/// the dirty set lives in the device store regardless. WATCHED FOR ITS EFFECT
/// from `SublyApp`; null in a build with no API.
final Provider<core.AccountPreferencesSync?> accountPreferencesSyncProvider =
    Provider<core.AccountPreferencesSync?>((ref) {
      if (ref.read(accountPreferencesTransportProvider) == null) return null;
      final Future<core.KeyValueStore> store = ref.read(
        keyValueStoreProvider.future,
      );
      String? currentUser() =>
          ref.mounted ? ref.read(authUserProvider).value?.id : null;
      final core.AccountPreferencesSync sync = core.AccountPreferencesSync(
        transport: () =>
            ref.mounted ? ref.read(accountPreferencesTransportProvider) : null,
        outbox: core.preferencesOutbox(store),
        store: store,
        currentUser: currentUser,
        apply: (Map<String, Object?> values) async {
          if (ref.mounted) await applyAccountPreferences(ref, values);
        },
        onRefused: (String key) {
          if (ref.mounted) {
            ref
                .read(preferenceNoticesProvider.notifier)
                .raise(PreferenceNoticeKind.refused, key);
          }
        },
        onConflict: (String key) {
          if (ref.mounted) {
            ref
                .read(preferenceNoticesProvider.notifier)
                .raise(PreferenceNoticeKind.conflict, key);
          }
        },
      );
      ref.onDispose(sync.dispose);
      // A settled sign-in — the first one, or a switch to another account —
      // sends what is waiting and reads the account.
      ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (prev, next) {
        if (!next.hasValue) return;
        final String? now = next.value?.id;
        if (now != null && prev?.value?.id != now) sync.sync();
      }, fireImmediately: true);
      return sync;
    });

/// Apply the account's [values] to the stores that hold them. Keys this build
/// does not know are ignored — they stay on the server, untouched, because
/// only changed keys are ever sent (review #1080 finding 1C).
Future<void> applyAccountPreferences(
  Ref ref,
  Map<String, Object?> values,
) async {
  final Map<String, Object?> settings = <String, Object?>{
    for (final MapEntry<String, Object?> e in values.entries)
      if (e.key == kPrefCurrencyCode ||
          e.key == kPrefReminderLeadDays ||
          e.key == kPrefReminderMinuteOfDay ||
          e.key.startsWith('switch.'))
        e.key: e.value,
  };
  if (settings.isNotEmpty) {
    await ref.read(settingsControllerProvider.notifier).applyAccount(settings);
  }
  final Object? theme = values[kPrefThemeMode];
  if (theme is String && ref.mounted) {
    await ref
        .read(themeModeProvider.notifier)
        .set(ThemeMode.values.asNameMap()[theme] ?? ThemeMode.system);
  }
  final Object? locale = values[kPrefLocale];
  if (locale is String && ref.mounted) {
    await ref
        .read(localeProvider.notifier)
        .set(locale.isEmpty ? null : localeOfTag(locale));
  }
}

/// Report that the user set [key] on THIS device. Never throws.
void reportPreferenceChange(Ref ref, String key, Object? value) {
  if (!ref.mounted) return;
  ref.read(accountPreferencesSyncProvider)?.changed(key, value);
}

/// The theme chooser: the user's own choice, stored and reported.
Future<void> setThemeModeByUser(WidgetRef ref, ThemeMode mode) =>
    setThemeModeByUserWith(ref.read, mode);

/// [setThemeModeByUser] over any provider reader.
Future<void> setThemeModeByUserWith(
  T Function<T>(ProviderListenable<T> provider) read,
  ThemeMode mode,
) async {
  await read(themeModeProvider.notifier).set(mode);
  read(accountPreferencesSyncProvider)?.changed(kPrefThemeMode, mode.name);
}

/// The language chooser: the user's own choice, stored and reported.
Future<void> setLocaleByUser(WidgetRef ref, Locale? locale) =>
    setLocaleByUserWith(ref.read, locale);

/// [setLocaleByUser] over any provider reader.
Future<void> setLocaleByUserWith(
  T Function<T>(ProviderListenable<T> provider) read,
  Locale? locale,
) async {
  await read(localeProvider.notifier).set(locale);
  read(
    accountPreferencesSyncProvider,
  )?.changed(kPrefLocale, locale?.toLanguageTag() ?? '');
}

/// The explicit sign-out's drop (review #1080 findings 4, 7; delta finding 1;
/// review 3 finding 1): the keys the leaving account HOLDS or has a change
/// PENDING for go back to the device's defaults, so the next person to sign in
/// here is shown nothing of theirs; every key the account never had — chosen
/// before this build or while signed out — keeps its value. The leaving user's
/// pending sends stay queued, bound to them, and are delivered at their next
/// sign-in. Resolved BEFORE the sign-out (see `userStateDrops`), so the user
/// id is the one leaving. A forced 401 does not run it at all.
///
/// [erase]: the ACCOUNT DELETION path (review 4 of #1080, finding 1). The
/// account is gone, so its pending sends are discarded with its id instead of
/// waiting for a sign-in that can never come.
UserStateDrop forgetAccountPreferences(WidgetRef ref, {bool erase = false}) =>
    forgetAccountPreferencesWith(ref.read, erase: erase);

/// [forgetAccountPreferences] over any provider reader (a container, a ref).
UserStateDrop forgetAccountPreferencesWith(
  T Function<T>(ProviderListenable<T> provider) read, {
  bool erase = false,
}) {
  final core.AccountPreferencesSync? sync = read(
    accountPreferencesSyncProvider,
  );
  final String? owner = read(authUserProvider).value?.id;
  final SettingsController settings = read(settingsControllerProvider.notifier);
  final ThemeModeController theme = read(themeModeProvider.notifier);
  final LocaleController locale = read(localeProvider.notifier);
  return () async {
    if (sync == null || owner == null) return; // no account copy to forget
    // 🔴 ONLY THE ACCOUNT'S KEYS: held (a version above 0) or pending (changed
    // while signed in as this user, not yet acknowledged). Those come back at
    // the next sign-in — the pending ones are sent then. Every other key was
    // never the account's and lives only on this device, so resetting it would
    // erase it for good (and quietly move the reminder schedule). Read BEFORE
    // forget, which deletes the record `heldKeys` reads.
    final Set<String> reset = <String>{
      ...await sync.heldKeys(owner),
      ...await sync.pendingKeys(owner),
    };
    await sync.forget(owner, erase: erase);
    await settings.resetKeys(reset);
    if (reset.contains(kPrefThemeMode)) await theme.set(ThemeMode.system);
    if (reset.contains(kPrefLocale)) await locale.set(null);
  };
}
