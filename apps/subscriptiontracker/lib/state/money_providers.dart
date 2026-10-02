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
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_billing_revenuecat/nikatru_billing_revenuecat.dart';
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
  final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
  // ST-U2 (audit C35): `paywall.enabled` is the outer switch for SELLING too.
  if (cfg == null || !cfg.paywall.enabled) return RailConfig.empty;
  return RailConfig.fromPaywallExtra(cfg.paywall.extra);
});

/// ST-U2 (audit C35): whether this build SELLS. `paywall.enabled` false used
/// to hide the lock and nothing else — the Upgrade row, the promo card and the
/// paywall still offered a store offering, so a user could pay for nothing.
///
/// ⏱ ST-D9 (D9-3): AND NOT ON A CHANNEL WHOSE RAIL IS `none`. `apps-gov-in`
/// forbids every real rail, so its build could never sell — but a served
/// `paywall.enabled: true` still drew the Upgrade row, the promo card and a
/// paywall that could only say "not available here". Every surface that reads
/// this now hides there, while a Pro user keeps Manage (ROSCA reads `isPro`).
final Provider<bool> sellingEnabledProvider = Provider<bool>(
  (ref) =>
      (ref.watch(appConfigProvider).value?.paywall.enabled ?? false) &&
      channelMaySell(ref.watch(releaseChannelProvider)),
);

/// The channel this binary was BUILT for — the compile-time `RELEASE_CHANNEL`.
///
/// ⏱ 2026-10-01 · IN-05. A provider rather than a bare constant read so the
/// two readers that must agree — [sellingEnabledProvider] and
/// [paywallLockedProvider] — read ONE value, and a widget test can drive a
/// gov-channel build the binary itself can only be compiled as.
final Provider<String> releaseChannelProvider = Provider<String>(
  (ref) => AppConfig.releaseChannel,
);

/// Whether [releaseChannel] may show a Pro surface at all: false only for a
/// DECLARED channel whose rail is `none` (today `apps-gov-in`). An undeclared
/// channel — the `'dev'` default — answers true, so a dev build and every test
/// keep drawing what the config says; its rail already sells nothing.
bool channelMaySell(String releaseChannel) {
  final PurchaseChannel? channel = ChassisBilling.channelNamed(releaseChannel);
  return channel == null ||
      PurchaseRailKind.forChannel(channel) != PurchaseRailKind.none;
}

/// ST-D9 · what the paywall pitches, READ FROM CONFIG — never typed here.
///
/// The served `paywall` block carries three keys beside the offerings:
/// `pro_features` and `free_features`, lists of feature CODES the paywall
/// resolves through this app's catalogue (the D-11 ruling: sync is free, Pro is
/// plan and save), and `trial_copy`, the D-25 switch — no trial is worded
/// until a store trial is configured and this is served true. Absent keys are
/// empty lists and false, so a config that says nothing pitches nothing.
typedef PaywallPitch = ({List<String> pro, List<String> free, bool trialCopy});

