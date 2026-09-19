// ─────────────────────────────────────────────────────────────────────────────
// THE MONEY RAIL, INHERITED — [pipeline 5]M-5 · M-6 · M-8 · M-9 · M-11 · M-13 ·
// M-16.
//
// 🔴 WHY IT IS IN THE BRICK AND NOT IN AN APP. [5]M-13's requirement is "zero
// money code per app". The rail lives in `packages/purchases` and the WIRING
// lives here, so a freshly stamped app is born able to take a payment, show a
// price it did not invent, converge on the server's answer and let the user
// cancel — with nobody writing a line of purchase code. The alternative is the
// shape this factory already paid for once: a capability that exists in exactly
// one app and is hand-rebuilt for the second.
//
// 🔴 AND WHY THE CLIENT GRANTS NOTHING. Every unlock in this file comes from a
// server read. There is no `grant()`, no `isPro = true` on a checkout return,
// and no client-side receipt validation — because a hosted checkout returns the
// buyer to the app identically whether they paid, abandoned, or were declined.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

import '../core/app_config.dart';
import 'providers.dart';

/// The rail's own description of what it sells — [pipeline 5]M-11.
///
/// Resolved from the CFG-1 config document's `paywall` block, which means a
/// price change is a config edit and not a release. While the config is still
/// resolving this is [RailConfig.empty], i.e. "nothing to sell yet" — never a
/// guessed price, because a guessed price is the defect this requirement is
/// named after.
final Provider<RailConfig> railConfigProvider = Provider<RailConfig>((ref) {
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  if (cfg == null) return RailConfig.empty;
  return RailConfig.fromPaywallExtra(cfg.paywall.extra);
});

/// The authenticated entitlement read against the SHARED platform host.
///
/// Discards to [core.UnavailableEntitlementTransport] when the backend is not
/// live, so a demo build and every widget test are hermetic — and, crucially,
/// answer "could not ask" rather than a confident "not Pro".
final Provider<core.EntitlementTransport> entitlementTransportProvider =
    Provider<core.EntitlementTransport>((ref) {
      if (!AppConfig.isBackendLive) {
        return const core.UnavailableEntitlementTransport();
      }
      return DioEntitlementTransport(platformBaseUrl: kPlatformBaseUrl);
    });

/// The ROSCA cancel call. Same discard rule, same reason.
final Provider<core.CancellationTransport> cancellationTransportProvider =
    Provider<core.CancellationTransport>((ref) {
      if (!AppConfig.isBackendLive) {
        return const core.UnavailableCancellationTransport();
      }
      return DioCancellationTransport(platformBaseUrl: kPlatformBaseUrl);
    });

/// Where the merchant of record sends the buyer back to.
///
/// ⚠️ THE WEB CASE IS THE HARD ONE AND IT IS WHY THIS IS A CONSTANT RATHER THAN
/// `Uri.base`. On web a hosted checkout is a full-page navigation AWAY from a
/// canvas-rendered Flutter app, so the returning session is a cold start. It has
/// to land on a route that knows a purchase was in flight, and it has to be in
/// the QUERY, never the fragment — G-43 records the same lesson for auth, where
/// a fragment-carried value was eaten by the router before anything read it.
const String kCheckoutReturnUrl = String.fromEnvironment(
  'CHECKOUT_RETURN_URL',
  defaultValue: 'https://nikatru.com/checkout-return',
);

/// The purchase path itself. One object the UI programs against.
///
/// 🔴 [ADR 067] decision 7 / R10 — THE CHANNEL PICKS THE RAIL, NOT THIS FILE.
/// Built by [purchaseRailFor] from the channel this binary was BUILT for
/// (`AppConfig.releaseChannel`, the compile-time `RELEASE_CHANNEL`). A store
/// channel with no IAP bridge, a `rail: none` channel and an undeclared channel
/// all answer a rail that sells nothing and says why.
final Provider<PurchaseRail> purchaseRailProvider = Provider<PurchaseRail>(
  (ref) => purchaseRailFor(ref, AppConfig.releaseChannel),
);

/// The body of [purchaseRailProvider], with the channel as a PARAMETER.
///
/// A parameter because `RELEASE_CHANNEL` is a compile-time constant: a widget
/// test cannot rebuild the app per channel, so it overrides the provider with
/// this same function and another channel id — the real wiring, driven.
///
/// ARCHITECTURE DECISION (2026-09-19, recorded in the PR body): an undeclared
/// channel — the `'dev'` default — SELLS NOTHING rather than being guessed as
/// `web`. Every release lane passes `--dart-define=RELEASE_CHANNEL`, and
/// `assert-channel-register` limb 6b-ii fails a release build that does not.
PurchaseRail purchaseRailFor(Ref<PurchaseRail> ref, String releaseChannel) {
  final ChassisBillingConfig config = ChassisBillingConfig(
    railConfig: ref.watch(railConfigProvider),
    appId: AppConfig.appId,
    returnUrl: kCheckoutReturnUrl,
    // 🔒 [5]M-7 — the buyer's account id rides in the checkout URL so the
    // merchant of record's notification resolves to a person. Read lazily: the
    // rail is built long before anybody signs in.
    accountId: () async => ref.read(authRepositoryProvider).currentUser?.id,
    accessToken: () => ref.read(authRepositoryProvider).currentAccessToken(),
    cancellationTransport: ref.watch(cancellationTransportProvider),
    // No app has opted in to `billing.mobileIap` (O-REVENUECAT-ACCOUNT), so no
    // store bridge ships and a store channel answers `iapBridgeMissing`.
    // `assert-app-yaml` limb 6 holds the dependency and the declaration
    // together; the opt-in increment passes a `RevenueCatBridge` here.
    iapBridge: null,
    iapBridgeConfig: null,
  );
  final PurchaseRail rail = ChassisBilling.railForDeclared(
    releaseChannel,
    config,
  ).orUnavailableRail(config);

  // 🔒 [ADR 085] B — THE AUTH-STATE CHANGE PATH. A store SDK is configured
  // once and keeps the account it was given; a sign-in, sign-out or account
  // switch after that is forwarded here, or the store webhook links the next
  // purchase to the previous account. Only a rail that needs telling is told
  // (the hosted rail reads the account at checkout time).
  if (rail case final IdentifiesBuyer buyer) {
    void forward(Object? _, AsyncValue<core.AuthUser?> next) {
      // Loading is not a sign-out: only a settled answer moves the identity.
      if (!next.hasValue) return;
      buyer.identifyBuyer(next.valueOrNull?.id).ignore();
    }

    ref.listen(authUserProvider, forward, fireImmediately: true);
  }
  return rail;
}

