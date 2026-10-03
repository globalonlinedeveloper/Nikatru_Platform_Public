/// The subscription tracker's SERVICE CATALOGUE, read from a content pack
/// (ST-X5): which services exist, what category each is, how it bills, and
/// where a user goes to cancel it.
///
/// The pack is produced by `tooling/content_pipeline` from
/// `examples/service-catalogue/` and bundled into the app; this file is the
/// typed half — it turns the pack's `key -> string` shards into [ServiceEntry]
/// values and REFUSES a pack it cannot read honestly rather than serving a
/// partial catalogue.
///
/// ## The key shape
///
/// A content shard is `key -> non-empty string`, and the pipeline's QA stage
/// refuses two keys in one locale carrying identical copy (`intra-pack-dedup`),
/// so per-field keys (`svc.netflix.cycle` = "monthly" beside
/// `svc.spotify.cycle` = "monthly") cannot pass it. The catalogue is therefore:
///
/// | key                    | value                                         |
/// |------------------------|-----------------------------------------------|
/// | `catalogue.services`   | the index: comma-separated service ids        |
/// | `svc.<id>.name`        | display name, LOCALISED (falls back to `en`)  |
/// | `svc.<id>.facts`       | one JSON object — see below — not localised   |
/// | `svc.<id>.price.<ISO>` | OPTIONAL decimal major units, e.g. `"649.00"` |
///
/// `facts` is `{id, category, cycle, cancel_url, manage_play,
/// manage_appstore, notice_days, regions}`, plus — pack v2 (ST-T9) — an
/// `aliases` list of search-only names and an optional `logo` asset id. Both
/// are optional HERE so a v1 pack still reads; the v2 producer always writes
/// `aliases` (examples/service-catalogue/service-facts.schema.json). Its `id`
/// must equal the key's — that is what catches a record copied under the
/// wrong key.
///
/// ## Currency codes — the decision
///
/// A price key's code must be three upper-case letters AND a member of
/// [kServiceCatalogueCurrencies]. The list is deliberately SMALLER than ISO
/// 4217: it holds the codes the catalogue has been checked in (every entry is
/// two-decimal, except JPY at 0 and KWD at 3). ⏱ 2026-10-01: [Money]'s
/// precision now comes from the full ISO 4217 table
/// (`contracts/currency/iso4217.js`), so a code such as KRW would no longer be
/// mis-scaled — but widening THIS list is a content decision, made with the
/// prices it admits, not a side effect of that table.
library;

import 'dart:convert';

import '../money/money.dart';
import '../result.dart';
import 'content_pack.dart';

/// The closed category set. The recipe's `make-recipe.mjs` `CATEGORIES`
/// carries the same list; a category outside it is a refusal, never an
/// "other" bucket that silently absorbs a typo.
const Set<String> kServiceCategories = <String>{
  'ai', 'books', 'cloud', 'dating', 'education', 'entertainment', //
  'fitness', 'food', 'gaming', 'music', 'news', 'productivity', 'shopping', //
  'telecom',
};

/// Currencies a catalogue price may be written in — see the library doc for
/// why this is not the whole of ISO 4217.
const Set<String> kServiceCatalogueCurrencies = <String>{
  'AED', 'AUD', 'BDT', 'BRL', 'CAD', 'CHF', 'DKK', 'EUR', 'GBP', 'HKD', //
  'INR', 'JPY', 'KWD', 'LKR', 'MXN', 'MYR', 'NOK', 'NPR', 'NZD', 'PHP', //
  'PKR', 'PLN', 'SAR', 'SEK', 'SGD', 'THB', 'USD', 'ZAR',
};

/// How a service bills by default.
///
/// Not named `BillingCycle`: the Subscription Tracker's own model declares
/// that name, and core is imported unprefixed in places, so a second one here
/// would make every such import ambiguous.
enum ServiceCycle {
  monthly,
  yearly;

  /// The wire name, or null for anything else — an unknown cycle is refused,
  /// because guessing "monthly" would put a wrong renewal date on a real bill.
  static ServiceCycle? tryParse(String s) {
    for (final ServiceCycle c in ServiceCycle.values) {
      if (c.name == s) return c;
    }
    return null;
  }
}

