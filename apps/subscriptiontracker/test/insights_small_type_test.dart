// NO TYPE UNDER 12 PX ON INSIGHTS — ST-Y4 (audit C5).
//
// The audit found a 9 px "/mo" label (`fontSize: 9`) on the insights donut
// legend. ST-D3 replaced that legend and the literal left with it, but nothing
// stopped the next card from bringing one back: the theme ramp's floor
// ([AppTypeRamp.minimumSize], ST-D0) binds only text that reads the ramp, and a
// `copyWith(fontSize: …)` walks straight past it.
//
// So this measures what is PAINTED: every text span of every paragraph on the
// rendered screen, with the size it inherits from its parents, in both
// locales (Tamil runs longer and is where a squeezed label would be shrunk).
//
// MUTATION PROOF (run 2026-09-30 on this tree): give the category card's
// share label `fontSize: 9` and this goes red naming the span; restore it
// and it is green.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:subscriptiontracker/features/insights/insights_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'support/width_harness.dart';

/// Every (text, font size) painted under [root], sizes inherited span to span.
List<(String, double)> _paintedSizes(WidgetTester tester) {
  final List<(String, double)> out = <(String, double)>[];
  void span(InlineSpan s, double inherited) {
    final double size = s.style?.fontSize ?? inherited;
    if (s is TextSpan) {
      final String? t = s.text;
      if (t != null && t.trim().isNotEmpty) out.add((t, size));
      for (final InlineSpan c in s.children ?? const <InlineSpan>[]) {
        span(c, size);
      }
    }
  }

  for (final RenderParagraph p in tester.renderObjectList<RenderParagraph>(
    find.byType(RichText),
  )) {
    // A span with no size of its own paints at the engine default (14).
    span(p.text, 14);
  }
  return out;
}

Future<void> _pump(WidgetTester tester, Locale locale) async {
  await tester.binding.setSurfaceSize(const Size(390, 4000));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: defaultWidthOverrides(),
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        theme: buildAppTheme(seed: const Color(0xFF6459F5)),
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: InsightsScreen()),
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
}

void main() {
  for (final Locale locale in kSupportedLocales.map(
    (RegisteredLocale r) => r.locale,
  )) {
    testWidgets('no text on Insights is painted under '
        '${AppTypeRamp.minimumSize} px (${locale.languageCode})', (
      WidgetTester tester,
    ) async {
      await _pump(tester, locale);
      final List<(String, double)> sizes = _paintedSizes(tester);
      expect(
        sizes.length,
        greaterThan(10),
        reason:
            'COVERAGE LOST — only ${sizes.length} spans measured, so the '
            'screen did not render its cards and the floor checked nothing',
      );
      final List<String> small = <String>[
        for (final (String text, double size) in sizes)
          if (size < AppTypeRamp.minimumSize) '"$text" at $size px',
      ];
      expect(
        small,
        isEmpty,
        reason:
            'type under the ramp floor is unreadable at arm\'s length and is '
            'the ST-Y4 finding (the 9 px "/mo" label): $small',
      );
    });
  }
}
