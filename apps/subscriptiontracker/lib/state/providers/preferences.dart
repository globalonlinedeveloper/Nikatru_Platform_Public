// SECTION H of the spine — the user preferences the chassis persists: theme
// mode, locale, and whether first-run onboarding has been seen. Re-exported
// from `../providers.dart`.

import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show PersistedValue, localeOfTag;

import '../analytics_providers.dart';
import 'auth.dart' show authUserProvider;

// ═════════════════════════════════════════════════════════════════════════════
// SECTION H · USER PREFERENCES THE CHASSIS PERSISTS
// ═════════════════════════════════════════════════════════════════════════════

const String _themeModeKey = 'nikatru.theme_mode';

/// The user's light/dark/system choice, persisted ([pipeline C-14] via C-16).
///
/// WHY A PERSISTED OVERRIDE AT ALL: `MaterialApp` already defaults to
/// `ThemeMode.system`, so a stamped app follows the OS setting with no code. What
/// was missing is a user who wants dark while their phone is light — and the DoD
/// requires `theme` + `darkTheme` + a **persisted** themeMode.
///
/// Starts at [ThemeMode.system] and hydrates from storage in the background
/// rather than awaiting it, so first paint never blocks on disk.
class ThemeModeController extends Notifier<ThemeMode> {
  /// Hydration never overwrites a live choice: [PersistedValue] says why.
  late final PersistedValue<core.KeyValueStore, ThemeMode> _stored =
      PersistedValue<core.KeyValueStore, ThemeMode>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_themeModeKey),
        write: (kv, raw) => kv.write(_themeModeKey, raw),
        decode: _decode,
        encode: _encode,
        apply: (mode) => state = mode,
        mounted: () => ref.mounted,
      );

  @override
  ThemeMode build() {
    // Deliberately not awaited: see the class doc.
    _stored.hydrate();
    return ThemeMode.system;
  }

  /// Persist and apply a new choice. Applied in memory first so the UI responds
  /// immediately even if the write is slow or fails.
  Future<void> set(ThemeMode mode) => _stored.set(mode);

  static String _encode(ThemeMode m) => switch (m) {
    ThemeMode.light => 'light',
    ThemeMode.dark => 'dark',
    ThemeMode.system => 'system',
  };

  static ThemeMode _decode(String? raw) => switch (raw) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
}

final NotifierProvider<ThemeModeController, ThemeMode> themeModeProvider =
    NotifierProvider<ThemeModeController, ThemeMode>(ThemeModeController.new);

const String _localeKey = 'nikatru.locale';

/// The user's language choice, persisted — [pipeline C-13].
///
/// 🔴 NULL MEANS "FOLLOW THE DEVICE", and that is the important state. Storing a
/// concrete locale as the default would freeze every app to whatever language
/// the first launch happened to see, and a user who later changes their phone's
/// language would find the app ignoring them. So null is the default and is a
/// real, selectable option — not merely the absence of a choice.
class LocaleController extends Notifier<Locale?> {
  /// Hydration never overwrites a live choice: [PersistedValue] says why.
  late final PersistedValue<core.KeyValueStore, Locale?> _stored =
      PersistedValue<core.KeyValueStore, Locale?>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_localeKey),
        write: (kv, raw) => kv.write(_localeKey, raw),
        decode: _decode,
        encode: (locale) => locale?.toLanguageTag() ?? '',
        apply: (locale) => state = locale,
        mounted: () => ref.mounted,
      );

  @override
  Locale? build() {
    _stored.hydrate();
    return null;
  }

  /// Pass null to go back to following the device.
  Future<void> set(Locale? locale) => _stored.set(locale);

  static Locale? _decode(String? raw) =>
      (raw == null || raw.isEmpty) ? null : localeOfTag(raw);
}

final NotifierProvider<LocaleController, Locale?> localeProvider =
    NotifierProvider<LocaleController, Locale?>(LocaleController.new);

const String _onboardingSeenKey = 'nikatru.onboarding_seen';

