import 'package:nikatru_core/nikatru_core.dart' as core;

import 'checkout_launcher.dart';
import 'hosted_checkout_rail.dart';
import 'iap_bridge.dart';
import 'iap_rail.dart';
import 'offering.dart';
import 'purchase_capabilities.dart';
import 'purchase_rail.dart';
import 'purchase_rail_kind.dart';
import 'rail_config.dart';

/// Everything a rail needs, whichever rail the channel turns out to take.
///
/// One object rather than two constructor shapes: the app assembles this once,
/// from its own configuration, and [ChassisBilling.railFor] decides. A caller
/// that had to know which fields the mobile rail needs would have to know which
/// rail it is getting, which is the decision this facade exists to take away.
class ChassisBillingConfig {
  const ChassisBillingConfig({
    required this.railConfig,
    required this.appId,
    required this.returnUrl,
    required this.accountId,
    required this.accessToken,
    required this.cancellationTransport,
    this.iapBridge,
    this.iapBridgeConfig,
    this.launcher = const UrlCheckoutLauncher(),
  });

  /// Offerings and URL templates, resolved from the CFG-1 config document.
  final RailConfig railConfig;

  final String appId;

  /// Where the hosted checkout returns the buyer. Unused by the store rail —
  /// the store sheet never leaves the app.
  final String returnUrl;

  /// The buyer's account id — [pipeline 5]M-7. Async because the hosted rail
  /// reads it at checkout time; the store rail needs it at CONFIGURE time and
  /// takes it from [iapBridgeConfig] instead.
  final Future<String?> Function() accountId;

  final Future<String?> Function() accessToken;

  final core.CancellationTransport cancellationTransport;

  /// The store SDK seam. Null in an app that has not opted in to mobile IAP —
  /// which is every app today, and the reason [ChassisBilling.railFor] REFUSES
  /// rather than inventing one.
  final IapBridge? iapBridge;

  /// The store SDK's configuration. Null for the same reason.
  final IapBridgeConfig? iapBridgeConfig;

  final CheckoutLauncher launcher;
}

/// Why a rail could not be built for a channel. Every value is a state an app
/// author has to be able to fix from the message alone.
enum BillingRailRefusal {
  /// The channel's register rail is a store rail, but this build ships no
  /// [IapBridge] — the app has not opted in. `assert-app-yaml` holds the
  /// declaration and the dependency together so this cannot ship silently, and
  /// this is the runtime half of the same rule.
  iapBridgeMissing,

  /// The channel declares `rail: none`. Nothing may open any checkout here.
  channelSellsNothing,

  /// The build declared no channel this register knows — the compiled-in
  /// `RELEASE_CHANNEL` default `'dev'`, or a value that is not a row id. A
  /// build that does not know its channel does not know its rail, so it sells
  /// nothing. Every release lane passes the define (`assert-channel-register`
  /// limb 6b-ii fails one that does not), so this is the answer for local and
  /// test builds only.
  channelUndeclared,
}

/// What [ChassisBilling.railFor] answered.
sealed class BillingRailResult {
  const BillingRailResult();

  /// The [PurchaseRail] a UI programs against, whichever way this answered:
  /// the rail when one was built, an [UnavailablePurchaseRail] that carries the
  /// refusal when none was. A paywall renders the refusal as a sentence; it
  /// never has to catch anything, and never has to type-test the result.
  PurchaseRail orUnavailableRail(ChassisBillingConfig config) {
    final BillingRailResult self = this;
    switch (self) {
      case BillingRailReady(:final PurchaseRail rail):
        return rail;
      case final BillingRailUnavailable refusal:
        return UnavailablePurchaseRail(
          refusal: refusal,
          config: config.railConfig,
          appId: config.appId,
          accessToken: config.accessToken,
          cancellationTransport: config.cancellationTransport,
        );
    }
  }
}

/// A rail was built. [rail] is a [PurchaseRail] and the caller does not care
/// which implementation — that is the whole facade.
final class BillingRailReady extends BillingRailResult {
  const BillingRailReady(this.rail, this.kind);

  final PurchaseRail rail;

  /// Which rail this is, for the surfaces that legitimately differ: a store
  /// build must show no steering to another rail ([ADR 039] D2/D3
  /// anti-steering), and only the caller knows whether it is about to.
  final PurchaseRailKind kind;
}

