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

  /// Every identity the bridge was told, in order: `configure:<id>`,
  /// `identify:<id>`, `logOut`. [ADR 085] B's subject is exactly this list.
  final List<String> identities = <String>[];
  bool identifyAnswer = true;

  @override
  Future<bool> configure(IapBridgeConfig config) async {
    configureCalls++;
    identities.add('configure:${config.appUserId}');
    return configureAnswer;
  }

  @override
  Future<bool> identify(String appUserId) async {
    identities.add('identify:$appUserId');
    return identifyAnswer;
  }

  @override
  Future<bool> logOut() async {
    identities.add('logOut');
    return identifyAnswer;
  }

  /// What the store says it sells here. By default the one plan the rail
  /// config sells, at the config's own price; the tests that are about WHOSE
  /// price the paywall shows set their own.
  List<StorePlan> plans = const <StorePlan>[_storeMonthly];
  bool plansThrow = false;
  int storePlanCalls = 0;

  @override
  Future<List<StorePlan>> storePlans() async {
    storePlanCalls++;
    if (plansThrow) throw StateError('store unreachable');
    return plans;
  }

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
  trial: TrialPeriod.days(30),
);

/// The store's answer for [_monthly], priced as the config prices it.
const StorePlan _storeMonthly = StorePlan(
  productId: 'pro_monthly',
  amountMinor: 499,
  currencyCode: 'USD',
  term: OfferingTerm.month,
  trial: TrialPeriod.days(30),
);

