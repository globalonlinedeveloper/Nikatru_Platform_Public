// 🔴 THE PURCHASE PARITY ROW, RENDERED: every target either sells or says it
// does not — and a target that does not sell shows NO price and NO button.
//
// Driven through the REAL `PaywallScreen` and the app's REAL rail wiring —
// `purchaseRailFor`, the body of `purchaseRailProvider`, which asks
// `ChassisBilling.railForDeclared` with the channel the build DECLARES — with a
// config that DOES carry an offering and a checkout template, so the only
// things that can refuse are the channel's register rail and its capability
// row in `packages/purchases/lib/src/purchase_capabilities.dart`.
//
// ⏱ RE-POINTED 2026-09-19 (R10). The rail used to be a `HostedCheckoutRail`
// resolving its capabilities from the PLATFORM. It now follows the CHANNEL, a
// compile-time `RELEASE_CHANNEL` a widget test cannot rebuild per case — so
// each case overrides the provider with the same `purchaseRailFor` and the
// channel id its lane stamps. The platform override stays, so the paywall is
// still laid out as that target.
//
// What this proves and what it does not:
//   · PROVEN: on the android-play, ios-appstore and macos-appstore channels
//     the paywall offers nothing — no price, no buy button, no link — and says
//     purchases are not available (no IAP bridge ships yet); so does a build
//     that declares NO channel (the `dev` default). On windows-store and
//     linux-appimage (the positive control) the same config renders the price
//     and the buy button.
//   · NOT PROVEN HERE: web (`kIsWeb` is a compile-time constant a widget test
//     cannot flip — its row is covered in packages/purchases'
//     purchase_capabilities_test), and apps.gov.in, which an installed build
//     cannot tell apart from a Play install at runtime (it resolves the
//     android-play row here, which also refuses).
//     ⏱ CORRECTED 2026-09-25 (O-PAYWALL-SPEAKS-ONLY-WEB-CHECKOUT): the web
//     channel is driven now. R4 in test/paywall_refusal_routes_test.dart
//     picks the app's rail for 'web' (`purchaseRailFor`) and proves its
//     in-flight sentence and its declined-page retry.
//   · NOT BUILT: a store billing rail for Android/iOS/macOS. No store-billing
//     plugin exists in this repository's dependency graph — see the PR.
//     ⏱ CORRECTED 2026-09-22 (O-IAP-BRIDGE-NOT-WIRED-IN-THE-APP): it is built
//     now. This app opts in to `billing.mobileIap`, so a store build that
//     carries its RevenueCat key sells through the store — proven in
//     test/iap_opt_in_test.dart with a fake bridge. THIS file pins the KEYLESS
//     half: every case passes `revenueCatKey: ''` explicitly, which is what a
//     store build compiled without its key (a fork PR, a missing secret) runs,
//     and that build must still offer nothing — no price, no button, no web
//     book — rather than fall back to the web rail.
//
//   · AND WHAT THE SELLING TARGETS SAY MID-CHECKOUT (O-PAYWALL-SPEAKS-ONLY-
//     WEB-CHECKOUT): windows-store and linux-appimage sell through the hosted
//     rail, so with the page held open they say `paywallOpeningHosted`, never
//     the store sentence. The store channels' in-flight sentence needs a key
//     and a bridge, which this keyless file does not build; it is pinned in
//     test/paywall_refusal_routes_test.dart.
//
// MUTATION PROOF (run and recorded in the PR): set `channelPermitted: true` on
// the `iosAppStore` row of purchase_capabilities.dart and the iOS case goes red.
import 'dart:async' show Completer;

import 'package:flutter/foundation.dart'
    show debugDefaultTargetPlatformOverride;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show MethodCall, MethodChannel;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
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

/// A session, so the hosted rail gets past attribution and reaches the page.
class _SignedIn extends core.AuthRepository {
  @override
  core.AuthUser? get currentUser =>
      const core.AuthUser(id: 'user-under-test', email: 'buyer@example.test');

