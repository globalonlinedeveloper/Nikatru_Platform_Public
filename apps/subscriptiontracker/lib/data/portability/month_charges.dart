// Train T20 (IN-12) — "share a month": the month's charges as a CSV the user
// hands on themselves, through the same export seam as Settings' export.
//
// 🔴 EVERY CHARGE IN THE MONTH, NOT EVERY ROW THAT RENEWS IN IT. A weekly plan
// charges four or five times in a month and an every-10-days plan three, so
// the file enumerates each charge date by the platform's own rule
// (`RecurrenceSchedule`) — the rule the Worker rolls renewals by — rather than
// asking each row for its one stored renewal (`SubMath.chargedInMonth`, the
// calendar's question, which a weekly row answers once).
//
// The file is built ON THE DEVICE from the list already loaded. Nothing is
// sent anywhere to build it, and nothing leaves until the user shares it.

import 'package:nikatru_core/nikatru_core.dart' as core;

import '../../core/format/money_format.dart' show MoneyBag;
import '../../core/format/sub_math.dart';
import '../models/subscription.dart';

/// The header row. Keys, like `kSubscriptionCsvHeader`'s, not copy: a file
/// another app reads back must not change its columns with the UI language.
const List<String> kMonthChargesCsvHeader = <String>[
  'date',
  'name',
  'category',
  'price',
  'currency',
];

/// The `name` cell of each per-currency total row at the foot of the file.
const String kMonthChargesTotalCell = 'total';

/// One charge: which row, on which day.
typedef MonthCharge = ({Subscription sub, DateTime on});

/// Every charge the CHARGING rows of [subs] make in [month]'s calendar month,
/// by date then name. A row with no cadence charges only on its stored date.
List<MonthCharge> monthCharges(List<Subscription> subs, DateTime month) {
  final DateTime first = DateTime(month.year, month.month);
  final DateTime next = DateTime(month.year, month.month + 1);
  final List<MonthCharge> out = <MonthCharge>[];
  for (final Subscription s in SubMath.charging(subs)) {
    final Cadence? c = s.cycle;
    if (c == null || !c.isValid) {
      final DateTime d = s.nextRenewal;
      if (!d.isBefore(first) && d.isBefore(next)) {
        out.add((sub: s, on: DateTime(d.year, d.month, d.day)));
      }
      continue;
    }
    final int anchorDay = s.nextRenewal.day;
    DateTime d = RecurrenceSchedule.nextOnOrAfter(s.nextRenewal, c, first);
    while (d.isBefore(next)) {
      out.add((sub: s, on: d));
      d = RecurrenceSchedule.advance(d, c, anchorDay: anchorDay);
    }
  }
  out.sort((MonthCharge a, MonthCharge b) {
    final int byDate = a.on.compareTo(b.on);
    return byDate != 0 ? byDate : a.sub.name.compareTo(b.sub.name);
  });
  return out;
}

/// What [monthCharges] adds up to, grouped by currency — never converted.
MoneyBag monthChargesTotal(List<MonthCharge> charges) =>
    MoneyBag.sum(charges.map((MonthCharge c) => c.sub.price));

/// The month's charges as the file Insights › Share hands to the platform:
/// one record per charge, then one `total` record per currency.
core.ExportFile monthChargesCsvFile(List<Subscription> subs, DateTime month) {
  final List<MonthCharge> charges = monthCharges(subs, month);
  final MoneyBag total = monthChargesTotal(charges);
  return core.ExportFile(
    bytes: const core.CsvCodec().encodeBytes(
      kMonthChargesCsvHeader,
      <List<String>>[
        for (final MonthCharge c in charges)
          <String>[
            Subscription.dateOnly(c.on),
            c.sub.name,
            c.sub.category,
            ...core.CsvCodec.moneyCells(c.sub.price),
          ],
        for (final Money m in total.amounts)
          <String>[
            '',
            kMonthChargesTotalCell,
            '',
            ...core.CsvCodec.moneyCells(m),
          ],
      ],
    ),
    fileName: 'charges-${monthStamp(month)}.csv',
    mimeType: core.CsvCodec.mimeType,
  );
}

/// `YYYY-MM`, for a file name that sorts.
String monthStamp(DateTime month) =>
    '${month.year.toString().padLeft(4, '0')}-'
    '${month.month.toString().padLeft(2, '0')}';
