/// THE CLIENT PAYMENTS CONFORMANCE SUITE — one scenario list that every
/// [PurchaseRail] and every [IapBridge] must pass, whichever rail or store SDK
/// it is (tooling/ports/README.md §3 "Conformance"; registry
/// tooling/ports/payments.json `client`).
///
/// ## Shape
/// A suite is a SCENARIO LIST plus a per-adapter FIXTURE: for each scenario the
/// adapter's own test hands over a function that builds the adapter already
/// arranged for it (its own launcher, its own store script, its own method
/// channel). The suite owns every ASSERTION, so an adapter cannot pass by
/// declaring its own expectations.
///
/// 🔴 A MISSING FIXTURE IS A THROW, NEVER A SKIP. [runPurchaseRailConformance]
/// and [runIapBridgeConformance] throw [ConformanceFixtureMissing] when a
/// scenario has no fixture, which fails the test file at load: a suite that
/// skipped what an adapter did not supply would print green over nothing.
///
/// ## The scenarios
/// load offerings · purchase success · user cancel · pending · failure ·
/// restore · entitlement convergence (the three terminal states of
/// `EntitlementConvergence`) · no lifetime offering in-app ([ADR 093] §11.2).
///
/// assert-ports' client limb matches the runner as a CALL in each adapter's
/// conformance test — not an import of this file.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import '../nikatru_purchases.dart';

/// The scenarios every [PurchaseRail] must pass.
enum PurchaseRailScenario {
  /// The rail's source (the config, or the store once asked) sells
  /// [ConformancePlans.monthly] and [ConformancePlans.yearly].
  loadOfferings('load offerings'),

  /// The buyer completes the payment.
  purchaseSuccess('purchase success'),

  /// The buyer dismisses the purchase (the store's sheet, or the hosted page —
  /// which the rail cannot see).
  userCancel('user cancel'),

  /// The payment is handed over and settles later: the server has not seen it.
  pending('pending'),

  /// The checkout cannot be started or completed (no page, no store).
  failure('failure'),

  /// The buyer asks to restore prior purchases.
  restore('restore'),

  /// After a purchase the unlock is the SERVER's read, in all three terminal
  /// states of `EntitlementConvergence`.
  entitlementConvergence('entitlement convergence'),

  /// The config sells [ConformancePlans.lifetime]; no store sheet may.
  noLifetimeInApp('no lifetime offering in-app');

  const PurchaseRailScenario(this.label);

  /// The case name, as the registry and the PR name it.
  final String label;
}

/// The scenarios every [IapBridge] must pass.
enum IapBridgeScenario {
  /// The store describes [ConformancePlans.monthly] and
  /// [ConformancePlans.yearly] as subscriptions.
  loadOfferings('load offerings'),

  /// The buyer completes the store's sheet.
  purchaseSuccess('purchase success'),

  /// The buyer dismisses the store's sheet.
  userCancel('user cancel'),

  /// The store accepts the purchase and settles it later (Ask to Buy, a slow
  /// payment method).
  pending('pending'),

  /// The store refuses, or cannot be asked.
  failure('failure'),

  /// The store is asked to restore prior purchases and answers.
  restore('restore'),

  /// The store CLAIMS the entitlement; the unlock is still the server's read.
  entitlementConvergence('entitlement convergence'),

  /// The store also describes [ConformancePlans.lifetime]; it is never offered
  /// in-app.
  noLifetimeInApp('no lifetime offering in-app');

  const IapBridgeScenario(this.label);

  final String label;
}

/// Builds the rail under test, arranged for one scenario.
typedef PurchaseRailFixture = Future<PurchaseRail> Function();

/// Builds the bridge under test, arranged for one scenario.
typedef IapBridgeFixture = Future<IapBridge> Function();

/// Thrown by a runner when an adapter supplied no fixture for a scenario.
class ConformanceFixtureMissing implements Exception {
  ConformanceFixtureMissing(this.adapter, this.missing);

  final String adapter;
  final List<String> missing;

  @override
  String toString() =>
      'ConformanceFixtureMissing: `$adapter` supplies no fixture for '
      '${missing.join(', ')}. A missing fixture is a failure, never a skip: '
      'arrange the adapter for every scenario, or record the case as '
      '`pending` in tooling/ports/payments.json with its O- row.';
}

/// The plans every fixture sells — one source of ids, prices and terms, so a
/// fixture arranges its config or its store to sell THESE and the suite can
/// name what it expects.
abstract final class ConformancePlans {
  static const Offering monthly = Offering(
    productId: 'pro_monthly',
    amountMinor: 499,
    currencyCode: 'USD',
    term: OfferingTerm.month,
  );