  @override
  Stream<core.AuthUser?> authStateChanges() =>
      const Stream<core.AuthUser?>.empty();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A config that can sell, everywhere the matrix allows it to.
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

Future<void> _pumpOn(
  WidgetTester tester,
  TargetPlatform platform,
  String releaseChannel, {
  core.AuthRepository? auth,
}) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      appConfigProvider.overrideWith((_) async => _selling),
      if (auth != null) authRepositoryProvider.overrideWithValue(auth),
      purchaseRailProvider.overrideWith(
        (ref) => purchaseRailFor(ref, releaseChannel, revenueCatKey: ''),
      ),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
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
  for (int i = 0; i < 6; i++) {
    await tester.pump();
  }
}

/// Runs [body] with the platform overridden, clearing it INSIDE the test body —
/// flutter_test checks foundation debug variables before any tearDown runs.
Future<void> _onPlatform(TargetPlatform p, Future<void> Function() body) async {
  debugDefaultTargetPlatformOverride = p;
  try {
    await body();
  } finally {
    debugDefaultTargetPlatformOverride = null;
  }
}

void main() {
  final AppLocalizations en = lookupAppLocalizations(const Locale('en'));

  for (final (TargetPlatform p, String channel) in <(TargetPlatform, String)>[
    (TargetPlatform.android, 'android-play'),
    (TargetPlatform.iOS, 'ios-appstore'),
    (TargetPlatform.macOS, 'macos-appstore'),
    // 🔴 THE UNDECLARED CHANNEL. A build without --dart-define=RELEASE_CHANNEL
    // compiles in 'dev', and 'dev' is NOT guessed as web: on a target that
    // would otherwise sell, it still sells nothing.
    (TargetPlatform.windows, 'dev'),
  ]) {
    testWidgets('🔴 ${p.name} / $channel: declared unavailable — no price, '
        'no button, no link', (WidgetTester tester) async {
      await _onPlatform(p, () async {
        await _pumpOn(tester, p, channel);
        expect(find.text(en.paywallUnavailable), findsOneWidget);
        expect(find.textContaining(r'$4.99'), findsNothing);
        expect(
          find.widgetWithText(FilledButton, en.paywallUpgrade),
          findsNothing,
        );
        expect(find.byType(FilledButton), findsNothing);
        expect(find.textContaining('http'), findsNothing);
        expect(find.textContaining('web'), findsNothing);
      });
    });
  }

  for (final (TargetPlatform p, String channel) in <(TargetPlatform, String)>[
    (TargetPlatform.windows, 'windows-store'),
    (TargetPlatform.linux, 'linux-appimage'),
  ]) {
    testWidgets('${p.name} / $channel: the same config SELLS — the positive '
        'control', (WidgetTester tester) async {
      await _onPlatform(p, () async {
        // url_launcher's `canLaunch`, held: the hosted rail is mid-checkout,
        // with its in-flight sentence on screen, until the test answers.
        const MethodChannel launcher = MethodChannel(
          'plugins.flutter.io/url_launcher',
        );
        final Completer<bool> held = Completer<bool>();
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(
              launcher,
              (MethodCall call) => call.method == 'canLaunch'
                  ? held.future
                  : Future<bool>.value(true),
            );
        addTearDown(
          () => TestDefaultBinaryMessengerBinding
              .instance
              .defaultBinaryMessenger
              .setMockMethodCallHandler(launcher, null),
        );

        await _pumpOn(tester, p, channel, auth: _SignedIn());
        expect(find.text(r'$4.99'), findsOneWidget);
        expect(
          find.widgetWithText(FilledButton, en.paywallUpgrade),
          findsOneWidget,
        );
        expect(find.text(en.paywallUnavailable), findsNothing);

        await tester.tap(find.widgetWithText(FilledButton, en.paywallUpgrade));
        for (int i = 0; i < 6; i++) {
          await tester.pump();
        }
        expect(find.text(en.paywallOpeningHosted), findsOneWidget);
        expect(find.text(en.paywallOpeningStore), findsNothing);

        held.complete(false);
        for (int i = 0; i < 6; i++) {
          await tester.pump();
        }
      });
    });
  }
}
