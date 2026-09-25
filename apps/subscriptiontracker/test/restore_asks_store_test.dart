// 🔴 O-STORE-RESTORE-ASKS-ONLY-THE-SERVER, PROVEN ON THE REAL SCREEN.
//
// The Restore control on the manage-plan screen re-read our own server and
// never asked the store, so on a store build Apple guideline 3.1.1's control
// was a refresh button: a StoreKit or Play purchase our server had not heard
// about had nothing to bring it back. `_restore` now calls
// `restorePurchasesOf(rail)` and only THEN re-reads the entitlement; when the
// store was asked and the server does not show the plan yet, it waits through
// the paywall's own bounded convergence (`EntitlementConvergence.awaitUnlock`)
// for the webhook to land.
//
// Built on `iap_opt_in_test.dart`'s harness: the app's own `purchaseRailFor`,
// driven with the channel a lane stamps, a dummy key and a FAKE bridge, so no
// store SDK and no platform channel is touched. The screen is the real
// `ManagePlanScreen`; the entitlement read is a counting fake transport, so
// "the server was asked" is an observation, not an inference. The convergence
// is the app's own class with its own delays; only its `sleep` is replaced, so
// the waits are recorded instead of slept.
//
// What this proves, one case each, written out by hand:
//   R1 · android-play: one tap asks the store ONCE, then the server, waits
//        through the bounded convergence and no longer, and says nothing was
//        found when the server never shows a plan.
//   R2 · ios-appstore: the same store call on the Apple channel.
//   R3 · web: no store bridge exists, the store is never asked, the server
//        read alone is made and nothing is waited for.
//   R4 · a store that cannot be reached: the could-not-reach sentence, the
//        server read still made, nothing waited for, and the store's own
//        `detail` never shown.
//   R9 · the store is asked and the plan lands on the server during the wait:
//        the wait stops at that read and the screen says the plan was found.
//
// R5, the red control, recorded in the PR: the BASE
// `manage_plan_screen.dart` copied over this one turns R1 red on
// `restoreCalls == 0`; restored byte-exact, R1 is green again.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/features/monetization/manage_plan_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Every call that crossed a seam, in order: `store:restore` from the bridge,
/// `server:fetch` from the entitlement read. The ORDER is what R1 asserts.
class _Log {
  final List<String> calls = <String>[];
}

/// `iap_opt_in_test.dart`'s fake bridge, plus a restore that is counted and
/// logged. Answers like a store that is reachable and sells the one plan the
/// config sells.
class _FakeBridge implements IapBridge {
  _FakeBridge(this.log, this.restoreAnswer);

  final _Log log;
  final IapPurchaseResult restoreAnswer;
  int restoreCalls = 0;

  @override
  Future<bool> configure(IapBridgeConfig config) async => true;

  @override
  Future<bool> identify(String appUserId) async => true;

  @override
  Future<bool> logOut() async => true;

  @override
  Future<List<StorePlan>> storePlans() async {
    return const <StorePlan>[
      StorePlan(
        productId: 'pro_monthly',
        amountMinor: 599,
        currencyCode: 'USD',
        term: OfferingTerm.month,
      ),
    ];
  }

  @override
  Future<IapPurchaseResult> purchase(Offering offering) async =>
      const IapPurchaseResult(IapPurchaseOutcome.submitted);

  @override
  Future<IapPurchaseResult> restore() async {
    restoreCalls++;
    log.calls.add('store:restore');
    return restoreAnswer;
  }

  @override
  Future<IapCustomerState> currentCustomerState() async =>
      IapCustomerState.unknown;

  @override
  Stream<IapCustomerState> get customerState =>
      const Stream<IapCustomerState>.empty();
}

/// The Pro answer R9's server gives once the webhook has "landed".
const core.Entitlements _pro = core.Entitlements(
  appId: AppConfig.appId,
  isPro: true,
  items: <core.Entitlement>[],
);

/// The server's entitlement read, counted. Answers "not Pro" until
/// [proFromFetch] is set and reached: R1-R4 need only that the server was
/// ASKED, and R9 needs the plan to appear part-way through the wait.
class _CountingServer implements core.EntitlementTransport {
  _CountingServer(this.log);

  final _Log log;
  int fetches = 0;

  /// The fetch number (counted from the first, 1-based) from which the server
  /// answers Pro. Null: it never does.
  int? proFromFetch;