/// No rail could be built, and [reason] says why in a form the app author can
/// act on. NOT the same as a rail that refuses a purchase: this is a build-time
/// wiring answer, and it is returned rather than thrown so a paywall can show a
/// sentence instead of crashing.
final class BillingRailUnavailable extends BillingRailResult {
  const BillingRailUnavailable(this.reason, {required this.detail});

  final BillingRailRefusal reason;
  final String detail;
}

/// THE FACADE — one call, one rail, and the channel decides which.
///
/// ## Why this exists at all
/// Before it, `HostedCheckoutRail` was the only implementation and every caller
/// constructed it directly. Adding a second rail that way would put a
/// `if (Platform.isAndroid)` in every paywall in the portfolio, and the answer
/// is not the platform anyway — it is the CHANNEL, which a build cannot read
/// off `defaultTargetPlatform`. [ADR 039] decides the rail per channel, the
/// register records that decision, [PurchaseRailKind] mirrors it under a guard,
/// and this is where the mirror is consulted exactly once.
///
/// ## What it deliberately does not do
/// It does not pick a channel. A build genuinely does not know at runtime which
/// channel installed it (the APK/Play trap), so the channel is a value the app
/// declares — from `app.yaml` and its build lane — and is handed in here. A
/// facade that guessed the channel would be guessing the rail, on the one axis
/// where guessing wrong is a store removal.
abstract final class ChassisBilling {
  /// The channel whose `tooling/channel-register.json` id is [registerId], or
  /// null when no row carries it — `'dev'`, an empty string, a typo.
  static PurchaseChannel? channelNamed(String registerId) {
    for (final PurchaseChannel c in PurchaseChannel.values) {
      if (c.registerId == registerId) return c;
    }
    return null;
  }

  /// [railFor], for a channel the BUILD declared as text — the app's
  /// compile-time `RELEASE_CHANNEL`.
  ///
  /// 🔴 AN UNKNOWN CHANNEL IS NOT GUESSED. `RELEASE_CHANNEL` defaults to
  /// `'dev'`, and a build that does not know its channel does not know its
  /// rail: guessing `web` would put a hosted checkout in whatever binary forgot
  /// the define, which on a store channel is the anti-steering violation this
  /// facade exists to prevent. So it sells nothing, with a reason. Architecture
  /// decision 2026-09-19 (R10): every release lane passes the define, and
  /// `assert-channel-register` limb 6b-ii fails a release build that does not.
  static BillingRailResult railForDeclared(
    String releaseChannel,
    ChassisBillingConfig config,
  ) {
    final PurchaseChannel? channel = channelNamed(releaseChannel);
    if (channel == null) {
      return BillingRailUnavailable(
        BillingRailRefusal.channelUndeclared,
        detail: 'This build declares RELEASE_CHANNEL "$releaseChannel", which '
            'is not a row in tooling/channel-register.json, so it sells '
            'nothing. A release build passes --dart-define=RELEASE_CHANNEL=<id>.',
      );
    }
    return railFor(channel, config);
  }

  /// The rail [channel] sells through, built from [config].
  static BillingRailResult railFor(
    PurchaseChannel channel,
    ChassisBillingConfig config,
  ) {
    final PurchaseRailKind kind = PurchaseRailKind.forChannel(channel);

    if (kind == PurchaseRailKind.none) {
      return const BillingRailUnavailable(
        BillingRailRefusal.channelSellsNothing,
        detail: 'tooling/channel-register.json gives this channel rail `none`: '
            'it sells nothing and must open no checkout of any kind.',
      );
    }

    if (kind.isStoreBilling) {
      final IapBridge? bridge = config.iapBridge;
      final IapBridgeConfig? bridgeConfig = config.iapBridgeConfig;
      if (bridge == null || bridgeConfig == null) {
        return BillingRailUnavailable(
          BillingRailRefusal.iapBridgeMissing,
          detail:
              'Channel ${channel.registerId} sells through ${kind.registerId}, '
              'but this build ships no IapBridge. An app opts in by depending on '
              'nikatru_billing_revenuecat and declaring billing.mobileIap in its '
              'app.yaml; assert-app-yaml holds those two together.',
        );
      }
      return BillingRailReady(
        IapRail(
          bridge: bridge,
          bridgeConfig: bridgeConfig,
          config: config.railConfig,
          channel: channel,
          appId: config.appId,
          accessToken: config.accessToken,
          cancellationTransport: config.cancellationTransport,
          launcher: config.launcher,
          railKind: kind,
        ),
        kind,
      );
    }

    // 🔴 THE CAPABILITIES ARE RESOLVED FOR THE CHANNEL, NOT THE PLATFORM.
    // `HostedCheckoutRail`'s own default calls `forPlatform`, which takes the
    // RESTRICTIVE answer because a build that constructs it directly does not
    // know its channel. Here we DO know — the caller just told us — so the
    // better answer is taken honestly, which is what `forChannel` exists for.
    return BillingRailReady(
      HostedCheckoutRail(
        config: config.railConfig,
        appId: config.appId,
        returnUrl: config.returnUrl,
        accountId: config.accountId,
        accessToken: config.accessToken,
        cancellationTransport: config.cancellationTransport,
        launcher: config.launcher,
        capabilities: PurchaseCapabilities.forChannel(channel),
      ),
      kind,
    );
  }
}

