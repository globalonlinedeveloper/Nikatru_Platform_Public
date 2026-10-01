// SECTION · THE HOME-CURRENCY RATE TABLE (T12, IN-06;
// O-ST-FX-RATES-UNUSED-BY-THE-APP). Re-exported from `../providers.dart`.
//
// The platform Worker serves the ECB's euro reference rates nightly at
// `GET /v1/fx/latest`, and `packages/core`'s FxTable converts with them; until
// this file nothing in the app asked for either. The mechanics are shared —
// `core.FxRatesLoader` (cache, offline, the hour) and
// `nikatru_api_client`'s `DioFxTransport` — and this is only the wiring plus
// the ONE rate a user may set by hand.

import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart' show DioFxTransport;
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show PersistedValue;

import '../../core/app_config.dart';
import '../../core/format/home_totals.dart';
import '../analytics_providers.dart';
import '../settings_controller.dart' show currencyCodeProvider;
import 'analytics_envelope.dart' show kPlatformBaseUrl;

/// `GET /v1/fx/latest` on the shared platform Worker. PUBLIC, so it needs a
/// live platform, not a session; off a live backend (demo builds, every widget
/// test) it is the unavailable transport and the app converts nothing.
final Provider<core.FxTransport> fxTransportProvider =
    Provider<core.FxTransport>(
      (ref) => AppConfig.isBackendLive
          ? DioFxTransport(platformBaseUrl: kPlatformBaseUrl)
          : const core.UnavailableFxTransport(),
    );

const String _fxOverrideKey = 'nikatru.fx_override';

/// The ONE rate the user set by hand, `FROM/TO` → how many TO one FROM buys
/// (`USD/INR: 88`), or empty. It wins over the ECB table for that pair in both
/// directions (`core.FxTable`'s override rule) — a user who knows what their
/// card charged is the better source for their own total.
class FxOverrideController extends Notifier<Map<String, num>> {
  late final PersistedValue<core.KeyValueStore, Map<String, num>> _stored =
      PersistedValue<core.KeyValueStore, Map<String, num>>(
        open: () => ref.read(keyValueStoreProvider.future),
        read: (kv) => kv.read(_fxOverrideKey),
        write: (kv, raw) => kv.write(_fxOverrideKey, raw),
        decode: _decode,
        encode: (Map<String, num> m) => jsonEncode(m),
        apply: (Map<String, num> m) => state = m,
        mounted: () => ref.mounted,
      );

  @override
  Map<String, num> build() {
    _stored.hydrate();
    return const <String, num>{};
  }

  /// One dollar is [rate] rupees: replaces any rate set before (ONE override).
  Future<void> set(String from, String to, num rate) =>
      _stored.set(<String, num>{core.FxTable.pairKey(from, to): rate});

  /// Back to the ECB table.
  Future<void> clear() => _stored.set(const <String, num>{});

  /// An unreadable or malformed value is "no override", never a wrong rate:
  /// `core.FxTable` would throw on a bad key, so only a valid pair survives.
  static Map<String, num> _decode(String? raw) {
    if (raw == null) return const <String, num>{};
    try {
      final Object? j = jsonDecode(raw);
      if (j is! Map) return const <String, num>{};
      final Map<String, num> out = <String, num>{};
      for (final MapEntry<Object?, Object?> e in j.entries) {
        final Object? k = e.key;
        final Object? v = e.value;
        if (k is String &&
            RegExp(r'^[A-Z]{3}/[A-Z]{3}$').hasMatch(k) &&
            k.substring(0, 3) != k.substring(4) &&
            v is num &&
            v.isFinite &&
            v > 0) {
          out[k] = v;
        }
      }
      return out;
    } catch (_) {
      return const <String, num>{};
    }
  }
}

final NotifierProvider<FxOverrideController, Map<String, num>>
fxOverrideProvider = NotifierProvider<FxOverrideController, Map<String, num>>(
  FxOverrideController.new,
);

/// The shared loader: the wire at most once an hour, the device copy between,
/// the last good table offline (with its own date).
final Provider<core.FxRatesLoader> fxRatesLoaderProvider =
    Provider<core.FxRatesLoader>(
      (ref) => core.FxRatesLoader(
        transport: ref.watch(fxTransportProvider),
        store: ref.watch(keyValueStoreProvider.future),
      ),
    );

/// The table every converted total is computed with, or null when no table
/// has ever been read (offline on a first launch, or a demo build) — and then
/// every total stays grouped by currency, exactly as before.
///
/// A user override with no table still converts its one pair: the table is
/// then built from the override alone, dated today, and the caption says the
/// user's rate rather than the ECB's.
final FutureProvider<core.FxTable?> fxTableProvider =
    FutureProvider<core.FxTable?>((ref) async {
      final Map<String, num> overrides = ref.watch(fxOverrideProvider);
      final core.FxTable? table = await ref
          .watch(fxRatesLoaderProvider)
          .load(overrides: overrides);
      if (table != null || overrides.isEmpty) return table;
      return core.FxTable(
        asOf: DateTime.now().toUtc(),
        ratesPerEuro: const <String, num>{},
        overrides: overrides,
      );
    });

/// The home-currency fold every Insights total reads: the table (when one has
/// been read) and the currency the user chose in Settings.
///
/// ⚠️ A FUNCTION OVER [WidgetRef], NOT A DERIVED `Provider`. A `Provider`
/// watching [fxTableProvider] schedules its own refresh when the table lands,
/// and that timer outlives a widget test that ends on the first frame; a
/// widget watching the table directly is just marked dirty.
HomeTotals homeTotalsOf(WidgetRef ref) => HomeTotals(
  ref.watch(fxTableProvider).value,
  ref.watch(currencyCodeProvider),
);