/// Whether first-run onboarding has been completed or skipped — [pipeline C-13].
///
/// Persisted, because the cost of getting this wrong is asymmetric: showing it
/// twice is an irritation, and showing it never is a user who was dropped into
/// an app nobody introduced.
class OnboardingSeenController extends Notifier<bool?> {
  /// Hydration never overwrites a live choice: [PersistedValue] says why.
  late final PersistedValue<core.KeyValueStore, bool> _stored =
      PersistedValue<core.KeyValueStore, bool>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_onboardingSeenKey),
        write: (kv, raw) => kv.write(_onboardingSeenKey, raw),
        decode: (raw) => raw == 'true',
        encode: (seen) => seen ? 'true' : 'false',
        apply: (seen) => state = seen,
        mounted: () => ref.mounted,
        // Unreadable store ⇒ SHOW onboarding. Resolving to false rather than
        // staying null matters: null blocks the decision forever, and the cost
        // is asymmetric — showing it twice is an irritation, never showing it
        // drops the user into an app nobody introduced.
        onUnreadable: () => state = false,
      );

  /// 🔴 NULL MEANS "NOT KNOWN YET", AND IT IS NOT THE SAME AS FALSE. Hydration
  /// is async, so a plain `false` default meant the router's FIRST redirect —
  /// which runs before the disk read lands — saw "not onboarded" and sent a
  /// RETURNING user to the carousel. Nothing re-ran the redirect afterwards, so
  /// they were stuck there, and finishing it just wrote the flag they already
  /// had. Every launch. Found by the property test, not by reading the code.
  ///
  /// With three states the redirect can decline to decide until it knows, which
  /// is the only honest answer while the disk is still being read.
  @override
  bool? build() {
    _stored.hydrate();
    return null;
  }

  /// In memory FIRST ([PersistedValue.set]): the router's redirect reads this
  /// synchronously the moment the screen navigates away, and a slow write must
  /// not bounce the user straight back into onboarding.
  Future<void> set(bool seen) => _stored.set(seen);
}

final NotifierProvider<OnboardingSeenController, bool?> onboardingSeenProvider =
    NotifierProvider<OnboardingSeenController, bool?>(
      OnboardingSeenController.new,
    );

/// ⏱ ST-T9 (EN-18) — whether THIS ACCOUNT has seen the after-sign-in setup
/// (home currency, reminder channels, "pick what you pay for").
///
/// Keyed by the account, not the device: a second account on the same device
/// is a first sign-in too, and the same account on a second device is not
/// re-asked once that device has recorded it. (Account-level preferences
/// from #1080 replace the device store when they land; the key is the
/// account's either way.)
///
/// NULL while unknown — no account, or the store not read yet — and the
/// setup is offered only on a definite `false`, for the reason
/// [OnboardingSeenController] records: an undecided redirect must decline.
class SetupSeenController extends Notifier<bool?> {
  static String keyFor(String accountId) => 'nikatru.setup_seen.$accountId';

  @override
  bool? build() {
    final String? id = ref.watch(authUserProvider).value?.id;
    if (id == null) return null;
    _hydrate(id);
    return null;
  }

  Future<void> _hydrate(String id) async {
    bool seen;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      seen = await kv.read(keyFor(id)) == 'true';
    } on Object {
      // Unreadable ⇒ do NOT offer it: unlike onboarding, setup is optional
      // and everything in it is in Settings, so the asymmetric cost runs the
      // other way — nagging an existing account is the worse error.
      seen = true;
    }
    if (ref.mounted && state == null) state = seen;
  }

  /// Skip and finish alike: in memory first, then the store.
  Future<void> markSeen() async {
    state = true;
    final String? id = ref.read(authUserProvider).value?.id;
    if (id == null) return;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(keyFor(id), 'true');
    } on Object {
      // A failed write re-offers setup on the next launch, which Skip ends.
    }
  }
}

final NotifierProvider<SetupSeenController, bool?> setupSeenProvider =
    NotifierProvider<SetupSeenController, bool?>(SetupSeenController.new);
