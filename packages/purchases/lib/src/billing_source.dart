import 'package:nikatru_core/nikatru_core.dart' as core;

/// WHERE THE USER PAID — read from the entitlement, never from the build.
///
/// ⏱ 2026-10-01 · MO-05, AB-M4-03-client. Manage plan used to pick its cancel
/// path from the build channel, so a plan bought in Google Play and opened on
/// the web build drew our own Cancel, which POSTs `/v1/plan/cancel` — a request
/// that can never stop a store subscription, because only the store can. The
/// server half (`storeCancelPage`, services/platform/src/lib/mor/registry.ts)
/// already names the store from `entitlements.store`; this is the client half,
/// reading the same field with the same vocabulary (RevenueCat's `store`,
/// verbatim).
enum BillingSource {
  /// Our own hosted checkout (the merchant of record). Cancelled HERE, through
  /// `POST /v1/plan/cancel`.
  web,

  /// Apple's App Store or Mac App Store. Cancelled in the App Store only.
  appStore,

  /// Google Play. Cancelled in Google Play only.
  googlePlay;

  /// Whether OUR cancel route can stop this plan. False for every store: a
  /// store subscription is cancelled where it was bought.
  bool get cancelsHere => this == BillingSource.web;

  /// The store's own subscriptions page, or null for [web]. The same two URLs
  /// the server's `storeCancelPage` answers.
  Uri? get manageUrl => switch (this) {
    BillingSource.web => null,
    BillingSource.appStore => Uri.parse(
      'https://apps.apple.com/account/subscriptions',
    ),
    BillingSource.googlePlay => Uri.parse(
      'https://play.google.com/store/account/subscriptions',
    ),
  };

  /// What our own merchant-of-record rows carry in `store`: NOTHING. The
  /// Paddle webhook (services/platform/src/lib/mor/paddle.ts) names no store,
  /// so `store.ts` writes NULL, the entitlement read serves `null`, and
  /// [core.Entitlement.fromJson] reads it as the empty string.
  static const String webStore = '';

  /// The source of one entitlement row's `store`, or null for a store this
  /// client cannot name.
  ///
  /// ⏱ 2026-10-01 · review 1 of #1114 (item 5). Every unrecognised value used to
  /// fall through to [web], so a RevenueCat `PROMOTIONAL`, `STRIPE`, `AMAZON`
  /// or `RC_BILLING` row was told "your plan is cancelled first" on delete and
  /// "Bought on the web" on Manage plan — both false. Web is now the one value
  /// our own rows carry, and anything else is null: no sentence is worded for a
  /// source nobody here has read.
  static BillingSource? ofStore(String store) => switch (store) {
    webStore => BillingSource.web,
    'APP_STORE' || 'MAC_APP_STORE' => BillingSource.appStore,
    'PLAY_STORE' => BillingSource.googlePlay,
    _ => null,
  };

  /// The plan that is active [now], and where it was bought — or null when no
  /// row is valid (a free user, or a bundle grant with no row of its own).
  /// `source` is null when the row's store is one [ofStore] cannot name.
  static ({BillingSource? source, DateTime? periodEnds})? activePlanOf(
    core.Entitlements ent,
    DateTime now,
  ) {
    for (final core.Entitlement e in ent.items) {
      if (!e.isValidAt(now)) continue;
      return (source: ofStore(e.store), periodEnds: e.expiresAt);
    }
    return null;
  }
}
