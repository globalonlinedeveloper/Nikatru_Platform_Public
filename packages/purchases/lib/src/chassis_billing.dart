import 'package:nikatru_core/nikatru_core.dart' as core;

import 'checkout_launcher.dart';
import 'hosted_checkout_rail.dart';
import 'iap_bridge.dart';
import 'iap_rail.dart';
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
}

/// What [ChassisBilling.railFor] answered.
sealed class BillingRailResult {
  const BillingRailResult();
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