  @override
  Future<core.Result<core.Entitlements>> fetch({
    required String appId,
    required String? accessToken,
  }) async {
    fetches++;
    log.calls.add('server:fetch');
    final int? from = proFromFetch;
    if (from != null && fetches >= from) {
      return const core.Result<core.Entitlements>.ok(_pro);
    }
    return const core.Result<core.Entitlements>.ok(core.Entitlements.none);
  }
}

/// A config that sells one plan — `iap_opt_in_test.dart`'s, unchanged.
final core.AppConfig _selling = core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: AppConfig.apiBaseUrl,
  features: const <String, bool>{},
  paywall: const core.PaywallConfig(
    enabled: true,
    extra: <String, Object?>{
      'offerings': <Object?>[
        <String, Object?>{
          'product_id': 'pro_monthly',
          'amount_minor': 499,
          'currency_code': 'USD',
          'term': 'month',
          'trial_days': 0,
        },
      ],
      'checkout_url_template': 'https://checkout.example.test/{price_id}',
    },
  ),
  contentPack: null,
  copy: const <String, String>{},
  minSupportedVersion: '1.0.0',
);

const core.AuthUser _signedIn = core.AuthUser(
  id: 'user-under-test',
  email: 'buyer@example.test',
);

const IapPurchaseResult _storeAnswered = IapPurchaseResult(
  IapPurchaseOutcome.submitted,
);

/// What one case needs to look at after the tap.
class _Harness {
  _Harness(this.log, this.built, this.server, this.slept);

  final _Log log;
  final List<_FakeBridge> built;
  final _CountingServer server;

  /// Every wait the convergence asked for, in order — recorded, never slept.
  final List<Duration> slept;
}

/// The real `ManagePlanScreen` on [channel], over the app's own
/// `purchaseRailFor` with a dummy key and a fake bridge — the rail is built
/// once config and sign-in have settled, the order a real launch reaches.
Future<_Harness> _pumpManagePlan(
  WidgetTester tester,
  String channel, {
  IapPurchaseResult restoreAnswer = _storeAnswered,
}) async {
  final _Log log = _Log();
  final List<_FakeBridge> built = <_FakeBridge>[];
  final _CountingServer server = _CountingServer(log);
  final List<Duration> slept = <Duration>[];
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      appConfigProvider.overrideWith((_) async => _selling),
      authUserProvider.overrideWith(
        (_) => Stream<core.AuthUser?>.value(_signedIn),
      ),
      entitlementTransportProvider.overrideWithValue(server),
      // The app's convergence, its default delays kept. A real sleep inside a
      // widget test hangs or lies, so each wait is written down instead.
      entitlementConvergenceProvider.overrideWith(
        (ref) => EntitlementConvergence(
          transport: ref.watch(entitlementTransportProvider),
          cache: ref.watch(entitlementCacheProvider),
          sleep: (Duration d) async => slept.add(d),
        ),
      ),
      purchaseRailProvider.overrideWith(
        (ref) => purchaseRailFor(
          ref,
          channel,
          revenueCatKey: 'dummy-public-sdk-key',
          newBridge: () {
            final _FakeBridge b = _FakeBridge(log, restoreAnswer);
            built.add(b);
            return b;
          },
        ),
      ),
    ],
  );
  addTearDown(c.dispose);
  await c.read(appConfigProvider.future);
  await c.read(authUserProvider.future);
  c.read(purchaseRailProvider);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const ManagePlanScreen(),
      ),
    ),
  );
  // The harness's loop, for the harness's reason: several provider futures
  // resolve in sequence, and `pumpAndSettle` would spin on the progress bar.
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return _Harness(log, built, server, slept);
}

AppLocalizations _l10n(WidgetTester tester) =>
    AppLocalizations.of(tester.element(find.byType(ManagePlanScreen)));

/// Taps Restore and lets the store call, the re-read and any wait run to the
/// end. Answers the calls made BY THE TAP — the screen's first entitlement
/// read, made when it was built, is not part of the restore.
Future<List<String>> _tapRestore(WidgetTester tester, _Harness h) async {
  final int before = h.log.calls.length;
  await tester.tap(find.text(_l10n(tester).restorePurchases));
  for (int i = 0; i < 24; i++) {
    await tester.pump();
  }
  return h.log.calls.sublist(before);
}

/// The server reads one tap made.
int _fetchesIn(List<String> byTap) =>
    byTap.where((String call) => call == 'server:fetch').length;

