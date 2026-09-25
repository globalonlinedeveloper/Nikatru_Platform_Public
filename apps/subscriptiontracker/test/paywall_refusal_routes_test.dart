// 🔴 O-PAYWALL-SPEAKS-ONLY-WEB-CHECKOUT — WHERE EACH REFUSAL SENDS THE BUYER,
// AND WHAT THE PAYWALL SAYS WHILE A CHECKOUT IS IN FLIGHT.
//
// Driven through the REAL `PaywallScreen` and, wherever a real rail can produce
// the refusal, the app's REAL rail wiring: `purchaseRailFor` with the channel a
// store lane stamps, a key and a FAKE store bridge, so no store SDK and no
// platform channel is touched. The store's answer picks the refusal:
//   · cancelledByUser → purchaseCancelled   → back to the plans, nothing said;
//   · storeRefused    → channelNotPermitted → the unavailable sentence + Try again;
//   · unavailable     → couldNotOpen        → the retry sentence + Try again.
// The three refusals no store answer produces (notSignedIn, railNotConfigured,
// platformNotSupported) come from a fake rail. notSignedIn is driven twice, in
// a GoRouter host: with no session it routes to `/sign-in?next=%2Fpaywall`;
// with a session the rail missed, the buyer is identified to the rail ONCE and
// Try again is offered — `/sign-in` bounces a signed-in user to `/home`
// (`lib/core/router/gates.dart:393`), so routing there would lose the paywall.
//
// The in-flight sentence follows the rail kind. The store channels
// (android-play, ios-appstore, macos-appstore) say `paywallOpeningStore` and
// never "browser" or "web"; the hosted channels (windows-store,
// linux-appimage, web) say `paywallOpeningHosted`. Each is read with the
// checkout HELD open — the store bridge's purchase, or url_launcher's
// `canLaunch` — so the opening state is on screen when it is measured.
//
// Red control R2, run and recorded in the PR: the BASE `paywall_screen.dart`
// (60b63fb9) copied over this one, with its deleted `paywallOpening` key
// renamed to `paywallOpeningHosted` so it compiles, sends a cancelled store
// sheet to the refused screen, and "purchaseCancelled: …" goes red.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/core/app_config.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
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

/// A session, or none. Both the screen's sign-in decision and the store rail's
/// attribution read it, through `authRepositoryProvider` and `authUserProvider`.
class _Auth extends core.AuthRepository {
  _Auth(this.user);

  final core.AuthUser? user;

  @override
  core.AuthUser? get currentUser => user;

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const core.AuthUser _buyer = core.AuthUser(
  id: 'user-under-test',
  email: 'buyer@example.test',
);

/// The engineering reason every refusal here carries. It names the web on
/// purpose: the paywall must log it and never paint it.
const String _detail = 'engineering detail: try the web checkout';

/// A store that sells one plan and answers the purchase sheet with [answer] —
/// or, when [held] is set, keeps the sheet open until the test answers.
class _FakeBridge implements IapBridge {
  _FakeBridge(this.answer);

  final IapPurchaseOutcome answer;
  Completer<IapPurchaseResult>? held;
  int purchases = 0;

  @override
  Future<bool> configure(IapBridgeConfig config) async => true;

  @override
  Future<bool> identify(String appUserId) async => true;

  @override
  Future<bool> logOut() async => true;

  @override
  Future<List<StorePlan>> storePlans() async => const <StorePlan>[
    StorePlan(
      productId: 'pro_monthly',
      amountMinor: 599,
      currencyCode: 'USD',
      term: OfferingTerm.month,
    ),
  ];

  @override
  Future<IapPurchaseResult> purchase(Offering offering) {
    purchases++;
    return held?.future ??
        Future<IapPurchaseResult>.value(
          IapPurchaseResult(answer, detail: _detail),
        );
  }

  @override
  Future<IapPurchaseResult> restore() async =>
      const IapPurchaseResult(IapPurchaseOutcome.submitted);

  @override
  Future<IapCustomerState> currentCustomerState() async =>
      IapCustomerState.unknown;

  @override
  Stream<IapCustomerState> get customerState =>
      const Stream<IapCustomerState>.empty();
}

/// A rail that sells one plan and refuses every checkout with [reason], for
/// the refusals no store answer produces. It is an [IdentifiesBuyer], like the
/// store rail, so the signed-in notSignedIn case can count the identify.
class _RefusingRail implements PurchaseRail, IdentifiesBuyer {
  _RefusingRail(this.reason);

  final CheckoutRefusal reason;
  final List<String?> identified = <String?>[];

  @override
  PurchaseRailKind get railKind => PurchaseRailKind.playBilling;

  @override
  List<Offering> get offerings => const <Offering>[
    Offering(
      productId: 'pro_monthly',
      amountMinor: 499,
      currencyCode: 'USD',
      term: OfferingTerm.month,
    ),
  ];

