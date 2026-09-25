import 'package:flutter/foundation.dart' show Listenable, immutable;

import 'offering.dart';
import 'purchase_rail_kind.dart';

/// Why a checkout could not be started. Every value is a state the UI has to be
/// able to explain in a sentence — that is the test for whether it belongs here.
enum CheckoutRefusal {
  /// The store this build ships through forbids selling here
  /// ([PurchaseCapabilities.channelPermitted]).
  channelNotPermitted,

  /// The platform cannot open an external page at all.
  platformNotSupported,

  /// No offerings, or no checkout URL template. This is the state today,
  /// because `paywall.enabled` is false for every app in
  /// services/platform/src/app-config-data.json.
  ///
  /// ⚠️ CORRECTED 2026-08-28: this read "OWNER_QUEUE A-1 is PENDING, so no
  /// seller account exists to generate one". The seller account went LIVE
  /// 2026-08-11 ([ADR 044]); the paywall switch is what is off.
  railNotConfigured,

  /// No session, so the purchase could not be attributed to anybody
  /// ([pipeline 5]M-7). Refused BEFORE the checkout opens rather than after the
  /// money moves — an unattributable in-app purchase is a support case, not a
  /// supported state.
  notSignedIn,

  /// The platform refused to open the page (popup blocker, no handler).
  couldNotOpen,

  /// The buyer dismissed the store's own purchase sheet. ADDED for the store
  /// IAP rail ([ADR 067] decision 7), and it is a REFUSAL rather than a failure
  /// on purpose: a "purchase failed" message after a deliberate cancel is how a
  /// paywall teaches people it is broken. The hosted rail never produces it —
  /// once a browser has the page we cannot see what the buyer does there.
  purchaseCancelled,
}

/// What happened when the app asked to start a checkout.
@immutable
sealed class CheckoutStart {
  const CheckoutStart();
}

/// The hosted page was handed to the platform. NOT "the user has paid" — the
/// unlock arrives later, from the server, via convergence.
@immutable
final class CheckoutOpened extends CheckoutStart {
  const CheckoutOpened({required this.offering, required this.url});

  final Offering offering;
  final Uri url;
}

/// The store's own purchase sheet ran and the buyer completed it.
///
/// 🔴 NOT "THE USER HAS PRO", and the distinction is the one [CheckoutOpened]
/// already carries: the store telling us money moved is a client-side claim, and
/// the unlock is a SERVER read ([pipeline 5]M-5). The provider's webhook reaches
/// our Worker some time after the sheet closes, and `EntitlementConvergence` is
/// what waits for it — exactly as it does for the hosted rail. There is no URL
/// here because there was no page: the transaction happened inside the store.
@immutable
final class CheckoutSubmitted extends CheckoutStart {
  const CheckoutSubmitted({required this.offering});

  final Offering offering;
}

/// Nothing was opened, and [reason] says why in a form the UI can explain.
@immutable
final class CheckoutRefused extends CheckoutStart {
  const CheckoutRefused(this.reason, {this.detail = ''});

  final CheckoutRefusal reason;

  /// Engineering context for the log, e.g. the capability row's `why`.
  ///
  /// 🔴 NEVER RENDERED. It is English, written for whoever reads the log, and
  /// on a store build it can name the web — the paywall shows the sentence its
  /// [refusalRouteOf] route owns, in the user's language, and nothing else.
  final String detail;
}

/// Where a paywall goes after a [CheckoutRefused] — the ONE answer, so the app
/// screen and every stamped app's adapter cannot each decide it differently.
enum RefusalRoute {
  /// Back to the offers, with nothing said. The buyer chose not to buy.
  backToChoosing,

  /// The purchase needs somebody to attribute it to, and there is nobody yet.
  signIn,

  /// Something between the app and the checkout failed and may not fail
  /// again: a sentence that says so, and Try again.
  retry,

  /// This build cannot sell here. The sentence says that, truthfully, and Try
  /// again is still offered, because the refusal is a state and not a verdict.
  unavailable,
}