void main() {
  testWidgets(
    'R1 · android-play: Restore asks the store, then the server, and waits '
    'no longer than the bounded convergence',
    (WidgetTester tester) async {
      final _Harness h = await _pumpManagePlan(tester, 'android-play');
      final List<String> byTap = await _tapRestore(tester, h);

      expect(h.built, hasLength(1));
      expect(
        h.built.single.restoreCalls,
        1,
        reason:
            'restoreCalls == 0 is the BASE screen: the Restore control re-read '
            'our own server and never asked the store.',
      );
      expect(byTap.first, 'store:restore');
      expect(
        byTap.skip(1),
        contains('server:fetch'),
        reason: 'the entitlement is re-read AFTER the store was asked',
      );
      expect(
        h.slept,
        kCheckoutConvergenceDelays,
        reason: 'the wait is the paywall convergence, with its own delays',
      );
      expect(
        _fetchesIn(byTap),
        1 + kCheckoutConvergenceDelays.length + 1,
        reason:
            'one re-read, then one read per convergence attempt, and the wait '
            'ends there when the server never shows a plan',
      );
      expect(find.text(_l10n(tester).restoreNothingFound), findsOneWidget);
    },
  );

  testWidgets('R2 · ios-appstore: Restore asks the store once', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pumpManagePlan(tester, 'ios-appstore');
    final List<String> byTap = await _tapRestore(tester, h);

    expect(h.built, hasLength(1));
    expect(h.built.single.restoreCalls, 1);
    expect(byTap.first, 'store:restore');
    expect(byTap.skip(1), contains('server:fetch'));
    expect(h.slept, kCheckoutConvergenceDelays);
    expect(find.text(_l10n(tester).restoreNothingFound), findsOneWidget);
  });

  testWidgets('R3 · web: the server read alone, no store asked, no wait', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pumpManagePlan(tester, 'web');
    final List<String> byTap = await _tapRestore(tester, h);

    expect(
      h.built,
      isEmpty,
      reason: 'web sells through the hosted rail; no bridge exists to ask',
    );
    expect(byTap, isNot(contains('store:restore')));
    expect(
      _fetchesIn(byTap),
      1,
      reason: 'with no store asked there is nothing to wait for',
    );
    expect(h.slept, isEmpty);
    expect(find.text(_l10n(tester).restoreNothingFound), findsOneWidget);
  });

  testWidgets('R4 · store unreachable: the could-not-reach sentence', (
    WidgetTester tester,
  ) async {
    final _Harness h = await _pumpManagePlan(
      tester,
      'android-play',
      restoreAnswer: const IapPurchaseResult(
        IapPurchaseOutcome.unavailable,
        detail: 'store detail that must never reach a screen',
      ),
    );
    final List<String> byTap = await _tapRestore(tester, h);

    expect(h.built.single.restoreCalls, 1);
    expect(byTap.skip(1), contains('server:fetch'));
    expect(
      _fetchesIn(byTap),
      1,
      reason: 'a store that was never reached handed the server nothing',
    );
    expect(h.slept, isEmpty);
    expect(find.text(_l10n(tester).restoreCouldNotReachStore), findsOneWidget);
    expect(
      find.textContaining('store detail that must never reach a screen'),
      findsNothing,
      reason: 'a refusal detail is untranslated engineering text',
    );
  });

  testWidgets(
    'R9 · the plan lands during the wait: the wait stops, the plan is found',
    (WidgetTester tester) async {
      final _Harness h = await _pumpManagePlan(tester, 'android-play');
      // The re-read and the first convergence read still see no plan; the
      // second convergence read sees it.
      h.server.proFromFetch = h.server.fetches + 3;
      final List<String> byTap = await _tapRestore(tester, h);

      expect(h.built.single.restoreCalls, 1);
      expect(byTap.first, 'store:restore');
      expect(h.slept, <Duration>[
        kCheckoutConvergenceDelays.first,
      ], reason: 'the wait stops at the read that shows the plan');
      expect(
        _fetchesIn(byTap),
        4,
        reason:
            'the re-read, two convergence reads, and the read that puts the '
            'plan on screen',
      );
      expect(find.text(_l10n(tester).restoreFoundPlan), findsOneWidget);
      expect(find.text(_l10n(tester).restoreNothingFound), findsNothing);
    },
  );
}