  @override
  bool get canStartCheckout => true;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      CheckoutRefused(reason, detail: _detail);

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;

  @override
  Future<bool> identifyBuyer(String? appUserId) async {
    identified.add(appUserId);
    return true;
  }
}

/// A config that sells one plan and carries a checkout template, so the only
/// things that can refuse are the channel, the bridge and the fake rail.
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

/// The app's own rail for [channel]: a store channel gets a key and [bridge];
/// a hosted channel is keyless and never builds one.
Override _realRail(String channel, [_FakeBridge? bridge]) =>
    purchaseRailProvider.overrideWith(
      (ref) => purchaseRailFor(
        ref,
        channel,
        revenueCatKey: bridge == null ? '' : 'public-sdk-key',
        newBridge: () => bridge!,
      ),
    );

/// The paywall at `/paywall` under a real GoRouter, so a route change is a
/// location the test can read, not an exception from a host with no router.
Future<GoRouter> _pumpPaywall(
  WidgetTester tester, {
  required Override rail,
  core.AuthUser? user = _buyer,
}) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      appConfigProvider.overrideWith((_) async => _selling),
      authRepositoryProvider.overrideWithValue(_Auth(user)),
      rail,
    ],
  );
  addTearDown(c.dispose);
  final GoRouter router = GoRouter(
    initialLocation: '/paywall',
    routes: <RouteBase>[
      GoRoute(path: '/', builder: (_, _) => const Text('home')),
      GoRoute(path: '/paywall', builder: (_, _) => const PaywallScreen()),
      GoRoute(
        path: '/sign-in',
        builder: (_, GoRouterState s) => Text('sign-in ${s.uri}'),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp.router(
        routerConfig: router,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
      ),
    ),
  );
  await _settle(tester);
  return router;
}

/// Provider futures and the store's first answer resolve over several
/// microtask turns; there are no timers or animations to settle.
Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 10; i++) {
    await tester.pump();
  }
}

/// url_launcher's `canLaunch`, held until the test answers it: the hosted
/// rail is then mid-checkout, with the opening sentence on screen.
Completer<bool> _holdLaunch() {
  const MethodChannel channel = MethodChannel(
    'plugins.flutter.io/url_launcher',
  );
  final Completer<bool> held = Completer<bool>();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(
        channel,
        (MethodCall call) =>
            call.method == 'canLaunch' ? held.future : Future<bool>.value(true),
      );
  addTearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );
  return held;
}

/// The refusals the cases below drive, one case each (notSignedIn twice).
const List<CheckoutRefusal> _covered = <CheckoutRefusal>[
  CheckoutRefusal.purchaseCancelled,
  CheckoutRefusal.channelNotPermitted,
  CheckoutRefusal.couldNotOpen,
  CheckoutRefusal.railNotConfigured,
  CheckoutRefusal.platformNotSupported,
  CheckoutRefusal.notSignedIn,
];