/// One service in the catalogue.
class ServiceEntry {
  const ServiceEntry({
    required this.id,
    required this.name,
    required this.categoryId,
    required this.cycle,
    required this.cancelUrl,
    required this.playManageUrl,
    required this.appStoreManageUrl,
    required this.noticeDays,
    required this.regions,
    this.aliases = const <String>[],
    this.logo,
    Map<String, Money> prices = const <String, Money>{},
  }) : _prices = prices;

  /// Stable slug, e.g. `netflix`.
  final String id;

  /// Display name in the locale the catalogue was read for (falling back to
  /// `en`). A brand is TRANSLITERATED, never translated.
  final String name;

  /// One of [kServiceCategories].
  final String categoryId;

  final ServiceCycle cycle;

  /// The service's own https account/cancel page.
  final Uri cancelUrl;

  /// Google Play's subscription-management page, for a subscription bought
  /// through Play.
  final Uri playManageUrl;

  /// The App Store's subscription-management page, for one bought through
  /// Apple.
  final Uri appStoreManageUrl;

  /// Days before renewal a cancellation must land to avoid the next charge.
  final int noticeDays;

  /// ISO 3166-1 alpha-2 regions this service is offered in, or `{'*'}` for
  /// everywhere.
  final Set<String> regions;

  /// Other names a person searches this service by (lower case, never
  /// shown): an old brand, a short form, the product inside a bundle.
  final List<String> aliases;

  /// The manifest asset id of the service's licensed mark, or null — the app
  /// then draws its initials. Pack v2 ships none.
  final String? logo;

  final Map<String, Money> _prices;

  /// The catalogue's price in [currencyCode], or null when the pack carries
  /// none for that code. NULL IS THE COMMON ANSWER: a price ships only where
  /// a public price page was read, with its URL and date, during the run that
  /// authored it.
  Money? priceFor(String currencyCode) => _prices[currencyCode.toUpperCase()];

  /// Whether this service is offered in [region] (`*` = everywhere).
  bool availableIn(String region) =>
      regions.contains('*') || regions.contains(region.toUpperCase());

  /// Whether [query] (already trimmed and lower-cased) names this service:
  /// a substring of its display name, its id read as words, or an alias.
  bool _matches(String query) {
    if (name.toLowerCase().contains(query)) return true;
    if (id.replaceAll('_', ' ').contains(query)) return true;
    if (id.replaceAll('_', '').contains(query.replaceAll(' ', ''))) return true;
    for (final String a in aliases) {
      if (a.contains(query)) return true;
    }
    return false;
  }
}

/// The typed catalogue: every [ServiceEntry] the pack's index lists, in index
/// order.
class ServiceCatalogue {
  const ServiceCatalogue(this.entries);

  final List<ServiceEntry> entries;

  static const String indexKey = 'catalogue.services';

  /// The entries offered in [region] (ISO 3166-1 alpha-2, case-insensitive).
  List<ServiceEntry> forRegion(String region) => entries
      .where((ServiceEntry e) => e.availableIn(region))
      .toList(growable: false);

  /// Every entry, the ones [region] reaches FIRST (ST-T9, AD-03): services
  /// that name [region] explicitly, then the everywhere ones, then the rest —
  /// each group in index order. A null [region] is index order, which the
  /// producer already writes India-first.
  List<ServiceEntry> orderedFor(String? region) {
    if (region == null || region.isEmpty) return entries;
    final String r = region.toUpperCase();
    final List<ServiceEntry> local = <ServiceEntry>[];
    final List<ServiceEntry> global = <ServiceEntry>[];
    final List<ServiceEntry> rest = <ServiceEntry>[];
    for (final ServiceEntry e in entries) {
      if (e.regions.contains(r)) {
        local.add(e);
      } else if (e.regions.contains('*')) {
        global.add(e);
      } else {
        rest.add(e);
      }
    }
    return List<ServiceEntry>.unmodifiable(
        <ServiceEntry>[...local, ...global, ...rest]);
  }

  /// The entries [query] names, offline, in [orderedFor] order with names
  /// that START with the query ahead of names that merely contain it. A
  /// blank query is [orderedFor] itself.
  List<ServiceEntry> search(String query, {String? region}) {
    final List<ServiceEntry> ordered = orderedFor(region);
    final String q = query.trim().toLowerCase();
    if (q.isEmpty) return ordered;
    final List<ServiceEntry> prefix = <ServiceEntry>[];
    final List<ServiceEntry> other = <ServiceEntry>[];
    for (final ServiceEntry e in ordered) {
      if (!e._matches(q)) continue;
      (e.name.toLowerCase().startsWith(q) ? prefix : other).add(e);
    }
    return List<ServiceEntry>.unmodifiable(<ServiceEntry>[...prefix, ...other]);
  }

