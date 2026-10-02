import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';

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

/// The platform host's `POST /v1/checkout`. Answers a checkout for whatever it
/// is asked — or, with [fail], a failure — and records what it was asked, with
/// which token, so attribution is observable.
class _FakeSessions implements core.CheckoutSessionTransport {
  _FakeSessions({this.available = true, this.fail = false});
  final bool available;
  final bool fail;
  final List<({String appId, String offeringId, String? token})> asked =
      <({String appId, String offeringId, String? token})>[];

  @override
  bool get isAvailable => available;

  @override
  Future<core.Result<core.CheckoutSession>> createSession({
    required String appId,
    required String offeringId,
    required String? accessToken,
  }) async {
    asked.add((appId: appId, offeringId: offeringId, token: accessToken));
    if (fail) {
      return const core.Result<core.CheckoutSession>.err(
        core.Failure('checkout request failed'),
      );
    }
    return core.Result<core.CheckoutSession>.ok(
      core.CheckoutSession(
        checkoutUrl: Uri.parse(
          'https://nikatru.test/pricing.html?_ptxn=txn_$offeringId',
        ),
        transactionId: 'txn_$offeringId',
      ),
    );
  }
}

const Offering _monthly = Offering(
  productId: 'pro_monthly',
  amountMinor: 499,
  currencyCode: 'USD',
  term: OfferingTerm.month,
  trial: TrialPeriod.days(30),
);