const Offering _yearly = Offering(
  productId: 'pro_yearly',
  amountMinor: 4999,
  currencyCode: 'USD',
  term: OfferingTerm.year,
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

  // ── [ADR 085] B — THE SDK FOLLOWS THE SIGNED-IN ACCOUNT ───────────────────
  // The platform's RevenueCat webhook links an event to the NIKATRU user the
  // SDK was identified as. The rail configures once, so a user who signs in,
  // switches account or signs out AFTER that has to be forwarded — or the next
  // purchase is credited to the previous account.
  group('re-identification after the first configure', () {
    test('a sign-in AFTER configure calls identify with the new app user id',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
        config: const IapBridgeConfig(
          publicApiKey: 'public_test_key',
          entitlementId: 'pro',
          appUserId: null,
        ),
      );
      // Configure happens signed-out (a restore before sign-in does it).
      await rail.restorePurchases();
      expect(bridge.identities, <String>['configure:null']);

      expect(await rail.identifyBuyer('user-456'), isTrue);
      expect(bridge.identities, <String>['configure:null', 'identify:user-456']);

      // And the purchase that follows goes through as that account.
      final CheckoutStart start = await rail.startCheckout(_monthly);
      expect(start, isA<CheckoutSubmitted>());
      expect(bridge.identities.last, 'identify:user-456');
    });

    test('an account SWITCH re-identifies; the same id again is a no-op',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      );
      await rail.startCheckout(_monthly);
      expect(bridge.identities, <String>['configure:user-123']);

      await rail.identifyBuyer('user-123');
      await rail.identifyBuyer('user-789');
      expect(
        bridge.identities,
        <String>['configure:user-123', 'identify:user-789'],
      );
    });

    test('a sign-out calls logOut, and the next purchase is refused signed-out',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      );
      await rail.startCheckout(_monthly);

      expect(await rail.identifyBuyer(null), isTrue);
      expect(bridge.identities, <String>['configure:user-123', 'logOut']);

      final CheckoutStart start = await rail.startCheckout(_monthly);
      expect((start as CheckoutRefused).reason, CheckoutRefusal.notSignedIn);
    });

    test('a user change BEFORE configure is carried by configure itself',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      );
      await rail.identifyBuyer('user-456');
      expect(bridge.identities, isEmpty);

      await rail.startCheckout(_monthly);
      expect(bridge.identities, <String>['configure:user-456']);
    });

    test('a FAILED re-identify refuses the purchase instead of crediting the '
        'previous account', () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
      );
      await rail.startCheckout(_monthly);
      bridge.purchased.clear();

      bridge.identifyAnswer = false;
      expect(await rail.identifyBuyer('user-789'), isFalse);

      final CheckoutStart start = await rail.startCheckout(_monthly);
      expect(
        (start as CheckoutRefused).reason,
        CheckoutRefusal.railNotConfigured,
      );
      expect(start.detail, contains('credited to another'));
      expect(bridge.purchased, isEmpty);

      // It recovers once the store accepts the switch — checked on the money
      // path itself, so a missed auth event cannot stick.
      bridge.identifyAnswer = true;
      expect(await rail.startCheckout(_monthly), isA<CheckoutSubmitted>());
      expect(bridge.identities.last, 'identify:user-789');
    });
  });

  // O-IAP-PAYWALL-SHOWS-WEB-PRICE. A store build's paywall quoted the rail
  // config's amount — the WEB price — beside a sheet that bills the store's.
  // The rail now describes only what the store said, at the store's price.
  group("the paywall shows the STORE's plan, never the rail config's", () {
    test('before the store answers there is nothing to sell, not a web price',
        () {
      final IapRail rail = _rail(channel: PurchaseChannel.androidPlay);
      expect(rail.offerings, isEmpty);
      expect(rail.canStartCheckout, isFalse);
    });

    test("the store's amount and currency are what the rail describes",
        () async {
      final _FakeBridge bridge = _FakeBridge()
        ..plans = const <StorePlan>[
          StorePlan(
            productId: 'pro_monthly',
            amountMinor: 719,
            currencyCode: 'USD',
            term: OfferingTerm.month,
          ),
        ];
      final IapRail rail =
          _rail(channel: PurchaseChannel.androidPlay, bridge: bridge);
      int repaints = 0;
      offeringsChangesOf(rail).addListener(() => repaints++);

      await refreshOfferingsOf(rail);
      expect(rail.offerings.single.amountMinor, 719);
      expect(rail.offerings.single.amountMinor, isNot(_monthly.amountMinor));
      expect(rail.canStartCheckout, isTrue);
      expect(repaints, greaterThan(0));

      // A storefront in another currency is the store's answer too.
      bridge.plans = const <StorePlan>[
        StorePlan(
          productId: 'pro_monthly',
          amountMinor: 17900,
          currencyCode: 'INR',
          term: OfferingTerm.month,
        ),
      ];
      await refreshOfferingsOf(rail);
      expect(rail.offerings.single.amountMinor, 17900);
      expect(rail.offerings.single.currencyCode, 'INR');
    });

    test("the trial is the store's, for this buyer, in the store's unit",
        () async {
      final _FakeBridge bridge = _FakeBridge()
        ..plans = const <StorePlan>[
          StorePlan(
            productId: 'pro_monthly',
            amountMinor: 719,
            currencyCode: 'USD',
            term: OfferingTerm.month,
            trial: TrialPeriod(count: 1, unit: TrialUnit.month),
          ),
        ];
      final IapRail rail =
          _rail(channel: PurchaseChannel.iosAppStore, bridge: bridge);
      await refreshOfferingsOf(rail);
      expect(
        rail.offerings.single.trial,
        const TrialPeriod(count: 1, unit: TrialUnit.month),
      );

      // A buyer the store says is not eligible sees no trial, whatever the
      // config's 30 days say.
      bridge.plans = const <StorePlan>[
        StorePlan(
          productId: 'pro_monthly',
          amountMinor: 719,
          currencyCode: 'USD',
          term: OfferingTerm.month,
        ),
      ];
      await refreshOfferingsOf(rail);
      expect(rail.offerings.single.trial, isNull);
    });

    test('a plan the store does not return is not listed, and not sold by id',
        () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(
        channel: PurchaseChannel.androidPlay,
        bridge: bridge,
        offerings: const <Offering>[_monthly, _yearly],
      );
      await refreshOfferingsOf(rail);
      expect(
        rail.offerings.map((Offering o) => o.productId),
        <String>['pro_monthly'],
      );

      final CheckoutStart start = await rail.startCheckout(_yearly);
      expect(
        (start as CheckoutRefused).reason,
        CheckoutRefusal.railNotConfigured,
      );
      expect(start.detail, contains('does not offer pro_yearly'));
      expect(bridge.purchased, isEmpty);
    });

    test('a plan the store bills on another term is dropped, not relabelled',
        () async {
      final _FakeBridge bridge = _FakeBridge()
        ..plans = const <StorePlan>[
          StorePlan(
            productId: 'pro_monthly',
            amountMinor: 4999,
            currencyCode: 'USD',
            term: OfferingTerm.year,
          ),
        ];
      final IapRail rail =
          _rail(channel: PurchaseChannel.androidPlay, bridge: bridge);
      await refreshOfferingsOf(rail);
      expect(rail.offerings, isEmpty);
      expect(rail.canStartCheckout, isFalse);
    });

    test('a store that cannot be asked leaves nothing to sell', () async {
      final _FakeBridge bridge = _FakeBridge()..plansThrow = true;
      final IapRail rail =
          _rail(channel: PurchaseChannel.androidPlay, bridge: bridge);
      await refreshOfferingsOf(rail);
      expect(rail.offerings, isEmpty);
      expect(rail.canStartCheckout, isFalse);
    });

    test('a hosted channel never asks the store', () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail = _rail(channel: PurchaseChannel.web, bridge: bridge);
      await refreshOfferingsOf(rail);
      expect(bridge.storePlanCalls, 0);
      expect(bridge.configureCalls, 0);
      expect(rail.offerings, isEmpty);
    });

    test('a load and a tap that race share ONE configure', () async {
      final _FakeBridge bridge = _FakeBridge();
      final IapRail rail =
          _rail(channel: PurchaseChannel.androidPlay, bridge: bridge);
      final Future<void> load = refreshOfferingsOf(rail);
      final CheckoutStart start = await rail.startCheckout(_monthly);
      await load;
      expect(start, isA<CheckoutSubmitted>());
      expect(bridge.configureCalls, 1);
    });
  });
}
