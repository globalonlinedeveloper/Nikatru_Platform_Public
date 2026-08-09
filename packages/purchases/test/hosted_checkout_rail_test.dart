import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

/// Records what it was asked to open. The seam exists FOR this: a test cannot
/// observe a real browser opening, so "the checkout opens" would be a claim
/// nobody could check on any platform — which is how a paywall ships with a
/// button that does nothing.
class _RecordingLauncher implements CheckoutLauncher {
  final List<Uri> opened = <Uri>[];
  bool answer = true;

  @override
  Future<bool> open(Uri url) async {
    opened.add(url);
    return answer;
  }
}

class _FakeCancellations implements core.CancellationTransport {
  _FakeCancellations(this.result);
  final core.Result<core.CancellationReceipt> result;
  int calls = 0;

  @override
  Future<core.Result<core.CancellationReceipt>> requestCancellation({
    required String appId,
    required String? accessToken,
  }) async {
    calls++;
    return result;
  }
}

const Offering _monthly = Offering(
  productId: 'pro_monthly',
  amountMinor: 499,
  currencyCode: 'USD',
  term: OfferingTerm.month,
  trialDays: 30,
);

const String _template =
    'https://checkout.example.test/pay?price={price_id}&cust={account_id}'
    '&app={app_id}&back={return_url}';

HostedCheckoutRail _rail({
  required PurchaseChannel channel,
  String? template = _template,
  String? account = 'user-123',
  CheckoutLauncher? launcher,
  core.CancellationTransport? cancellations,
}) =>
    HostedCheckoutRail(
      config: RailConfig(
        offerings: const <Offering>[_monthly],
        checkoutUrlTemplate: template,
        manageUrlTemplate: null,
      ),
      appId: 'probe',
      returnUrl: 'https://nikatru.test/checkout-return',
      accountId: () async => account,
      accessToken: () async => 'token',
      cancellationTransport: cancellations ??
          _FakeCancellations(
            const core.Result<core.CancellationReceipt>.ok(
              core.CancellationReceipt(
                hasActivePlan: true,
                recorded: true,
                executed: false,
              ),
            ),
          ),
      launcher: launcher ?? _RecordingLauncher(),
      capabilities: PurchaseCapabilities.forChannel(channel),
    );

