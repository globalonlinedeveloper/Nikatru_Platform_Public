import 'dart:convert';
import 'dart:ui' show Locale;

import 'package:flutter/foundation.dart'
    show PlatformDispatcher, visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'analytics_providers.dart';
import 'providers.dart' show subscriptiontrackerNotificationServiceProvider;

/// Where the settings live on disk — the same [core.KeyValueStore] seam the
/// consent decision and the install id use ([ADR 005]). Namespaced like
/// [kInstallIdKey] so a stamped app's stores stay mutually legible.
const String kSettingsKey = 'nikatru.settings';

class SettingsState {
  const SettingsState({
    this.currencyCode = core.Money.fallbackCurrencyCode,
    this.prefs = const <String, bool>{
      'alerts': true,
      'priceHike': true,
      'unused': true,
      'weekly': false,
    },
  });

  /// The user's currency as an ISO 4217 code — the unit a NEW subscription is
  /// entered in, and the unit a stored figure that never carried a currency
  /// (a pre-migration row, a bare budget) is read under.
  ///
  /// 🔴 A CODE, NOT A GLYPH, AND ANY CODE IN THE MONEY TABLE. This was
  /// `currencySymbol`: one of four literal glyphs (`$ € £ ₹`) mapped back by a
  /// four-entry map, so a user in yen, Australian or Canadian dollars could not
  /// choose their currency at all — and `$` itself is written by three of them.
  /// The chooser now lists `core.Money.symbols`, the ONE table every formatter
  /// reads, and what is stored is the code the user picked.
  final String currencyCode;

  final Map<String, bool> prefs;

  /// Whether [code] is a currency the chooser offers — a row of the money
  /// table, and nothing else.
  static bool isChoosable(String code) => core.Money.symbols.containsKey(code);

  /// 🪦 THE OLD STORE SHAPE, READ ONCE AND NEVER WRITTEN. Installs that saved
  /// settings before the chooser stored a code hold `currencySymbol` with one
  /// of these four glyphs, and each meant exactly this code — it was a
  /// statement of what those four chips meant, not an inference from a glyph.
  /// Anything else in that key falls back rather than guessing.
  static const Map<String, String> _legacyCodeBySymbol = <String, String>{
    r'$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
  };

  /// The stored currency: the code when it is a table row, else the legacy
  /// glyph mapped once, else [fallback].
  static String _currencyFrom(
    Map<String, Object?> json, {
    required String fallback,
  }) {
    final Object? code = json['currencyCode'];
    if (code is String && isChoosable(code)) return code;
    final Object? legacy = json['currencySymbol'];
    if (legacy is String) {
      final String? mapped = _legacyCodeBySymbol[legacy];
      if (mapped != null) return mapped;
    }
    return fallback;
  }

  SettingsState copyWith({String? currencyCode, Map<String, bool>? prefs}) =>
      SettingsState(
        currencyCode: currencyCode ?? this.currencyCode,
        prefs: prefs ?? this.prefs,
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'currencyCode': currencyCode,
    'prefs': prefs,
  };

  /// [fallbackCurrencyCode] is the currency when the store holds no choice —
  /// the device region's, supplied by [SettingsController] (ST-C1).
  ///
  /// Merges the persisted values OVER the compiled-in defaults, so a pref key
  /// added in a later release still gets its default on old installs — the
  /// same "a missing key can never silently flip a user's notifications"
  /// rule ReminderPlan.from enforces. Non-bool junk is dropped, not trusted.
  factory SettingsState.fromJson(
    Map<String, Object?> json, {
    String fallbackCurrencyCode = core.Money.fallbackCurrencyCode,
  }) {
    const SettingsState defaults = SettingsState();
    final Object? prefs = json['prefs'];
    return SettingsState(
      currencyCode: _currencyFrom(json, fallback: fallbackCurrencyCode),
      prefs: <String, bool>{
        ...defaults.prefs,
        if (prefs is Map<String, Object?>)
          for (final MapEntry<String, Object?> e in prefs.entries)
            if (e.value is bool) e.key: e.value! as bool,
      },
    );
  }
}

/// Owns the user's preferences and — since 2026-08-01 — actually keeps them.
///
/// Before this, `build()` returned defaults and the toggles wrote nowhere, so
/// every launch reset the prefs — and worse than mere amnesia: the reset
/// `weekly: false` made SubscriptionsController's launch-time `_syncReminders`
/// CANCEL the Sunday digest the user had switched on last session. The exact
/// defect class this codebase's own comments condemn ("a switch that promises
/// a feature and delivers none"), now closed with the [ADR 005] store: hydrate
/// on build, write on every change, round-trip proven by
/// test/settings_wiring_test.dart.
class SettingsController extends Notifier<SettingsState> {
  /// Latched by the first user mutation. Hydration only applies the persisted
  /// state while this is false — a user who toggles faster than the disk read
  /// resolves must never have that choice overwritten by last session's state.
  bool _touched = false;

  late Future<void> _hydration;