/// The route for [refusal].
///
/// 🔴 NO `default`, ON PURPOSE. A seventh [CheckoutRefusal] fails to compile
/// here until somebody decides where it goes. With a default it would land in
/// whichever route the default named, silently — which is how every refusal,
/// the buyer's own cancel included, once reached "Purchases are not available
/// here".
RefusalRoute refusalRouteOf(CheckoutRefusal refusal) => switch (refusal) {
      CheckoutRefusal.purchaseCancelled => RefusalRoute.backToChoosing,
      CheckoutRefusal.notSignedIn => RefusalRoute.signIn,
      CheckoutRefusal.couldNotOpen ||
      CheckoutRefusal.railNotConfigured =>
        RefusalRoute.retry,
      CheckoutRefusal.channelNotPermitted ||
      CheckoutRefusal.platformNotSupported =>
        RefusalRoute.unavailable,
    };

/// What happened when the user asked to cancel.
enum CancellationOutcome {
  /// Our own host recorded the request. This is the state that is REAL today:
  /// the record is ours, append-only, and is what a support conversation and a
  /// regulator both read.
  recorded,

  /// Recorded here AND executed on the rail. ⚠️ CORRECTED 2026-08-28: this read
  /// "Reachable only once a seller account and an API credential exist
  /// (OWNER_QUEUE A-1)". Both now exist — the account went LIVE 2026-08-11 and
  /// [ADR 044] evidences the live API key. What still makes this unreachable is
  /// that NO REGISTERED ADAPTER CAN EXECUTE A CANCELLATION: the vendor's cancel
  /// endpoint shape has never been read against a primary source in this repo,
  /// and a guessed call would 404 for the first real subscriber. See
  /// services/platform/src/routes/cancellation.ts.
  executed,

  /// There is nothing to cancel for this user and app.
  noActivePlan,

  /// We could not reach our own host. The user has NOT cancelled and must be
  /// told so — reporting success on a failed write is how a cancellation
  /// silently does not happen.
  failed,
}

/// The client half of the money rail, as one seam.
///
/// ## Why this is an interface
/// Three rails implement it — the hosted checkout (`HostedCheckoutRail`), the
/// store's own billing (`IapRail`, [ADR 067]) and the rail that sells nothing
/// (`UnavailablePurchaseRail`) — and `ChassisBilling.railFor` picks one from
/// the CHANNEL, so no screen constructs any of them. A PROVIDER swap within a
/// rail still happens server-side in `services/platform/src/lib/mor/`, which is
/// why the entitlement table speaks our vocabulary and not the vendor's.
///
/// ⚠️ CORRECTED 2026-09-25: this read "an interface with exactly one
/// implementation", from before `IapRail` shipped.
abstract interface class PurchaseRail {
  /// Which rail this is — the one fact a screen needs to pick its words.
  ///
  /// A MEMBER, not an optional capability with a fallback: a rail that did not
  /// answer would have its copy chosen for it, and on a store build the wrong
  /// choice names a browser the buyer is never sent to. So every rail answers,
  /// and a new one does not compile until it does.
  PurchaseRailKind get railKind;

  /// The plans this rail can sell, described by whoever charges for them: the
  /// rail config on the web, the STORE on a store rail. Empty is a normal
  /// answer and means the paywall shows its unavailable state.
  ///
  /// A store rail's list arrives LATER than the rail itself — the store has to
  /// be asked — so it is empty until then; that rail is also a
  /// [LoadsOfferings], and a screen that paints this list listens through
  /// [offeringsChangesOf].
  List<Offering> get offerings;

  /// Whether a checkout could be started right now, on this platform, through
  /// this channel, with this configuration. The paywall asks BEFORE it draws a
  /// button — a purchase control that is present and cannot work is worse than
  /// an honest sentence.
  bool get canStartCheckout;

  /// Start a checkout for [offering]: hand the hosted page to the platform, or
  /// run the store's own purchase sheet, whichever [railKind] this rail is.
  Future<CheckoutStart> startCheckout(Offering offering);

  /// Ask to cancel. A real call to our own host, not a mailto: link
  /// ([pipeline 5]M-9 — ROSCA: cancelling must be no harder than buying).
  Future<CancellationOutcome> requestCancellation();
}

