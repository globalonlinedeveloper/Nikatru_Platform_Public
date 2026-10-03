import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Redeem a code, per channel (lane growth-codes, Do 3). The red control: an
// App Store build renders NO own-code field; tooling/ci/assert-offers.mjs
// holds the map equal to tooling/catalog/offers.json.
// ─────────────────────────────────────────────────────────────────────────────

class _FakeCodes implements OfferCodeTransport {
  final List<(String, String)> redeemed = <(String, String)>[];
  Result<RedeemedOffer> answer = const Result<RedeemedOffer>.ok(
    RedeemedOffer(
      offer: 'st-free-month',
      app: 'subscriptiontracker',
      expiresAt: '2026-11-03T00:00:00.000Z',
      replay: false,
      months: 1,
    ),
  );

  @override
  Future<Result<RedeemedOffer>> redeem({
    required String? accessToken,
    required String code,
    required String idempotencyKey,
  }) async {
    redeemed.add((code, idempotencyKey));
    return answer;
  }

  @override
  Future<Result<String>> inviteCode({
    required String? accessToken,
    required String app,
  }) async => const Result<String>.ok('X');

  @override
  Future<Result<InviteState>> claimInvite({
    required String? accessToken,
    required String app,
    required String code,
  }) async => const Result<InviteState>.ok(InviteState(state: 'pending'));

  @override
  Future<Result<InviteCounts>> inviteCounts({
    required String? accessToken,
    required String app,
  }) async =>
      const Result<InviteCounts>.ok(InviteCounts(joined: 0, rewarded: 0));

  @override
  Future<Result<InviteState>> settleInvite({
    required String? accessToken,
    required String app,
  }) async => const Result<InviteState>.ok(InviteState(state: 'pending'));
}

final RedeemCodeLabels _labels = RedeemCodeLabels(
  field: 'Code',
  redeem: 'Redeem',
  storeRedeem: 'Redeem an App Store offer code',
  playHint: 'Redeem Google Play codes in the Play Store',
  redeemed: (String at) => 'Pro until $at',
  refused: (RedeemRefusal why) => 'Refused: ${why.name}',
);

Widget _host(PurchaseChannel channel, _FakeCodes codes, {List<String>? sheet}) {
  int n = 0;
  return MaterialApp(
    home: Scaffold(
      body: RedeemCodeEntry(
        channel: channel,
        transport: codes,
        accessToken: () async => 'token',
        labels: _labels,
        newIdempotencyKey: () => 'key-${++n}',
        openStoreRedemption: sheet == null
            ? null
            : () async => sheet.add('open'),
      ),
    ),
  );
}

void main() {
  test(
    'every app channel has a mechanism, and a store-billed one never our own code',
    () {
      for (final PurchaseChannel c in PurchaseChannel.values) {
        expect(
          kChannelRedeemMechanism.containsKey(c.registerId),
          isTrue,
          reason: '${c.registerId} has no redeem mechanism',
        );
        final String kind = c.registerId;
        if (kind == 'ios-appstore' ||
            kind == 'macos-appstore' ||
            kind == 'android-play') {
          expect(redeemMechanismFor(c), isNot(RedeemMechanism.ownCode));
        }
      }
    },
  );

  testWidgets('🔴 an App Store build renders NO own-code field', (
    WidgetTester tester,
  ) async {
    final List<String> sheet = <String>[];
    await tester.pumpWidget(
      _host(PurchaseChannel.iosAppStore, _FakeCodes(), sheet: sheet),
    );
    expect(find.byKey(RedeemCodeKeys.field), findsNothing);
    expect(find.byType(TextField), findsNothing);
    await tester.tap(find.byKey(RedeemCodeKeys.storeRedeem));
    expect(sheet, <String>['open']);
  });

  testWidgets('a Play build renders no field either, only where to redeem', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(_host(PurchaseChannel.androidPlay, _FakeCodes()));
    expect(find.byType(TextField), findsNothing);
    expect(find.byKey(RedeemCodeKeys.playHint), findsOneWidget);
  });

  testWidgets(
    'the web build redeems our own code, and a retry reuses its key',
    (WidgetTester tester) async {
      final _FakeCodes codes = _FakeCodes()
        ..answer = const Result<RedeemedOffer>.err(
          Failure('x', cause: RedeemRefusal.unavailable),
        );
      await tester.pumpWidget(_host(PurchaseChannel.web, codes));
      await tester.enterText(
        find.byKey(RedeemCodeKeys.field),
        'abcd-efgh-jklm',
      );
      await tester.pump();
      await tester.tap(find.byKey(RedeemCodeKeys.redeem));
      await tester.pumpAndSettle();
      expect(find.text('Refused: unavailable'), findsOneWidget);
      await tester.tap(find.byKey(RedeemCodeKeys.redeem));
      await tester.pumpAndSettle();
      expect(codes.redeemed.map(((String, String) r) => r.$2).toSet(), <String>{
        'key-1',
      });
    },
  );

  test('every status the redeem route answers is mapped', () {
    expect(RedeemRefusal.forStatus(404), RedeemRefusal.unknownCode);
    expect(RedeemRefusal.forStatus(410), RedeemRefusal.expired);
    expect(RedeemRefusal.forStatus(409), RedeemRefusal.exhausted);
    expect(RedeemRefusal.forStatus(429), RedeemRefusal.throttled);
    expect(RedeemRefusal.forStatus(422), RedeemRefusal.invalid);
    expect(RedeemRefusal.forStatus(503), RedeemRefusal.unavailable);
  });
}
