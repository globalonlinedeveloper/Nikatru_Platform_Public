// ─────────────────────────────────────────────────────────────────────────────
// [research/44 §7 rung 3] THE SAME-APP UPGRADE CARD, ON A REAL APP TREE.
//
// 🔴 THE FIRST GROUP IS THE ONE THAT MATTERS, AND IT ASSERTS THAT NOTHING
// HAPPENS. `features.promo_card_enabled` is ABSENT from every config this
// portfolio serves, and an absent feature key reads false, so the shipped state
// of this surface — today, and for as long as nobody arms a campaign — is that
// it renders zero pixels. "Renders nothing" is exactly the claim that never gets
// checked, because nothing about it looks broken; and the version of this widget
// that renders an empty `Padding` instead of collapsing would put a strip of
// dead space at the top of the home screen of every app in the portfolio while
// every other test stayed green.
//
// The SECOND group is the other half of the same discipline ([pipeline C-6]): a
// fail-closed surface with no proven open path is a dead feature reporting
// healthy. So the flag is served for real, the card appears for real, and the
// price it quotes is DERIVED from the rail's own amount and currency rather
// than typed anywhere.
//
// ⚠️ THE REAL `HostedCheckoutRail`, NOT A FAKE, WHEREVER THE POINT IS THE
// SHIPPED STATE. Its `canStartCheckout` is false today (no
// `checkout_url_template` — OWNER_QUEUE A-1), which is why the honest open path
// is a card with a price, a manage entry and NO buy button. A fake rail is used
// only where the question is specifically "what does the card do when selling
// IS permitted", and it is named as a fake there.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subly/core/app_config.dart';
import 'package:subly/features/home/home_screen.dart';
import 'package:subly/l10n/app_localizations.dart';
import 'package:subly/state/money_providers.dart';
import 'package:subly/state/providers.dart';

/// In-memory KV: `PrefsKeyValueStore` needs a platform channel a widget test has
/// not got, so every test drives the storage seam instead of mocking a plugin.
class _MemStore implements core.KeyValueStore {
  _MemStore({this.slowKey, this.slowBy = Duration.zero});

  /// ONE key's read is delayed, and only one.
  ///
  /// A store where EVERY read is slow moves the onboarding flag and the session
  /// with it, so the frames being measured stop being the frames that were
  /// interesting. Delaying a single key models the real ordering instead: the
  /// config is resolved at the app root, and the promo record is read when the
  /// home body first builds — so the card decides before its own record lands.
  final String? slowKey;
  final Duration slowBy;

  final Map<String, String> data = <String, String>{};
  @override
  Future<bool> containsKey(String key) async => data.containsKey(key);
  @override
  Future<String?> read(String key) async {
    if (key == slowKey && slowBy > Duration.zero) {
      await Future<void>.delayed(slowBy);
    }
    return data[key];
  }

  @override
  Future<void> remove(String key) async => data.remove(key);
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// A rail that says selling is permitted. Used ONLY for the buy-button rows —
/// see the header.
class _SellingRail implements PurchaseRail {
  @override
  List<Offering> get offerings => const <Offering>[
    Offering(
      productId: 'pro_monthly',
      amountMinor: 499,
      currencyCode: 'USD',
      term: OfferingTerm.month,
      trialDays: 0,
    ),
  ];