void main() {
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));
  final Finder upgrade = find.widgetWithText(FilledButton, en.paywallUpgrade);
  final Finder tryAgain = find.widgetWithText(FilledButton, en.paywallTryAgain);

  Future<void> buy(WidgetTester tester) async {
    expect(upgrade, findsOneWidget, reason: 'the rail must sell first');
    await tester.tap(upgrade);
    await _settle(tester);
  }

  /// A refused screen: [sentence], Try again, and never the log's reason.
  void expectRefused(String sentence) {
    expect(find.text(sentence), findsOneWidget);
    expect(tryAgain, findsOneWidget);
    expect(upgrade, findsNothing);
    expect(find.textContaining('engineering detail'), findsNothing);
  }

  test('every CheckoutRefusal has a case in this file', () {
    expect(_covered.toSet(), CheckoutRefusal.values.toSet());
  });

  group('R1 — each refusal goes where its route says', () {
    testWidgets('purchaseCancelled: a cancelled store sheet returns to the '
        'plans, and says nothing', (WidgetTester tester) async {
      final _FakeBridge bridge = _FakeBridge(
        IapPurchaseOutcome.cancelledByUser,
      );
      await _pumpPaywall(tester, rail: _realRail('android-play', bridge));
      await buy(tester);

      expect(bridge.purchases, 1, reason: 'the store sheet really ran');
      expect(upgrade, findsOneWidget);
      expect(find.text(en.paywallUnavailable), findsNothing);
      expect(find.text(en.paywallRetryMessage), findsNothing);
      expect(tryAgain, findsNothing);
      expect(find.textContaining('engineering detail'), findsNothing);
    });

    testWidgets('channelNotPermitted: a store that refuses shows the '
        'unavailable sentence and Try again', (WidgetTester tester) async {
      final _FakeBridge bridge = _FakeBridge(IapPurchaseOutcome.storeRefused);
      await _pumpPaywall(tester, rail: _realRail('ios-appstore', bridge));
      await buy(tester);

      expect(bridge.purchases, 1);
      expectRefused(en.paywallUnavailable);

      await tester.tap(tryAgain);
      await _settle(tester);
      expect(upgrade, findsOneWidget, reason: 'Try again returns to the plans');
    });

    testWidgets('couldNotOpen: a store that cannot be reached shows the retry '
        'sentence', (WidgetTester tester) async {
      final _FakeBridge bridge = _FakeBridge(IapPurchaseOutcome.unavailable);
      await _pumpPaywall(tester, rail: _realRail('macos-appstore', bridge));
      await buy(tester);

      expect(bridge.purchases, 1);
      expectRefused(en.paywallRetryMessage);
    });

    testWidgets('railNotConfigured shows the retry sentence', (
      WidgetTester tester,
    ) async {
      await _pumpPaywall(
        tester,
        rail: purchaseRailProvider.overrideWithValue(
          _RefusingRail(CheckoutRefusal.railNotConfigured),
        ),
      );
      await buy(tester);
      expectRefused(en.paywallRetryMessage);
    });

    testWidgets('platformNotSupported shows the unavailable sentence', (
      WidgetTester tester,
    ) async {
      await _pumpPaywall(
        tester,
        rail: purchaseRailProvider.overrideWithValue(
          _RefusingRail(CheckoutRefusal.platformNotSupported),
        ),
      );
      await buy(tester);
      expectRefused(en.paywallUnavailable);
    });

    testWidgets('notSignedIn with no session routes to sign-in, and back here '
        'after', (WidgetTester tester) async {
      final _RefusingRail rail = _RefusingRail(CheckoutRefusal.notSignedIn);
      final GoRouter router = await _pumpPaywall(
        tester,
        rail: purchaseRailProvider.overrideWithValue(rail),
        user: null,
      );
      await buy(tester);

      final Uri at = router.routerDelegate.currentConfiguration.uri;
      expect(at.path, '/sign-in');
      expect(at.queryParameters['next'], '/paywall');
      expect(find.text('sign-in /sign-in?next=%2Fpaywall'), findsOneWidget);
      expect(rail.identified, isEmpty, reason: 'nobody to identify');
    });

    testWidgets('notSignedIn with a session the rail missed identifies the '
        'buyer once and offers Try again', (WidgetTester tester) async {
      final _RefusingRail rail = _RefusingRail(CheckoutRefusal.notSignedIn);
      final GoRouter router = await _pumpPaywall(
        tester,
        rail: purchaseRailProvider.overrideWithValue(rail),
      );
      await buy(tester);

      expect(rail.identified, <String?>[_buyer.id]);
      expect(router.routerDelegate.currentConfiguration.uri.path, '/paywall');
      expectRefused(en.paywallRetryMessage);
    });
  });

  group('R3 — a store rail\'s in-flight sentence names no web checkout', () {
    for (final String channel in <String>[
      'android-play',
      'ios-appstore',
      'macos-appstore',
    ]) {
      testWidgets('$channel says paywallOpeningStore', (
        WidgetTester tester,
      ) async {
        final _FakeBridge bridge = _FakeBridge(IapPurchaseOutcome.submitted)
          ..held = Completer<IapPurchaseResult>();
        await _pumpPaywall(tester, rail: _realRail(channel, bridge));
        await buy(tester);

        expect(bridge.purchases, 1, reason: 'the sheet is open, and held');
        expect(find.text(en.paywallOpeningStore), findsOneWidget);
        expect(find.text(en.paywallOpeningHosted), findsNothing);
        expect(
          find.textContaining(RegExp('browser|web', caseSensitive: false)),
          findsNothing,
        );

        bridge.held!.complete(
          const IapPurchaseResult(IapPurchaseOutcome.cancelledByUser),
        );
        await _settle(tester);
        expect(upgrade, findsOneWidget);
      });
    }
  });

  group('R4 — a hosted rail\'s in-flight sentence names the browser', () {
    for (final String channel in <String>[
      'windows-store',
      'linux-appimage',
      'web',
    ]) {
      testWidgets('$channel says paywallOpeningHosted', (
        WidgetTester tester,
      ) async {
        final Completer<bool> launch = _holdLaunch();
        await _pumpPaywall(tester, rail: _realRail(channel));
        await buy(tester);

        expect(find.text(en.paywallOpeningHosted), findsOneWidget);
        expect(find.text(en.paywallOpeningStore), findsNothing);

        // The platform declines the page: couldNotOpen, the retry sentence.
        launch.complete(false);
        await _settle(tester);
        expectRefused(en.paywallRetryMessage);
      });
    }
  });
}