final Provider<PaywallPitch> paywallPitchProvider = Provider<PaywallPitch>((
  ref,
) {
  final Map<String, Object?> extra =
      ref.watch(appConfigProvider).value?.paywall.extra ??
      const <String, Object?>{};
  List<String> codes(Object? v) => <String>[
    if (v is List)
      for (final Object? e in v)
        if (e is String) e,
  ];
  return (
    pro: codes(extra['pro_features']),
    free: codes(extra['free_features']),
    trialCopy: extra['trial_copy'] == true,
  );
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

/// ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START. The hosted rail's way to a
/// checkout page: `POST /v1/checkout` on the shared platform host, which creates
/// the transaction with this account's attribution and answers its URL. Same
/// discard rule as the two above — a build whose backend is not live opens no
/// checkout, and says so.
final Provider<core.CheckoutSessionTransport> checkoutSessionTransportProvider =
    Provider<core.CheckoutSessionTransport>((ref) {
      if (!AppConfig.isBackendLive) {
        return const core.UnavailableCheckoutSessionTransport();
      }
      return DioCheckoutSessionTransport(platformBaseUrl: kPlatformBaseUrl);
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
///
/// 🔴 THE STORE BRIDGE — this app OPTS IN to `billing.mobileIap` (app.yaml).
/// [revenueCatKey] is the RevenueCat PUBLIC SDK key the store lanes compile in
/// (`--dart-define=REVENUECAT_KEY`, from `REVENUECAT_PUBLIC_KEY_GOOGLE` on
/// android-play and `REVENUECAT_PUBLIC_KEY_APPLE` on ios-appstore and
/// macos-appstore; `assert-channel-register` limb 6b-iii refuses a store lane
/// that omits it and any other lane that carries it). With a key, a bridge is
/// built; with none, NO bridge is built, the facade answers `iapBridgeMissing`
/// and the store build sells nothing and describes nothing — it never falls
/// back to the web rail, because the facade picks the rail kind from the
/// channel alone. [newBridge] is called ONLY for a store channel: every other
/// channel's rail is decided before a bridge could matter, and a RevenueCat
/// bridge configured on web or Windows would be an SDK call with no store
/// behind it. Both parameters exist so a test can drive the real wiring with a
/// key and a fake bridge; production passes neither.
PurchaseRail purchaseRailFor(
  Ref ref,
  String releaseChannel, {
  String revenueCatKey = AppConfig.revenueCatApiKey,
  IapBridge Function() newBridge = RevenueCatBridge.new,
}) {
  final wiring = StoreBridgeWiring.forChannel(
    releaseChannel,
    publicKey: revenueCatKey,
    entitlementId: AppConfig.proEntitlementId,
    newBridge: newBridge,
  );
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
    checkoutSessions: ref.watch(checkoutSessionTransportProvider),
    // This app declares `billing.mobileIap` and depends on
    // nikatru_billing_revenuecat — `assert-app-yaml` limb 6 holds the two
    // together. The buyer's id is NOT passed here: the SDK is configured on the
    // first store call, and by then [IdentifiesBuyer] below has handed it the
    // settled sign-in, so the first configure already carries the account.
    iapBridge: wiring.bridge,
    iapBridgeConfig: wiring.config,
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
      buyer.identifyBuyer(next.value?.id).ignore();
    }

    ref.listen(authUserProvider, forward, fireImmediately: true);
  }

  // 🔴 ASK THE STORE ONCE, AT BUILD — not at the first paywall open. A store
  // rail describes nothing until the store answers, and the paywall is not the
  // only surface that reads its plans: the home promo card and the settings
  // upgrade row are drawn from the same list and would otherwise stay empty
  // until somebody happened to open the paywall. Placed AFTER the identity
  // listener on purpose: `fireImmediately` has already handed a settled
  // sign-in to the rail, so the SDK's first configure carries the account.
  // A no-op on every rail that is not a store rail (see [refreshOfferingsOf]).
  unawaited(refreshOfferingsOf(rail));
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
      // 🔴 AB-M3-03 · ONE ACCOUNT'S ANSWER IS NOT ANOTHER'S. This read the
      // sign-in with `ref.read` and nothing re-ran it, so after a sign-out and
      // a sign-in as someone else the app kept the FIRST account's plan until
      // restart. A change of SETTLED identity re-reads; the first settle is
      // the launch read itself (the token comes from the repository, not the
      // stream), so a cold start still asks the server once. A return to the
      // app re-reads too — `refreshOnReturn`.
      ref.listen<AsyncValue<core.AuthUser?>>(authUserProvider, (prev, next) {
        if (prev == null || !prev.hasValue || !next.hasValue) return;
        if (prev.value?.id != next.value?.id) ref.invalidateSelf();
      });
      // Read BEFORE the first await: a rebuild disposes this ref, and a
      // disposed ref throws when it is used.
      final core.EntitlementCache cache = ref.watch(entitlementCacheProvider);
      final core.EntitlementTransport transport = ref.watch(
        entitlementTransportProvider,
      );
      final core.AuthRepository auth = ref.read(authRepositoryProvider);
      final core.Entitlements cached = await cache.readValid();

      final core.Result<core.Entitlements> fresh = await transport.fetch(
        appId: AppConfig.appId,
        accessToken: await auth.currentAccessToken(),
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
///
/// ⏱ 2026-10-01 · IN-05: AND THE CHANNEL, exactly as [sellingEnabledProvider]
/// reads it. A `rail: none` build (`apps-gov-in`) can never sell, so a served
/// `paywall.enabled: true` locked a feature behind a "See Pro" that led to a
/// paywall with nothing to buy. There the lock is off: nothing it guards can be
/// bought, and the gov build ships the free product whole.
final Provider<bool> paywallLockedProvider = Provider<bool>((ref) {
  final core.AppConfig? cfg = ref.watch(appConfigProvider).value;
  if (cfg == null || !cfg.paywall.enabled) return false;
  if (!channelMaySell(ref.watch(releaseChannelProvider))) return false;
  final core.Entitlements? ent = ref.watch(entitlementsProvider).value;
  if (ent == null) return true;
  return !ent.isProAt(DateTime.now());
});

/// Re-read the entitlement from the server and republish the answer.
///
/// 🔒 THE SERVER HALF OF "RESTORE PURCHASES" — [pipeline 5]M-10. The Restore
/// control asks the rail first (`restorePurchasesOf`: the store, on a store
/// build) and re-reads the entitlement AFTER it, because the entitlement is a
/// row keyed `(user_id, app_id)` on a host every app shares and that row is the
/// only unlock. On a rail with no store to ask, this re-read is the whole
/// restore, and a fresh install on a new device is unlocked by SIGNING IN.
/// Apple guideline 3.1.1 makes an explicit Restore control mandatory in a build
/// that sells through StoreKit.
Future<core.Entitlements> refreshEntitlements(WidgetRef ref) async {
  ref.invalidate(entitlementsProvider);
  return ref.read(entitlementsProvider.future);
}

/// The same refresh, driven by a [ProviderContainer] instead of a [WidgetRef].
///
/// 🔴 FOR THE CALLER THAT CAN ONLY REFRESH *AFTER* AN AWAIT.
/// `WidgetRef.read`/`invalidate` are `_assertNotDisposed()` plus this exact
/// pair of calls on the container (flutter_riverpod 2.6.1
/// `consumer.dart:617-620` and `:630-633`), and that assert throws a real
/// `StateError` in RELEASE. `manage_plan_screen.dart`'s `_cancel` cannot
/// re-read before `requestCancellation()` returns — that would report the
/// state the user just asked to change — so it hoists the root scope's
/// container before its first await and passes it here. The container
/// outlives every widget under that scope.
///
/// ⚠️ [refreshEntitlements] DELIBERATELY DOES NOT DELEGATE TO THIS. Routing it
/// through here would drop `_assertNotDisposed()` from the `WidgetRef` path,
/// turning a loud use-after-dispose into a silent one — and both
/// `paywall_screen.dart` call sites are ORDERED on the recorded ground that
/// the invalidate throws when the widget is gone. The two bodies are two lines
/// that differ by that assert: the overlap is irreducible, not unfactored.
Future<core.Entitlements> refreshEntitlementsIn(
  ProviderContainer container,
) async {
  container.invalidate(entitlementsProvider);
  return container.read(entitlementsProvider.future);
}