  @override
  bool get canStartCheckout => true;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(CheckoutRefusal.railNotConfigured);

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

core.AppConfig _config({
  bool promoEnabled = false,
  bool withOfferings = true,
  bool paywallEnabled = false,
  Map<String, String> copy = const <String, String>{},
  Map<String, int> flags = const <String, int>{},
}) => core.AppConfig(
  appId: AppConfig.appId,
  apiBaseUrl: AppConfig.apiBaseUrl,
  // 🔴 THE KEY IS ABSENT UNLESS A TEST PUTS IT THERE. That is the shipped
  // shape: `AppConfig.feature` answers `orElse: false` for a key nobody sent,
  // so the OFF case below is produced by serving the SAME config the portfolio
  // serves rather than by a flag set to false.
  features: promoEnabled
      ? const <String, bool>{'promo_card_enabled': true}
      : const <String, bool>{},
  paywall: core.PaywallConfig(
    enabled: paywallEnabled,
    extra: withOfferings
        ? const <String, Object?>{
            'offerings': <Object?>[
              <String, Object?>{
                'product_id': 'pro_monthly',
                'amount_minor': 499,
                'currency_code': 'USD',
                'term': 'month',
                'trial_days': 0,
              },
            ],
          }
        : const <String, Object?>{},
  ),
  contentPack: null,
  copy: copy,
  minSupportedVersion: '1.0.0',
  flags: flags,
);

Widget _host(
  _MemStore store,
  core.AppConfig cfg, {
  PurchaseRail? rail,
  // 🔴 THE SERVER'S ANSWER, NOT THE LOCK. Overriding `paywallLockedProvider`
  // directly would assert that a boolean makes a widget change, which was never
  // in doubt. This drives the entitlement the lock is COMPUTED from, so the
  // limb under test is really on the path.
  bool entitled = false,
  Locale? locale,
}) => ProviderScope(
  overrides: <Override>[
    keyValueStoreProvider.overrideWith((_) async => store),
    appConfigProvider.overrideWith((_) async => cfg),
    if (rail != null) purchaseRailProvider.overrideWithValue(rail),
    if (entitled)
      entitlementsProvider.overrideWith(
        (_) async => core.Entitlements(
          appId: AppConfig.appId,
          isPro: true,
          items: const <core.Entitlement>[],
        ),
      ),
  ],
  child: MaterialApp(
    locale: locale,
    localizationsDelegates: const <LocalizationsDelegate<Object>>[
      AppLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
      GlobalCupertinoLocalizations.delegate,
    ],
    supportedLocales: AppLocalizations.supportedLocales,
    home: const Scaffold(
      body: Column(
        children: <Widget>[UpgradePromoCard(), Text('the product below it')],
      ),
    ),
  ),
);

void main() {
  group('promo card — the shipped state is OFF, and it collapses', () {
    testWidgets('an absent feature key renders NO promotional widget', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config()));
      await tester.pumpAndSettle();

      expect(
        find.byType(PromoCard),
        findsNothing,
        reason:
            'research/44 §4.5 — absent ⇒ render nothing. An app that has '
            'never reached the network must show no promo, and every app in '
            'this portfolio is in that state today',
      );
      expect(find.text('OFFER FROM THIS APP'), findsNothing);
      expect(find.text('Get the full experience'), findsNothing);
      expect(find.byType(FilledButton), findsNothing);
      expect(find.byIcon(Icons.close), findsNothing);
      expect(find.text('the product below it'), findsOneWidget);
    });

    testWidgets('and it occupies NO height', (WidgetTester tester) async {
      await tester.pumpWidget(_host(_MemStore(), _config()));
      await tester.pumpAndSettle();
      // A hidden card that still draws its own padding is a dead strip at the
      // top of every home screen in the portfolio, forever, and nothing about
      // it raises an exception or fails another assertion.
      expect(tester.getSize(find.byType(UpgradePromoCard)), Size.zero);
    });