  static const Offering yearly = Offering(
    productId: 'pro_yearly',
    amountMinor: 3499,
    currencyCode: 'USD',
    term: OfferingTerm.year,
  );

  /// A web-only plan: [ADR 093] §11.2, no store sells it.
  static const Offering lifetime = Offering(
    productId: 'pro_lifetime',
    amountMinor: 8900,
    currencyCode: 'USD',
    term: OfferingTerm.oneTime,
  );

  /// What the rail config sells.
  static const List<Offering> config = <Offering>[monthly, yearly, lifetime];

  /// The rail config's `paywall` document for [config], with a checkout
  /// template on an https host — what a hosted fixture hands `RailConfig`.
  static const Map<String, Object?> paywallExtra = <String, Object?>{
    'offerings': <Object?>[
      <String, Object?>{
        'product_id': 'pro_monthly',
        'amount_minor': 499,
        'currency_code': 'USD',
        'term': 'month',
        'trial_days': 0,
      },
      <String, Object?>{
        'product_id': 'pro_yearly',
        'amount_minor': 3499,
        'currency_code': 'USD',
        'term': 'year',
        'trial_days': 0,
      },
      <String, Object?>{
        'product_id': 'pro_lifetime',
        'amount_minor': 8900,
        'currency_code': 'USD',
        'term': 'one_time',
        'trial_days': 0,
      },
    ],
    'checkout_url_template':
        'https://checkout.example.test/pay?price={price_id}&cust={account_id}',
  };

  /// What a store describes: the two subscriptions, and — when
  /// [withLifetime] — a non-consumable under the lifetime id, which must
  /// still never be offered in-app.
  static List<StorePlan> storePlans({bool withLifetime = false}) => <StorePlan>[
    const StorePlan(
      productId: 'pro_monthly',
      amountMinor: 719,
      currencyCode: 'USD',
      term: OfferingTerm.month,
    ),
    const StorePlan(
      productId: 'pro_yearly',
      amountMinor: 4999,
      currencyCode: 'USD',
      term: OfferingTerm.year,
    ),
    if (withLifetime)
      const StorePlan(
        productId: 'pro_lifetime',
        amountMinor: 8900,
        currencyCode: 'USD',
        term: OfferingTerm.oneTime,
      ),
  ];

  /// The store SDK configuration a bridge fixture is configured with.
  static const IapBridgeConfig bridgeConfig = IapBridgeConfig(
    publicApiKey: 'public_conformance_key',
    entitlementId: 'pro',
    appUserId: 'conformance-user',
  );

  static const String appId = 'conformance';
}

// ── the server, as the suite scripts it ─────────────────────────────────────

/// The entitlement read, scripted by the SUITE (never by a fixture): the
/// server is the one authority on the unlock, and a fixture that could script
/// it could script its way past a rail that unlocks on its own word.
class _ScriptedServer implements core.EntitlementTransport {
  _ScriptedServer({this.proFromRead, this.reachable = true});

  /// The 1-based read from which the server says Pro; null = never.
  final int? proFromRead;
  final bool reachable;
  int reads = 0;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    reads++;
    if (!reachable) {
      return const core.Result<core.Entitlements>.err(
        core.Failure('conformance: the server is unreachable'),
      );
    }
    final bool pro = proFromRead != null && reads >= proFromRead!;
    return core.Result<core.Entitlements>.ok(
      core.Entitlements(
        appId: appId,
        isPro: pro,
        items: const <core.Entitlement>[],
      ),
    );
  }
}

class _MemoryStore implements core.SecureStore {
  final Map<String, String> _data = <String, String>{};

  @override
  Future<void> delete(String key) async => _data.remove(key);

  @override
  Future<void> deleteAll() async => _data.clear();

  @override
  Future<String?> read(String key) async => _data[key];

  @override
  Future<void> write(String key, String value) async => _data[key] = value;
}

Future<ConvergenceResult> _converge(_ScriptedServer server) =>
    EntitlementConvergence(
      transport: server,
      cache: core.EntitlementCache(store: _MemoryStore()),
      sleep: (Duration _) async {},
    ).awaitUnlock(
      appId: ConformancePlans.appId,
      accessToken: () async => 'conformance-token',
    );

// ── PurchaseRail ─────────────────────────────────────────────────────────────

