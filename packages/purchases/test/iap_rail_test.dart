import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';

class _FakeBridge implements IapBridge {
  _FakeBridge({
    this.configureAnswer = true,
    this.purchaseAnswer = const IapPurchaseResult(IapPurchaseOutcome.submitted),
    this.state = IapCustomerState.unknown,
  });

  bool configureAnswer;
  IapPurchaseResult purchaseAnswer;
  IapCustomerState state;

  int configureCalls = 0;
  int stateCalls = 0;
  final List<String> purchased = <String>[];
  int restoreCalls = 0;

  @override
  Future<bool> configure(IapBridgeConfig config) async {
    configureCalls++;
    return configureAnswer;
  }

  @override
  Future<Set<String>> purchasableProductIds() async => <String>{'pro_monthly'};

  @override
  Future<IapPurchaseResult> purchase(Offering offering) async {
    purchased.add(offering.productId);
    return purchaseAnswer;
  }

  @override
  Future<IapPurchaseResult> restore() async {
    restoreCalls++;
    return const IapPurchaseResult(IapPurchaseOutcome.submitted);
  }

  @override
  Future<IapCustomerState> currentCustomerState() async {
    stateCalls++;
    return state;
  }

  @override
  Stream<IapCustomerState> get customerState =>
      Stream<IapCustomerState>.value(state);
}

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

/// A transport that answers "not Pro" every time. The point of the convergence
/// test is that the RAIL never unlocks on the store's word.
class _NeverPro implements core.EntitlementTransport {
  int calls = 0;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    calls++;
    return const core.Result<core.Entitlements>.ok(core.Entitlements.none);
  }
}

/// An in-memory [core.SecureStore]. The cache under test is the real one — the
/// same fake the convergence suite uses, for the same reason: a fake CACHE would
/// agree with the poller about exactly the thing being tested.
class _MemStore implements core.SecureStore {
  final Map<String, String> _m = <String, String>{};

  @override
  Future<void> delete(String key) async => _m.remove(key);

  @override
  Future<void> deleteAll() async => _m.clear();

  @override
  Future<String?> read(String key) async => _m[key];

  @override
  Future<void> write(String key, String value) async => _m[key] = value;
}

const Offering _monthly = Offering(
  productId: 'pro_monthly',
  amountMinor: 499,
  currencyCode: 'USD',
  term: OfferingTerm.month,
  trialDays: 30,
);

const IapBridgeConfig _bridgeConfig = IapBridgeConfig(
  publicApiKey: 'public_test_key',
  entitlementId: 'pro',
  appUserId: 'user-123',
);

IapRail _rail({
  required PurchaseChannel channel,
  IapBridge? bridge,
  IapBridgeConfig config = _bridgeConfig,
  List<Offering> offerings = const <Offering>[_monthly],
  CheckoutLauncher? launcher,
  core.CancellationTransport? cancellations,
}) =>
    IapRail(
      bridge: bridge ?? _FakeBridge(),
      bridgeConfig: config,
      config: RailConfig(
        offerings: offerings,
        checkoutUrlTemplate: null,
        manageUrlTemplate: null,
      ),
      channel: channel,
      appId: 'probe',
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
    );