    testWidgets('nothing is written to storage while it is off', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      await tester.pumpWidget(_host(store, _config()));
      await tester.pumpAndSettle();
      expect(
        store.data.keys.where((String k) => k.contains('promo')),
        isEmpty,
        reason:
            'an impression counter that ticks while nothing is displayed '
            'would burn the lifetime cap before the first campaign runs',
      );
    });
  });

  group('promo card — the open path, opened deliberately', () {
    testWidgets('the flag served true puts a labelled card on screen', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config(promoEnabled: true)));
      await tester.pumpAndSettle();

      expect(find.byType(PromoCard), findsOneWidget);
      expect(
        find.text('OFFER FROM THIS APP'),
        findsOneWidget,
        reason:
            'the visible label plus a distinct container is what satisfies '
            'Apple 2.5.18, MS 10.10.4, Play and India at once',
      );
      expect(find.text('Get the full experience'), findsOneWidget);
    });

    testWidgets('the price is DERIVED from the rail, never typed', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      // 499 minor units of USD, formatted by `Offering.formattedPrice`. Change
      // the served amount and this string changes with it — which is the whole
      // difference between a price and a decoration that looks like one.
      expect(find.text(r'$4.99, billed per month'), findsOneWidget);
    });

    testWidgets('ABSOLUTE ONLY — no percentage, no "was", no countdown', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      // Directive 98/6/EC Art 6a + CJEU C-330/23: a reduction must be computed
      // against the lowest price of the prior 30 days, and this repository
      // holds no price history. The widget has no parameter for any of these,
      // so this is a check on the COPY as well as on the API.
      final Iterable<String> shown = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text t) => t.data ?? '')
          .toList();
      // 🔴 WORD-BOUNDED, SINCE 2026-08-10, AND THE LOOSENING IS NOT A WEAKENING.
      // These were bare substrings, and `'off'` matched the word **offers** the
      // moment research/44 rung 4 put `PromoSurface`'s Art 21 control on the
      // card: "Stop showing offers" failed a check about DISCOUNTS. A test that
      // fires on the objection control is a test that would be silenced by
      // deleting it — the opposite of what it is for. `\boff\b` still catches
      // "50% off" and no longer catches "offers"; `\bsave\b` still catches
      // "save 30%" and no longer catches "saved".
      //
      // ⚠️ AND THE PATTERNS CARRY A POSITIVE CONTROL BELOW, because narrowing a
      // matcher is exactly the edit that can quietly stop it matching anything
      // at all — which reads identically to clean copy.
      final List<RegExp> forbidden = <RegExp>[
        RegExp(r'%'),
        RegExp(r'\bwas\b', caseSensitive: false),
        RegExp(r'\bsave\b', caseSensitive: false),
        RegExp(r'\boff\b', caseSensitive: false),
      ];
      const List<String> mustStillCatch = <String>[
        '25% off',
        'was \$9.99',
        'Save 30%',
        'HALF OFF today',
      ];
      for (final String control in mustStillCatch) {
        expect(
          forbidden.any((RegExp re) => re.hasMatch(control)),
          isTrue,
          reason:
              'the discount matchers stopped matching "$control" — a narrowed '
              'pattern that catches nothing prints exactly like clean copy',
        );
      }
      for (final RegExp re in forbidden) {
        expect(
          shown.where((String s) => re.hasMatch(s)),
          isEmpty,
          reason:
              'a price-comparison or urgency claim (${re.pattern}) appeared on '
              'a surface that has no price history to compute it from',
        );
      }
    });

    testWidgets('the manage/cancel entry is on the card — ROSCA parity', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      expect(
        find.text('Manage subscription'),
        findsOneWidget,
        reason:
            'a card that offers a shortcut to start paying and no equally '
            'adjacent way to stop is the pattern ROSCA exists to stop, and it '
            'survives an equal hop count',
      );
    });

    testWidgets('the impression is persisted once the card is really drawn', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();

      final String? raw = store.data['nikatru.promo_card'];
      expect(raw, isNotNull, reason: 'a counter nobody writes never caps');
      expect(raw, contains('"shown_count":1'));
      // …and the card is STILL on screen. The write republishes the state, the
      // widget rebuilds, and a re-decision from the new record says
      // `shownTooRecently` — so without the presentation latch the card would
      // delete itself on the frame after it appeared.
      expect(
        find.byType(PromoCard),
        findsOneWidget,
        reason: 'the card must not vanish under its own cooldown mid-frame',
      );
    });
  });

  group('promo card — the refusals a user or a store imposes', () {
    testWidgets(
      'an offering-less rail shows nothing (C-6, not a silent show)',
      (WidgetTester tester) async {
        await tester.pumpWidget(
          _host(_MemStore(), _config(promoEnabled: true, withOfferings: false)),
        );
        await tester.pumpAndSettle();
        expect(
          find.byType(PromoCard),
          findsNothing,
          reason:
              "research/44's DO-NOT-BUILD list opens with the empty "
              'portfolio directory: wired, guarded, green and useless',
        );
      },
    );

    testWidgets('the real rail cannot sell today, so there is no buy button', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(_host(_MemStore(), _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      // `HostedCheckoutRail.canStartCheckout` is false with no
      // `checkout_url_template` (OWNER_QUEUE A-1). This is the shipped state,
      // and a card that offered a button here would open nothing.
      expect(find.byType(FilledButton), findsNothing);
      expect(find.text('Manage subscription'), findsOneWidget);
    });

    testWidgets('a rail that CAN sell gets the buy button', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(_MemStore(), _config(promoEnabled: true), rail: _SellingRail()),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Upgrade'),
        findsOneWidget,
        reason:
            'the other direction of the same rule — the button appears '
            'exactly when `canStartCheckout` says a checkout could be started',
      );
    });

    testWidgets('a dismissal latches, and survives a restart', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsOneWidget);

      await tester.tap(find.text('Not now'));
      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsNothing);
      expect(store.data['nikatru.promo_card'], contains('"dismissed":true'));

      // A NEW container over the SAME storage — a relaunch. research/44 §6
      // requires the dismissal latched, "never re-cleared by a counter
      // roll-over", and a latch only held in memory is not latched at all.
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsNothing);
    });

    testWidgets('an Art 21 objection outranks a live campaign', (
      WidgetTester tester,
    ) async {
      final _MemStore store = _MemStore();
      store.data['nikatru.promo_card'] =
          '{"shown_count":0,"dismissed":false,"suppressed":true}';
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      expect(
        find.byType(PromoCard),
        findsNothing,
        reason:
            'GDPR Art 21(2)/(3): the objection is absolute and no config '
            'flag, counter or campaign outranks it',
      );
    });

    testWidgets('a PAYING user is not promoted to — the row that failed', (
      WidgetTester tester,
    ) async {
      // 🔴 THIS ROW USED TO ASSERT THE OPPOSITE OF ITS OWN NAME. It served an
      // UNPAID user, expected `findsOneWidget`, and conceded in its comment
      // that "the paid case is the negative of this row" — a negative asserted
      // nowhere. Deleting the `paywallLockedProvider` limb from the home body
      // left all 18 rows of this file AND all 7 rows of the stamped-app
      // property group green, verified by mutating the real tree. An assertion
      // that cannot fail is worse than none, and this one was money-adjacent.
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(promoEnabled: true, paywallEnabled: true),
          entitled: true,
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.byType(PromoCard),
        findsNothing,
        reason:
            'a user who has already paid must not be sold the thing they '
            'already own — and the card has to consult the entitlement to '
            'know that',
      );
    });

    testWidgets('…and an UNPAID user of the same selling app still is', (
      WidgetTester tester,
    ) async {
      // The control for the row above: same config, same rail, entitlement the
      // only difference. Without it "findsNothing" above would also pass on a
      // card that had stopped rendering for everybody.
      await tester.pumpWidget(
        _host(_MemStore(), _config(promoEnabled: true, paywallEnabled: true)),
      );
      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsOneWidget);
    });

    testWidgets('an UNREADABLE record shows nothing and is never rewritten', (
      WidgetTester tester,
    ) async {
      // 🔴 AN INTERRUPTED WRITE IS THE ORDINARY WAY A KEY/VALUE STORE FAILS,
      // AND THE OBJECTION IS PLAINLY IN THESE BYTES — only the closing brace is
      // missing. The first version of this controller wrapped `jsonDecode` and
      // the map cast in one catch that fell back to the empty default, so this
      // record read as a FRESH DEVICE: the card rendered, and `markShown` then
      // rewrote the key as `"suppressed":false`. One launch, and a GDPR Art 21
      // objection was gone from disk. Proven on the real tree before the fix.
      const String truncated =
          '{"shown_count":0,"dismissed":false,"suppressed":true';
      final _MemStore store = _MemStore();
      store.data['nikatru.promo_card'] = truncated;
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();

      expect(
        find.byType(UpgradePromoCard),
        findsOneWidget,
        reason:
            'COVERAGE — the widget must really be mounted and deciding, or '
            'the row below passes on an empty tree',
      );
      expect(
        find.byType(PromoCard),
        findsNothing,
        reason:
            'a record we could not read is not a record that says nobody '
            'objected — it fails CLOSED',
      );
      expect(
        store.data['nikatru.promo_card'],
        truncated,
        reason:
            'an impression counter is the least important thing on this key '
            'and must never be what destroys the most important one',
      );
    });

    testWidgets('a non-object record is unreadable too, not an empty one', (
      WidgetTester tester,
    ) async {
      // The other corruption shape: valid JSON, wrong top level. It used to
      // reach the same silent fallback through the `as Map<String, Object?>`
      // cast, which is the failure the cast made look like a parse.
      const String wrongShape = '["suppressed"]';
      final _MemStore store = _MemStore();
      store.data['nikatru.promo_card'] = wrongShape;
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));
      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsNothing);
      expect(store.data['nikatru.promo_card'], wrongShape);
    });

    testWidgets('the card waits for the disk read — NOT settled first', (
      WidgetTester tester,
    ) async {
      // 🔴 THE WINDOW EVERY OTHER ROW IN THIS FILE SKIPS OVER. `pumpAndSettle()`
      // is the first line of all 18 of them, and the defect lived entirely
      // before the settle: the controller published a synchronous empty default
      // and hydrated behind it, so a device holding an objection was shown a
      // promotional card at t+0, t+5, t+10 and t+20 ms against a 40 ms read —
      // measured on the real tree. Art 21(3) has no grace period in it.
      final _MemStore store = _MemStore(
        slowKey: 'nikatru.promo_card',
        slowBy: const Duration(milliseconds: 40),
      );
      store.data['nikatru.promo_card'] =
          '{"shown_count":0,"dismissed":false,"suppressed":true}';
      await tester.pumpWidget(_host(store, _config(promoEnabled: true)));

      for (final int ms in <int>[0, 5, 10, 20, 39]) {
        await tester.pump(Duration(milliseconds: ms));
        expect(
          find.byType(UpgradePromoCard),
          findsOneWidget,
          reason:
              'COVERAGE at t+$ms ms — the widget must be in the tree and '
              'deciding, or the row below is asserting about nothing',
        );
        expect(
          find.byType(PromoCard),
          findsNothing,
          reason:
              'at t+$ms ms the record has not landed, and "not read yet" must '
              'not be served as "nobody ever objected"',
        );
      }

      await tester.pumpAndSettle();
      expect(find.byType(PromoCard), findsNothing);
    });

    testWidgets('an unread record blocks the counter write, not the objection', (
      WidgetTester tester,
    ) async {
      // The controller half of the two rows above, driven directly — because
      // the widget can no longer reach `markShown` on an unreadable record and
      // an unreachable rule is one nothing proves. `objectToPromotion` is the
      // deliberate exception: `suppressed: true` is the MAXIMAL latch, so the
      // record it writes is at least as restrictive as anything the bytes we
      // failed to read could have encoded, and refusing that write is the only
      // option that could lose an objection.
      const String truncated =
          '{"shown_count":0,"dismissed":false,"suppressed":true';
      final _MemStore store = _MemStore();
      store.data['nikatru.promo_card'] = truncated;
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          appConfigProvider.overrideWith((_) async => _config()),
        ],
      );
      addTearDown(c.dispose);
      final PromoCardStateController notifier = c.read(
        promoCardStateProvider.notifier,
      );

      await notifier.markShown(const core.PromoGateState(shownCount: 1));
      expect(
        store.data['nikatru.promo_card'],
        truncated,
        reason: 'markShown must not overwrite a record it never read',
      );
      await notifier.dismiss();
      expect(
        store.data['nikatru.promo_card'],
        truncated,
        reason:
            'dismissed is a WEAKER latch than suppressed — writing it over '
            'bytes that may have held an objection trades a legal obligation '
            'for a preference',
      );

      await notifier.objectToPromotion();
      expect(
        store.data['nikatru.promo_card'],
        contains('"suppressed":true'),
        reason:
            'the maximal latch is always writable — losing an objection is '
            'the one outcome Art 21(3) forbids outright',
      );
    });
  });

  group('promo card — the second locale renders it too', () {
    testWidgets('every string on the card is localised in ta', (
      WidgetTester tester,
    ) async {
      // 🔴 THE SURFACE HAD NO SECOND-LOCALE ROW AT ALL, which is how a key that
      // was added to app_en.arb and forgotten in app_ta.arb ships as an English
      // sentence in a Tamil app — and nothing goes red, because the fallback IS
      // the English string.
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(promoEnabled: true),
          locale: const Locale('ta'),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byType(PromoCard), findsOneWidget);
      expect(find.text('இந்தச் செயலியின் சலுகை'), findsOneWidget);
      expect(find.text('முழு அனுபவத்தைப் பெறுங்கள்'), findsOneWidget);
      expect(
        find.text('இந்தச் சலுகையை மூடு'),
        findsNothing,
      ); // a11y label, not text
      // The PRICE is still derived, in either language.
      expect(find.textContaining(r'$4.99'), findsOneWidget);
      // ⬜ AND THE KNOWN GAP, NAMED RATHER THAN ASSERTED. `promoCardPrice` is
      // fed `offering.term.wire` — the WIRE enum, 'month'/'year' — so a Tamil
      // reader sees "$4.99, ஒரு month க்கு கட்டணம்". This is the CHASSIS
      // convention, not something this surface invented:
      // `paywall_screen.dart` passes the same `o.term.wire` into
      // `l10n.paywallTerm`, and both ARBs interpolate it verbatim. Localising
      // the term is a chassis-wide edit — three new keys and both call sites —
      // and it is deliberately NOT asserted here, because pinning the English
      // word would make the fix a test failure. Recorded in the integration
      // notes as a follow-up rather than left to be rediscovered.
    });
  });

  group('promo card — the words are config, the variant is a flag', () {
    testWidgets('a copy override replaces the chassis default', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(
            promoEnabled: true,
            copy: const <String, String>{
              'promo.card.title': 'Two months of everything',
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Two months of everything'), findsOneWidget);
      expect(find.text('Get the full experience'), findsNothing);
    });

    testWidgets('an empty override is treated as absent, not as blank copy', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(
            promoEnabled: true,
            copy: const <String, String>{'promo.card.title': '   '},
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('Get the full experience'),
        findsOneWidget,
        reason:
            'a config shipping "" is a config somebody half-edited, and a '
            'blank card is worse than the default one',
      );
    });

    testWidgets('a 100% variant rollout swaps the wording for every install', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(
            promoEnabled: true,
            flags: const <String, int>{'promo_card_variant': 100},
            copy: const <String, String>{
              'promo.card.title': 'Variant A headline',
              'promo.card.title.b': 'Variant B headline',
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Variant B headline'), findsOneWidget);
    });

    testWidgets('a 0% rollout — the default — leaves variant A', (
      WidgetTester tester,
    ) async {
      await tester.pumpWidget(
        _host(
          _MemStore(),
          _config(
            promoEnabled: true,
            copy: const <String, String>{
              'promo.card.title': 'Variant A headline',
              'promo.card.title.b': 'Variant B headline',
            },
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Variant A headline'), findsOneWidget);
      expect(find.text('Variant B headline'), findsNothing);
    });
  });
}