/// A rail whose [PurchaseRail.offerings] come from somewhere that has to be
/// ASKED — the store, on a store rail.
///
/// 🔴 WHY THIS IS NOT ON [PurchaseRail]. The web rail's offerings are the rail
/// config, known the moment the rail is built; a store rail's are the store's
/// answer, which arrives later and can change (a sign-in changes trial
/// eligibility). [PurchaseRail.offerings] stays synchronous because a paywall
/// reads it while BUILDING a widget, so the change is announced separately, and
/// only by the rail that has one. A screen never asks `is LoadsOfferings`
/// itself: it calls [offeringsChangesOf] and [refreshOfferingsOf], which answer
/// for every rail.
abstract interface class LoadsOfferings {
  /// Fires when [PurchaseRail.offerings] changed.
  Listenable get offeringsChanged;

  /// Ask again. Never throws; a store that cannot be asked leaves the list
  /// empty, which the paywall already explains.
  Future<void> refreshOfferings();
}

/// What a screen listens to so it repaints when [rail]'s offerings change. A
/// rail whose offerings never change answers a listenable that never fires.
Listenable offeringsChangesOf(PurchaseRail rail) {
  if (rail case final LoadsOfferings loads) return loads.offeringsChanged;
  return _never;
}

/// Ask [rail] for its offerings again; a no-op for a rail that has nothing to
/// ask.
Future<void> refreshOfferingsOf(PurchaseRail rail) async {
  if (rail case final LoadsOfferings loads) await loads.refreshOfferings();
}

final Listenable _never = Listenable.merge(const <Listenable?>[]);

/// What happened when the user asked to restore purchases — [pipeline 5]M-10.
///
/// 🔴 NOT ONE OF THESE VALUES IS AN UNLOCK. A restore is a claim about the
/// past and the entitlement row is the answer: whichever value comes back, the
/// screen re-reads `GET /v1/entitlements` AFTERWARDS and shows what the SERVER
/// says. These values decide only whether the screen waits for the server to
/// catch up, and which sentence the user is told.
enum RestoreOutcome {
  /// The store was asked and answered. Whatever it holds for this account is
  /// now with the provider, whose webhook reaches our Worker — so the unlock
  /// arrives from the server read that follows, possibly some time after it,
  /// which is why the screen converges (bounded) on this value alone.
  askedStore,

  /// This rail has no store to ask. The entitlement is a server row keyed
  /// `(user_id, app_id)`, so the server read that follows IS the whole
  /// restore: the hosted rail, the rail that sells nothing, and any rail that
  /// is not a [RestoresPurchases].
  serverOnly,

  /// This rail has a store and it could not be asked, or did not answer: the
  /// SDK could not be configured or switched to the signed-in account, the
  /// device is offline, or the store declined. The server read still runs, so
  /// a plan the server already holds is still shown.
  couldNotAsk,
}

/// A rail that can ask a STORE to give back prior purchases — [pipeline 5]M-10.
///
/// 🔴 WHY THIS IS NOT ON [PurchaseRail] — the [LoadsOfferings] reason again.
/// Only a store rail has anything to ask; every other rail's restore is the
/// server read the screen makes anyway. A screen never asks
/// `is RestoresPurchases` itself: it calls [restorePurchasesOf], which answers
/// for every rail.
///
/// Apple guideline 3.1.1 requires an explicit Restore control in a build that
/// sells through StoreKit, and a control that only re-reads our own server
/// never asks StoreKit for anything — which is why the store rail answers this
/// and the screen asks it before the server read.
abstract interface class RestoresPurchases {
  /// Ask the store, when this rail has one. Never throws, and never unlocks.
  Future<RestoreOutcome> restorePurchases();
}

/// Ask [rail]'s store to restore prior purchases; [RestoreOutcome.serverOnly]
/// for a rail that has no store to ask. The caller re-reads the entitlement
/// AFTER this returns — the store's answer is not the unlock.
Future<RestoreOutcome> restorePurchasesOf(PurchaseRail rail) async {
  if (rail case final RestoresPurchases restores) {
    return restores.restorePurchases();
  }
  return RestoreOutcome.serverOnly;
}