void main() {
  // ── [5]M-6(a) · THE LAUNCHER, PER SELLABLE CHANNEL ────────────────────────
  // `assert-purchase-path.mjs` requires every channel the matrix marks sellable
  // to be NAMED here. Claimed-but-unexercised is a build failure, so a platform
  // cannot be declared sellable without a test that opens a checkout on it.
  group('[5]M-6(a) · every sellable channel really opens the checkout', () {
    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.web,
      // Sellable since ADR 039 read Store Policies §10.8.1/§10.8.6: the store
      // permits a third-party purchase rail for non-game PC apps.
      PurchaseChannel.windowsStore,
      PurchaseChannel.windowsDirect,
      PurchaseChannel.linuxSnap,
      PurchaseChannel.linuxAppImage,
    ]) {
      test('${channel.registerId} opens the hosted checkout URL', () async {
        final _RecordingLauncher launcher = _RecordingLauncher();
        final HostedCheckoutRail rail = _rail(
          channel: channel,
          launcher: launcher,
        );

        final CheckoutStart start = await rail.startCheckout(_monthly);

        expect(start, isA<CheckoutOpened>());
        expect(launcher.opened, hasLength(1));
        final Uri url = launcher.opened.single;
        expect(url.scheme, 'https');
        expect(url.queryParameters['price'], 'pro_monthly');
        // 🔒 [5]M-7 — attribution. Without the account id the payment arrives
        // unclaimed and the buyer pays for an unlock nobody can grant them.
        expect(url.queryParameters['cust'], 'user-123');
        expect(url.queryParameters['app'], 'probe');
      });
    }
  });

  group('[5]M-15 · a forbidden channel refuses BEFORE it opens anything', () {
    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.iosAppStore,
      PurchaseChannel.macosAppStore,
      PurchaseChannel.androidPlay,
    ]) {
      test('${channel.registerId} refuses with channelNotPermitted', () async {
        final _RecordingLauncher launcher = _RecordingLauncher();
        final CheckoutStart start = await _rail(
          channel: channel,
          launcher: launcher,
        ).startCheckout(_monthly);

        expect(start, isA<CheckoutRefused>());
        expect(
          (start as CheckoutRefused).reason,
          CheckoutRefusal.channelNotPermitted,
        );
        // The REASON travels with the refusal — a refusal with no reason is
        // indistinguishable from a broken button.
        expect(start.detail, isNotEmpty);
        // Nothing was opened. An App Store build that launches an external
        // checkout is a documented rejection cause, not a grey area.
        expect(launcher.opened, isEmpty);
      });
    }
  });

  group('every refusal is a state the UI can explain', () {
    test('NO checkout template configured ⇒ railNotConfigured, nothing opened',
        () async {
      // The state today: no seller account exists (OWNER_QUEUE A-1), so no
      // template can have been pasted out of a console that nobody has.
      final _RecordingLauncher launcher = _RecordingLauncher();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.web,
        template: null,
        launcher: launcher,
      ).startCheckout(_monthly);

      expect(
          (start as CheckoutRefused).reason, CheckoutRefusal.railNotConfigured);
      expect(launcher.opened, isEmpty);
    });

    test('NO account ⇒ notSignedIn, and the checkout never opens', () async {
      // [5]M-7. An unclaimed payment arising from an IN-APP purchase is a
      // defect, not a supported state — so the money never moves.
      final _RecordingLauncher launcher = _RecordingLauncher();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.web,
        account: null,
        launcher: launcher,
      ).startCheckout(_monthly);

      expect((start as CheckoutRefused).reason, CheckoutRefusal.notSignedIn);
      expect(launcher.opened, isEmpty);
    });

    test('the platform refusing to open is couldNotOpen, not success',
        () async {
      final _RecordingLauncher launcher = _RecordingLauncher()..answer = false;
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.web,
        launcher: launcher,
      ).startCheckout(_monthly);

      expect((start as CheckoutRefused).reason, CheckoutRefusal.couldNotOpen);
    });

    test('canStartCheckout is false when EITHER half is false', () {
      expect(_rail(channel: PurchaseChannel.web).canStartCheckout, isTrue);
      expect(_rail(channel: PurchaseChannel.iosAppStore).canStartCheckout,
          isFalse);
      expect(
        _rail(channel: PurchaseChannel.web, template: null).canStartCheckout,
        isFalse,
      );
    });
  });

  group('[5]M-9 · cancellation reports what actually happened', () {
    test('recorded-but-not-executed is its OWN outcome, never `executed`',
        () async {
      // Folding these together is the app telling a user their subscription is
      // over on the strength of our having written down that they asked.
      final _FakeCancellations t = _FakeCancellations(
        const core.Result<core.CancellationReceipt>.ok(
          core.CancellationReceipt(
            hasActivePlan: true,
            recorded: true,
            executed: false,
          ),
        ),
      );
      final CancellationOutcome o = await _rail(
        channel: PurchaseChannel.web,
        cancellations: t,
      ).requestCancellation();

      expect(o, CancellationOutcome.recorded);
      expect(t.calls, 1);
    });

    test('executed on the rail is reported as executed', () async {
      final CancellationOutcome o = await _rail(
        channel: PurchaseChannel.web,
        cancellations: _FakeCancellations(
          const core.Result<core.CancellationReceipt>.ok(
            core.CancellationReceipt(
              hasActivePlan: true,
              recorded: true,
              executed: true,
            ),
          ),
        ),
      ).requestCancellation();
      expect(o, CancellationOutcome.executed);
    });

    test('nothing to cancel is noActivePlan, not failed', () async {
      final CancellationOutcome o = await _rail(
        channel: PurchaseChannel.web,
        cancellations: _FakeCancellations(
          const core.Result<core.CancellationReceipt>.ok(
            core.CancellationReceipt(
              hasActivePlan: false,
              recorded: false,
              executed: false,
            ),
          ),
        ),
      ).requestCancellation();
      expect(o, CancellationOutcome.noActivePlan);
    });

    test('a transport failure is FAILED — never quietly successful', () async {
      // A cancellation that silently did not happen is the worst outcome this
      // flow has: the user believes they are done and the billing continues.
      final CancellationOutcome o = await _rail(
        channel: PurchaseChannel.web,
        cancellations: _FakeCancellations(
          const core.Result<core.CancellationReceipt>.err(
            core.Failure('network down'),
          ),
        ),
      ).requestCancellation();
      expect(o, CancellationOutcome.failed);
    });

    test('the cancel path is REACHED — the transport is really called',
        () async {
      // The account-deletion dialog in this same chassis once called
      // Navigator.pop and nothing else, which looks exactly like a button that
      // worked. Asserting the call count is what tells the two apart.
      final _FakeCancellations t = _FakeCancellations(
        const core.Result<core.CancellationReceipt>.err(core.Failure('x')),
      );
      await _rail(channel: PurchaseChannel.web, cancellations: t)
          .requestCancellation();
      expect(t.calls, 1);
    });
  });
}