  /// The entry with [id], or null.
  ServiceEntry? byId(String id) {
    for (final ServiceEntry e in entries) {
      if (e.id == id) return e;
    }
    return null;
  }

  /// Read [pack] into a catalogue, names in [locale] (falling back to `en`).
  ///
  /// Refuses ([Err]) — the WHOLE catalogue, never a partial one — on: a
  /// missing or empty index, a duplicate or malformed id, a missing name or
  /// facts record, a record that is not a JSON object or whose `id` is not its
  /// key's, a missing or unknown category, an unknown cycle, a cancel or
  /// manage URL that is not `https://host…`, a negative or non-integer notice,
  /// an empty or malformed region list, and any price key whose code is not in
  /// [kServiceCatalogueCurrencies], whose amount is not a plain decimal at the
  /// currency's precision, or whose service is not in the index.
  static Result<ServiceCatalogue> fromPack(
    ContentPack pack, {
    String locale = 'en',
  }) {
    Result<ServiceCatalogue> refuse(String why) =>
        Result<ServiceCatalogue>.err(Failure('service catalogue: $why'));

    final String? index = _lookup(pack, locale, indexKey);
    if (index == null || index.trim().isEmpty) {
      return refuse('no "$indexKey" index in the pack');
    }
    final List<String> ids =
        index.split(',').map((String s) => s.trim()).toList();
    final RegExp slug = RegExp(r'^[a-z0-9][a-z0-9_-]*$');
    final Set<String> seen = <String>{};
    for (final String id in ids) {
      if (!slug.hasMatch(id)) return refuse('malformed service id "$id"');
      if (!seen.add(id)) return refuse('duplicate service id "$id"');
    }

    // Prices first, across EVERY shard: a malformed price key is a refusal
    // whichever locale it sits in, not only the one being read.
    final Map<String, Map<String, Money>> prices =
        <String, Map<String, Money>>{};
    final RegExp priceKey = RegExp(r'^svc\.([^.]+)\.price\.(.+)$');
    for (final Object? shard in pack.content.values) {
      if (shard is! Map) continue;
      for (final MapEntry<Object?, Object?> kv in shard.entries) {
        final Match? m = priceKey.firstMatch('${kv.key}');
        if (m == null) continue;
        final String id = m.group(1)!;
        final String code = m.group(2)!;
        if (!seen.contains(id)) {
          return refuse('price key "${kv.key}" names a service not in the index');
        }
        if (!RegExp(r'^[A-Z]{3}$').hasMatch(code) ||
            !kServiceCatalogueCurrencies.contains(code)) {
          return refuse('price key "${kv.key}": "$code" is not an accepted '
              'ISO 4217 code');
        }
        final Money? money =
            kv.value is String ? _parseMajor(kv.value! as String, code) : null;
        if (money == null) {
          return refuse('price key "${kv.key}": "${kv.value}" is not a plain '
              'non-negative decimal at $code precision');
        }
        final Money? prior = prices[id]?[code];
        if (prior != null && prior != money) {
          return refuse('price key "${kv.key}" disagrees between locales');
        }
        (prices[id] ??= <String, Money>{})[code] = money;
      }
    }

    final List<ServiceEntry> out = <ServiceEntry>[];
    for (final String id in ids) {
      final String? name = _lookup(pack, locale, 'svc.$id.name');
      if (name == null || name.trim().isEmpty) {
        return refuse('"$id" has no name');
      }
      final String? raw = _lookup(pack, locale, 'svc.$id.facts');
      if (raw == null) return refuse('"$id" has no facts record');
      final Object? decoded;
      try {
        decoded = jsonDecode(raw);
      } on FormatException {
        return refuse('"$id" facts record is not JSON');
      }
      if (decoded is! Map<String, Object?>) {
        return refuse('"$id" facts record is not a JSON object');
      }
      final Map<String, Object?> f = decoded;
      if (f['id'] != id) {
        return refuse('"$id" facts record declares id "${f['id']}"');
      }
      final Object? category = f['category'];
      if (category is! String || category.isEmpty) {
        return refuse('"$id" has no category');
      }
      if (!kServiceCategories.contains(category)) {
        return refuse('"$id" has unknown category "$category"');
      }
      final Object? cycleRaw = f['cycle'];
      final ServiceCycle? cycle =
          cycleRaw is String ? ServiceCycle.tryParse(cycleRaw) : null;
      if (cycle == null) return refuse('"$id" has unknown cycle "$cycleRaw"');
      final Uri? cancel = _https(f['cancel_url']);
      if (cancel == null) {
        return refuse('"$id" cancel_url "${f['cancel_url']}" is not https');
      }
      final Uri? play = _https(f['manage_play']);
      if (play == null) return refuse('"$id" manage_play is not https');
      final Uri? appStore = _https(f['manage_appstore']);
      if (appStore == null) return refuse('"$id" manage_appstore is not https');
      final Object? notice = f['notice_days'];
      if (notice is! int || notice < 0) {
        return refuse('"$id" notice_days "$notice" is not a non-negative int');
      }
      final Object? regionsRaw = f['regions'];
      if (regionsRaw is! List || regionsRaw.isEmpty) {
        return refuse('"$id" has no regions');
      }
      final Set<String> regions = <String>{};
      for (final Object? r in regionsRaw) {
        if (r is! String || !(r == '*' || RegExp(r'^[A-Z]{2}$').hasMatch(r))) {
          return refuse('"$id" region "$r" is neither "*" nor ISO 3166 alpha-2');
        }
        regions.add(r);
      }
      final Object? aliasesRaw = f['aliases'];
      final List<String> aliases = <String>[];
      if (aliasesRaw != null) {
        if (aliasesRaw is! List) return refuse('"$id" aliases is not a list');
        for (final Object? a in aliasesRaw) {
          if (a is! String || a.trim().isEmpty) {
            return refuse('"$id" alias "$a" is not a non-empty string');
          }
          aliases.add(a.toLowerCase());
        }
      }
      final Object? logo = f['logo'];
      if (logo != null && (logo is! String || logo.isEmpty)) {
        return refuse('"$id" logo "$logo" is not an asset id');
      }
      out.add(ServiceEntry(
        id: id,
        name: name,
        categoryId: category,
        cycle: cycle,
        cancelUrl: cancel,
        playManageUrl: play,
        appStoreManageUrl: appStore,
        noticeDays: notice,
        regions: Set<String>.unmodifiable(regions),
        aliases: List<String>.unmodifiable(aliases),
        logo: logo as String?,
        prices: Map<String, Money>.unmodifiable(
            prices[id] ?? const <String, Money>{}),
      ));
    }
    return Result<ServiceCatalogue>.ok(
        ServiceCatalogue(List<ServiceEntry>.unmodifiable(out)));
  }

