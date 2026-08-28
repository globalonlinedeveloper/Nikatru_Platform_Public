import 'package:flutter/foundation.dart' show immutable;

import 'offering.dart';

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

/// Nothing was opened, and [reason] says why in a form the UI can explain.
@immutable
final class CheckoutRefused extends CheckoutStart {
  const CheckoutRefused(this.reason, {this.detail = ''});

  final CheckoutRefusal reason;

  /// Human-readable context, e.g. the capability row's `why`. Never shown alone.
  final String detail;
}

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
/// ## Why this is an interface with exactly one implementation
/// Not for a second vendor — [ADR 004] locks the merchant of record, and the
/// PROVIDER swap happens server-side in `services/platform/src/lib/mor/`, which
/// is the whole reason the entitlement table speaks our vocabulary and not
/// theirs. It is an interface because the alternative is a widget test that
/// cannot construct a purchase path, and an untestable purchase path is one
/// nobody has ever seen work.
abstract interface class PurchaseRail {
  /// The plans this rail can sell, from the rail config. Empty is a normal
  /// answer and means the paywall shows its unavailable state.
  List<Offering> get offerings;

  /// Whether a checkout could be started right now, on this platform, through
  /// this channel, with this configuration. The paywall asks BEFORE it draws a
  /// button — a purchase control that is present and cannot work is worse than
  /// an honest sentence.
  bool get canStartCheckout;

  /// Open the hosted checkout for [offering].
  Future<CheckoutStart> startCheckout(Offering offering);

  /// Ask to cancel. A real call to our own host, not a mailto: link
  /// ([pipeline 5]M-9 — ROSCA: cancelling must be no harder than buying).
  Future<CancellationOutcome> requestCancellation();
}