void main() {
  group('the rail refuses before it can take money it should not', () {
    test('a paddle channel is refused, naming the register as the decision',
        () async {
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.web,
      ).startCheckout(_monthly);
      expect(start, isA<CheckoutRefused>());
      final CheckoutRefused r = start as CheckoutRefused;
      expect(r.reason, CheckoutRefusal.channelNotPermitted);
      expect(r.detail, contains('channel-register.json'));
    });

    test('[5]M-7 · no account id means the sheet never opens', () async {
      final _FakeBridge bridge = _FakeBridge();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
        config: const IapBridgeConfig(
          publicApiKey: 'public_test_key',
          entitlementId: 'pro',
          appUserId: null,
        ),
      ).startCheckout(_monthly);
      expect((start as CheckoutRefused).reason, CheckoutRefusal.notSignedIn);
      // The order matters: an unattributable purchase must be refused BEFORE
      // the store is even configured, not after the money moves.
      expect(bridge.configureCalls, 0);
      expect(bridge.purchased, isEmpty);
    });

    test('no offerings is railNotConfigured, not a store failure', () async {
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.androidPlay,
        offerings: const <Offering>[],
      ).startCheckout(_monthly);
      expect(
        (start as CheckoutRefused).reason,
        CheckoutRefusal.railNotConfigured,
      );
    });

    test('a bridge that cannot configure refuses with a stated reason',
        () async {
      final _FakeBridge bridge = _FakeBridge(configureAnswer: false);
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.iosAppStore,
        bridge: bridge,
      ).startCheckout(_monthly);
      expect(
        (start as CheckoutRefused).reason,
        CheckoutRefusal.railNotConfigured,
      );
      expect(bridge.purchased, isEmpty);
    });
  });

  group('the store sheet runs, and it still does not unlock', () {
    test('a completed sheet answers CheckoutSubmitted — never an unlock',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      ).startCheckout(_monthly);
      expect(start, isA<CheckoutSubmitted>());
      expect((start as CheckoutSubmitted).offering.productId, 'pro_monthly');
      expect(bridge.purchased, <String>['pro_monthly']);
    });

    test('[5]M-5 · the unlock still comes from the SERVER, and only from there',
        () async {
      // 🔴 THE WHOLE POINT OF THE RAIL. The store said the purchase completed;
      // the server says not Pro. The rail must land on stillPending — a client
      // that unlocked on the store's word would be granting entitlement on a
      // device the customer controls.
      final _FakeBridge bridge = _FakeBridge();
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      ).startCheckout(_monthly);
      expect(start, isA<CheckoutSubmitted>());

      final _NeverPro transport = _NeverPro();
      final ConvergenceResult r = await EntitlementConvergence(
        transport: transport,
        cache: core.EntitlementCache(store: _MemStore()),
        delays: const <Duration>[Duration.zero, Duration.zero],
        sleep: (Duration _) async {},
      ).awaitUnlock(appId: 'probe', accessToken: () async => 'token');

      expect(r.outcome, ConvergenceOutcome.stillPending);
      expect(r.isUnlocked, isFalse);
      expect(transport.calls, 3);
    });

    test('a user cancel is a REFUSAL, never a failure', () async {
      final CheckoutStart start = await _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: _FakeBridge(
          purchaseAnswer: const IapPurchaseResult(
            IapPurchaseOutcome.cancelledByUser,
            detail: 'dismissed',
          ),
        ),
      ).startCheckout(_monthly);
      expect(
        (start as CheckoutRefused).reason,
        CheckoutRefusal.purchaseCancelled,
      );
    });

    test('restore is offered on a store rail and refused on a hosted one',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      expect(
        (await _rail(channel: PurchaseChannel.androidPlay, bridge: bridge)
                .restorePurchases())
            .outcome,
        IapPurchaseOutcome.submitted,
      );
      expect(bridge.restoreCalls, 1);
      expect(
        (await _rail(channel: PurchaseChannel.web, bridge: _FakeBridge())
                .restorePurchases())
            .outcome,
        IapPurchaseOutcome.unavailable,
      );
    });
  });

  group('[5]M-9 ROSCA · cancel records FIRST, then opens the store page', () {
    test('the record is written and the management page is opened', () async {
      final _FakeCancellations cancellations = _FakeCancellations(
        const core.Result<core.CancellationReceipt>.ok(
          core.CancellationReceipt(
            hasActivePlan: true,
            recorded: true,
            executed: false,
          ),
        ),
      );
      final _RecordingLauncher launcher = _RecordingLauncher();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: _FakeBridge(
          state: IapCustomerState(
            activeEntitlementIds: const <String>{'pro'},
            managementUrl: Uri.parse('https://play.google.test/subscriptions'),
          ),
        ),
        cancellations: cancellations,
        launcher: launcher,
      );

      expect(await rail.requestCancellation(), CancellationOutcome.recorded);
      expect(cancellations.calls, 1);
      expect(launcher.opened.single.host, 'play.google.test');
    });

    test('our record is written even when the store page cannot be opened',
        () async {
      // The one case where a customer NEEDS the record is the case where the
      // page did not open. Writing it second would mean writing nothing.
      final _FakeCancellations cancellations = _FakeCancellations(
        const core.Result<core.CancellationReceipt>.ok(
          core.CancellationReceipt(
            hasActivePlan: true,
            recorded: true,
            executed: false,
          ),
        ),
      );
      final _RecordingLauncher launcher = _RecordingLauncher()..answer = false;
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: _FakeBridge(state: IapCustomerState.unknown),
        cancellations: cancellations,
        launcher: launcher,
      );

      expect(await rail.requestCancellation(), CancellationOutcome.recorded);
      expect(cancellations.calls, 1);
      // No management URL from the store, so nothing to open — and the outcome
      // is unchanged.
      expect(launcher.opened, isEmpty);
    });

    test('no active plan opens nothing', () async {
      final _RecordingLauncher launcher = _RecordingLauncher();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        cancellations: _FakeCancellations(
          const core.Result<core.CancellationReceipt>.ok(
            core.CancellationReceipt(
              hasActivePlan: false,
              recorded: false,
              executed: false,
            ),
          ),
        ),
        launcher: launcher,
      );
      expect(await rail.requestCancellation(), CancellationOutcome.noActivePlan);
      expect(launcher.opened, isEmpty);
    });
  });
}