/// Run the [PurchaseRail] conformance suite for [adapter] — a `group` of one
/// test per [PurchaseRailScenario]. Throws [ConformanceFixtureMissing] when
/// [fixtures] does not cover every scenario.
void runPurchaseRailConformance(
  String adapter,
  Map<PurchaseRailScenario, PurchaseRailFixture> fixtures,
) {
  final List<String> missing = <String>[
    for (final PurchaseRailScenario s in PurchaseRailScenario.values)
      if (!fixtures.containsKey(s)) s.label,
  ];
  if (missing.isNotEmpty) throw ConformanceFixtureMissing(adapter, missing);

  Future<PurchaseRail> arranged(PurchaseRailScenario s) async {
    final PurchaseRail rail = await fixtures[s]!();
    // Every rail is asked for its offerings the way a paywall asks: a store
    // rail's list arrives only once the store answered.
    await refreshOfferingsOf(rail);
    return rail;
  }

  group('PurchaseRail conformance · $adapter', () {
    test(PurchaseRailScenario.loadOfferings.label, () async {
      final PurchaseRail rail = await arranged(
        PurchaseRailScenario.loadOfferings,
      );
      final Map<String, Offering> byId = <String, Offering>{
        for (final Offering o in rail.offerings) o.productId: o,
      };
      for (final Offering want in <Offering>[
        ConformancePlans.monthly,
        ConformancePlans.yearly,
      ]) {
        expect(
          byId.keys,
          contains(want.productId),
          reason:
              '$adapter must offer ${want.productId} once its source '
              'has answered',
        );
        expect(
          byId[want.productId]!.term,
          want.term,
          reason: 'a plan is billed per the term its source states',
        );
        expect(byId[want.productId]!.amountMinor, greaterThan(0));
      }
      expect(
        rail.canStartCheckout,
        isTrue,
        reason: 'a rail that offers plans must be able to start a checkout',
      );
      expect(
        rail.railKind,
        isNot(PurchaseRailKind.none),
        reason: 'a rail that sells nothing has no conformance to pass',
      );
    });

    test(PurchaseRailScenario.purchaseSuccess.label, () async {
      final PurchaseRail rail = await arranged(
        PurchaseRailScenario.purchaseSuccess,
      );
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.monthly,
      );
      if (rail.railKind.isStoreBilling) {
        expect(
          start,
          isA<CheckoutSubmitted>(),
          reason: 'a completed store sheet is CheckoutSubmitted',
        );
        expect(
          (start as CheckoutSubmitted).offering.productId,
          ConformancePlans.monthly.productId,
        );
      } else {
        expect(
          start,
          isA<CheckoutOpened>(),
          reason: 'a hosted rail hands the page over: CheckoutOpened',
        );
        final CheckoutOpened opened = start as CheckoutOpened;
        expect(opened.offering.productId, ConformancePlans.monthly.productId);
        expect(
          opened.url.scheme,
          'https',
          reason: 'a payment page opens over https or not at all',
        );
      }
      // The unlock is the server's, and only the server's.
      final ConvergenceResult r = await _converge(
        _ScriptedServer(proFromRead: 2),
      );
      expect(r.outcome, ConvergenceOutcome.unlocked);
    });

    test(PurchaseRailScenario.userCancel.label, () async {
      final PurchaseRail rail = await arranged(PurchaseRailScenario.userCancel);
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.monthly,
      );
      expect(
        start,
        isNot(isA<CheckoutSubmitted>()),
        reason: 'a user cancel is never a completed purchase',
      );
      if (rail.railKind.isStoreBilling) {
        expect(start, isA<CheckoutRefused>());
        final CheckoutRefused refused = start as CheckoutRefused;
        expect(
          refused.reason,
          CheckoutRefusal.purchaseCancelled,
          reason: 'a dismissed store sheet is a cancel, not a failure',
        );
        expect(refusalRouteOf(refused.reason), RefusalRoute.backToChoosing);
      } else {
        // The buyer cancels ON the hosted page, which the rail cannot see: the
        // page opened, and the server never sees a payment.
        expect(
          start,
          isA<CheckoutOpened>(),
          reason:
              'a hosted rail cannot see a cancel on the page; it must '
              'not invent a refusal for it',
        );
      }
      final ConvergenceResult r = await _converge(_ScriptedServer());
      expect(
        r.outcome,
        ConvergenceOutcome.stillPending,
        reason: 'nothing unlocks after a cancel',
      );
    });

    test(PurchaseRailScenario.pending.label, () async {
      final PurchaseRail rail = await arranged(PurchaseRailScenario.pending);
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.monthly,
      );
      expect(
        start,
        anyOf(isA<CheckoutOpened>(), isA<CheckoutSubmitted>()),
        reason:
            'a payment that settles later was handed over: it is '
            'PENDING, never a refusal the buyer is told is final',
      );
      final _ScriptedServer server = _ScriptedServer();
      final ConvergenceResult r = await _converge(server);
      expect(r.outcome, ConvergenceOutcome.stillPending);
      expect(
        r.attempts,
        kCheckoutConvergenceDelays.length + 1,
        reason: 'pending waits the whole bounded plan, and no longer',
      );
      expect(server.reads, r.attempts);
    });

    test(PurchaseRailScenario.failure.label, () async {
      final PurchaseRail rail = await arranged(PurchaseRailScenario.failure);
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.monthly,
      );
      expect(
        start,
        isA<CheckoutRefused>(),
        reason: 'a checkout that could not start is a stated refusal',
      );
      final CheckoutRefused refused = start as CheckoutRefused;
      expect(
        refusalRouteOf(refused.reason),
        anyOf(RefusalRoute.retry, RefusalRoute.unavailable),
        reason: 'a failure is neither a cancel nor a sign-in',
      );
    });

    test(PurchaseRailScenario.restore.label, () async {
      final PurchaseRail rail = await arranged(PurchaseRailScenario.restore);
      final RestoreOutcome outcome = await restorePurchasesOf(rail);
      expect(
        outcome,
        rail.railKind.isStoreBilling
            ? RestoreOutcome.askedStore
            : RestoreOutcome.serverOnly,
        reason:
            'a store rail asks its store; any other rail restores by the '
            'server read alone',
      );
    });

    test(PurchaseRailScenario.entitlementConvergence.label, () async {
      final PurchaseRail rail = await arranged(
        PurchaseRailScenario.entitlementConvergence,
      );
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.monthly,
      );
      expect(start, anyOf(isA<CheckoutOpened>(), isA<CheckoutSubmitted>()));
      final ConvergenceResult unlocked = await _converge(
        _ScriptedServer(proFromRead: 3),
      );
      expect(unlocked.outcome, ConvergenceOutcome.unlocked);
      expect(unlocked.attempts, 3);
      final ConvergenceResult pending = await _converge(_ScriptedServer());
      expect(pending.outcome, ConvergenceOutcome.stillPending);
      final ConvergenceResult unknown = await _converge(
        _ScriptedServer(reachable: false),
      );
      expect(
        unknown.outcome,
        ConvergenceOutcome.couldNotAsk,
        reason: 'never asked successfully is "we do not know", not "no"',
      );
    });

    test(PurchaseRailScenario.noLifetimeInApp.label, () async {
      final PurchaseRail rail = await arranged(
        PurchaseRailScenario.noLifetimeInApp,
      );
      final CheckoutStart start = await rail.startCheckout(
        ConformancePlans.lifetime,
      );
      if (rail.railKind.isStoreBilling) {
        expect(
          rail.offerings.where((Offering o) => o.term == OfferingTerm.oneTime),
          isEmpty,
          reason: 'ADR 093 §11.2: no lifetime plan is offered in-app',
        );
        expect(
          start,
          isA<CheckoutRefused>(),
          reason:
              'a lifetime plan asked for by id is refused before any '
              'store sheet opens',
        );
      } else {
        expect(
          start,
          isNot(isA<CheckoutSubmitted>()),
          reason: 'a lifetime plan is never a store sheet',
        );
      }
    });
  });
}

