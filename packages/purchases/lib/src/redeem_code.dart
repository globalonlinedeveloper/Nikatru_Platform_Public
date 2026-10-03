import 'package:flutter/material.dart';
import 'package:nikatru_core/nikatru_core.dart';

import 'purchase_capabilities.dart';

/// How a code is redeemed on one distribution channel (lane growth-codes).
///
/// 🔴 THE MAP BELOW IS tooling/catalog/offers.json `channels[].mechanism`, and
/// tooling/ci/assert-offers.mjs limb 5 holds the two equal: a store-billed
/// channel (App Store, Play) never renders our own code field — App Store
/// Review Guideline 3.1.1 and Play's payments policy treat unlocking digital
/// content with our own code as a mechanism other than their billing. There,
/// a code is the store's own (an Apple offer code, a Play promo code),
/// redeemed in the store's own sheet.
enum RedeemMechanism {
  /// Our own code field, redeemed at `POST /v1/codes/redeem`.
  ownCode,

  /// App Store offer codes, through the system redemption sheet.
  appleOfferCode,

  /// Google Play promo codes, redeemed in the Play Store.
  playPromoCode,

  /// No code is redeemed on this channel.
  none,
}

/// Every app channel's mechanism, keyed by its `tooling/channel-register.json` id.
const Map<String, RedeemMechanism> kChannelRedeemMechanism =
    <String, RedeemMechanism>{
      'web': RedeemMechanism.ownCode,
      'android-play': RedeemMechanism.playPromoCode,
      'ios-appstore': RedeemMechanism.appleOfferCode,
      'macos-appstore': RedeemMechanism.appleOfferCode,
      'windows-store': RedeemMechanism.ownCode,
      'windows-direct': RedeemMechanism.ownCode,
      'linux-snap': RedeemMechanism.ownCode,
      'linux-appimage': RedeemMechanism.ownCode,
      'apps-gov-in': RedeemMechanism.ownCode,
    };

/// The mechanism of [channel]; [RedeemMechanism.none] for a channel the map
/// does not name (fail closed: no field).
RedeemMechanism redeemMechanismFor(PurchaseChannel channel) =>
    kChannelRedeemMechanism[channel.registerId] ?? RedeemMechanism.none;

/// The words [RedeemCodeEntry] shows, from the host's localisations.
class RedeemCodeLabels {
  const RedeemCodeLabels({
    required this.field,
    required this.redeem,
    required this.storeRedeem,
    required this.playHint,
    required this.redeemed,
    required this.refused,
  });

  final String field;
  final String redeem;
  final String storeRedeem;
  final String playHint;
  final String Function(String expiresAt) redeemed;
  final String Function(RedeemRefusal why) refused;
}

/// Stable keys for tests and the e2e lane.
abstract final class RedeemCodeKeys {
  static const Key field = ValueKey<String>('redeem-code-field');
  static const Key redeem = ValueKey<String>('redeem-code-submit');
  static const Key storeRedeem = ValueKey<String>('redeem-code-store');
  static const Key playHint = ValueKey<String>('redeem-code-play');
  static const Key result = ValueKey<String>('redeem-code-result');
}

/// "Redeem a code", per channel: our own field where the channel allows it,
/// the store's own redemption where the store bills, nothing where neither.
class RedeemCodeEntry extends StatefulWidget {
  const RedeemCodeEntry({
    required this.channel,
    required this.transport,
    required this.accessToken,
    required this.labels,
    required this.newIdempotencyKey,
    this.openStoreRedemption,
    super.key,
  });

  final PurchaseChannel channel;
  final OfferCodeTransport transport;
  final Future<String?> Function() accessToken;
  final RedeemCodeLabels labels;

  /// A fresh key per attempt; a retry of one attempt reuses it.
  final String Function() newIdempotencyKey;

  /// Opens the App Store's offer-code sheet (RevenueCat
  /// `presentCodeRedemptionSheet`); the button is absent when null.
  final Future<void> Function()? openStoreRedemption;

  @override
  State<RedeemCodeEntry> createState() => _RedeemCodeEntryState();
}

class _RedeemCodeEntryState extends State<RedeemCodeEntry> {
  final TextEditingController _code = TextEditingController();
  String? _key;
  String? _result;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _redeem() async {
    setState(() => _busy = true);
    _key ??= widget.newIdempotencyKey();
    final Result<RedeemedOffer> r = await widget.transport.redeem(
      accessToken: await widget.accessToken(),
      code: _code.text.trim(),
      idempotencyKey: _key!,
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _result = r.fold(
        (RedeemedOffer o) {
          _key = null;
          return widget.labels.redeemed(o.expiresAt);
        },
        (Failure f) => widget.labels.refused(
          f.cause is RedeemRefusal
              ? f.cause! as RedeemRefusal
              : RedeemRefusal.unavailable,
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final List<Widget> children = <Widget>[];
    switch (redeemMechanismFor(widget.channel)) {
      case RedeemMechanism.ownCode:
        children.addAll(<Widget>[
          TextField(
            key: RedeemCodeKeys.field,
            controller: _code,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            decoration: InputDecoration(labelText: widget.labels.field),
            onChanged: (_) => setState(() => _key = null),
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: RedeemCodeKeys.redeem,
            onPressed: _busy || _code.text.trim().length < 8 ? null : _redeem,
            child: Text(widget.labels.redeem),
          ),
        ]);
      case RedeemMechanism.appleOfferCode:
        if (widget.openStoreRedemption != null) {
          children.add(
            FilledButton(
              key: RedeemCodeKeys.storeRedeem,
              onPressed: widget.openStoreRedemption,
              child: Text(widget.labels.storeRedeem),
            ),
          );
        }
      case RedeemMechanism.playPromoCode:
        children.add(
          Text(widget.labels.playHint, key: RedeemCodeKeys.playHint),
        );
      case RedeemMechanism.none:
        break;
    }
    if (_result != null) {
      children.add(Text(_result!, key: RedeemCodeKeys.result));
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: children,
    );
  }
}
