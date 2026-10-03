import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// "Redeem a code" against flutter_test's own guidelines (lane growth-codes):
/// 48 x 48 hit areas, a name on every control a person can activate, and text
/// contrast — on a channel with our own field and on a store-billed one.

class _NoCodes implements OfferCodeTransport {
  @override
  Future<Result<RedeemedOffer>> redeem({
    required String? accessToken,
    required String code,
    required String idempotencyKey,
  }) async => const Result<RedeemedOffer>.err(Failure('none'));

  @override
  Future<Result<String>> inviteCode({
    required String? accessToken,
    required String app,
  }) async => const Result<String>.err(Failure('none'));

  @override
  Future<Result<InviteState>> claimInvite({
    required String? accessToken,
    required String app,
    required String code,
  }) async => const Result<InviteState>.err(Failure('none'));

  @override
  Future<Result<InviteCounts>> inviteCounts({
    required String? accessToken,
    required String app,
  }) async => const Result<InviteCounts>.err(Failure('none'));

  @override
  Future<Result<InviteState>> settleInvite({
    required String? accessToken,
    required String app,
  }) async => const Result<InviteState>.err(Failure('none'));
}

final RedeemCodeLabels _labels = RedeemCodeLabels(
  field: 'Offer code',
  redeem: 'Redeem',
  storeRedeem: 'Redeem an App Store offer code',
  playHint: 'Redeem Google Play codes in the Play Store',
  redeemed: (String at) => 'Pro until $at',
  refused: (RedeemRefusal why) => 'Not redeemed: ${why.name}',
);

void main() {
  testWidgets(
    'RedeemCodeEntry meets the tap-target, label and contrast guidelines on every app channel',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        for (final PurchaseChannel channel in PurchaseChannel.values) {
          await tester.pumpWidget(const SizedBox());
          await tester.pumpWidget(
            MaterialApp(
              home: Scaffold(
                body: Padding(
                  padding: const EdgeInsets.all(16),
                  child: RedeemCodeEntry(
                    channel: channel,
                    transport: _NoCodes(),
                    accessToken: () async => 'token',
                    labels: _labels,
                    newIdempotencyKey: () => 'key-1',
                    openStoreRedemption: () async {},
                  ),
                ),
              ),
            ),
          );
          await tester.pumpAndSettle();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        }
      } finally {
        handle.dispose();
      }
    },
  );
}