  /// The currency a store with no choice in it starts in: the device region's
  /// (ST-C1, audit C31). Every install used to start in USD, so an Indian
  /// user's first ₹649 was typed, stored and totalled as dollars unless they
  /// found the chip first.
  late String _firstRunCurrency;

  @override
  SettingsState build() {
    _touched = false;
    _firstRunCurrency = core.Money.defaultCodeForRegion(
      ref.read(deviceRegionProvider),
    );
    _hydration = _hydrate();
    return SettingsState(currencyCode: _firstRunCurrency);
  }

  /// Completes when the persisted state (if any) has been applied. Tests await
  /// this instead of guessing at pump counts; production code never needs it —
  /// the state simply updates and listeners react.
  @visibleForTesting
  Future<void> get hydration => _hydration;

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(kSettingsKey);
      if (_touched) return;
      if (raw == null) {
        // 🔴 THE FIRST RUN'S DEFAULT IS WRITTEN ONCE, SO IT IS A CHOICE FROM
        // HERE ON. A live row carries no currency and is read in this one
        // (`DioApiClient`), so a default that moved with the device locale
        // would re-label every stored amount the day the locale changed.
        await _persist();
        return;
      }
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?> && !_touched) {
        state = SettingsState.fromJson(
          decoded,
          fallbackCurrencyCode: _firstRunCurrency,
        );
      }
    } catch (_) {
      // Unreadable or corrupt store — keep the compiled-in defaults. Settings
      // must never be able to break launch.
    }
  }

  /// Choose the user's currency by ISO 4217 [code].
  ///
  /// A code that is not a row of the money table is REFUSED with an
  /// [ArgumentError], never stored: the chooser cannot offer one, so reaching
  /// here with one is a bug in a caller, and storing it would label every new
  /// subscription in a currency no formatter knows.
  Future<void> setCurrency(String code) {
    if (!SettingsState.isChoosable(code)) {
      throw ArgumentError.value(code, 'code', 'not a currency the app offers');
    }
    _touched = true;
    state = state.copyWith(currencyCode: code);
    return _persist();
  }

  /// The prefs that cause something to be posted to the OS notification centre.
  /// `unused` only changes what the app draws for itself, so switching it on is
  /// not the user asking for notifications and must not spend the prompt.
  static const Set<String> _reminderBearing = <String>{'alerts', 'weekly'};

  Future<void> toggle(String key) async {
    _touched = true;
    final Map<String, bool> next = Map<String, bool>.of(state.prefs);
    final bool on = !(next[key] ?? false);
    next[key] = on;
    state = state.copyWith(prefs: next);
    await _persist();

    // 🔴 [pipeline 13]T-4 — THE IN-CONTEXT ASK. This is one of the only two
    // places in the app allowed to reach `requestPermissions()`, and it is
    // reachable ONLY from `SwitchListTile`'s callback: a real user gesture, on
    // the switch that names the feature being enabled. That gesture requirement
    // is not just good manners — on Web the permission request is REFUSED
    // outright unless it happens inside a user-gesture handler.
    //
    // Off is never an ask: turning a feature OFF cannot be a reason to prompt.
    if (on && _reminderBearing.contains(key)) {
      await ref
          .read(subscriptiontrackerNotificationServiceProvider)
          .requestPermissions();
    }
  }

  /// Fire-and-forget from the UI's point of view (the callbacks are
  /// VoidCallbacks), awaitable from tests. State is already updated when this
  /// runs, so a failed write costs persistence, never the current session.
  Future<void> _persist() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(kSettingsKey, jsonEncode(state.toJson()));
    } catch (_) {
      // Same contract as _hydrate: a broken store degrades to the pre-fix
      // in-memory behaviour rather than surfacing an error for a toggle.
    }
  }
}

final NotifierProvider<SettingsController, SettingsState>
settingsControllerProvider =
    NotifierProvider<SettingsController, SettingsState>(SettingsController.new);

/// The device's region (ISO 3166-1 alpha-2, e.g. `IN` from `en-IN`), or null
/// when no locale names one — the first preferred locale that has a country.
/// A provider so a test can pin it; the settings default reads it once.
final Provider<String?> deviceRegionProvider = Provider<String?>((ref) {
  for (final Locale l in PlatformDispatcher.instance.locales) {
    final String? c = l.countryCode;
    if (c != null && c.isNotEmpty) return c;
  }
  return null;
});

/// The user's chosen currency, as an ISO 4217 code.
///
/// 🔴 THIS REPLACED A `Provider<Currency>` THAT WAS A FORMATTER. That shape
/// hardcoded `en_US` grouping into every figure in the app and glued a bare
/// glyph to the front of it, because a provider has no `BuildContext` and so no
/// locale. Formatting now happens where the reader's locale is known and takes
/// a `MoneyFormatter(l10n.localeName)`; what a provider can honestly answer is
/// which currency the user picked, which is this.
final Provider<String> currencyCodeProvider = Provider<String>(
  (ref) => ref.watch(settingsControllerProvider).currencyCode,
);
