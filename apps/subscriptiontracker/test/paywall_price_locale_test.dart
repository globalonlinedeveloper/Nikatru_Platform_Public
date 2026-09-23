// 🔴 THE PROOF THAT THE ONE SCREEN WHICH TAKES MONEY FORMATS IT LIKE EVERY
// OTHER SCREEN.
//
// The paywall rendered `Offering.formattedPrice`: `toStringAsFixed` with a
// glued symbol and NO grouping, so twelve and a half lakh rupees (125,000,000
// paise) read `₹1250000.00` in every locale — while the home hero, the budget,
// the calendar and every total in the app go through `MoneyFormatter` under
// the reader's locale. A Tamil reader groups the lakh (`12,50,000`); an
// English reader groups the thousand (`1,250,000`). Neither reads an ungrouped
// seven-digit string on the screen that asks them to pay.
//
// Real `PaywallScreen`, real `AppLocalizations`, real `MoneyFormatter` — the
// only fake is the rail, which supplies an INR offering.
//
// MUTATION PROOF (run and recorded in the PR): put `Text(o.formattedPrice)`
// back in paywall_screen.dart and both locale cases go red.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
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

/// Twelve and a half lakh rupees — the figure where the two groupings differ
/// in every separator position.
class _InrRail implements PurchaseRail {
  @override
  List<Offering> get offerings => const <Offering>[
    Offering(
      productId: 'pro_lifetime_inr',
      amountMinor: 125000000,
      currencyCode: 'INR',
      term: OfferingTerm.year,
    ),
  ];

  @override
  bool get canStartCheckout => true;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'this test buys nothing',
      );

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

/// A STORE rail — O-IAP-PAYWALL-SHOWS-WEB-PRICE. Nothing to sell until the
/// store answers, then the store's price and a trial in the store's own unit.
/// The answer lands AFTER the paywall's first frame, as a real store's does.
class _StoreRail extends ChangeNotifier
    implements PurchaseRail, LoadsOfferings {
  List<Offering> _plans = const <Offering>[];

  /// How many times a screen asked the store.
  int asked = 0;

  void storeAnswers() {
    _plans = const <Offering>[
      Offering(
        productId: 'pro_monthly',
        amountMinor: 719,
        currencyCode: 'USD',
        term: OfferingTerm.month,
        trial: TrialPeriod(count: 1, unit: TrialUnit.month),
      ),
    ];
    notifyListeners();
  }

  @override
  List<Offering> get offerings => _plans;

  @override
  bool get canStartCheckout => _plans.isNotEmpty;

  @override
  Listenable get offeringsChanged => this;

  @override
  Future<void> refreshOfferings() async {
    asked++;
  }

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'this test buys nothing',
      );

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

Future<void> _pump(
  WidgetTester tester,
  Locale locale, {
  PurchaseRail? rail,
}) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      purchaseRailProvider.overrideWithValue(rail ?? _InrRail()),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: const <LocalizationsDelegate<Object>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const PaywallScreen(),
      ),
    ),
  );
  for (int i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  testWidgets('🔴 Tamil: the lakh is grouped — ₹12,50,000.00', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const Locale('ta'));
    expect(find.text('₹12,50,000.00'), findsOneWidget);
    expect(find.textContaining('1250000'), findsNothing);
  });

  testWidgets('🔴 English: the thousand is grouped — ₹1,250,000.00', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const Locale('en'));
    expect(find.text('₹1,250,000.00'), findsOneWidget);
    expect(find.textContaining('1250000'), findsNothing);
  });

  // A store build's paywall quoted the rail config's amount — the price the
  // web charges — beside a sheet that bills the store's. It now asks the store
  // when it opens, and repaints with the store's answer when that lands.
  testWidgets(
    "🔴 a store rail: nothing, then the STORE's price and its month",
    (WidgetTester tester) async {
      final _StoreRail rail = _StoreRail();
      addTearDown(rail.dispose);
      await _pump(tester, const Locale('en'), rail: rail);
      expect(rail.asked, greaterThan(0));
      expect(find.textContaining('7.19'), findsNothing);

      rail.storeAnswers();
      await tester.pump();
      expect(find.textContaining('7.19'), findsOneWidget);
      expect(find.textContaining('1-month free trial'), findsOneWidget);
      expect(find.textContaining('-day free trial'), findsNothing);
    },
  );
}