/// The rail a build gets when [ChassisBilling] could not build one: it sells
/// nothing and says why, and it still lets a customer CANCEL.
///
/// ## Why a rail at all, rather than the refusal
/// Every surface in a stamped app programs against [PurchaseRail] — the
/// paywall, the promo card, the settings row, the manage-plan screen. A
/// refusal that was not a rail would put a type test in each of them, and the
/// one that forgot would crash where a sentence belongs. This answers
/// `canStartCheckout == false`, which every one of them already renders as
/// "purchases are not available here", and carries [refusal] for a surface
/// that wants to say why.
///
/// ## Why it still cancels — [pipeline 5]M-9
/// A build that cannot SELL can still be used by somebody who bought on
/// another channel: a web subscriber opening the Play build. ROSCA —
/// cancelling must be no harder than buying — does not depend on which rail
/// this build has, so the cancel request goes to our own host exactly as the
/// hosted rail sends it.
class UnavailablePurchaseRail implements PurchaseRail {
  UnavailablePurchaseRail({
    required this.refusal,
    required RailConfig config,
    required String appId,
    required Future<String?> Function() accessToken,
    required core.CancellationTransport cancellationTransport,
  })  : _config = config,
        _appId = appId,
        _accessToken = accessToken,
        _cancellations = cancellationTransport;

  /// Why no rail was built — the facade's own answer, unchanged.
  final BillingRailUnavailable refusal;

  final RailConfig _config;
  final String _appId;
  final Future<String?> Function() _accessToken;
  final core.CancellationTransport _cancellations;

  /// The configured plans, so a surface can still describe the product. A
  /// surface quotes a PRICE only when [canStartCheckout] is true: a price for
  /// something this build cannot sell is steering.
  ///
  /// 🔴 EXCEPT ON A STORE CHANNEL WITH NO BRIDGE: NOTHING. The config's book is
  /// the WEB price book, and on android-play, ios-appstore or macos-appstore
  /// the only honest description of a plan is the STORE's. A store build whose
  /// key was not compiled in ([BillingRailRefusal.iapBridgeMissing]) has no
  /// store to ask, so it describes nothing — it must never fall back to the
  /// web's amounts, even behind a `canStartCheckout` that every surface is
  /// trusted to read first. Every other refusal keeps the config's list: those
  /// channels' book IS the config's.
  @override
  List<Offering> get offerings =>
      refusal.reason == BillingRailRefusal.iapBridgeMissing
          ? const <Offering>[]
          : _config.offerings;

  @override
  bool get canStartCheckout => false;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async {
    return CheckoutRefused(
      refusal.reason == BillingRailRefusal.iapBridgeMissing
          ? CheckoutRefusal.railNotConfigured
          : CheckoutRefusal.channelNotPermitted,
      detail: refusal.detail,
    );
  }

  @override
  Future<CancellationOutcome> requestCancellation() async {
    final core.Result<core.CancellationReceipt> r = await _cancellations
        .requestCancellation(appId: _appId, accessToken: await _accessToken());
    return r.fold((core.CancellationReceipt receipt) {
      if (!receipt.hasActivePlan) return CancellationOutcome.noActivePlan;
      if (receipt.executed) return CancellationOutcome.executed;
      if (receipt.recorded) return CancellationOutcome.recorded;
      return CancellationOutcome.failed;
    }, (core.Failure _) => CancellationOutcome.failed);
  }
}