  /// The string at [key] in [locale], else in `en`. NOT [ContentPack.text],
  /// which falls back to the KEY ITSELF — a missing field would then read as a
  /// present one whose value is its own name.
  static String? _lookup(ContentPack pack, String locale, String key) {
    for (final String l in <String>[locale, 'en']) {
      final Object? shard = pack.content[l];
      if (shard is Map) {
        final Object? v = shard[key];
        if (v is String) return v;
      }
    }
    return null;
  }

  static Uri? _https(Object? v) {
    if (v is! String) return null;
    final Uri? u = Uri.tryParse(v);
    if (u == null || u.scheme != 'https' || u.host.isEmpty) return null;
    return u;
  }

  /// Exact decimal -> minor units, no floating point: `"649.00"` INR is
  /// 64900. More fraction digits than the currency has is a refusal, not a
  /// rounding.
  static Money? _parseMajor(String s, String code) {
    final Match? m = RegExp(r'^(\d{1,9})(?:\.(\d+))?$').firstMatch(s);
    if (m == null) return null;
    final int digits = Money.minorUnitDigitsFor(code);
    final String frac = m.group(2) ?? '';
    if (frac.length > digits) return null;
    final int minor = int.parse(m.group(1)!) * Money.pow10(digits) +
        (frac.isEmpty ? 0 : int.parse(frac.padRight(digits, '0')));
    return Money(minor, code);
  }
}
