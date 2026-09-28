// 🔴 THE PROOF THAT THE CURRENCY CHOOSER IS THE MONEY TABLE AND STORES A CODE.
//
// Review item 8: Settings offered a literal list of four glyphs (`$ € £ ₹`) and
// persisted the GLYPH, mapped back to a code by a four-entry map. A user in
// yen, Australian or Canadian dollars had no way to choose their currency, and
// `$` itself names three currencies. The chooser now lists `core.Money.symbols`
// — the one table every formatter reads — and stores the ISO code.
//
// MUTATION PROOF (run and recorded in the PR): restore the four-glyph literal
// in settings_screen.dart and the "every row of the money table" case goes red.
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:subscriptiontracker/features/settings/settings_screen.dart';
import 'package:subscriptiontracker/state/providers.dart';
import 'package:subscriptiontracker/state/settings_controller.dart';

import 'support/width_harness.dart';

void main() {
  group('the chooser is the money table', () {
    testWidgets('🔴 every row of the money table is a chip, labelled by CODE', (
      WidgetTester tester,
    ) async {
      // Disposed INSIDE the body: flutter_test verifies every SemanticsHandle is
      // gone at the end of the body, before any tearDown runs.
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpAt(tester, const Size(800, 3000), const SettingsScreen());
        for (final String code in core.Money.symbols.keys) {
          expect(
            find.bySemanticsLabel(code),
            findsOneWidget,
            reason: '$code is a row of the money table and must be choosable',
          );
        }
      } finally {
        handle.dispose();
      }
    });

    testWidgets(
      'tapping a chip stores that CODE — yen, which no glyph list had',
      (WidgetTester tester) async {
        final MemStore store = MemStore();
        await pumpAt(
          tester,
          const Size(800, 3000),
          const SettingsScreen(),
          overrides: <Override>[
            keyValueStoreProvider.overrideWith((_) async => store),
          ],
        );
        await tester.tap(find.text('JPY'));
        await tester.pump();

        final Object? saved = jsonDecode(store.data[kSettingsKey]!);
        expect((saved! as Map<String, Object?>)['currencyCode'], 'JPY');
        expect(
          (saved as Map<String, Object?>).containsKey('currencySymbol'),
          isFalse,
          reason: 'the glyph is never written again',
        );
      },
    );
  });

  group('the stored shape', () {
    test('a legacy glyph is read ONCE as the code its chip meant', () {
      expect(
        SettingsState.fromJson(<String, Object?>{
          'currencySymbol': '₹',
        }).currencyCode,
        'INR',
      );
      expect(
        SettingsState.fromJson(<String, Object?>{
          'currencySymbol': r'$',
        }).currencyCode,
        'USD',
      );
    });

    test('a code outside the table, or an unknown glyph, falls back', () {
      expect(
        SettingsState.fromJson(<String, Object?>{
          'currencyCode': 'XXX',
        }).currencyCode,
        core.Money.fallbackCurrencyCode,
      );
      expect(
        SettingsState.fromJson(<String, Object?>{
          'currencySymbol': '¤',
        }).currencyCode,
        core.Money.fallbackCurrencyCode,
      );
    });

    test('the code wins over a stale legacy glyph', () {
      expect(
        SettingsState.fromJson(<String, Object?>{
          'currencyCode': 'CAD',
          'currencySymbol': '₹',
        }).currencyCode,
        'CAD',
      );
    });

    test('a code round-trips', () {
      const SettingsState s = SettingsState(currencyCode: 'AUD');
      expect(SettingsState.fromJson(s.toJson()).currencyCode, 'AUD');
    });

    test('setCurrency REFUSES a code the table does not have', () {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => MemStore()),
        ],
      );
      addTearDown(c.dispose);
      expect(
        () => c.read(settingsControllerProvider.notifier).setCurrency('XXX'),
        throwsArgumentError,
      );
      expect(
        c.read(settingsControllerProvider).currencyCode,
        core.Money.fallbackCurrencyCode,
      );
    });
  });

  group('🔴 ST-C1 — the first run takes the device region currency', () {
    // Audit C31: every install started in USD, so an Indian user's first ₹649
    // was stored and totalled as dollars. MUTATION PROOF: make
    // `SettingsController.build` return `const SettingsState()` again and the
    // first two cases go red.
    ProviderContainer containerFor(MemStore store, String? region) {
      final ProviderContainer c = ProviderContainer(
        overrides: <Override>[
          keyValueStoreProvider.overrideWith((_) async => store),
          deviceRegionProvider.overrideWithValue(region),
        ],
      );
      addTearDown(c.dispose);
      return c;
    }

    test('an empty store in India starts in INR, and writes it once', () async {
      final MemStore store = MemStore();
      final ProviderContainer c = containerFor(store, 'IN');
      await c.read(settingsControllerProvider.notifier).hydration;
      expect(c.read(settingsControllerProvider).currencyCode, 'INR');
      final Object? saved = jsonDecode(store.data[kSettingsKey]!);
      expect((saved! as Map<String, Object?>)['currencyCode'], 'INR');
    });

    test('a legacy store with no currency reads the region too', () async {
      final MemStore store = MemStore()
        ..data[kSettingsKey] = jsonEncode(<String, Object?>{
          'prefs': <String, bool>{'alerts': true},
        });
      final ProviderContainer c = containerFor(store, 'GB');
      await c.read(settingsControllerProvider.notifier).hydration;
      expect(c.read(settingsControllerProvider).currencyCode, 'GBP');
    });

    test('a stored choice always wins over the region', () async {
      final MemStore store = MemStore()
        ..data[kSettingsKey] = jsonEncode(<String, Object?>{
          'currencyCode': 'USD',
        });
      final ProviderContainer c = containerFor(store, 'IN');
      await c.read(settingsControllerProvider.notifier).hydration;
      expect(c.read(settingsControllerProvider).currencyCode, 'USD');
    });

    testWidgets('the chooser says it converts nothing (audit D10)', (
      WidgetTester tester,
    ) async {
      await pumpAt(tester, const Size(800, 3000), const SettingsScreen());
      expect(find.textContaining('does not convert'), findsOneWidget);
    });
  });
}
