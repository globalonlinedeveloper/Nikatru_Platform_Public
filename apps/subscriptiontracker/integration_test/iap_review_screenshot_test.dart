// Subscription Tracker — the App Store IAP REVIEW SCREENSHOTS, one per
// auto-renewable product (tooling/channel-register.json
// storeMetadataContract.perChannel["ios-appstore"].graphicAssets.iapReview).
//
// ⏱ ADDED 2026-10-03 (release lane apple-ready). App Store Connect holds an
// auto-renewable subscription in "Missing Metadata" until it carries a review
// screenshot, and a version that references it cannot be sent for review.
//
// 🔴 WHY THE RAIL IS A FIXTURE, AND WHAT IS NOT. StoreKit returns no product that
// is still in "Missing Metadata", and the review screenshot is what takes the
// product out of it — so a simulator build asking the store would photograph an
// empty paywall. Everything else is the real thing: the real `PaywallScreen`, the
// app's real theme and `AppLocalizations`, on the iPhone simulator the listing set
// uses, through the platform's own shutter. The rail offers exactly ONE product per
// frame, at the price App Store Connect ACCEPTED for it
// (services/platform/src/app-config-data.json prices.apps.<app>.<product>.store
// .readBack.apple), with the paywall's served feature lists. None of that is typed
// here: tooling/store/capture-iap-review.mjs derives it and passes it as
// `--dart-define`s, so a third subscription term is a third frame with no edit.
//
// Run through the runner, never by hand:
//   node tooling/store/capture-iap-review.mjs --app subscriptiontracker
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart'
    show ChassisLocalizations, buildAppTheme;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:nikatru_purchases/testing.dart';
import 'package:subscriptiontracker/core/format/money_format.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/services/notifications/notification_service.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

/// `<product_id>|<amount minor>|<ISO currency>|<term wire>;…`, built by the runner.
const String _offeringsDefine = String.fromEnvironment('IAP_REVIEW_OFFERINGS');

/// The paywall's served feature codes, comma-separated, built by the runner.
const String _proDefine = String.fromEnvironment('IAP_REVIEW_PRO_FEATURES');
const String _freeDefine = String.fromEnvironment('IAP_REVIEW_FREE_FEATURES');

List<String> _codes(String raw) => <String>[
  for (final String c in raw.split(','))
    if (c.trim().isNotEmpty) c.trim(),
];

/// The products to photograph. REFUSES (a `StateError`, never an `assert`, which
/// a non-debug drive would skip) on a missing or unreadable define: a review
/// screenshot of a product nobody named is evidence about nothing.
List<Offering> reviewOfferings(String raw) {
  if (raw.trim().isEmpty) {
    throw StateError(
      'IAP_REVIEW_OFFERINGS is empty. Run tooling/store/capture-iap-review.mjs, '
      'which derives the auto-renewable products and their accepted store prices.',
    );
  }
  return <Offering>[
    for (final String entry in raw.split(';'))
      if (entry.trim().isNotEmpty) _offering(entry.trim()),
  ];
}

Offering _offering(String entry) {
  final List<String> f = entry.split('|');
  final int? amount = f.length == 4 ? int.tryParse(f[1]) : null;
  final OfferingTerm? term = f.length == 4 ? OfferingTerm.tryParse(f[3]) : null;
  if (amount == null || amount < 1 || term == null || term == OfferingTerm.oneTime) {
    throw StateError(
      'IAP_REVIEW_OFFERINGS entry "$entry" is not <product_id>|<amount minor>|'
      '<currency>|<month|year>: Apple asks a review screenshot of an '
      'auto-renewable product only.',
    );
  }
  return Offering(
    productId: f[0],
    amountMinor: amount,
    currencyCode: f[2],
    term: term,
  );
}

class _MemStore implements core.KeyValueStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

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

class _SilentNotifications extends RenewalReminders {
  _SilentNotifications() : super.forTesting();
  @override
  Future<void> syncAll(
    List<Subscription> subs, {
    required ReminderCopy copy,
    ReminderRules rules = const ReminderRules(),
  }) async {}
  @override
  Future<void> cancelAll() async {}
  @override
  Future<void> scheduleWeeklyDigest({
    required ReminderCopy copy,
    required int count,
    required String formattedTotal,
  }) async {}
  @override
  Future<void> cancelWeeklyDigest() async {}
}

void main() {
  final IntegrationTestWidgetsFlutterBinding binding =
      IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  final List<Offering> offerings = reviewOfferings(_offeringsDefine);

  for (final Offering product in offerings) {
    testWidgets('IAP review screenshot — ${product.productId}', (
      WidgetTester tester,
    ) async {
      final FakePurchaseRail rail = FakePurchaseRail(
        railKind: PurchaseRailKind.appleIap,
        offerings: <Offering>[product],
        canStartCheckout: true,
        refusal: CheckoutRefusal.notSignedIn,
        refusalDetail: 'the review capture buys nothing',
      );
      final ProviderContainer c = ProviderContainer(
        retry: (int retryCount, Object error) => null,
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => _MemStore()),
          renewalRemindersProvider.overrideWithValue(_SilentNotifications()),
          secureStoreProvider.overrideWithValue(_MemSecureStore()),
          sellingEnabledProvider.overrideWithValue(true),
          paywallPitchProvider.overrideWithValue((
            pro: _codes(_proDefine),
            free: _codes(_freeDefine),
            trialCopy: false,
          )),
          purchaseRailProvider.overrideWithValue(rail),
        ],
      );
      addTearDown(c.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: c,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: const Color(0xFF6459F5)),
            localizationsDelegates: const <LocalizationsDelegate<Object>>[
              AppLocalizations.delegate,
              ChassisLocalizations.delegate,
              GlobalMaterialLocalizations.delegate,
              GlobalWidgetsLocalizations.delegate,
              GlobalCupertinoLocalizations.delegate,
            ],
            supportedLocales: AppLocalizations.supportedLocales,
            home: const PaywallScreen(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      // The frame must SHOW the product it is filed under: its price, as the
      // paywall formats it, is on screen.
      expect(
        find.textContaining(
          MoneyFormatter('en').format(product.price),
          findRichText: true,
        ),
        findsWidgets,
        reason: '${product.productId}: its price is not on the paywall',
      );
      await binding.takeScreenshot(product.productId);
    });
  }
}
