import 'dart:convert';

import '../result.dart';
import '../storage/key_value_store.dart';
import 'fx_rates.dart';
import 'money.dart';
import 'money_bag.dart';

// ═════════════════════════════════════════════════════════════════════════════
// WHERE AN APP GETS ITS [FxTable] — the consumer half of ST-I3.
//
// The platform Worker has served `GET /v1/fx/latest` nightly since ST-I3 and
// [FxTable] could convert, yet nothing in any app ever asked for the table
// (O-ST-FX-RATES-UNUSED-BY-THE-APP). This is the seam every app fetches it
// through: a transport (the HTTP half lives in packages/api_client, ADR 005)
// and a loader that keeps the LAST GOOD table on the device, so an offline
// launch still converts — with the date of the table it converted at.
//
// 🔴 THE CACHE IS THE ANSWER OFFLINE, NOT A GUESS. A table is served from the
// device only as it was read from the wire, with its own `asOf`; the caption a
// screen prints from it is therefore still true. Nothing here invents a rate.
//
// ⚠️ ONE HOUR, LIKE THE ROUTE. The Worker answers `max-age=3600`; a cached table
// younger than [FxRatesLoader.maxAge] is served without a request, which is the
// same hour the edge would have answered from anyway.
// ═════════════════════════════════════════════════════════════════════════════

/// How an app reaches `GET /v1/fx/latest`. PUBLIC: no token, no app id.
abstract interface class FxTransport {
  /// The decoded body (contracts/fx/latest.v1.example.json `response`).
  Future<Result<Map<String, Object?>>> fetchLatest();
}

/// The default for demo builds, widget tests and any app with no backend.
class UnavailableFxTransport implements FxTransport {
  const UnavailableFxTransport();

  @override
  Future<Result<Map<String, Object?>>> fetchLatest() async =>
      const Result<Map<String, Object?>>.err(
        Failure('fx rates unavailable in this build'),
      );
}

/// The table: from the wire when the cached one is older than [maxAge], else
/// from the device; the last good one when the wire fails; null when neither
/// has ever answered.
class FxRatesLoader {
  FxRatesLoader({
    required FxTransport transport,
    required Future<KeyValueStore> store,
    DateTime Function()? clock,
    this.maxAge = const Duration(hours: 1),
  }) : _transport = transport,
       _store = store,
       _clock = clock ?? DateTime.now;

  final FxTransport _transport;
  final Future<KeyValueStore> _store;
  final DateTime Function() _clock;

  /// How long a cached table is served without asking the wire.
  final Duration maxAge;

  /// The device key the last good payload is kept under.
  static const String storeKey = 'fx.latest.v1';

  /// The table, with [overrides] (`FROM/TO` → rate) applied.
  Future<FxTable?> load({
    Map<String, num> overrides = const <String, num>{},
  }) async {
    final ({DateTime fetchedAt, Map<String, Object?> body})? cached =
        await _readCached();
    if (cached != null && _clock().difference(cached.fetchedAt) < maxAge) {
      final FxTable? t = FxTable.tryFromJson(cached.body, overrides: overrides);
      if (t != null) return t;
    }
    final Result<Map<String, Object?>> r = await _transport.fetchLatest();
    if (r is Ok<Map<String, Object?>>) {
      final FxTable? fresh = FxTable.tryFromJson(r.value, overrides: overrides);
      if (fresh != null) {
        await _writeCached(r.value);
        return fresh;
      }
    }
    // The wire failed or answered something unreadable: the last good table,
    // whatever its age — its `asOf` says how old it is.
    return cached == null
        ? null
        : FxTable.tryFromJson(cached.body, overrides: overrides);
  }

  Future<({DateTime fetchedAt, Map<String, Object?> body})?>
  _readCached() async {
    try {
      final String? raw = await (await _store).read(storeKey);
      if (raw == null) return null;
      final Object? j = jsonDecode(raw);
      if (j is! Map) return null;
      final Object? at = j['fetchedAt'];
      final Object? body = j['body'];
      final DateTime? fetchedAt = at is String ? DateTime.tryParse(at) : null;
      if (fetchedAt == null || body is! Map) return null;
      return (fetchedAt: fetchedAt, body: body.cast<String, Object?>());
    } catch (_) {
      // A store that is missing or unreadable is "nothing cached".
      return null;
    }
  }

  Future<void> _writeCached(Map<String, Object?> body) async {
    try {
      await (await _store).write(
        storeKey,
        jsonEncode(<String, Object?>{
          'fetchedAt': _clock().toUtc().toIso8601String(),
          'body': body,
        }),
      );
    } catch (_) {
      // The cache is an optimisation of the NEXT launch; a failed write costs
      // that launch one request and loses nothing the user typed.
    }
  }
}

/// A [MoneyBag] folded into one currency by an [FxTable].
class FxConvertedBag {
  const FxConvertedBag(this.bag, {required this.converted});

  /// The result: one entry in the target currency, plus one per currency the
  /// table could not price — never dropped, printed in its own unit.
  final MoneyBag bag;

  /// Whether any amount was actually converted (a caption is owed).
  final bool converted;
}

/// Converting whole totals — the step every "one total" figure takes.
extension FxTableBags on FxTable {
  /// [bag] in [to]: every amount the table can price is converted and summed;
  /// an amount it cannot price stays in its own currency, beside the total.
  FxConvertedBag convertBag(MoneyBag bag, String to) {
    final List<Money> inTarget = <Money>[];
    final List<Money> unpriced = <Money>[];
    bool converted = false;
    for (final Money m in bag.amounts) {
      final Money? c = convert(m, to);
      if (c == null) {
        unpriced.add(m);
      } else {
        if (m.currencyCode != to) converted = true;
        inTarget.add(c);
      }
    }
    // The target leads, so the one total is the first figure a reader sees.
    return FxConvertedBag(
      MoneyBag.sum(<Money>[...inTarget, ...unpriced]),
      converted: converted,
    );
  }
}
