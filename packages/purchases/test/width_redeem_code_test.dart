import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// "Redeem a code" at a phone and a desktop width (lane growth-codes), on a
/// channel with our own field and on a store-billed one. Each pump fails on
/// any overflow, and the control a person must reach stays on screen.

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

Future<void> _at(
  WidgetTester tester,
  Size size,
  PurchaseChannel channel,
) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
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
  await tester.pump();
}

void main() {
  for (final Size size in const <Size>[Size(375, 812), Size(1280, 800)]) {
    testWidgets(
      'RedeemCodeEntry at $size on the web: no overflow, field and button reachable',
      (WidgetTester tester) async {
        await _at(tester, size, PurchaseChannel.web);
        expect(tester.takeException(), isNull);
        expect(find.byKey(RedeemCodeKeys.field).hitTestable(), findsOneWidget);
        expect(find.byKey(RedeemCodeKeys.redeem).hitTestable(), findsOneWidget);
      },
    );

    testWidgets(
      'RedeemCodeEntry at $size on the App Store: no overflow, the store sheet reachable',
      (WidgetTester tester) async {
        await _at(tester, size, PurchaseChannel.iosAppStore);
        expect(tester.takeException(), isNull);
        expect(
          find.byKey(RedeemCodeKeys.storeRedeem).hitTestable(),
          findsOneWidget,
        );
      },
    );
  }
}
