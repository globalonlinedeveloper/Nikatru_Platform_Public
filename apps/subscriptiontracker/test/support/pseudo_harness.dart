// ─────────────────────────────────────────────────────────────────────────────
// pseudo_harness.dart — hosts a screen under one of the locale register's
// pseudo-locales (en-XA: accented and ~40% longer; ar-XB: right-to-left).
//
// The catalogues are the REAL English ARBs (this app's and the chassis'),
// answered through `PseudoArbMessages` (nikatru_design_system/testing.dart), so
// every key either ARB gains is pseudo-localised with no file to regenerate.
// The surface, overrides and pump count are width_harness.dart's.
// ─────────────────────────────────────────────────────────────────────────────
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';
import 'package:nikatru_design_system/testing.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';

import 'width_harness.dart';

/// This app's strings in a pseudo-locale — AND the chassis', because the app
/// reads every chassis key through its own `l10n` (lib/l10n/chassis_keys.g.dart
/// answers from a catalogue that `is ChassisLocalizations`), so one object
/// answering both keeps those strings pseudo too.
class PseudoAppLocalizations extends PseudoArbMessages
    implements AppLocalizations, ChassisLocalizations {
  /// [arb] is the decoded `app_en.arb` merged over `chassis_en.arb`.
  PseudoAppLocalizations(super.arb, super.pseudo);
}

Map<String, dynamic> _readArb(String path) {
  final File f = File(path);
  expect(
    f.existsSync(),
    isTrue,
    reason:
        'COVERAGE LOST — $path does not exist from ${Directory.current.path}; '
        'a pseudo-locale test with no catalogue would render nothing to measure',
  );
  return jsonDecode(f.readAsStringSync()) as Map<String, dynamic>;
}

/// The app's English ARB, decoded once per isolate.
final Map<String, dynamic> kAppArb = _readArb('lib/l10n/app_en.arb');

/// The chassis' English ARB: the workspace layout is `apps/<id>` beside
/// `packages/design_system`.
final Map<String, dynamic> kChassisArb = _readArb(
  '../../packages/design_system/lib/src/l10n/chassis_en.arb',
);

/// Pins the surface to [size] and hosts [screen] in [pseudo], at [textScale].
/// Returns the [TextDirection] the screen was laid out in.
Future<TextDirection> pumpPseudo(
  WidgetTester tester,
  PseudoLocale pseudo,
  Widget screen, {
  Size size = kPhone,
  double textScale = 1,
  List<Override> overrides = const <Override>[],
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final Set<Object> replaced = <Object>{
    for (final Override o in overrides) o.origin,
  };
  final ProviderContainer c = ProviderContainer(
    retry: (int retryCount, Object error) => null,
    overrides: <Override>[
      for (final Override o in defaultWidthOverrides())
        if (!replaced.contains(o.origin)) o,
      ...overrides,
    ],
  );
  addTearDown(c.dispose);
  late TextDirection direction;
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: pseudo.locale,
        localizationsDelegates: <LocalizationsDelegate<dynamic>>[
          PseudoLocalizationsDelegate<AppLocalizations>(
            (PseudoLocale p) => PseudoAppLocalizations(<String, dynamic>{
              ...kChassisArb,
              ...kAppArb,
            }, p),
          ),
          PseudoLocalizationsDelegate<ChassisLocalizations>(
            (PseudoLocale p) => PseudoChassisLocalizations(kChassisArb, p),
          ),
          ...AppLocalizations.localizationsDelegates,
          ChassisLocalizations.delegate,
        ],
        supportedLocales: <Locale>[
          for (final PseudoLocale p in kPseudoLocales) p.locale,
          ...AppLocalizations.supportedLocales,
        ],
        builder: (BuildContext context, Widget? child) {
          direction = Directionality.of(context);
          return MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(textScale)),
            child: child!,
          );
        },
        home: screen,
      ),
    ),
  );
  for (int i = 0; i < 12; i++) {
    await tester.pump();
  }
  return direction;
}
