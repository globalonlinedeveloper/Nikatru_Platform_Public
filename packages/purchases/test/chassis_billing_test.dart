import 'dart:convert';
import 'dart:io';

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

/// The platform host's `POST /v1/checkout`, answered from the test: it opens a
/// checkout for whatever it is asked and records the offering.
class _FakeSessions implements core.CheckoutSessionTransport {
  final List<String> asked = <String>[];

  @override
  bool get isAvailable => true;

  @override
  Future<core.Result<core.CheckoutSession>> createSession({
    required String appId,
    required String offeringId,
    required String? accessToken,
  }) async {
    asked.add(offeringId);
    return core.Result<core.CheckoutSession>.ok(
      core.CheckoutSession(
        checkoutUrl: Uri.parse('https://pay.example.test/?_ptxn=txn_1'),
        transactionId: 'txn_1',
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

const String _template =
    'https://checkout.example.test/pay?price={price_id}&cust={account_id}'
    '&app={app_id}&back={return_url}';

ChassisBillingConfig _config({
  IapBridge? bridge,
  IapBridgeConfig? bridgeConfig,
  CheckoutLauncher? launcher,
  core.CancellationTransport? cancellations,
  core.CheckoutSessionTransport? sessions,
  RailConfig railConfig = const RailConfig(
    offerings: <Offering>[_monthly],
    checkoutUrlTemplate: _template,
    manageUrlTemplate: null,
  ),
}) =>
    ChassisBillingConfig(
      railConfig: railConfig,
      checkoutSessions: sessions ?? _FakeSessions(),
      appId: 'probe',
      returnUrl: 'https://nikatru.test/checkout-return',
      accountId: () async => 'user-123',
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
      iapBridge: bridge,
      iapBridgeConfig: bridgeConfig,
      launcher: launcher ?? FakeCheckoutLauncher(),
    );

const IapBridgeConfig _bridgeConfig = IapBridgeConfig(
  publicApiKey: 'public_test_key',
  entitlementId: 'pro',
  appUserId: 'user-123',
);

void main() {
  // ── THE FACADE PICKS THE RAIL THE REGISTER DECIDES ────────────────────────
  // Every channel, both directions, because the failure this whole facade
  // exists to prevent is a build opening the WRONG rail: an external checkout
  // inside an App Store build is a documented rejection cause, and a store
  // sheet on a channel that forbids store billing is a paywall that cannot
  // complete a sale.
  group('ChassisBilling.railFor selects by channel, not by platform', () {
    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.web,
      PurchaseChannel.windowsStore,
      PurchaseChannel.windowsDirect,
      PurchaseChannel.linuxSnap,
      PurchaseChannel.linuxAppImage,
    ]) {
      test('${channel.registerId} gets the hosted checkout rail', () {
        final BillingRailResult r =
            ChassisBilling.railFor(channel, _config(bridge: FakeIapBridge()));
        expect(r, isA<BillingRailReady>());
        final BillingRailReady ready = r as BillingRailReady;
        expect(ready.kind, PurchaseRailKind.hosted);
        expect(ready.rail, isA<HostedCheckoutRail>());
      });
    }

    for (final PurchaseChannel channel in <PurchaseChannel>[
      PurchaseChannel.androidPlay,
      PurchaseChannel.iosAppStore,
      PurchaseChannel.macosAppStore,
    ]) {
      test('${channel.registerId} gets the store IAP rail', () {
        final BillingRailResult r = ChassisBilling.railFor(
          channel,
          _config(bridge: FakeIapBridge(), bridgeConfig: _bridgeConfig),
        );
        expect(r, isA<BillingRailReady>());
        final BillingRailReady ready = r as BillingRailReady;
        expect(ready.kind.isStoreBilling, isTrue);
        expect(ready.rail, isA<IapRail>());
      });
    }

    test('a store channel with no bridge REFUSES rather than falling back',
        () async {
      // 🔴 THE FALLBACK IS THE BUG. Handing back a HostedCheckoutRail here
      // would put an external checkout inside a Play or App Store build, which
      // is the anti-steering violation and the 3.1.1 rejection respectively.
      // Refusing is the only safe answer, and it has to be a VALUE the paywall
      // can render rather than an exception it has to catch.
      final BillingRailResult r = ChassisBilling.railFor(
        PurchaseChannel.androidPlay,
        _config(),
      );
      expect(r, isA<BillingRailUnavailable>());
      expect(
        (r as BillingRailUnavailable).reason,
        BillingRailRefusal.iapBridgeMissing,
      );
      expect(r.detail, contains('nikatru_billing_revenuecat'));
    });

    test('the hosted rail is built with the CHANNEL capabilities, not the '
        'restrictive platform collapse', () async {
      // `forPlatform` takes the restrictive answer because a build that
      // constructs the rail directly does not know its channel. The facade DOES
      // know — the caller just said — so it must pass `forChannel`, or a
      // windows-direct build would inherit windows-store's answer for no reason.
      final BillingRailReady ready = ChassisBilling.railFor(
        PurchaseChannel.windowsDirect,
        _config(bridge: FakeIapBridge()),
      ) as BillingRailReady;
      final HostedCheckoutRail rail = ready.rail as HostedCheckoutRail;
      expect(rail.capabilities.why,
          PurchaseCapabilities.forChannel(PurchaseChannel.windowsDirect).why);
    });
  });

  // ── R10 · THE CHANNEL A BUILD DECLARES, AS TEXT ───────────────────────────
  // The app hands in its compile-time RELEASE_CHANNEL. An undeclared one — the
  // `'dev'` default — is NOT guessed: a build that does not know its channel
  // does not know its rail, so it sells nothing (architecture decision
  // 2026-09-19; every release lane passes the define).
  group('ChassisBilling.railForDeclared', () {
    test('every registered channel id resolves to its channel', () {
      for (final PurchaseChannel c in PurchaseChannel.values) {
        expect(ChassisBilling.channelNamed(c.registerId), c);
      }
    });

    for (final String undeclared in <String>['dev', '', 'webb', 'WEB']) {
      test('"$undeclared" sells nothing, and says why', () async {
        final BillingRailResult r =
            ChassisBilling.railForDeclared(undeclared, _config());
        expect(r, isA<BillingRailUnavailable>());
        expect(
          (r as BillingRailUnavailable).reason,
          BillingRailRefusal.channelUndeclared,
        );
        expect(r.detail, contains('RELEASE_CHANNEL'));

        final PurchaseRail rail = r.orUnavailableRail(_config());
        expect(rail, isA<UnavailablePurchaseRail>());
        expect(rail.canStartCheckout, isFalse);
        final CheckoutStart start = await rail.startCheckout(_monthly);
        expect(
          (start as CheckoutRefused).reason,
          CheckoutRefusal.channelNotPermitted,
        );
      });
    }

    // ⏱ 2026-10-01 · O-ST-HOSTED-CHECKOUT-CANNOT-START (MO-01) — THE RED
    // CONTROL. The served `paywall` block carries offerings and NO
    // `checkout_url_template` (no config serves one), and the hosted rail used
    // to require that template, so on every hosted channel a served
    // `enabled: true` still sold nothing. Built from the served SHAPE, through
    // the real facade, per hosted channel.
    group('a served paywall config sells on every hosted channel', () {
      final RailConfig served = RailConfig.fromPaywallExtra(<String, Object?>{
        'offerings': <Object?>[
          <String, Object?>{
            'product_id': 'pro_monthly',
            'amount_minor': 599,
            'currency_code': 'USD',
            'term': 'month',
            'trial_days': 30,
          },
          <String, Object?>{
            'product_id': 'pro_yearly',
            'amount_minor': 3499,
            'currency_code': 'USD',
            'term': 'year',
            'trial_days': 30,
          },
          <String, Object?>{
            'product_id': 'pro_lifetime',
            'amount_minor': 8900,
            'currency_code': 'USD',
            'term': 'one_time',
            'trial_days': 0,
          },
        ],
        'pro_features': <Object?>['forecast', 'caps'],
      });

      test('the served config has no template — the precondition', () {
        expect(served.checkoutUrlTemplate, isNull);
      });

      // MO-02 (ADR 093 §11.2): the lifetime plan is served for the web apex
      // page and never reaches an in-app rail.
      test('a served one-time plan never reaches the rail', () {
        expect(
          served.offerings.map((Offering o) => o.productId),
          <String>['pro_monthly', 'pro_yearly'],
        );
        expect(
          served.offerings.where((Offering o) => o.term == OfferingTerm.oneTime),
          isEmpty,
        );
      });

      for (final String channel in <String>[
        'web',
        'windows-store',
        'windows-direct',
        'linux-snap',
        'linux-appimage',
      ]) {
        test('$channel: canStartCheckout, and the checkout OPENS', () async {
          final _FakeSessions sessions = _FakeSessions();
          final FakeCheckoutLauncher launcher = FakeCheckoutLauncher();
          final ChassisBillingConfig config = _config(
            railConfig: served,
            sessions: sessions,
            launcher: launcher,
          );
          final PurchaseRail rail = ChassisBilling.railForDeclared(
            channel,
            config,
          ).orUnavailableRail(config);
          expect(rail.canStartCheckout, isTrue, reason: channel);
          expect(
            await rail.startCheckout(served.offerings.first),
            isA<CheckoutOpened>(),
          );
          expect(sessions.asked, <String>['pro_monthly']);
          expect(launcher.opened.single.queryParameters['_ptxn'], 'txn_1');
        });
      }

      test('a build with no platform host sells nothing, and says so', () {
        final ChassisBillingConfig config = _config(
          railConfig: served,
          sessions: const core.UnavailableCheckoutSessionTransport(),
        );
        expect(
          ChassisBilling.railForDeclared('web', config)
              .orUnavailableRail(config)
              .canStartCheckout,
          isFalse,
        );
      });
    });

    test('a declared paddle channel gets the hosted rail, unchanged', () {
      final PurchaseRail rail = ChassisBilling.railForDeclared(
        'windows-store',
        _config(),
      ).orUnavailableRail(_config());
      expect(rail, isA<HostedCheckoutRail>());
      expect(rail.canStartCheckout, isTrue);
    });

    test('a store channel with no bridge is a rail that sells nothing — and '
        'still CANCELS', () async {
      // ROSCA does not depend on this build's rail: a web subscriber opening
      // the Play build must still be able to cancel ([pipeline 5]M-9).
      final _FakeCancellations cancellations = _FakeCancellations(
        const core.Result<core.CancellationReceipt>.ok(
          core.CancellationReceipt(
            hasActivePlan: true,
            recorded: true,
            executed: false,
          ),
        ),
      );
      final ChassisBillingConfig config =
          _config(cancellations: cancellations);
      final PurchaseRail rail = ChassisBilling.railForDeclared(
        'android-play',
        config,
      ).orUnavailableRail(config);
      expect(rail, isA<UnavailablePurchaseRail>());
      expect(
        (rail as UnavailablePurchaseRail).refusal.reason,
        BillingRailRefusal.iapBridgeMissing,
      );
      expect(rail.canStartCheckout, isFalse);
      // 🔴 iapBridgeMissing → NO OFFERINGS. The config's book is the WEB
      // price; a store build with no key has no store to ask, so it describes
      // nothing rather than the web's amounts (O-IAP-BRIDGE-NOT-WIRED-IN-THE-APP:
      // "an unset key gives no offerings").
      expect(rail.offerings, isEmpty);
      expect(
        ((await rail.startCheckout(_monthly)) as CheckoutRefused).reason,
        CheckoutRefusal.railNotConfigured,
      );
      expect(await rail.requestCancellation(), CancellationOutcome.recorded);
      expect(cancellations.calls, 1);
    });

    for (final String store in <String>[
      'android-play',
      'ios-appstore',
      'macos-appstore',
    ]) {
      test('$store, iapBridgeMissing → no offerings, never the config book',
          () {
        final PurchaseRail rail = ChassisBilling.railForDeclared(
          store,
          _config(),
        ).orUnavailableRail(_config());
        expect(
          (rail as UnavailablePurchaseRail).refusal.reason,
          BillingRailRefusal.iapBridgeMissing,
        );
        expect(rail.offerings, isEmpty);
        expect(rail.canStartCheckout, isFalse);
      });
    }

    test('every OTHER refusal keeps the config book (its book is the config)',
        () {
      for (final String channel in <String>['dev', 'apps-gov-in']) {
        final PurchaseRail rail = ChassisBilling.railForDeclared(
          channel,
          _config(),
        ).orUnavailableRail(_config());
        expect(
          (rail as UnavailablePurchaseRail).refusal.reason,
          isNot(BillingRailRefusal.iapBridgeMissing),
        );
        expect(rail.offerings, hasLength(1), reason: channel);
        expect(rail.canStartCheckout, isFalse, reason: channel);
      }
    });

    test('a `rail: none` channel is a rail that sells nothing', () {
      final PurchaseRail rail = ChassisBilling.railForDeclared(
        'apps-gov-in',
        _config(bridge: FakeIapBridge(), bridgeConfig: _bridgeConfig),
      ).orUnavailableRail(_config());
      expect(
        (rail as UnavailablePurchaseRail).refusal.reason,
        BillingRailRefusal.channelSellsNothing,
      );
    });
  });

  // ── THE RAIL KIND MAP IS THE REGISTER'S, NOT AN OPINION ───────────────────
  group('PurchaseRailKind mirrors tooling/channel-register.json', () {
    test('every channel maps to the rail the register decides', () {
      // 🔴 READ FROM THE REGISTER AT TEST TIME. A test that restated the
      // expected pairs would be a THIRD copy of the decision, and the whole
      // point of the guard limb this backs up is that there is one.
      // 🔴 THE PATH IS WALKED, NOT WRITTEN. `flutter test packages/purchases`
      // runs with the REPO ROOT as cwd and `melos run gate` runs with the
      // PACKAGE as cwd, so any single relative path passes under one runner and
      // silently fails under the other — which for this case would mean the
      // register comparison quietly not happening in whichever lane matters.
      Directory d = Directory.current;
      File? f;
      for (int i = 0; i < 6; i++) {
        final File candidate =
            File('${d.path}/tooling/channel-register.json');
        if (candidate.existsSync()) {
          f = candidate;
          break;
        }
        if (d.parent.path == d.path) break;
        d = d.parent;
      }
      expect(f, isNotNull,
          reason: 'tooling/channel-register.json must be findable above cwd');
      final Map<String, Object?> reg =
          jsonDecode(f!.readAsStringSync()) as Map<String, Object?>;
      final List<Object?> channels = reg['channels']! as List<Object?>;
      int compared = 0;
      for (final Object? raw in channels) {
        final Map<String, Object?> row = raw! as Map<String, Object?>;
        if (row['surface'] != 'app') continue;
        final PurchaseChannel channel = PurchaseChannel.values
            .firstWhere((PurchaseChannel c) => c.registerId == row['id']);
        final Map<String, Object?> rail =
            row['purchaseRail']! as Map<String, Object?>;
        final String registerRail = rail['rail']! as String;
        final PurchaseRailKind kind = PurchaseRailKind.forChannel(channel);
        // The client kind IS the register rail for a store rail and for
        // `none`; every other rail is a hosted page, and which vendor serves
        // it is the server's business. So: either the wires are equal, or the
        // client says `hosted` for a rail no client kind names. A register
        // edit not re-rendered (`windows-direct` → `none`) fails here.
        final Set<String> kindWires = <String>{
          for (final PurchaseRailKind k in PurchaseRailKind.values) k.wire,
        };
        if (kind == PurchaseRailKind.hosted) {
          expect(kindWires, isNot(contains(registerRail)),
              reason: 'channel ${row['id']} takes $registerRail, and the '
                  'rendered map says hosted');
        } else {
          expect(kind.wire, registerRail, reason: 'channel ${row['id']}');
        }
        compared++;
      }
      // A comparison over an empty set agrees with everything.
      expect(compared, greaterThanOrEqualTo(6));
    });

    test('an unknown wire is none — a channel the map does not name sells nothing', () {
      expect(PurchaseRailKind.fromWire('paddle'), PurchaseRailKind.none);
      expect(PurchaseRailKind.fromWire(null), PurchaseRailKind.none);
      expect(PurchaseRailKind.fromWire('hosted'), PurchaseRailKind.hosted);
    });

    test('only the two store rails answer isStoreBilling', () {
      expect(PurchaseRailKind.hosted.isStoreBilling, isFalse);
      expect(PurchaseRailKind.none.isStoreBilling, isFalse);
      expect(PurchaseRailKind.playBilling.isStoreBilling, isTrue);
      expect(PurchaseRailKind.appleIap.isStoreBilling, isTrue);
    });
  });

  // ── EVERY RAIL SAYS WHICH RAIL IT IS ──────────────────────────────────────
  // The paywall picks its in-flight sentence from `PurchaseRail.railKind`, so
  // the rail a UI is handed must answer the CHANNEL's kind whichever branch
  // built it — including the rail that sells nothing. A Play build whose key
  // was not compiled in is still a Play build: answering `none` there would
  // hand its paywall the hosted wording the day `none` stops meaning "store".
  group('PurchaseRail.railKind', () {
    for (final bool withBridge in <bool>[true, false]) {
      for (final PurchaseChannel channel in PurchaseChannel.values) {
        test(
            '${channel.registerId} ${withBridge ? 'with' : 'without'} a '
            'bridge answers ${PurchaseRailKind.forChannel(channel).name}', () {
          final ChassisBillingConfig config = withBridge
              ? _config(bridge: FakeIapBridge(), bridgeConfig: _bridgeConfig)
              : _config();
          final PurchaseRail rail =
              ChassisBilling.railFor(channel, config).orUnavailableRail(config);
          expect(rail.railKind, PurchaseRailKind.forChannel(channel));
        });
      }
    }

    test('an undeclared channel answers none', () {
      final PurchaseRail rail = ChassisBilling.railForDeclared('dev', _config())
          .orUnavailableRail(_config());
      expect(rail, isA<UnavailablePurchaseRail>());
      expect(rail.railKind, PurchaseRailKind.none);
    });
  });
}
