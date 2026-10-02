// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT RAIL NAMES — ST-T9 (AD-06) and ST-T10 (DE-11), one table.
//
// The add sheet's "Paid with" dropdown, Home's row badge and the detail's
// details list all paint a row's `rail` through this function, so the three
// cannot name one rail three ways. App-only, like `category_label.dart`: the
// rail vocabulary is Subly's (the API's `RAILS`), not a chassis concept.
// ─────────────────────────────────────────────────────────────────────────────
import '../../data/models/subscription.dart' show PaymentRail;
import '../../l10n/app_localizations.dart';

/// The display name of [rail], or null for none and for a value this build
/// read but does not know (`unknown`) — never a guess.
String? railLabel(AppLocalizations l10n, PaymentRail? rail) => switch (rail) {
  PaymentRail.upiAutopay => l10n.railUpiAutopay,
  PaymentRail.cardEmandate => l10n.railCard,
  PaymentRail.nach => l10n.railNach,
  PaymentRail.appStore => l10n.railAppStore,
  PaymentRail.play => l10n.railPlay,
  PaymentRail.paypal => l10n.railPaypal,
  PaymentRail.manual => l10n.railOther,
  PaymentRail.unknown || null => null,
};
