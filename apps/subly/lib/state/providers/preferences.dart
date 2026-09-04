// SECTION H of the spine — the user preferences the chassis persists: theme
// mode, locale, and whether first-run onboarding has been seen. Re-exported
// from `../providers.dart`.

import 'package:flutter/material.dart' show Locale, ThemeMode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../analytics_providers.dart';

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
  /// Whether the user has made an explicit choice this session.
  ///
  /// 🔴 LOAD-BEARING, and found by the property test on its very first run.
  /// Hydration is async, so a user tapping Dark during launch could be overtaken
  /// by the disk read completing afterwards and resetting them to the stored
  /// value — the setting visibly snapping back. Hydration must never overwrite a
  /// live choice.
  bool _userChose = false;

  @override
  ThemeMode build() {
    // Deliberately not awaited: see the class doc.
    _hydrate();
    return ThemeMode.system;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final ThemeMode stored = _decode(await kv.read(_themeModeKey));
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ keep following the OS. Never throw at launch.
    }
  }

  /// Persist and apply a new choice. Applied in memory first so the UI responds
  /// immediately even if the write is slow or fails.
  Future<void> set(ThemeMode mode) async {
    _userChose = true;
    state = mode;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_themeModeKey, _encode(mode));
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
  }

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
  bool _userChose = false;

  @override
  Locale? build() {
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(_localeKey);
      if (_userChose) return; // the user got there first — never clobber
      state = _decode(raw);
    } catch (_) {
      // Unreadable store ⇒ follow the device. Never throw at launch.
    }
  }

  /// Pass null to go back to following the device.
  Future<void> set(Locale? locale) async {
    _userChose = true;
    state = locale;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_localeKey, locale?.languageCode ?? '');
    } catch (_) {
      // Best-effort: a failed write only means the choice resets next launch.
    }
  }

  static Locale? _decode(String? raw) =>
      (raw == null || raw.isEmpty) ? null : Locale(raw);
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
  bool _userChose = false;

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
    _hydrate();
    return null;
  }

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final bool stored = (await kv.read(_onboardingSeenKey)) == 'true';
      if (_userChose) return; // the user got there first — never clobber
      state = stored;
    } catch (_) {
      // Unreadable store ⇒ SHOW onboarding. Resolving to false rather than
      // staying null matters: null blocks the decision forever, and the cost is
      // asymmetric — showing it twice is an irritation, never showing it drops
      // the user into an app nobody introduced.
      if (!_userChose) state = false;
    }
  }

  Future<void> set(bool seen) async {
    _userChose = true;
    // In memory FIRST: the router's redirect reads this synchronously the
    // moment the screen navigates away, and a slow write must not bounce the
    // user straight back into onboarding.
    state = seen;
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(_onboardingSeenKey, seen ? 'true' : 'false');
    } catch (_) {
      // Best-effort: a failed write only means it is shown once more.
    }
  }
}

final NotifierProvider<OnboardingSeenController, bool?> onboardingSeenProvider =
    NotifierProvider<OnboardingSeenController, bool?>(
      OnboardingSeenController.new,
    );
