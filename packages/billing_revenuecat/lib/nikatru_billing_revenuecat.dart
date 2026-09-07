/// The RevenueCat implementation of `nikatru_purchases`' `IapBridge` seam —
/// [ADR 067] decision 7, [ADR 039] D5.
///
/// This package exists so that ONE app can sell through Google Play Billing or
/// Apple in-app purchase without every other app in the portfolio linking a
/// native IAP payload and swearing a purchase-history declaration it does not
/// need. An app opts in by depending on this package AND declaring
/// `billing.mobileIap` in its `app.yaml`; `tooling/ci/assert-app-yaml.mjs`
/// holds those two together in both directions, so neither half can ship alone.
///
/// It ships no rail, no paywall and no entitlement opinion. The unlock is
/// `GET /v1/entitlements` — the store's word is a payment fact, not an
/// entitlement one.
library;

export 'src/revenuecat_bridge.dart';
export 'src/revenuecat_capabilities.dart';