HostedCheckoutRail _rail({
  required PurchaseChannel channel,
  core.CheckoutSessionTransport? sessions,
  List<Offering> offerings = const <Offering>[_monthly],
  String? account = 'user-123',
  CheckoutLauncher? launcher,
  core.CancellationTransport? cancellations,
}) => HostedCheckoutRail(
  config: RailConfig(
    offerings: offerings,
    // ⏱ 2026-10-01: NO template, as served. The rail no longer reads one.
    checkoutUrlTemplate: null,
    manageUrlTemplate: null,
  ),
  checkoutSessions: sessions ?? _FakeSessions(),
  appId: 'probe',
  returnUrl: 'https://nikatru.test/checkout-return',
  accountId: () async => account,
  accessToken: () async => 'token',
  cancellationTransport:
      cancellations ??
      _FakeCancellations(
        const core.Result<core.CancellationReceipt>.ok(
          core.CancellationReceipt(
            hasActivePlan: true,
            recorded: true,
            executed: false,
          ),
        ),
      ),
  launcher: launcher ?? FakeCheckoutLauncher(),
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
        final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
        final _FakeSessions sessions = _FakeSessions();
        final HostedCheckoutRail rail = _rail(
          channel: channel,
          sessions: sessions,
          launcher: launcher,
        );
        expect(rail.canStartCheckout, isTrue);

        final CheckoutStart start = await rail.startCheckout(_monthly);

        expect(start, isA<CheckoutOpened>());
        expect(launcher.opened, hasLength(1));
        // ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START: the page OPENED is
        // the one the platform host created for this offering…
        final Uri url = launcher.opened.single;
        expect(url.scheme, 'https');
        expect(url.queryParameters['_ptxn'], 'txn_pro_monthly');
        // 🔒 [5]M-7 — …and it was asked WITH THE SESSION, so the server
        // attributes the transaction to the verified account. Without it the
        // payment arrives unclaimed and nobody can grant the unlock.
        expect(sessions.asked.single.appId, 'probe');
        expect(sessions.asked.single.offeringId, 'pro_monthly');
        expect(sessions.asked.single.token, 'token');
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
        final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
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
    test(
      'NO platform host (backend not live) ⇒ railNotConfigured, nothing opened',
      () async {
        // The state today: no seller account exists (OWNER_QUEUE A-1), so no
        // template can have been pasted out of a console that nobody has.
        final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
        final _FakeSessions sessions = _FakeSessions(available: false);
        final CheckoutStart start = await _rail(
          channel: PurchaseChannel.web,
          sessions: sessions,
          launcher: launcher,
        ).startCheckout(_monthly);

        expect(
          (start as CheckoutRefused).reason,
          CheckoutRefusal.railNotConfigured,
        );
        expect(sessions.asked, isEmpty);
        expect(launcher.opened, isEmpty);
      },
    );

    test(
      'NOTHING TO SELL (paywall off) ⇒ railNotConfigured, host never asked',
      () async {
        final _FakeSessions sessions = _FakeSessions();
        final CheckoutStart start = await _rail(
          channel: PurchaseChannel.web,
          sessions: sessions,
          offerings: const <Offering>[],
        ).startCheckout(_monthly);

        expect(
          (start as CheckoutRefused).reason,
          CheckoutRefusal.railNotConfigured,
        );
        expect(sessions.asked, isEmpty);
      },
    );

    test(
      'the host REFUSING (403/429/502) is couldNotOpen, nothing opened',
      () async {
        final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
        final CheckoutStart start = await _rail(
          channel: PurchaseChannel.web,
          sessions: _FakeSessions(fail: true),
          launcher: launcher,
        ).startCheckout(_monthly);

        expect((start as CheckoutRefused).reason, CheckoutRefusal.couldNotOpen);
        expect(start.detail, isNotEmpty);
        expect(launcher.opened, isEmpty);
      },
    );

    test('NO account ⇒ notSignedIn, and the checkout never opens', () async {
      // [5]M-7. An unclaimed payment arising from an IN-APP purchase is a
      // defect, not a supported state — so the money never moves.
      final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
      final _FakeSessions sessions = _FakeSessions();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.web,
        account: null,
        sessions: sessions,
        launcher: launcher,
      ).startCheckout(_monthly);

      expect((start as CheckoutRefused).reason, CheckoutRefusal.notSignedIn);
      expect(sessions.asked, isEmpty);
      expect(launcher.opened, isEmpty);
    });

    test(
      'the platform refusing to open is couldNotOpen, not success',
      () async {
        final FakeCheckoutLauncher launcher = FakeCheckoutLauncher()
          ..answer = false;
        final CheckoutStart start = await _rail(
          channel: PurchaseChannel.web,
          launcher: launcher,
        ).startCheckout(_monthly);

        expect((start as CheckoutRefused).reason, CheckoutRefusal.couldNotOpen);
      },
    );

    test('canStartCheckout is false when EITHER half is false', () {
      expect(_rail(channel: PurchaseChannel.web).canStartCheckout, isTrue);
      expect(
        _rail(channel: PurchaseChannel.iosAppStore).canStartCheckout,
        isFalse,
      );
      expect(
        _rail(
          channel: PurchaseChannel.web,
          sessions: _FakeSessions(available: false),
        ).canStartCheckout,
        isFalse,
      );
      expect(
        _rail(
          channel: PurchaseChannel.web,
          offerings: const <Offering>[],
        ).canStartCheckout,
        isFalse,
      );
    });
  });

  group('[5]M-9 · cancellation reports what actually happened', () {
    test(
      'recorded-but-not-executed is its OWN outcome, never `executed`',
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
      },
    );

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

    // ⏱ 2026-10-01 · AB-M4-03-client: the server's 409 for a store row.
    test('a store row is inStore — never failed, never recorded', () async {
      final CancellationOutcome o = await _rail(
        channel: PurchaseChannel.web,
        cancellations: _FakeCancellations(
          const core.Result<core.CancellationReceipt>.ok(
            core.CancellationReceipt(
              hasActivePlan: true,
              recorded: false,
              executed: false,
              cancelAt: 'play_store',
            ),
          ),
        ),
      ).requestCancellation();
      expect(o, CancellationOutcome.inStore);
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

    test(
      'the cancel path is REACHED — the transport is really called',
      () async {
        // The account-deletion dialog in this same chassis once called
        // Navigator.pop and nothing else, which looks exactly like a button that
        // worked. Asserting the call count is what tells the two apart.
        final _FakeCancellations t = _FakeCancellations(
          const core.Result<core.CancellationReceipt>.err(core.Failure('x')),
        );
        await _rail(
          channel: PurchaseChannel.web,
          cancellations: t,
        ).requestCancellation();
        expect(t.calls, 1);
      },
    );
  });
}
