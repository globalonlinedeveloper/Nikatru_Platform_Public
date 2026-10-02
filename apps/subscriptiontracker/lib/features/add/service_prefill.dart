// ST-T9 (AD-03, EN-18) — what a catalogue pick KNOWS about a row, in ONE
// place: the add sheet's pick step and first-run setup's "pick what you pay
// for" both prefill from here, so the two cannot disagree about a service.

import 'package:nikatru_core/nikatru_core.dart'
    show RecurrenceSchedule, ServiceCycle, ServiceEntry;

import '../../data/models/category.dart';
import '../../data/models/subscription.dart';

/// The catalogue's closed category set (packages/core `kServiceCategories`)
/// read into this app's built-in categories BY ID ([kBuiltinCategories]). A
/// pack category with no counterpart is uncategorised — never a new bucket.
const Map<String, String> kPackCategoryToBuiltin = <String, String>{
  'entertainment': 'streaming',
  'music': 'music',
  'ai': 'ai_tools',
  'cloud': 'cloud',
  'news': 'news',
  'productivity': 'productivity',
  'fitness': 'fitness',
};

/// The built-in category id [e] files under, or null.
String? serviceCategoryId(ServiceEntry e) =>
    kPackCategoryToBuiltin[e.categoryId];

/// The stored name of that built-in, or null.
String? serviceCategoryName(ServiceEntry e) =>
    kBuiltinCategories[serviceCategoryId(e)];

/// The cadence a service bills on by default.
Cadence serviceCadence(ServiceEntry e) =>
    e.cycle == ServiceCycle.yearly ? Cadence.yearly : Cadence.monthly;

/// A new row for [e] in [currencyCode], renewing one cycle after [today]:
/// name, category by id, cadence, cancel page, notice and `service_id` from
/// the catalogue, and the catalogue's price in [currencyCode] — or ZERO when
/// the pack has none, which the user then fills in. Never a converted guess:
/// there is no rate table, and a wrong price is worse than an empty one.
Subscription draftFromService(
  ServiceEntry e, {
  required String currencyCode,
  required DateTime today,
}) {
  final Cadence cadence = serviceCadence(e);
  final DateTime day = DateTime(today.year, today.month, today.day);
  return Subscription(
    id: '',
    name: e.name,
    category: serviceCategoryName(e) ?? 'Other',
    categoryId: serviceCategoryId(e),
    price: e.priceFor(currencyCode) ?? Money(0, currencyCode),
    cycle: cadence,
    nextRenewal: RecurrenceSchedule.advance(day, cadence),
    glyph: Subscription.glyphFor(e.name),
    firstChargeOn: RecurrenceSchedule.advance(day, cadence),
    cancelUrl: e.cancelUrl.toString(),
    noticeDays: e.noticeDays,
    serviceId: e.id,
  );
}
