// ═══════════════════════════════════════════════════════════════════════════
// THE MONTH REPORT — ST-P5 (round-2 F36), a Pro "plan and save" item. The
// month's figures and every plan held, as a PDF the user keeps.
//
// The RENDERER is `packages/core`'s `PdfReport` (every app's report draws with
// it); this file holds only what Subly puts in one. The bytes leave through
// the same `FileExporter` seam the CSV export uses (fileExporterProvider).
//
// ⚠️ THE REPORT IS WRITTEN IN ENGLISH, WHATEVER THE APP'S LOCALE, AND MONEY IS
// WRITTEN BY ISO CODE (`INR 1,200.00`). Both for one reason: the PDF's standard
// font has Latin-1 glyphs only (see core's pdf_report.dart), so a Tamil string
// or a ₹ would print as `?`. The strings still come from the ARB, looked up in
// English on purpose, so the day a Unicode face is embedded the report
// follows the locale by changing ONE line here.
// ═══════════════════════════════════════════════════════════════════════════

import 'package:flutter/widgets.dart' show Locale;
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart'
    show ExportFile, Money, MoneyBag, PdfReport, ReportSection;

import '../../core/format/sub_math.dart';
import '../../data/models/subscription.dart';
import '../../l10n/app_localizations.dart';

/// The one locale the report is written in — see the header.
const Locale kReportLocale = Locale('en');

/// [m] as the report writes money: the ISO code, a space, the amount at the
/// currency's own precision, grouped the en_US way.
String reportMoney(Money m) => NumberFormat.currency(
  locale: 'en_US',
  symbol: '${m.currencyCode} ',
  decimalDigits: m.minorUnitDigits,
).format(m.toMajorUnits());

/// Every subtotal of [bag], or a zero in [currencyCode] for an empty one.
String reportBag(MoneyBag bag, String currencyCode) => bag.isEmpty
    ? reportMoney(Money.zero(currencyCode))
    : bag.amounts.map(reportMoney).join(' + ');

/// The report for [now]'s month over the rows the user holds.
///
/// Dates are formatted `en_US`: the one locale `intl` compiles in, so the
/// report renders the same whether or not a widget tree has loaded the
/// others (a report built off the UI thread, or in a plain test).
PdfReport monthReport(
  List<Subscription> subs,
  DateTime now, {
  required String currencyCode,
}) {
  final AppLocalizations l10n = lookupAppLocalizations(kReportLocale);
  final String month = DateFormat.yMMMM('en_US').format(now);
  final DateFormat day = DateFormat.yMMMd('en_US');
  final List<Subscription> charging = SubMath.byMonthlyDesc(
    SubMath.charging(subs),
  );
  return PdfReport(
    title: l10n.reportTitle,
    subtitle: month,
    sections: <ReportSection>[
      ReportSection(
        heading: l10n.reportTotals,
        lines: <String>[
          l10n.reportChargedIn(
            month,
            reportBag(
              SubMath.chargedInMonth(subs, now.year, now.month),
              currencyCode,
            ),
          ),
          l10n.reportPerMonth(
            reportBag(SubMath.totalMonthly(subs), currencyCode),
          ),
          l10n.reportPerYear(
            reportBag(SubMath.totalYearly(subs), currencyCode),
          ),
        ],
      ),
      ReportSection(
        heading: l10n.reportPlans(charging.length),
        columns: <String>[
          l10n.reportColumnName,
          l10n.reportColumnCharge,
          l10n.reportColumnShare,
          l10n.reportColumnNext,
        ],
        rows: <List<String>>[
          for (final Subscription s in charging)
            <String>[
              s.name,
              s.cycle == BillingCycle.yearly
                  ? l10n.perYearAmount(reportMoney(s.price))
                  : l10n.perMonthAmount(reportMoney(s.price)),
              s.isShared ? '${s.shareNumerator}/${s.shareDenominator}' : '',
              day.format(s.nextCharge(now)),
            ],
        ],
      ),
      if (SubMath.setAsides(subs)
          case final List<({Subscription sub, Money perMonth})> asides
          when asides.isNotEmpty)
        ReportSection(
          heading: l10n.setAsideTitle,
          lines: <String>[
            for (final ({Subscription sub, Money perMonth}) a in asides)
              l10n.setAsideRow(
                reportMoney(a.perMonth),
                a.sub.name,
                reportMoney(a.sub.price),
              ),
          ],
        ),
    ],
  );
}

/// [monthReport] as the file the exporter hands over.
ExportFile monthReportFile(
  List<Subscription> subs,
  DateTime now, {
  required String currencyCode,
}) => ExportFile(
  bytes: monthReport(subs, now, currencyCode: currencyCode).render(),
  fileName:
      'subscriptions-${now.year}-${now.month.toString().padLeft(2, '0')}.pdf',
  mimeType: 'application/pdf',
);
