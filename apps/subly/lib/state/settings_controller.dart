import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../core/format/currency.dart';
import 'analytics_providers.dart';

/// Where the settings live on disk — the same [core.KeyValueStore] seam the
/// consent decision and the install id use ([ADR 005]). Namespaced like
/// [kInstallIdKey] so a stamped app's stores stay mutually legible.
const String kSettingsKey = 'nikatru.settings';

class SettingsState {
  const SettingsState({
    this.currencySymbol = r'$',
    this.prefs = const <String, bool>{
      'alerts': true,
      'priceHike': true,
      'unused': true,
      'weekly': false,
    },
  });

  final String currencySymbol;
  final Map<String, bool> prefs;

  SettingsState copyWith({String? currencySymbol, Map<String, bool>? prefs}) =>
      SettingsState(
        currencySymbol: currencySymbol ?? this.currencySymbol,
        prefs: prefs ?? this.prefs,
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'currencySymbol': currencySymbol,
    'prefs': prefs,
  };

  /// Merges the persisted values OVER the compiled-in defaults, so a pref key
  /// added in a later release still gets its default on old installs — the
  /// same "a missing key can never silently flip a user's notifications"
  /// rule ReminderPlan.from enforces. Non-bool junk is dropped, not trusted.
  factory SettingsState.fromJson(Map<String, Object?> json) {
    const SettingsState defaults = SettingsState();
    final Object? symbol = json['currencySymbol'];
    final Object? prefs = json['prefs'];
    return SettingsState(
      currencySymbol: symbol is String && symbol.isNotEmpty
          ? symbol
          : defaults.currencySymbol,
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

  @override
  SettingsState build() {
    _touched = false;
    _hydration = _hydrate();
    return const SettingsState();
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
      if (raw == null || _touched) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?> && !_touched) {
        state = SettingsState.fromJson(decoded);
      }
    } catch (_) {
      // Unreadable or corrupt store — keep the compiled-in defaults. Settings
      // must never be able to break launch.
    }
  }

  Future<void> setCurrency(String symbol) {
    _touched = true;
    state = state.copyWith(currencySymbol: symbol);
    return _persist();
  }

  Future<void> toggle(String key) {
    _touched = true;
    final Map<String, bool> next = Map<String, bool>.of(state.prefs);
    next[key] = !(next[key] ?? false);
    state = state.copyWith(prefs: next);
    return _persist();
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

/// The active [Currency], derived from the chosen symbol.
final Provider<Currency> currencyProvider = Provider<Currency>(
  (ref) => Currency(ref.watch(settingsControllerProvider).currencySymbol),
);