/// The offline cache, with the [pipeline 5]M-8 staleness ceiling applied by
/// [core.EntitlementCache] itself.
final Provider<EntitlementConvergence> entitlementConvergenceProvider =
    Provider<EntitlementConvergence>(
      (ref) => EntitlementConvergence(
        transport: ref.watch(entitlementTransportProvider),
        cache: ref.watch(entitlementCacheProvider),
      ),
    );

/// The four money events, over the same consented analytics rail as everything
/// else — [pipeline 5]M-16.
final FutureProvider<MoneyFunnel> moneyFunnelProvider =
    FutureProvider<MoneyFunnel>(
      (ref) async => MoneyFunnel(await ref.watch(analyticsProvider.future)),
    );

/// 🔴 THE FETCH THAT REACHES THE GATE — [pipeline 5]M-5.
///
/// This provider is the whole requirement. `EntitlementCache` and `PaywallGate`
/// both existed and were tested for months with nothing in between them: no
/// code path in this repo had ever asked the server whether anybody had paid.
/// That is [pipeline C-6]'s shape — every part working, nothing joining them,
/// and no test red because refusing is correct when nobody has paid.
///
/// CACHE FIRST, THEN THE SERVER, and the order is not a performance trick:
/// - the cached answer is available at first frame, so a paying user does not
///   watch their own paid features flicker locked on every launch;
/// - the cache applies the staleness ceiling itself, so an answer nobody has
///   re-verified stops being honoured on its own ([5]M-8);
/// - the server answer overwrites it and is stamped verified, which is the ONLY
///   thing that resets that clock.
///
/// A failed fetch keeps the cached answer. It does not downgrade: a flat network
/// is not evidence of a refund.
final FutureProvider<core.Entitlements> entitlementsProvider =
    FutureProvider<core.Entitlements>((ref) async {
      final core.EntitlementCache cache = ref.watch(entitlementCacheProvider);
      final core.Entitlements cached = await cache.readValid();

      final core.Result<core.Entitlements> fresh = await ref
          .watch(entitlementTransportProvider)
          .fetch(
            appId: AppConfig.appId,
            accessToken: await ref
                .read(authRepositoryProvider)
                .currentAccessToken(),
          );

      final core.Entitlements? server = fresh.fold(
        (core.Entitlements e) => e,
        (core.Failure _) => null,
      );
      if (server == null) return cached;
      await cache.saveVerified(server);
      return server;
    });

/// Whether the premium surface is LOCKED for this user right now.
///
/// 🔴 THE TWO UNRESOLVED STATES POINT IN OPPOSITE DIRECTIONS, ON PURPOSE, and
/// writing that down is the point of this comment — a single "fails closed"
/// would be half false.
///
/// - **Config not resolved yet ⇒ NOT LOCKED.** We do not know whether this app
///   even HAS a paywall. Locking on that guess would show an upgrade wall in
///   every app that has none, for as long as a disk read takes. It is bounded
///   and cheap to be wrong here: [appConfigProvider] falls back to the
///   compiled-in default with no network, and that default is
///   `paywall.enabled: false` — so a stamped app resolves to "no paywall"
///   almost immediately and a configured one resolves from its last-good cache.
/// - **Config says there IS a paywall, entitlement not resolved ⇒ LOCKED.**
///   Now the direction flips, because the cost flips: guessing "unlocked" gives
///   the product away to everyone during every launch frame.
///
/// `paywall.enabled` is therefore the outer switch, and it is what makes being
/// born with the gate free for an app that sells nothing.
final Provider<bool> paywallLockedProvider = Provider<bool>((ref) {
  final core.AppConfig? cfg = ref.watch(appConfigProvider).valueOrNull;
  if (cfg == null || !cfg.paywall.enabled) return false;
  final core.Entitlements? ent = ref.watch(entitlementsProvider).valueOrNull;
  if (ent == null) return true;
  return !ent.isProAt(DateTime.now());
});

/// Re-read the entitlement from the server and republish the answer.
///
/// 🔒 THIS IS "RESTORE PURCHASES" ON THIS RAIL — [pipeline 5]M-10. There are no
/// device-local receipts to restore: the entitlement is a row keyed
/// `(user_id, app_id)` on a host every app shares, so a fresh install on a new
/// device is unlocked by SIGNING IN and nothing else. The control exists anyway
/// because a user who has just paid wants a button, and because Apple guideline
/// 3.1.1 makes an explicit Restore control mandatory the day a native IAP rail
/// ships — which 39-CHASSIS §4 cut 5 defers, and its absence is a documented
/// rejection cause.
Future<core.Entitlements> refreshEntitlements(WidgetRef ref) async {
  ref.invalidate(entitlementsProvider);
  return ref.read(entitlementsProvider.future);
}