// ── IapBridge ────────────────────────────────────────────────────────────────

/// Run the [IapBridge] conformance suite for [adapter] — a `group` of one test
/// per [IapBridgeScenario]. Throws [ConformanceFixtureMissing] when [fixtures]
/// does not cover every scenario. Each bridge is configured with
/// [ConformancePlans.bridgeConfig] before it is asked anything.
void runIapBridgeConformance(
  String adapter,
  Map<IapBridgeScenario, IapBridgeFixture> fixtures,
) {
  final List<String> missing = <String>[
    for (final IapBridgeScenario s in IapBridgeScenario.values)
      if (!fixtures.containsKey(s)) s.label,
  ];
  if (missing.isNotEmpty) throw ConformanceFixtureMissing(adapter, missing);

  Future<IapBridge> configured(IapBridgeScenario s) async {
    final IapBridge bridge = await fixtures[s]!();
    expect(
      await bridge.configure(ConformancePlans.bridgeConfig),
      isTrue,
      reason: 'the fixture arranges a store that can be configured',
    );
    return bridge;
  }

  group('IapBridge conformance · $adapter', () {
    test(IapBridgeScenario.loadOfferings.label, () async {
      final IapBridge bridge = await configured(
        IapBridgeScenario.loadOfferings,
      );
      final Map<String, StorePlan> byId = <String, StorePlan>{
        for (final StorePlan p in await bridge.storePlans()) p.productId: p,
      };
      for (final Offering want in <Offering>[
        ConformancePlans.monthly,
        ConformancePlans.yearly,
      ]) {
        final StorePlan? got = byId[want.productId];
        expect(got, isNotNull, reason: 'the store describes ${want.productId}');
        expect(got!.term, want.term);
        expect(got.amountMinor, greaterThan(0));
        expect(got.currencyCode, hasLength(3));
      }
    });

    test(IapBridgeScenario.purchaseSuccess.label, () async {
      final IapBridge bridge = await configured(
        IapBridgeScenario.purchaseSuccess,
      );
      final IapPurchaseResult r = await bridge.purchase(
        ConformancePlans.monthly,
      );
      expect(r.outcome, IapPurchaseOutcome.submitted);
    });

    test(IapBridgeScenario.userCancel.label, () async {
      final IapBridge bridge = await configured(IapBridgeScenario.userCancel);
      final IapPurchaseResult r = await bridge.purchase(
        ConformancePlans.monthly,
      );
      expect(
        r.outcome,
        IapPurchaseOutcome.cancelledByUser,
        reason:
            'a dismissed sheet is a cancel — never submitted, never a '
            'failure',
      );
    });

    test(IapBridgeScenario.pending.label, () async {
      final IapBridge bridge = await configured(IapBridgeScenario.pending);
      final IapPurchaseResult r = await bridge.purchase(
        ConformancePlans.monthly,
      );
      expect(
        r.outcome,
        IapPurchaseOutcome.submitted,
        reason:
            'a payment the store settles later is WITH the store: the '
            'unlock waits on the server, and the buyer must not be told the '
            'purchase was refused',
      );
    });

    test(IapBridgeScenario.failure.label, () async {
      final IapBridge bridge = await configured(IapBridgeScenario.failure);
      final IapPurchaseResult r = await bridge.purchase(
        ConformancePlans.monthly,
      );
      expect(
        r.outcome,
        anyOf(IapPurchaseOutcome.storeRefused, IapPurchaseOutcome.unavailable),
      );
    });

    test(IapBridgeScenario.restore.label, () async {
      final IapBridge bridge = await configured(IapBridgeScenario.restore);
      final IapPurchaseResult r = await bridge.restore();
      expect(
        r.outcome,
        IapPurchaseOutcome.submitted,
        reason: 'a store that answered a restore says so',
      );
    });

    test(IapBridgeScenario.entitlementConvergence.label, () async {
      final IapBridge bridge = await configured(
        IapBridgeScenario.entitlementConvergence,
      );
      expect(
        (await bridge.purchase(ConformancePlans.monthly)).outcome,
        IapPurchaseOutcome.submitted,
      );
      final IapCustomerState belief = await bridge.currentCustomerState();
      expect(
        belief.holds(ConformancePlans.bridgeConfig.entitlementId),
        isTrue,
        reason: 'the fixture arranges a store that CLAIMS the entitlement',
      );
      // The store's claim changes nothing: the unlock is the server's read.
      expect(
        (await _converge(_ScriptedServer())).outcome,
        ConvergenceOutcome.stillPending,
      );
      expect(
        (await _converge(_ScriptedServer(proFromRead: 1))).outcome,
        ConvergenceOutcome.unlocked,
      );
      expect(
        (await _converge(_ScriptedServer(reachable: false))).outcome,
        ConvergenceOutcome.couldNotAsk,
      );
    });

    test(IapBridgeScenario.noLifetimeInApp.label, () async {
      final IapBridge bridge = await configured(
        IapBridgeScenario.noLifetimeInApp,
      );
      final List<StorePlan> plans = await bridge.storePlans();
      expect(
        plans.map((StorePlan p) => p.productId),
        contains(ConformancePlans.lifetime.productId),
        reason:
            'the fixture arranges a store that DESCRIBES the lifetime '
            'product, so the rule below is tested against it',
      );
      expect(
        offeringsFromStore(
          ConformancePlans.config,
          plans,
        ).where((Offering o) => o.term == OfferingTerm.oneTime),
        isEmpty,
        reason: 'ADR 093 §11.2: no lifetime plan is offered in-app',
      );
    });
  });
}
